import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridge,normalizeRecord,dateField,httpsLink,FIELDS} from '../server/feishu.mjs';
const env={FEISHU_APP_ID:'test-app',FEISHU_APP_SECRET:'never-return-this-secret',FEISHU_BASE_TOKEN:'test-base',FEISHU_BASE_URL:'https://class.feishu.cn/base/test',...Object.fromEntries(Object.keys(FIELDS).map(key=>['FEISHU_TABLE_'+key.toUpperCase(),key]))};
const makeRecord=(kind,changes={})=>({record_id:'rec_'+kind,fields:{...Object.fromEntries(FIELDS[kind].map(key=>[key,'示例内容'])),发布状态:'已发布',日期:'2026-09-17',开始时间:kind==='courses'?'18:00':'2026-09-19 17:00',结束时间:kind==='courses'?'21:30':'2026-09-19 19:00',截止时间:'2026-09-17 23:59',发布时间:'2026-09-12 16:00',更新时间:'2026-09-13 10:00',参加人数:0,资料链接:{text:'资料',link:'https://class.feishu.cn/docx/example'},...changes}});
const request=()=>new Request('https://class.example/api/class-content');
function provider({draft=false,invalid=false,missingField=false,page=false}={}){
  const calls=[];let fail=false,withdraw=false;
  const fetchImpl=async(raw,init)=>{
    const url=new URL(raw);calls.push({url,init});
    assert.equal(url.origin,'https://open.feishu.cn');
    if(fail)return Response.json({code:99991672,msg:'secret provider details '+env.FEISHU_APP_SECRET},{status:403});
    if(url.pathname.includes('/auth/'))return Response.json({code:0,tenant_access_token:'private-provider-token',expire:7200});
    assert.equal(init.headers.Authorization,'Bearer private-provider-token');
    const kind=url.pathname.split('/tables/')[1].split('/')[0];
    if(url.pathname.endsWith('/fields')){
      assert.equal(url.searchParams.get('page_size'),'100');
      return Response.json({code:0,data:{items:FIELDS[kind].filter(name=>!missingField||name!=='发布状态').map(field_name=>({field_name})),has_more:false}});
    }
    assert.equal(init.method,'POST');assert.ok(url.pathname.endsWith('/records/search'));
    const body=JSON.parse(init.body);assert.deepEqual(body.filter.conditions,[{field_name:'发布状态',operator:'is',value:['已发布']}]);assert.deepEqual(body.field_names,FIELDS[kind]);
    let items=withdraw?[]:[makeRecord(kind)];
    if(draft)items.push({...makeRecord(kind,{发布状态:'草稿',作业标题:'PRIVATE DRAFT',活动名称:'PRIVATE DRAFT'}),record_id:'rec_private'});
    if(invalid&&kind==='activities')items.push({...makeRecord(kind,{参加人数:-1}),record_id:'rec_invalid'});
    const second=!!url.searchParams.get('page_token');
    if(page&&second)items=[{...makeRecord(kind),record_id:'rec_second_'+kind}];
    return Response.json({code:0,data:{items,has_more:page&&!second,...(page&&!second?{page_token:'next-page'}:{})}});
  };
  return {fetchImpl,calls,setFail:v=>fail=v,setWithdraw:v=>withdraw=v};
}
test('no configuration is explicit demo; partial config and mutation requests fail safely',async()=>{
  const bridge=createBridge({fetchImpl:()=>{throw new Error('must not fetch');}});
  assert.equal((await(await bridge(request(),{})).json()).mode,'demo');
  const partial=await bridge(request(),{FEISHU_APP_SECRET:env.FEISHU_APP_SECRET});assert.equal(partial.status,503);assert.doesNotMatch(await partial.text(),/never-return/);
  assert.equal((await bridge(new Request(request(),{method:'POST'}),env)).status,405);
});
test('Feishu rich text, numeric dates, text dates, zero counts and safe links normalize',()=>{
  const r=normalizeRecord('assignments',makeRecord('assignments',{作业标题:[{type:'text',text:'小组'},{type:'text',text:'作业'}],截止时间:Date.parse('2026-09-17T23:59:00+08:00')}));
  assert.equal(r.title,'小组作业');assert.equal(r.due,'2026-09-17T23:59:00+08:00');
  assert.equal(dateField('2026/09/17 23:59'),r.due);
  assert.equal(dateField('2026-02-31T00:00:00+08:00'),'');
  assert.equal(dateField('2026-09-17 25:59'),'');
  assert.equal(normalizeRecord('activities',makeRecord('activities')).participants,0);
  assert.equal(normalizeRecord('courses',makeRecord('courses',{发布状态:'草稿'})),null);
  assert.throws(()=>normalizeRecord('courses',makeRecord('courses',{结束时间:'10:00'})));
  assert.equal(httpsLink('javascript:alert(1)'),'');assert.equal(httpsLink('https://evil-feishu.cn/base/x',true),'');
  assert.equal(httpsLink({link:'https://class.feishu.cn/docx/a'}),'https://class.feishu.cn/docx/a');
});
test('all five tables, paginated records, draft filtering and invalid-record reporting',async()=>{
  const p=provider({draft:true,invalid:true,page:true});const bridge=createBridge({fetchImpl:p.fetchImpl});
  const response=await bridge(request(),env);assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.mode,'live');assert.equal(data.invalidRecords,1);
  for(const kind of Object.keys(FIELDS))assert.equal(data.content[kind].length,2);
  const serialized=JSON.stringify(data);assert.doesNotMatch(serialized,/PRIVATE DRAFT|private-provider-token|never-return-this-secret/);
  assert.equal(p.calls.filter(c=>c.url.pathname.includes('/auth/')).length,1);
  assert.equal(response.headers.get('cache-control'),'no-store');
});
test('shared in-flight request, bounded cache, withdrawal refresh and no stale fallback',async()=>{
  let time=Date.parse('2026-09-15T00:00:00+08:00');const p=provider();const bridge=createBridge({fetchImpl:p.fetchImpl,clock:()=>time});
  await Promise.all([bridge(request(),env),bridge(request(),env)]);const calls=p.calls.length;
  await bridge(request(),env);assert.equal(p.calls.length,calls);
  p.setWithdraw(true);time+=300001;const withdrawn=await(await bridge(request(),env)).json();assert.equal(withdrawn.content.assignments.length,0);
  p.setFail(true);time+=300001;const failed=await bridge(request(),env);assert.equal(failed.status,503);
  const data=await failed.json();assert.equal(data.mode,'unavailable');assert.equal(data.content,undefined);assert.doesNotMatch(JSON.stringify(data),/secret provider details|never-return/);
});
test('missing template columns fail visibly even when no published records exist',async()=>{
  const p=provider({missingField:true});const response=await createBridge({fetchImpl:p.fetchImpl})(request(),env);
  assert.equal(response.status,503);assert.equal((await response.json()).code,'FEISHU_SCHEMA');
});

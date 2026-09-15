'use strict';
const contentLists = {courses,assignments:tasks,activities,notices,resources};
const demoSnapshot = Object.fromEntries(Object.entries(contentLists).map(([key,list])=>[key,structuredClone(list)]));
const connection = {mode:'loading',maintenanceUrl:'',syncedAt:'',message:'正在读取班级信息…',invalidRecords:0};
let contentRequest = null;
const isDemo = () => connection.mode === 'demo';
function applyContent(content) {
  for (const [key,list] of Object.entries(contentLists)) list.splice(0,list.length,...(content[key]||[]));
}
applyContent({});
function safeLink(value,feishuOnly=false) {
  try {const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(!feishuOnly||['feishu.cn','larksuite.com'].some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))?u.href:'';}catch{return '';}
}
function dataMessage() {
  if(connection.mode==='live') return `飞书已同步 · ${new Date(connection.syncedAt).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'})} 更新`;
  if(connection.mode==='demo') return '尚未连接飞书 · 当前为示例内容';
  if(connection.mode==='loading') return '正在读取班级信息…';
  return '班级信息暂时无法读取，请稍后重试';
}
function sourceBanner() {
  return `<div class="source-status ${connection.mode==='unavailable'?'source-error':''}" role="status"><span>${icon(connection.mode==='unavailable'?'info':'refresh')}${esc(dataMessage())}</span><button class="text-link" data-action="sync-content" ${connection.mode==='loading'?'disabled':''}>${connection.mode==='demo'?'检查连接':'刷新'}</button></div>`;
}
function validatePayload(content) {
  if(!content||typeof content!=='object') throw new Error('班级信息格式暂不可用。');
  for(const [key,required] of Object.entries({courses:['title','short','date','start','end','teacher','room','type','topic','description'],assignments:['title','course','short','due','description','submission','publisher','publishedAt'],activities:['title','category','description','start','end','location','content','contactName','contactRole','contactInfo','publisher','updatedAt'],notices:['title','tag','body','author','date'],resources:['title','course','code','category','summary','date','type','url','content']})) {
    if(!Array.isArray(content[key])||content[key].some(row=>!row||typeof row.id!=='string'||!/^[-\w]+$/.test(row.id)||required.some(field=>typeof row[field]!=='string')||(key==='activities'&&(!Number.isInteger(row.participants)||row.participants<0)))) throw new Error('班级信息格式暂不可用。');
  }
  return content;
}
async function loadClassContent() {
  if(contentRequest) return contentRequest;
  contentRequest = (async()=>{
    try {
      const local = location.protocol==='file:'||['localhost','127.0.0.1','[::1]'].includes(location.hostname);
      let response,payload;
      if(location.protocol==='file:') payload={mode:'demo'};
      else {
        response=await fetch('./api/class-content',{cache:'no-store',signal:AbortSignal.timeout(40000)});
        if(response.status===404&&local) payload={mode:'demo'};
        else if(!response.headers.get('content-type')?.includes('application/json')) throw new Error('尚未连接班级信息，请联系维护同学。');
        else payload=await response.json();
      }
      connection.maintenanceUrl=safeLink(payload.maintenanceUrl,true);
      if(payload.mode==='live'&&response.ok) {
        if(!Number.isFinite(Date.parse(payload.syncedAt))) throw new Error('更新时间暂不可用。');
        applyContent(validatePayload(payload.content));
        Object.assign(connection,{mode:'live',syncedAt:payload.syncedAt,message:'',invalidRecords:Number(payload.invalidRecords)||0});
      } else if(payload.mode==='demo'&&(!response||response.ok||response.status===404)) {
        applyContent(structuredClone(demoSnapshot));
        Object.assign(connection,{mode:'demo',syncedAt:'',invalidRecords:0,message:'连接完成前展示示例内容。'});
      } else throw new Error(payload.message||'班级信息暂时无法读取。');
    } catch(error) {
      applyContent({});
      Object.assign(connection,{mode:'unavailable',syncedAt:'',invalidRecords:0,message:error.name==='TimeoutError'?'读取超时，请稍后重试。':error.message||'暂时无法连接班级信息。'});
    }
    // An open detail might have been withdrawn or changed in Feishu.
    if(document.querySelector('dialog').open) closeDialog();
    render();
  })().finally(()=>{contentRequest=null;});
  return contentRequest;
}

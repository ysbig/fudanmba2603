import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {normalizeRecord} from '../server/feishu.mjs';
const files=await Promise.all(['content.js','data-source.js','app.js'].map(f=>fs.readFile(new URL('../dist/'+f,import.meta.url),'utf8')));
function sandbox(payload,status=200){
  const elements=new Map();const handlers={};
  const element=()=>({innerHTML:'',textContent:'',open:false,style:{},classList:{add(){},remove(){}},addEventListener(){},focus(){},showModal(){this.open=true;},close(){this.open=false;}});
  const document={hidden:false,body:{style:{}},activeElement:null,querySelector(s){if(!elements.has(s))elements.set(s,element());return elements.get(s);},querySelectorAll(){return [];},addEventListener(name,fn){handlers[name]=fn;}};
  const c=vm.createContext({document,window:{addEventListener(){},scrollTo(){}},location:{hash:'#home',protocol:'https:',hostname:'class.example'},URL,Response,Request,AbortSignal,structuredClone,Date,console,setTimeout(){},clearTimeout(){},setInterval(){},fetch:async()=>Response.json(payload,{status})});
  for(const code of files)vm.runInContext(code,c);
  return {c,elements,setResponse(value,s=200){c.fetch=async()=>Response.json(value,{status:s});},async done(){await vm.runInContext('contentRequest',c);}};
}
test('unconnected demo has slogan, real date and Feishu maintenance instead of local writes',async()=>{
  const s=sandbox({mode:'demo'});await s.done();
  const home=s.elements.get('main').innerHTML;assert.match(home,/橙启新序/);assert.match(home,/共赴同行/);assert.match(home,/尚未连接飞书/);
  assert.equal(vm.runInContext('today()',s.c),new Date(Date.now()+8*3600000).toISOString().slice(0,10));
  for(const route of ['home','schedule','todos','resources','classroom','activities','manage']){
    vm.runInContext(`state.route='${route}';render()`,s.c);const html=s.elements.get('main').innerHTML;
    assert.doesNotMatch(html,/content-editor|data-editor|保存到本次预览|type="checkbox"/);
  }
  assert.match(s.elements.get('main').innerHTML,/前往飞书维护/);
});
test('live data replaces mock records; rich content escaped; errors never reintroduce demo data',async()=>{
  const assignment=normalizeRecord('assignments',{record_id:'rec_assignment',fields:{作业标题:'<img src=x onerror=alert(1)>',课程名称:'课程',课程代码:'DMD',截止时间:'2026-09-20 23:59',作业要求:'要求',提交说明:'按要求提交',发布人:'学习委员',发布时间:'2026-09-15 08:00',发布状态:'已发布'}});
  const content={courses:[],assignments:[assignment],activities:[],notices:[],resources:[]};
  const s=sandbox({mode:'live',syncedAt:new Date().toISOString(),content,maintenanceUrl:'https://class.feishu.cn/base/example'});await s.done();
  assert.equal(vm.runInContext('courses.length',s.c),0);assert.equal(vm.runInContext('tasks.length',s.c),1);
  vm.runInContext("state.route='todos';state.taskFilter='all';render()",s.c);assert.match(s.elements.get('main').innerHTML,/&lt;img/);assert.doesNotMatch(s.elements.get('main').innerHTML,/<img src=x/);
  s.setResponse({mode:'unavailable',message:'读取失败'},503);await vm.runInContext('loadClassContent()',s.c);
  assert.equal(vm.runInContext('tasks.length',s.c),0);assert.match(s.elements.get('main').innerHTML,/暂时无法读取/);assert.doesNotMatch(s.elements.get('main').innerHTML,/第一次作业/);
});
test('unrecognized remote endpoint does not silently pretend to have connected',async()=>{
  const s=sandbox({unexpected:true},404);await s.done();assert.equal(vm.runInContext('connection.mode',s.c),'unavailable');
});

// Read-only bridge. Credentials and unpublished records never leave this module.
const ORIGIN = 'https://open.feishu.cn';
const TTL = 300_000;
const TABLES = {
  courses: 'FEISHU_TABLE_COURSES', assignments: 'FEISHU_TABLE_ASSIGNMENTS',
  activities: 'FEISHU_TABLE_ACTIVITIES', notices: 'FEISHU_TABLE_NOTICES',
  resources: 'FEISHU_TABLE_RESOURCES'
};
const REQUIRED = ['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_BASE_TOKEN', ...Object.values(TABLES)];
export const FIELDS = {
  courses: ['课程名称','课程代码','日期','开始时间','结束时间','授课教师','上课地点','课程类型','本节主题','课程说明','发布状态'],
  assignments: ['作业标题','课程名称','课程代码','截止时间','作业要求','提交说明','发布人','发布时间','发布状态'],
  activities: ['活动名称','活动类型','活动简介','开始时间','结束时间','活动地点','参加人数','活动内容','对接人姓名','对接人职务','对接方式','发布人','更新时间','发布状态'],
  notices: ['公告标题','分类','正文','发布人','发布时间','发布状态'],
  resources: ['资料名称','课程名称','课程代码','分类','资料链接','资料简介','更新时间','发布状态']
};
class BridgeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export function textField(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return value.map(textField).join('').trim();
  if (value && typeof value === 'object') return textField(value.text ?? value.name ?? '');
  return '';
}
export function httpsLink(value, feishuOnly = false) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value.link ?? value.url : textField(value);
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return '';
    if (feishuOnly && !['feishu.cn','larksuite.com'].some(d => u.hostname === d || u.hostname.endsWith('.'+d))) return '';
    return u.href;
  } catch { return ''; }
}
export function dateField(value, dateOnly = false) {
  let raw;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(value + 8 * 3600000);
    if (!Number.isFinite(d.getTime())) return '';
    raw = d.toISOString().slice(0,19) + '+08:00';
  } else {
    raw = textField(value).replaceAll('/', '-');
    if (/^\d{13}$/.test(raw)) return dateField(Number(raw), dateOnly);
    const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    if (parts && new Date(Date.UTC(Number(parts[1]),Number(parts[2])-1,Number(parts[3]))).toISOString().slice(0,10) !== parts[0]) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) raw += 'T00:00:00+08:00';
    else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(raw)) raw = raw.replace(' ','T') + (raw.length === 16 ? ':00' : '') + '+08:00';
    else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(raw)) {
      const d = Date.parse(raw);
      if (!Number.isFinite(d)) return '';
      return dateField(d, dateOnly);
    } else return '';
  }
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return '';
  const normalized = new Date(timestamp + 8 * 3600000).toISOString().slice(0,19) + '+08:00';
  if (normalized.slice(0,19) !== raw.slice(0,19)) return '';
  return dateOnly ? normalized.slice(0,10) : normalized;
}
function timeField(value) {
  const t = textField(value);
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : '';
}
function requiredText(fields, key) {
  const value = textField(fields[key]);
  if (!value || value.length > 20000) throw new Error('invalid record');
  return value;
}
function needed(value) { if (!value) throw new Error('invalid record'); return value; }
export function normalizeRecord(kind, record) {
  const f = record.fields || {};
  if (textField(f['发布状态']) !== '已发布') return null;
  const id = needed(typeof record.record_id === 'string' && /^[\w-]+$/.test(record.record_id) ? record.record_id : '');
  const s = key => textField(f[key]);
  const req = key => requiredText(f,key);
  const date = (key, only = false) => needed(dateField(f[key],only));
  if (kind === 'courses') {
    const start = needed(timeField(f['开始时间'])), end = needed(timeField(f['结束时间']));
    if (end <= start) throw new Error('invalid course time');
    return {id,title:req('课程名称'),short:req('课程代码'),date:date('日期',true),start,end,teacher:req('授课教师'),room:req('上课地点'),type:s('课程类型')||'课程',topic:s('本节主题'),description:s('课程说明')};
  }
  if (kind === 'assignments') return {id,title:req('作业标题'),course:req('课程名称'),short:req('课程代码'),due:date('截止时间'),description:req('作业要求'),submission:req('提交说明'),publisher:req('发布人'),publishedAt:date('发布时间')};
  if (kind === 'activities') {
    const start = date('开始时间'), end = date('结束时间'), participants = Number(s('参加人数'));
    if (Date.parse(end) <= Date.parse(start) || !s('参加人数') || !Number.isInteger(participants) || participants < 0 || participants > 9999) throw new Error('invalid activity');
    return {id,title:req('活动名称'),category:s('活动类型')||'班级活动',description:req('活动简介'),start,end,location:req('活动地点'),participants,content:req('活动内容'),contactName:req('对接人姓名'),contactRole:s('对接人职务'),contactInfo:req('对接方式'),publisher:req('发布人'),updatedAt:date('更新时间')};
  }
  if (kind === 'notices') return {id,title:req('公告标题'),tag:s('分类')||'通知',body:req('正文'),author:req('发布人'),date:date('发布时间',true)};
  if (kind === 'resources') return {id,title:req('资料名称'),course:req('课程名称'),code:req('课程代码'),category:req('分类'),url:needed(httpsLink(f['资料链接'])),summary:s('资料简介'),date:date('更新时间',true),type:'LINK',content:''};
  throw new Error('unknown table');
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
}
export function createBridge({fetchImpl = fetch, clock = Date.now} = {}) {
  let signature = '', token = null, tokenJob = null, snapshot = null, syncJob = null;
  async function api(path, init = {}) {
    let response, body;
    try {
      response = await fetchImpl(ORIGIN + path,{...init,redirect:'error',signal:AbortSignal.timeout(12000)});
      body = await response.json();
    } catch { throw new BridgeError('FEISHU_UNAVAILABLE','飞书暂时无法连接，请稍后重试。'); }
    if (!response.ok || body.code !== 0) {
      if (response.status === 429 || [99991400,1254290].includes(body.code)) throw new BridgeError('FEISHU_RATE_LIMIT','飞书请求较多，请稍后重试。');
      // Do not expose provider responses, URLs, tokens or content to visitors.
      throw new BridgeError('FEISHU_ACCESS','飞书读取失败，请维护者核对应用凭证、读取权限与表格授权。');
    }
    return body;
  }
  async function accessToken(env) {
    if (token && token.until > clock()) return token.value;
    if (!tokenJob) tokenJob = (async () => {
      const body = await api('/open-apis/auth/v3/tenant_access_token/internal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({app_id:env.FEISHU_APP_ID,app_secret:env.FEISHU_APP_SECRET})});
      if (typeof body.tenant_access_token !== 'string' || !body.tenant_access_token) throw new BridgeError('FEISHU_ACCESS','飞书应用尚未授权。');
      token = {value:body.tenant_access_token,until:clock()+Math.max(60,(Number(body.expire)||7200)-120)*1000};
      return token.value;
    })().finally(() => { tokenJob = null; });
    return tokenJob;
  }
  async function list(env, table, resource, bearer, fieldNames) {
    let page = '', values = [], seen = new Set();
    for (let i = 0; i < 20; i++) {
      const query = new URLSearchParams({page_size: resource === 'fields' ? '100' : '500'});
      if (page) query.set('page_token',page);
      const path = `/open-apis/bitable/v1/apps/${encodeURIComponent(env.FEISHU_BASE_TOKEN)}/tables/${encodeURIComponent(table)}/${resource}${resource==='records'?'/search':''}?${query}`;
      const headers = {Authorization:'Bearer '+bearer};
      const init = resource==='records' ? {method:'POST',headers:{...headers,'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({field_names:fieldNames,automatic_fields:false,filter:{conjunction:'and',conditions:[{field_name:'发布状态',operator:'is',value:['已发布']}]}})} : {headers};
      const body = await api(path,init);
      if (!body.data || !Array.isArray(body.data.items)) throw new BridgeError('FEISHU_RESPONSE','飞书返回了无法识别的数据，请维护者检查表格配置。');
      values.push(...body.data.items);
      if (!body.data.has_more) return values;
      page = body.data.page_token;
      if (typeof page !== 'string' || !page || seen.has(page)) break;
      seen.add(page);
    }
    throw new BridgeError('FEISHU_PAGINATION','表格数据未完整读取，请维护者检查表格大小。');
  }
  async function sync(env, maintenanceUrl) {
    const bearer = await accessToken(env);
    const pairs = await Promise.all(Object.entries(TABLES).map(async ([kind, variable]) => {
      const fields = await list(env,env[variable],'fields',bearer);
      const names = new Set(fields.map(f => f.field_name));
      const missing = FIELDS[kind].filter(name => !names.has(name));
      if (missing.length) throw new BridgeError('FEISHU_SCHEMA','飞书表格列名与模板不一致，请维护者保留模板中的全部列名。');
      const rows = await list(env,env[variable],'records',bearer,FIELDS[kind]);
      const items = []; let invalid = 0;
      for (const row of rows) {
        try { const item = normalizeRecord(kind,row); if (item) items.push(item); }
        catch { invalid++; }
      }
      return [kind,items,invalid];
    }));
    const content = Object.fromEntries(pairs.map(([key,items])=>[key,items]));
    content.courses.sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start));
    content.assignments.sort((a,b)=>a.due.localeCompare(b.due));
    content.activities.sort((a,b)=>a.start.localeCompare(b.start));
    content.notices.sort((a,b)=>b.date.localeCompare(a.date));
    content.resources.sort((a,b)=>b.date.localeCompare(a.date));
    return {mode:'live',maintenanceUrl,syncedAt:new Date(clock()).toISOString(),refreshAfterSeconds:300,invalidRecords:pairs.reduce((n,p)=>n+p[2],0),content};
  }
  return async function handle(request, inputEnv = {}) {
    if (!['GET','HEAD'].includes(request.method)) return new Response(null,{status:405,headers:{Allow:'GET, HEAD','Cache-Control':'no-store'}});
    const env = Object.fromEntries([...REQUIRED,'FEISHU_BASE_URL'].map(k=>[k,String(inputEnv[k]||'').trim()]));
    const maintenanceUrl = httpsLink(env.FEISHU_BASE_URL,true);
    const filled = REQUIRED.filter(k=>env[k]);
    if (!filled.length) return json({mode:'demo',maintenanceUrl,refreshAfterSeconds:300,message:'尚未连接飞书，当前显示示例内容。'});
    if (filled.length !== REQUIRED.length) return json({mode:'unavailable',maintenanceUrl,code:'CONFIG_INCOMPLETE',message:'飞书接入配置尚未完成，请维护者检查环境变量。'},503);
    const nextSignature = JSON.stringify(env);
    if (signature !== nextSignature) {signature=nextSignature; token=null; snapshot=null; tokenJob=null; syncJob=null;}
    try {
      if (!snapshot || clock() - Date.parse(snapshot.syncedAt) >= TTL) {
        if (!syncJob) syncJob = sync(env,maintenanceUrl).then(data => { snapshot=data;return data; }).finally(()=>{syncJob=null;});
        await syncJob;
      }
      return json(snapshot);
    } catch (error) {
      token=null;
      // No stale content fallback: withdrawals and permission changes must not remain public.
      return json({mode:'unavailable',maintenanceUrl,code:error instanceof BridgeError ? error.code : 'SYNC_FAILED',message:error instanceof BridgeError ? error.message : '班级信息暂时无法更新，请稍后重试。'},503);
    }
  };
}

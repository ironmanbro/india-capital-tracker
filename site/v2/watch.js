/* ICT watchlist. Follow companies, investors, countries and topics; see what is new about them since the last visit.
   The list is kept in this browser only (localStorage). Nothing about it is sent anywhere. It can be exported and imported as a file.
   Data comes from the same static files as the pages (deals.js, regs.js, limits.js), loaded only when someone follows something. */
(function(){
const KEY='ict-watch-v1', KINDS={company:'Company',investor:'Investor',country:'Country',topic:'Topic'}, MAXSEEN=1500;
const norm=t=>window.ALIASES?ALIASES.norm(t):String(t==null?'':t).replace(/[^a-zA-Z0-9]+/g,' ').toLowerCase().replace(/\s+/g,' ').trim();
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
let st=read();
function read(){ try{ const s=JSON.parse(localStorage.getItem(KEY)||'null'); if(s&&Array.isArray(s.items)) return {items:s.items.filter(i=>i&&KINDS[i.k]&&i.key&&i.label),seen:Array.isArray(s.seen)?s.seen:[]} }catch(e){} return {items:[],seen:[]} }
function write(){ try{ localStorage.setItem(KEY,JSON.stringify(st)) }catch(e){} }
const keyOf=(k,label,key)=>key||(k==='topic'?String(label).trim().toLowerCase():k==='country'?String(label).trim().toLowerCase():norm(label));
const find=(k,key)=>st.items.findIndex(i=>i.k===k&&i.key===key);
const has=(k,label,key)=>find(k,keyOf(k,label,key))>=0;
function changed(){ write(); document.querySelectorAll('[data-wk]').forEach(sync); try{window.dispatchEvent(new Event('ict-watch-change'))}catch(e){} badge() }
function add(k,label,key){ key=keyOf(k,label,key); if(!KINDS[k]||!key||!String(label).trim()) return false; if(find(k,key)<0){ st.items.push({k,key,label:String(label).trim().slice(0,120),added:today()}); changed() } return true }
function remove(k,label,key){ const i=find(k,keyOf(k,label,key)); if(i>=0){ st.items.splice(i,1); changed() } }
function toggle(k,label,key){ has(k,label,key)?remove(k,label,key):add(k,label,key) }
const items=()=>st.items.slice();

/* the follow button used in tables */
function star(k,label,key){ const on=has(k,label,key);
  return '<button class="star" type="button" data-wk="'+k+'" data-wl="'+esc(label)+'"'+(key?' data-wkey="'+esc(key)+'"':'')+' aria-pressed="'+on+'" aria-label="'+(on?'Stop following ':'Follow ')+esc(label)+'" title="'+(on?'Following. Click to stop':'Follow')+'">'+(on?'★':'☆')+'</button>' }
function sync(b){ const on=has(b.dataset.wk,b.dataset.wl,b.dataset.wkey); b.setAttribute('aria-pressed',String(on)); b.textContent=on?'★':'☆'; b.title=on?'Following. Click to stop':'Follow'; b.setAttribute('aria-label',(on?'Stop following ':'Follow ')+b.dataset.wl) }
document.addEventListener('click',e=>{ const b=e.target.closest&&e.target.closest('[data-wk]'); if(!b||!b.classList.contains('star')) return; e.preventDefault(); toggle(b.dataset.wk,b.dataset.wl,b.dataset.wkey) });
window.addEventListener('storage',e=>{ if(e.key===KEY){ st=read(); document.querySelectorAll('[data-wk]').forEach(sync); try{window.dispatchEvent(new Event('ict-watch-change'))}catch(x){} badge() } });

/* loading the data files on demand */
const FILES={DEALS:'deals.js',REGS:'regs.js',LIM:'limits.js'}, pend={};
function need(name){ if(window[name]) return Promise.resolve(); if(pend[name]) return pend[name];
  return pend[name]=new Promise(res=>{ const s=document.createElement('script'); s.src=FILES[name]; s.onload=()=>res(); s.onerror=()=>{ delete pend[name]; res() }; document.head.appendChild(s) }) }
const loadAll=()=>Promise.all(Object.keys(FILES).map(need));

/* what is new about each followed item */
const LT={in:'entered the NSDL red-flag list',up:'moved to the breach list',down:'moved from breach back to red-flag',out:'left the NSDL limit lists'};
function hitsFor(it,ctx){
  const {deals,regs,lim,byIsin}=ctx, hits=[], push=h=>hits.push(h);
  {
    const dealHit=r=>({id:'d|'+r.d+'|'+r.t,d:r.d,kind:'Deal',text:(r.inv||'–')+(r.tgt?' → '+r.tgt:'')+(r.usd?' · US$ '+Math.round(r.usd).toLocaleString('en-US')+' mn':''),sub:(r.t||'')+(r.src?' ('+r.src+')':'')});
    const regHit=r=>({id:'r|'+r.d+'|'+r.t,d:r.d,kind:r.reg||'Rule',text:r.t,url:r.u});
    let status=null;
    if(it.k==='investor'){ const g=window.ALIASES?ALIASES.groupOf(it.label,'investor'):null; deals.forEach(r=>{ if(r.inv&&(norm(r.inv)===it.key||(g&&ALIASES.groupOf(r.inv,'investor')===g))) push(dealHit(r)) }) }
    else if(it.k==='company'){
      if(/^IN[EF][0-9A-Z]{9}$/.test(it.key)){ const cur=byIsin[it.key]; if(cur) status=(cur.l==='B'?'On the NSDL breach list: ':'On the NSDL red-flag list: ')+cur.agg.toFixed(2)+'% held against a '+cur.cap.toFixed(0)+'% cap'; else if(lim) status='Not on the NSDL limit lists as of '+lim.asof;
        ((lim&&lim.ev)||[]).forEach(e=>{ if(e.i===it.key) push({id:'l|'+e.d+'|'+e.i+'|'+e.t,d:e.d,kind:'Cap',text:it.label+' '+LT[e.t]+' ('+e.agg.toFixed(2)+'% held)'}) }) }
      const n=norm(it.label); if(n.length>=4) deals.forEach(r=>{ if(r.tgt&&(' '+norm(r.tgt)+' ').includes(' '+n+' ')) push(dealHit(r)) }) }
    else if(it.k==='country'){ deals.forEach(r=>{ if(r.ic&&r.ic.toLowerCase()===it.key) push(dealHit(r)) }) }
    else if(it.k==='topic'){ const q=it.key;
      deals.forEach(r=>{ if(((r.t||'')+' '+(r.tgt||'')+' '+(r.inv||'')).toLowerCase().includes(q)) push(dealHit(r)) });
      regs.forEach(r=>{ if(((r.t||'')+' '+(r.s||'')).toLowerCase().includes(q)) push(regHit(r)) }) }
    hits.sort((a,b)=>a.d<b.d?1:a.d>b.d?-1:0);
    return {hits,status};
  }
}
function ctx(){ const lim=window.LIM; return {deals:(window.DEALS&&DEALS.rows)||[],regs:(window.REGS&&REGS.regs)||[],lim,byIsin:lim?Object.fromEntries(lim.rows.map(r=>[r.isin,r])):{}} }
/* An item counts as new only against a baseline: when it is first followed, everything that already matches is recorded as seen. */
function compute(){
  const seen=new Set(st.seen), c=ctx();
  const groups=st.items.map(it=>{ const r=hitsFor(it,c); r.hits.forEach(h=>{ h.isNew=!!it.base&&!seen.has(h.id) }); return {item:it,hits:r.hits,status:r.status,fresh:r.hits.filter(h=>h.isNew).length} });
  return {groups,fresh:groups.reduce((s,g)=>s+g.fresh,0)};
}
function seedPending(){ const todo=st.items.filter(i=>!i.base); if(!todo.length) return; const c=ctx(); if(!window.DEALS||!window.REGS||!window.LIM) return;
  st=read(); const seen=new Set(st.seen); st.items.filter(i=>!i.base).forEach(it=>{ hitsFor(it,c).hits.forEach(h=>seen.add(h.id)); it.base=true }); st.seen=[...seen].slice(-MAXSEEN); write() }
function markSeen(res){ st=read(); res=res||compute(); const s=new Set(st.seen); res.groups.forEach(g=>g.hits.forEach(h=>s.add(h.id))); st.seen=[...s].slice(-MAXSEEN); write(); badge() }

/* the count beside "Watchlist" in the navigation */
function paint(n){ document.querySelectorAll('.nav a[data-w]').forEach(a=>{ let b=a.querySelector('.wbadge'); if(!n){ if(b) b.remove(); return } if(!b){ b=document.createElement('b'); b.className='wbadge'; a.appendChild(b) } b.textContent=n>99?'99+':n; a.setAttribute('aria-label','Watchlist, '+n+' new') }) }
let bt; function badge(){ clearTimeout(bt); bt=setTimeout(()=>{ if(!st.items.length) return paint(0); loadAll().then(()=>{ seedPending(); paint(compute().fresh) }) },0) }


/* Alerts when no page is open (Web Push). Switched on only when config.js carries a pushPublicKey; otherwise this is inert and the page says so.
   What is sent to the server when a visitor turns it on: the browser's push address and keys, and the list of followed items. Turning it off deletes them. */
const CFGP=()=>window.ICT_CONFIG||{}, PKEY='ict-push-v1';
const pushAvailable=()=>!!CFGP().pushPublicKey&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
const pushOn=()=>{ try{ return localStorage.getItem(PKEY)==='1'&&typeof Notification!=='undefined'&&Notification.permission==='granted' }catch(e){ return false } };
const b64=s=>{ const p='='.repeat((4-s.length%4)%4), r=atob((s+p).replace(/-/g,'+').replace(/_/g,'/')); return Uint8Array.from(r,c=>c.charCodeAt(0)) };
async function pushCall(body){ const c=CFGP(), r=await fetch(c.supabaseUrl+'/functions/v1/push-subscribe',{method:'POST',headers:{'content-type':'application/json',apikey:c.supabaseKey},body:JSON.stringify(body)}); if(!r.ok) throw new Error('The alert service answered '+r.status); }
const followsForPush=()=>st.items.map(i=>({k:i.k,key:i.key,label:i.label}));
async function pushReg(){ const reg=await navigator.serviceWorker.register('push-sw.js',{scope:'./'}); if(!reg.active){ await new Promise((ok,no)=>{ const w=reg.installing||reg.waiting; if(!w) return ok(); const t=setTimeout(()=>no(new Error('The alert worker did not start')),10000); w.addEventListener('statechange',()=>{ if(w.state==='activated'){ clearTimeout(t); ok() } }) }) } return reg }
async function pushEnable(){
  if(!pushAvailable()) throw new Error('Alerts are not available in this browser or not switched on yet');
  if(await Notification.requestPermission()!=='granted') throw new Error('Notifications were not allowed in the browser');
  const reg=await pushReg(); const sub=(await reg.pushManager.getSubscription())||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64(CFGP().pushPublicKey)});
  await pushCall({action:'save',subscription:sub.toJSON(),follows:followsForPush()}); try{ localStorage.setItem(PKEY,'1') }catch(e){} }
async function pushDisable(){ try{ const reg=await navigator.serviceWorker.getRegistration('./'); const sub=reg&&await reg.pushManager.getSubscription(); if(sub){ try{ await pushCall({action:'delete',endpoint:sub.endpoint}) }catch(e){} await sub.unsubscribe() } }finally{ try{ localStorage.removeItem(PKEY) }catch(e){} } }
let pt; function pushSync(){ if(!pushOn()) return; clearTimeout(pt); pt=setTimeout(async()=>{ try{ const reg=await navigator.serviceWorker.getRegistration('./'); const sub=reg&&await reg.pushManager.getSubscription(); if(sub) await pushCall({action:'save',subscription:sub.toJSON(),follows:followsForPush()}) }catch(e){} },1500) }
window.addEventListener('ict-watch-change',pushSync);

/* backup and restore */
const exportJson=()=>JSON.stringify({ict_watchlist:1,items:st.items},null,1);
function importJson(txt){ const o=JSON.parse(txt); if(!o||!Array.isArray(o.items)) throw new Error('not a watchlist file'); let n=0;
  o.items.forEach(i=>{ if(i&&KINDS[i.k]&&i.key&&i.label&&find(i.k,String(i.key))<0){ st.items.push({k:i.k,key:String(i.key).slice(0,120),label:String(i.label).slice(0,120),added:/^\d{4}-\d\d-\d\d$/.test(i.added)?i.added:today()}); n++ } }); changed(); return n }

window.WATCH={push:{available:pushAvailable,on:pushOn,enable:pushEnable,disable:pushDisable},KINDS,items,has,add,remove,toggle,star,compute,markSeen,loadAll,badge,exportJson,importJson,keyOf,esc};
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',badge); else badge();
})();

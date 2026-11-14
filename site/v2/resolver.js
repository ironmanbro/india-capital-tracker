/* ICT alias resolver: the site-side twin of the database function entity_of(name, kind).
   Names are compared with norm(), a copy of the SQL function norm_name() (supabase/migrations/20261029_investor_profiles.sql),
   compared with PostgreSQL on 14,223 names with no difference.
   Source (config.js, ICT_CONFIG.aliasSource):
     'local'     the owner's decisions from alias.html, kept in this browser
     'database'  the confirmed rows of the view entity_alias_confirmed, loaded once per page; if that fails or is slow the page
                 falls back to local decisions and says so (ALIASES.note())
   In database mode the browser's own decisions are ignored, so unapplied local work never mixes with what is live.
   Pages wait for ALIASES.ready before their first paint, and listen for 'ict-alias-change' to repaint.
   Nothing here guesses: a name resolves only if the owner confirmed it. */
(function(){
const MAPKEY='ict-alias-map-v1', CFG=window.ICT_CONFIG||{};
const DROP=/\b(ltd|limited|inc|llc|llp|plc|pte|pcc|vcc|the|co|corp|corporation|sa|ag|nv|bv|fund|funds|trust|lp)\b/g;
/* identical to norm_name(): non-alphanumerics to spaces, lower case, drop the legal and fund words, collapse, trim */
const norm=t=>String(t==null?'':t).replace(/[^a-zA-Z0-9]+/g,' ').toLowerCase().replace(DROP,' ').replace(/\s+/g,' ').trim();
let map={investor:{},company:{}}, source='local', groupsN={investor:0,company:0}, problem=null;
const count=()=>['investor','company'].forEach(k=>groupsN[k]=new Set(Object.values(map[k]).map(v=>v[0])).size);
const changed=()=>{ try{window.dispatchEvent(new Event('ict-alias-change'))}catch(e){} };
function fromLocal(){ try{ const m=JSON.parse(localStorage.getItem(MAPKEY)||'null'); map=(m&&m.investor&&m.company)?m:{investor:{},company:{}}; }catch(e){ map={investor:{},company:{}} } count() }
/* entry: key -> [canonical, relation, symbol, isin] */
function resolve(name,kind){ const k=norm(name); if(!k) return null; const v=(map[kind||'investor']||{})[k]; return v?{canonical:v[0],relation:v[1],symbol:v[2]||null,isin:v[3]||null,key:k}:null }
/* the key to group names by: the group's name if confirmed, otherwise the name's own cleaned key */
const groupOf=(name,kind)=>{const r=resolve(name,kind); return r?'g:'+r.canonical:'n:'+norm(name)};
function publish(entries){ /* from the review page: [{kind, canonical, symbol, isin, aliases:[{alias, relation}]}], confirmed only */
  const m={investor:{},company:{}};
  entries.forEach(g=>g.aliases.forEach(a=>{const k=norm(a.alias); if(k&&!m[g.kind][k]) m[g.kind][k]=[g.canonical,a.relation,g.symbol||null,g.isin||null]}));
  try{localStorage.setItem(MAPKEY,JSON.stringify(m))}catch(e){}
  if(source==='local'){ map=m; count() } }
/* database mode: reads the view entity_alias_confirmed (tested on PostgreSQL), paged because the API returns at most 1,000 rows a request */
async function fromDatabase(cfg){
  const m={investor:{},company:{}}, step=1000, ctl=new AbortController(), t=setTimeout(()=>ctl.abort(),cfg.aliasTimeoutMs||3000);
  try{
    for(let off=0;;off+=step){
      const r=await fetch(cfg.supabaseUrl+"/rest/v1/entity_alias_confirmed?select=kind,alias_key,relation,canonical,symbol,isin&order=kind,alias_key&limit="+step+"&offset="+off,{headers:{apikey:cfg.supabaseKey,Authorization:'Bearer '+cfg.supabaseKey},signal:ctl.signal});
      if(!r.ok) throw new Error('HTTP '+r.status);
      const part=await r.json(); if(!Array.isArray(part)) throw new Error('unexpected response');
      part.forEach(x=>{ if(m[x.kind]) m[x.kind][x.alias_key]=[x.canonical,x.relation,x.symbol,x.isin] });
      if(part.length<step) break;
    }
  } finally { clearTimeout(t) }
  return m }
async function use(mode,cfg){
  cfg=Object.assign({},CFG,cfg||{});
  if(mode!=='database'){ source='local'; problem=null; fromLocal(); return }
  try{ map=await fromDatabase(cfg); source='database'; problem=null; count() }
  catch(e){ source='local'; problem=(e&&e.name==='AbortError')?'the database did not answer in time':String(e&&e.message||e); fromLocal() }
}
const wantDb=CFG.aliasSource==='database' && !window.ICT_FORCE_LOCAL;
fromLocal();
const ready=(wantDb?use('database'):Promise.resolve()).then(()=>{ if(wantDb) changed() });
/* local mode: another tab (the review page) changed the decisions */
window.addEventListener('storage',e=>{ if(e.key===MAPKEY && source==='local'){ fromLocal(); changed() } });
/* one-line status used in page headers */
const note=()=>{const n=groupsN.investor+groupsN.company, from=source==='local'?'your review decisions in this browser, not the database':'from the database';
  const warn=problem?' Database unavailable ('+problem+'): using your local decisions instead':'';
  return (n? n+' confirmed alias group'+(n>1?'s':'')+' applied ('+groupsN.investor+' investor, '+groupsN.company+' company; '+from+')' : 'No aliases confirmed yet: names match on cleaned text only')+warn};
window.ALIASES={norm,resolve,groupOf,publish,use,note,ready,groups:()=>({...groupsN}),source:()=>source,problem:()=>problem,reload:()=>{fromLocal();changed()}};
})();

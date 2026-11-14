/* ICT alias resolver: the site-side twin of the database function entity_of(name, kind).
   Names are compared with norm(), a copy of the SQL function norm_name() (supabase/migrations/20261029_investor_profiles.sql).
   Source of confirmed aliases:
     'local'    the owner's decisions from alias.html, kept in this browser (works before the migration is applied)
     'database' one request for the confirmed rows of entity_alias, once the migrations are applied (see use('database'))
   Nothing here guesses: a name resolves only if the owner confirmed it. */
(function(){
const MAPKEY='ict-alias-map-v1';
const DROP=/\b(ltd|limited|inc|llc|llp|plc|pte|pcc|vcc|the|co|corp|corporation|sa|ag|nv|bv|fund|funds|trust|lp)\b/g;
/* identical to norm_name(): non-alphanumerics to spaces, lower case, drop the legal and fund words, collapse, trim */
const norm=t=>String(t==null?'':t).replace(/[^a-zA-Z0-9]+/g,' ').toLowerCase().replace(DROP,' ').replace(/\s+/g,' ').trim();
let map={investor:{},company:{}}, source='local', loaded=false, groupsN={investor:0,company:0};
function fromLocal(){ try{ const m=JSON.parse(localStorage.getItem(MAPKEY)||'null'); if(m&&m.investor&&m.company) map=m; }catch(e){} count(); loaded=true; }
function count(){ ['investor','company'].forEach(k=>groupsN[k]=new Set(Object.values(map[k]).map(v=>v[0])).size) }
/* entry: key -> [canonical, relation, symbol, isin] */
function resolve(name,kind){ const k=norm(name); if(!k) return null; const v=(map[kind||'investor']||{})[k]; return v?{canonical:v[0],relation:v[1],symbol:v[2]||null,isin:v[3]||null,key:k}:null }
/* the key to group names by: the group's name if confirmed, otherwise the name's own cleaned key */
const groupOf=(name,kind)=>{const r=resolve(name,kind); return r?'g:'+r.canonical:'n:'+norm(name)};
function publish(entries){ /* entries: [{kind, canonical, symbol, isin, aliases:[{alias, relation}]}] confirmed only */
  const m={investor:{},company:{}};
  entries.forEach(g=>g.aliases.forEach(a=>{const k=norm(a.alias); if(k&&!m[g.kind][k]) m[g.kind][k]=[g.canonical,a.relation,g.symbol||null,g.isin||null]}));
  map=m; count(); try{localStorage.setItem(MAPKEY,JSON.stringify(m))}catch(e){} }
/* database mode: needs both migrations. Reads the view entity_alias_confirmed (tested on PostgreSQL), paged because the API returns
   at most 1,000 rows a request. The HTTP call itself has not been run against the live project. */
async function use(mode,cfg){
  if(mode!=='database'){ source='local'; fromLocal(); return }
  const m={investor:{},company:{}}, step=1000;
  for(let off=0;;off+=step){
    const r=await fetch(cfg.url+"/rest/v1/entity_alias_confirmed?select=kind,alias_key,relation,canonical,symbol,isin&order=kind,alias_key&limit="+step+"&offset="+off,{headers:{apikey:cfg.key,Authorization:'Bearer '+cfg.key}});
    if(!r.ok) throw new Error('alias request failed: '+r.status);
    const part=await r.json(); part.forEach(x=>{ if(m[x.kind]) m[x.kind][x.alias_key]=[x.canonical,x.relation,x.symbol,x.isin] });
    if(part.length<step) break;
  }
  map=m; source='database'; count(); loaded=true }
fromLocal();
/* one-line status used in page headers */
const note=()=>{const n=groupsN.investor+groupsN.company; return n? n+' confirmed alias group'+(n>1?'s':'')+' applied ('+groupsN.investor+' investor, '+groupsN.company+' company; '+(source==='local'?'your review decisions in this browser, not the database':'from the database')+')' : 'No aliases confirmed yet: names match on cleaned text only'};
window.ALIASES={norm,resolve,groupOf,publish,use,note,groups:()=>({...groupsN}),source:()=>source,reload:fromLocal};
})();

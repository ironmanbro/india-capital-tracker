/* The browser (mockups/v2/watch.js) and the alert sender (pipeline/alerts/send_push.py) must find the same items for the same list.
   Runs both on the same data, including a synthetic NSDL cap event, and compares the item ids. Needs the local server (see README). */
const {chromium}=require('playwright'), {execFileSync}=require('child_process'), fs=require('fs'), os=require('os'), path=require('path');
const BASE='http://127.0.0.1:8790', ROOT=path.join(__dirname,'..','..','..'), SRC=path.join(ROOT,'site','v2');
(async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'parity-')); for(const f of ['deals.js','regs.js','limits.js']) fs.copyFileSync(path.join(SRC,f),path.join(tmp,f));
  const L=JSON.parse(fs.readFileSync(path.join(tmp,'limits.js'),'utf8').replace(/^window\.LIM=|;\s*$/g,'')); const isin=L.rows[0].isin;
  L.ev=[{d:'2026-11-20',i:isin,t:'up',l:'B',agg:11.5},{d:'2026-11-19',i:isin,t:'out',l:'R',agg:9.9}]; fs.writeFileSync(path.join(tmp,'limits.js'),'window.LIM='+JSON.stringify(L)+';');
  const b=await chromium.launch(), p=await b.newPage();
  await p.route('**/v2/limits.js',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(tmp,'limits.js'),'utf8')}));
  await p.goto(BASE+'/v2/watchlist',{waitUntil:'networkidle'}); await p.waitForTimeout(500);
  const follows=await p.evaluate(async(isin)=>{ await WATCH.loadAll();
    const cnt=(a,f)=>Object.entries(a.reduce((m,r)=>{const k=f(r);if(k)m[k]=(m[k]||0)+1;return m},{})).sort((x,y)=>y[1]-x[1]).map(x=>x[0]);
    const inv=cnt(DEALS.rows,r=>r.inv).slice(0,4), tgt=cnt(DEALS.rows,r=>r.tgt).slice(0,3), ctry=cnt(DEALS.rows,r=>r.ic).slice(0,2);
    const mk=(k,label,key)=>({k,label,key:WATCH.keyOf(k,label,key),added:'2026-01-01',base:true});
    const f=[...inv.map(x=>mk('investor',x)),...tgt.map(x=>mk('company',x)),mk('company','Covance Softsol',isin),...ctry.map(x=>mk('country',x)),...['gift city','fvci','press note','sebi','a','ifsca'].map(x=>mk('topic',x))];
    localStorage.setItem('ict-watch-v1',JSON.stringify({items:f,seen:[]})); return f},isin);
  await p.reload({waitUntil:'networkidle'}); await p.waitForTimeout(500);
  const js=await p.evaluate(()=>WATCH.compute().groups.map(g=>[g.item.k+'|'+g.item.key,g.hits.map(h=>h.id).sort()]));
  const py=JSON.parse(execFileSync('python3',['-c',`
import json,sys,os
os.environ['SITE_DIR']=sys.argv[1]; sys.path.insert(0,'pipeline/alerts')
import send_push as s
d=s.load('deals.js','DEALS')['rows']; r=s.load('regs.js','REGS')['regs']; l=s.load('limits.js','LIM')
print(json.dumps([[f['k']+'|'+f['key'],sorted(h['id'] for h in s.hits_for(f,d,r,l))] for f in json.loads(sys.argv[2])]))`,tmp,JSON.stringify(follows)],{cwd:ROOT}).toString());
  let bad=0, total=0; js.forEach(([k,ids],i)=>{ total+=ids.length; const other=py[i][1]; if(py[i][0]!==k||JSON.stringify(ids)!==JSON.stringify(other)){ bad++; console.log('DIFF',k,'js',ids.length,'py',other.length, ids.filter(x=>!other.includes(x)).slice(0,2),other.filter(x=>!ids.includes(x)).slice(0,2)) } });
  console.log((bad?'FAIL ':'PASS ')+'browser and sender agree on '+js.length+' follows, '+total+' matched items'); await b.close(); process.exit(bad?1:0);
})();

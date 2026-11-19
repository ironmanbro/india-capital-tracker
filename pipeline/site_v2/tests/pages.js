const {chromium,devices}=require('playwright');
const BASE='http://127.0.0.1:8790', PAGES=['/v2/','/v2/flows','/v2/deals','/v2/investors','/v2/registrations','/v2/regulations','/v2/limits','/v2/watchlist','/v2/scorecard'];
(async()=>{const b=await chromium.launch();let bad=0;
for(const [dev,opts] of [['desktop',{viewport:{width:1440,height:900}}],['phone',{...devices['iPhone 13']}]]){
 const ctx=await b.newContext(opts);
 for(const u of PAGES){
  const p=await ctx.newPage();const errs=[],csp=[];
  p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{const t=m.text(); if(m.type()==='error'){ if(/Content Security Policy|Refused to/i.test(t)) csp.push(t.slice(0,140)); else if(!/favicon|Failed to load resource.*(fonts)/i.test(t)) errs.push(t.slice(0,140))}});
  const resp=await p.goto(BASE+u,{waitUntil:'networkidle',timeout:30000}); await p.waitForTimeout(500);
  const r=await p.evaluate(()=>{const txt=document.body.innerText; return {
    title:document.title, bad:(txt.match(/NaN|undefined|\[object|Invalid Date|Infinity/g)||[]).slice(0,3), overflow:document.documentElement.scrollWidth-innerWidth,
    nav:[...document.querySelectorAll('.nav a')].map(a=>a.getAttribute('href')), sub:[...document.querySelectorAll('.sub-in a')].map(a=>a.getAttribute('href')),
    search:!!document.querySelector('.search'), classic:(document.querySelector('.top-in a[href="/"]')||{}).textContent||null, aliasBar:(()=>{const e=document.getElementById('alias-note');return e?getComputedStyle(e).display:'absent'})(),
    hash:[...document.querySelectorAll('a[href="#"]')].length, rows:document.querySelectorAll('tbody tr').length, svgs:document.querySelectorAll('svg').length, foot:(document.querySelector('.foot')||{}).innerText||''}});
  const hdr=resp.headers(); 
  const ok=errs.length===0&&csp.length===0&&r.bad.length===0&&r.overflow<=0&&!r.search&&r.classic&&r.hash===0&&resp.status()===200&&/content-security-policy/i.test(JSON.stringify(hdr));
  if(!ok) bad++;
  console.log((ok?'PASS ':'FAIL ')+dev.padEnd(8)+u.padEnd(18)+'| '+r.title.slice(0,34).padEnd(34)+'| rows '+String(r.rows).padStart(4)+' charts '+r.svgs+' | overflow '+r.overflow+' | nav '+r.nav.length+' sub '+r.sub.length+(errs.length||csp.length||r.bad.length?' | ERR '+JSON.stringify({errs,csp,bad:r.bad}):''));
  if(dev==='desktop'||u==='/v2/') await p.screenshot({path:`${(process.argv[2]||'/tmp')}/${dev}-${u.replace(/\W+/g,'_')}.png`,fullPage:true});
  await p.close()}
 await ctx.close()}
await b.close();console.log(bad?`\n${bad} page(s) failed`:'\nall pages passed');process.exit(bad?1:0)})();

const {chromium,devices}=require('playwright');const fs=require('fs');
const BASE='http://127.0.0.1:8790';
(async()=>{const b=await chromium.launch();let fail=0;const ck=(n,ok,d='')=>{console.log((ok?'PASS ':'FAIL ')+n+(d?'  -  '+d:''));if(!ok)fail++};
// 1. phone: the Classic link moves to the footer and the top bar fits
let ctx=await b.newContext({...devices['iPhone 13']});let p=await ctx.newPage();await p.goto(BASE+'/v2/',{waitUntil:'networkidle'});
ck('phone: no "Classic site" button in the top bar',await p.$eval('.top .classic',e=>getComputedStyle(e).display==='none'));
ck('phone: "Classic site" link in the footer',await p.$eval('.classic-foot',e=>getComputedStyle(e).display!=='none'&&e.querySelector('a').getAttribute('href')==='/'));
ck('phone: all five tabs fit in the bar without sideways scroll',await p.$eval('.nav',n=>n.scrollWidth<=n.clientWidth+1));
await ctx.close();
// 2. every navigation link resolves; Classic opens the old site
ctx=await b.newContext();p=await ctx.newPage();await p.goto(BASE+'/v2/flows',{waitUntil:'networkidle'});
const hrefs=await p.$$eval('.nav a,.sub-in a,.top .classic',a=>a.map(x=>x.href));let allok=true;
for(const h of hrefs){const r=await p.request.get(h);if(r.status()!==200){allok=false;console.log('   bad',h,r.status())}}
ck('all '+hrefs.length+' navigation links on a page return 200',allok);
await p.click('.top .classic');await p.waitForLoadState('networkidle');
ck('"Classic site" opens the old site',new URL(p.url()).pathname==='/'&&/Capital Tracker/i.test(await p.title()),await p.title());
// 3. the old site still works with the changed service worker
const errs=[];p.on('pageerror',e=>errs.push(e.message));await p.goto(BASE+'/',{waitUntil:'networkidle'});await p.waitForTimeout(1500);
const tabs=(await p.$$('button[role="tab"]')).length;
ck('old site loads with no errors',errs.length===0&&tabs>=10,'tabs: '+tabs+' errors: '+JSON.stringify(errs));
const sw=await p.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();return r?{scope:r.scope,active:!!r.active}:null});
ck('service worker registered for the old site',!!(sw&&sw.active),JSON.stringify(sw));
// 4. the service worker must not answer /v2 files: change a data file on disk, wait until the SERVER serves it, then the page must show it at once
const dpath='site/v2/data.js';const orig=fs.readFileSync(dpath,'utf8');
await p.goto(BASE+'/v2/',{waitUntil:'networkidle'});const before=await p.textContent('#asof');
fs.writeFileSync(dpath,orig.replace(/"built":"[^"]+"/,'"built":"TEST-MARKER 0000"'));
let served=false;for(let i=0;i<30&&!served;i++){await new Promise(r=>setTimeout(r,1000));const t=await (await ctx.request.get(BASE+'/v2/data.js',{headers:{'cache-control':'no-cache'}})).text();served=/TEST-MARKER/.test(t)}
await p.reload({waitUntil:'networkidle'});const after=await p.textContent('#asof');
fs.writeFileSync(dpath,orig);
ck('server picked up the changed file (test precondition)',served);
ck('page shows the changed data file on the very next load (no stale /v2 files from the service worker)',served&&/TEST-MARKER/.test(after)&&!/TEST-MARKER/.test(before),'before: '+before.slice(-26)+' | after: '+after.slice(-26));
// 5. offline: "/" must open the old app shell, not the /v2 page just visited
await p.goto(BASE+'/',{waitUntil:'networkidle'});await p.goto(BASE+'/v2/deals',{waitUntil:'networkidle'});await ctx.setOffline(true);
let off='';try{await p.goto(BASE+'/',{timeout:8000});off=await p.title()}catch(e){off='navigation failed: '+e.message.slice(0,60)}
ck('offline: "/" opens the old app (not the /v2 page just visited)',/Capital Tracker/i.test(off)&&!/Deals · India Capital Monitor/.test(off),off);
await ctx.setOffline(false);await ctx.close();
// 6. labels follow the data: shift every date forward 31 days (a December view) and check the headings
ctx=await b.newContext({viewport:{width:1440,height:900}});
const shift=d=>{const t=new Date(d+'T00:00:00Z');t.setUTCDate(t.getUTCDate()+31);return t.toISOString().slice(0,10)};
const src=fs.readFileSync(dpath,'utf8');const obj=JSON.parse(src.slice('window.ICT='.length,-1));
obj.nsdl_daily.forEach(r=>r.d=shift(r.d));obj.nse_fiidii.forEach(r=>r.d=shift(r.d));obj.nsdl_monthly.push(['2026-11',-12345]);
await ctx.route('**/v2/data.js',r=>r.fulfill({contentType:'application/javascript',body:'window.ICT='+JSON.stringify(obj)+';'}));
p=await ctx.newPage();p.on('pageerror',e=>errs.push(e.message));await p.goto(BASE+'/v2/',{waitUntil:'networkidle'});
const heads=await p.$$eval('#segtbl thead th',h=>h.map(x=>x.textContent.trim()));const tick=await p.$eval('.tick-in',e=>e.innerText.replace(/\s+/g,' '));
ck('home headings follow the data when the month changes',heads.includes('Dec MTD')&&heads.includes('Nov')&&!heads.includes('Oct')&&/Dec MTD/.test(tick),heads.join(' | '));
await ctx.close();
// 7. today's date is computed live (registrations page: days left and the year label)
ctx=await b.newContext();
await ctx.addInitScript(()=>{const R=Date;const fixed=new R('2026-12-20T10:00:00Z').getTime();window.Date=class extends R{constructor(...a){if(a.length){super(...a)}else{super(fixed)}}static now(){return fixed}}});
p=await ctx.newPage();await p.goto(BASE+'/v2/registrations',{waitUntil:'networkidle'});
const l3=await p.textContent('#l3');const firstDays=await p.$eval('#tbl tbody tr td:nth-child(6)',e=>e.textContent.trim());
ck("registrations: 'days left' follow today's date, not the build date",/Registered in 2026/.test(l3)&&/^[−-]\d+/.test(firstDays),'label: '+l3+' | first row days left: '+firstDays);
await ctx.close();await b.close();
console.log(fail?`\n${fail} check(s) failed`:'\nall checks passed');process.exit(fail?1:0)})();

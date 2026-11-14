/* ICT v2 mockup helpers: one number/date formatter, shared shell, small SVG charts.
   Data comes from data.js (window.ICT), built from the live Supabase tables. */
(function(){
const MINUS='−', MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const D=window.ICT;

/* ---------- formatters (the single source of number style) ---------- */
const inr=(n,o={})=>{ if(n==null||isNaN(n)) return '–'; const dp=o.dp||0; if(+Math.abs(n).toFixed(dp)===0) return '0';
  const s=Math.abs(n).toLocaleString('en-IN',{minimumFractionDigits:dp,maximumFractionDigits:dp});
  return (n<0?MINUS:(o.sign&&n>0?'+':''))+s; };
const west=(n,o={})=>{ if(n==null||isNaN(n)) return '–'; const dp=o.dp||0; if(+Math.abs(n).toFixed(dp)===0) return '0';
  const s=Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:dp,maximumFractionDigits:dp});
  return (n<0?MINUS:(o.sign&&n>0?'+':''))+s; };
const pct=(n,dp=1)=>n==null?'–':n.toFixed(dp)+'%';
const parts=iso=>{const [y,m,d]=iso.slice(0,10).split('-').map(Number);return {y,m,d}};
const dshort=iso=>{const p=parts(iso);return String(p.d).padStart(2,'0')+'-'+MON[p.m-1]+'-'+String(p.y).slice(2)};
const dnum=iso=>{const p=parts(iso);return String(p.d).padStart(2,'0')+' '+MON[p.m-1]};
const sg=(n,o={})=>{const t=inr(n,Object.assign({sign:true},o));return '<span class="num '+(t==='0'?'':n>0?'pos':'neg')+'">'+t+'</span>'};
const sgw=(n,o={})=>{const t=west(n,Object.assign({sign:true},o));return '<span class="num '+(t==='0'?'':n>0?'pos':'neg')+'">'+t+'</span>'};
const crToBn=cr=>cr/1e5; // ₹ crore -> ₹ lakh crore; only used in prose
window.F={inr,west,pct,dshort,dnum,sg,sgw,MINUS};

/* ---------- derived figures ---------- */
const daily=D.nsdl_daily, last=daily[daily.length-1];
const sum=(a,k)=>a.reduce((s,r)=>s+(r[k]||0),0);
const curM=last.d.slice(0,7);
const mtd=daily.filter(r=>r.d.slice(0,7)===curM);
const mon=D.nsdl_monthly.filter(m=>m[0]<curM);
const fyStart=(parts(last.d).m>=4?parts(last.d).y:parts(last.d).y-1)+'-04';
const calc={
  last, mtd, curM,
  mtdTotal:sum(mtd,'total'),
  fytd:mon.filter(m=>m[0]>=fyStart).reduce((s,m)=>s+m[1],0)+sum(mtd,'total'),
  cytd:mon.filter(m=>m[0].slice(0,4)===last.d.slice(0,4)).reduce((s,m)=>s+m[1],0)+sum(mtd,'total'),
  fyStart, daily
};
const lastFii=D.nse_fiidii.filter(r=>r.fii).slice(-1)[0];
const fx=D.fbil_usd.slice(-1)[0], res=D.reserves.slice(-1)[0], res0=D.reserves.slice(-2)[0];
const gsec=D.ccil_limits.find(l=>/Central/.test(l.ins));
window.CALC=calc;

/* ---------- shell ---------- */
const NAV=[['home','Home','monitor.html'],['deals','Deals','deals.html'],['investors','Investors','investors.html'],['reg','Registrations','registrations.html'],['regs','Regulations','regulations.html']];
const SUB={regs:[['feed','Rules and circulars','regulations.html'],['cal','Compliance calendar','#'],['cci','CCI approvals','#'],['ref','Reference','#']],
  reg:[['reg','Register and watch lists','registrations.html'],['lim','Foreign investment limits','#'],['gift','GIFT City / IFSCA','#'],['an','Analytics','#']],
  deals:[['all','All deals','deals.html'],['ex','Exchange deals','#'],['rep','Reported deals','#'],['odi','Outbound (ODI)','#'],['fund','Fund launches and moves','#']],
  home:[['today','Today','monitor.html'],['markets','Markets','flows.html'],['brief','Weekly brief','#']],
  investors:[['dir','Directory','investors.html'],['own','Ownership changes','#'],['net','Network','#'],['ctry','Countries','#'],['f13','13F','#'],['profile','Profile: SoftBank Group','investor.html'],['co','Profile: Meesho','company.html']]};
function shell(active,sub){
  const el=document.getElementById('shell'); if(!el) return;
  const t=(l,v,s)=>'<div class="tick-i"><span>'+l+'</span><b>'+v+'</b>'+(s?'<small>'+s+'</small>':'')+'</div>';
  el.innerHTML=
   '<header class="top"><div class="top-in"><a class="brand" href="monitor.html"><i>ICT</i><span>India Capital Monitor</span></a>'+
   '<nav class="nav" aria-label="Desks">'+NAV.map(n=>'<a href="'+n[2]+'"'+(n[0]===active?' aria-current="page"':'')+(n[2]==='#'?' title="Not in the week-1 mockups"':'')+'>'+n[1]+'</a>').join('')+'</nav>'+
   '<div class="search" role="search">Search company, FPI, ISIN, circular<kbd>⌘K</kbd></div>'+
   '<button class="tbtn" id="theme" aria-label="Switch light or dark theme">Dark</button></div></header>'+
   (SUB[active]?'<div class="sub"><nav class="sub-in" aria-label="Views">'+SUB[active].map(n=>'<a href="'+n[2]+'"'+(n[0]===sub?' aria-current="page"':'')+(n[2]==='#'?' title="Not in the mockups yet"':'')+'>'+n[1]+'</a>').join('')+'</nav></div>':'')+
   '<div class="tick"><div class="tick-in">'+
   t('FPI net, NSDL, '+dshort(last.d)+' · ₹ cr',sg(last.total))+
   t('Nov MTD · ₹ cr',sg(calc.mtdTotal))+
   t('FYTD · ₹ cr',sg(calc.fytd))+
   t('FII/FPI cash, NSE prov., '+dshort(lastFii.d)+' · ₹ cr',sg(lastFii.fii.net))+
   t('USD/INR, FBIL, '+dshort(fx[0]),'<span class="num">'+fx[1].toFixed(4)+'</span>')+
   t('FX reserves, wk '+dshort(res.w)+' · US$ mn','<span class="num">'+west(res.usd)+'</span>','<span class="num '+(res.chg>=0?'pos':'neg')+'">'+west(res.chg,{sign:true})+'</span>')+
   t('G-sec limit used, CCIL, '+dshort(D.ccil_day),'<span class="num">'+gsec.pct.toFixed(2)+'%</span>')+
   '</div></div>';
  const root=document.documentElement;
  try{const s=localStorage.getItem('ict-theme'); if(s) root.setAttribute('data-theme',s);}catch(e){}
  const b=document.getElementById('theme');
  const sync=()=>b.textContent=root.getAttribute('data-theme')==='dark'?'Light':'Dark';
  sync();
  b.onclick=()=>{const n=root.getAttribute('data-theme')==='dark'?'light':'dark';root.setAttribute('data-theme',n);try{localStorage.setItem('ict-theme',n)}catch(e){};sync();rerender()};
}

/* ---------- charts ---------- */
function niceTicks(min,max,n){ if(min===max){max=min+1}
  const span=max-min, raw=span/n, mag=Math.pow(10,Math.floor(Math.log10(raw))), r=raw/mag;
  const step=(r<1.5?1:r<3?2:r<7?5:10)*mag, a=Math.floor(min/step)*step, b=Math.ceil(max/step)*step, t=[];
  for(let v=a;v<=b+step/2;v+=step) t.push(+v.toFixed(6)); return t; }
const abbrOld=v=>{const a=Math.abs(v);return (v<0?MINUS:'')+(a>=1e5?(a/1e5).toFixed(a%1e5?1:0)+'L':a>=1e3?(a/1e3).toFixed(a%1e3?1:0)+'k':a)};
const abbr=v=>(v<0?MINUS:'')+Math.abs(v).toLocaleString('en-IN');
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const reg={}; const rerender=()=>Object.values(reg).forEach(f=>f());
let rt; window.addEventListener('resize',()=>{clearTimeout(rt);rt=setTimeout(rerender,120)});

function mount(id,draw){ const el=document.getElementById(id); if(!el) return;
  if(el._draw){ el._draw=draw; reg[id](); return; }
  el._draw=draw; el.classList.add('chart'); const tip=document.createElement('div'); tip.className='tip';
  const f=()=>{ el.innerHTML=''; el.appendChild(tip); el._draw(el,el.clientWidth||600); }; reg[id]=f;
  el.addEventListener('mousemove',e=>{const t=e.target.closest('[data-tip]'); if(!t){tip.style.display='none';return}
    const r=el.getBoundingClientRect(); tip.innerHTML=t.getAttribute('data-tip'); tip.style.display='block';
    const x=Math.min(e.clientX-r.left+12, r.width-tip.offsetWidth-4); tip.style.left=Math.max(0,x)+'px'; tip.style.top=Math.max(0,e.clientY-r.top-tip.offsetHeight-10)+'px';});
  el.addEventListener('mouseleave',()=>tip.style.display='none');
  f(); }

/* Diverging bars. series=[{key,color,label}] stacked (positives up, negatives down). rows=[{x,label,tip,vals:{key:n}}] */
function bars(id,rows,series,o={}){ mount(id,(el,W)=>{
  const H=o.h||220, m={l:44,r:8,t:8,b:22};
  let lo=0,hi=0; rows.forEach(r=>{let p=0,n=0;series.forEach(s=>{const v=r.vals[s.key]||0; v>=0?p+=v:n+=v}); hi=Math.max(hi,p); lo=Math.min(lo,n)});
  const T=niceTicks(lo,hi,o.ticks||4); m.l=10+Math.max(...T.map(v=>abbr(v).length))*6.6; const iw=W-m.l-m.r, ih=H-m.t-m.b, y0=T[0], y1=T[T.length-1], Y=v=>m.t+ih*(1-(v-y0)/(y1-y0));
  const bw=iw/rows.length, g=Math.min(2,bw*.2), ev=Math.max(o.every||1,Math.ceil(46/bw)), maj=rows.map((r,i)=>r.major?i:-9); let s='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+(o.label||'chart')+'">';
  T.forEach(v=>{s+='<line class="'+(v===0?'zero':'grid-l')+'" x1="'+m.l+'" x2="'+(W-m.r)+'" y1="'+Y(v)+'" y2="'+Y(v)+'"/><text x="'+(m.l-6)+'" y="'+(Y(v)+4)+'" text-anchor="end">'+abbr(v)+'</text>'});
  rows.forEach((r,i)=>{const x=m.l+i*bw+g/2; let up=0,dn=0;
    series.forEach(sr=>{const v=r.vals[sr.key]||0; if(!v) return; const a=v>=0?up:dn, b=a+v; if(v>=0)up=b; else dn=b;
      const yt=Y(Math.max(a,b)), yb=Y(Math.min(a,b)); s+='<rect x="'+x+'" y="'+yt+'" width="'+Math.max(1,bw-g)+'" height="'+Math.max(.5,yb-yt)+'" fill="'+css(sr.color)+'"/>'});
    s+='<rect class="hit" x="'+(m.l+i*bw)+'" y="'+m.t+'" width="'+bw+'" height="'+ih+'" fill="transparent" data-tip="'+r.tip+'"/>';
    if(r.label && (r.major || ((i%ev===0) && !maj.some(j=>Math.abs(j-i)*bw<44)))) s+='<text x="'+(x+(bw-g)/2)+'" y="'+(H-6)+'" text-anchor="middle">'+r.label+'</text>'});
  el.insertAdjacentHTML('afterbegin',s+'</svg>'); }); }

/* Line chart. lines=[{pts:[[iso,val]],color,w}] */
function lines(id,ls,o={}){ mount(id,(el,W)=>{
  const H=o.h||180, m={l:48,r:8,t:8,b:22}, iw=W-m.l-m.r, ih=H-m.t-m.b;
  const all=ls.flatMap(l=>l.pts.map(p=>p[1])); let lo=Math.min(...all), hi=Math.max(...all); const pad=(hi-lo)*.08||1; lo-=pad; hi+=pad;
  const T=niceTicks(lo,hi,o.ticks||3), y0=T[0], y1=T[T.length-1], Y=v=>m.t+ih*(1-(v-y0)/(y1-y0));
  const xs=[...new Set(ls.flatMap(l=>l.pts.map(p=>p[0])))].sort(), X=d=>m.l+iw*xs.indexOf(d)/Math.max(1,xs.length-1);
  let s='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+(o.label||'chart')+'">';
  T.forEach(v=>{s+='<line class="grid-l" x1="'+m.l+'" x2="'+(W-m.r)+'" y1="'+Y(v)+'" y2="'+Y(v)+'"/><text x="'+(m.l-6)+'" y="'+(Y(v)+4)+'" text-anchor="end">'+(o.yfmt?o.yfmt(v):v)+'</text>'});
  const lab=Math.max(1,Math.floor(xs.length/(o.xn||5))); xs.forEach((d,i)=>{if(i%lab===0) s+='<text x="'+X(d)+'" y="'+(H-6)+'" text-anchor="middle">'+dnum(d)+'</text>'});
  ls.forEach(l=>{s+='<polyline fill="none" stroke="'+css(l.color)+'" stroke-width="'+(l.w||1.5)+'" points="'+l.pts.map(p=>X(p[0]).toFixed(1)+','+Y(p[1]).toFixed(1)).join(' ')+'"/>'});
  xs.forEach((d,i)=>{const l=ls[0], p=l.pts.find(q=>q[0]===d); if(!p) return; const w=iw/xs.length;
    s+='<rect class="hit" x="'+(X(d)-w/2)+'" y="'+m.t+'" width="'+w+'" height="'+ih+'" fill="transparent" data-tip="'+dshort(d)+' · '+(o.tfmt?o.tfmt(p[1]):p[1])+'"/>'});
  el.insertAdjacentHTML('afterbegin',s+'</svg>'); }); }

/* Heat table: rows=[{name,cells:[n]}], cols=[labels] */
function heat(id,rows,cols,o={}){ const el=document.getElementById(id); if(!el) return;
  const mx=Math.max(...rows.flatMap(r=>r.cells.map(Math.abs)));
  const col=v=>{const a=Math.round(Math.min(1,Math.abs(v)/mx)*70); return 'background:color-mix(in srgb,var('+(v<0?'--neg':'--pos')+') '+a+'%,var(--surface))'};
  el.innerHTML='<div class="tw"><table class="tbl"><thead><tr><th>'+(o.first||'Sector')+'</th>'+cols.map(c=>'<th class="n">'+c+'</th>').join('')+(o.extra?'<th class="n">'+o.extra+'</th>':'')+'</tr></thead><tbody>'+
   rows.map(r=>'<tr><td>'+r.name+'</td>'+r.cells.map(v=>'<td class="n num" style="'+col(v)+'">'+inr(v,{sign:true})+'</td>').join('')+(o.extra?'<td class="n num">'+(r.extra||'')+'</td>':'')+'</tr>').join('')+'</tbody></table></div>'; }

window.ICTUI={shell,bars,lines,heat,calc,rerender};
})();

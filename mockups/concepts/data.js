// Sample data for the concept mockups. Headline figures are from the live tracker as of 26-Nov-26; the daily series is illustrative.
window.D={
 asof:"26-Nov-26",
 ticks:[["FPI net, 26-Nov","+3,790","pos","₹ cr"],["Nov MTD","+1,53,624","pos","₹ cr"],["FYTD","+40,529","pos","₹ cr"],["USD/INR","93.3461","","FBIL"],["FX reserves","705,342","","US$ mn"],["G-sec limit used","16.74%","","CCIL"]],
 seg:[["Equity",2981,39079,145308,-34843],["Debt (general, VRR, FAR)",817,1440,7614,691],["Hybrid",8,27,-89,-297],["Mutual funds",-16,662,800,9975],["AIFs",0,0,-9,0],["Total",3790,41208,153624,-24475]],
 daily:[-9200,-9800,-3900,-900,-2600,-15000,-4400,-300,-2100,1300,-600,5200,2200,2400,-3100,2900,600,9400,3300,-200,3400,4200,6000,10000,19500,16800,7000,15500,10000,5200,2000,12600,7800,8500,11800,9000,3800],
 dlabels:["01 Oct","","","","","","","","","","","","","","","","","","","","","","","","06 Nov","","","","","","","","","","","","26 Nov"],
 deals:[["MEDANTA","DUNEARN INVESTMENTS (MAU…","SELL",604.5],["APLAPOLLO","GRAVITON RESEARCH CAPITAL","SELL",510.9],["APLAPOLLO","GRAVITON RESEARCH CAPITAL","BUY",510.8],["APLAPOLLO","SMALLCAP WORLD FUND INC","SELL",433.6],["MEDANTA","HDFC MUTUAL FUND","BUY",418.0],["THOMASCOOK","QE SECURITIES LLP","SELL",81.9]],
 fiidii:[["25-Nov",4479,4019],["23-Nov",5673,-2760],["20-Nov",10308,-4860],["19-Nov",7411,-1357],["18-Nov",5867,-3160]],
 limits:[["G-sec, general route",477006,78813,16.74],["SDL, general route",164242,2820,1.72],["Corp bonds, general + VRR",991392,269497,27.18]],
 near:[["HEALTHY INVESTMENTS",9.97,10],["HEXA TRADEX",9.69,10],["APOLLO INGREDIENTS",9.62,10]],
 news:[["SEBI","Framework for trusted foreign investors (SWAGAT-FI) updated for FPIs","Regulation"],["Deal","Block trade: foreign funds sell ₹604 cr of Medanta in a day","Flows"],["GIFT","IFSC fund registrations rise as managers onshore to Gujarat","GIFT City"],["RBI","FX reserves rise week on week; rupee steady near 93.35","Macro"]],
 corr:[["Mauritius",38],["Singapore",24],["United States",19],["Luxembourg",9],["Cayman Is.",6],["Other",4]],
 sect:[["Financials",41],["Healthcare",18],["Capital goods",14],["IT",-9],["Autos",11],["Energy",-6]]
};
window.fmt=n=>{const a=Math.abs(n),s=String(Math.round(a));let o=s.length>3?s.slice(0,-3).replace(/\B(?=(\d{2})+(?!\d))/g,",")+","+s.slice(-3):s;return (n<0?"−":(n>0?"+":""))+o};
window.bars=(el,vals,o={})=>{const w=o.w||900,h=o.h||200,p=22,m=Math.max(...vals.map(Math.abs));const bw=(w-p*2)/vals.length;let s=`<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">`;const z=h/2;s+=`<line x1="${p}" x2="${w-p}" y1="${z}" y2="${z}" stroke="${o.ax||'#888'}" stroke-width=".6"/>`;vals.forEach((v,i)=>{const bh=Math.abs(v)/m*(h/2-8);s+=`<rect x="${p+i*bw+1}" y="${v>=0?z-bh:z}" width="${bw-2}" height="${bh}" fill="${v>=0?(o.pos||'#0b7a4b'):(o.neg||'#b3261e')}" rx="${o.r||0}"/>`});el.innerHTML=s+"</svg>"};

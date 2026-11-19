/* Receives watchlist alerts when no page of the site is open. It only shows notifications; it does not cache or intercept anything. */
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('push',e=>{
  let d={}; try{ d=e.data?e.data.json():{} }catch(x){}
  const title=String(d.title||'Watchlist update').slice(0,100), body=String(d.body||'').slice(0,240);
  e.waitUntil(self.registration.showNotification(title,{body,tag:String(d.tag||'ict-watch').slice(0,60),icon:'/icon-192.png',data:{url:String(d.url||'watchlist.html')}}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  let u; try{ u=new URL((e.notification.data&&e.notification.data.url)||'watchlist.html',self.registration.scope) }catch(x){ u=new URL('watchlist.html',self.registration.scope) }
  if(u.origin!==self.location.origin) u=new URL('watchlist.html',self.registration.scope);      // never open another site from a notification
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{ for(const c of cs){ if(c.url===u.href&&'focus' in c) return c.focus() } return self.clients.openWindow(u.href) }));
});

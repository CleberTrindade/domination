/* Presentation-only camera. Orders and simulation keep original world coordinates. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DOMINATION_BATTLE_CAMERA=api;})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 function clamp(c,W,H,w,h){const hw=w/(2*c.zoom),hh=h/(2*c.zoom);c.x=hw>=W/2?W/2:Math.max(hw,Math.min(W-hw,c.x));c.y=hh>=H/2?H/2:Math.max(hh,Math.min(H-hh,c.y));return c;}
 function configure(g,w,h){const W=g.L.W,H=g.L.H,fit=Math.min(w/W,h/H)*.94,base=Math.min(w/W*(g.L.geometry.side||1.4),h/H*(g.L.geometry.overflow||1.7));
  if(!g.camera){const home=g.sites.find(s=>s.owner===g.me&&s.hq)||g.sites.find(s=>s.owner===g.me);g.camera={x:home?.x??W/2,y:home?.y??H/2,zoom:base};}
  g.camera.base=base;g.camera.fit=fit;g.camera.zoom=Math.max(fit,Math.min(base*1.7,g.camera.zoom));clamp(g.camera,W,H,w,h);
  return {scale:g.camera.zoom,x:w/2-g.camera.x*g.camera.zoom,y:h/2-g.camera.y*g.camera.zoom};
 }
 function pan(g,dx,dy,w,h){if(!g?.camera)return;g.camera.x-=dx/g.camera.zoom;g.camera.y-=dy/g.camera.zoom;clamp(g.camera,g.L.W,g.L.H,w,h);g.dirty=true;}
 function zoom(g,factor,w,h){if(!g?.camera)return;g.camera.zoom=Math.max(g.camera.fit,Math.min(g.camera.base*1.7,g.camera.zoom*factor));clamp(g.camera,g.L.W,g.L.H,w,h);g.dirty=true;}
 function focus(g,all,w,h){if(!g?.camera)return;const home=g.sites.find(s=>s.owner===g.me&&s.hq)||g.sites.find(s=>s.owner===g.me);g.camera.x=all||!home?g.L.W/2:home.x;g.camera.y=all||!home?g.L.H/2:home.y;g.camera.zoom=all?g.camera.fit:g.camera.base;clamp(g.camera,g.L.W,g.L.H,w,h);g.dirty=true;}
 return {configure,pan,zoom,focus,clamp};
});

/* Domination: shared 3D models for the collection and cached battle sprites. */
(function(root,factory){
  'use strict';
  const art=factory();
  if(typeof module==='object'&&module.exports)module.exports=art;
  else{root.DOMINATION_TROOP_ART=art;if(root.DSPR)art.install(root.DSPR);}
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const K=.6,TAU=Math.PI*2,INK='#253249';
  const TEAMS=[['#5c6478','#7a849a','#9ba7ba','#bec8d6','#dce3ec','#f4f7fc'],['#183b76','#284e89','#3965a6','#4c7cbc','#719bd1','#a6c8ed'],['#78252b','#a2373d','#c7474d','#df6668','#f58f8c','#ffd0c5'],['#285e36','#3d8245','#55a252','#78bd69','#a6db8a','#d9f4bf'],['#665088','#8864a9','#a77ec4','#be9bda','#d8bce9','#f1e0fa']];
  const RAMPS={steel:['#495469','#677389','#8c99ad','#b0bdcf','#d5deeb','#f4f7fc'],rubber:['#111b2c','#1c293d','#29374b','#3a4960','#536078','#6b778e'],glass:['#1e597e','#267ca4','#36a5cb','#6fcae4','#a5e4f3','#e1faff'],lamp:['#ba8024','#d79c35','#edb743','#ffcf61','#ffe49a','#fff6d5'],white:['#9daec2','#bdcadb','#d5deec','#edf2fa','#f8fbff','#ffffff']};
  const norm=v=>{const n=Math.hypot(...v)||1;return v.map(x=>x/n);};
  const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),sub=(a,b)=>a.map((x,i)=>x-b[i]);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const CAMERA=norm([0,1,K]),LIGHT=norm([-.5,-.65,1.2]);
  const project=p=>[p[0],p[1]*K-p[2]],num=v=>Number(v.toFixed(2));
  const face=(pts,col)=>({pts,col});
  function mesh(faces,c,layer=0,outline=true){return{faces,c,layer,outline};}
  function box(c,size,col,layer=0){
    const [x,y,z]=c,[a,b,h]=size.map(v=>v/2),p=(i,j,k)=>[x+i*a,y+j*b,z+k*h];
    return mesh([
      face([p(1,-1,-1),p(1,1,-1),p(1,1,1),p(1,-1,1)],col),
      face([p(-1,1,-1),p(-1,-1,-1),p(-1,-1,1),p(-1,1,1)],col),
      face([p(1,1,-1),p(-1,1,-1),p(-1,1,1),p(1,1,1)],col),
      face([p(-1,-1,-1),p(1,-1,-1),p(1,-1,1),p(-1,-1,1)],col),
      face([p(-1,-1,1),p(1,-1,1),p(1,1,1),p(-1,1,1)],col)
    ],c,layer);
  }
  function cylinder(c,axis,r,length,col,layer=0,n=12,cap=col,ry=r){
    axis=norm(axis);const u=norm(cross(axis,Math.abs(axis[2])>.9?[1,0,0]:[0,0,1])),v=cross(axis,u);
    const ring=sign=>Array.from({length:n},(_,i)=>{const a=i/n*TAU;return c.map((x,d)=>x+sign*axis[d]*length/2+u[d]*Math.cos(a)*r+v[d]*Math.sin(a)*ry);});
    const a=ring(-1),b=ring(1),f=a.map((p,i)=>face([p,a[(i+1)%n],b[(i+1)%n],b[i]],col));
    f.push(face(b,cap),face(a.slice().reverse(),cap));return mesh(f,c,layer);
  }
  function armor(c,size,col,layer=0,inset=1.3){
    const [x,y,z]=c,[w,d,h]=size.map(v=>v/2);
    const ring=(a,b,zz)=>[[-a,-b],[a,-b],[a,b],[-a,b]].map(([xx,yy])=>[x+xx,y+yy,zz]);
    const bottom=ring(w,d,z-h),shoulder=ring(w,d,z+h-Math.min(inset,h*.6)),top=ring(w-inset,d-inset,z+h);
    return mesh([face(top,col),...bottom.map((p,i)=>face([p,bottom[(i+1)%4],shoulder[(i+1)%4],shoulder[i]],col)),...shoulder.map((p,i)=>face([p,shoulder[(i+1)%4],top[(i+1)%4],top[i]],col))],c,layer);
  }
  function octagon(z,r,height,topRadius,col,layer=0){
    const ring=(radius,zz)=>Array.from({length:8},(_,i)=>{const a=(i+.5)/8*TAU;return[Math.cos(a)*radius,Math.sin(a)*radius,zz];});
    const a=ring(r,z),b=ring(topRadius,z+height);
    return mesh([face(b,col),...a.map((p,i)=>face([p,a[(i+1)%8],b[(i+1)%8],b[i]],col))],[0,0,z+height/2],layer);
  }
  function star(c,u,v,r,layer){
    const pts=Array.from({length:10},(_,i)=>{const a=Math.PI/2+i/10*TAU,s=i%2?r*.44:r;return c.map((x,d)=>x+Math.cos(a)*s*u[d]+Math.sin(a)*s*v[d]);});
    const mark=face(pts,'white');mark.normal=cross(u,v);return mesh([mark],c,layer,false);
  }
  function rotate(part,h){const co=Math.cos(h),si=Math.sin(h),r=p=>[p[0]*co-p[1]*si,p[0]*si+p[1]*co,p[2]];return{...part,c:r(part.c),faces:part.faces.map(f=>({...f,normal:f.normal?r(f.normal):null,pts:f.pts.map(r)}))};}
  const MODEL={};
  // Standard tank: armored hull, separate wheels and track pads, hatch and barrel.
  MODEL.tanque=[];
  for(const side of [-1,1]){
    MODEL.tanque.push(box([0,side*7.7,3.1],[28,4.6,6.2],'rubber'));
    for(const x of [-10,-5,0,5,10])MODEL.tanque.push(cylinder([x,side*10.1,3.2],[0,1,0],2.15,.7,'steel',1,10));
    for(const x of [-11,-5.5,0,5.5,11])MODEL.tanque.push(box([x,side*7.7,6.35],[3.8,4.7,.55],'steel',1));
  }
  MODEL.tanque.push(armor([0,0,7.4],[27,18,5.2],'team',2,1.8),box([-7,0,10.1],[5,8,.5],'rubber',3),armor([-1,0,12.4],[13,12,6],'team',3,1.2));
  for(const y of [-4.8,4.8]){
    MODEL.tanque.push(box([6.9,y,12.5],[1.3,2.8,4.3],'steel',4));
    MODEL.tanque.push(box([10.7,y*1.55,9.3],[2,2,1],'lamp',3));
  }
  MODEL.tanque.push(cylinder([12.3,0,12.7],[1,0,0],1.8,13,'steel',4,12),cylinder([19,0,12.7],[1,0,0],2.3,1.4,'steel',4,12,'rubber'),cylinder([-2,0,16],[0,0,1],3.1,.8,'steel',4),box([-2,0,17],[4.5,3,1.4],'rubber',5),box([.3,0,17],[.3,2.3,.8],'lamp',6));
  for(const sign of [-1,1])MODEL.tanque.push(star([-4,sign*8.8,7.8],[-sign,0,0],[0,0,1],2,4));
  // Hovercraft: inflated skirt, segmented perimeter, cyan cockpit and ring fan.
  MODEL.desliz=[cylinder([0,0,2.1],[0,0,1],15,4.2,'rubber',0,20,'rubber',9.5),cylinder([0,0,4.7],[0,0,1],14.1,1.5,'steel',1,20,'steel',8.9)];
  for(let i=0;i<12;i++){const a=i/12*TAU;MODEL.desliz.push(cylinder([Math.cos(a)*14,Math.sin(a)*8.7,4.9],[0,0,1],.48,.6,'rubber',2,6));}
  MODEL.desliz.push(armor([2,0,8.1],[13,10,5.6],'team',2,1.4),box([8,0,8.9],[.6,6.8,2.6],'glass',3));
  for(const sign of [-1,1])MODEL.desliz.push(box([2,sign*4.3,9.1],[5.5,.5,2.5],'glass',3),box([8.7,sign*5.7,5.9],[1.5,1.6,1.2],'lamp',3));
  MODEL.desliz.push(box([-9,0,7],[3,2.5,6],'steel',2),cylinder([-10,0,11],[1,0,0],6,2.4,'steel',3,16,'rubber'),cylinder([-8.7,0,11],[1,0,0],4.8,.25,'rubber',4,16));
  for(const a of [0,Math.PI/3,2*Math.PI/3]){
    const blade=box([-8.45,0,11],[.35,8.7,1.1],'steel',5);
    const co=Math.cos(a),si=Math.sin(a),r=p=>[p[0],p[1]*co-(p[2]-11)*si,11+p[1]*si+(p[2]-11)*co];
    MODEL.desliz.push({...blade,faces:blade.faces.map(f=>({...f,pts:f.pts.map(r)}))});
  }
  MODEL.desliz.push(cylinder([-8.1,0,11],[1,0,0],1.3,.8,'steel',6,10),box([2,0,11.7],[3,3,1.4],'rubber',4),cylinder([4.6,0,12],[1,0,0],.7,4.6,'steel',5,8));
  for(const sign of [-1,1])MODEL.desliz.push(star([1,sign*5.1,7.2],[-sign,0,0],[0,0,1],1.7,4));
  // Helicopter body uses the existing lift and animated rotor attachment height.
  MODEL.heli=[];
  for(const y of [-4.8,4.8]){
    MODEL.heli.push(box([1,y,1],[19,1.3,1.3],'steel'));
    for(const x of [-4,5])MODEL.heli.push(box([x,y,3.2],[1,1,4],'steel'));
  }
  MODEL.heli.push(cylinder([0,0,9.4],[1,0,0],5.8,13,'team',1,12,'glass'),armor([1,0,9.1],[15,10,8],'team',2,1.2),box([7.2,0,10],[.65,6.7,4.8],'glass',3));
  for(const sign of [-1,1])MODEL.heli.push(box([3.3,sign*4.2,11],[5,.5,3.7],'glass',3),box([-3.7,sign*4.8,8.2],[.65,.4,5.3],'steel',3),star([-1.1,sign*5.1,8.9],[-sign,0,0],[0,0,1],2,4));
  MODEL.heli.push(box([-14.5,0,10.2],[16,2.3,2.4],'team',1),box([-21.5,0,13],[4.5,1.1,7.8],'team',2),box([-17.3,0,10],[3,8,.9],'steel',2),cylinder([-21.6,1.2,13.7],[0,1,0],2.8,.4,'steel',3,10),box([-21.6,1.6,13.7],[.65,.5,7],'rubber',4),box([-21.6,1.65,13.7],[6,.5,.65],'rubber',4),box([0,0,15.4],[6,5,2.5],'rubber',4),cylinder([0,0,17.1],[0,0,1],1.1,1.4,'steel',5,10),box([6.8,-3,7],[1.1,1.4,1.1],'lamp',4),box([6.8,3,7],[1.1,1.4,1.1],'lamp',4));
  // The cannon is split into a stationary mount and a genuinely rotating turret.
  MODEL.cannonBase=[octagon(0,16,5,13.4,'team'),cylinder([0,0,5.5],[0,0,1],10.6,1.7,'steel',1,16),cylinder([0,0,6.5],[0,0,1],8.8,.7,'rubber',2,16)];
  for(const x of [-7,7])MODEL.cannonBase.push(box([x,10.5,3.2],[3,.7,1.8],'steel',1),box([x,-10.5,3.2],[3,.7,1.8],'steel',1));
  MODEL.turret=[cylinder([0,0,7.2],[0,0,1],7.6,2,'steel',0,16),armor([0,0,10.8],[13,12,7],'team',1,1.4),box([5.7,-4,11],[1.2,2.3,4],'steel',2),box([5.7,4,11],[1.2,2.3,4],'steel',2)];
  const PITCH=.29,GUN_AXIS=[Math.cos(PITCH),0,Math.sin(PITCH)],GUN_ORIGIN=[5.7,0,11.1];
  const gunPoint=d=>GUN_ORIGIN.map((x,i)=>x+GUN_AXIS[i]*d);
  MODEL.turret.push(cylinder(gunPoint(5.2),GUN_AXIS,2.4,10.4,'steel',2,12),cylinder(gunPoint(10.8),GUN_AXIS,2.8,1.1,'steel',3,12,'rubber'),box([-2,0,15.1],[4,3,1.2],'rubber',2),box([.1,0,15.2],[.4,2.3,.8],'lamp',3));
  for(const sign of [-1,1])MODEL.turret.push(star([-1,sign*5.9,10.8],[-sign,0,0],[0,0,1],2.1,3));
  MODEL.central=[octagon(0,19,7,15.8,'team'),octagon(7,15.8,3,12.7,'team',1),cylinder([0,0,10.5],[0,0,1],6.3,1.6,'steel',2,16),cylinder([0,0,11.5],[0,0,1],4.8,.5,'steel',3,12)];
  const CENTRAL_GUNS=[0,45,135,180,225,315].map(deg=>{
    const h=deg/180*Math.PI,co=Math.cos(h),si=Math.sin(h),m=project([23.5*co,23.5*si,8.8]);
    const parts=[armor([15.7,0,7.7],[5.5,5.1,4.5],'team',2,.5),box([18.3,0,8.2],[1.4,4.7,4.2],'steel',3),cylinder([20.7,0,8.8],[1,0,0],1.65,5.6,'steel',3,10,'rubber'),box([15.5,0,10.2],[2.3,2.1,.6],'lamp',3)];
    MODEL.central.push(...parts.map(p=>rotate(p,h)));
    return{deg,mx:m[0],my:m[1]};
  });
  MODEL.central.push(box([0,15.8,3.5],[5,.5,2],'rubber',1),star([0,16.1,5.2],[-1,0,0],[0,0,1],2.2,2));
  const geometryCache=new Map(),svgCache=new Map(),cardCache=new Map();
  function convex(points){
    const pts=points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]),cr=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const lo=[],up=[];for(const p of pts){while(lo.length>1&&cr(lo.at(-2),lo.at(-1),p)<=0)lo.pop();lo.push(p);}
    for(const p of pts.slice().reverse()){while(up.length>1&&cr(up.at(-2),up.at(-1),p)<=0)up.pop();up.push(p);}return lo.slice(0,-1).concat(up.slice(0,-1));
  }
  const path=pts=>'M'+pts.map(p=>num(p[0])+' '+num(p[1])).join('L')+'Z';
  function geometry(key,h){
    const cacheKey=key+':'+h.toFixed(6);if(geometryCache.has(cacheKey))return geometryCache.get(cacheKey);
    const parts=MODEL[key].map(p=>rotate(p,h)).sort((a,b)=>a.layer-b.layer||dot(a.c,CAMERA)-dot(b.c,CAMERA)),out=[];
    for(const part of parts){
      const faces=[];
      for(const f of part.faces){const n=norm(f.normal||cross(sub(f.pts[1],f.pts[0]),sub(f.pts[2],f.pts[0])));if(dot(n,CAMERA)<=.001)continue;
        faces.push({d:path(f.pts.map(project)),col:f.col,tone:Math.min(5,Math.max(0,Math.floor((.48+.5*dot(n,LIGHT))*6)))});
      }
      if(faces.length)out.push({outline:part.outline?path(convex(part.faces.flatMap(f=>f.pts.map(project)))):null,faces});
    }
    // Battle headings are quantized; never keep unbounded previews in memory.
    if(geometryCache.size>320)geometryCache.clear();geometryCache.set(cacheKey,out);return out;
  }
  function model(key,owner,h=0){
    owner=TEAMS[owner]?owner:0;h=((h%TAU)+TAU)%TAU;const cacheKey=key+':'+owner+':'+h.toFixed(6);
    if(svgCache.has(cacheKey))return svgCache.get(cacheKey);
    const parts=geometry(key,h),prefix='a'+key+owner+h.toFixed(6).replace('.',''),gradients=new Map();
    for(const p of parts)for(const f of p.faces){
      const id=f.col+f.tone;if(gradients.has(id))continue;
      const ramp=f.col==='team'?TEAMS[owner]:RAMPS[f.col],tone=f.tone;
      gradients.set(id,'<linearGradient id="'+prefix+id+'" x2=".6" y2="1"><stop stop-color="'+ramp[Math.min(5,tone+1)]+'"/><stop offset=".3" stop-color="'+ramp[tone]+'"/><stop offset="1" stop-color="'+ramp[Math.max(0,tone-1)]+'"/></linearGradient>');
    }
    const out='<defs>'+[...gradients.values()].join('')+'</defs>'+parts.map(p=>(p.outline?'<path d="'+p.outline+'" fill="'+INK+'" stroke="'+INK+'" stroke-width=".55" stroke-linejoin="round"/>':'')+p.faces.map(f=>'<path d="'+f.d+'" fill="url(#'+prefix+f.col+f.tone+')" stroke="'+(p.outline?'#34425b':'none')+'" stroke-opacity=".4" stroke-width=".12" stroke-linejoin="round"/>').join('')).join('');
    if(svgCache.size>1100)svgCache.clear();svgCache.set(cacheKey,out);return out;
  }
  const shadow=(r=17)=>'<ellipse cy="1" rx="'+r+'" ry="'+r*K+'" fill="#172e52" opacity=".2"/>';
  function rotor(t,lift){
    const z=17.8+lift,out=['<ellipse cy="'+(-z)+'" rx="19" ry="11.4" fill="#fff" opacity=".2"/>'];
    for(const b of [0,Math.PI/2]){const a=t*24+b,x=Math.cos(a)*19,y=Math.sin(a)*19*K;out.push('<path d="M'+num(x)+' '+num(y-z)+'L'+num(-x)+' '+num(-y-z)+'" stroke="#384459" stroke-width="2" stroke-linecap="round"/>');}return out.join('');
  }
  function unit3d(kind,owner,h=0,t=0,scale=1,opt={}){
    if(!['tanque','desliz','heli'].includes(kind))return'';
    const lift=opt.lift??(kind==='heli'?12+Math.sin(t*5)*1.5:kind==='desliz'?1+Math.sin(t*6)*.6:0);
    return'<g transform="scale('+scale+')">'+(opt.noShadow?'':shadow(kind==='heli'?12:17))+'<g transform="translate(0 '+num(-lift)+')">'+model(kind,owner,h)+'</g>'+(kind==='heli'&&!opt.noRotor?rotor(t,lift):'')+'</g>';
  }
  function turret(owner,h=0,slide=0){return'<g transform="translate('+num(-Math.cos(h)*slide)+' '+num(-Math.sin(h)*K*slide)+')">'+model('turret',owner,h)+'</g>';}
  function turretMuzzle(h){const p=gunPoint(11.35),co=Math.cos(h),si=Math.sin(h);return project([p[0]*co-p[1]*si,p[0]*si+p[1]*co,p[2]]);}
  function building(kind,owner,scale=1,opt={}){
    let svg='';
    if(kind==='central')svg=shadow(23)+model('central',owner,0);
    if(kind==='canhao'){
      const base=shadow(19)+model('cannonBase',owner,0),top='<g transform="translate(0 -1)">'+turret(owner,opt.h??Math.PI*.85,opt.slide||0)+'</g>';
      svg=opt.part==='base'?base:opt.part==='turret'?top:base+top;
    }
    return'<g transform="scale('+scale+')">'+svg+'</g>';
  }
  function card(kind){
    if(cardCache.has(kind))return cardCache.get(kind);
    const crops={tanque:[155,215,515,265],desliz:[862,215,515,265],heli:[140,617,495,280],canhao:[915,625,480,275],central:[55,355,1150,650]},crop=crops[kind];
    if(!crop)return'';
    const central=kind==='central',cutouts={tanque:[600,355],desliz:[1365,355],heli:[600,750],canhao:[1365,760]},cut=cutouts[kind];
    const [x,y,w,h]=crop,clip=cut?'<defs><clipPath id="portrait-'+kind+'"><path d="M'+x+' '+y+'H'+cut[0]+'V'+cut[1]+'H'+(x+w)+'V'+(y+h)+'H'+x+'Z"/></clipPath></defs>':'';
    const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="'+crop.join(' ')+'" aria-hidden="true" class="w-troop-art" data-art="concept-3d" overflow="hidden">'+clip+'<image '+(cut?'clip-path="url(#portrait-'+kind+')" ':'')+'href="/art/'+(central?'central-v1.png':'troops-initial-v1.png')+'" width="'+(central?1254:1536)+'" height="'+(central?1254:1024)+'"/></svg>';
    cardCache.set(kind,svg);return svg;
  }
  function install(D){
    if(D.artVersion==='concept-3d')return;
    const previous=D.S.building;
    D.S.building=(kind,owner,scale=1,opt={})=>['canhao','central','bomb'].includes(kind)?building(kind==='bomb'?'central':kind,owner,scale,opt):previous(kind,owner,scale,opt);
    D.S.CGUN=CENTRAL_GUNS;D.U3.unit3d=unit3d;D.U3.turret=turret;D.U3.turretMuzzle=turretMuzzle;D.artVersion='concept-3d';
  }
  return{unit3d,building,turret,turretMuzzle,card,install,centralGuns:CENTRAL_GUNS};
});

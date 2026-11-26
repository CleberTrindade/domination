'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {installBattleInput}=require('../public/battle-input');
function setup(mode='world'){
  const listeners={},pointers=new Map(),calls=[],captures=new Set();
  const sites=[{id:1,x:0,y:0,owner:1},{id:2,x:60,y:0,owner:1},{id:3,x:120,y:0,owner:1},{id:4,x:180,y:0,owner:2}];
  const game={mode,me:1,mine:mode==='local'?[1,2]:[1],sites,cd:0};
  const canvas={addEventListener:(name,fn)=>listeners[name]=fn,setPointerCapture:id=>captures.add(id),releasePointerCapture:id=>captures.delete(id)};
  installBattleInput({canvas,getGame:()=>game,toMap:e=>({x:e.clientX,y:e.clientY}),hit:p=>sites.find(s=>Math.hypot(s.x-p.x,s.y-p.y)<18),playable:g=>!g.over&&!g.paused&&g.cd<=0,pointers,
    send:(owner,sources,target)=>{calls.push({owner,sources:sources.map(s=>s.id),target:target.id});return !game.reject;},drop:(owner,site)=>calls.push({drop:site.id,owner}),spectate:id=>calls.push({spectate:id})});
  function event(type,x,y=0,id=1){listeners[type]({clientX:x,clientY:y,pointerId:id,button:0,preventDefault(){}});}
  const tap=(id,pointer=1)=>{const site=sites.find(s=>s.id===id);event('pointerdown',site.x,site.y,pointer);event('pointerup',site.x,site.y,pointer);};
  return {game,sites,event,tap,pointers,captures,calls};
}
test('taps select and toggle multiple friendly bases, and one completed target tap sends the entire selection once',()=>{
  const s=setup();s.tap(1);s.tap(2);assert.equal(s.calls.length,0);assert.equal(s.game.selectedSites.size,2);
  s.tap(2);assert.equal(s.game.selectedSites.size,1);s.tap(3);s.tap(2);
  s.event('pointerdown',180);assert.equal(s.calls.length,0,'a down event must not dispatch an order');
  s.event('pointerup',180);assert.deepEqual(s.calls,[{owner:1,sources:[1,3,2],target:4}]);assert.equal(s.game.selectedSites.size,0);assert.equal(s.pointers.size,0);assert.equal(s.captures.size,0);
  s.event('pointerup',180);assert.equal(s.calls.length,1,'duplicate release never sends twice');
});
test('a fast swipe collects friendly bases along the segment, and dragging to a friendly base still reinforces it',()=>{
  const s=setup();s.event('pointerdown',0);s.event('pointermove',180);s.event('pointerup',180);
  assert.deepEqual(s.calls,[{owner:1,sources:[1,2,3],target:4}]);
  s.event('pointerdown',0);s.event('pointermove',60);s.event('pointerup',60);
  assert.deepEqual(s.calls.at(-1),{owner:1,sources:[1],target:2});
});
test('multiple held fingers contribute their bases and releasing old fingers cannot restore an already sent selection',()=>{
  const s=setup();s.event('pointerdown',0,0,1);s.event('pointerdown',60,0,2);s.tap(4,3);
  assert.deepEqual(s.calls,[{owner:1,sources:[1,2],target:4}]);s.event('pointerup',0,0,1);s.event('pointerup',60,0,2);
  assert.equal(s.game.selectedSites.size,0);assert.equal(s.calls.length,1);
});
test('cancelled pointers, ownership changes, empty taps and rejected routes leave no stale or unauthorized commands',()=>{
  const s=setup();s.tap(1);s.event('pointerdown',60);s.event('pointercancel',60);assert.equal(s.pointers.size,0);assert.equal(s.captures.size,0);
  assert.deepEqual([...s.game.selectedSites].map(x=>x.id),[1]);
  s.sites[0].owner=2;s.tap(4);assert.equal(s.calls.length,0);assert.equal(s.game.selectedSites.size,0);
  s.tap(2);s.game.reject=true;s.tap(4);assert.equal(s.game.selectedSites.size,1,'keep sources selected when a route is refused');
  s.event('pointerdown',300);s.event('pointerup',300);assert.equal(s.game.selectedSites.size,0);
  s.game.cd=2;s.tap(2);assert.equal(s.pointers.size,0);assert.equal(s.calls.length,1);
});
test('spectators only open viewing options and local two-player gestures keep armies separate',()=>{
  const s=setup();s.game.me=0;s.game.mine=[];s.tap(1);assert.deepEqual(s.calls,[{spectate:1}]);
  const local=setup('local');local.event('pointerdown',0,0,1);local.event('pointerdown',180,0,2);
  local.event('pointermove',180,0,1);local.event('pointerup',180,0,1);local.event('pointermove',0,0,2);local.event('pointerup',0,0,2);
  assert.deepEqual(local.calls,[{owner:1,sources:[1,2,3],target:4},{owner:2,sources:[4],target:1}]);
});
test('the real hit target includes the building roof and ground anchor across viewport scales',()=>{
  const html=fs.readFileSync(require.resolve('../public/index.html'),'utf8'),source=html.slice(html.indexOf('function hit(m,'),html.indexOf('\nconst playable=',html.indexOf('function hit(m,')));
  for(const SC of [.5,1,1.5]){
    const site={x:100,y:150},context={game:{sites:[site,{x:200,y:150}]},SC};vm.createContext(context);vm.runInContext(source,context);
    assert.equal(context.hit({x:100,y:130}),site,'the visible roof fits inside the hex and is selectable');assert.equal(context.hit({x:100,y:150}),site);assert.equal(context.hit({x:114,y:163}),site);assert.equal(context.hit({x:0,y:0}),null);
  }
});
test('panning from empty water or move mode never dispatches troop orders',()=>{
 const handlers={},pointers=new Map(),orders=[],pans=[],sites=[{id:1,x:0,y:0,owner:1},{id:2,x:180,y:0,owner:2}],g={mode:'world',me:1,cd:0,L:{geometry:{scroll:true}},selectedSites:new Set([sites[0]])};
 const canvas={addEventListener:(type,fn)=>handlers[type]=fn,setPointerCapture(){},releasePointerCapture(){}};
 installBattleInput({canvas,getGame:()=>g,toMap:e=>({x:e.clientX,y:e.clientY}),hit:p=>sites.find(s=>Math.hypot(s.x-p.x,s.y-p.y)<18),playable:()=>true,pointers,send:(_owner,from,to)=>orders.push({from:from.map(s=>s.id),to:to.id}),drop(){},spectate(){},pan:(dx,dy)=>pans.push([dx,dy])});
 const event=(type,x,y=0)=>handlers[type]({clientX:x,clientY:y,pointerId:1,button:0,preventDefault(){}});
 event('pointerdown',40,60);event('pointermove',80,80);event('pointerup',80,80);assert.equal(orders.length,0);assert.equal(g.selectedSites.size,1);assert.deepEqual(pans,[[40,20]]);
 g.cameraMode=true;event('pointerdown',0);event('pointermove',180);event('pointerup',180);assert.equal(orders.length,0);
 g.cameraMode=false;event('pointerdown',0);event('pointermove',180);event('pointerup',180);assert.deepEqual(orders,[{from:[1],to:2}]);assert.equal(pointers.size,0);
});

function scrollingSetup(axis='x',hz=60){
 const camera=require('../public/battle-camera'),handlers={},pointers=new Map(),orders=[],captures=new Set(),rect={left:12,top:62,width:320,height:400};
 const sites=[80,160,430,570].map((value,i)=>({id:i+1,x:axis==='x'?value:160,y:axis==='y'?value:200,owner:i===3?2:1}));
 const game={mode:'world',me:1,cd:0,L:{W:1000,H:1000,geometry:{scroll:true,side:4,overflow:4}},sites,camera:{x:160,y:200,zoom:1}};
 let view=camera.configure(game,rect.width,rect.height),current=game;
 const canvas={addEventListener:(type,fn)=>handlers[type]=fn,setPointerCapture:id=>captures.add(id),releasePointerCapture:id=>captures.delete(id)};
 const input=installBattleInput({canvas,getGame:()=>current,toMap:e=>({x:(e.clientX-rect.left-view.x)/view.scale,y:(e.clientY-rect.top-view.y)/view.scale}),hit:p=>sites.find(s=>Math.hypot(s.x-p.x,s.y-p.y)<18),playable:g=>!g.over&&!g.paused&&g.cd<=0,pointers,
  send:(owner,from,target)=>orders.push({owner,from:from.map(s=>s.id),target:target.id}),drop(){},spectate(){},viewport:()=>rect,
  pan:(dx,dy)=>{camera.pan(game,dx,dy,rect.width,rect.height);view=camera.configure(game,rect.width,rect.height);}});
 const event=(type,x,y,id=1)=>handlers[type]({clientX:rect.left+x,clientY:rect.top+y,pointerId:id,button:0,preventDefault(){}});
 const start=()=>{event('pointerdown',sites[0].x,sites[0].y);event('pointermove',axis==='x'?315:160,axis==='y'?395:200);};
 const tick=(count=1)=>{for(let i=0;i<count;i++)input.update(1/hz);};
 return {game,sites,rect,event,start,tick,input,pointers,orders,captures,setGame:g=>current=g};
}
test('holding a selection at the right or bottom edge reveals and collects offscreen bases before one release command',()=>{
 for(const axis of ['x','y']){
  const s=scrollingSetup(axis),before=JSON.stringify(s.sites);s.start();assert.deepEqual(s.pointers.get(1).sel.map(b=>b.id),[1,2]);
  for(let i=0;i<120&&!s.pointers.get(1).sel.includes(s.sites[2]);i++)s.tick();
  assert(s.pointers.get(1).sel.includes(s.sites[2]),axis+' hidden friendly collected without pointermove');assert.equal(s.orders.length,0);
  for(let i=0;i<120&&s.pointers.get(1).ptr[axis]<565;i++)s.tick();
  assert.equal(JSON.stringify(s.sites),before,'scrolling changes no troops, sites or owners');
  s.event('pointerup',axis==='x'?315:160,axis==='y'?395:200);assert.deepEqual(s.orders,[{owner:1,from:[1,2,3],target:4}]);
  const camera=JSON.stringify(s.game.camera);s.tick(20);assert.equal(JSON.stringify(s.game.camera),camera);assert.equal(s.captures.size,0);
 }
});
test('selection edge scrolling supports every direction, diagonals and equivalent speed at 30, 60 and 144 Hz',()=>{
 for(const [x,y,sx,sy]of [[1,200,-1,0],[319,200,1,0],[160,1,0,-1],[160,399,0,1],[319,399,1,1],[1,1,-1,-1]]){
  const s=scrollingSetup();s.game.camera.x=s.game.camera.y=500;s.start();s.event('pointermove',x,y);const before={...s.game.camera};s.tick(5);
  assert.equal(Math.sign(s.game.camera.x-before.x),sx);assert.equal(Math.sign(s.game.camera.y-before.y),sy);
 }
 const distances=[30,60,144].map(hz=>{const s=scrollingSetup('x',hz);s.start();const before=s.game.camera.x;s.tick(hz/2);return s.game.camera.x-before;});
 assert(Math.max(...distances)-Math.min(...distances)<1e-8);
});
test('edge scrolling stops away from edges, at map bounds, on cancel, pause, ownership loss or battle replacement',()=>{
 const s=scrollingSetup();s.start();s.tick(8);s.event('pointermove',160,200);const still=s.game.camera.x;s.tick(10);assert.equal(s.game.camera.x,still);
 s.event('pointermove',319,200);s.tick(300);assert.equal(s.game.camera.x,840,'right boundary clamps at half the viewport');s.tick(10);assert.equal(s.game.camera.x,840);assert.equal(s.orders.length,0);
 for(const stop of [s=>s.event('pointercancel',315,200),s=>s.event('lostpointercapture',315,200),s=>s.input.clear(),s=>s.game.paused=true,s=>s.game.over=true,s=>s.game.cd=1,s=>s.game.me=0,s=>{s.sites.forEach(b=>b.owner=2);},s=>s.setGame({...s.game})]){
  const s=scrollingSetup();s.start();s.tick(3);stop(s);const before=JSON.stringify(s.game.camera);s.tick(10);assert.equal(JSON.stringify(s.game.camera),before);assert.equal(s.orders.length,0);
 }
});
test('edge scrolling excludes taps, spectators, drops, manual movement and non-scrolling modes; other fingers keep their sources',()=>{
 for(const change of [s=>s.game.me=0,s=>s.game.dropMode=true,s=>s.game.cameraMode=true,s=>s.game.L.geometry.scroll=false,s=>s.game.mode='cpu']){
  const s=scrollingSetup();change(s);s.start();const before=JSON.stringify(s.game.camera);s.tick(10);assert.equal(JSON.stringify(s.game.camera),before);assert.equal(s.orders.length,0);
 }
 const s=scrollingSetup();s.event('pointerdown',80,200);s.tick(10);assert.equal(s.game.camera.x,160,'tap alone never scrolls');
 s.event('pointerdown',160,200,2);s.event('pointermove',315,200);s.tick(30);assert(s.pointers.get(1).sel.includes(s.sites[2]));assert(s.pointers.get(2).sel.includes(s.sites[1]));assert.equal(s.orders.length,0);
 s.input.clear();assert.equal(s.pointers.size,0);assert.equal(s.captures.size,0);
});

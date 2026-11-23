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
    assert.equal(context.hit({x:100,y:110}),site,'the visible roof is selectable');assert.equal(context.hit({x:100,y:150}),site);assert.equal(context.hit({x:114,y:163}),site);assert.equal(context.hit({x:0,y:0}),null);
  }
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {createWorldMotion}=require('../public/world-motion');
const {createBattle}=require('../server/battle-engine');
const route=[[0,0],[10,0],[10,20]],cum=[0,10,30];
function unit(d,id=1){
  return {id,P:route,cum,L:30,d,si:d>10?1:0,x:Math.min(10,d),y:Math.max(0,d-10),n:20,fighting:null};
}
const near=(actual,expected)=>assert(Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);

test('200ms snapshots produce continuous movement at different display refresh rates',()=>{
  for(const hz of [30,60,144]){
    const motion=createWorldMotion();
    motion.receive([unit(0)],0,0);
    for(let packet=1;packet<=4;packet++){
      const units=[unit(packet*5)],at=packet*200,before=JSON.stringify(units);
      motion.receive(units,packet*.2,at);
      for(let frame=0;frame<hz*.2;frame++){
        const elapsed=frame*1000/hz,visual=motion.sample(units,at+elapsed).units[0];
        near(visual.d,(packet-1)*5+5*elapsed/200);
        // A turn must follow the route instead of cutting diagonally across land/water.
        near(visual.x,Math.min(10,visual.d));near(visual.y,Math.max(0,visual.d-10));
      }
      assert.equal(JSON.stringify(units),before,'rendering must not mutate server data');
    }
  }
});

test('packet jitter stays continuous, network stalls never extrapolate, reconnect snaps safely',()=>{
  const motion=createWorldMotion();
  motion.receive([unit(0)],0,0);
  motion.receive([unit(10)],.2,200);
  const previous=motion.sample([unit(10)],350).units[0].d;
  motion.receive([unit(20)],.4,350);
  near(motion.sample([unit(20)],350).units[0].d,previous);
  near(motion.sample([unit(20)],900).units[0].d,20);
  motion.receive([unit(25)],2,2000);
  near(motion.sample([unit(25)],2000).units[0].d,25);
  motion.receive([unit(5)],.1,2200);
  near(motion.sample([unit(5)],2200).units[0].d,5);
});

test('combat references use visual positions; removed units disappear and final positions snap',()=>{
  const motion=createWorldMotion();
  const enemies=[unit(0),unit(20,2)];
  motion.receive(enemies,0,0);
  const fighting=[{...unit(10),fighting:2},{...unit(15,2),fighting:1}];
  motion.receive(fighting,.2,200);
  const view=motion.sample(fighting,300);
  assert.equal(view.units[0].fight.b,view.units[1]);
  assert.equal(view.byId.get(1),view.units[0]);
  near(view.units[0].x,5);
  view.units[0].vh=1.2;
  assert.equal(motion.sample(fighting,310).units[0].vh,1.2,'preserve animated headings');
  motion.receive([fighting[0]],.4,400,true);
  const final=motion.sample([fighting[0]],400);
  near(final.units[0].d,10);assert.equal(final.units[0].fight,null);
  assert.equal(final.byId.has(2),false);
});

test('real combat snapshots animate without changing authoritative units or battle outcomes',()=>{
  const battle=createBattle({seed:17});
  for(let i=0;i<61;i++)battle.step(.05);
  assert(battle.command({type:'send',sources:[4],target:0}));
  const motion=createWorldMotion();
  let previous;
  for(let packet=0;packet<8;packet++){
    const snapshot=battle.snapshot(),original=JSON.stringify(snapshot);
    motion.receive(snapshot.units,snapshot.time,packet*200);
    for(let frame=0;frame<12;frame++){
      const view=motion.sample(snapshot.units,packet*200+frame*1000/60);
      for(const visual of view.units){
        assert(Number.isFinite(visual.x)&&Number.isFinite(visual.y));
        assert(visual.d<=snapshot.units.find(u=>u.id===visual.id).d);
      }
      if(packet===1&&frame>0){assert(view.units[0].d>previous);}
      previous=view.units[0]?.d;
    }
    assert.equal(JSON.stringify(snapshot),original);
    assert.deepEqual(battle.snapshot(),snapshot);
    for(let i=0;i<4;i++)battle.step(.05);
  }
});

test('browser entry exposes the motion factory before the game renderer starts',()=>{
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/world-motion'),'utf8'),context);
  assert.equal(typeof context.window.createWorldMotion,'function');
});
test('immediate command confirmations do not restart in-flight motion',()=>{
  const motion=createWorldMotion();motion.receive([unit(0)],0,0);
  motion.receive([unit(10)],.1,100);
  motion.receive([unit(10)],.1,150);
  near(motion.sample([unit(10)],175).units[0].d,7.5);
  near(motion.sample([unit(10)],200).units[0].d,10);
});

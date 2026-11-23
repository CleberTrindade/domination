'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs');
const factory=require('../server/battle-engine'),rules=require('../shared/troop-rules');
const {browserEngine}=require('../server/browser-assets');
const version=rules.COMBAT_VERSION;
function idle(config={}){
  const saved=factory.createBattle({...config,combatVersion:config.combatVersion??version}).checkpoint();saved.cd=0;saved.time=10;
  for(const base of saved.sites)base.cd=1000;
  for(const ai of saved.ais)ai.timer=1000;
  for(const side of Object.values(saved.par))side.prod=0;
  return saved;
}
test('both fixed weapons gain exactly 20 percent in real combat and preserve the historical range for old replays',()=>{
  const old={central:3.5,canhao:2.6};
  for(const kind of ['central','canhao']){
    assert(Math.abs(rules.DEFINITIONS[kind].range-old[kind]*1.2)<1e-12);
    assert.equal(factory.combatRules.range[kind],old[kind]*1.2*26);
    function shot(combatVersion,factor){
      const saved=idle({combatVersion}),source=saved.sites.find(s=>s.kind===kind);source.owner=1;source.cd=0;
      const x=source.x+old[kind]*26*factor,y=source.y;
      saved.units=[{id:1,k:'desliz',owner:2,n:20,P:[[x,y],[x,y+1000]],cum:[0,1000],L:1000,d:0,si:0,toId:1,x,y,alive:true}];saved.uid=1;
      const battle=factory.restoreBattle(saved);battle.step(1/30);return battle.snapshot();
    }
    const current=shot(version,1.1);assert(current.fx.some(f=>f.type==='shot'));assert(current.units[0].n<20);
    assert(!shot('legacy',1.1).fx.some(f=>f.type==='shot'));
    assert(!shot(version,1.22).fx.some(f=>f.type==='shot'));
  }
});
test('isolated central and cannon bases send boats across water in areas 1 and 5, while connected routes still use tanks',()=>{
  for(const mapId of ['coast-v1','citadel-v1'])for(const kind of ['central','canhao']){
    const saved=idle({mapId}),source=saved.sites.find(s=>s.kind===kind),map=factory.maps.geometry(mapId);
    source.owner=1;source.troops=20;
    const across=saved.sites.find(s=>s.id!==source.id&&map.comp[s.cell]!==map.comp[source.cell]);
    const battle=factory.restoreBattle(saved),before=battle.snapshot().sites[source.id].troops;
    assert(battle.command({type:'send',sources:[source.id],target:across.id}));
    const unit=battle.snapshot().units[0];assert.equal(unit.k,'desliz');assert.equal(unit.n,before);assert.equal(battle.snapshot().sites[source.id].troops,0);assert.equal(unit.P.length,2);
    const restored=factory.restoreBattle(battle.checkpoint());assert.equal(restored.checkpoint().config.combatVersion,version);assert.deepEqual(restored.snapshot(),battle.snapshot());
    for(let i=0;i<30;i++){battle.step(1/30);restored.step(1/30);}assert.deepEqual(restored.snapshot(),battle.snapshot());
    const connected=saved.sites.find(s=>s.id!==source.id&&map.comp[s.cell]===map.comp[source.cell]);
    const land=factory.restoreBattle(saved);assert(land.command({type:'send',sources:[source.id],target:connected.id}));assert.equal(land.snapshot().units[0].k,'tanque');
    const legacy=structuredClone(saved);delete legacy.config.combatVersion;assert.equal(factory.restoreBattle(legacy).command({type:'send',sources:[source.id],target:across.id}),false);
  }
});
test('a regular ground base still cannot cross disconnected terrain',()=>{
  const saved=idle({mapId:'coast-v1'}),source=saved.sites[4],map=factory.maps.geometry('coast-v1');source.owner=1;source.troops=20;
  const target=saved.sites.find(s=>map.comp[s.cell]!==map.comp[source.cell]);
  assert.equal(factory.restoreBattle(saved).command({type:'send',sources:[4],target:target.id}),false);
});
test('the delivered browser engine and server execute the new range and naval sorties identically',()=>{
  const context={};context.self=context;vm.createContext(context);vm.runInContext(browserEngine(),context);
  const saved=idle({mapId:'citadel-v1'});saved.sites[0].owner=1;saved.sites[0].troops=60;
  const node=factory.restoreBattle(saved),browser=context.DOMINATION_ENGINE.restoreBattle(JSON.parse(JSON.stringify(saved)));
  const command={type:'send',sources:[0],target:4};assert(node.command(command));assert(browser.command(command));
  for(let i=0;i<900;i++){node.step(1/30);browser.step(1/30);if(i%30===0)assert.equal(JSON.stringify(node.snapshot()),JSON.stringify(browser.snapshot()));}
});
test('the renderer command filter permits the same naval targets as the engine',()=>{
  const html=fs.readFileSync(require.resolve('../public/index.html'),'utf8'),start=html.indexOf('const unitKind=(s,target)=>'),end=html.indexOf('\nfunction mkPath',start);
  for(const mapId of ['coast-v1','citadel-v1']){
    const map=factory.maps.geometry(mapId),sites=idle({mapId}).sites;
    for(const kind of ['central','canhao']){
      const source=sites.find(s=>s.kind===kind),target=sites.find(s=>map.comp[s.cell]!==map.comp[source.cell]);
      const context={game:{mode:'world',combatVersion:version,L:{geometry:map}},HX:map,window:{DOMINATION_TROOP_RULES:rules},source,target};vm.createContext(context);
      vm.runInContext(html.slice(start,end)+';result={kind:unitKind(source,target),reachable:canReach(source,target)};',context);
      assert.equal(context.result.kind,'desliz');assert.equal(context.result.reachable,true);
      context.game.combatVersion=null;vm.runInContext('result=canReach(source,target);',context);assert.equal(context.result,false);
    }
  }
});

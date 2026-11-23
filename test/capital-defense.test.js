'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const engine=require('../server/battle-engine'),rules=require('../shared/troop-rules');
const {browserEngine}=require('../server/browser-assets');
const config={difficulty:5,mapId:'citadel-v1',share:.5,defenderBaseCount:3,centralOwner:2,balanceVersion:'troops-v3',combatVersion:rules.COMBAT_VERSION,defenseVersion:engine.combatRules.defenseVersion,seed:27};
const defenders=snapshot=>snapshot.sites.filter(site=>site.owner===2);
test('all five world defenses start with 70 troops and really produce at 0.875/s with a 2.35s decision interval',()=>{
  for(const [i,map] of engine.maps.list().entries()){
  const battle=engine.createBattle({...config,mapId:map.id,difficulty:i+1}),snapshot=battle.snapshot();
  assert.equal(snapshot.par[2].prod,.875);assert.equal(snapshot.par[2].int,2.35);
  assert.equal(defenders(snapshot).length,4);assert.equal(defenders(snapshot).reduce((sum,site)=>sum+site.troops,0),70);
  assert.equal(snapshot.sites.find(site=>site.owner===1).troops,38);
  const saved=battle.checkpoint();saved.cd=0;
  const base=saved.sites.find(site=>site.owner===2&&!site.hq&&site.kind!=='central');
  const quiet=engine.restoreBattle(saved);quiet.setDefenderControlled(true);quiet.step(1);
  assert(Math.abs(quiet.snapshot().sites[base.id].troops-base.troops-.875)<1e-12);
  const hq=saved.sites.find(site=>site.owner===2&&site.hq);
  assert(Math.abs(quiet.snapshot().sites[hq.id].troops-hq.troops-.875*1.25)<1e-12);
  assert.equal(hq.troops,26);assert.equal(defenders(snapshot).find(site=>site.kind==='central').troops,14);
  assert.deepEqual(defenders(snapshot).filter(site=>!site.hq&&site.kind!=='central').map(site=>site.troops),[15,15]);
  }
});
test('capital-v2 through capital-v7 replays retain their original decision intervals, production and troop counts',()=>{
  for(const [defenseVersion,interval] of [['capital-v2',2.45],['capital-v3',2.5],['capital-v4',2.47],['capital-v5',2.45],['capital-v6',2.35],['capital-v7',2.35]]){
    const snapshot=engine.createBattle({...config,defenseVersion}).snapshot();
    assert.equal(snapshot.par[2].int,interval);assert.equal(snapshot.par[2].prod,defenseVersion==='capital-v7'?.875:.85);
    assert.equal(defenders(snapshot).reduce((n,s)=>n+s.troops,0),70);
  }
});
test('historical replays retain each area difficulty and do not inherit cached troop changes',()=>{
  engine.createBattle(config);
  const legacy={...config};delete legacy.defenseVersion;
  const previous=engine.createBattle(legacy).snapshot();assert.equal(previous.par[2].prod,.875);assert.equal(previous.par[2].int,2.35);assert.equal(defenders(previous).reduce((n,s)=>n+s.troops,0),72);
  for(const [i,map] of engine.maps.list().slice(0,4).entries()){
    const settings={...config,mapId:map.id,difficulty:i+1};
    engine.createBattle(settings);
    const old={...settings};delete old.defenseVersion;
    const expected=engine.createBattle(old).snapshot();
    assert.equal(defenders(expected).reduce((n,s)=>n+s.troops,0),56+i*4);
    for(const defenseVersion of ['capital-v2','capital-v3','capital-v4','capital-v5','capital-v6','capital-v7']){
      assert.deepEqual(engine.createBattle({...settings,defenseVersion}).snapshot(),expected);
    }
  }
  assert.equal(defenders(engine.createBattle(config).snapshot()).reduce((n,s)=>n+s.troops,0),70);
});
test('new settings on all five maps survive checkpoints and run identically in the browser worker and server',()=>{
  const context={};context.self=context;vm.createContext(context);vm.runInContext(browserEngine(),context);
  for(const [i,map] of engine.maps.list().entries()){
  const settings={...config,mapId:map.id,difficulty:i+1};
  const node=engine.createBattle(settings),browser=context.DOMINATION_ENGINE.createBattle(settings);
  for(let i=0;i<900;i++){node.step(1/30);browser.step(1/30);if(i%60===0)assert.equal(JSON.stringify(node.snapshot()),JSON.stringify(browser.snapshot()));}
  const saved=node.checkpoint();assert.equal(saved.config.defenseVersion,config.defenseVersion);
  const resumed=engine.restoreBattle(saved);
  for(let i=0;i<90;i++){node.step(1/30);resumed.step(1/30);}assert.deepEqual(node.snapshot(),resumed.snapshot());
  }
});
test('new world battles apply the same tuned profile to all five areas',async t=>{
  const {postgres}=require('./postgres'),{createApplication}=require('../server');
  const db=await postgres(),app=await createApplication({pool:db.pool,worldOptions:{startClock:false}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await app.close();await db.destroy();});
  const base='http://127.0.0.1:'+app.server.address().port;
  const registered=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'capital_balance',name:'Capital balance',password:'capital-test-password'})});assert.equal(registered.status,200);
  const cookie=registered.headers.get('set-cookie').split(';')[0];
  for(const [i,map] of engine.maps.list().entries()){
    const response=await fetch(base+'/api/world/areas/'+map.area+'/attack',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,201);
    const record=await response.json();
    assert.equal(record.config.defenseVersion,config.defenseVersion);
    assert.equal(defenders(record.snapshot).reduce((n,s)=>n+s.troops,0),70);
    assert.equal(record.snapshot.par[2].prod,.875);assert.equal(record.snapshot.par[2].int,2.35);
    const surrendered=await fetch(base+'/api/world/battles/'+record.id+'/surrender',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{}'});assert.equal(surrendered.status,200);await surrendered.json();
  }
});

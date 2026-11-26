'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const maps=require('../shared/battle-maps'),engine=require('../server/battle-engine'),rules=require('../shared/troop-rules');
const ids=maps.pilotList().map(m=>m.id),near=(a,b)=>assert(Math.abs(a-b)<.00001,a+' != '+b);
test('every live field gives opposing headquarters identical land, structure choices, territory weights and travel distances',()=>{
 for(const id of ids){
  assert(id.endsWith('-v2'));const m=maps.get(id),g=maps.geometry(id),mirror=m.data.mirror,[attacker,defender]=g.corners;
  assert.equal(g.seeds.length,17);assert.equal(mirror.seeds[attacker],defender);
  const inIsland=home=>g.seeds.map((s,i)=>i).filter(i=>g.comp[g.seeds[home].cell]===g.comp[g.seeds[i].cell]);
  assert.deepEqual(inIsland(attacker).map(i=>g.seeds[i].n).sort(),inIsland(defender).map(i=>g.seeds[i].n).sort(),id);
  for(const [i,s]of g.seeds.entries()){
   const j=mirror.seeds[i];assert.equal(g.seeds[j].n,s.n);assert.equal(mirror.cells[s.cell],g.seeds[j].cell);assert.equal(g.weights[i],g.weights[j]);
   assert.equal(g.path(g.seeds[attacker].cell,s.cell).length,g.path(g.seeds[defender].cell,g.seeds[j].cell).length);
   const p=g.cells[s.cell],q=g.cells[g.seeds[attacker].cell],r=g.cells[g.seeds[j].cell],t=g.cells[g.seeds[defender].cell];near(Math.hypot(p.x-q.x,p.y-q.y),Math.hypot(r.x-t.x,r.y-t.y));
  }
  for(const [i,p]of g.cells.entries()){const j=mirror.cells[i],q=g.cells[j];near(p.x+q.x,m.width);near(p.y+q.y,m.height);assert.equal(mirror.seeds[p.t],q.t);assert.deepEqual(g.nb[i].map(n=>mirror.cells[n]).sort((a,b)=>a-b),g.nb[j].slice().sort((a,b)=>a-b));}
 }
 const first=maps.geometry(ids[0]),count=home=>first.seeds.filter(s=>first.comp[s.cell]===first.comp[first.seeds[home].cell]).length;
 assert.equal(count(first.corners[0]),6);assert.equal(count(first.corners[1]),6);
});
test('every initial headquarters has two nearby transport options with independent land routes, including every single-cell cut',()=>{
 for(const id of ids){const g=maps.geometry(id),mirror=maps.get(id).data.mirror;
  for(const [home,boat,heli]of [[4,5,11],[1,mirror.seeds[5],mirror.seeds[11]]]){
   const origin=g.seeds[home].cell,b=g.seeds[boat].cell,h=g.seeds[heli].cell;
   assert.equal(g.seeds[boat].n,'B');assert.equal(g.seeds[heli].n,'H');assert(g.path(origin,b).length<=4,id);assert(g.path(origin,h).length<=4,id);
   for(let blocked=0;blocked<g.cells.length;blocked++)if(blocked!==origin){const seen=new Set([origin]),queue=[origin];for(let k=0;k<queue.length;k++)for(const n of g.nb[queue[k]])if(n!==blocked&&!seen.has(n)){seen.add(n);queue.push(n);}assert(seen.has(b)||seen.has(h),id+' blocked exit '+blocked);}
  }
 }
});
test('new fields retain the tuned CPU and the existing attack army without changing persistent ownership',()=>{
 for(const [i,id]of ids.entries()){
  const b=engine.createBattle({mapId:id,difficulty:i+1,seed:29,defenderBaseCount:3,centralOwner:2,balanceVersion:'troops-v3',combatVersion:rules.COMBAT_VERSION,defenseVersion:engine.combatRules.defenseVersion}),s=b.snapshot(),defense=s.sites.filter(b=>b.owner===2);
  assert.equal(defense.length,4);assert.equal(defense.reduce((sum,b)=>sum+b.troops,0),70);assert.equal(s.par[2].prod,.875);assert.equal(s.par[2].int,2.35);assert.equal(s.sites.filter(b=>b.owner===1).length,1);assert.equal(s.sites.find(b=>b.owner===1).troops,38);
  assert.deepEqual(defense.map(b=>b.id),[0,1,8,12]);assert.equal(engine.restoreBattle(b.checkpoint()).checkpoint().config.mapId,id);
 }
});
test('ring fields retain a lake around the central weapon instead of filling their outline',()=>{
 for(const index of [3,9]){const g=maps.geometry(ids[index]),cell=g.seeds[g.center].cell;assert.equal(g.nb[cell].length,0);assert.equal(g.comp.filter(c=>c===g.comp[cell]).length,1);}
});
test('all ten historical pilot fields and battles replay exactly as the previously deployed engine',()=>{
 const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
 for(const fixture of require('./fixtures/pilot-v1-checkpoints.json')){
  assert(maps.get(fixture.config.mapId));assert(!ids.includes(fixture.config.mapId));assert(maps.isWorldMap(fixture.config.mapId));
  const b=engine.createBattle(fixture.config);for(let i=0;i<fixture.steps;i++)b.step(1/30);assert.equal(hash(JSON.stringify(b.snapshot())),fixture.hash,fixture.config.mapId);const state=b.snapshot(),restored=engine.restoreBattle(b.checkpoint()).snapshot();delete state.fx;delete restored.fx;assert.deepEqual(restored,state);
 }
 const historical=maps.historicalPilotList();assert.equal(historical.length,10);assert(historical.every(m=>maps.forArea(m.area).endsWith('-v2')));
 assert.equal(hash(fs.readFileSync(require.resolve('../shared/pilot-maps-v1.json'))),'552baf5845c135e11bd206f21744a376f0dc2208cba38b691f4baeb012ba90eb');
});

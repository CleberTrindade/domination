'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const maps=require('../shared/battle-maps'),engine=require('../server/battle-engine'),{browserMaps,browserEngine}=require('../server/browser-assets');
const cam=require('../public/battle-camera');
test('pilot enables only the South America, Brazil, Sergipe path',async()=>{const {destinationEnabled:p}=await import('../client/explorer/pilot-policy.js');assert(p(0,{continent:'South America'}));assert(!p(0,{continent:'Europe'}));assert(p(1,{continent:'South America',country:'BRA'}));assert(!p(1,{continent:'South America',country:'ARG'}));assert(p(2,{continent:'South America',country:'BRA',region:'BR-SE'}));assert(!p(2,{continent:'South America',country:'BRA',region:'BR-BA'}));});
test('all ten live fields have distinct terrain, four headquarters and transport from every headquarters',()=>{
 assert.equal(maps.pilotList().length,10);const signatures=new Set();
 for(const m of maps.pilotList()){
  const h=maps.geometry(m.id);signatures.add(JSON.stringify(h.cells));assert.equal(maps.forArea(m.area),m.id);assert.equal(h.seeds.length,17);assert.equal(new Set(h.seeds.map(s=>s.cell)).size,17);
  assert(h.corners.every(i=>h.seeds[i].n==='P'));assert.equal(h.center,0);assert(h.cells.every(c=>c.t>=0&&c.t<17));
  for(const start of h.corners){const seen=new Set([start]),q=[start];for(let i=0;i<q.length;i++)for(const [j,s]of h.seeds.entries())if(!seen.has(j)&&(['B','H'].includes(h.seeds[q[i]].n)||h.comp[s.cell]===h.comp[h.seeds[q[i]].cell])){seen.add(j);q.push(j);}assert.equal(seen.size,17,m.id+' isolated headquarters');}
  const setup=engine.initialSites(.5,1,2,3,m.id);assert.equal(setup.sites.filter(s=>s.owner===2).length,4);assert.equal(setup.sites.filter(s=>s.owner===1).length,1);
 }
 assert.equal(signatures.size,10);assert(new Set(maps.pilotList().map(m=>m.tag)).size>=3);
});
test('new world field geometry and deterministic battle checkpoints match browser and server',()=>{
 const context={self:{}};vm.createContext(context);vm.runInContext(browserMaps(),context);vm.runInContext(browserEngine(),context);
 for(const m of maps.pilotList()){
  assert.equal(JSON.stringify(context.self.DOMINATION_MAPS.get(m.id).data),JSON.stringify(maps.get(m.id).data));
  const config={mapId:m.id,centralOwner:2,defenderBaseCount:3,seed:238,defenseVersion:engine.combatRules.defenseVersion},a=engine.createBattle(config),b=context.self.DOMINATION_ENGINE.createBattle(config);
  for(let i=0;i<200;i++){a.step(1/30);b.step(1/30);}assert.equal(JSON.stringify(a.snapshot()),JSON.stringify(b.snapshot()));assert.deepEqual(engine.restoreBattle(a.checkpoint()).snapshot(),a.snapshot());
  assert.equal(a.checkpoint().config.mapId,m.id);
 }
 for(const m of maps.list())assert.equal(maps.get(m.id).id,m.id,'legacy maps retained for replays');
});
test('camera pans and overview fits all layouts without changing authoritative coordinates',()=>{
 for(const meta of maps.pilotList())for(const [w,h]of [[320,570],[390,650],[480,760]]){
  const g={L:{W:meta.width,H:meta.height,geometry:maps.geometry(meta.id)},sites:[],me:1};const view=cam.configure(g,w,h),before=structuredClone(g.L.geometry.cells);
  cam.pan(g,100,-80,w,h);cam.zoom(g,1.2,w,h);cam.focus(g,true,w,h);const fit=cam.configure(g,w,h);assert(g.L.W*fit.scale<=w&&g.L.H*fit.scale<=h);assert.deepEqual(g.L.geometry.cells,before);assert(view.scale>0);
 }
});
test('Sergipe municipal groups cover all 75 municipalities once and map to ten live IDs',async()=>{
 const {geoContains,geoArea}=await import('d3-geo'),{normalizeGeometry}=await import('../client/explorer/geometry.js'),d=JSON.parse(fs.readFileSync('public/explorer/data/sergipe-pilot.json'));
 assert.equal(d.features.length,10);const ids=d.features.map(f=>f.id),members=d.features.flatMap(f=>f.properties.municipalities);assert.equal(members.length,75);assert.equal(new Set(members).size,75);assert.deepEqual(ids,maps.pilotList().map(m=>m.area));
 const outline=normalizeGeometry(d.outline);let area=0;for(const f of d.features){normalizeGeometry(f);area+=geoArea(f);assert(geoContains(f,f.properties.label));assert(geoContains(outline,f.properties.label));}assert(Math.abs(area-geoArea(outline))<1e-8);
});
test('additive migration preserves existing ownership, progress and account data',async()=>{
 const {postgres}=require('./postgres'),{migrate}=require('../server/database'),{randomUUID}=require('node:crypto'),db=await postgres();
 try{await migrate(db.pool);await db.pool.query("DELETE FROM world_areas WHERE ordinal>5");await db.pool.query("DELETE FROM world_migrations WHERE name='017_sergipe_globe_pilot.sql'");
  const id=randomUUID();await db.pool.query("INSERT INTO world_players(id,username,display_name,password_hash,coin_balance,troop_cards) VALUES($1,'pilot_saved','Saved Player','fixture',123400,$2::jsonb)",[id,JSON.stringify({tanque:90})]);
  await db.pool.query("UPDATE world_areas SET owner_id=$1,version=8,conquered_at='2026-11-20T12:00:00Z',cpu_reward_claimed=true WHERE ordinal<=5",[id]);
  const before=(await db.pool.query('SELECT * FROM world_areas ORDER BY ordinal')).rows,player=(await db.pool.query('SELECT * FROM world_players WHERE id=$1',[id])).rows;
  await migrate(db.pool);await migrate(db.pool);const after=(await db.pool.query('SELECT * FROM world_areas ORDER BY ordinal')).rows;
  assert.equal(after.length,10);assert.deepEqual(after.slice(0,5),before);assert(after.slice(5).every(a=>a.owner_id===null&&a.state_id==='SE'));assert.deepEqual((await db.pool.query('SELECT * FROM world_players WHERE id=$1',[id])).rows,player);
 }finally{await db.destroy();}
});
test('server rejects attacks outside Sergipe even when the client navigation is bypassed',async()=>{
 const {postgres}=require('./postgres'),{createApplication}=require('../server'),{randomUUID}=require('node:crypto'),db=await postgres();let app;
 try{app=await createApplication({pool:db.pool,worldOptions:{startClock:false}});await db.pool.query("INSERT INTO world_areas(id,state_id,name,ordinal,description,cpu_share) VALUES('ba-pending','BA','Bahia pendente',11,'Em breve',.35)");
  const data=await app.world.world(null);assert.equal(data.areas.length,10);assert(data.areas.every(a=>a.state_id==='SE'));
  await assert.rejects(app.world.start({id:randomUUID()},'ba-pending'),e=>e.status===403&&e.message.includes('Em breve'));
 }finally{if(app)await app.close();await db.destroy();}
});

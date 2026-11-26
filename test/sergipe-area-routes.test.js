'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createApplication}=require('../server'),{postgres}=require('./postgres'),maps=require('../shared/battle-maps');
test('all ten Sergipe area IDs work through real attack and retaliation HTTP routes',async t=>{
 const db=await postgres();let clock=Date.now();const app=await createApplication({pool:db.pool,worldOptions:{startClock:false,now:()=>clock}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port;
 async function api(path,cookie,body){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 async function register(username){const r=await api('/api/auth/register',null,{username,name:username,password:'route-regression-test-123'});assert.equal(r.status,200);return r;}
 try{
  const hero=await register('area_route_hero'),rival=await register('area_route_rival'),outsider=await register('area_route_other');
  const world=(await api('/api/world',hero.cookie)).data;assert.equal(world.areas.length,10);
  await t.test('legacy and numbered areas start the matching field and preserve territory ownership',async()=>{
   const before=(await db.pool.query('SELECT id,owner_id,version,conquered_at FROM world_areas ORDER BY ordinal')).rows;
   for(const area of world.areas){
    clock+=61000;const response=await api('/api/world/areas/'+area.id+'/attack',hero.cookie,{});
    assert.equal(response.status,201,area.id+': '+JSON.stringify(response.data));assert.equal(response.data.areaId,area.id);assert.equal(response.data.config.mapId,maps.forArea(area.id));assert.equal(response.data.playerOwner,1);assert.equal(response.data.snapshot.sites.length,17);
    assert.equal((await api('/api/world/battles/'+response.data.id+'/surrender',hero.cookie,{})).status,200);
   }
   assert.deepEqual((await db.pool.query('SELECT id,owner_id,version,conquered_at FROM world_areas ORDER BY ordinal')).rows,before);
  });
  await t.test('numbered targets work for retaliation with owner and defender permissions enforced',async()=>{
   clock+=61000;const id=randomUUID();await db.pool.query("UPDATE world_areas SET owner_id=$1 WHERE id='se-area-08'",[rival.data.player.id]);await db.pool.query("UPDATE world_areas SET owner_id=$1 WHERE id='se-area-09'",[hero.data.player.id]);
   await db.pool.query("INSERT INTO world_battles(id,area_id,attacker_id,defender_id,area_version,status,defense_share,started_at,finished_at,expires_at,result) VALUES($1,'se-litoral-sul',$2,$3,0,'lost',.5,now(),now(),now(),'{}'::jsonb)",[id,rival.data.player.id,hero.data.player.id]);
   const route='/api/world/battles/'+id+'/retaliate';
   assert.equal((await api(route,outsider.cookie,{areaId:'se-area-08'})).status,403);
   assert.equal((await api(route,hero.cookie,{areaId:'se-area-09'})).status,409);
   assert.equal((await api(route,hero.cookie,{areaId:'se-area-10'})).status,409);
   assert.equal((await api(route,hero.cookie,{areaId:'se-area-99'})).status,404);
   assert.equal((await api(route,hero.cookie,{areaId:'se-area-08/attack'})).status,400);
   const response=await api(route,hero.cookie,{areaId:'se-area-08'});assert.equal(response.status,201,JSON.stringify(response.data));assert.equal(response.data.areaId,'se-area-08');assert.equal(response.data.retaliationOf,id);
   await api('/api/world/battles/'+response.data.id+'/surrender',hero.cookie,{});
  });
  await t.test('unknown numeric IDs report missing areas and self-attacks remain blocked',async()=>{
   clock+=61000;
   const missing=await api('/api/world/areas/se-area-99/attack',hero.cookie,{});assert.equal(missing.status,404);assert.equal(missing.data.error,'Área não encontrada.');
   assert.equal((await api('/api/world/areas/se-area-09/attack',hero.cookie,{})).status,409);
   assert.equal((await api('/api/world/areas/se-area-08/attack',null,{})).status,401);
  });
 }finally{await app.close();await db.destroy();}
});

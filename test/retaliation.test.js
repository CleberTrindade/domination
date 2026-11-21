'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createApplication}=require('../server');
const {postgres}=require('./postgres');
test('received attacks persist for returning players and only their defender can retaliate against the aggressor',async t=>{
  const database=await postgres(),pool=database.pool;
  let app=await createApplication({pool,worldOptions:{startClock:false}}),base;
  async function listen(){await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+app.server.address().port;}await listen();
  async function api(path,cookie,body){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  const register=username=>api('/api/auth/register',null,{username,name:username,password:'test-retaliation-123'});
  try{
    const guardian=await register('guardian'),raider=await register('raider'),outsider=await register('outsider');
    await pool.query("UPDATE world_areas SET owner_id=$1 WHERE id IN ('se-litoral-sul','se-agreste')",[raider.data.player.id]);
    await pool.query("UPDATE world_areas SET owner_id=$1 WHERE id='se-alto-sertao'",[guardian.data.player.id]);
    await pool.query("UPDATE world_areas SET owner_id=$1 WHERE id='se-sao-francisco'",[outsider.data.player.id]);
    const histories=[];
    for(let i=0;i<23;i++){
      const id=randomUUID(),area=i===0?'se-litoral-sul':'se-alto-sertao',status=i===0?'won':'lost';histories.push(id);
      await pool.query("INSERT INTO world_battles(id,area_id,attacker_id,defender_id,area_version,status,defense_share,started_at,finished_at,expires_at,result) VALUES($1,$2,$3,$4,0,$5,.5,$6,now(),now(),'{}'::jsonb)",[id,area,raider.data.player.id,guardian.data.player.id,status,new Date(Date.now()-(i+1)*60000).toISOString()]);
    }
    let list;
    await t.test('the most recent twenty attacks include names, outcomes and valid revenge and counterattack targets',async()=>{
      list=(await api('/api/world',guardian.cookie)).data.receivedAttacks;
      assert.equal(list.length,20);assert.equal(list[0].id,histories[0]);assert.equal(list[0].attacker_name,'raider');assert.equal(list[0].status,'won');
      assert.equal(list[0].revengeArea.id,'se-litoral-sul');assert.equal(list[0].counterAreas[0].id,'se-agreste');
      assert.equal(list[1].revengeArea,null);assert.equal(list[1].counterAreas.length,2);
      assert.equal((await api('/api/world',outsider.cookie)).data.receivedAttacks.length,0);
      assert.equal((await api('/api/world')).data.receivedAttacks.length,0);
    });
    await t.test('foreign accounts cannot use someone else\'s revenge, or select a neutral, friendly or unrelated territory',async()=>{
      const route='/api/world/battles/'+histories[0]+'/retaliate';
      assert.equal((await api(route,outsider.cookie,{areaId:'se-litoral-sul'})).status,403);
      assert.equal((await api(route,raider.cookie,{areaId:'se-alto-sertao'})).status,403);
      assert.equal((await api(route,guardian.cookie,{areaId:'se-sao-francisco'})).status,409);
      assert.equal((await api(route,guardian.cookie,{areaId:'se-aracaju'})).status,409);
      assert.equal((await api(route,guardian.cookie,{areaId:'se-alto-sertao'})).status,409);
      assert.equal((await api(route,guardian.cookie,{})).status,400);
    });
    await t.test('revenge starts a normal browser battle without a DB row, then saves its origin only when finished',async()=>{
      const response=await api('/api/world/battles/'+histories[0]+'/retaliate',guardian.cookie,{areaId:'se-litoral-sul'});
      assert.equal(response.status,201);assert.equal(response.data.retaliationOf,histories[0]);assert.equal(response.data.areaId,'se-litoral-sul');
      assert.equal(response.data.config.centralOwner,2);assert.equal(response.data.snapshot.sites[0].owner,2);
      assert.equal(response.data.snapshot.sites.filter(site=>site.owner===2).length,4);assert.equal(response.data.config.mapId,'coast-v1');assert.equal(response.data.snapshot.defenderShare,require('../server/battle-engine').initialSites(.5,1,2,3,'coast-v1').defenderShare);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM world_battles WHERE id=$1',[response.data.id])).rows[0].n,0);
      await api('/api/world/battles/'+response.data.id+'/surrender',guardian.cookie,{});
      const saved=(await pool.query('SELECT retaliation_of,status FROM world_battles WHERE id=$1',[response.data.id])).rows[0];
      assert.equal(saved.retaliation_of,histories[0]);assert.equal(saved.status,'abandoned');
    });
    await t.test('counterattack can choose another aggressor territory and rechecks its owner at launch',async()=>{
      const response=await api('/api/world/battles/'+histories[1]+'/retaliate',guardian.cookie,{areaId:'se-agreste'});
      assert.equal(response.status,201);assert.equal(response.data.areaId,'se-agreste');
      const map=(await api('/api/world',guardian.cookie)).data;
      assert(map.receivedAttacks[0].counterAreas.find(a=>a.id==='se-agreste').busy);
      await api('/api/world/battles/'+response.data.id+'/surrender',guardian.cookie,{});
      await pool.query("UPDATE world_areas SET owner_id=$1 WHERE id='se-agreste'",[outsider.data.player.id]);
      assert.equal((await api('/api/world/battles/'+histories[1]+'/retaliate',guardian.cookie,{areaId:'se-agreste'})).status,409);
    });
    await t.test('an active incoming attack is listed as defendable and cannot yet be used for a counterattack',async()=>{
      const response=await api('/api/world/areas/se-alto-sertao/attack',raider.cookie,{});assert.equal(response.status,201);
      const attack=(await api('/api/world',guardian.cookie)).data.receivedAttacks[0];assert.equal(attack.id,response.data.id);assert.equal(attack.status,'active');assert.equal(attack.canDefend,true);
      assert.equal((await api('/api/world/battles/'+attack.id+'/retaliate',guardian.cookie,{areaId:'se-litoral-sul'})).status,409);
      await api('/api/world/battles/'+attack.id+'/surrender',raider.cookie,{});
    });
    await t.test('returning after a server restart still shows the personal attack list',async()=>{
      await app.close();app=await createApplication({pool,worldOptions:{startClock:false}});await listen();
      const world=(await api('/api/world',guardian.cookie)).data;assert.equal(world.player.username,'guardian');
      assert.equal(world.receivedAttacks.length,20);assert(world.receivedAttacks.some(a=>a.id===histories[0]));
    });
  }finally{await app.close();await database.destroy();}
});

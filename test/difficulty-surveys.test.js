'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createApplication}=require('../server'),{postgres}=require('./postgres');
const {createDifficultySurveys}=require('../server/difficulty-surveys');
test('first conquest attempt is surveyed once per account, area and initial ownership context',async t=>{
 const db=await postgres();let app=await createApplication({pool:db.pool,worldOptions:{startClock:false}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));let base='http://127.0.0.1:'+app.server.address().port;
 async function api(path,cookie,body){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 async function register(username){const r=await api('/api/auth/register',null,{username,name:username,password:'difficulty-test-password'});return {...r.data.player,cookie:r.cookie};}
 const hero=await register('surveyhero'),defender=await register('surveydefender'),invader=await register('surveyinvader');
 const view=async p=>(await api('/api/world',p.cookie)).data,attack=async area=>(await api('/api/world/areas/'+area+'/attack',hero.cookie,{})).data;
 try{
  let cpuId,surveyId;
  await t.test('finished loss creates a pending CPU question; subsequent retries preserve the first battle',async()=>{
   assert.deepEqual((await api('/api/world')).data.difficultySurveys,[]);
   const battle=await attack('se-agreste');cpuId=battle.id;
   assert.deepEqual((await view(hero)).difficultySurveys,[],'no survey during combat');
   assert.equal((await api('/api/world/battles/'+battle.id+'/surrender',hero.cookie,{})).status,200);
   let pending=(await view(hero)).difficultySurveys;assert.equal(pending.length,1);assert.equal(pending[0].context,'cpu');assert.equal(pending[0].outcome,'lost');assert.equal(pending[0].battleId,cpuId);surveyId=pending[0].id;
   const retry=await attack('se-agreste');await api('/api/world/battles/'+retry.id+'/surrender',hero.cookie,{});
   pending=(await view(hero)).difficultySurveys;assert.equal(pending.length,1);assert.equal(pending[0].id,surveyId);assert.equal(pending[0].battleId,cpuId);
  });
  await t.test('only the authenticated owner may answer, with integer 1–5 and safe retries',async()=>{
   const path='/api/world/difficulty-surveys/'+surveyId;
   assert.equal((await api(path,null,{rating:3})).status,401);assert.equal((await api(path,defender.cookie,{rating:3})).status,404);
   for(const rating of [0,6,2.5,'3',null])assert.equal((await api(path,hero.cookie,{rating})).status,400);
   const responses=await Promise.all([api(path,hero.cookie,{rating:4}),api(path,hero.cookie,{rating:4})]);assert(responses.every(r=>r.status===200));assert(responses.some(r=>r.data.alreadyApplied));
   assert.equal((await api(path,hero.cookie,{rating:2})).status,409);assert.deepEqual((await view(hero)).difficultySurveys,[]);
   const row=(await db.pool.query('SELECT rating,answered_at FROM world_difficulty_surveys WHERE id=$1',[surveyId])).rows[0];assert.equal(row.rating,4);assert(row.answered_at);
  });
  await t.test('human ownership is independent from the free-area answer and from defender online status',async()=>{
   await db.pool.query("UPDATE world_areas SET owner_id=$1 WHERE id='se-agreste'",[defender.id]);
   const battle=await attack('se-agreste');await api('/api/world/battles/'+battle.id+'/surrender',hero.cookie,{});
   const pending=(await view(hero)).difficultySurveys;assert.equal(pending.length,1);assert.equal(pending[0].context,'occupied');assert.equal(pending[0].areaId,'se-agreste');assert.equal(pending[0].battleId,battle.id);
   assert.deepEqual((await view(defender)).difficultySurveys,[],'defending is not a conquest attempt');
   await db.pool.query("UPDATE world_areas SET owner_id=$1 WHERE id='se-agreste'",[invader.id]);
   const retry=await attack('se-agreste');await api('/api/world/battles/'+retry.id+'/surrender',hero.cookie,{});
   assert.equal((await view(hero)).difficultySurveys[0].battleId,battle.id,'a new owner does not create a third survey');
  });
  await t.test('each new area gets its own question and interrupted matches are excluded',async()=>{
   const b=await attack('se-litoral-sul');await api('/api/world/battles/'+b.id+'/surrender',hero.cookie,{});
   assert.equal((await view(hero)).difficultySurveys.length,2);
   const interrupted=await attack('se-alto-sertao');await app.close();
   app=await createApplication({pool:db.pool,worldOptions:{startClock:false}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;
   const pending=(await view(hero)).difficultySurveys;assert.equal(pending.length,2);assert(!pending.some(s=>s.battleId===interrupted.id));
   assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM world_difficulty_surveys WHERE player_id=$1',[hero.id])).rows[0].n,3,'answered plus pending survive restart');
  });
  await t.test('winning invaders and losing attackers are stored separately, with context frozen before conquest',async()=>{
   const id=randomUUID(),areaId='se-aracaju',at=Date.now(),roster=[{playerId:hero.id,owner:1},{playerId:defender.id,owner:2},{playerId:invader.id,owner:3}];
   await db.pool.query("INSERT INTO world_battles(id,area_id,attacker_id,defender_id,area_version,status,defense_share,expires_at,finished_at) VALUES($1,$2,$3,$4,0,'won',.4,now(),now())",[id,areaId,hero.id,defender.id]);
   for(const p of roster)await db.pool.query('INSERT INTO world_battle_participants(battle_id,player_id,side,joined_at,outcome) VALUES($1,$2,$3,now(),$4)',[id,p.playerId,p.owner,p.owner===3?'won':'lost']);
   await db.pool.query('UPDATE world_areas SET owner_id=$1 WHERE id=$2',[invader.id,areaId]);
   const client=await db.pool.connect();try{await client.query('BEGIN');await createDifficultySurveys(client,{id,areaId,defenderId:defender.id},roster,{status:'won',winnerOwner:3,at});await client.query('COMMIT');}finally{client.release();}
   const winner=(await view(invader)).difficultySurveys.find(s=>s.battleId===id),loser=(await view(hero)).difficultySurveys.find(s=>s.battleId===id);
   assert.equal(winner.outcome,'won');assert.equal(winner.context,'occupied');assert.equal(loser.outcome,'lost');assert.equal(loser.context,'occupied');assert(!(await view(defender)).difficultySurveys.some(s=>s.battleId===id));
   await assert.rejects(db.pool.query('UPDATE world_difficulty_surveys SET rating=6,answered_at=now() WHERE battle_id=$1',[id]));
  });
 }finally{await app.close();await db.destroy();}
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTraining}=require('../shared/training-battle'),engine=require('../server/battle-engine');
const {postgres}=require('./postgres'),{createApplication}=require('../server');
test('practice uses real movement and captures; every instructed route is winnable without touching world state',()=>{
 const practice=createTraining(engine),before=practice.state().snapshot;
 practice.step(20);assert.deepEqual(practice.state().snapshot,before,'instructor waits for the player');
 for(let index=1;index<=7;index++){
  assert(practice.next());const {lesson}=practice.state();
  assert.equal(practice.command({type:'send',sources:[1],target:4}),false,'unrelated orders cannot skip lessons');
  assert.equal(practice.next(),false,'must complete action before proceeding');
  const action=lesson.drop?{type:'drop',site:lesson.source}:{type:'send',sources:[lesson.source],target:lesson.target};
  const beforeDrop=practice.state().snapshot.sites[lesson.source].troops;
  assert(practice.command(action));
  if(!lesson.drop){assert.equal(practice.state().ready,false);assert(practice.state().snapshot.units.length>0);}
  else assert.equal(practice.state().snapshot.sites[lesson.source].troops,beforeDrop+12);
  for(let i=0;i<1500&&!practice.state().ready;i++)practice.step(.1);
  assert(practice.state().ready,'lesson '+index+' must finish');
  if(lesson.target!==undefined)assert.equal(practice.state().snapshot.sites[lesson.target].owner,1);
  if(index===5)assert.equal(practice.state().snapshot.over,false,'central is a strategic advantage, not a win condition');
 }
 assert.equal(practice.state().snapshot.winnerOwner,1);assert(practice.state().finished);assert.equal(practice.next(),false);
 const restarted=createTraining(engine);assert.equal(restarted.state().index,0);assert.equal(restarted.state().snapshot.sites[4].troops,45);
});
test('new accounts resume onboarding, phases are monotonic and tutorial never awards currency or gameplay records',async t=>{
 const db=await postgres(),app=await createApplication({pool:db.pool,worldOptions:{startClock:false}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await app.close();await db.destroy();});const base='http://127.0.0.1:'+app.server.address().port;
 async function api(path,cookie,body){const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
 const account=await api('/api/auth/register',null,{username:'tutorialhero',name:'Instrutor',password:'tutorial-pass'}),cookie=account.cookie;
 assert.equal(account.status,200);let world=(await api('/api/world',cookie)).data;assert.deepEqual(world.tutorial,{phase:'training',step:0});
 const wallet=world.wallet.balance;
 assert.equal((await api('/api/world/tutorial',null,{phase:'tour',step:0})).status,401);
 assert.equal((await api('/api/world/tutorial',cookie,{phase:'wat',step:0})).status,400);
 assert.deepEqual((await api('/api/world/tutorial',cookie,{phase:'done',step:0})).data.tutorial,{phase:'training',step:0},'must complete training transition first');
 assert.deepEqual((await api('/api/world/tutorial',cookie,{phase:'tour',step:0})).data.tutorial,{phase:'tour',step:0});
 await api('/api/world/tutorial',cookie,{phase:'tour',step:5});await api('/api/world/tutorial',cookie,{phase:'tour',step:2});
 assert.deepEqual((await api('/api/world',cookie)).data.tutorial,{phase:'tour',step:5},'stale tabs cannot rewind saved progress');
 await api('/api/world/tutorial',cookie,{phase:'done',step:0});await api('/api/world/tutorial',cookie,{phase:'tour',step:8});
 world=(await api('/api/world',cookie)).data;assert.deepEqual(world.tutorial,{phase:'done',step:0});assert.equal(world.wallet.balance,wallet);assert.equal(world.activeBattle,null);assert.equal(world.areas.filter(a=>a.owner_id).length,0);
 for(const table of ['world_battles','world_battle_participants','world_coin_ledger','world_card_rewards','world_difficulty_surveys'])assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n,0,table);
 const logged=await api('/api/auth/login',null,{username:'tutorialhero',password:'tutorial-pass'});assert.deepEqual((await api('/api/world',logged.cookie)).data.tutorial,{phase:'done',step:0});
 for(const asset of ['/world-tutorial.js','/tutorial.css','/training-worker.js','/training-battle.js'])assert.equal((await fetch(base+asset)).status,200);
});

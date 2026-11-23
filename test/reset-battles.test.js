'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {postgres}=require('./postgres'),{createApplication}=require('../server');
const {previewReset,resetBattles}=require('../server/maintenance/reset-battles');
test('reset de batalha clears progress atomically, preserving accounts, friends and survey evidence',async t=>{
 const db=await postgres(),app=await createApplication({pool:db.pool,worldOptions:{startClock:false}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 async function api(path,cookie,body){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 const hero=await api('/api/auth/register',null,{username:'resethero',name:'Reset Hero',password:'reset-test-password'}),friend=await api('/api/auth/register',null,{username:'resetfriend',name:'Amigo',password:'reset-test-password'}),id=hero.data.player.id;
 try{
  const request=await api('/api/world/friends/request',hero.cookie,{playerId:friend.data.player.id});await api('/api/world/friends/'+request.data.id+'/accept',friend.cookie,{});
  const battle=(await api('/api/world/areas/se-agreste/attack',hero.cookie,{})).data;await api('/api/world/battles/'+battle.id+'/surrender',hero.cookie,{});
  const survey=(await api('/api/world',hero.cookie)).data.difficultySurveys[0];await api('/api/world/difficulty-surveys/'+survey.id,hero.cookie,{rating:4});await app.close();
  await db.pool.query("UPDATE world_players SET coin_balance=12300,troop_cards='{\"tanque\":40}',army_level=3,troop_levels='{\"tanque\":3}',battles_completed=35 WHERE id=$1",[id]);
  await db.pool.query("UPDATE world_areas SET owner_id=$1,conquered_at=now(),cpu_reward_claimed=true WHERE id='se-agreste'",[id]);
  await db.pool.query("INSERT INTO world_coin_ledger(id,player_id,battle_id,kind,amount,created_at) VALUES($1,$2,$3,'cpu_reward',25000,now())",[randomUUID(),id,battle.id]);
  await db.pool.query("INSERT INTO world_battle_replays(battle_id,engine_version,config,frames,inputs) VALUES($1,'test','{}',0,'[]')",[battle.id]);
  await db.pool.query("INSERT INTO world_daily_rewards(player_id,reward_day,battle_cards,battles) VALUES($1,current_date,10,1) ON CONFLICT(player_id,reward_day) DO UPDATE SET battle_cards=10,battles=1",[id]);
  const accounts=(await db.pool.query('SELECT id,username,display_name,password_hash,friend_code,created_at FROM world_players ORDER BY id')).rows;
  const answers=(await db.pool.query('SELECT * FROM world_difficulty_surveys ORDER BY id')).rows;
  await t.test('preview is read-only and a partial failure rolls the entire reset back',async()=>{
   const before=await previewReset(db.pool);assert.equal(before.battles,1);assert.equal(before.answered_surveys,1);assert.equal(before.friendships,1);assert.equal((await previewReset(db.pool)).battles,1);
   const failingPool={async connect(){const c=await db.pool.connect();return{release:()=>c.release(),query(sql){if(sql.startsWith('UPDATE world_players SET coin_balance=0'))throw Error('Injected failure');return c.query(sql);}};}};
   await assert.rejects(resetBattles(failingPool),/Injected failure/);assert.deepEqual(await previewReset(db.pool),before);assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM world_reset_events')).rows[0].n,0);
  });
  await t.test('successful reset preserves all survey fields and frozen context without keeping match records',async()=>{
   const after=await resetBattles(db.pool);assert.equal(after.accounts,2);assert.equal(after.friendships,1);assert.equal(after.surveys,1);assert.equal(after.answered_surveys,1);
   for(const key of ['battles','replays','upgrades','occupied_areas'])assert.equal(after[key],0);assert.equal(BigInt(after.stored_coin_hundredths),0n);
   assert.deepEqual((await db.pool.query('SELECT id,username,display_name,password_hash,friend_code,created_at FROM world_players ORDER BY id')).rows,accounts);
   assert.deepEqual((await db.pool.query('SELECT * FROM world_difficulty_surveys ORDER BY id')).rows,answers);
   assert.equal(answers[0].battle_id,battle.id);assert.equal(answers[0].battle_context.status,'abandoned');assert(answers[0].battle_context.result.balance.config);
   const player=(await db.pool.query('SELECT * FROM world_players WHERE id=$1',[id])).rows[0];assert.equal(player.battles_completed,0);assert.deepEqual(player.troop_cards,{});assert(Object.values(player.troop_levels).every(n=>n===1));assert.deepEqual(player.ground_loadout,['tanque']);assert.equal(player.army_formations.length,1);
  });
  await t.test('restarting and resetting again never removes preserved surveys or restores old gameplay',async()=>{
   const restarted=await createApplication({pool:db.pool,worldOptions:{startClock:false}});try{const world=await restarted.world.world({id,display_name:'Reset Hero',username:'resethero'});assert.equal(world.wallet.balance,0);assert.equal(world.history.length,0);assert(world.areas.every(a=>!a.owner_id));}finally{await restarted.close();}
   await resetBattles(db.pool);assert.deepEqual((await db.pool.query('SELECT * FROM world_difficulty_surveys ORDER BY id')).rows,answers);assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM world_reset_events')).rows[0].n,2);
  });
  await t.test('only-accounts reset removes surveys and friendships while preserving registrations and login',async()=>{
   await db.pool.query("UPDATE world_players SET tutorial_phase='done',tutorial_step=30");
   const before=await previewReset(db.pool);
   const failingPool={async connect(){const c=await db.pool.connect();return{release:()=>c.release(),query(sql){if(sql.startsWith('UPDATE world_players SET coin_balance=0'))throw Error('Injected failure');return c.query(sql);}};}};
   await assert.rejects(resetBattles(failingPool,{onlyAccounts:true}),/Injected failure/);
   assert.deepEqual(await previewReset(db.pool),before);
   const after=await resetBattles(db.pool,{onlyAccounts:true});assert.equal(after.accounts,2);
   for(const key of ['battles','replays','upgrades','occupied_areas','surveys','answered_surveys','friendships'])assert.equal(after[key],0);
   assert.deepEqual((await db.pool.query('SELECT id,username,display_name,password_hash,friend_code,created_at FROM world_players ORDER BY id')).rows,accounts);
   assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM world_players WHERE tutorial_phase='training' AND tutorial_step=0")).rows[0].n,2);
   assert.equal((await db.pool.query("SELECT before_counts->>'mode' AS mode FROM world_reset_events ORDER BY id DESC LIMIT 1")).rows[0].mode,'only_accounts');
   const restarted=await createApplication({pool:db.pool,worldOptions:{startClock:false}});
   try{
    await new Promise(r=>restarted.server.listen(0,'127.0.0.1',r));
    const login=await fetch('http://127.0.0.1:'+restarted.server.address().port+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'resethero',password:'reset-test-password'})});
    assert.equal(login.status,200);assert.equal((await login.json()).player.id,id);
    const world=await restarted.world.world({id,display_name:'Reset Hero',username:'resethero'});
    assert.equal(world.wallet.balance,0);assert.equal(world.history.length,0);assert.equal(world.difficultySurveys.length,0);assert(world.areas.every(a=>!a.owner_id));
   }finally{await restarted.close();}
  });
 }finally{await app.close();await db.destroy();}
});

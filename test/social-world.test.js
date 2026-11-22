'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{WebSocket}=require('ws');
const {createApplication}=require('../server'),{postgres}=require('./postgres'),factory=require('../server/battle-engine'),{createBrowserBattle}=require('../shared/browser-battle'),{createReplay}=require('../shared/battle-replay');
test('friends require mutual consent; history and replays use actual persisted combat',async t=>{
 const db=await postgres();let now=Date.now();const app=await createApplication({pool:db.pool,worldOptions:{startClock:false,now:()=>now}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 async function api(path,p,body){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(p?{Cookie:p.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 async function register(username){const r=await api('/api/auth/register',null,{username,name:username,password:'social-test-password'});return {...r.data.player,cookie:r.cookie};}
 const hero=await register('socialhero'),bob=await register('socialbob'),stranger=await register('socialstranger'),list=async p=>(await api('/api/world/friends',p)).data;let friendship,socket;
 try{
  await t.test('public invite codes support bounded search without exposing private resources',async()=>{
   assert.equal((await api('/api/world/friends')).status,401);const mine=await list(hero);assert.match(mine.code,/^[A-F0-9]{10}$/);assert.deepEqual(mine.friends,[]);
   const search=(await api('/api/world/friends/search?q='+mine.code,bob)).data.players;assert.equal(search[0].id,hero.id);assert(!JSON.stringify(search).includes('password'));assert(!JSON.stringify(search).includes('coin_balance'));
   assert.equal((await api('/api/world/friends/search?q=x',hero)).status,400);assert.deepEqual((await api('/api/world/friends/search?q='+encodeURIComponent('%_'),hero)).data.players,[]);
   assert.equal((await api('/api/world/friends/request',hero,{playerId:hero.id})).status,400);assert.equal((await api('/api/world/friends/request',hero,{playerId:randomUUID()})).status,404);
  });
  await t.test('simultaneous reciprocal requests produce one pending relationship, never automatic friendship',async()=>{
   const responses=await Promise.all([api('/api/world/friends/request',hero,{playerId:bob.id}),api('/api/world/friends/request',bob,{playerId:hero.id})]);assert(responses.every(r=>r.status===200));assert.equal(responses[0].data.id,responses[1].data.id);friendship=responses[0].data.id;
   const stored=(await db.pool.query('SELECT * FROM world_friendships WHERE id=$1',[friendship])).rows[0],sender=stored.requester_id===hero.id?hero:bob,recipient=sender===hero?bob:hero;
   assert.equal((await list(hero)).friends.length,0);assert.equal((await api('/api/world/friends/'+friendship+'/accept',sender,{})).status,403);assert.equal((await api('/api/world/friends/'+friendship+'/accept',stranger,{})).status,404);
   assert.equal((await api('/api/world/friends/'+friendship+'/accept',recipient,{})).status,200);assert.equal((await api('/api/world/friends/'+friendship+'/accept',recipient,{})).status,200);
   assert.equal((await list(hero)).friends[0].player.id,bob.id);assert.equal((await list(bob)).friends[0].player.id,hero.id);
  });
  await t.test('friends see real online and combat presence; public profiles omit wallet, cards and private history',async()=>{
   socket=new WebSocket(base.replace('http','ws')+'/api/world/socket',{headers:{Cookie:bob.cookie}});await new Promise((resolve,reject)=>{socket.on('message',raw=>{if(JSON.parse(raw).type==='ready')resolve();});socket.on('error',reject);});
   assert.equal((await list(hero)).friends[0].player.online,true);
   const battle=(await api('/api/world/areas/se-agreste/attack',bob,{})).data;assert.equal((await list(hero)).friends[0].player.inBattle,true);
   const p=(await api('/api/world/friends/players/'+bob.id,hero)).data;assert.equal(p.name,bob.name);assert(!('wallet' in p));assert(!('troop_cards' in p));assert(!('matches' in p));
   await api('/api/world/battles/'+battle.id+'/surrender',bob,{});assert.equal((await list(hero)).friends[0].player.inBattle,false);socket.close();await new Promise(r=>socket.once('close',r));assert.equal((await list(hero)).friends[0].player.online,false);
  });
  await t.test('recipients can reject, senders can cancel, only members can remove an accepted friend',async()=>{
   const pending=(await api('/api/world/friends/request',hero,{playerId:stranger.id})).data.id;
   assert.equal((await api('/api/world/friends/'+pending+'/reject',hero,{})).status,403);assert.equal((await api('/api/world/friends/'+pending+'/cancel',stranger,{})).status,403);assert.equal((await api('/api/world/friends/'+pending+'/reject',stranger,{})).status,200);
   const again=(await api('/api/world/friends/request',hero,{playerId:stranger.id})).data.id;assert.equal((await api('/api/world/friends/'+again+'/cancel',hero,{})).status,200);
   assert.equal((await api('/api/world/friends/'+friendship+'/remove',stranger,{})).status,404);assert.equal((await api('/api/world/friends/'+friendship+'/remove',hero,{})).status,200);assert.deepEqual((await list(bob)).friends,[]);
  });
  await t.test('a validated completed battle is recorded with frozen armies, rewards and reproducible input log',async()=>{
   const record=(await api('/api/world/areas/se-litoral-sul/attack',hero,{})).data,battle=app.world.battles.get(record.id);battle.config.maxSeconds=31;
   const runner=createBrowserBattle(factory,{config:battle.config});for(let i=0;i<40;i++)runner.advance(1/30);
   const snap=runner.snapshot(),source=snap.sites.find(s=>s.owner===1),target=snap.sites.find(s=>s.owner!==1&&s.id!==source.id);
   const command=(await api('/api/world/battles/'+record.id+'/commands',hero,{type:'send',nonce:randomUUID(),sources:[source.id],target:target.id})).data;runner.input(command.input);
   for(let i=0;i<1100&&!runner.over;i++)runner.advance(1/30);now+=35000;const completion=runner.completion();
   const result=await api('/api/world/battles/'+record.id+'/complete',hero,completion);assert.equal(result.status,200);await api('/api/world/battles/'+record.id+'/complete',hero,completion);
   const history=(await api('/api/world/history?scope=mine',hero)).data;assert.equal(history.matches.length,1);const m=history.matches[0];assert.equal(m.id,record.id);assert.equal(m.context,'cpu');assert.equal(m.canReplay,true);assert.equal(m.roster[0].troops.tanque.level,1);assert.equal(m.coinChange,result.data.economy.participants.find(p=>p.playerId===hero.id).change);
   assert.equal((await api('/api/world/history?scope=mine',bob)).data.matches.length,1,'different player has only their own earlier surrender');assert.equal((await api('/api/world/history?scope=mine')).status,401);assert.equal((await api('/api/world/history?scope=world')).data.pagination.total,2);
   assert.equal((await api('/api/world/replays/'+record.id)).status,401);const replayRecord=(await api('/api/world/replays/'+record.id,hero)).data,playback=createReplay(factory,replayRecord);
   playback.advance(replayRecord.frames);assert.deepEqual(playback.snapshot(),runner.snapshot());assert.equal(playback.over,true);
   const counts=await db.pool.query('SELECT count(*)::int AS n FROM world_battle_replays');assert.equal(counts.rows[0].n,1);
   const resumed=await createApplication({pool:db.pool,worldOptions:{startClock:false}});try{assert.equal((await resumed.world.world(hero)).player.id,hero.id);}finally{await resumed.close();}
  });
  await t.test('history pagination and unavailable replay are explicit for old or interrupted records',async()=>{
   for(let i=0;i<12;i++){const id=randomUUID();await db.pool.query("INSERT INTO world_battles(id,area_id,attacker_id,area_version,status,defense_share,expires_at,finished_at,result) VALUES($1,'se-agreste',$2,0,'interrupted',.4,now(),now(),'{}')",[id,hero.id]);}
   const a=(await api('/api/world/history?scope=mine&page=1',hero)).data,b=(await api('/api/world/history?scope=mine&page=2',hero)).data;assert.equal(a.matches.length,10);assert.equal(b.matches.length,3);assert.equal(new Set([...a.matches,...b.matches].map(m=>m.id)).size,13);assert(a.matches.some(m=>m.outcome==='cancelled'&&!m.canReplay));
   const old=a.matches.find(m=>!m.canReplay);assert.equal((await api('/api/world/replays/'+old.id,hero)).status,404);
   for(const query of ['scope=invalid','page=0','page=-1','page=1.5'])assert.equal((await api('/api/world/history?'+query,hero)).status,400);
  });
 }finally{socket?.terminate();await app.close();await db.destroy();}
});

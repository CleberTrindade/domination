'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createApplication}=require('../server'),{postgres}=require('./postgres');
const factory=require('../server/battle-engine'),{createBrowserBattle}=require('../shared/browser-battle');
test('real API rejects invented cards, spends both resources atomically and rewards only replayed combat',async t=>{
 const db=await postgres(),pool=db.pool;let clock=Date.now();const app=await createApplication({pool,worldOptions:{startClock:false,now:()=>clock}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 async function api(path,cookie,body){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
 const registered=await api('/api/auth/register',null,{username:'cardapiplayer',name:'Card Player',password:'card-api-test-password'}),hero={...registered.data.player,cookie:registered.cookie};
 const view=async()=>(await api('/api/world',hero.cookie)).data;
 try{
  await t.test('new accounts have no invented card grant and cannot bypass card requirements',async()=>{
   const w=await view();assert.equal(w.army.troops.tanque.cards,0);assert.equal(w.army.troops.tanque.nextCards,10);assert.equal(w.army.troops.tanque.canUpgrade,false);assert.equal(w.dailyRewards.total,0);
   assert.equal((await api('/api/world/army/upgrade',hero.cookie,{troopKind:'tanque',expectedLevel:1,requestId:randomUUID(),cards:999,nextCards:0})).status,409);assert.equal((await view()).wallet.balance,1000);
  });
  await t.test('concurrent purchases consume exactly the selected ten cards and 100 coins once',async()=>{
   await pool.query('UPDATE world_players SET troop_cards=$2::jsonb WHERE id=$1',[hero.id,JSON.stringify({tanque:10,heli:9})]);
   const request={troopKind:'tanque',expectedLevel:1,requestId:randomUUID()},responses=await Promise.all([api('/api/world/army/upgrade',hero.cookie,request),api('/api/world/army/upgrade',hero.cookie,request)]);assert(responses.every(r=>r.status===200));
   const w=await view();assert.equal(w.wallet.balance,900);assert.equal(w.army.troops.tanque.level,2);assert.equal(w.army.troops.tanque.cards,0);assert.equal(w.army.troops.heli.cards,9);assert.equal(w.army.troops.heli.level,1);
   assert.equal((await pool.query('SELECT cards_spent FROM world_army_upgrades WHERE id=$1',[request.requestId])).rows[0].cards_spent,10);
  });
  await t.test('server replay computes card rewards; invented client objectives never enter the counters',async()=>{
   const record=(await api('/api/world/areas/se-agreste/attack',hero.cookie,{})).data,battle=app.world.battles.get(record.id);battle.config.maxSeconds=31;
   const runner=createBrowserBattle(factory,{config:battle.config});for(let i=0;i<100;i++)runner.advance(1/30);
   const geometry=factory.createBattle(battle.config).checkpoint().sites,hx=factory.maps.geometry(battle.config.mapId),source=geometry.find(s=>s.owner===1),target=geometry.find(s=>s.owner===0&&hx.comp[s.cell]===hx.comp[source.cell]);
   const command=(await api('/api/world/battles/'+record.id+'/commands',hero.cookie,{type:'send',nonce:randomUUID(),sources:[source.id],target:target.id})).data;assert(runner.input(command.input));
   for(let i=0;i<1060;i++)runner.advance(1/30);clock+=36000;
   const before=(await view()).army.troops;
   const result=await api('/api/world/battles/'+record.id+'/complete',hero.cookie,{...runner.completion(),objectives:{1:{orders:999,captured:[0,1,2,3,4,5]}},cardRewards:{tanque:9999}});assert.equal(result.status,200);const reward=result.data.cardRewards.find(p=>p.playerId===hero.id);assert.equal(reward.battleCards,5);assert.equal(reward.missionCards,0);
   const w=await view();assert.equal(w.dailyRewards.total,5);assert.equal(w.dailyRewards.missions.find(m=>m.id==='captures').progress,Math.min(5,runner.snapshot().objectives[1].captured.length),'mission progress comes from actual captures in the replay');assert(w.dailyRewards.missions.find(m=>m.id==='captures').progress<5,'invented captures do not complete the mission');
   for(const [kind,n]of Object.entries(reward.cards))assert.equal(w.army.troops[kind].cards,before[kind].cards+n);
   await api('/api/world/battles/'+record.id+'/complete',hero.cookie,runner.completion());assert.equal((await view()).dailyRewards.total,5);
   const resumed=await createApplication({pool,worldOptions:{startClock:false,now:()=>clock}});try{const w=await resumed.world.world(hero);assert.equal(w.dailyRewards.total,5);}finally{await resumed.close();}
  });
 }finally{await app.close();await db.destroy();}
});

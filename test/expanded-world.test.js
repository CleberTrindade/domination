'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createApplication}=require('../server'),{postgres}=require('./postgres');
const rules=require('../shared/troop-rules'),factory=require('../server/battle-engine');
const {createBrowserBattle}=require('../shared/browser-battle');
test('expanded armies enforce unlocks, persist formations and count only verified active battles once',async t=>{
 const db=await postgres(),pool=db.pool;let clock=Date.now();const app=await createApplication({pool,worldOptions:{startClock:false,now:()=>clock}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 async function api(path,cookie,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 async function register(name){const r=await api('/api/auth/register',null,{username:name,name,password:'expanded-test-password'});assert.equal(r.status,200);return{...r.data.player,cookie:r.cookie};}
 const view=async p=>(await api('/api/world',p.cookie)).data;
 const upgrade=(p,kind,level)=>api('/api/world/army/upgrade',p.cookie,{troopKind:kind,expectedLevel:level,requestId:randomUUID()});
 try{
  const [hero,rival,third]=await Promise.all(['expandedhero','expandedrival','expandedthird'].map(register));
  await t.test('guest and new accounts see all eleven types but cannot buy or equip locked troops',async()=>{
   const guest=(await api('/api/world')).data;assert.equal(guest.troops.length,11);assert.equal(guest.troops.filter(t=>t.locked).length,6);
   const world=await view(hero);assert.equal(world.army.commander.level,1);assert.deepEqual(world.army.loadout,['tanque']);
   assert.equal((await upgrade(hero,'batedor',1)).status,409);assert.equal((await api('/api/world/army/loadout',hero.cookie,{troops:['batedor']})).status,409);
   assert.equal((await api('/api/world/army/loadout',hero.cookie,{troops:['tanque','tanque']})).status,400);
   assert.equal((await api('/api/world/army/loadout',hero.cookie,{troops:['heli']})).status,409);
   assert.equal((await api('/api/world/army/loadout',hero.cookie,{troops:[]})).status,400);assert.equal((await view(hero)).wallet.balance,1000);
  });
  await t.test('independent unlocks and saved formations cannot rewrite armies already in a battle',async()=>{
   const levels=Object.fromEntries(rules.KINDS.map(k=>[k,7]));
   await pool.query('UPDATE world_players SET battles_completed=250,troop_levels=$2::jsonb,coin_balance=9990000 WHERE id=$1',[hero.id,JSON.stringify(levels)]);
   const army=(await view(hero)).army;assert.equal(army.commander.level,7);assert(!Object.values(army.troops).some(t=>t.locked));
   assert.equal((await api('/api/world/army/loadout',hero.cookie,{troops:['batedor','foguetes','artilharia']})).status,200);
   const record=(await api('/api/world/areas/se-agreste/attack',hero.cookie,{})).data;assert.deepEqual(record.config.attackerLoadout,['batedor','foguetes','artilharia']);assert.deepEqual(record.config.defenderLoadout,record.config.attackerLoadout);assert.equal(record.snapshot.sites[4].kind,'batedor');
   assert.equal((await api('/api/world/army/loadout',hero.cookie,{troops:['blindado','engenheiro','antiaereo']})).status,200);
   assert.equal((await upgrade(hero,'batedor',7)).status,200);
   const frozen=(await api('/api/world/battles/'+record.id,hero.cookie)).data;assert.equal(frozen.config.attackerTroops.batedor.level,7);assert.deepEqual(frozen.config.attackerLoadout,record.config.attackerLoadout);
   assert.equal((await api('/api/world/battles/'+record.id+'/surrender',hero.cookie,{})).status,200);assert.equal((await view(hero)).army.commander.battles,250,'surrender must not advance unlock counters');
  });
  await t.test('verified outcomes count active attackers once and do not advance an offline defender',async()=>{
   await pool.query("UPDATE world_areas SET owner_id=$1 WHERE id='se-aracaju'",[rival.id]);
   const record=(await api('/api/world/areas/se-aracaju/attack',third.cookie,{})).data,battle=app.world.battles.get(record.id);
   battle.config.maxSeconds=31;const runner=createBrowserBattle(factory,{config:battle.config});
   for(let i=0;i<1060;i++)runner.advance(1/30);clock+=36000;
   const result=await api('/api/world/battles/'+record.id+'/complete',third.cookie,runner.completion());assert.equal(result.status,200);
   assert.equal((await view(third)).army.commander.battles,1);assert.equal((await view(rival)).army.commander.battles,0);
   assert.equal((await api('/api/world/battles/'+record.id+'/complete',third.cookie,runner.completion())).status,200);assert.equal((await view(third)).army.commander.battles,1,'repeated completion must not duplicate progress');
  });
 }finally{await app.close();await db.destroy();}
});

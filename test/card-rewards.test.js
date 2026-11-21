'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {postgres}=require('./postgres'),{migrate}=require('../server/database');
const {REWARD_RULES,rewardDay,dailyView,drawCards,awardBattleCards,readDaily}=require('../server/card-rewards');
const {ARMY_RULES,cardsNeeded,armyView}=require('../server/progression');
const {productionFor,projectWallet}=require('../server/economy');
const rules=require('../shared/troop-rules');
test('costs total 2,100 individual cards and 43,850 coins; production has diminishing returns and a hard daily cap',()=>{
 assert.equal(cardsNeeded(1),2100);assert.equal(cardsNeeded(9),750);assert.equal(cardsNeeded(10),0);
 assert.equal(ARMY_RULES.upgradeCosts.reduce((a,b)=>a+b,0),43850);
 for(const [areas,daily]of [[0,0],[1,1000],[5,5000],[6,5500],[10,7500],[11,7750],[20,10000],[100,10000]]){
  assert.equal(productionFor(areas),daily);
  assert.equal(projectWallet({id:'p',coin_balance:0,coin_income_at:0,coin_income_remainder:0,owned:areas},86400000).balance,BigInt(daily)*100n);
 }
 const wallet={level:1,levels:{tanque:1},cards:{tanque:9}};assert(!armyView(wallet,100000n,0).troops.tanque.canUpgrade);
 wallet.cards.tanque=10;assert(armyView(wallet,10000n,0).troops.tanque.canUpgrade);assert(!armyView(wallet,9900n,0).troops.tanque.canUpgrade);
});
test('random draws use only unlocked types and stop at the remaining lifetime card requirement',()=>{
 const levels=Object.fromEntries(rules.KINDS.map(k=>[k,1])),wallet={levels,battles:0,cards:{}};
 const first=drawCards(wallet,120,n=>n-1);assert.equal(first.cards.central,120);assert.equal(first.total,120);assert(!first.cards.artilharia);
 levels.tanque=9;wallet.cards.tanque=749;
 const draw=drawCards(wallet,100,()=>0);assert.equal(draw.cards.tanque,1);assert.equal(draw.cards.desliz,99);assert.equal(wallet.cards.tanque,749,'draws never mutate the caller');
 const full={levels:Object.fromEntries(rules.KINDS.map(k=>[k,10])),battles:250,cards:{}};assert.equal(drawCards(full,120).total,0);
 const ready={levels:Object.fromEntries(rules.KINDS.map(k=>[k,1])),battles:0,cards:Object.fromEntries(rules.CORE.map(k=>[k,2100]))};assert.equal(drawCards(ready,120).total,0,'fully collected types are excluded before spending the upgrade gold');
});
test('daily reset follows Fortaleza midnight, with no dependence on host time zone',()=>{
 assert.equal(rewardDay(Date.parse('2026-11-22T02:59:59Z')),'2026-11-21');assert.equal(rewardDay(Date.parse('2026-11-22T03:00:00Z')),'2026-11-22');
 assert.equal(dailyView(null,Date.parse('2026-11-22T02:59:59Z')).resetsAt,'2026-11-22T03:00:00.000Z');
 assert.equal(REWARD_RULES.missions.length,3);
});
test('Postgres reward transactions cap both sources, persist per-type cards, block repeats and reset only daily progress',async t=>{
 const db=await postgres(),pool=db.pool;await migrate(pool);const player=randomUUID(),rival=randomUUID();let at=Date.parse('2026-11-21T16:00:00Z');
 for(const [id,name]of [[player,'rewardhero'],[rival,'rewardrival']])await pool.query('INSERT INTO world_players(id,username,display_name,password_hash) VALUES($1,$2,$2,$3)',[id,name,'fixture']);
 async function award({area='se-agreste',won=true,active=40,orders=1,captures=[0,1],forfeited=[],status='won',id=randomUUID(),human=false}={}){
  await pool.query("INSERT INTO world_battles(id,area_id,attacker_id,defender_id,area_version,status,defense_share,started_at,finished_at,expires_at) VALUES($1,$2,$3,$4,0,$5,.2,$6,$6,$6) ON CONFLICT DO NOTHING",[id,area,player,human?rival:null,status,new Date(at).toISOString()]);
  const connection=await pool.connect();await connection.query('BEGIN');try{
   const roster=[{playerId:player,owner:1},...(human?[{playerId:rival,owner:2}]:[])];
   const results=await awardBattleCards(connection,{id,areaId:area},roster,{status,winnerOwner:won?1:2,verified:{participation:{1:active,2:human?40:0},objectives:{1:{orders,captured:captures},2:{orders:1,captured:[]}},forfeited},at});
   await connection.query('COMMIT');return {id,results};
  }catch(e){await connection.query('ROLLBACK');throw e;}finally{connection.release();}
 }
 const amount=r=>r.battleCards+r.missionCards;
 try{
  await t.test('invalid activity, no executed commands and abandoned participants get no cards or objective progress',async()=>{
   for(const options of [{active:29},{orders:0},{forfeited:[1]},{status:'abandoned'},{status:'interrupted'}]){const r=(await award(options)).results[0];assert.equal(amount(r),0);}
   const d=await readDaily(pool,player,at);assert.equal(d.total,0);assert(d.missions.every(m=>m.progress===0));
  });
  await t.test('a win awards 10 random cards plus the one-win objective, and the exact result is idempotent',async()=>{
   const first=await award();assert.equal(first.results[0].battleCards,10);assert.equal(first.results[0].missionCards,20);assert.deepEqual(first.results[0].missions,['wins']);
   assert.equal(Object.values(first.results[0].cards).reduce((a,b)=>a+b,0),30);
   assert.deepEqual((await award({id:first.id})).results[0].cards,first.results[0].cards);
   const d=await readDaily(pool,player,at);assert.equal(d.total,30);assert.equal(d.missions.find(m=>m.id==='battles').progress,1);
  });
  await t.test('five distinct enemy-base captures and three battles automatically award the other objectives',async()=>{
   await award({captures:[0,0,1]});const third=(await award()).results[0];assert.equal(third.missionCards,40);assert.equal(third.battleCards,10);
   const d=await readDaily(pool,player,at);assert.equal(d.total,90);assert(d.missions.every(m=>m.completed));
  });
  await t.test('a fourth repeat is excluded; other CPU areas can finish the battle quota without duplicating objectives',async()=>{
   assert.equal((await award()).results[0].reason,'repeated_opponent');
   for(let i=0;i<3;i++)await award({area:'se-litoral-sul'});
   const d=await readDaily(pool,player,at);assert.equal(d.battleCards,60);assert.equal(d.missionCards,60);assert.equal(d.total,120);
   const r=(await award({area:'se-alto-sertao'})).results[0];assert.equal(amount(r),0);assert.equal((await readDaily(pool,player,at)).total,120);
   const balances=(await pool.query('SELECT troop_cards FROM world_players WHERE id=$1',[player])).rows[0].troop_cards;assert.equal(Object.values(balances).reduce((a,b)=>a+b,0),120);assert(Object.keys(balances).every(k=>rules.CORE.includes(k)));
  });
  await t.test('next-day losses give five cards and both human participants have independent counters',async()=>{
   at=Date.parse('2026-11-22T03:00:00Z');const r=await award({won:false,status:'lost',human:true});assert.equal(r.results.find(x=>x.playerId===player).battleCards,5);assert.equal(r.results.find(x=>x.playerId===rival).battleCards,10);
   const d=await readDaily(pool,player,at);assert.equal(d.total,5);assert.equal(d.missions[0].progress,1);assert.equal(d.missions.find(m=>m.id==='wins').progress,0);
   assert.equal(Object.values((await pool.query('SELECT troop_cards FROM world_players WHERE id=$1',[player])).rows[0].troop_cards).reduce((a,b)=>a+b,0),125);
  });
  await t.test('a failed result transaction leaves no cards, daily progress or reward receipt behind',async()=>{
   const before=(await readDaily(pool,player,at)).total,connection=await pool.connect(),id=randomUUID();
   await connection.query('BEGIN');try{
    await connection.query("INSERT INTO world_battles(id,area_id,attacker_id,area_version,status,defense_share,started_at,finished_at,expires_at) VALUES($1,'se-agreste',$2,0,'won',.2,$3,$3,$3)",[id,player,new Date(at).toISOString()]);
    await awardBattleCards(connection,{id,areaId:'se-agreste'},[{playerId:player,owner:1}],{status:'won',winnerOwner:1,verified:{participation:{1:40},objectives:{1:{orders:2,captured:[1,2,3]}}},at});
    await connection.query('ROLLBACK');
   }finally{connection.release();}
   assert.equal((await readDaily(pool,player,at)).total,before);assert.equal((await pool.query('SELECT count(*)::int AS n FROM world_card_rewards WHERE battle_id=$1',[id])).rows[0].n,0);
  });
 }finally{await db.destroy();}
});
test('migration preserves existing levels, balances and all income earned before tiered production begins',async()=>{
 const fs=require('node:fs'),path=require('node:path'),db=await postgres(),pool=db.pool,folder=path.join(__dirname,'../server/migrations');
 try{
  await pool.query('CREATE TABLE world_migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now())');
  for(const name of fs.readdirSync(folder).filter(n=>n.endsWith('.sql')&&n<'011').sort()){await pool.query(fs.readFileSync(path.join(folder,name),'utf8'));await pool.query('INSERT INTO world_migrations(name) VALUES($1)',[name]);}
  const id=randomUUID();await pool.query("INSERT INTO world_players(id,username,display_name,password_hash,army_level,coin_income_at) VALUES($1,'oldcardowner','Existing','fixture',4,now()-interval '1 day')",[id]);
  for(let i=0;i<20;i++)await pool.query('INSERT INTO world_areas(id,name,ordinal,description,cpu_share,owner_id) VALUES($1,$1,$2,$1,.32,$3)',['migration-area-'+i,100+i,id]);
  await migrate(pool);const row=(await pool.query('SELECT * FROM world_players WHERE id=$1',[id])).rows[0];
  assert.equal(row.army_level,4);assert.equal(row.troop_levels,null);assert.deepEqual(row.troop_cards,{});assert(BigInt(row.coin_balance)>=2100000n&&BigInt(row.coin_balance)<2100100n,'all twenty thousand old-rate coins are credited');
  const next=projectWallet({...row,owned:20},new Date(row.coin_income_at).getTime()+86400000);assert.equal(next.balance-BigInt(row.coin_balance),1000000n,'only future income uses the new ten-thousand cap');
  await migrate(pool);const again=(await pool.query('SELECT coin_balance,coin_income_at FROM world_players WHERE id=$1',[id])).rows[0];assert.equal(again.coin_balance,row.coin_balance);assert.equal(String(again.coin_income_at),String(row.coin_income_at));
 }finally{await db.destroy();}
});
test('engine objectives exclude neutral bases, count enemy positions once and survive reconnection',()=>{
 const factory=require('../server/battle-engine'),engine=factory.createBattle({balanceVersion:'troops-v3',mapId:'crossroads-v1',centralOwner:2,defenderBaseCount:3,seed:7}),saved=engine.checkpoint();saved.cd=0;for(const p of Object.values(saved.par))p.prod=0;for(const ai of saved.ais)ai.timer=1000;
 const target=saved.sites.find(s=>s.owner===0);
 function arrival(checkpoint,owner){const b=checkpoint.sites[target.id];b.owner=owner;b.troops=1;checkpoint.units=[{id:1,k:'heli',owner:1,n:500,P:[[b.x-1,b.y],[b.x,b.y]],cum:[0,1],L:1,d:0,si:0,toId:b.id,x:b.x-1,y:b.y,alive:true}];const restored=factory.restoreBattle(checkpoint);restored.step(1/30);return restored;}
 const neutral=arrival(saved,0);assert.equal(neutral.snapshot().sites[target.id].owner,1);assert.deepEqual(neutral.snapshot().objectives[1].captured,[]);
 const enemy=arrival(neutral.checkpoint(),2);assert.deepEqual(enemy.snapshot().objectives[1].captured,[target.id]);
 const repeated=arrival(enemy.checkpoint(),2);assert.deepEqual(repeated.snapshot().objectives[1].captured,[target.id]);assert.deepEqual(factory.restoreBattle(repeated.checkpoint()).snapshot().objectives,repeated.snapshot().objectives);
});

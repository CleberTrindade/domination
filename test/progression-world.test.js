'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createApplication}=require('../server'),factory=require('../server/battle-engine');
const {createBrowserBattle}=require('../shared/browser-battle'),{postgres}=require('./postgres');
const {ARMY_RULES}=require('../server/progression');
test('persistent army progression protects money, freezes battle levels and records balancing data',async t=>{
  const database=await postgres(),pool=database.pool;let clock=Date.now();
  const app=await createApplication({pool,worldOptions:{startClock:false,now:()=>clock}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  async function api(path,player,body){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(player?{Cookie:player.cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  async function create(name){const r=await api('/api/auth/register',null,{username:name,name,password:'progression-test-password'});assert.equal(r.status,200);return {...r.data.player,cookie:r.cookie};}
  const world=async player=>(await api('/api/world',player)).data;
  async function funds(player,level=1,coins=1000){await pool.query('UPDATE world_players SET army_level=$2,troop_levels=NULL,troop_cards=$5::jsonb,coin_balance=$3,coin_income_at=$4,coin_income_remainder=0 WHERE id=$1',[player.id,level,coins*100,new Date(clock).toISOString(),JSON.stringify(Object.fromEntries(require('../shared/troop-rules').KINDS.map(k=>[k,2100]))) ]);}
  async function start(area,player){const r=await api('/api/world/areas/'+area+'/attack',player,{});assert.equal(r.status,201,JSON.stringify(r.data));return r.data;}
  const upgrade=(player,expectedLevel,requestId=randomUUID(),extra={})=>api('/api/world/army/upgrade',player,{expectedLevel,requestId,troopKind:'tanque',...extra});
  const surrender=(record,player)=>api('/api/world/battles/'+record.id+'/surrender',player,{});
  let alice,bob,charlie,dana,record;
  try{
    [alice,bob,charlie,dana]=await Promise.all(['armyalice','armybob','armycharlie','armydana'].map(create));
    for(const p of [alice,bob,charlie,dana])await funds(p);
    await t.test('new and existing accounts begin at level one; every area remains available and rewards reflect resistance',async()=>{
      const data=await world(alice);assert.equal(data.army.level,1);assert.equal(data.army.troops.tanque.nextCost,100);assert.equal(data.army.troops.tanque.power,1);
      assert.deepEqual(data.progression.upgradeCosts,[0,0,100,250,500,1000,2000,4000,7000,11000,18000]);
      assert.deepEqual(data.areas.map(a=>a.first_capture_reward),[300,300,450,600,600]);assert(data.areas.every(a=>a.defense_bases===3&&a.map_id&&a.defense_share>0&&a.defense_share<.5));
      assert.equal((await api('/api/world/army/upgrade',null,{requestId:randomUUID(),expectedLevel:1})).status,401);
      record=await start('se-aracaju',alice);assert.equal(record.config.defenderBaseCount,3);assert.equal(record.config.defenderPower,.8);assert.equal(record.economy.cpuReward,600);await surrender(record,alice);
      await funds(alice);
    });
    await t.test('client-supplied costs and levels cannot skip training; retrying one request never charges twice',async()=>{
      const requestId=randomUUID(),responses=await Promise.all([upgrade(alice,1,requestId,{cost:0,toLevel:10,power:999}),upgrade(alice,1,requestId)]);assert(responses.every(r=>r.status===200));
      const data=await world(alice);assert.equal(data.army.level,2);assert.equal(data.wallet.balance,900);assert.equal(data.army.troops.tanque.nextCost,250);
      const rows=(await pool.query('SELECT cost,to_level FROM world_army_upgrades WHERE id=$1',[requestId])).rows;assert.equal(rows.length,1);assert.equal(Number(rows[0].cost),10000);assert.equal(rows[0].to_level,2);
      assert.equal((await upgrade(bob,1,requestId)).status,403);assert.equal((await world(bob)).wallet.balance,1000);
      assert.equal(data.wallet.entries.filter(e=>e.kind==='army_upgrade').length,1);
    });
    await t.test('concurrent distinct requests for the same level produce only one purchase',async()=>{
      const responses=await Promise.all([upgrade(bob,1),upgrade(bob,1)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal((await world(bob)).wallet.balance,900);
      assert.equal((await world(bob)).army.level,2);assert.equal((await upgrade(bob,99)).status,409);
    });
    await t.test('training may spend the last available coin without an attack budget, with or without territory',async()=>{
      await funds(dana,1,100);assert.equal((await world(dana)).army.troops.tanque.canUpgrade,true);assert.equal((await upgrade(dana,1)).status,200);assert.equal((await world(dana)).wallet.balance,0);
      record=await start('se-agreste',dana);assert.equal(record.economy.atRisk,0);assert.equal(record.economy.cpuReward,0);await surrender(record,dana);
      await funds(dana,1,100);await pool.query("UPDATE world_areas SET owner_id=$1 WHERE id='se-agreste'",[dana.id]);assert.equal((await upgrade(dana,1,randomUUID(),{troopKind:'heli'})).status,200);assert.equal((await world(dana)).wallet.balance,0);
      await pool.query("UPDATE world_areas SET owner_id=NULL WHERE id='se-agreste'");
    });
    await t.test('reserved stakes cannot be spent; purchases do not change the army already fighting',async()=>{
      await funds(charlie,1,250);record=await start('se-litoral-sul',charlie);assert.equal(record.config.attackerLevel,1);
      assert.equal((await upgrade(charlie,1)).status,200);const data=await world(charlie);assert.equal(data.wallet.balance,150);assert.equal(data.wallet.reserved,100);assert.equal(data.wallet.available,50);
      assert.equal((await upgrade(charlie,2)).status,409);const current=(await api('/api/world/battles/'+record.id,charlie)).data;assert.equal(current.config.attackerLevel,1);assert.equal(current.players[0].level,1);
      await surrender(record,charlie);assert.equal((await world(charlie)).army.level,2);
      await funds(charlie,2,5000);
    });
    await t.test('offline production funds training and is settled once with the purchase',async()=>{
      await funds(dana,2,1000);await pool.query("UPDATE world_areas SET owner_id=$1 WHERE id='se-alto-sertao'",[dana.id]);clock+=86400000;
      assert.equal((await world(dana)).wallet.balance,2000);assert.equal((await upgrade(dana,2)).status,200);
      const data=await world(dana);assert.equal(data.army.level,3);assert.equal(data.wallet.balance,1750);assert(data.wallet.entries.some(e=>e.kind==='army_upgrade'&&e.amount===-250));
      assert(data.wallet.entries.some(e=>e.kind==='production'&&e.amount===1000));await pool.query("UPDATE world_areas SET owner_id=NULL WHERE id='se-alto-sertao'");
    });
    await t.test('a failed purchase rolls back coins, level, audit and ledger; the same request can then retry safely',async()=>{
      const buyer=await create('armyrollback');await funds(buyer,1,1000);const requestId=randomUUID(),connect=pool.connect.bind(pool);let injected=false;
      pool.connect=async()=>{const db=await connect();return {release:db.release,query:async(sql,...args)=>{const result=await db.query(sql,...args);if(!injected&&sql.startsWith('INSERT INTO world_coin_ledger')){injected=true;throw Error('Injected upgrade write failure');}return result;}};};
      try{assert.equal((await upgrade(buyer,1,requestId)).status,503);}finally{pool.connect=connect;}
      assert(injected);assert.equal((await world(buyer)).army.level,1);assert.equal((await world(buyer)).wallet.balance,1000);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM world_army_upgrades WHERE id=$1',[requestId])).rows[0].n,0);
      assert.equal((await upgrade(buyer,1,requestId)).status,200);assert.equal((await world(buyer)).wallet.balance,900);
    });
    await t.test('owner defense freezes its actual level, and entrants bring their own level rather than the host level',async()=>{
      await funds(alice,1,1000);await funds(bob,5,10000);await funds(charlie,10,1000);await pool.query("UPDATE world_areas SET owner_id=$1 WHERE id='se-agreste'",[bob.id]);
      record=await start('se-agreste',alice);assert.equal(record.config.defenderLevel,5);assert.equal(record.config.defenderPower,1.4);
      assert.equal(record.config.attackerPower,1);assert.equal(record.snapshot.sites.filter(s=>s.owner===2).length,4);
      assert.equal((await upgrade(bob,5)).status,200);assert.equal((await world(bob)).army.level,6);
      assert.equal((await api('/api/world/battles/'+record.id+'/defend',bob,{})).data.players[1].level,5);
      const watched=(await api('/api/world/battles/'+record.id,charlie)).data,site=watched.joinableSites.find(s=>s.kind==='H').id;
      assert.equal((await api('/api/world/battles/'+record.id+'/join',charlie,{site,armyLevel:99,armyPower:999})).status,200);
      const battle=app.world.battles.get(record.id),input=[...battle.inputs.values()].find(i=>i.kind==='join');assert.equal(input.armyLevel,10);assert.equal(input.armyPower,1.9);
      const runner=createBrowserBattle(factory,record);for(const ticket of battle.inputs.values())runner.input(ticket);
      await api('/api/world/battles/'+record.id+'/relay',alice,{snapshot:runner.snapshot(),resume:runner.checkpoint(),receipts:[{nonce:input.nonce,accepted:true}]});
      const joined=(await api('/api/world/battles/'+record.id,charlie)).data;assert.equal(joined.players.find(p=>p.owner===3).level,10);assert.equal(joined.snapshot.armies[3].power,1.9);
      assert.equal(factory.restoreBattle(runner.checkpoint().checkpoint).snapshot().armies[2].level,5);
      await api('/api/world/battles/'+record.id+'/release',bob,{});await surrender(record,charlie);await surrender(record,alice);
      const final=(await api('/api/world/battles/'+record.id,alice)).data.final;assert.equal(final.balance.version,'troops-v3');assert.equal(final.balance.defenderParticipated,true);
      const row=(await pool.query('SELECT army_level FROM world_battle_participants WHERE battle_id=$1 AND side=2',[record.id])).rows[0];assert.equal(row.army_level,5);
      const next=await start('se-agreste',alice);assert.equal(next.config.defenderLevel,6);await surrender(next,alice);
    });
    await t.test('level ten is a hard cap and does not debit coins',async()=>{
      await funds(dana,10,100000);const data=await world(dana);assert.equal(data.army.troops.tanque.nextCost,null);assert.equal(data.army.troops.tanque.canUpgrade,false);
      assert.equal((await upgrade(dana,10)).status,409);assert.equal((await world(dana)).wallet.balance,100000);
    });
    await t.test('the complete training sequence reaches level ten for exactly 43,850 coins per type',async()=>{
      const buyer=await create('armyfull');await funds(buyer,1,44000);let spent=0;
      for(let level=1;level<10;level++){const before=await world(buyer),response=await upgrade(buyer,level);assert.equal(response.status,200);assert.equal(response.data.cost,before.army.troops.tanque.nextCost);spent+=response.data.cost;}
      const data=await world(buyer);assert.equal(spent,43850);assert.equal(data.army.level,10);assert.equal(data.army.troops.tanque.power,1.9);assert.equal(data.wallet.balance,150);
    });
    await t.test('a replayed first conquest of a high-resistance CPU area credits 600 and saves army profiles',async()=>{
      const hero=await create('armyhero');await funds(hero,10,1000);const battleRecord=await start('se-aracaju',hero),battle=app.world.battles.get(battleRecord.id),runner=createBrowserBattle(factory,battleRecord);
      // Isolate reward settlement from AI choice. Active-AI combat is covered by
      // engine/prototype parity tests and the recorded balance study.
      const control={nonce:randomUUID(),kind:'control',controlled:true};battle.inputs.set(control.nonce,control);runner.input(control);
      const geometry=factory.createBattle(battleRecord.config).checkpoint().sites;
      for(let frame=0;frame<11000&&!runner.over;frame++){
        if(frame%90===0){const snapshot=runner.snapshot(),mine=snapshot.sites.filter(s=>s.owner===1),enemy=snapshot.sites.filter(s=>s.owner!==1);
          for(const source of mine){if(source.troops<24)continue;const a=geometry[source.id],hx=factory.maps.geometry(battleRecord.config.mapId);for(const target of enemy.filter(t=>['heli','botes'].includes(a.kind)||hx.comp[a.cell]===hx.comp[geometry[t.id].cell]).sort((b,c)=>Math.hypot(a.x-geometry[b.id].x,a.y-geometry[b.id].y)-Math.hypot(a.x-geometry[c.id].x,a.y-geometry[c.id].y))){const input=await api('/api/world/battles/'+battle.id+'/commands',hero,{nonce:randomUUID(),type:'send',sources:[source.id],target:target.id});assert.equal(input.status,200);if(runner.input(input.data.input))break;}}
        }
        runner.advance(1/30);clock+=1000/30;
      }
      assert.equal(runner.snapshot().winnerOwner,1);
      const response=await api('/api/world/battles/'+battle.id+'/complete',hero,{...runner.completion(),armyLevel:999});assert.equal(response.status,200,JSON.stringify(response.data));
      assert.equal(response.data.economy.cpuReward,600);assert.equal(response.data.balance.config.attackerLevel,10);assert.equal((await world(hero)).wallet.balance,1600);
      assert.equal((await pool.query('SELECT army_level FROM world_battle_participants WHERE battle_id=$1 AND side=1',[battle.id])).rows[0].army_level,10);
      await api('/api/world/battles/'+battle.id+'/complete',hero,runner.completion());assert.equal((await world(hero)).wallet.balance,1600);
    });
  }finally{await app.close();await database.destroy();}
});

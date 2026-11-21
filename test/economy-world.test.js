'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createApplication}=require('../server'),factory=require('../server/battle-engine');
const {createBrowserBattle}=require('../shared/browser-battle'),{postgres}=require('./postgres');
test('wallet reservations, offline income and battle settlements are authoritative and atomic',async t=>{
  const database=await postgres(),pool=database.pool;let clock=Date.now();
  const app=await createApplication({pool,worldOptions:{startClock:false,now:()=>clock}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  async function api(path,player,body){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(player?{Cookie:player.cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  async function register(name){const r=await api('/api/auth/register',null,{username:name,name,password:'economy-test-password'});assert.equal(r.status,200);return {...r.data.player,cookie:r.cookie};}
  const [alice,bob,charlie,dana]=await Promise.all(['alice','bob','charlie','dana'].map(register));
  async function reset(){
    assert(![...app.world.battles.values()].some(b=>!b.final));
    await pool.query('UPDATE world_areas SET owner_id=NULL,version=version+1,cpu_reward_claimed=false');
    await pool.query('UPDATE world_players SET coin_balance=100000,coin_income_remainder=0,coin_income_at=$1',[new Date(clock).toISOString()]);
  }
  const world=async player=>(await api('/api/world',player)).data;
  async function owned(area,player){await pool.query('UPDATE world_areas SET owner_id=$2 WHERE id=$1',[area,player.id]);}
  async function start(area,player){const result=await api('/api/world/areas/'+area+'/attack',player,{});assert.equal(result.status,201,JSON.stringify(result.data));return result.data;}
  const surrender=(record,player)=>api('/api/world/battles/'+record.id+'/surrender',player,{});
  async function win(record,player,defender){
    if(defender)await api('/api/world/battles/'+record.id+'/defend',defender,{});
    const battle=app.world.battles.get(record.id),runner=createBrowserBattle(factory,record),geometry=factory.createBattle(record.config).checkpoint().sites;
    // Freeze CPU orders in this isolated fixture; the test concerns settlement,
    // while CPU decisions and real combat are exercised by the engine tests.
    if(!defender){const input={nonce:randomUUID(),kind:'control',controlled:true};battle.inputs.set(input.nonce,input);}
    for(const input of battle.inputs.values())runner.input(input);
    for(let frame=0;frame<11000&&!runner.over;frame++){
      if(frame%90===0){const snapshot=runner.snapshot(),mine=snapshot.sites.filter(s=>s.owner===1),enemy=snapshot.sites.filter(s=>s.owner!==1);
        for(const source of mine){if(source.troops<24)continue;const a=geometry[source.id],hx=factory.maps.geometry(record.config.mapId);for(const target of enemy.filter(t=>['heli','botes'].includes(a.kind)||hx.comp[a.cell]===hx.comp[geometry[t.id].cell]).sort((b,c)=>Math.hypot(a.x-geometry[b.id].x,a.y-geometry[b.id].y)-Math.hypot(a.x-geometry[c.id].x,a.y-geometry[c.id].y))){
          const response=await api('/api/world/battles/'+record.id+'/commands',player,{nonce:randomUUID(),type:'send',sources:[source.id],target:target.id});assert.equal(response.status,200);if(runner.input(response.data.input))break;
        }}
      }
      runner.advance(1/30);clock+=1000/30;
    }
    assert.equal(runner.snapshot().winnerOwner,1);
    const result=await api('/api/world/battles/'+record.id+'/complete',player,runner.completion());assert.equal(result.status,200,JSON.stringify(result.data));return result.data;
  }
  try{
    await t.test('initial grant and offline income are projected without changing stored balances on reads',async()=>{
      await reset();await owned('se-agreste',bob);clock+=86400000;
      const first=await world(bob);assert.equal(first.wallet.balance,2000);assert.equal(first.wallet.productionPerDay,1000);assert.equal(first.wallet.reserved,0);
      assert.equal((await world(bob)).wallet.balance,2000);
      assert.equal(BigInt((await pool.query('SELECT coin_balance FROM world_players WHERE id=$1',[bob.id])).rows[0].coin_balance),100000n);
      assert.equal((await world(alice)).wallet.balance,1000);
    });
    await t.test('zero balance permits attacks, watching, invasion and defense without coin transfers',async()=>{
      await reset();await owned('se-agreste',bob);await pool.query('UPDATE world_players SET coin_balance=0 WHERE id=ANY($1::uuid[])',[[bob.id,charlie.id]]);
      const free=await start('se-agreste',charlie);assert.equal(free.economy.atRisk,0);assert.equal(free.economy.maxLoot,0);await surrender(free,charlie);
      const record=await start('se-agreste',alice),watch=await api('/api/world/battles/'+record.id,charlie);assert.equal(watch.status,200);
      assert.equal((await api('/api/world/battles/'+record.id+'/join',charlie,{site:watch.data.joinableSites[0].id,coins:999999})).status,200);
      const battle=app.world.battles.get(record.id),input=[...battle.inputs.values()].find(i=>i.kind==='join'),runner=createBrowserBattle(factory,record);assert(runner.input(input));
      assert.equal((await api('/api/world/battles/'+record.id+'/relay',alice,{snapshot:runner.snapshot(),resume:runner.checkpoint(),receipts:[{nonce:input.nonce,accepted:true}]})).status,200);
      assert.equal((await api('/api/world/battles/'+record.id,charlie)).data.playerOwner,3);
      assert.equal((await api('/api/world/battles/'+record.id+'/defend',bob,{})).status,200);
      await api('/api/world/battles/'+record.id+'/leave',charlie,{});
      const result=await surrender(record,alice);assert.equal(result.status,200);assert.equal(result.data.economy.transfers.length,0);
      assert.equal((await world(alice)).wallet.balance,1000);assert.equal((await world(bob)).wallet.balance,0);assert.equal((await world(charlie)).wallet.balance,0);
    });
    await t.test('positive balances below 100 use 40 percent rounded down to whole coins',async()=>{
      await reset();await owned('se-agreste',bob);await pool.query('UPDATE world_players SET coin_balance=8000 WHERE id=$1',[alice.id]);
      const record=await start('se-agreste',alice);assert.equal(record.economy.atRisk,32);assert.equal(record.economy.maxLoot,32);
      const final=await surrender(record,alice);assert.equal(final.data.economy.participants.find(p=>p.playerId===alice.id).change,-32);
      assert.equal((await world(alice)).wallet.balance,48);assert.equal((await world(bob)).wallet.balance,1032);
    });
    await t.test('zero-balance CPU capture grants ownership and future income without a battle prize',async()=>{
      await reset();await pool.query('UPDATE world_players SET coin_balance=0 WHERE id=$1',[alice.id]);
      const preview=(await world(alice)).areas.find(a=>a.id==='se-litoral-sul');assert.equal(preview.economy.cpuReward,0);
      const record=await start('se-litoral-sul',alice);assert.equal(record.economy.cpuReward,0);const final=await win(record,alice);
      assert.equal(final.economy.cpuReward,0);assert.equal(final.economy.participants[0].change,0);
      const data=await world(alice);assert.equal(data.wallet.balance,0);assert.equal(data.areas.find(a=>a.id==='se-litoral-sul').owner_id,alice.id);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM world_coin_ledger WHERE battle_id=$1',[record.id])).rows[0].n,0);
      clock+=86400000;assert.equal((await world(alice)).wallet.balance,1000);
    });
    await t.test('several incoming attacks reserve different available funds and repeated completion cannot charge twice',async()=>{
      await reset();await owned('se-agreste',bob);await owned('se-aracaju',bob);
      const a=await start('se-agreste',alice),c=await start('se-aracaju',charlie);
      const before=await world(bob);assert.equal(before.wallet.reserved,640);assert.equal(before.wallet.available,360);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM world_coin_ledger WHERE battle_id=ANY($1::uuid[])',[[a.id,c.id]])).rows[0].n,0);
      const results=await Promise.all([surrender(a,alice),surrender(c,charlie)]);assert(results.every(r=>r.status===200));
      assert.equal((await world(bob)).wallet.balance,1640);assert.equal((await world(alice)).wallet.balance,600);assert.equal((await world(charlie)).wallet.balance,760);
      assert.equal((await world(bob)).wallet.reserved,0);
      await surrender(a,alice);assert.equal((await world(bob)).wallet.balance,1640);
    });
    await t.test('only accepted late entrants reserve coins until the eventual result; rejection frees the reservation',async()=>{
      await reset();await owned('se-agreste',bob);const record=await start('se-agreste',alice),battle=app.world.battles.get(record.id);
      const site=(await api('/api/world/battles/'+record.id,charlie)).data.joinableSites[0].id;
      assert.equal((await api('/api/world/battles/'+record.id+'/join',charlie,{site})).status,200);assert.equal((await world(charlie)).wallet.reserved,400);
      const input=[...battle.inputs.values()].find(i=>i.kind==='join');
      assert.equal((await api('/api/world/battles/'+record.id+'/relay',alice,{snapshot:record.snapshot,receipts:[{nonce:input.nonce,accepted:false}]})).status,200);
      assert.equal((await world(charlie)).wallet.reserved,0);
      await surrender(record,alice);assert.equal((await world(charlie)).wallet.balance,1000);
    });
    await t.test('losing to CPU consumes the reserved stake and records the loss once',async()=>{
      await reset();const record=await start('se-litoral-sul',alice);assert.equal(record.economy.atRisk,400);
      const result=await surrender(record,alice);assert.equal(result.data.economy.participants[0].change,-400);
      assert.equal((await world(alice)).wallet.balance,600);assert.equal((await world(alice)).wallet.reserved,0);
      await surrender(record,alice);assert.equal((await world(alice)).wallet.balance,600);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM world_coin_ledger WHERE battle_id=$1 AND kind='cpu_loss'",[record.id])).rows[0].n,1);
    });
    await t.test('a failed ledger write rolls back balances and battle records, and retry settles only once',async()=>{
      await reset();await owned('se-agreste',bob);const record=await start('se-agreste',alice),connect=pool.connect.bind(pool);let injected=false;
      pool.connect=async()=>{const db=await connect();return {release:db.release,query:async(sql,...args)=>{const result=await db.query(sql,...args);if(!injected&&sql.startsWith('INSERT INTO world_coin_ledger')){injected=true;throw Error('Injected storage failure');}return result;}};};
      try{assert.equal((await surrender(record,alice)).status,503);}finally{pool.connect=connect;}
      assert(injected);assert.equal((await pool.query('SELECT count(*)::int AS n FROM world_battles WHERE id=$1',[record.id])).rows[0].n,0);
      assert.equal((await world(alice)).wallet.balance,1000);assert.equal((await world(bob)).wallet.balance,1000);
      assert.equal((await world(alice)).wallet.reserved,400);
      assert.equal((await surrender(record,alice)).status,200);assert.equal((await world(alice)).wallet.balance,600);assert.equal((await world(bob)).wallet.balance,1400);
    });
    await t.test('real conquest settles old-owner income before transferring the area and later income goes to the winner',async()=>{
      await reset();await owned('se-agreste',bob);await pool.query('UPDATE world_players SET coin_balance=500000 WHERE id=$1',[bob.id]);
      const startTime=clock,record=await start('se-agreste',alice),final=await win(record,alice,bob);
      assert.equal(final.economy.participants.find(p=>p.playerId===alice.id).change,400);assert.equal(final.economy.cpuReward,0);
      assert.equal((await world(alice)).wallet.balance,1400);
      const expected=5000+Math.floor((Math.floor(clock)-startTime)*1000/86400000)-400;
      assert.equal((await world(bob)).wallet.balance,expected);
      clock+=86400000;assert.equal((await world(alice)).wallet.balance,2400);assert.equal((await world(bob)).wallet.balance,expected);
    });
    await t.test('first CPU conquest pays 300 once and ownership starts its daily production',async()=>{
      await reset();const record=await start('se-litoral-sul',alice),final=await win(record,alice);
      assert.equal(final.economy.cpuReward,300);assert.equal((await world(alice)).wallet.balance,1300);
      assert.equal((await pool.query("SELECT cpu_reward_claimed FROM world_areas WHERE id='se-litoral-sul'")).rows[0].cpu_reward_claimed,true);
      // A neutral area that has already paid its reward cannot pay it again.
      await pool.query("UPDATE world_areas SET owner_id=NULL,version=version+1 WHERE id='se-litoral-sul'");
      const again=await start('se-litoral-sul',dana),second=await win(again,dana);assert.equal(second.economy.cpuReward,0);
      assert.equal((await world(dana)).wallet.balance,1000);
    });
    await t.test('server interruption releases all funds, preserves ownership and does not settle a loot transfer',async()=>{
      await reset();await owned('se-agreste',bob);const record=await start('se-agreste',alice);assert.equal((await world(alice)).wallet.reserved,400);
      await app.world.close();const final=app.world.battles.get(record.id).final;assert.equal(final.status,'interrupted');assert.equal(final.economy.transfers.length,0);
      assert.equal((await app.world.world(alice)).wallet.reserved,0);assert.equal((await app.world.world(alice)).wallet.balance,1000);
      assert.equal((await pool.query("SELECT owner_id FROM world_areas WHERE id='se-agreste'")).rows[0].owner_id,bob.id);
    });
  }finally{await app.close();await database.destroy();}
});

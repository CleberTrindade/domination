'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createApplication}=require('../server'),{postgres}=require('./postgres');
const {TROOP_KINDS,combatProfile}=require('../server/progression');
test('personal profile and individual training use authoritative persisted data',async t=>{
  const db=await postgres(),pool=db.pool,app=await createApplication({pool,worldOptions:{startClock:false}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
  async function api(path,player,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(player?{Cookie:player.cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  async function user(name){const r=await api('/api/auth/register',null,{username:name,name,password:'profile-test-password'});assert.equal(r.status,200);return {...r.data.player,cookie:r.cookie};}
  const world=async p=>(await api('/api/world',p)).data;
  const upgrade=(p,kind,level,id=randomUUID())=>api('/api/world/army/upgrade',p,{troopKind:kind,expectedLevel:level,requestId:id});
  try{
    const [hero,bob,third]=await Promise.all(['profilehero','profilebob','profilethird'].map(user));
    await t.test('catalog is available to guests, profile requires login and empty stats have no invented win rate',async()=>{
      const catalog=(await world()).troops;assert.deepEqual(catalog.map(t=>t.id),TROOP_KINDS);assert.equal(catalog.find(t=>t.id==='heli').speed,62);
      assert.equal((await api('/api/world/profile')).status,401);const profile=(await api('/api/world/profile',hero)).data;assert.equal(profile.stats.total,0);assert.equal(profile.stats.winRate,null);assert.equal(profile.player.name,hero.name);assert(!JSON.stringify(profile).includes('password'));
      for(const page of ['0','-1','abc','1.5','1000000'])assert.equal((await api('/api/world/profile?page='+page,hero)).status,400);
    });
    await t.test('legacy general levels are inherited; new purchases affect exactly one type and audit its cost',async()=>{
      await pool.query('UPDATE world_players SET army_level=5,coin_balance=1000000 WHERE id=$1',[hero.id]);
      const before=await world(hero);assert(Object.entries(before.army.troops).every(([k,t])=>t.level===(['tanque','desliz','heli','canhao','central'].includes(k)?5:1)));
      const id=randomUUID(),response=await upgrade(hero,'heli',5,id);assert.equal(response.status,200);assert.equal(response.data.cost,400);
      const after=await world(hero);for(const kind of TROOP_KINDS)assert.equal(after.army.troops[kind].level,kind==='heli'?6:['tanque','desliz','canhao','central'].includes(kind)?5:1);
      assert.equal(after.wallet.balance,9600);assert.equal(after.wallet.entries[0].troop_kind,'heli');assert.equal((await upgrade(hero,'heli',5,id)).status,200);
      assert.equal((await upgrade(hero,'tanque',5,id)).status,403);assert.equal((await world(hero)).wallet.balance,9600);
      assert.equal((await api('/api/world/army/upgrade',hero,{expectedLevel:6,requestId:randomUUID()})).status,400);
      assert.equal((await upgrade(hero,'invalid',1)).status,400);
    });
    await t.test('different types can purchase the same level concurrently; battle and late-entry profiles remain frozen',async()=>{
      await pool.query('UPDATE world_players SET coin_balance=500000 WHERE id=$1',[bob.id]);
      const responses=await Promise.all([upgrade(bob,'tanque',1),upgrade(bob,'heli',1)]);assert(responses.every(r=>r.status===200));
      const army=(await world(bob)).army;assert.equal(army.troops.tanque.level,2);assert.equal(army.troops.heli.level,2);assert.equal(army.troops.desliz.level,1);
      const record=(await api('/api/world/areas/se-litoral-sul/attack',bob,{})).data;
      assert.equal(record.config.attackerTroops.tanque.power,1.1);assert.equal(record.config.attackerTroops.desliz.power,1);
      assert.equal(record.config.defenderTroops.heli.power,1.1*.8);assert.equal(record.config.defenderTroops.desliz.power,.8);
      assert.equal((await upgrade(bob,'heli',2)).status,200);
      const frozen=(await api('/api/world/battles/'+record.id,bob)).data;assert.equal(frozen.config.attackerTroops.heli.level,2);
      const site=frozen.joinableSites.find(s=>s.kind==='H').id;
      await api('/api/world/battles/'+record.id+'/join',hero,{site});const battle=app.world.battles.get(record.id),ticket=[...battle.inputs.values()].find(i=>i.kind==='join');
      assert.equal(ticket.armyTroops.heli.level,6);assert.equal(ticket.armyTroops.tanque.level,5);
      await api('/api/world/battles/'+record.id+'/surrender',bob,{});
    });
    // Isolated fixture matches exercise every participant role, legacy history,
    // money classification and pagination beyond the world's last twelve rows.
    const stamp=Date.now()-86400000;let sequence=0;
    async function match({attacker=bob,defender=third,winner=bob,status='won',side=1,outcome='won',legacy=false,delta=0,production=0}={}){
      const id=randomUUID(),at=new Date(stamp+sequence++*1000).toISOString();
      if(side===1)attacker=hero;if(side===2)defender=hero;
      await pool.query('INSERT INTO world_battles(id,area_id,attacker_id,defender_id,area_version,status,defense_share,started_at,finished_at,expires_at,winner_id,result) VALUES($1,$2,$3,$4,0,$5,.23,$6,$6,$6,$7,$8::jsonb)',[id,'se-agreste',attacker.id,defender?.id||null,status,at,winner?.id||null,JSON.stringify({balance:{defenderParticipated:false}})]);
      if(!legacy)await pool.query('INSERT INTO world_battle_participants(battle_id,player_id,side,joined_at,outcome,army_level) VALUES($1,$2,$3,$4,$5,5)',[id,hero.id,side,at,outcome]);
      if(delta)await pool.query("INSERT INTO world_coin_ledger(id,player_id,battle_id,kind,amount,created_at) VALUES($1,$2,$3,'battle_loot',$4,$5)",[randomUUID(),hero.id,id,delta*100,at]);
      if(production)await pool.query("INSERT INTO world_coin_ledger(id,player_id,battle_id,kind,amount,created_at) VALUES($1,$2,$3,'production',$4,$5)",[randomUUID(),hero.id,id,production*100,at]);
      return id;
    }
    await t.test('all roles and legacy matches are personal; interrupted games do not count as defeats',async()=>{
      await match({winner:hero,delta:400});await match({side:2,winner:hero,status:'lost',delta:400});
      await match({side:3,winner:hero,delta:600});await match({side:4,winner:bob,outcome:'lost',delta:-400,production:800});
      await match({side:3,winner:bob,outcome:'left'});await match({status:'interrupted',winner:null,outcome:'lost'});await match({winner:hero,legacy:true});
      const profile=(await api('/api/world/profile',hero)).data;
      // Hero's unconfirmed late join in the real battle above is not a participant.
      assert.equal(profile.stats.total,7);assert.equal(profile.stats.wins,4);assert.equal(profile.stats.losses,1);assert.equal(profile.stats.withdrawals,1);assert.equal(profile.stats.cancelled,1);assert.equal(profile.stats.winRate,67);
      const lost=profile.matches.find(m=>m.role==='invader'&&m.outcome==='lost');assert.equal(lost.coin_change,-400);
      assert(profile.matches.some(m=>m.role==='defender'&&m.outcome==='won'&&m.automatic_defense));assert(profile.matches.some(m=>m.army_level===null));
      assert.equal((await api('/api/world/profile',third)).data.stats.total,6,'legacy defense fallback covers unrostered original defenders');
    });
    await t.test('history is paginated without duplicates and never accepts another account as the viewer',async()=>{
      for(let i=0;i<22;i++)await match({winner:hero});
      const a=(await api('/api/world/profile?page=1',hero)).data,b=(await api('/api/world/profile?page=2',hero)).data;
      assert.equal(a.pagination.total,29);assert.equal(a.matches.length,20);assert.equal(b.matches.length,9);assert.equal(new Set([...a.matches,...b.matches].map(m=>m.id)).size,29);
      assert.equal((await api('/api/world/profile?page=999',hero)).data.pagination.page,2);
      const mine=(await api('/api/world/profile?playerId='+hero.id,bob)).data;assert.equal(mine.player.id,bob.id);
    });
  }finally{await app.close();await db.destroy();}
});

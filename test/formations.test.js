'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {createApplication}=require('../server'),{postgres}=require('./postgres'),{migrate}=require('../server/database'),rules=require('../shared/troop-rules');
test('formation migration preserves the existing equipped ground troops',async()=>{
 const db=await postgres();try{
  await db.pool.query('CREATE TABLE world_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
  for(const name of fs.readdirSync(path.join(__dirname,'../server/migrations')).filter(n=>n.endsWith('.sql')&&n<'012').sort()){
   await db.pool.query(fs.readFileSync(path.join(__dirname,'../server/migrations',name),'utf8'));await db.pool.query('INSERT INTO world_migrations(name) VALUES($1)',[name]);
  }
  const id=randomUUID(),troops=['batedor','tanque','foguetes'];await db.pool.query('INSERT INTO world_players(id,username,display_name,password_hash,ground_loadout) VALUES($1,$2,$3,$4,$5::jsonb)',[id,'legacyformation','Legado','unused-test-hash',JSON.stringify(troops)]);
  await migrate(db.pool);await migrate(db.pool);
  const row=(await db.pool.query('SELECT ground_loadout,army_formations,active_formation_id,formation_revision FROM world_players WHERE id=$1',[id])).rows[0];assert.deepEqual(row.ground_loadout,troops);assert.deepEqual(row.army_formations,[{id:'initial',name:'Formação 1',troops}]);assert.equal(row.active_formation_id,'initial');assert.equal(row.formation_revision,0);
 }finally{await db.destroy();}
});
test('saved formations persist per account, validate unlocks, resolve retries and freeze battle armies',async t=>{
 const db=await postgres();let app=await createApplication({pool:db.pool,worldOptions:{startClock:false}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));let base='http://127.0.0.1:'+app.server.address().port;
 async function api(route,cookie,body){const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 const hero=await api('/api/auth/register',null,{username:'formationshero',name:'Formações',password:'test-formations-password'}),other=await api('/api/auth/register',null,{username:'formationsother',name:'Outro',password:'test-formations-password'}),cookie=hero.cookie,view=async()=>(await api('/api/world',cookie)).data,save=body=>api('/api/world/army/formations',cookie,body);
 try{
  let world=await view();const alt=randomUUID(),third=randomUUID();
  const initial=world.army.formations[0];assert.deepEqual(initial.troops,['tanque']);assert.equal(world.army.activeFormationId,initial.id);
  await t.test('only the account owner can save valid unlocked ground formations',async()=>{
   const input={expectedRevision:0,activeFormationId:initial.id,formations:[initial]};assert.equal((await api('/api/world/army/formations',null,input)).status,401);
   for(const formations of [[],[initial,initial],[{...initial,name:''}],[{...initial,name:'x'.repeat(33)}],[{...initial,troops:[]}],[{...initial,troops:['tanque','tanque']}],[{...initial,troops:['tanque','batedor','foguetes','blindado']}],Array.from({length:11},(_,i)=>({...initial,id:randomUUID(),name:'Formação '+i}))])assert.equal((await save({...input,formations})).status,400);
   assert.equal((await save({...input,activeFormationId:randomUUID()})).status,400);
   assert.equal((await save({...input,formations:[{...initial,troops:['heli']}]})).status,409);assert.equal((await save({...input,formations:[{...initial,troops:['batedor']}]})).status,409);
   assert.equal((await view()).wallet.balance,world.wallet.balance);assert.equal((await view()).army.formationRevision,0);
  });
  await db.pool.query('UPDATE world_players SET battles_completed=250,troop_levels=$2::jsonb WHERE id=$1',[hero.data.player.id,JSON.stringify(Object.fromEntries(rules.KINDS.map(k=>[k,7])))]);
  const forms=[initial,{id:alt,name:'Assalto',troops:['batedor','foguetes','artilharia']},{id:third,name:'Reserva',troops:['blindado','engenheiro']}];
  await t.test('inactive formations and duplicate requests do not change equipment or charge coins',async()=>{
   const input={expectedRevision:0,activeFormationId:initial.id,formations:forms};let result=await save(input);assert.equal(result.status,200);assert.equal(result.data.army.formationRevision,1);assert.deepEqual(result.data.army.loadout,['tanque']);
   result=await save(input);assert.equal(result.status,200);assert(result.data.alreadyApplied);assert.equal(result.data.army.formations.length,3);assert.equal(result.data.army.formationRevision,1);
   world=await view();assert.equal(world.wallet.balance,1000);assert.equal((await api('/api/world',other.cookie)).data.army.formations.length,1);
  });
  await t.test('competing devices cannot silently overwrite each other and legacy equipment stays synchronized',async()=>{
   const change=name=>({expectedRevision:1,activeFormationId:initial.id,formations:forms.map(f=>f.id===alt?{...f,name}:f)});
   const results=await Promise.all([save(change('Primeiro aparelho')),save(change('Segundo aparelho'))]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);world=await view();assert.equal(world.army.formationRevision,2);
   assert.equal((await api('/api/world/army/loadout',cookie,{troops:['engenheiro','tanque']})).status,200);world=await view();assert.equal(world.army.formationRevision,3);assert.deepEqual(world.army.formations.find(f=>f.id===initial.id).troops,world.army.loadout);
   assert.equal((await save(change('Tentativa antiga'))).status,409);
  });
  await t.test('activation applies only to future battles and survives a new server instance',async()=>{
   world=await view();let result=await save({expectedRevision:world.army.formationRevision,activeFormationId:alt,formations:world.army.formations});assert.equal(result.status,200);assert.deepEqual(result.data.army.loadout,forms[1].troops);
   const record=await api('/api/world/areas/se-agreste/attack',cookie,{});assert.equal(record.status,201);assert.deepEqual(record.data.config.attackerLoadout,forms[1].troops);assert.equal(record.data.snapshot.sites[4].kind,'batedor');
   world=await view();result=await save({expectedRevision:world.army.formationRevision,activeFormationId:third,formations:world.army.formations});assert.equal(result.status,200);const frozen=await api('/api/world/battles/'+record.data.id,cookie);assert.deepEqual(frozen.data.config.attackerLoadout,forms[1].troops);
   await api('/api/world/battles/'+record.data.id+'/surrender',cookie,{});const next=await api('/api/world/areas/se-alto-sertao/attack',cookie,{});assert.equal(next.status,201);assert.deepEqual(next.data.config.attackerLoadout,forms[2].troops);await api('/api/world/battles/'+next.data.id+'/surrender',cookie,{});
   world=await view();const saved=world.army;await app.close();app=await createApplication({pool:db.pool,worldOptions:{startClock:false}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;
   const after=(await view()).army;assert.equal(after.activeFormationId,third);assert.deepEqual(after.formations,saved.formations);assert.equal(after.formationRevision,saved.formationRevision);assert.deepEqual(after.loadout,forms[2].troops);
  });
 }finally{await app.close();await db.destroy();}
});

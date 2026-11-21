'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {WebSocket}=require('ws');
const {createApplication}=require('../server');
const factory=require('../server/battle-engine');
const {createBrowserBattle}=require('../shared/browser-battle');
const {postgres}=require('./postgres');
function inbox(ws){const messages=[],waiters=[];ws.on('message',raw=>{const value=JSON.parse(String(raw)),index=waiters.findIndex(w=>w.match(value));if(index<0)messages.push(value);else{const [w]=waiters.splice(index,1);clearTimeout(w.timer);w.resolve(value);}});return match=>{const index=messages.findIndex(match);if(index>=0)return Promise.resolve(messages.splice(index,1)[0]);return new Promise((resolve,reject)=>{const entry={match,resolve,timer:setTimeout(()=>{waiters.splice(waiters.indexOf(entry),1);reject(Error('Message timeout'));},3000)};waiters.push(entry);});};}
test('browser combat persists only completed battles and preserves world, sessions, defense and classic rooms',async t=>{
  const database=await postgres(),pool=database.pool,sql=[];let clock=Date.now();
  const query=pool.query.bind(pool);pool.query=(text,...rest)=>{sql.push(text);return query(text,...rest);};
  const connect=pool.connect.bind(pool);pool.connect=async()=>{const db=await connect();return {query:(text,...rest)=>{sql.push(text);return db.query(text,...rest);},release:db.release};};
  let app=await createApplication({pool,worldOptions:{startClock:false,now:()=>clock}}),base;
  async function listen(){await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+app.server.address().port;}await listen();
  const clients=[],controllers=[];
  async function api(path,cookie,body,headers={}){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  const register=name=>api('/api/auth/register',null,{username:name,name,password:'integration-password-123'});
  const realtime=(cookie,origin,path='/api/world/socket')=>{const ws=new WebSocket(base.replace('http:','ws:')+path,{headers:{...(cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{})}});clients.push(ws);return {ws,next:inbox(ws)};};
  async function events(record,cookie){const controller=new AbortController();controllers.push(controller);const response=await fetch(base+'/api/world/battles/'+record.id+'/events',{headers:{Cookie:cookie},signal:controller.signal});assert.equal(response.status,200);const reader=response.body.getReader();const initial=Buffer.from((await reader.read()).value).toString();return {controller,reader,initial};}
  let alice,bob,charlie,record,runner,ownerSocket,attackerSocket;
  try{
    await t.test('registration, duplicate users, invalid passwords and HttpOnly sessions remain intact',async()=>{
      [alice,bob,charlie]=await Promise.all([register('alice'),register('bob'),register('charlie')]);
      assert.equal(alice.status,200);assert(alice.cookie.startsWith('domination_session='));
      assert.equal((await register('alice')).status,409);assert.equal((await api('/api/auth/login',null,{username:'alice',password:'wrong-password'})).status,401);
      const world=(await api('/api/world',alice.cookie)).data;assert.equal(world.player.username,'alice');assert.equal(world.areas.length,5);assert(!JSON.stringify(world).includes('password_hash'));
      assert.equal((await api('/api/world/areas/se-agreste/attack',null,{})).status,401);
      assert.equal((await api('/api/world/areas/se-agreste/attack',alice.cookie,{}, {Origin:'https://other.invalid'})).status,403);
    });
    await t.test('simulation worker, shared engine and geographical assets are served as scripts',async()=>{
      for(const path of ['/battle-worker.js','/battle-engine.js','/browser-battle.js','/sergipe-map.js','/troop-art.js']){const response=await fetch(base+path);assert.equal(response.status,200);assert(response.headers.get('content-type').includes('application/javascript'));}
      for(const path of ['/art/troops-initial-v1.png','/art/central-v1.png']){const response=await fetch(base+path,{method:'HEAD'});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert(response.headers.get('cache-control').includes('immutable'));}
    });
    await t.test('anonymous and cross-origin sockets are rejected',async()=>{
      for(const [cookie,origin]of [[null,null],[bob.cookie,'https://other.invalid']]){const client=realtime(cookie,origin);assert((await client.next(m=>m.type==='error')).message);client.ws.terminate();}
    });
    await t.test('concurrent reservations stay in memory, allowing only one attacker and one battle per area',async()=>{
      const start=sql.length;
      const responses=await Promise.all([api('/api/world/areas/se-agreste/attack',alice.cookie,{}),api('/api/world/areas/se-agreste/attack',bob.cookie,{})]);
      assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);record=responses.find(r=>r.status===201).data;
      assert(!sql.slice(start).some(text=>/^(INSERT|UPDATE|DELETE)/i.test(text.trim())),'starting a battle must not write a row');
      const cookie=responses[0].status===201?alice.cookie:bob.cookie;
      assert.equal((await api('/api/world/areas/se-alto-sertao/attack',cookie,{})).status,409);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM world_battles')).rows[0].n,0);
      await api('/api/world/battles/'+record.id+'/surrender',cookie,{});
    });
    await t.test('owners take over defense while third parties can only spectate',async()=>{
      await pool.query("UPDATE world_areas SET owner_id=$1 WHERE id='se-aracaju'",[bob.data.player.id]);
      ownerSocket=realtime(bob.cookie);attackerSocket=realtime(alice.cookie);
      await Promise.all([ownerSocket.next(m=>m.type==='ready'),attackerSocket.next(m=>m.type==='ready')]);
      record=(await api('/api/world/areas/se-aracaju/attack',alice.cookie,{})).data;runner=createBrowserBattle(factory,record);
      assert.equal((await ownerSocket.next(m=>m.type==='under_attack')).battleId,record.id);
      const watching=await api('/api/world/battles/'+record.id,charlie.cookie);assert.equal(watching.status,200);assert.equal(watching.data.playerOwner,0);assert.equal(watching.data.authorizedInputs,undefined);assert.equal(watching.data.resume,undefined);
      assert.equal((await api('/api/world/battles/'+record.id+'/defend',alice.cookie,{})).status,403);
      const defense=await api('/api/world/battles/'+record.id+'/defend',bob.cookie,{});assert.equal(defense.data.playerOwner,2);
      const attackEvents=await events(record,alice.cookie),defenseEvents=await events(record,bob.cookie);
      assert(attackEvents.initial.includes('"playerOwner":1'));assert(defenseEvents.initial.includes('"playerOwner":2'));
      for(const input of app.world.battles.get(record.id).inputs.values())runner.input(input);
      for(let i=0;i<310;i++){runner.advance(1/30);clock+=1000/30;}
      assert.equal(runner.snapshot().units.length,0,'CPU waits while its owner controls defense');
    });
    await t.test('commands are relayed without database queries and never execute combat on the server',async()=>{
      const before=sql.length;
      const command={nonce:randomUUID(),type:'send',sources:[4],target:10,owner:2};
      attackerSocket.ws.send(JSON.stringify({type:'command',battleId:record.id,requestId:1,command}));
      const ack=await attackerSocket.next(m=>m.type==='ack'&&m.requestId===1);assert.equal(ack.accepted,true);assert.equal(ack.input.owner,1);assert.equal(sql.length,before);
      assert.equal(app.world.battles.get(record.id).snapshot.units.length,0,'relay must not simulate the order');
      assert(runner.input(ack.input));
      assert(runner.snapshot().units.every(u=>u.owner===1));
      const repeat=await api('/api/world/battles/'+record.id+'/commands',alice.cookie,command);assert.equal(repeat.data.input.nonce,command.nonce);
      assert.equal(runner.input(repeat.data.input),null,'ack and SSE echoes must not send troops twice');
      assert(!sql.slice(before).some(text=>/^(INSERT|UPDATE|DELETE)/i.test(text.trim())));
      assert.equal((await api('/api/world/battles/'+record.id+'/surrender',bob.cookie,{})).status,403);
    });
    await t.test('only browser host can relay positions; progress and checkpoints never touch Postgres',async()=>{
      const payload={snapshot:runner.snapshot(),resume:runner.checkpoint()};
      assert.equal((await api('/api/world/battles/'+record.id+'/relay',bob.cookie,payload)).status,403);
      const before=sql.length;assert.equal((await api('/api/world/battles/'+record.id+'/relay',alice.cookie,payload)).status,200);
      assert(!sql.slice(before).some(text=>/^(INSERT|UPDATE|DELETE)/i.test(text.trim())));
      const resumed=(await api('/api/world/battles/'+record.id,alice.cookie)).data;assert(resumed.resume);
      const restored=createBrowserBattle(factory,resumed);assert.deepEqual(restored.snapshot(),runner.snapshot());
      const rows=(await pool.query('SELECT count(*)::int AS n FROM world_battles WHERE id=$1',[record.id])).rows[0];assert.equal(rows.n,0);
    });
    await t.test('fabricated winners and defender submissions cannot change territory',async()=>{
      assert.equal((await api('/api/world/battles/'+record.id+'/complete',alice.cookie,{result:'won'})).status,409);
      assert.equal((await api('/api/world/battles/'+record.id+'/complete',bob.cookie,runner.completion())).status,403);
      assert.equal((await api('/api/world/battles/'+record.id+'/complete',alice.cookie,runner.completion())).status,409);
      assert.equal((await pool.query("SELECT owner_id FROM world_areas WHERE id='se-aracaju'")).rows[0].owner_id,bob.data.player.id);
    });
    await t.test('a real browser victory is replayed once at the end, saved once and transfers the area atomically',async()=>{
      const geometry=factory.createBattle(record.config).checkpoint().sites;
      for(let frame=0;frame<11000&&!runner.over;frame++){
        if(frame%90===0){
          const snapshot=runner.snapshot(),mine=snapshot.sites.filter(s=>s.owner===1),enemy=snapshot.sites.filter(s=>s.owner!==1);
          for(const source of mine){if(source.troops<24)continue;const a=geometry[source.id];
            for(const target of enemy.slice().sort((b,c)=>Math.hypot(a.x-geometry[b.id].x,a.y-geometry[b.id].y)-Math.hypot(a.x-geometry[c.id].x,a.y-geometry[c.id].y))){
              const response=await api('/api/world/battles/'+record.id+'/commands',alice.cookie,{nonce:randomUUID(),type:'send',sources:[source.id],target:target.id});assert.equal(response.status,200);
              if(runner.input(response.data.input))break;
            }
          }
        }
        runner.advance(1/30);clock+=1000/30;
      }
      assert.equal(runner.snapshot().result,'won');
      const final=await api('/api/world/battles/'+record.id+'/complete',alice.cookie,runner.completion());assert.equal(final.status,200);assert.equal(final.data.status,'won');
      const again=await api('/api/world/battles/'+record.id+'/complete',alice.cookie,runner.completion());assert.equal(again.data.final.status,'won');
      const area=(await pool.query("SELECT owner_id,version FROM world_areas WHERE id='se-aracaju'")).rows[0];assert.equal(area.owner_id,alice.data.player.id);assert.equal(area.version,1);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM world_battles WHERE id=$1',[record.id])).rows[0].n,1);
      const map=(await api('/api/world',alice.cookie)).data;assert(map.history.some(h=>h.id===record.id));assert.equal(map.ranking[0].id,alice.data.player.id);
    });
    await t.test('releasing defense and losing the host never concede territory to the attacker',async()=>{
      clock=Date.now();record=(await api('/api/world/areas/se-aracaju/attack',bob.cookie,{})).data;
      await api('/api/world/battles/'+record.id+'/defend',alice.cookie,{});await events(record,alice.cookie);
      await api('/api/world/battles/'+record.id+'/release',alice.cookie,{});assert.equal(app.world.battles.get(record.id).defenderControlled,false);
      clock+=31000;await app.world.tick();assert.equal((await api('/api/world/battles/'+record.id,bob.cookie)).data.final.status,'abandoned');
      assert.equal((await pool.query("SELECT owner_id FROM world_areas WHERE id='se-aracaju'")).rows[0].owner_id,alice.data.player.id);
    });
    await t.test('classic WebSocket rooms still operate independently',async()=>{
      const a=realtime(null,null,'/'),b=realtime(null,null,'/');await Promise.all([a.next(m=>m.t==='hello'),b.next(m=>m.t==='hello')]);
      a.ws.send(JSON.stringify({t:'join',room:'classic-test'}));await a.next(m=>m.t==='peers'&&m.peers.length===1);
      b.ws.send(JSON.stringify({t:'join',room:'classic-test'}));await a.next(m=>m.t==='peers'&&m.peers.length===2);
      a.ws.terminate();b.ws.terminate();
    });
  }finally{for(const controller of controllers)controller.abort();for(const ws of clients)ws.terminate();await app.close();await database.destroy();}
});

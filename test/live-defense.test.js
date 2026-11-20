'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {WebSocket}=require('ws');
const {createApplication}=require('../server');
const {postgres}=require('./postgres');

function inbox(ws){
  const messages=[],waiters=[];
  ws.on('message',raw=>{
    const value=JSON.parse(String(raw)),i=waiters.findIndex(w=>w.matches(value));
    if(i<0)messages.push(value);else{const [w]=waiters.splice(i,1);clearTimeout(w.timer);w.resolve(value);}
  });
  return matches=>{
    const i=messages.findIndex(matches);if(i>=0)return Promise.resolve(messages.splice(i,1)[0]);
    return new Promise((resolve,reject)=>{const waiter={matches,resolve,timer:setTimeout(()=>{const i=waiters.indexOf(waiter);if(i>=0)waiters.splice(i,1);reject(Error('Realtime message timeout'));},3000)};waiters.push(waiter);});
  };
}
test('online attacks notify owners and support secure realtime commands and human defense',async t=>{
  const db=await postgres(),pool=db.pool;
  let queries=0,clock=Date.now();const rawQuery=pool.query.bind(pool);
  pool.query=(...args)=>{queries++;return rawQuery(...args);};
  let app=await createApplication({pool,worldOptions:{startClock:false,now:()=>clock}}),base;
  async function listen(){await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+app.server.address().port;}
  await listen();
  const clients=[],controllers=[];
  async function api(path,cookie,body){
    const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  async function register(username){return api('/api/auth/register',null,{username,name:username,password:'safe-test-password'});}
  function realtime(cookie,origin){const ws=new WebSocket(base.replace('http:','ws:')+'/api/world/socket',{headers:{...(cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{})}});clients.push(ws);return {ws,next:inbox(ws)};}
  async function stream(record,cookie){
    const controller=new AbortController();controllers.push(controller);
    const response=await fetch(base+'/api/world/battles/'+record.id+'/events',{headers:{Cookie:cookie},signal:controller.signal});
    assert.equal(response.status,200);const reader=response.body.getReader();
    const initial=Buffer.from((await reader.read()).value).toString();assert(initial.includes('event: state'));
    return {controller,reader,initial};
  }
  const settle=()=>new Promise(resolve=>setTimeout(resolve,20));
  try{
    const attacker=await register('raider'),defender=await register('guardian'),outsider=await register('stranger');
    await pool.query("UPDATE world_areas SET owner_id=$1 WHERE id='se-aracaju'",[defender.data.player.id]);
    await t.test('anonymous and cross-origin sockets cannot authenticate',async()=>{
      for(const [cookie,origin] of [[null,null],[defender.cookie,'https://other.invalid']]){
        const client=realtime(cookie,origin),error=await client.next(m=>m.type==='error');assert(error.message);client.ws.terminate();
      }
    });
    const defenseSocket=realtime(defender.cookie),attackSocket=realtime(attacker.cookie),otherSocket=realtime(outsider.cookie);
    await Promise.all([defenseSocket.next(m=>m.type==='ready'),attackSocket.next(m=>m.type==='ready'),otherSocket.next(m=>m.type==='ready')]);
    let record;
    await t.test('only the owner receives an attack notice and the map exposes the active battle',async()=>{
      const response=await api('/api/world/areas/se-aracaju/attack',attacker.cookie,{});assert.equal(response.status,201);record=response.data;
      const notice=await defenseSocket.next(m=>m.type==='under_attack');assert.equal(notice.battleId,record.id);assert.equal(notice.areaName,'Aracaju · Capital');
      assert.equal(notice.attackerName,'raider');
      const map=(await api('/api/world',defender.cookie)).data;
      const area=map.areas.find(a=>a.id==='se-aracaju');assert.equal(area.battle_id,record.id);assert.equal(area.attacker_name,'raider');
      assert.equal((await api('/api/world/battles/'+record.id,outsider.cookie)).status,403);
    });
    await t.test('defense takeover is owner-only, works on both sides and stops automatic CPU orders',async()=>{
      assert.equal((await api('/api/world/battles/'+record.id+'/defend',attacker.cookie,{})).status,403);
      assert.equal((await api('/api/world/battles/'+record.id+'/defend',outsider.cookie,{})).status,403);
      const defense=await api('/api/world/battles/'+record.id+'/defend',defender.cookie,{});
      assert.equal(defense.data.playerOwner,2);assert.equal(defense.data.defenderControlled,true);
      const a=await stream(record,attacker.cookie),d=await stream(record,defender.cookie);
      assert(a.initial.includes('"playerOwner":1'));assert(d.initial.includes('"playerOwner":2'));
      for(let i=0;i<260;i++)await app.world.tick(.05);
      assert.equal(app.world.battles.get(record.id).engine.snapshot().units.length,0);
      assert.equal((await api('/api/world/battles/'+record.id+'/surrender',defender.cookie,{})).status,403);
    });
    await t.test('live commands avoid database queries, acknowledge immediately and cannot spoof the opponent',async()=>{
      const before=queries;
      attackSocket.ws.send(JSON.stringify({type:'command',battleId:record.id,requestId:1,command:{type:'send',sources:[4],target:0,owner:2}}));
      const ack=await attackSocket.next(m=>m.type==='ack'&&m.requestId===1);assert.equal(ack.accepted,true);
      assert.equal(queries,before,'a live command should not consult Postgres');
      assert.equal(ack.record.playerOwner,1);assert(ack.record.snapshot.units.every(u=>u.owner===1));
      const sources=ack.record.snapshot.sites.filter(s=>s.owner===2).map(s=>s.id);
      defenseSocket.ws.send(JSON.stringify({type:'command',battleId:record.id,requestId:2,command:{type:'send',sources:[4],target:0,owner:1}}));
      assert.equal((await defenseSocket.next(m=>m.type==='ack'&&m.requestId===2)).accepted,false);
      defenseSocket.ws.send(JSON.stringify({type:'command',battleId:record.id,requestId:3,command:{type:'send',sources,target:0,owner:1}}));
      const defenseAck=await defenseSocket.next(m=>m.type==='ack'&&m.requestId===3);
      assert.equal(defenseAck.accepted,true);assert.equal(defenseAck.record.playerOwner,2);
      assert(defenseAck.record.snapshot.units.some(u=>u.owner===2));
      otherSocket.ws.send(JSON.stringify({type:'command',battleId:record.id,requestId:4,command:{type:'send',sources,target:0}}));
      const rejected=await otherSocket.next(m=>m.type==='ack'&&m.requestId===4);assert.equal(rejected.accepted,false);assert(!rejected.record);
    });
    await t.test('release and disconnect resume CPU defense without conceding the territory',async()=>{
      const release=await api('/api/world/battles/'+record.id+'/release',defender.cookie,{});assert.equal(release.data.released,true);
      const battle=app.world.battles.get(record.id);assert.equal(battle.defenderControlled,false);assert.equal(battle.status,'active');
      await api('/api/world/battles/'+record.id+'/defend',defender.cookie,{});
      const joined=await stream(record,defender.cookie);joined.controller.abort();await settle();assert.equal(battle.defenderControlled,false);
      const map=(await api('/api/world')).data;assert.equal(map.areas.find(a=>a.id==='se-aracaju').owner_id,defender.data.player.id);
    });
    await t.test('an online defender cannot keep an abandoned attacker alive',async()=>{
      await api('/api/world/battles/'+record.id+'/defend',defender.cookie,{});await stream(record,defender.cookie);
      // Close the attacking browser while the defender remains connected.
      controllers[0].abort();await settle();clock+=31000;await app.world.tick();
      const final=await api('/api/world/battles/'+record.id,defender.cookie);
      assert.equal(final.data.playerOwner,2);assert.equal(final.data.status,'abandoned');
      assert.equal((await api('/api/world/battles/'+record.id,outsider.cookie)).status,403);
      clock=Date.now();
    });
    await t.test('owner can restore a battle after restart and take over its saved defense',async()=>{
      record=(await api('/api/world/areas/se-aracaju/attack',attacker.cookie,{})).data;
      await app.close();app=await createApplication({pool,worldOptions:{startClock:false,now:()=>clock}});await listen();
      const restored=await api('/api/world/battles/'+record.id,defender.cookie);assert.equal(restored.data.playerOwner,2);assert.equal(restored.data.defenderControlled,false);
      const takeover=await api('/api/world/battles/'+record.id+'/defend',defender.cookie,{});assert.equal(takeover.data.defenderControlled,true);
      const joined=await stream(record,defender.cookie);
      const client=realtime(defender.cookie);await client.next(m=>m.type==='ready');
      const closed=new Promise(resolve=>client.ws.once('close',resolve));
      await api('/api/auth/logout',defender.cookie,{});await closed;await settle();
      assert.equal(app.world.battles.get(record.id).defenderControlled,false,'logout releases human control');
      joined.controller.abort();
    });
  }finally{for(const controller of controllers)controller.abort();for(const ws of clients)ws.terminate();await app.close();await db.destroy();}
});

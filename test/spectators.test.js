'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createApplication}=require('../server'),{postgres}=require('./postgres');
const engine=require('../server/battle-engine'),{createBrowserBattle}=require('../shared/browser-battle');
test('spectator presence counts people, excludes participants and updates live on join and disconnect',async t=>{
  const db=await postgres(),app=await createApplication({pool:db.pool,worldOptions:{startClock:false}}),controllers=[];
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{for(const c of controllers)c.abort();await app.close();await db.destroy();});
  const base='http://127.0.0.1:'+app.server.address().port;
  async function api(path,cookie,body){
    const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    assert(response.ok,await response.clone().text());return {data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const register=async name=>(await api('/api/auth/register',null,{username:name,name,password:'spectator-test-password'})).cookie;
  const [host,bob,carol]=await Promise.all(['spectator_host','watching_bob','watching_carol'].map(register));
  const record=(await api('/api/world/areas/se-agreste/attack',host,{})).data,route='/api/world/battles/'+record.id;
  const runner=createBrowserBattle(engine,record);
  async function open(cookie){
    const controller=new AbortController();controllers.push(controller);
    const response=await fetch(base+route+'/events',{headers:{Cookie:cookie},signal:controller.signal});assert.equal(response.status,200);
    const reader=response.body.getReader(),initial=Buffer.from((await reader.read()).value).toString();
    const state=JSON.parse(initial.match(/event: state\ndata: (.+)\n/)[1]);
    return {controller,reader,state};
  }
  const count=async()=>(await api(route,host)).data.spectatorCount;
  const hostStream=await open(host);assert.equal(hostStream.state.spectatorCount,0);
  const first=await open(bob);assert.equal(first.state.spectatorCount,1);assert.equal(await count(),1);
  let updates=Buffer.from((await hostStream.reader.read()).value).toString();assert(updates.includes('event: spectators\ndata: {"count":1}'));
  const duplicate=await open(bob);assert.equal(duplicate.state.spectatorCount,1);assert.equal(await count(),1,'another tab does not count as a second person');
  await open(carol);assert.equal(await count(),2);
  const watch=(await api(route,carol)).data,site=watch.joinableSites[0].id;
  await api(route+'/join',carol,{site});
  const battle=app.world.battles.get(record.id),join=[...battle.inputs.values()].find(input=>input.kind==='join');assert(runner.input(join));
  await api(route+'/relay',host,{hostEpoch:record.hostEpoch,snapshot:runner.snapshot(),receipts:[{nonce:join.nonce,accepted:true}]});
  assert.equal((await api(route,carol)).data.playerOwner,3);assert.equal(await count(),1,'joining the combat removes the person from the spectator count');
  first.controller.abort();
  for(let i=0;i<30&&battle.streams.size!==3;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(await count(),1,'the other tab is still watching');
  duplicate.controller.abort();
  for(let i=0;i<30&&await count()!==0;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(await count(),0);
});

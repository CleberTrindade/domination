'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{WebSocket}=require('ws');
const {createApplication}=require('../server'),factory=require('../server/battle-engine');
const {createBrowserBattle}=require('../shared/browser-battle'),{postgres}=require('./postgres');
function inbox(ws){const buffered=[],waiters=[];ws.on('message',raw=>{const message=JSON.parse(String(raw)),index=waiters.findIndex(w=>w.matches(message));if(index<0)buffered.push(message);else{const [w]=waiters.splice(index,1);clearTimeout(w.timer);w.resolve(message);}});return matches=>{const index=buffered.findIndex(matches);if(index>=0)return Promise.resolve(buffered.splice(index,1)[0]);return new Promise((resolve,reject)=>{const waiter={matches,resolve,timer:setTimeout(()=>{waiters.splice(waiters.indexOf(waiter),1);reject(Error('Live message timed out'));},3000)};waiters.push(waiter);});};}
test('third-party spectators can claim free bases and a late entrant can win the shared territory',async t=>{
  const database=await postgres(),pool=database.pool;let clock=Date.now();
  const app=await createApplication({pool,worldOptions:{startClock:false,now:()=>clock}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port,clients=[],controllers=[];
  async function api(path,player,body){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(player?{Cookie:player.cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  async function create(name){const response=await api('/api/auth/register',null,{username:name,name,password:'party-test-password'});assert.equal(response.status,200);return {cookie:response.cookie,id:response.data.player.id,name};}
  async function stream(record,player){const controller=new AbortController();controllers.push(controller);const response=await fetch(base+'/api/world/battles/'+record.id+'/events',{headers:{Cookie:player.cookie},signal:controller.signal});assert.equal(response.status,200);const reader=response.body.getReader();await reader.read();return controller;}
  async function socket(player){const ws=new WebSocket(base.replace('http:','ws:')+'/api/world/socket',{headers:{Cookie:player.cookie}});clients.push(ws);const next=inbox(ws);await next(m=>m.type==='ready');return {ws,next};}
  let host,defender,third,fourth,viewer,record,runner,joiner,other,spectatorSocket,hostSocket,hostPlayer;
  const currentBattle=()=>app.world.battles.get(record.id);
  function applyTickets(){for(const input of currentBattle().inputs.values())runner.input(input);}
  async function relay(receipts=[]){const response=await api('/api/world/battles/'+record.id+'/relay',hostPlayer,{hostEpoch:currentBattle().hostEpoch,snapshot:runner.snapshot(),resume:runner.checkpoint(),receipts});assert.equal(response.status,200);}
  try{
    [host,defender,third,fourth,viewer]=await Promise.all(['host','defender','third','fourth','viewer'].map(create));hostPlayer=host;
    await pool.query("UPDATE world_areas SET owner_id=$1 WHERE id='se-agreste'",[defender.id]);
    spectatorSocket=await socket(third);hostSocket=await socket(host);
    await t.test('online outsiders receive the public alert and can watch without receiving the host log or control rights',async()=>{
      record=(await api('/api/world/areas/se-agreste/attack',host,{})).data;runner=createBrowserBattle(factory,record);
      const alert=await spectatorSocket.next(m=>m.type==='area_under_attack');assert.equal(alert.battleId,record.id);
      const map=(await api('/api/world',third)).data;assert.equal(map.areas.find(a=>a.id==='se-agreste').battle_id,record.id);
      const watch=await api('/api/world/battles/'+record.id,third);assert.equal(watch.status,200);assert.equal(watch.data.playerOwner,0);assert.equal(watch.data.isHost,false);
      assert.equal(watch.data.resume,undefined);assert.equal(watch.data.authorizedInputs,undefined);assert(watch.data.joinableSites.length);
      assert.equal((await api('/api/world/battles/'+record.id,null)).status,401);
      const command={nonce:randomUUID(),type:'send',sources:[4],target:0,owner:1};
      assert.equal((await api('/api/world/battles/'+record.id+'/commands',third,command)).status,403);
      assert.equal((await api('/api/world/battles/'+record.id+'/relay',third,{snapshot:runner.snapshot()})).status,403);
      assert.equal((await api('/api/world/battles/'+record.id+'/complete',third,runner.completion())).status,403);
      await stream(record,host);await api('/api/world/battles/'+record.id+'/defend',defender,{});await stream(record,defender);
      applyTickets();
    });
    await t.test('two entrants cannot reserve the same neutral base and entry is confirmed by the browser simulation',async()=>{
      const watch=(await api('/api/world/battles/'+record.id,third)).data,site=(watch.joinableSites.find(s=>s.kind==='H')||watch.joinableSites[0]).id;
      assert.equal((await api('/api/world/battles/'+record.id+'/join',third,{site:0})).status,409);
      const results=await Promise.all([api('/api/world/battles/'+record.id+'/join',third,{site}),api('/api/world/battles/'+record.id+'/join',fourth,{site})]);
      assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);joiner=results[0].status===200?third:fourth;other=results[0].status===200?fourth:third;
      assert.equal(results.find(r=>r.status===200).data.joinState,'pending');
      const input=await hostSocket.next(m=>m.type==='battle_input'&&m.input.kind==='join');assert.equal(input.input.playerId,joiner.id);
      assert.equal(runner.input(input.input),true);await relay([{nonce:input.input.nonce,accepted:true}]);
      const joined=(await api('/api/world/battles/'+record.id,joiner)).data;assert.equal(joined.playerOwner,3);assert.equal(joined.joinState,'active');assert.equal(joined.snapshot.sites[site].owner,3);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM world_battles WHERE id=$1',[record.id])).rows[0].n,0);
      await stream(record,joiner);
    });
    await t.test('late entrants only command their own army, cannot respawn, and cannot join two battles',async()=>{
      for(let i=0;i<110;i++){runner.advance(1/30);clock+=1000/30;}
      const command={nonce:randomUUID(),type:'send',sources:[4],target:0,owner:1};
      const response=await api('/api/world/battles/'+record.id+'/commands',joiner,command);assert.equal(response.status,200);assert.equal(response.data.input.owner,3);assert.equal(runner.input(response.data.input),false);
      const site=(await api('/api/world/battles/'+record.id,joiner)).data.joinableSites[0].id;
      assert.equal((await api('/api/world/battles/'+record.id+'/join',joiner,{site})).status,409);
      assert.equal((await api('/api/world/areas/se-aracaju/attack',joiner,{})).status,409);
      const extra=(await api('/api/world/areas/se-aracaju/attack',viewer,{})).data;
      const available=(await api('/api/world/battles/'+extra.id,joiner)).data.joinableSites[0].id;
      assert.equal((await api('/api/world/battles/'+extra.id+'/join',joiner,{site:available})).status,409);
      await api('/api/world/battles/'+extra.id+'/surrender',viewer,{});
    });
    await t.test('four armies can fight, and further viewers stay spectators even while neutral bases remain',async()=>{
      await relay();const site=(await api('/api/world/battles/'+record.id,other)).data.joinableSites[0].id;
      assert.equal((await api('/api/world/battles/'+record.id+'/join',other,{site})).status,200);
      const input=[...currentBattle().inputs.values()].find(i=>i.kind==='join'&&i.playerId===other.id);assert.equal(input.owner,4);assert(runner.input(input));await relay([{nonce:input.nonce,accepted:true}]);
      assert.equal((await api('/api/world/battles/'+record.id,other)).data.playerOwner,4);await stream(record,other);
      const watch=(await api('/api/world/battles/'+record.id,viewer)).data;assert.equal(watch.playerOwner,0);assert.equal(watch.canJoin,false);assert(watch.joinableSites.length>0);
      assert.equal((await api('/api/world/battles/'+record.id+'/join',viewer,{site:watch.joinableSites[0].id})).status,409);
    });
    await t.test('the initial attacker can leave without ending the match, and host control moves securely to a connected participant',async()=>{
      const oldEpoch=currentBattle().hostEpoch,response=await api('/api/world/battles/'+record.id+'/surrender',host,{});assert.equal(response.data.left,true);
      assert.equal(currentBattle().status,'active');assert.equal(currentBattle().hostId,defender.id);assert.notEqual(currentBattle().hostEpoch,oldEpoch);
      assert.equal((await api('/api/world/battles/'+record.id+'/relay',host,{snapshot:runner.snapshot()})).status,403);
      const takeover=(await api('/api/world/battles/'+record.id,defender)).data;assert.equal(takeover.isHost,true);assert(takeover.resume);
      hostPlayer=defender;runner=createBrowserBattle(factory,takeover);applyTickets();
      await api('/api/world/battles/'+record.id+'/surrender',other,{});applyTickets();await relay();
      assert(runner.snapshot().forfeited.includes(1));assert(runner.snapshot().forfeited.includes(4));assert.equal(runner.over,false);
    });
    await t.test('a late entrant can win; replay awards their account and persists every participant only at completion',async()=>{
      const geometry=factory.createBattle(record.config).checkpoint().sites;
      for(let frame=0;frame<11000&&!runner.over;frame++){
        if(frame%90===0){const snapshot=runner.snapshot(),mine=snapshot.sites.filter(s=>s.owner===3),enemy=snapshot.sites.filter(s=>s.owner!==3);
          for(const source of mine){if(source.troops<24)continue;const a=geometry[source.id],hx=factory.maps.geometry(record.config.mapId);for(const target of enemy.filter(t=>['heli','botes'].includes(a.kind)||hx.comp[a.cell]===hx.comp[geometry[t.id].cell]).sort((b,c)=>Math.hypot(a.x-geometry[b.id].x,a.y-geometry[b.id].y)-Math.hypot(a.x-geometry[c.id].x,a.y-geometry[c.id].y))){
            const input=await api('/api/world/battles/'+record.id+'/commands',joiner,{nonce:randomUUID(),type:'send',sources:[source.id],target:target.id});assert.equal(input.status,200);if(runner.input(input.data.input))break;
          }}
        }
        runner.advance(1/30);clock+=1000/30;
      }
      assert.equal(runner.snapshot().winnerOwner,3);
      const final=await api('/api/world/battles/'+record.id+'/complete',hostPlayer,{...runner.completion(),hostEpoch:currentBattle().hostEpoch});assert.equal(final.status,200);assert.equal(final.data.winnerId,joiner.id);assert.equal(final.data.winnerName,joiner.name);
      const replay=(await api('/api/world/replays/'+record.id,hostPlayer)).data;
      const playback=require('../shared/battle-replay').createReplay(require('../server/battle-engine'),replay);playback.advance(replay.frames);assert.deepEqual(playback.snapshot(),runner.snapshot(),'replay retains late joins, leaves and transferred host commands');
      assert.equal((await pool.query("SELECT owner_id FROM world_areas WHERE id='se-agreste'")).rows[0].owner_id,joiner.id);
      assert.equal((await pool.query('SELECT winner_id FROM world_battles WHERE id=$1',[record.id])).rows[0].winner_id,joiner.id);
      assert.equal(final.data.economy.participants.find(p=>p.owner===3).change,1200);
      assert.equal(final.data.economy.participants.find(p=>p.owner===1).change,-400,'leaving the match does not release the losing stake');
      assert.equal(final.data.economy.participants.find(p=>p.owner===4).change,-400);
      assert.equal((await api('/api/world',joiner)).data.wallet.balance,2200);
      const roster=(await pool.query('SELECT player_id,side,outcome FROM world_battle_participants WHERE battle_id=$1 ORDER BY side',[record.id])).rows;
      assert.equal(roster.length,4);assert.equal(roster.find(p=>p.side===3).outcome,'won');assert.equal(roster.find(p=>p.side===4).outcome,'left');
      const map=(await api('/api/world',joiner)).data;assert.equal(map.history.find(h=>h.id===record.id).winner_name,joiner.name);
      const retaliation=await api('/api/world/battles/'+record.id+'/retaliate',defender,{areaId:'se-agreste'});assert.equal(retaliation.status,201);await api('/api/world/battles/'+retaliation.data.id+'/surrender',defender,{});
    });
    await t.test('spectators alone cannot keep a disconnected battle alive, while a connected defender can host a continuing match',async()=>{
      clock=Date.now();const abandoned=(await api('/api/world/areas/se-litoral-sul/attack',viewer,{})).data;await stream(abandoned,third);
      clock+=31000;await app.world.tick();assert.equal(app.world.battles.get(abandoned.id).final.status,'abandoned');
      const live=(await api('/api/world/areas/se-agreste/attack',viewer,{})).data;
      await api('/api/world/battles/'+live.id+'/defend',joiner,{});await stream(live,joiner);
      clock+=4000;await app.world.tick();assert.equal(app.world.battles.get(live.id).status,'active');assert.equal(app.world.battles.get(live.id).hostId,joiner.id);
    });
  }finally{for(const controller of controllers)controller.abort();for(const ws of clients)ws.terminate();await app.close();await database.destroy();}
});

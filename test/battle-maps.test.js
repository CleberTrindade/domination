'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const maps=require('../shared/battle-maps'),engine=require('../server/battle-engine'),{browserMaps,browserEngine}=require('../server/browser-assets');
const {createBrowserBattle,verifyBrowserBattle}=require('../shared/browser-battle');
const expected=['coast-v1','crossroads-v1','passes-v1','river-v1','citadel-v1'];
test('every territory has a distinct usable battlefield, with four headquarters and all land assigned to a base',()=>{
  assert.deepEqual(maps.list().map(m=>m.id),expected);
  const signatures=new Set();
  for(const meta of maps.list()){
    const {data}=maps.get(meta.id),hx=maps.geometry(meta.id);signatures.add(JSON.stringify(data));
    assert.equal(data.seeds.length,17);assert.equal(new Set(data.seeds.map(s=>s[0])).size,17);assert.equal(hx.corners.length,4);assert(hx.corners.every(Number.isInteger));
    for(let i=0;i<hx.cells.length;i++){const cell=hx.cells[i];assert(cell.t>=0&&cell.t<17);assert.equal(hx.comp[i],hx.comp[hx.seeds[cell.t].cell]);assert(cell.x>20&&cell.x<370&&cell.y>20&&cell.y<620);}
    const setup=engine.initialSites(.5,3,2,3,meta.id);assert.equal(setup.sites.filter(s=>s.owner===2).length,4);assert.equal(setup.sites[0].owner,2);assert.equal(setup.sites.filter(s=>s.owner===1).length,1);
    assert.equal(setup.defenderShare,setup.sites.filter(s=>s.owner===2).reduce((n,s)=>n+hx.weights[s.id],0)/hx.cells.length);
    assert.equal(maps.get(maps.forArea(meta.area)).area,meta.area);
  }
  assert.equal(signatures.size,5);assert.throws(()=>maps.get('unknown'));
});
test('the layouts change ground routes, islands and chokepoints, rather than only colors',()=>{
  const connected=(id,a,b)=>{const h=maps.geometry(id);return h.comp[h.seeds[a].cell]===h.comp[h.seeds[b].cell];};
  assert.equal(connected('coast-v1',4,0),false);assert.equal(connected('crossroads-v1',4,0),true);
  assert.equal(connected('river-v1',4,0),false);assert.equal(connected('river-v1',4,1),true);
  assert.equal(connected('citadel-v1',4,0),false);assert.equal(connected('citadel-v1',4,1),true);
  const coast=maps.geometry('coast-v1');assert.equal(new Set(coast.comp).size,7);
  const pass=maps.geometry('passes-v1'),route=pass.path(pass.seeds[4].cell,pass.seeds[1].cell);
  assert(route.some(([x,y])=>y===322&&Math.abs(x-195)<=45));
  const river=maps.geometry('river-v1'),crossing=river.path(river.seeds[4].cell,river.seeds[1].cell);
  assert(crossing.some(([x,y])=>x===195&&[166,478].includes(y)));
  for(const id of ['coast-v1','river-v1','citadel-v1']){
    const battle=engine.createBattle({mapId:id,centralOwner:2,defenderBaseCount:3});for(let i=0;i<100;i++)battle.step(1/30);
    assert.equal(battle.command({type:'send',sources:[4],target:0}),false,'tank must respect water');
    assert(battle.command({type:'send',sources:[4],target:14}),'local heliport is reachable');
  }
});
test('browser assets, simulation, checkpoints and replay use the same frozen map for every participant',()=>{
  const context={self:{}};vm.createContext(context);vm.runInContext(browserMaps(),context);vm.runInContext(browserEngine(),context);
  const browser=context.self.DOMINATION_ENGINE;
  for(const id of expected){
    const config={mapId:id,seed:328,centralOwner:2,defenderBaseCount:3,maxSeconds:1};
    assert.equal(JSON.stringify(context.self.DOMINATION_MAPS.get(id).data),JSON.stringify(maps.get(id).data));
    const server=engine.createBattle(config),client=browser.createBattle(config);assert(server.join(3,12));assert(client.join(3,12));
    for(let frame=0;frame<160;frame++){server.step(1/30);client.step(1/30);}
    assert.equal(JSON.stringify(server.snapshot()),JSON.stringify(client.snapshot()));
    const saved=server.checkpoint();assert.equal(saved.config.mapId,id);assert.deepEqual(engine.restoreBattle(saved).snapshot(),server.snapshot());
    const record={config},runner=createBrowserBattle(engine,record),ticket={kind:'join',nonce:'entry',owner:3,site:12,playerId:'third',playerName:'Third',joinedAt:new Date().toISOString()};assert(runner.input(ticket));
    const resumed=createBrowserBattle(engine,{config,resume:runner.checkpoint(),authorizedInputs:[ticket]});for(let i=0;i<160;i++)resumed.advance(1/30);
    const verified=verifyBrowserBattle(engine,config,new Map([[ticket.nonce,ticket]]),resumed.completion());assert.equal(verified.validatedParticipants[0].owner,3);
    assert.equal(resumed.checkpoint().checkpoint.config.mapId,id);
  }
});
test('the actual client level builder and input routing bind to the selected battle geometry',()=>{
  const html=fs.readFileSync(require.resolve('../public/index.html'),'utf8');
  const context={window:{DOMINATION_MAPS:maps},MW:390,MAPH:640,BASE0:25,PCT:{garagem:.4,heli:.55,botes:.45,canhao:.55,central:.55},REGIONS:[{}],classicGeometry:()=>maps.geometry('classic'),game:null,HX:maps.geometry('classic')};
  vm.createContext(context);vm.runInContext(html.slice(html.indexOf('function buildLevel('),html.indexOf('const hexPts=')),context);
  vm.runInContext("const unitKind=s=>s.kind==='heli'?'heli':s.kind==='botes'?'desliz':'tanque';"+html.match(/const canReach=.*\n/)[0]+'\nthis.reachable=canReach;',context);
  for(const id of expected){const level=context.buildLevel(1,390,640,{nAI:1,mapId:id});context.game={L:level};assert.equal(level.geometry,maps.geometry(id));assert.equal(level.sites.length,17);assert.equal(level.sites[4].x,330);
    const ground=context.reachable(level.sites[4],level.sites[0]);assert.equal(ground,['crossroads-v1','passes-v1'].includes(id));
  }
});

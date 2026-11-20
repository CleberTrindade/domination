'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createBattle}=require('../server/battle-engine');
const {createWorldMotion}=require('../public/world-motion');
function element(){return {innerHTML:'',textContent:'',style:{},dataset:{},listeners:{},open:false,children:[],
  classList:{add(){},remove(){},toggle(){}},addEventListener(type,fn){this.listeners[type]=fn;},
  setAttribute(){},append(child){this.children.push(child);},showModal(){this.open=true;},close(){this.open=false;},querySelector(){return element();}};}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('army purchase shows real costs, prevents double clicks and recovers a lost confirmation without another charge',async()=>{
  const root=element(),dialog=element(),body=element(),listeners={},calls=[];let loseConfirmation=false;
  const world={player:{id:'hero',name:'Hero'},army:{level:1,power:1,maxLevel:10,nextLevel:2,nextPower:1.1,nextCost:300,canUpgrade:true},progression:structuredClone(require('../server/progression').ARMY_RULES),wallet:{balance:1000,available:1000,reserved:0,productionPerDay:0,entries:[]},economy:{initialCoins:1000,minEntry:100,productionPerDay:1000,cpuReward:300,lootPercent:40},areas:[{id:'se-litoral-sul',name:'Litoral Sul',ordinal:1,cpu_share:.32,defense_share:19/81,defense_bases:3,resistance:'Baixa',first_capture_reward:300}],ranking:[],history:[]};
  const document={body,hidden:false,createElement:element,addEventListener(type,fn){listeners[type]=fn;},querySelector(selector){return {'#worldRoot':root,'#worldDialog':dialog}[selector]||element();}};
  const context={crypto:require('node:crypto').webcrypto,document,window:{DOMINATION_SERGIPE_MAP:require('../public/sergipe-map'),DOMINATION_WORLD_BRIDGE:{}},location:{protocol:'https:',host:'game.example'},WebSocket:class{constructor(){this.readyState=1;}close(){}},AbortController,setTimeout,clearTimeout,setInterval(){},fetch:async(path,options)=>{
    if(path.endsWith('/upgrade')){const input=JSON.parse(options.body);calls.push(input);assert.equal(input.expectedLevel,world.army.level);const cost=world.army.nextCost;world.army={...world.army,level:input.expectedLevel+1,power:1+input.expectedLevel*.1,nextLevel:input.expectedLevel+2,nextPower:1+(input.expectedLevel+1)*.1,nextCost:world.progression.upgradeCosts[input.expectedLevel+2]};world.wallet.balance-=cost;world.wallet.available-=cost;if(loseConfirmation)throw Error('Reply lost');}
    return {ok:true,json:async()=>structuredClone(world)};
  }};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/world.js'),'utf8'),context);await flush();
  assert(root.innerHTML.includes('EXÉRCITO · NV. 1'));assert(root.innerHTML.includes('3 bases + bombardeiro'));
  await root.listeners.click({target:{closest:()=>({dataset:{action:'army'}})}});assert(dialog.innerHTML.includes('EVOLUIR POR 300 MOEDAS'));assert(dialog.innerHTML.includes('próximas batalhas'));
  const event={target:{closest:()=>({dataset:{dialog:'upgrade-army'}})}};
  await Promise.all([dialog.listeners.click(event),dialog.listeners.click(event)]);await flush();assert.equal(calls.length,1);assert.equal(world.wallet.balance,700);assert(dialog.innerHTML.includes('Nível 2'));
  loseConfirmation=true;await dialog.listeners.click(event);await flush();assert.equal(calls.length,2);assert.equal(world.wallet.balance,200);assert(dialog.innerHTML.includes('novo nível já foi confirmado'));assert(dialog.innerHTML.includes('Nível 3'));
});
test('wallet shows available and reserved funds, entry risk, production, and the completed coin statement',async()=>{
  const root=element(),dialog=element(),body=element(),listeners={};
  const world={player:{id:'third',name:'Terceiro'},wallet:{balance:1000,available:600,reserved:400,productionPerDay:1000,entries:[{kind:'battle_loot',amount:-400,area_name:'Agreste',created_at:'2026-11-20T15:00:00Z'}]},economy:{initialCoins:1000,minEntry:100,productionPerDay:1000,cpuReward:300,lootPercent:40},areas:[{id:'se-agreste',name:'Agreste',ordinal:2,cpu_share:.34,owner_id:'rival',owner_name:'Rival',economy:{atRisk:240,maxLoot:240,cpuReward:0}}],ranking:[],history:[]};
  const document={body,hidden:false,createElement:element,addEventListener(type,fn){listeners[type]=fn;},querySelector(selector){return {'#worldRoot':root,'#worldDialog':dialog}[selector]||element();}};
  const context={document,window:{DOMINATION_SERGIPE_MAP:require('../public/sergipe-map'),DOMINATION_WORLD_BRIDGE:{}},location:{protocol:'https:',host:'game.example'},WebSocket:class{constructor(){this.readyState=1;}close(){}},AbortController,setTimeout,clearTimeout,setInterval(){},fetch:async()=>({ok:true,json:async()=>structuredClone(world)})};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/world.js'),'utf8'),context);await flush();
  assert(root.innerHTML.includes('600</strong>'));assert(root.innerHTML.includes('400 reservadas'));
  assert(root.innerHTML.includes('1.000 moedas por dia'));assert(root.innerHTML.includes('Saque possível: até 240'));assert(root.innerHTML.includes('Reserva para entrar: 240'));
  await root.listeners.click({target:{closest:()=>({dataset:{action:'wallet'}})}});
  assert(dialog.innerHTML.includes('Sua carteira'));assert(dialog.innerHTML.includes('300 moedas'));assert(dialog.innerHTML.includes('Defender é permitido sem moedas'));assert(dialog.innerHTML.includes('-400'));
  world.wallet.available=99;listeners.visibilitychange();await flush();
  assert(root.innerHTML.includes('data-action="attack" disabled'),'insufficient funds disable initiating attacks without hiding the map');
});
test('a third player sees the public attack alert, watches read-only, then selects a neutral base to join',async()=>{
  const root=element(),dialog=element(),body=element(),game=element(),back=element(),calls=[],started=[],sources=[],select={id:'worldJoinSite',value:'12'};
  const engine=createBattle({centralOwner:2,share:.5}),snapshot=engine.snapshot();
  const watch={id:'live',areaId:'se-agreste',areaName:'Agreste',status:'active',mode:'browser',isHost:false,playerOwner:0,epoch:'live',revision:0,maxOwners:4,snapshot,canJoin:true,joinableSites:[{id:12,kind:'H'}],players:[{owner:1,name:'Atacante'},{owner:2,name:'Defensor'}]};
  const world={player:{id:'third',name:'Terceiro'},areas:[{id:'se-agreste',name:'Agreste',ordinal:2,cpu_share:.34,owner_id:'defender',owner_name:'Defensor',battle_id:'live',attacker_id:'host'}],ranking:[],history:[]};
  const bridge={start(record,command){started.push({record,command});},apply(){},control(){},commandStatus(){},stop(){},show(){}};
  class Events{constructor(){this.handlers={};sources.push(this);}addEventListener(type,fn){this.handlers[type]=fn;}close(){}}
  const document={body,hidden:false,createElement:element,addEventListener(){},querySelector(selector){return {'#worldRoot':root,'#worldDialog':dialog,'#game':game,'#backToWorld':back,'#worldJoinSite':select}[selector]||element();}};
  const context={document,window:{DOMINATION_SERGIPE_MAP:require('../public/sergipe-map'),DOMINATION_WORLD_BRIDGE:bridge},location:{protocol:'https:',host:'game.example'},
    WebSocket:class{constructor(){this.readyState=1;}close(){}},EventSource:Events,Worker:class{constructor(){throw Error('A spectator must not host the simulation');}},AbortController,setTimeout,clearTimeout,setInterval(){},
    fetch:async(path,options)=>{calls.push({path,body:options.body&&JSON.parse(options.body)});return {ok:true,json:async()=>structuredClone(path==='/api/world'?world:path.endsWith('/join')?{...watch,joinState:'pending',canJoin:false}:watch)};}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/world.js'),'utf8'),context);await flush();
  assert(body.children[0].innerHTML.includes('Agreste sob ataque'));assert(root.innerHTML.includes('ASSISTIR BATALHA'));
  await root.listeners.click({target:{closest:()=>({dataset:{action:'attack'}})}});await flush();
  assert.equal(started[0].record.playerOwner,0);const panel=game.children[0];assert(panel.innerHTML.includes('ESPECTADOR'));assert(panel.innerHTML.includes('Base 13 · Heliporto'));
  const before=calls.length;await started[0].command({type:'send',sources:[4],target:0});assert.equal(calls.length,before);
  await panel.listeners.click({target:{closest:()=>({dataset:{battleAction:'join'}})}});await flush();
  assert.equal(calls.find(call=>call.path.endsWith('/join')).body.site,12);assert(panel.innerHTML.includes('Aguardando a confirmação'));
  assert(engine.join(3,12));
  sources[0].handlers.state({data:JSON.stringify({...watch,playerOwner:3,joinState:'active',canJoin:false,revision:1,snapshot:engine.snapshot(),players:[...watch.players,{owner:3,name:'Terceiro'}]})});
  assert.equal(started.at(-1).record.playerOwner,3);assert.equal(panel.innerHTML,'');
});
test('returning player sees every recent attack, is not repeatedly interrupted, and can select a counterattack target',async()=>{
  const root=element(),dialog=element(),body=element(),back=element(),calls=[],started=[],storage=new Map(),listeners={};
  const world={player:{id:'guardian',name:'Guardião'},areas:[{id:'se-litoral-sul',name:'Litoral Sul',ordinal:1,cpu_share:.32,owner_id:'raider',owner_name:'Rival A'}],ranking:[],history:[],receivedAttacks:[
    {id:'recent-1',area_name:'Litoral Sul',attacker_name:'Rival A',status:'won',started_at:'2026-11-19T22:00:00Z',revengeArea:{id:'se-litoral-sul',name:'Litoral Sul',busy:false},counterAreas:[{id:'se-agreste',name:'Agreste',busy:false}]},
    {id:'recent-2',area_name:'Alto Sertão',attacker_name:'Rival B',status:'lost',started_at:'2026-11-19T21:00:00Z',revengeArea:null,counterAreas:[{id:'se-sao-francisco',name:'Vale do São Francisco',busy:false}]}
  ]};
  const bridge={start(record){started.push(record);},stop(){},show(){},control(){},apply(){},commandStatus(){}};
  const document={body,hidden:false,createElement:element,querySelector(selector){return {'#worldRoot':root,'#worldDialog':dialog,'#backToWorld':back}[selector]||element();},addEventListener(type,fn){listeners[type]=fn;}};
  const context={document,window:{DOMINATION_SERGIPE_MAP:require('../public/sergipe-map'),DOMINATION_WORLD_BRIDGE:bridge},location:{protocol:'https:',host:'game.example'},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    WebSocket:class{constructor(){this.readyState=1;}close(){}},EventSource:class{addEventListener(){}close(){}},AbortController,setTimeout,clearTimeout,setInterval(){},
    fetch:async(path,options)=>{calls.push({path,body:options.body&&JSON.parse(options.body)});return {ok:true,json:async()=>path.endsWith('/retaliate')?{id:'response',areaId:'se-sao-francisco',areaName:'Vale do São Francisco',status:'active',playerOwner:1,snapshot:{time:0}}:structuredClone(world)};}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/world.js'),'utf8'),context);await flush();
  assert(dialog.open);assert(dialog.innerHTML.includes('Últimos 2 ataques sofridos'));assert(dialog.innerHTML.includes('Rival A'));assert(dialog.innerHTML.includes('Rival B'));
  assert(dialog.innerHTML.includes('REVANCHE'));assert(dialog.innerHTML.includes('CONTRA-ATACAR'));assert(storage.has('domination_received_guardian'));
  await dialog.listeners.click({target:{closest:()=>({dataset:{dialog:'close'}})}});
  listeners.visibilitychange();await flush();assert.equal(dialog.open,false,'unchanged history should not reopen on every return');
  world.receivedAttacks.unshift({...world.receivedAttacks[0],id:'recent-3'});listeners.visibilitychange();await flush();
  assert(dialog.open);assert(dialog.innerHTML.includes('Últimos 3 ataques sofridos'));
  await dialog.listeners.click({target:{closest:()=>({dataset:{counter:'recent-2'}})}});
  assert(dialog.innerHTML.includes('Escolha onde contra-atacar'));assert(dialog.innerHTML.includes('Vale do São Francisco'));
  await dialog.listeners.click({target:{closest:()=>({dataset:{respond:'recent-2',target:'se-sao-francisco'}})}});await flush();
  const response=calls.find(call=>call.path.endsWith('/recent-2/retaliate'));assert(response);assert.equal(response.body.areaId,'se-sao-francisco');
  assert.equal(started[0].areaId,'se-sao-francisco');assert.equal(dialog.open,false);
});
test('owner sees attack alert and animated map indicator, joins defense, receives command acknowledgements and releases to CPU',async()=>{
  const root=element(),dialog=element(),body=element(),back=element(),requests=[],sockets=[],sources=[],started=[],applied=[],feedback=[];
  const area={id:'se-aracaju',name:'Aracaju · Capital',ordinal:5,description:'Defenda sua área.',cpu_share:.39,owner_id:'guardian',owner_name:'Guardião',battle_id:'battle',attacker_id:'raider',attacker_name:'Rival'};
  const data={player:{id:'guardian',name:'Guardião',username:'guardian'},areas:[area],ranking:[],history:[]};
  const record={id:'battle',areaId:area.id,areaName:area.name,playerOwner:2,defenderControlled:true,status:'active',epoch:'epoch',revision:1,snapshot:{time:1}};
  const bridge={start(r,command){started.push({r,command});},apply(s){applied.push(s);},commandStatus(text,failed){feedback.push({text,failed});},control(){},stop(){},show(){},classic(){}};
  class Socket{constructor(){this.readyState=1;this.sent=[];sockets.push(this);}send(raw){this.sent.push(JSON.parse(raw));}close(){this.readyState=3;}}
  class Events{constructor(){this.handlers={};sources.push(this);}addEventListener(type,fn){this.handlers[type]=fn;}close(){}}
  const document={body,hidden:false,querySelector(selector){return {'#worldRoot':root,'#worldDialog':dialog,'#backToWorld':back}[selector]||element();},createElement:element,addEventListener(){}};
  const context={crypto:require('node:crypto').webcrypto,document,window:{DOMINATION_SERGIPE_MAP:require('../public/sergipe-map'),DOMINATION_WORLD_BRIDGE:bridge},location:{protocol:'https:',host:'game.example'},WebSocket:Socket,EventSource:Events,AbortController,
    setTimeout,clearTimeout,setInterval(){},FormData:class{},fetch:async(path,options)=>{requests.push(path);return {ok:true,json:async()=>path.endsWith('/defend')?structuredClone(record):path.endsWith('/release')?{released:true}:structuredClone(data)};}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/world.js'),'utf8'),context);await flush();
  const alerts=body.children[0];assert(alerts.innerHTML.includes('Sua área está sob ataque!'));assert(alerts.innerHTML.includes('Aracaju · Capital'));
  assert(root.innerHTML.includes('ASSUMIR DEFESA'));assert(root.innerHTML.includes('w-swords'));
  assert(root.innerHTML.includes('Aracaju · Capital — em batalha'));
  sockets[0].onmessage({data:JSON.stringify({type:'ready'})});
  await root.listeners.click({target:{closest:()=>({dataset:{action:'defend'}})}});await flush();
  assert(requests.includes('/api/world/battles/battle/defend'));assert.equal(started[0].r.playerOwner,2);
  const sending=started[0].command({type:'send',sources:[1],target:0});
  const command=sockets[0].sent.at(-1);assert.equal(command.type,'command');assert.equal(command.battleId,'battle');
  sockets[0].onmessage({data:JSON.stringify({type:'ack',requestId:command.requestId,battleId:'battle',accepted:true,record:{...record,revision:3,snapshot:{time:2}}})});
  await sending;assert.equal(feedback.at(-1).text,'Ordem enviada ao combate');assert.equal(applied.at(-1).time,2);
  const count=applied.length;
  sources[0].handlers.state({data:JSON.stringify({...record,revision:2,snapshot:{time:1.5}})});
  assert.equal(applied.length,count,'late SSE packets must not rewind a confirmed command');
  const refused=started[0].command({type:'send',sources:[4],target:0}),bad=sockets[0].sent.at(-1);
  sockets[0].onmessage({data:JSON.stringify({type:'ack',requestId:bad.requestId,battleId:'battle',accepted:false,message:'Tropas insuficientes'})});
  await refused;assert.equal(feedback.at(-1).failed,true);assert.equal(feedback.at(-1).text,'Tropas insuficientes');
  context.window.WorldApp.requestSurrender();assert(dialog.innerHTML.includes('Devolver a defesa à CPU?'));
  await dialog.listeners.click({target:{closest:()=>({dataset:{dialog:'release-defense'}})}});await flush();
  assert(requests.includes('/api/world/battles/battle/release'));
});

test('defenders, spectators and late entrants use safe controls and distinct army palettes in the real bridge',()=>{
  const html=fs.readFileSync(require.resolve('../public/index.html'),'utf8'),elements=new Map();
  const context={window:{createWorldMotion},document:{body:element(),createElement:element},performance:{now:()=>100},setTimeout,clearTimeout,
    COL:[{}, {base:"blue"},{base:"red"},{base:"green"},{base:"purple"}],esc:value=>String(value),game:null,PTR:new Map(),closeModal(){},buildLevel(){return {sites:Array.from({length:17},(_,id)=>({id}))};},MW:390,MAPH:640,
    $(selector){if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);},exitGame(){},setTab(){}};
  vm.createContext(context);
  vm.runInContext("const OPP_COLS=[2,3,4];"+html.match(/function palFor[^\n]+/)[0]+"\nfunction newGame(value){game=value;game.units=[];game.fx=[];}\n"+
    html.slice(html.indexOf('window.DOMINATION_WORLD_BRIDGE='),html.indexOf('window.DOMDBG=')),context);
  const snapshot=createBattle().snapshot();
  context.window.DOMINATION_WORLD_BRIDGE.start({snapshot,playerOwner:2,defenderName:'Guardião',attackerName:'Rival'},()=>{});
  assert.equal(context.game.me,2);assert.equal(context.game.mine[0],2);
  assert.equal(context.game.pal[2],1,'defender troops use the blue palette');
  assert.equal(context.game.pal[1],2,'attacker troops use the red palette');
  assert(elements.get('#legend').innerHTML.includes('Você · Defesa'));
  const players=[1,2,3,4].map(owner=>({owner,name:'Comandante '+owner}));
  context.window.DOMINATION_WORLD_BRIDGE.start({snapshot,playerOwner:0,maxOwners:4,players},()=>{});
  assert.equal(context.game.me,0);assert.equal(context.game.mine.length,0);assert.equal(context.game.pal[4],4);assert.equal(elements.get('#btnDrop').style.display,'none');
  context.window.DOMINATION_WORLD_BRIDGE.start({snapshot,playerOwner:3,maxOwners:4,players},()=>{});
  assert.equal(context.game.me,3);assert.equal(context.game.mine[0],3);assert.equal(context.game.pal[3],1);assert.equal(new Set(context.game.pal.slice(1)).size,4);
});

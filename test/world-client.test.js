'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createBattle}=require('../server/battle-engine');
const {createWorldMotion}=require('../public/world-motion');
function element(){return {innerHTML:'',textContent:'',style:{},dataset:{},listeners:{},open:false,children:[],
  classList:{add(){},remove(){},toggle(){}},addEventListener(type,fn){this.listeners[type]=fn;},
  setAttribute(){},append(child){this.children.push(child);},showModal(){this.open=true;},close(){this.open=false;},querySelector(){return element();}};}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('individual troop screen purchases only the selected type and recovers lost confirmations',async()=>{
  const root=element(),dialog=element(),body=element(),calls=[],listeners={};let loseConfirmation=false;
  const {armyView,ARMY_RULES}=require('../server/progression'),{troopCatalog}=require('../server/troops');
  const wallet={level:1,levels:{tanque:1,desliz:1,heli:1,canhao:1,central:1},owned:0,cards:{heli:2100}};let balance=1000;
  const world={player:{id:'hero',name:'Hero',username:'hero'},progression:structuredClone(ARMY_RULES),wallet:{balance:1000,available:1000,reserved:0,productionPerDay:0,entries:[]},economy:{initialCoins:1000,minEntry:0,productionPerDay:1000,cpuReward:300,lootPercent:40},areas:[{id:'se-litoral-sul',name:'Litoral Sul',ordinal:1,cpu_share:.32,defense_share:19/81,defense_bases:3,resistance:'Baixa',first_capture_reward:300}],ranking:[],history:[]};
  function update(){world.army=armyView(wallet,BigInt(balance*100),100);world.troops=troopCatalog(world.army);world.wallet.balance=world.wallet.available=balance;}update();
  const document={body,hidden:false,createElement:element,addEventListener(type,fn){listeners[type]=fn;},querySelector(selector){return {'#worldRoot':root,'#worldDialog':dialog}[selector]||element();}};
  const context={crypto:require('node:crypto').webcrypto,document,window:{DOMINATION_SERGIPE_MAP:require('../public/sergipe-map'),DOMINATION_WORLD_BRIDGE:{}},location:{protocol:'https:',host:'game.example'},WebSocket:class{constructor(){this.readyState=1;}close(){}},AbortController,setTimeout,clearTimeout,setInterval(){},fetch:async(path,options)=>{
    if(path.endsWith('/upgrade')){const input=JSON.parse(options.body);calls.push(input);assert.equal(input.troopKind,'heli');assert.equal(input.expectedLevel,wallet.levels.heli);balance-=world.army.troops.heli.nextCost;wallet.cards.heli-=world.army.troops.heli.nextCards;wallet.levels.heli++;wallet.level=wallet.levels.heli;update();if(loseConfirmation)throw Error('Reply lost');}
    return {ok:true,json:async()=>structuredClone(world)};
  }};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/world.js'),'utf8'),context);await flush();
  assert(root.innerHTML.includes('lobby-logo-v1.webp'));assert(!root.innerHTML.includes('3 bases + bombardeiro'));
  await root.listeners.click({target:{closest:()=>({dataset:{action:'area-details'}})}});assert(dialog.innerHTML.includes('3 bases + bombardeiro'));dialog.close();
  await root.listeners.click({target:{closest:()=>({dataset:{tab:'troops'}})}});assert(root.innerHTML.includes('EVOLUÇÃO INDIVIDUAL'));assert(root.innerHTML.includes('Bombardeiro central'));
  const rootClick=dataset=>root.listeners.click({target:{closest:()=>({dataset})}}),dialogClick=action=>dialog.listeners.click({target:{closest:()=>({dataset:{dialog:action}})}});
  assert.equal((root.innerHTML.match(/data-select-troop=/g)||[]).length,11);assert(!root.innerHTML.includes('data-troop='));
  await rootClick({selectTroop:'heli'});assert(root.innerHTML.includes('data-troop="heli"'));assert(!root.innerHTML.includes('data-troop="tanque"'));assert.equal(dialog.open,false);
  await rootClick({troop:'heli'});assert(dialog.innerHTML.includes('Melhorar Helicóptero por 10 cartas e 100 moedas'));assert(dialog.innerHTML.includes('Base de origem:'));assert(!dialog.innerHTML.includes('w-attack-stats'));assert(dialog.innerHTML.includes('data-troop-tab="carta" aria-selected="true"'));
  await dialog.listeners.click({target:{closest:()=>({dataset:{troopTab:'ataque'}})}});assert(dialog.innerHTML.includes('Intervalo de tiros'));assert(!dialog.innerHTML.includes('Base de origem:'));assert(dialog.innerHTML.includes('data-troop-tab="ataque" aria-selected="true"'));
  assert.equal(calls.length,0);await dialogClick('confirm-upgrade');assert.equal(calls.length,0,'details alone never authorize a purchase');
  await dialogClick('review-upgrade');assert(dialog.innerHTML.includes('CONFIRMAR · 100'));assert(dialog.innerHTML.includes('900 moedas'));assert.equal(calls.length,0);
  await dialogClick('troop-details');assert(dialog.innerHTML.includes('Melhorar Helicóptero por 10 cartas e 100 moedas'));assert.equal(balance,1000);assert.equal(calls.length,0,'cancel must not spend coins');
  await dialogClick('review-upgrade');
  const event={target:{closest:()=>({dataset:{dialog:'confirm-upgrade'}})}};
  await Promise.all([dialog.listeners.click(event),dialog.listeners.click(event)]);await flush();assert.equal(calls.length,1);assert.equal(balance,900);assert(dialog.innerHTML.includes('Nível 2'));assert.equal(wallet.levels.tanque,1);
  loseConfirmation=true;await dialogClick('review-upgrade');await dialog.listeners.click(event);await flush();assert.equal(calls.length,2);assert.equal(balance,650);assert(dialog.innerHTML.includes('novo nível já foi confirmado'));assert(dialog.innerHTML.includes('Nível 3'));assert.equal(wallet.levels.canhao,1);
  await dialogClick('review-upgrade');dialog.listeners.cancel();await dialogClick('confirm-upgrade');assert.equal(calls.length,2,'Escape revokes the pending confirmation');
  await dialogClick('review-upgrade');wallet.levels.heli=4;update();listeners.visibilitychange();await flush();
  await dialogClick('confirm-upgrade');assert.equal(calls.length,2,'a stale quote must be reviewed again');assert(dialog.innerHTML.includes('Os dados da melhoria mudaram'));
  balance=0;update();listeners.visibilitychange();await flush();await rootClick({troop:'heli'});
  assert(dialog.innerHTML.includes('Moedas disponíveis insuficientes'));assert(dialog.innerHTML.includes('data-dialog="review-upgrade" disabled'));await dialogClick('review-upgrade');assert(!dialog.innerHTML.includes('data-dialog="confirm-upgrade"'));
  wallet.levels.heli=10;update();listeners.visibilitychange();await flush();await rootClick({troop:'heli'});assert(dialog.innerHTML.includes('NÍVEL MÁXIMO'));assert(!dialog.innerHTML.includes('data-dialog="confirm-upgrade"'));
  world.player=null;listeners.visibilitychange();await flush();await rootClick({troop:'heli'});assert(dialog.innerHTML.includes('ENTRAR PARA MELHORAR'));assert.equal(calls.length,2);
});
test('wallet shows available and reserved funds, entry risk, production, and the completed coin statement',async()=>{
  const root=element(),dialog=element(),body=element(),listeners={};
  const world={player:{id:'third',name:'Terceiro'},wallet:{balance:1000,available:600,reserved:400,productionPerDay:1000,entries:[{kind:'battle_loot',amount:-400,area_name:'Agreste',created_at:'2026-11-20T15:00:00Z'}]},economy:{initialCoins:1000,minEntry:0,productionPerDay:1000,cpuReward:300,lootPercent:40},areas:[{id:'se-agreste',name:'Agreste',ordinal:2,cpu_share:.34,owner_id:'rival',owner_name:'Rival',economy:{atRisk:240,maxLoot:240,cpuReward:0,productionPerDay:1000}}],ranking:[],history:[]};
  const document={body,hidden:false,createElement:element,addEventListener(type,fn){listeners[type]=fn;},querySelector(selector){return {'#worldRoot':root,'#worldDialog':dialog}[selector]||element();}};
  const context={document,window:{DOMINATION_SERGIPE_MAP:require('../public/sergipe-map'),DOMINATION_WORLD_BRIDGE:{}},location:{protocol:'https:',host:'game.example'},WebSocket:class{constructor(){this.readyState=1;}close(){}},AbortController,setTimeout,clearTimeout,setInterval(){},fetch:async()=>({ok:true,json:async()=>structuredClone(world)})};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/world.js'),'utf8'),context);await flush();
  assert(root.innerHTML.includes('600</strong>'));assert(!root.innerHTML.includes('400 reservadas'));
  assert(root.innerHTML.includes('1.000 moedas/dia'));assert(!root.innerHTML.includes('Saque possível: até 240'));
  await root.listeners.click({target:{closest:()=>({dataset:{action:'area-details'}})}});assert(dialog.innerHTML.includes('Saque possível: até 240'));assert(dialog.innerHTML.includes('Reserva para entrar: 240'));dialog.close();
  await root.listeners.click({target:{closest:()=>({dataset:{action:'wallet'}})}});
  assert(dialog.innerHTML.includes('Sua carteira'));assert(dialog.innerHTML.includes('400 reservadas'));assert(dialog.innerHTML.includes('300 moedas'));assert(dialog.innerHTML.includes('inclusive zero'));assert(dialog.innerHTML.includes('-400'));
  for(const balance of [99,1,0]){world.wallet.available=balance;listeners.visibilitychange();await flush();assert(!root.innerHTML.includes('data-action="attack" disabled'));}
  await root.listeners.click({target:{closest:()=>({dataset:{action:'area-details'}})}});assert(dialog.innerHTML.includes('Sem moedas: você pode conquistar a área'));
  world.wallet.available=80.09;listeners.visibilitychange();await flush();assert(root.innerHTML.includes('80</strong>'));assert(!root.innerHTML.includes('80,09'));
});
test('a third player sees the public attack alert, watches read-only, then selects a neutral base to join',async()=>{
  const root=element(),dialog=element(),body=element(),game=element(),back=element(),calls=[],started=[],sources=[],select={id:'worldJoinSite',value:'12'};
  const engine=createBattle({centralOwner:2,share:.5}),snapshot=engine.snapshot();
  const watch={id:'live',areaId:'se-agreste',areaName:'Agreste',status:'active',mode:'browser',isHost:false,playerOwner:0,epoch:'live',revision:0,maxOwners:4,snapshot,canJoin:true,joinableSites:[{id:12,kind:'H'}],players:[{owner:1,name:'Atacante'},{owner:2,name:'Defensor'}]};
  const world={player:{id:'third',name:'Terceiro'},wallet:{balance:0,available:0,reserved:0},economy:{minEntry:0,lootPercent:40},areas:[{id:'se-agreste',name:'Agreste',ordinal:2,cpu_share:.34,owner_id:'defender',owner_name:'Defensor',battle_id:'live',attacker_id:'host'}],ranking:[],history:[]};
  const bridge={start(record,command){started.push({record,command});},apply(){},control(){},commandStatus(){},stop(){},show(){}};
  class Events{constructor(){this.handlers={};sources.push(this);}addEventListener(type,fn){this.handlers[type]=fn;}close(){}}
  const document={body,hidden:false,createElement:element,addEventListener(){},querySelector(selector){return {'#worldRoot':root,'#worldDialog':dialog,'#game':game,'#backToWorld':back,'#worldJoinSite':select}[selector]||element();}};
  const context={document,window:{DOMINATION_SERGIPE_MAP:require('../public/sergipe-map'),DOMINATION_WORLD_BRIDGE:bridge},location:{protocol:'https:',host:'game.example'},
    WebSocket:class{constructor(){this.readyState=1;}close(){}},EventSource:Events,Worker:class{constructor(){throw Error('A spectator must not host the simulation');}},AbortController,setTimeout,clearTimeout,setInterval(){},
    fetch:async(path,options)=>{calls.push({path,body:options.body&&JSON.parse(options.body)});return {ok:true,json:async()=>structuredClone(path==='/api/world'?world:path.endsWith('/join')?{...watch,joinState:'pending',canJoin:false}:watch)};}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/world.js'),'utf8'),context);await flush();
  assert(body.children[0].innerHTML.includes('Agreste sob ataque'));assert(root.innerHTML.includes('ASSISTIR BATALHA'));
  await root.listeners.click({target:{closest:()=>({dataset:{action:'attack'}})}});await flush();
  assert.equal(started[0].record.playerOwner,0);const panel=game.children[0];assert(panel.innerHTML.includes('ESPECTADOR'));assert(panel.innerHTML.includes('Base 13 · Heliporto'));assert(!panel.innerHTML.includes('data-battle-action="join" disabled'));assert(panel.innerHTML.includes('Sem saldo: sem ganhos nem perdas'));
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

test('profile navigation paginates personal matches, shows per-match coins and clears data after logout',async()=>{
  const root=element(),dialog=element(),body=element(),listeners={},calls=[];
  const {armyView,ARMY_RULES}=require('../server/progression'),{troopCatalog}=require('../server/troops');
  const army=armyView({level:1,owned:0},100000n,100);
  const world={player:{id:'me',name:'Meu <Perfil>',username:'myprofile'},army,troops:troopCatalog(army),progression:ARMY_RULES,wallet:{balance:1000,available:1000,reserved:0,productionPerDay:0,entries:[]},economy:{minEntry:0,productionPerDay:1000},areas:[{id:'se-litoral-sul',name:'Litoral Sul',ordinal:1,cpu_share:.32}],ranking:[],history:[]};
  const profile={player:{...world.player,createdAt:'2026-11-20T14:00:00Z'},stats:{total:21,wins:10,losses:9,withdrawals:1,cancelled:1,winRate:50},pagination:{page:1,pages:2,total:21},matches:[{id:'own',role:'invader',outcome:'lost',area_name:'Agreste',attacker_name:'Rival',defender_name:'Dono',coin_change:-400,started_at:'2026-11-20T14:00:00Z',finished_at:'2026-11-20T14:03:00Z',army_level:1}]};
  const document={body,hidden:false,createElement:element,addEventListener(type,fn){listeners[type]=fn;},querySelector(s){return {'#worldRoot':root,'#worldDialog':dialog}[s]||element();}};
  const context={document,window:{DOMINATION_SERGIPE_MAP:require('../public/sergipe-map'),DOMINATION_WORLD_BRIDGE:{stop(){}}},location:{protocol:'https:',host:'game.example'},WebSocket:class{constructor(){this.readyState=1;}close(){}},AbortController,setTimeout,clearTimeout,setInterval(){},fetch:async(path)=>{
    calls.push(path);if(path.startsWith('/api/world/profile')){const page=Number(new URL(path,'https://game.example').searchParams.get('page'));return {ok:true,json:async()=>({...structuredClone(profile),pagination:{...profile.pagination,page},matches:page===1?profile.matches:[{...profile.matches[0],area_name:'Capital',outcome:'won',coin_change:600}]})};}
    if(path==='/api/auth/logout')world.player=null;
    return {ok:true,json:async()=>structuredClone(world)};
  }};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/world.js'),'utf8'),context);await flush();
  const click=dataset=>root.listeners.click({target:{closest:()=>({dataset})}});
  await click({tab:'profile'});await flush();assert(root.innerHTML.includes('Meu &lt;Perfil&gt;'));assert(root.innerHTML.includes('DERROTA'));assert(root.innerHTML.includes('Invasão'));assert(root.innerHTML.includes('-400 🪙'));assert(root.innerHTML.includes('21 concluídas'));
  await click({profilePage:'2'});await flush();assert(root.innerHTML.includes('Capital'));assert(root.innerHTML.includes('+600 🪙'));assert(root.innerHTML.includes('2 / 2'));
  assert.equal(calls.filter(p=>p.startsWith('/api/world/profile')).length,2);
  await click({logoutConfirm:'yes',action:'logout-confirm'});await dialog.listeners.click({target:{closest:()=>({dataset:{dialog:'logout'}})}});await flush();
  assert(root.innerHTML.includes('Entre para ver suas conquistas'));assert(!root.innerHTML.includes('Meu &lt;Perfil&gt;'));assert(!root.innerHTML.includes('21 concluídas'));
});

test('territory previews expose different battlefield terrain and the matching initial formation',async()=>{
  const root=element(),dialog=element(),body=element(),maps=require('../shared/battle-maps');
  const areas=maps.list().map((m,i)=>{const setup=require('../server/battle-engine').initialSites(.5,i+1,2,3,m.id);return {id:m.area,name:m.name,ordinal:i+1,cpu_share:.35,map_id:m.id,map_name:m.name,map_tag:m.tag,map_description:m.description,map_defender_sites:setup.sites.filter(s=>s.owner===2).map(s=>s.id),map_attacker_site:4};});
  const world={areas,ranking:[],history:[],progression:{cpuPowerRatio:.8}};
  const document={body,hidden:false,createElement:element,addEventListener(){},querySelector(s){return {'#worldRoot':root,'#worldDialog':dialog}[s]||element();}};
  const context={document,window:{DOMINATION_SERGIPE_MAP:require('../public/sergipe-map'),DOMINATION_MAPS:maps,DOMINATION_WORLD_BRIDGE:{}},location:{protocol:'https:',host:'game.example'},WebSocket:class{constructor(){this.readyState=1;}close(){}},AbortController,setTimeout,clearTimeout,setInterval(){},fetch:async()=>({ok:true,json:async()=>structuredClone(world)})};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/world.js'),'utf8'),context);await flush();
  const click=dataset=>root.listeners.click({target:{closest:()=>({dataset})}});
  assert(root.innerHTML.includes('Arquipélago costeiro'));await click({action:'preview-map'});assert(dialog.innerHTML.includes('ILHAS')||dialog.innerHTML.includes('Ilhas'));
  assert.equal((dialog.innerHTML.match(/<polygon /g)||[]).length,65);assert.equal((dialog.innerHTML.match(/fill="#ae554f"/g)||[]).length,4);
  dialog.close();await click({area:'se-agreste'});assert(root.innerHTML.includes('Encruzilhadas do Agreste'));await click({action:'preview-map'});assert.equal((dialog.innerHTML.match(/<polygon /g)||[]).length,101);assert(dialog.innerHTML.includes('Q: quartel'));
});
test('expanded collection previews origin bases and saves at most three unlocked ground choices in order',async()=>{
 const root=element(),dialog=element(),body=element(),calls=[];
 const rules=require('../shared/troop-rules'),{armyView,ARMY_RULES}=require('../server/progression'),{troopCatalog}=require('../server/troops');
 const levels=Object.fromEntries(rules.KINDS.map(k=>[k,7])),army=armyView({level:7,levels,battles:250,owned:0,loadout:['tanque']},100000n,0);
 const world={player:{id:'hero',name:'Hero',username:'hero'},army,troops:troopCatalog(army),progression:ARMY_RULES,wallet:{balance:1000,available:1000,reserved:0,entries:[]},areas:[{id:'se-litoral-sul',name:'Litoral Sul',ordinal:1,cpu_share:.32}],ranking:[],history:[]};
 const document={body,hidden:false,createElement:element,addEventListener(){},querySelector(s){return {'#worldRoot':root,'#worldDialog':dialog}[s]||element();}};
 const context={document,window:{DOMINATION_SERGIPE_MAP:require('../public/sergipe-map'),DOMINATION_WORLD_BRIDGE:{},DOMINATION_TROOP_RULES:rules,DOMINATION_TROOP_ART:require('../public/troop-art')},location:{protocol:'https:',host:'game.example'},WebSocket:class{close(){}},AbortController,setTimeout,clearTimeout,setInterval(){},fetch:async(path,opts)=>{
  if(path.endsWith('/loadout')){const input=JSON.parse(opts.body);calls.push(input);world.army.loadout=input.troops;return{ok:true,json:async()=>({army:structuredClone(world.army)})};}
  return{ok:true,json:async()=>structuredClone(world)};
 }};
 vm.runInNewContext(fs.readFileSync(require.resolve('../public/world.js'),'utf8'),context);await flush();
 const click=dataset=>root.listeners.click({target:{closest:()=>({dataset})}}),dc=dataset=>dialog.listeners.click({target:{closest:()=>({dataset})}});
 await click({tab:'troops'});assert(root.innerHTML.includes('NÍVEL 7'));assert(root.innerHTML.includes('250 batalhas válidas'));
 await click({troop:'engenheiro'});assert(dialog.innerHTML.includes('/art/bases-expanded-v1.png'));assert(dialog.innerHTML.includes('Oficina de engenharia'));await dc({dialog:'close'});
 await click({action:'loadout'});assert(dialog.innerHTML.includes('Selecionadas: 1/3'));await dc({loadoutKind:'batedor'});await dc({loadoutKind:'engenheiro'});await dc({loadoutKind:'artilharia'});assert(dialog.innerHTML.includes('no máximo três'));assert.equal(calls.length,0);
 await dc({dialog:'save-loadout'});await flush();assert.equal(calls.length,1);assert.deepEqual(calls[0].troops,['tanque','batedor','engenheiro']);assert.equal(dialog.open,false);assert(root.innerHTML.includes('Tanque · Batedor · Engenheiro'));
});
test('daily reward screen exposes automatic missions and random drops without a preferred troop selector',async()=>{
 const root=element(),dialog=element(),body=element();
 const {dailyView}=require('../server/card-rewards');
 const world={player:{id:'rewardsplayer',name:'Player'},areas:[{id:'se-agreste',name:'Agreste',ordinal:2,cpu_share:.34}],ranking:[],history:[],dailyRewards:{...dailyView({battle_cards:30,mission_cards:60,battles:3,captures:5,wins:1,missions:['battles','captures','wins']},Date.now()),recent:[{cards:{tanque:8,heli:7,desliz:5},battleCards:0,missionCards:20,at:new Date().toISOString()}]}};
 const document={body,hidden:false,createElement:element,addEventListener(){},querySelector(s){return {'#worldRoot':root,'#worldDialog':dialog}[s]||element();}};
 const context={document,window:{DOMINATION_SERGIPE_MAP:require('../public/sergipe-map'),DOMINATION_WORLD_BRIDGE:{}},location:{protocol:'https:',host:'game.example'},WebSocket:class{constructor(){this.readyState=1;}close(){}},AbortController,setTimeout,clearTimeout,setInterval(){},fetch:async()=>({ok:true,json:async()=>structuredClone(world)})};
 vm.runInNewContext(fs.readFileSync(require.resolve('../public/world.js'),'utf8'),context);await flush();
 const click=dataset=>root.listeners.click({target:{closest:()=>({dataset})}});
 await click({tab:'more'});assert(root.innerHTML.includes('Recompensas diárias'));
 await click({tab:'rewards'});assert(root.innerHTML.includes('90 / 120 cartas'));assert(root.innerHTML.includes('Conquistar 5 bases inimigas'));assert(root.innerHTML.includes('RECOMPENSA PROCESSADA'));assert(root.innerHTML.includes('meia-noite de Fortaleza'));assert(root.innerHTML.includes('+8'));assert(root.innerHTML.includes('Helicóptero'));assert(!root.innerHTML.includes('data-select-troop'));
});
test('card and attack tabs keep the action visible, expose real per-type stats, support keyboard and never spend on tab changes',async()=>{
 const root=element(),dialog=element(),body=element(),calls=[];
 const {armyView,ARMY_RULES}=require('../server/progression'),{troopCatalog}=require('../server/troops'),rules=require('../shared/troop-rules');
 const levels=Object.fromEntries(rules.KINDS.map(k=>[k,3])),cards=Object.fromEntries(rules.KINDS.map(k=>[k,52]));
 const army=armyView({level:3,levels,cards,battles:250,owned:0},100000n,0);
 const world={player:{id:'cardtabs',name:'Card Tabs'},army,troops:troopCatalog(army),progression:ARMY_RULES,wallet:{balance:1000,available:1000,reserved:0,entries:[]},areas:[{id:'se-agreste',name:'Agreste',ordinal:2,cpu_share:.34}],ranking:[],history:[]};
 const document={body,hidden:false,createElement:element,addEventListener(){},querySelector(s){return {'#worldRoot':root,'#worldDialog':dialog}[s]||element();}};
 const context={document,window:{DOMINATION_SERGIPE_MAP:require('../public/sergipe-map'),DOMINATION_WORLD_BRIDGE:{},DOMINATION_TROOP_ART:require('../public/troop-art')},location:{protocol:'https:',host:'game.example'},WebSocket:class{close(){}},AbortController,setTimeout,clearTimeout,setInterval(){},fetch:async(path,options)=>{calls.push({path,options});return{ok:true,json:async()=>structuredClone(world)};}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../public/world.js'),'utf8'),context);await flush();
 const click=dataset=>root.listeners.click({target:{closest:()=>({dataset})}}),dc=dataset=>dialog.listeners.click({target:{closest:()=>({dataset})}});
 await click({troop:'tanque'});const before=calls.length;
 const footer=()=>dialog.innerHTML.match(/<footer[\s\S]*?<\/footer>/)[0],firstFooter=footer();
 assert(dialog.innerHTML.includes('data-art="transparent-hero"'));assert(dialog.innerHTML.includes('52 / 40 cartas'));assert(dialog.innerHTML.includes('500 moedas'));assert(dialog.innerHTML.includes('Base de origem:'));assert(!dialog.innerHTML.includes('w-attack-stats'));
 await dc({troopTab:'ataque'});assert.equal(footer(),firstFooter);assert(dialog.innerHTML.includes('1,2'));assert(dialog.innerHTML.includes('120%'));assert(dialog.innerHTML.includes('0,3 s'));assert(!dialog.innerHTML.includes('Base de origem:'));assert(!/NaN|Infinity/.test(dialog.innerHTML));
 let prevented=false;dialog.listeners.keydown({key:'ArrowLeft',target:{closest:()=>true},preventDefault(){prevented=true;}});assert(prevented);assert(dialog.innerHTML.includes('data-troop-tab="carta" aria-selected="true"'));assert.equal(calls.length,before);
 await click({troop:'canhao'});await dc({troopTab:'ataque'});assert(dialog.innerHTML.includes('Alcance (hex.)'));assert(dialog.innerHTML.includes('2,6'));assert(!dialog.innerHTML.includes('Velocidade'));assert(dialog.innerHTML.includes('Fixo'));
 await click({troop:'engenheiro'});await dc({troopTab:'ataque'});assert(dialog.innerHTML.includes('0,42'));assert(dialog.innerHTML.includes('120%'));assert(dialog.innerHTML.includes('COMANDANTE 6'));assert(dialog.innerHTML.includes('data-dialog="review-upgrade" disabled'));
 await click({troop:'tanque'});assert(dialog.innerHTML.includes('data-troop-tab="carta" aria-selected="true"'),'opening any card starts on Carta');await dc({dialog:'review-upgrade'});assert(dialog.innerHTML.includes('CONFIRMAR MELHORIA'));assert(dialog.innerHTML.includes('40 cartas de Tanque'));assert(!dialog.innerHTML.includes('data-troop-tab='));
 assert.equal(calls.length,before,'viewing cards, changing tabs and reviewing a purchase never sends a purchase');
});

test('compact lobby keeps live map ownership and read-only area details while preserving safe entry actions',async()=>{
 const root=element(),dialog=element(),body=element(),listeners={},requests=[],maps=require('../shared/battle-maps');
 const areas=maps.list().map((m,i)=>({id:m.area,name:['Litoral Sul','Agreste','Alto Sertão','Vale do São Francisco','Aracaju · Capital'][i],ordinal:i+1,cpu_share:.35,map_id:m.id,map_name:m.name,map_tag:m.tag,map_description:m.description,description:'Avance pelas bases.',map_defender_sites:[0,1,2,3],map_attacker_site:4,defense_bases:3,resistance:'Baixa',owner_id:i===0?'rival':i===1?null:'me',owner_name:i===0?'Rival <A>':i===1?null:'Meu jogador',economy:{productionPerDay:1000,atRisk:0,maxLoot:0,cpuReward:300}}));
 const world={player:{id:'me',name:'Meu <Jogador>'},wallet:{balance:0,available:0,reserved:0,productionPerDay:3000,entries:[]},economy:{lootPercent:40,cpuReward:300},areas,ranking:[],history:[],receivedAttacks:[]};
 const classes=new Set();root.classList={toggle(k,on){on?classes.add(k):classes.delete(k);}};
 const document={body,hidden:false,createElement:element,addEventListener(k,fn){listeners[k]=fn;},querySelector(s){return {'#worldRoot':root,'#worldDialog':dialog}[s]||element();}};
 const context={document,window:{DOMINATION_SERGIPE_MAP:require('../public/sergipe-map'),DOMINATION_MAPS:maps,DOMINATION_WORLD_BRIDGE:{}},location:{protocol:'https:',host:'game.example'},WebSocket:class{close(){}},AbortController,setTimeout,clearTimeout,setInterval(){},fetch:async(path,options)=>{requests.push({path,method:options.method||'GET'});return{ok:true,json:async()=>structuredClone(world)};}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../public/world.js'),'utf8'),context);await flush();
 const click=dataset=>root.listeners.click({target:{closest:()=>({dataset})}}),dc=dataset=>dialog.listeners.click({target:{closest:()=>({dataset})}}),primary=()=>root.innerHTML.match(/<button class="w-lobby-battle"[^>]*>[\s\S]*?<\/button>/)[0];
 assert(classes.has('w-lobby'));assert(root.innerHTML.includes('Meu &lt;Jogador&gt;'));assert(root.innerHTML.includes('3 de 5 áreas'));assert.equal((root.innerHTML.match(/role="button" tabindex="0"/g)||[]).length,5);
 assert(!root.innerHTML.includes('w-army-card'));assert(!root.innerHTML.includes('w-def'));assert(!root.innerHTML.includes('Saque possível'));assert(root.innerHTML.includes('w-territory mine'));assert(root.innerHTML.includes('w-territory rival'));assert(!primary().includes('disabled'));
 const initialRequests=requests.length;
 await click({action:'area-details'});assert(dialog.open);assert(dialog.innerHTML.includes('Sem saldo na entrada: sem saque nem bônus em moedas.'));assert(dialog.innerHTML.includes('Reserva para entrar: 0'));assert(dialog.innerHTML.includes('3 bases + bombardeiro'));assert(dialog.innerHTML.includes('Rival &lt;A&gt;'));
 await dc({dialog:'preview-map'});assert(dialog.innerHTML.includes('Q: quartel'));assert(dialog.innerHTML.includes('data-dialog="area-details"'));
 await dc({dialog:'area-details'});assert(dialog.innerHTML.includes('Reserva para entrar: 0'));await dc({dialog:'close'});
 await click({area:areas[2].id});assert(primary().includes('disabled'));assert(primary().includes('SOB SEU COMANDO'));
 await click({action:'area-details'});await dc({dialog:'area-battle'});assert.equal(requests.length,initialRequests,'an owned peaceful area never starts a battle');dialog.close();
 let prevented=false;root.listeners.keydown({key:'Enter',target:{closest:()=>({dataset:{mapArea:areas[1].id}})},preventDefault(){prevented=true;}});assert(prevented);assert(primary().includes('Agreste'));assert(!primary().includes('disabled'));
 await click({tab:'more'});assert(!classes.has('w-lobby'));assert(root.innerHTML.includes('Recompensas diárias'));await click({tab:'territories'});assert(classes.has('w-lobby'));
 areas[2].battle_id='live-defense';areas[2].attacker_id='rival';listeners.visibilitychange();await flush();await click({area:areas[2].id});assert(primary().includes('ASSUMIR DEFESA'));assert(primary().includes('data-action="defend"'));assert(!primary().includes('disabled'));assert(root.innerHTML.includes('— em batalha'));
 areas[0].battle_id='live-watch';areas[0].attacker_id='third';listeners.visibilitychange();await flush();await click({area:areas[0].id});assert(primary().includes('ASSISTIR BATALHA'));
 areas[0].participant_ids=['me'];listeners.visibilitychange();await flush();assert(primary().includes('RETOMAR BATALHA'));assert(primary().includes('data-battle="live-watch"'));
 assert(requests.every(r=>r.method==='GET'),'selection, navigation and information panels never send a mutation');
});

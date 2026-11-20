'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createBattle}=require('../server/battle-engine');
const {createWorldMotion}=require('../public/world-motion');
function element(){return {innerHTML:'',textContent:'',style:{},dataset:{},listeners:{},open:false,children:[],
  classList:{add(){},remove(){},toggle(){}},addEventListener(type,fn){this.listeners[type]=fn;},
  setAttribute(){},append(child){this.children.push(child);},showModal(){this.open=true;},close(){this.open=false;},querySelector(){return element();}};}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
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

test('defending player selects owner two and sees its own units in blue using the real game bridge',()=>{
  const html=fs.readFileSync(require.resolve('../public/index.html'),'utf8'),elements=new Map();
  const context={window:{createWorldMotion},document:{body:element(),createElement:element},performance:{now:()=>100},setTimeout,clearTimeout,
    game:null,PTR:new Map(),closeModal(){},buildLevel(){return {sites:Array.from({length:17},(_,id)=>({id}))};},MW:390,MAPH:640,
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
});

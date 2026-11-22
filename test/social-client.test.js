'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const flush=()=>new Promise(r=>setImmediate(r));
function element(){return {innerHTML:'',dataset:{},open:false,listeners:{},addEventListener(t,f){this.listeners[t]=f;},querySelector(){return{focus(){}};},close(){this.open=false;},showModal(){this.open=true;}};}
function setup(){
 const root=element(),dialog=element(),calls=[],copies=[],shared=[],world={player:{id:'hero'},troops:[{id:'tanque',name:'Tanque'}]},state={tab:'history'},window={},friend={id:'friendship1',status:'accepted',player:{id:'bob',name:'Bob <script>',username:'bob',commanderLevel:2,online:true,inBattle:true}};
 let friends={code:'ABCDEF1234',friends:[friend],incoming:[],outgoing:[],counts:{total:1,online:1},pagination:{page:1,pages:1}};
 const match={id:'match1',areaName:'Agreste',context:'cpu',outcome:'won',perspective:1,finishedAt:'2026-11-22T12:00:00Z',duration:180,coinChange:300,cards:10,canReplay:true,roster:[{owner:1,playerId:'hero',name:'Hero',loadout:['tanque'],troops:{tanque:{level:4}}},{owner:2,playerId:null,name:'Guarnição da CPU',loadout:['tanque'],troops:{tanque:{level:null,power:.8}}}]};
 const api=async path=>{calls.push({path});if(path.startsWith('/api/world/history'))return{matches:[match],pagination:{page:path.includes('page=2')?2:1,pages:2}};if(path.includes('/friends/search'))return{players:[{id:'new',name:'Novo',username:'novo',status:'none'}]};if(path.includes('/friends/players'))return{id:'bob',name:'Bob',username:'bob',commanderLevel:2,online:true,inBattle:false,stats:{wins:1,losses:2},areas:[]};if(path.includes('/replays'))return{id:'match1',frames:100,inputs:[]};return structuredClone(friends);};
 const context={window,document:{activeElement:null},location:{href:'https://game.example/?invite=ABCD123456'},URL,localStorage:{getItem(){return null;},setItem(){},removeItem(){}},navigator:{clipboard:{writeText:async t=>copies.push(t)},share:async p=>shared.push(p)}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../public/world-social.js'),'utf8'),context);
 let social;const render=()=>{root.innerHTML=state.tab==='friends'?social.friendsScreen():social.historyScreen();};
 social=window.createWorldSocial({root,dialog,getData:()=>world,getTab:()=>state.tab,api,post:async(path,body)=>{calls.push({path,body});if(path.includes('/request'))friends={...friends,outgoing:[{id:'out',direction:'outgoing',status:'pending',player:{id:'new',name:'Novo',username:'novo'}}]};return{saved:true};},render,modal:(html,view)=>{dialog.innerHTML=html;dialog.dataset.view=view;dialog.open=true;},esc:s=>String(s??'').replace(/[<>]/g,c=>c==='<'?'&lt;':'&gt;'),money:String,art:kind=>'<svg data-art="'+kind+'"></svg>',icon:()=>'<svg></svg>',swords:()=>'<svg></svg>',onReplay:r=>shared.push({replay:r})});social.sync();
 return {social,world,state,root,dialog,calls,copies,shared,match,friend,handle:dataset=>social.handle({dataset})};
}
test('new battle records compare frozen armies, paginate, show details and request replay without combat commands',async()=>{
 const ui=setup();ui.social.open('history');await flush();assert(ui.root.innerHTML.includes('VITÓRIA'));assert(ui.root.innerHTML.includes('NÍV. 4'));assert(ui.root.innerHTML.includes('80%'));assert(ui.root.innerHTML.includes('+300'));assert(ui.root.innerHTML.includes('+10'));
 await ui.handle({social:'history-page',page:'2'});assert(ui.root.innerHTML.includes('2 / 2'));
 await ui.handle({social:'history-details',id:'match1'});assert(ui.dialog.innerHTML.includes('Hero'));assert(ui.dialog.innerHTML.includes('Guarnição da CPU'));
 await ui.handle({social:'replay',id:'match1'});assert(ui.shared.some(x=>x.replay));assert(!ui.calls.some(c=>c.path.includes('/commands')));
 ui.match.canReplay=false;ui.social.open('history');await flush();assert(ui.root.innerHTML.includes('disabled title="Replay não disponível'));
});
test('friends invite, share and search actions are explicit and account-specific',async()=>{
 const ui=setup();ui.state.tab='friends';ui.social.open('friends');await flush();assert(ui.root.innerHTML.includes('ABCDEF1234'));assert(ui.root.innerHTML.includes('Bob &lt;script&gt;'));assert(ui.root.innerHTML.includes('Em batalha'));assert.equal(ui.copies.length,0);assert(ui.social.hasInvite());
 await ui.handle({social:'copy-code'});assert.equal(ui.copies[0],'#ABCDEF1234');await ui.handle({social:'share'});assert.equal(ui.shared[0].url,'https://game.example/?invite=ABCDEF1234');
 ui.root.listeners.input({target:{id:'friendSearch',value:'Novo'}});ui.root.listeners.submit({target:{id:'friendSearchForm'},preventDefault(){}});await flush();assert(ui.root.innerHTML.includes('ADICIONAR'));assert(!ui.calls.some(c=>c.path.endsWith('/request')));
 await ui.handle({social:'friend-request',id:'new'});assert(ui.calls.some(c=>c.path.endsWith('/request')&&c.body.playerId==='new'));assert.equal(ui.social.hasInvite(),false);
 await ui.handle({social:'friend-tab',value:'requests'});assert(ui.root.innerHTML.includes('Convite enviado'));
 await ui.handle({social:'friend-profile',id:'bob'});assert(ui.dialog.innerHTML.includes('Comandante Nv. 2'));assert(!ui.dialog.innerHTML.includes('moedas'));
 ui.world.player={id:'other'};ui.social.sync();assert.equal(ui.dialog.open,false);assert(!ui.social.friendsScreen().includes('Bob &lt;script&gt;'));
 ui.world.player=null;ui.social.sync();assert(ui.social.friendsScreen().includes('ENTRAR NA CONTA'));
});
test('removing a friend needs a concrete confirmation, while opening a profile does not send a request',async()=>{
 const ui=setup();ui.state.tab='friends';ui.social.open('friends');await flush();await ui.handle({social:'friend-remove',id:'friendship1'});assert(ui.dialog.innerHTML.includes('Remover amizade?'));assert(!ui.calls.some(c=>c.path.endsWith('/remove')));
 await ui.handle({social:'friend-change',id:'friendship1',action:'remove'});assert(ui.calls.some(c=>c.path.endsWith('/remove')));
});
test('actual world click delegation opens friends and switches history tabs',async()=>{
 const make=()=>({...element(),style:{},classList:{add(){},remove(){},toggle(){}},append(){},setAttribute(){}}),root=make(),dialog=make(),body=make(),calls=[];
 const world={player:null,areas:[{id:'se-litoral-sul',name:'Litoral Sul',ordinal:1}],ranking:[],history:[]};
 const context={window:{DOMINATION_SERGIPE_MAP:require('../public/sergipe-map'),DOMINATION_WORLD_BRIDGE:{}},document:{body,hidden:false,createElement:make,addEventListener(){},querySelector(s){return {'#worldRoot':root,'#worldDialog':dialog}[s]||make();}},location:{href:'https://game.example/',protocol:'https:',host:'game.example'},URL,AbortController,setTimeout,clearTimeout,setInterval(){},fetch:async(path)=>{calls.push(path);return{ok:true,json:async()=>path.includes('/history')?{matches:[],pagination:{page:1,pages:1}}:structuredClone(world)};}};
 vm.createContext(context);for(const file of ['world-social.js','world.js'])vm.runInContext(fs.readFileSync(require.resolve('../public/'+file),'utf8'),context);await flush();
 const click=dataset=>root.listeners.click({target:{closest:s=>s==='button'?{dataset}:null}});
 await click({tab:'history'});await flush();assert(calls.some(p=>p.includes('scope=world')),'guest starts on public history');
 await click({social:'history-scope',scope:'mine'});assert(root.innerHTML.includes('Entre para ver suas partidas'));
 await click({social:'history-scope',scope:'world'});await flush();assert(root.innerHTML.includes('Nenhuma partida concluída'));
 await click({tab:'friends'});assert(root.innerHTML.includes('Entre para convidar amigos'));
});

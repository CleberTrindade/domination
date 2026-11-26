'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const flush=()=>new Promise(r=>setImmediate(r));
function element(){return{innerHTML:'',textContent:'',style:{},dataset:{},open:false,listeners:{},classList:{add(){},remove(){},toggle(){}},append(){},setAttribute(){},addEventListener(t,fn){this.listeners[t]=fn;},showModal(){this.open=true;},close(){this.open=false;},querySelector(){return element();}};}
function setup(world,answer=async()=>({saved:true})){
 const root=element(),dialog=element(),listeners={},calls=[],bridge={stop(){},show(){}};
 const document={body:element(),hidden:false,createElement:element,addEventListener(t,fn){listeners[t]=fn;},querySelector(s){return {'#worldRoot':root,'#worldDialog':dialog}[s]||element();}};
 const context={document,window:{DOMINATION_SERGIPE_MAP:require('../public/sergipe-map'),DOMINATION_WORLD_BRIDGE:bridge},location:{protocol:'https:',host:'game.example'},AbortController,setTimeout,clearTimeout,setInterval(){},WebSocket:class{constructor(){this.readyState=1;}close(){}},fetch:async(path,options)=>{
  if(path.includes('/difficulty-surveys/')){const body=JSON.parse(options.body);calls.push({path,body});const result=await answer(path,body);return{ok:true,json:async()=>result};}
  if(path.includes('/battles/'))return{ok:true,json:async()=>({id:'battle1',areaId:'se-agreste',areaName:'Agreste',playerOwner:1,status:'won',final:{status:'won',areaName:'Agreste',winnerOwner:1}})};
  return{ok:true,json:async()=>structuredClone(world)};
 }};
 vm.runInNewContext(fs.readFileSync(require.resolve('../public/world-area-action.js'),'utf8')+'\n'+fs.readFileSync(require.resolve('../public/world.js'),'utf8'),context);
 return{root,dialog,listeners,calls,click:dataset=>dialog.listeners.click({target:{closest:()=>({dataset})}})};
}
const initial=()=>({player:{id:'hero',name:'Hero'},areas:[{id:'se-litoral-sul',ordinal:1,name:'Litoral Sul'}],ranking:[],history:[],receivedAttacks:[],difficultySurveys:[{id:'survey1',battleId:'battle1',areaId:'se-agreste',areaName:'Agreste',context:'cpu',outcome:'lost'}]});
test('survey UI requires a 1–5 choice, keeps it on failure and saves only on explicit send',async()=>{
 const world=initial();let fail=true;
 const ui=setup(world,async()=>{if(fail)throw Error('Resposta perdida');world.difficultySurveys=[];return{saved:true};});await flush();
 assert(ui.dialog.open);assert(ui.dialog.innerHTML.includes('Guarnição da CPU'));assert(ui.dialog.innerHTML.includes('Você não conquistou'));assert(ui.dialog.innerHTML.includes('difficulty-save" disabled'));
 for(const label of ['Muito fácil','Fácil','Normal','Difícil','Muito difícil'])assert(ui.dialog.innerHTML.includes(label));
 await ui.click({difficultyRating:'4'});assert.equal(ui.calls.length,0);assert(ui.dialog.innerHTML.includes('aria-pressed="true"'));assert(ui.dialog.innerHTML.includes('Difícil'));
 await ui.click({dialog:'difficulty-save'});assert(ui.dialog.innerHTML.includes('Resposta perdida'));assert(ui.dialog.innerHTML.includes('data-difficulty-rating="4" aria-label="4 estrelas — Difícil" aria-pressed="true"'));
 fail=false;await ui.click({dialog:'difficulty-save'});assert.equal(ui.calls.length,2);assert.deepEqual(ui.calls[0].body,{rating:4});assert.equal(ui.calls[0].path,'/api/world/difficulty-surveys/survey1');assert(ui.dialog.innerHTML.includes('Obrigado pela avaliação'));
 await ui.click({dialog:'difficulty-next'});assert(!ui.dialog.open);ui.listeners.visibilitychange();await flush();assert(!ui.dialog.open);
});
test('deferred responses remain on server, reopen next session and do not cross accounts',async()=>{
 const world=initial(),ui=setup(world);await flush();await ui.click({dialog:'difficulty-later'});assert(!ui.dialog.open);assert.equal(ui.calls.length,0);assert.equal(world.difficultySurveys.length,1);
 ui.listeners.visibilitychange();await flush();assert(!ui.dialog.open,'not repeated on every poll');
 const returned=setup(world);await flush();assert(returned.dialog.open,'pending after a new login/session');
 world.player={id:'other',name:'Outro'};world.difficultySurveys=[];returned.listeners.visibilitychange();await flush();assert(!returned.dialog.open);await returned.click({dialog:'difficulty-save'});assert.equal(returned.calls.length,0);
});
test('battle result precedes the survey and active battles suppress pending prompts',async()=>{
 const world=initial();world.activeBattle='active1';const ui=setup(world);await flush();assert(!ui.dialog.open);
 world.activeBattle=null;world.difficultySurveys=[];
 await ui.root.listeners.click({target:{closest:()=>({dataset:{action:'resume',battle:'battle1'}})}});await flush();assert(ui.dialog.innerHTML.includes('Território conquistado'));assert(!ui.dialog.innerHTML.includes('Como foi o desafio'));
 world.difficultySurveys=[{id:'occupied1',battleId:'battle1',areaName:'Agreste',context:'occupied',outcome:'won'}];await ui.click({dialog:'difficulty-next'});
 assert(ui.dialog.innerHTML.includes('Como foi o desafio'));assert(ui.dialog.innerHTML.includes('Área já dominada'));assert(ui.dialog.innerHTML.includes('Você conquistou'));
});

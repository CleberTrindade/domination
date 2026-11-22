'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createTraining}=require('../shared/training-battle'),engine=require('../server/battle-engine');
const flush=()=>new Promise(r=>setImmediate(r));
function element(){return {innerHTML:'',dataset:{},hidden:false,open:false,listeners:{},classList:{add(){},remove(){},toggle(){}},append(){},setAttribute(){},addEventListener(t,fn){this.listeners[t]=fn;},querySelector(){return {disabled:false,focus(){}};},close(){this.open=false;},scrollIntoView(){}};}
test('onboarding drives real practice actions, saves tour progress, resumes and can replay without gameplay mutations',async()=>{
 const body=element(),dialog=element(),nodes=[],requests=[],visits=[],starts=[],workers=[];let world={player:{id:'one'},tutorial:{phase:'training',step:0}},practice;
 const document={body,createElement(){const e=element();nodes.push(e);return e;},querySelector(){return element();}};
 class Worker{constructor(){workers.push(this);practice=createTraining(engine);}postMessage(m){if(m.type==='next')practice.next();if(m.type==='command')practice.command(m.command);for(let i=0;i<1500&&!practice.state().ready;i++)practice.step(.1);queueMicrotask(()=>this.onmessage?.({data:{type:'training-state',...practice.state()}}));}terminate(){this.terminated=true;}}
 const bridge={start(r,fn){starts.push({r,fn});},apply(){},guide(){},stop(){},show(){},commandStatus(){}};
 const context={window:{},document,Worker};vm.runInNewContext(fs.readFileSync(require.resolve('../public/world-tutorial.js'),'utf8'),context);
 const tutorial=context.window.createWorldTutorial({bridge,getData:()=>world,dialog,post:async(path,input)=>{requests.push({path,...input});return {tutorial:{...input}};},navigate:(page,army)=>visits.push({page,army}),modal:html=>{dialog.innerHTML=html;dialog.open=true;},render(){}}),coach=nodes[0];
 async function click(action){coach.listeners.click({target:{closest:()=>({dataset:{guide:action}})}});await flush();}
 tutorial.sync();await flush();assert(tutorial.active());assert(starts[0].r.training);assert(coach.innerHTML.includes('Bem-vindo'));
 for(let i=1;i<=7;i++){await click('next');const l=practice.state().lesson;starts[0].fn(l.drop?{type:'drop',site:l.source}:{type:'send',sources:[l.source],target:l.target});await flush();assert(practice.state().ready);}
 assert(coach.innerHTML.includes('Treinamento concluído'));assert.equal(requests.length,0,'practice actions never call battle or economy endpoints');
 await click('next');assert.equal(requests[0].path,'/api/world/tutorial');assert.equal(requests[0].phase,'tour');assert.equal(visits.at(-1).page,'territories');
 await click('tour-next');assert.equal(world.tutorial.step,1);
 await click('pause');assert(!tutorial.active());dialog.close();tutorial.sync();assert(!tutorial.active(),'pause suppresses periodic auto-open');
 // A fresh page restores the persisted account checkpoint.
 const restored=context.window.createWorldTutorial({bridge,getData:()=>world,dialog,post:async(path,input)=>{requests.push({path,...input});return {tutorial:{...input}};},navigate:(page,army)=>visits.push({page,army}),modal(){},render(){}});restored.sync();const nextCoach=nodes[1];
 assert(nextCoach.innerHTML.includes('Conheça o desafio'));for(let i=1;i<14;i++){nextCoach.listeners.click({target:{closest:()=>({dataset:{guide:'tour-next'}})}});await flush();}
 assert.equal(world.tutorial.phase,'done');assert(!restored.active());assert(visits.some(v=>v.page==='troops'&&v.army==='formations'));assert(visits.some(v=>v.page==='troops'&&v.army==='collection'));for(const page of ['friends','history','received','ranking','rewards','profile'])assert(visits.some(v=>v.page===page));
 assert(requests.every(r=>r.path==='/api/world/tutorial'));
 const count=requests.length;restored.menu();dialog.listeners.click({target:{closest:()=>({dataset:{guideStart:'training'}})}});await flush();assert(restored.active());assert.equal(practice.state().index,0);restored.stop();assert(workers.at(-1).terminated);assert.equal(requests.length,count);
});

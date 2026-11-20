'use strict';
importScripts('/battle-engine.js','/browser-battle.js');
let battle=null,last=performance.now(),relayAt=0,saveAt=0,receipts=[];
function emit(){if(!battle)return;postMessage({type:'state',snapshot:battle.snapshot()});}
function completion(){if(battle?.over)postMessage({type:'complete',completion:battle.completion()});}
self.onmessage=event=>{
  const message=event.data;
  if(message.type==='start'){
    battle=DOMINATION_BROWSER_BATTLE.createBrowserBattle(DOMINATION_ENGINE,message.record);
    last=performance.now();relayAt=0;saveAt=0;receipts=[];emit();completion();
  }
  if(message.type==='input'&&battle){
    const accepted=battle.input(message.input);
    if(message.input.kind==='join'||message.input.kind==='leave')receipts.push({nonce:message.input.nonce,accepted:accepted===null?battle.outcome(message.input.nonce):accepted});
    if(accepted!==null){postMessage({type:'command',nonce:message.input.nonce,accepted,owner:message.input.owner});emit();completion();}
  }
  if(message.type==='reject'&&battle){battle.reject(message.nonce);emit();completion();}
};
setInterval(()=>{
  if(!battle)return;
  const at=performance.now(),dt=(at-last)/1000;last=at;battle.advance(dt);emit();
  if(at-relayAt>=100){relayAt=at;postMessage({type:'relay',snapshot:battle.snapshot(),receipts:receipts.splice(0),resume:at-saveAt>=500?battle.checkpoint():null});if(at-saveAt>=500)saveAt=at;}
  completion();
},1000/30);

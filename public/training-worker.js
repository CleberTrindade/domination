'use strict';
importScripts('/battle-engine.js','/training-battle.js');
let training=null,last=performance.now();
const emit=()=>postMessage({type:'training-state',...training.state()});
self.onmessage=event=>{
 const m=event.data;
 if(m.type==='start'){training=DOMINATION_TRAINING.createTraining(DOMINATION_ENGINE);last=performance.now();emit();}
 if(!training)return;
 if(m.type==='next'){training.next();emit();}
 if(m.type==='command'){postMessage({type:'training-command',accepted:training.command(m.command)});emit();}
};
setInterval(()=>{if(!training)return;const now=performance.now();training.step((now-last)/1000*3);last=now;emit();},1000/30);

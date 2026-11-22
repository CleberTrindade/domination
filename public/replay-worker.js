'use strict';
importScripts('/battle-engine.js','/battle-replay.js');
let replay=null,paused=false,speed=1,last=performance.now(),accumulator=0;
function emit(){postMessage({type:'replay-state',snapshot:replay.snapshot(),over:replay.over});}
self.onmessage=event=>{try{const m=event.data;if(m.type==='start'){replay=DOMINATION_REPLAY.createReplay(DOMINATION_ENGINE,m.record);paused=false;speed=1;accumulator=0;last=performance.now();emit();}if(m.type==='pause')paused=!!m.paused;if(m.type==='speed'&&[1,2,4].includes(m.speed))speed=m.speed;}catch{postMessage({type:'replay-error'});replay=null;}};
setInterval(()=>{const now=performance.now(),dt=Math.min(.5,(now-last)/1000);last=now;if(!replay||paused||replay.over)return;try{accumulator+=dt*30*speed;const frames=Math.floor(accumulator);accumulator-=frames;replay.advance(frames);emit();}catch{postMessage({type:'replay-error'});replay=null;}},1000/30);

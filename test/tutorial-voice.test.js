'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),createVoice=require('../public/tutorial-voice');
const clips=[{text:'Conquiste sua base.',file:'base.mp3'},{text:'Use o heliporto.',file:'heli.mp3'}];
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('fixed male recordings are opt-in, switch steps, reuse the unlocked audio element and cancel stale events',()=>{
 const players=[],played=[],states=[];
 class Audio{constructor(){players.push(this);this.pauses=0;}pause(){this.pauses++;}play(){played.push(this.src);this.onplaying();return Promise.resolve();}}
 const voice=createVoice({AudioClass:Audio,clips,onChange:s=>states.push(s)});
 voice.setText(clips[0].text);assert.equal(played.length,0);
 voice.toggle();assert.equal(played[0],'/audio/tutorial/base.mp3');assert(voice.state().speaking);const oldEnded=players[0].onended;
 voice.setText(clips[1].text);assert.equal(played[1],'/audio/tutorial/heli.mp3');assert.equal(players.length,1,'mobile playback keeps the user-unlocked audio element');assert(players[0].pauses>0);
 oldEnded();assert(voice.state().speaking,'late events cannot stop the next instruction');
 players[0].onended();assert.equal(voice.state().speaking,false);assert(voice.state().enabled,'next instruction remains narrated');
 voice.repeat();assert.equal(played.length,3);assert(voice.state().speaking);
 voice.toggle();assert.equal(voice.state().enabled,false);assert.equal(voice.state().speaking,false);
 voice.setText(clips[0].text);assert.equal(played.length,3);
 voice.repeat();assert.equal(played.length,4);voice.clear();assert.equal(voice.state().speaking,false);assert(states.length);
});
test('unsupported browsers, missing clips and rejected playback preserve text and never choose a browser voice',async()=>{
 const unsupported=createVoice();unsupported.setText('Texto.');unsupported.toggle();assert.equal(unsupported.state().supported,false);
 class BrokenAudio{pause(){}play(){return Promise.reject(Error('network or autoplay'));}}
 const failing=createVoice({AudioClass:BrokenAudio,clips});failing.setText(clips[0].text);failing.toggle();await flush();assert.equal(failing.state().enabled,false);assert.match(failing.state().error,/Ouvir/);
 failing.setText('Unrecorded instruction');failing.toggle();assert.match(failing.state().error,/indisponível/);assert.equal(failing.state().speaking,false);
});

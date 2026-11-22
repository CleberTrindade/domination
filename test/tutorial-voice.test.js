'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),createVoice=require('../public/tutorial-voice');
const Utterance=class{constructor(text){this.text=text;}};
test('Portuguese narration is opt-in, advances automatically, and cancels stale speech on change or exit',()=>{
 const spoken=[],states=[];let cancelled=0;
 const voice=createVoice({Utterance,synthesis:{getVoices:()=>[{lang:'en-US'},{lang:'pt-PT'},{lang:'pt-BR'}],cancel(){cancelled++;},speak(u){spoken.push(u);}},onChange:s=>states.push(s)});
 voice.setText('Conquiste sua base. Toque no alvo.');assert.equal(spoken.length,0,'no autoplay before choosing audio');
 voice.toggle();assert.equal(spoken.length,1);assert.equal(spoken[0].lang,'pt-BR');assert.equal(spoken[0].voice.lang,'pt-BR');assert(voice.state().speaking);
 spoken[0].onend();assert.equal(spoken.length,2);const stale=spoken[1];
 voice.setText('Use o heliporto.');assert.equal(spoken.length,3);assert(cancelled>0);stale.onend();assert.equal(spoken.length,3,'cancelled paragraph cannot continue over the next step');
 voice.repeat();assert.equal(spoken.length,4);assert.equal(spoken.at(-1).text,'Use o heliporto.');
 voice.toggle();assert.equal(voice.state().enabled,false);assert.equal(voice.state().speaking,false);
 voice.setText('Outro recurso.');assert.equal(spoken.length,4,'disabled narration stays disabled');
 voice.repeat();assert.equal(spoken.length,5);const pending=spoken.at(-1);voice.clear();pending.onend();assert.equal(spoken.length,5);assert.equal(voice.state().speaking,false);assert(states.length);
});
test('missing support, Portuguese voices and synthesis errors preserve the text path without throwing',()=>{
 const unsupported=createVoice();unsupported.setText('Leia o texto.');unsupported.toggle();assert.equal(unsupported.state().supported,false);
 const noPortuguese=createVoice({Utterance,synthesis:{getVoices:()=>[{lang:'en-US'}],cancel(){},speak(){throw Error('must not speak English');}}});noPortuguese.setText('Texto.');noPortuguese.toggle();assert.match(noPortuguese.state().error,/português/);assert.equal(noPortuguese.state().enabled,false);
 const failing=createVoice({Utterance,synthesis:{getVoices:()=>[],cancel(){},speak(){throw Error('audio blocked');}}});failing.setText('Texto.');failing.toggle();assert.match(failing.state().error,/Ouvir/);assert.equal(failing.state().speaking,false);
});

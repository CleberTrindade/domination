'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),action=require('../public/world-area-action');
test('selected CPU and rival areas can be attacked directly, including before sign-in',()=>{
 for(const owner_id of [null,'rival'])for(const player of [null,{id:'me'}]){const state=action({owner_id},player);assert.equal(state.action,'ATACAR');assert.equal(state.disabled,false);}
});
test('owned areas prevent self-attacks but expose defense when under attack',()=>{
 assert.equal(action({owner_id:'me'},{id:'me'}).disabled,true);
 const state=action({owner_id:'me',battle_id:'battle'},{id:'me'});assert.equal(state.action,'ASSUMIR DEFESA');assert.equal(state.canDefend,true);assert.equal(state.disabled,false);
});
test('active battles resume for participants and are watchable by other players',()=>{
 const area={owner_id:'rival',battle_id:'battle',attacker_id:'attacker',participant_ids:['invader']};
 for(const id of ['attacker','invader'])assert.equal(action(area,{id}).action,'RETOMAR BATALHA');
 for(const player of [null,{id:'viewer'}])assert.equal(action(area,player).action,'ASSISTIR BATALHA');
 assert.equal(action({battle_id:'battle'},null).ownBattle,false);
});
test('pending action blocks duplicate requests for all territory states',()=>{
 for(const area of [{},{owner_id:'me'},{battle_id:'battle'},{owner_id:'me',battle_id:'battle'}]){const state=action(area,{id:'me'},true);assert.equal(state.disabled,true);assert.equal(state.action,'PREPARANDO…');}
});
test('production server delivers the action policy before the world client needs it',async()=>{
 const {createApplication}=require('../server'),vm=require('node:vm'),app=await createApplication({worldOptions:{startClock:false}});
 try{
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port;
  const html=await (await fetch(base+'/')).text();assert(html.indexOf('src="/world-area-action.js"')<html.indexOf('src="/world.js"'));
  const response=await fetch(base+'/world-area-action.js');assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/application\/javascript/);
  const window={};vm.runInNewContext(await response.text(),{window});assert.equal(window.DOMINATION_AREA_ACTION({},null).action,'ATACAR');
 }finally{await app.close();}
});

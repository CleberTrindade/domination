'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const factory=require('../server/battle-engine'),prototype=require('../experiments/troop-progression/simulate').factory;
const {createBrowserBattle,verifyBrowserBattle}=require('../shared/browser-battle');
const {ARMY_RULES,powerFor}=require('../server/progression');
const core=snapshot=>{const {armies,...rest}=snapshot;return rest;};
test('live engine matches the studied four-position combat at every tested army strength',()=>{
  for(const level of [1,5,10])for(const ratio of [.8,1])for(const difficulty of [1,3,5]){
    const power=powerFor(level),config={share:.5,difficulty,seed:3077,centralOwner:2,defenderBaseCount:3,attackerLevel:level,defenderLevel:ratio===1?level:null,attackerPower:power,defenderPower:power*ratio,neutralPower:power};
    const battle=factory.createBattle(config),reference=prototype.createBattle({...config,neutralScaling:'attacker'});
    assert.equal(battle.snapshot().sites.filter(s=>s.owner===2).length,4);
    for(let frame=0;frame<3000;frame++){
      if(frame%90===0){const state=battle.snapshot(),target=[14,12,0,11,1][Math.floor(frame/90)%5],command={type:'send',sources:state.sites.filter(s=>s.owner===1&&s.troops>=20).map(s=>s.id),target};assert.equal(battle.command(command),reference.command(command));}
      battle.step(1/30);reference.step(1/30);
      if(frame%90===0)assert.equal(JSON.stringify(core(battle.snapshot())),JSON.stringify(reference.snapshot()),JSON.stringify({level,ratio,difficulty,frame}));
    }
  }
});
test('late entrants use personal power and host restoration preserves every army profile',()=>{
  const config={share:.5,centralOwner:2,defenderBaseCount:3,attackerLevel:2,attackerPower:1.1,defenderLevel:5,defenderPower:1.4,neutralPower:1.1,balanceVersion:ARMY_RULES.balanceVersion};
  const battle=factory.createBattle(config);assert(battle.join(3,12,{level:10,power:1.9}));assert(battle.join(4,3,{level:3,power:1.2}));
  assert.equal(battle.join(5,13,{level:99,power:999}),false);
  assert.deepEqual(battle.snapshot().armies,{1:{level:2,power:1.1},2:{level:5,power:1.4},3:{level:10,power:1.9},4:{level:3,power:1.2}});
  for(let i=0;i<100;i++)battle.step(1/30);
  const saved=battle.checkpoint(),restored=factory.restoreBattle(saved);assert.deepEqual(restored.snapshot(),battle.snapshot());assert.deepEqual(saved.config,configWithDefaults(config));
  for(let i=0;i<200;i++){battle.step(1/30);restored.step(1/30);}assert.deepEqual(restored.snapshot(),battle.snapshot());
  function configWithDefaults(c){return {share:.5,difficulty:1,seed:1,maxSeconds:360,centralOwner:2,defenderBaseCount:3,attackerPower:1.1,defenderPower:1.4,neutralPower:1.1,attackerLevel:2,defenderLevel:5,balanceVersion:c.balanceVersion};}
});
test('replay binds the entrant army to the server ticket and keeps strength after reconnection',()=>{
  const config={share:.5,centralOwner:2,defenderBaseCount:3,attackerPower:1,defenderPower:.8,neutralPower:1,maxSeconds:1},input={nonce:'join-army',kind:'join',owner:3,site:12,armyLevel:10,armyPower:1.9,playerId:'third',playerName:'Third',joinedAt:new Date().toISOString()};
  const browser=createBrowserBattle(factory,{config});assert(browser.input(input));
  const restored=createBrowserBattle(factory,{config,resume:browser.checkpoint(),authorizedInputs:[input]});assert.equal(restored.snapshot().armies[3].power,1.9);
  for(let i=0;i<160;i++)restored.advance(1/30);
  const verified=verifyBrowserBattle(factory,config,new Map([[input.nonce,input]]),restored.completion());assert.equal(verified.validatedParticipants[0].level,10);assert.equal(verified.validatedParticipants[0].power,1.9);
});

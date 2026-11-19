'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBattle, restoreBattle, initialSites, MAPDATA } = require('../server/battle-engine');
test('initial occupation is measured by hexes; bombarder stays neutral', () => {
  for (const share of [.32,.34,.35,.37,.39]) {
    const setup = initialSites(share, 1);
    assert(setup.defenderShare >= .30 && setup.defenderShare <= .40);
    assert.equal(setup.sites[0].owner, 0);
    assert.equal(setup.sites.filter(s => s.owner === 1).length, 1);
    assert(setup.sites.filter(s => s.owner === 2).length > 1);
  }
  const held = initialSites(.5, 5);
  assert(Math.abs(held.defenderShare - .5) <= 1 / MAPDATA.cells.length);
  assert.equal(held.sites[0].owner, 0);
});
test('commands cannot invent troops, use defender bases, or bypass drop cooldown', () => {
  const battle = createBattle();
  assert.equal(battle.command({ type: 'send', sources: [4], target: 0 }), false, 'countdown blocks input');
  for (let i=0;i<61;i++) battle.step(.05);
  assert.equal(battle.command({ type: 'send', sources: [1], target: 4, owner: 2, troops: 99999 }), false);
  assert.equal(battle.command({ type: 'drop', site: 4 }), false);
  assert.equal(battle.command({ type: 'send', sources: [4], target: 99 }), false);
  assert.equal(battle.command({ type: 'win', result: 'won' }), false);
  const troops = Math.floor(battle.snapshot().sites[4].troops);
  assert.equal(battle.command({ type: 'send', sources: [4,4], target: 0, troops: 99999 }), true);
  assert.equal(battle.snapshot().units.length, 1);
  assert.equal(battle.snapshot().units[0].n, troops);
});
test('capturing the bombarder does not end the battle', () => {
  const battle = createBattle({ seed: 33 });
  for(let i=0;i<61;i++)battle.step(.05);
  battle.command({ type: 'send', sources: [4], target: 0 });
  let captured = false;
  for(let i=0;i<300;i++){
    battle.step(.05);
    if(battle.snapshot().sites[0].owner===1){captured=true;break;}
  }
  assert(captured, 'the original troop movement must reach and capture the center');
  assert.equal(battle.result, null);
});
test('fixed seed and commands yield reproducible server simulations', () => {
  const a=createBattle({seed:17}),b=createBattle({seed:17});
  for(let i=0;i<1800;i++){
    if(i===100)for(const battle of [a,b])battle.command({type:'send',sources:[4],target:10});
    a.step(1/30);b.step(1/30);
  }
  assert.deepEqual(a.snapshot(),b.snapshot());
});
test('a persisted checkpoint resumes troops, combat, production, cooldowns and CPU randomness', () => {
  const original=createBattle({seed:59,share:.39,difficulty:5});
  for(let i=0;i<61;i++)original.step(.05);
  original.command({type:'send',sources:[4],target:0});
  for(let i=0;i<120;i++)original.step(.05);
  const checkpoint=JSON.parse(JSON.stringify(original.checkpoint()));
  assert(checkpoint.units.length>0, 'the checkpoint must include moving troops');
  const resumed=restoreBattle(checkpoint);
  const logical=snapshot=>{const {fx,...state}=snapshot;return state;};
  assert.deepEqual(logical(resumed.snapshot()),logical(original.snapshot()));
  for(let i=0;i<300;i++){original.step(.05);resumed.step(.05);}
  assert.deepEqual(resumed.snapshot(),original.snapshot());
});

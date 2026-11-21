'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const rules=require('../shared/troop-rules'),factory=require('../server/battle-engine');
const {levelsFor,armyView,combatProfile}=require('../server/progression');
const {createBrowserBattle,verifyBrowserBattle}=require('../shared/browser-battle');
const levels=Object.fromEntries(rules.KINDS.map(k=>[k,7]));
const config={balanceVersion:'troops-v3',mapId:'crossroads-v1',centralOwner:2,defenderBaseCount:3,seed:19,attackerTroops:combatProfile(levels),defenderTroops:combatProfile(levels,.8,true)};
function fixture(extra={}){const b=factory.createBattle({...config,...extra}),s=b.checkpoint();s.cd=0;s.time=10;for(const site of s.sites)site.cd=1000;for(const ai of s.ais)ai.timer=1000;for(const p of Object.values(s.par))p.prod=0;return s;}
function group(id,k,owner,n,x,y,toId,tx=x+100,ty=y){return{id,k,owner,n,P:[[x,y],[tx,ty]],cum:[0,Math.hypot(tx-x,ty-y)],L:Math.hypot(tx-x,ty-y),d:0,si:0,toId,x,y,alive:true};}
test('commander unlocks require both varied training and completed combat; new types never inherit old paid levels',()=>{
 const inherited=levelsFor({army_level:5});for(const k of rules.KINDS)assert.equal(inherited[k],rules.CORE.includes(k)?5:1);
 for(const unlock of rules.UNLOCKS){assert.equal(rules.commander(levels,unlock.battles).level,unlock.level);assert(rules.commander(levels,unlock.battles-1).level<unlock.level);}
 assert.equal(rules.commander({tanque:10},9999).level,1);
 const wallet={level:7,levels,battles:0,owned:0};assert(armyView(wallet,99999999n,0).troops.batedor.locked);
 wallet.battles=10;assert(!armyView(wallet,99999999n,0).troops.batedor.locked);assert(armyView(wallet,99999999n,0).troops.foguetes.locked);
});
test('each ground formation produces its own troop, remains on land and preserves normal naval and air bases',()=>{
 for(const kind of rules.GROUND){
  const b=factory.createBattle({...config,attackerLoadout:[kind]}),s=b.checkpoint(),source=s.sites.find(x=>x.owner===1);
  assert.equal(source.kind,kind==='tanque'?'garagem':kind);s.cd=0;const target=s.sites.find(x=>x.owner===0&&x.n==='G');
  const restored=factory.restoreBattle(s);assert(restored.command({type:'send',sources:[source.id],target:target.id}));assert.equal(restored.snapshot().units[0].k,kind);
  const coast=factory.createBattle({...config,mapId:'coast-v1',attackerLoadout:[kind]}),cs=coast.checkpoint();cs.cd=0;
  assert.equal(factory.restoreBattle(cs).command({type:'send',sources:[4],target:0}),false,'all ground classes must obey disconnected terrain');
  assert(cs.sites.some(x=>x.kind==='botes'));assert(cs.sites.some(x=>x.kind==='heli'));
 }
 assert.throws(()=>factory.createBattle({...config,attackerLoadout:['heli']}),/loadout/);
 assert.throws(()=>factory.createBattle({...config,attackerLoadout:['tanque','tanque']}),/loadout/);
 const saved=fixture({attackerLoadout:['batedor','foguetes','blindado']}),target=saved.sites.find(x=>x.n==='G'&&x.owner===0);target.troops=1;
 saved.units=[group(1,'tanque',1,30,target.x-1,target.y,target.id,target.x,target.y)];saved.uid=1;
 const capture=factory.restoreBattle(saved);capture.step(.1);const taken=capture.snapshot().sites[target.id];assert.equal(taken.owner,1);assert.equal(taken.kind,['batedor','foguetes','blindado'][target.id%3]);
});
test('anti-air and anti-armor damage have real counters; heavy armor resists incoming shots',()=>{
 function loss(a,b){const saved=fixture();saved.units=[group(1,a,1,30,190,250,0),group(2,b,2,30,210,250,0)];saved.uid=2;const battle=factory.restoreBattle(saved);battle.step(.26);return 30-battle.snapshot().units.find(x=>x.id===2).n;}
 assert(loss('antiaereo','heli')>loss('tanque','heli')*2);
 assert(loss('antiaereo','tanque')<loss('tanque','tanque'));
 assert(loss('foguetes','tanque')>loss('tanque','tanque'));
 assert(loss('foguetes','blindado')>loss('tanque','blindado'));
 assert(loss('tanque','blindado')<loss('tanque','tanque'));
 assert(loss('foguetes','heli')<loss('tanque','heli'));
});
test('engineers reinforce allied positions with a capped decaying shield; artillery sieges before moving in to capture',()=>{
 const saved=fixture(),target=saved.sites.find(x=>x.owner===1);target.troops=20;
 saved.units=[group(1,'engenheiro',1,100,target.x-1,target.y,target.id,target.x,target.y)];saved.uid=1;
 const support=factory.restoreBattle(saved);support.step(.1);let base=support.snapshot().sites[target.id];assert.equal(base.fortification,20);assert(base.troops>20);support.step(1);assert(support.snapshot().sites[target.id].fortification<20);
 const siege=fixture({attackerLoadout:['artilharia']}),enemy=siege.sites.find(x=>x.owner===2&&x.kind==='garagem');enemy.troops=20;
 siege.units=[group(1,'artilharia',1,25,enemy.x-70,enemy.y,enemy.id,enemy.x,enemy.y)];siege.uid=1;
 const artillery=factory.restoreBattle(siege);artillery.step(.1);const first=artillery.snapshot();assert.equal(first.units[0].d,0);assert(first.sites[enemy.id].troops<20);assert.equal(first.sites[enemy.id].owner,2);assert(first.fx.some(x=>x.type==='siege'));
 for(let i=0;i<900;i++)artillery.step(1/30);assert.equal(artillery.snapshot().sites[enemy.id].owner,1,'ranged fire must be followed by an actual arrival to capture');
});
test('new formations, weapons and active participation survive checkpoints and authoritative replay for late entrants',()=>{
 const c={...config,maxSeconds:32,attackerLoadout:['batedor','foguetes','artilharia'],defenderLoadout:['blindado','antiaereo','engenheiro']};
 const ticket={nonce:'new-entrant',kind:'join',owner:3,site:12,armyLevel:7,armyPower:1.6,armyTroops:combatProfile(levels),armyLoadout:['engenheiro','artilharia'],playerId:'third',playerName:'Third',joinedAt:new Date().toISOString()};
 const runner=createBrowserBattle(factory,{config:c});assert(runner.input(ticket));for(let i=0;i<140;i++)runner.advance(1/30);
 const resumed=createBrowserBattle(factory,{config:c,resume:runner.checkpoint(),authorizedInputs:[ticket]});assert.deepEqual(resumed.snapshot(),runner.snapshot());
 for(let i=0;i<1050;i++)resumed.advance(1/30);
 const result=verifyBrowserBattle(factory,c,new Map([[ticket.nonce,ticket]]),resumed.completion());assert.deepEqual(result.armies[3].loadout,ticket.armyLoadout);assert(result.participation[1]>=30);assert.equal(result.participation[2],0);assert(result.participation[3]>=30);assert.equal(result.sites.length,17);
 const legacy=factory.createBattle({...c,balanceVersion:'troops-v2'});assert(!legacy.snapshot().armies[1].loadout);assert(legacy.checkpoint().sites.every(s=>!rules.UNLOCKS.some(u=>u.kind===s.kind)));
});
test('the shipped browser engine executes expanded formations identically to the server replay',()=>{
 const vm=require('node:vm'),{browserEngine}=require('../server/browser-assets'),context={};context.self=context;vm.createContext(context);vm.runInContext(browserEngine(),context);
 const c={...config,attackerLoadout:['artilharia','foguetes','engenheiro'],defenderLoadout:['blindado','antiaereo','batedor']},node=factory.createBattle(c),browser=context.DOMINATION_ENGINE.createBattle(c);
 for(let frame=0;frame<2400;frame++){
   if(frame%150===0){const command={type:'send',sources:node.snapshot().sites.filter(s=>s.owner===1&&s.troops>=8).map(s=>s.id),target:[14,12,0,11,1][Math.floor(frame/150)%5]};assert.equal(node.command(command),browser.command(command));}
   node.step(1/30);browser.step(1/30);
   if(frame%60===0)assert.equal(JSON.stringify(node.snapshot()),JSON.stringify(browser.snapshot()));
 }
});
test('eliminated armies do not accumulate active time while surviving players finish the battle',()=>{
 const saved=fixture();for(const s of saved.sites)if(s.owner===1)s.owner=0;saved.participation[1]=2;
 const battle=factory.restoreBattle(saved);assert(battle.join(3,12,{level:7,power:1.6,loadout:['engenheiro']}));for(let i=0;i<60;i++)battle.step(1/30);
 assert.equal(battle.snapshot().participation[1],2);assert(battle.snapshot().participation[3]>1.9);
});

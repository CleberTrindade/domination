'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const factory=require('../server/battle-engine'),{browserEngine}=require('../server/browser-assets');
const {createBrowserBattle,verifyBrowserBattle}=require('../shared/browser-battle');
test('final verification rejects a false join receipt rather than assigning an army to the wrong account',()=>{
  const input={nonce:'join',kind:'join',owner:3,site:12,playerId:'third',playerName:'Third',joinedAt:new Date().toISOString()};
  assert.throws(()=>verifyBrowserBattle(factory,{share:.5,centralOwner:2},new Map([[input.nonce,input]]),{frames:0,inputs:[{nonce:'join',frame:0,accepted:false}]}),/Entrada de participante inválida/);
  input.confirmedAccepted=false;
  assert.throws(()=>verifyBrowserBattle(factory,{share:.5,centralOwner:2},new Map([[input.nonce,input]]),{frames:0,inputs:[{nonce:'join',frame:0,accepted:true}]}),/confirmação de entrada diverge/,'a released coin reservation cannot be reused by changing the final receipt');
});
test('the actual browser worker executes orders immediately and simulates without any network or database',()=>{
  let time=0,timer;const messages=[];
  const context={performance:{now:()=>time},postMessage:message=>messages.push(structuredClone(message)),setInterval:fn=>{timer=fn;}};context.self=context;
  vm.createContext(context);context.importScripts=(...paths)=>{for(const path of paths)vm.runInContext(path==='/battle-engine.js'?browserEngine():fs.readFileSync(require.resolve('../shared/browser-battle'),'utf8'),context);};
  vm.runInContext(fs.readFileSync(require.resolve('../public/battle-worker'),'utf8'),context);
  context.onmessage({data:{type:'start',record:{config:{seed:9}}}});
  for(let i=0;i<110;i++){time+=1000/30;timer();}
  context.onmessage({data:{type:'input',input:{nonce:'first-order',kind:'command',owner:1,command:{type:'send',sources:[4],target:0}}}});
  const command=messages.find(m=>m.type==='command');assert.equal(command.accepted,true);
  assert(messages.at(-1).snapshot.units.some(u=>u.owner===1));
  const initial=messages.at(-1).snapshot.units[0].d;
  for(let i=0;i<3;i++){time+=1000/30;timer();}
  assert(messages.filter(m=>m.type==='state').at(-1).snapshot.units[0].d>initial);
  assert(messages.some(m=>m.type==='relay'&&m.resume));
});
test('in-memory resume preserves browser CPU state and duplicate network echoes do not repeat orders',()=>{
  const input={nonce:'move',kind:'command',owner:1,command:{type:'send',sources:[4],target:0}},record={config:{seed:17}};
  const browser=createBrowserBattle(factory,record);browser.advance(1);browser.advance(1);browser.advance(1);browser.advance(1);
  assert(browser.input(input));assert.equal(browser.input(input),null);
  const restored=createBrowserBattle(factory,{...record,resume:browser.checkpoint(),authorizedInputs:[input]});
  assert.deepEqual(restored.snapshot(),browser.snapshot());browser.advance(.2);restored.advance(.2);
  assert.deepEqual(restored.snapshot(),browser.snapshot());
});
test('a rejected optimistic command is rolled back locally before result submission',()=>{
  const record={config:{seed:7}},browser=createBrowserBattle(factory,record),control=createBrowserBattle(factory,record);
  for(let i=0;i<120;i++){browser.advance(1/30);control.advance(1/30);}
  browser.input({nonce:'rejected',kind:'command',owner:1,command:{type:'send',sources:[4],target:0}});
  assert.equal(browser.snapshot().units.length,1);browser.reject('rejected');
  assert.deepEqual(browser.snapshot(),control.snapshot());assert.equal(browser.completion().inputs.length,0);
});

(function(root){
 'use strict';
 function createReplay(factory,record){
  const engine=factory.createBattle(record.config);engine.setDefenderControlled(false);
  let frame=0,index=0;const actions=record.inputs;
  function apply(){while(index<actions.length&&actions[index].frame===frame){const {input}=actions[index++];if(input.kind==='control')engine.setDefenderControlled(input.controlled);else if(input.kind==='join')engine.join(input.owner,input.site,{level:input.armyLevel,power:input.armyPower,troops:input.armyTroops,loadout:input.armyLoadout});else if(input.kind==='leave')engine.leave(input.owner);else engine.command(input.command,input.owner);}}
  apply();
  return {advance(count){const target=Math.min(record.frames,frame+Math.max(0,Math.floor(count)));while(frame<target){engine.step(1/30);frame++;apply();}return engine.snapshot();},snapshot:()=>engine.snapshot(),get frame(){return frame;},get over(){return frame>=record.frames;}};
 }
 const api={createReplay};if(typeof module==='object'&&module.exports)module.exports=api;else root.DOMINATION_REPLAY=api;
})(typeof self==='object'?self:globalThis);

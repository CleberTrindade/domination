/* Shared action policy for the geographic selector and the territory dialog. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DOMINATION_AREA_ACTION=api;})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 return function(area,player,busy=false){
  const mine=!!area.owner_id&&area.owner_id===player?.id;
  const ownBattle=!!area.battle_id&&!!player?.id&&(area.attacker_id===player.id||area.participant_ids?.includes(player.id));
  const canDefend=mine&&!!area.battle_id;
  return {mine,ownBattle,canDefend,disabled:busy||(mine&&!canDefend),action:busy?'PREPARANDO…':canDefend?'ASSUMIR DEFESA':ownBattle?'RETOMAR BATALHA':area.battle_id?'ASSISTIR BATALHA':mine?'SOB SEU COMANDO':'ATACAR'};
 };
});

'use strict';
const rules=require('../shared/troop-rules');
const {armyView}=require('./progression');
function troopCatalog(army){
 army=army||armyView({level:1,levels:{},owned:0},0n,0);
 return rules.KINDS.map(id=>{const t=rules.DEFINITIONS[id],view=army.troops[id],power=view?.power||1,next=view?.nextPower??null;
 return{id,...t,...view,level:view?.level||1,power,nextPower:next,damage:t.attack*power,nextDamage:next===null?null:t.attack*next,range:t.range,unlockLevel:rules.required(id),locked:army.commander.level<rules.required(id)};});
}
module.exports={troopCatalog};

'use strict';
const rules=require('../shared/troop-rules');
const MAX_FORMATIONS=10;
function formationView(wallet,commanderLevel){
 const fallback={id:'initial',name:'Formação 1',troops:rules.loadout(wallet.loadout,commanderLevel)};
 const formations=Array.isArray(wallet.formations)&&wallet.formations.length?wallet.formations.map(f=>({id:f.id,name:f.name,troops:rules.loadout(f.troops,commanderLevel)})):[fallback];
 const activeFormationId=formations.some(f=>f.id===wallet.activeFormationId)?wallet.activeFormationId:formations[0].id;
 return {formations,activeFormationId,formationRevision:wallet.formationRevision||0,maxFormations:MAX_FORMATIONS};
}
module.exports={formationView,MAX_FORMATIONS};

'use strict';
const troopRules=require('../shared/troop-rules');
const {formationView}=require('./formations');
const TROOP_KINDS=Object.freeze(troopRules.KINDS);
const ARMY_RULES=Object.freeze({maxLevel:10,powerStep:10,cpuPowerRatio:.8,defenderBaseCount:3,balanceVersion:'troops-v3',individual:true,
  upgradeCosts:Object.freeze([0,0,100,250,500,1000,2000,4000,7000,11000,18000]),
  upgradeCards:Object.freeze([0,0,10,20,40,80,140,220,340,500,750])});
const powerFor=level=>Math.round((1+(level-1)*ARMY_RULES.powerStep/100)*100)/100;
function areaProfile(ordinal){
  return ordinal<=2?{resistance:'Baixa',cpuReward:250}:ordinal===3?{resistance:'Média',cpuReward:450}:{resistance:'Alta',cpuReward:600};
}
function troopView(wallet,available,minEntry,kind){
  const level=wallet.levels?.[kind]??(troopRules.CORE.includes(kind)?wallet.level:1),maximum=level>=ARMY_RULES.maxLevel,nextLevel=maximum?null:level+1,nextCost=maximum?null:ARMY_RULES.upgradeCosts[nextLevel];
  const cost=BigInt((nextCost||0)*100),cards=Number(wallet.cards?.[kind]||0),nextCards=maximum?null:ARMY_RULES.upgradeCards[nextLevel];
  const commander=troopRules.commander(wallet.levels,wallet.battles||0),unlockLevel=troopRules.required(kind),locked=commander.level<unlockLevel;
  const reason=locked?'Requer comandante nível '+unlockLevel+'.':maximum?'Este tipo atingiu o nível máximo.':available<cost?'Moedas disponíveis insuficientes.':cards<nextCards?'Cartas desta tropa insuficientes.':null;
  return {kind,level,locked,unlockLevel,power:powerFor(level),maxLevel:ARMY_RULES.maxLevel,nextLevel,nextPower:nextLevel?powerFor(nextLevel):null,nextCost,cards,nextCards,cardsRemaining:cardsNeeded(level),canUpgrade:!reason,reason};
}
function cardsNeeded(level){return ARMY_RULES.upgradeCards.slice(Math.max(2,level+1)).reduce((a,b)=>a+b,0);}
function levelsFor(row){return Object.fromEntries(TROOP_KINDS.map(kind=>[kind,row.troop_levels?.[kind]??(troopRules.CORE.includes(kind)?Number(row.army_level||1):1)]));}
function combatProfile(levels,ratio=1,cpu=false){return Object.fromEntries(TROOP_KINDS.filter(kind=>levels[kind]!==undefined).map(kind=>[kind,{level:cpu?null:levels[kind],power:powerFor(levels[kind])*ratio}]));}
function armyView(wallet,available,minEntry){
  const troops=Object.fromEntries(TROOP_KINDS.map(kind=>[kind,troopView(wallet,available,minEntry,kind)]));
  const commander=troopRules.commander(wallet.levels,wallet.battles||0);
  return {commander,...formationView(wallet,commander.level),loadout:troopRules.loadout(wallet.loadout,commander.level),level:wallet.level,maxLevel:ARMY_RULES.maxLevel,individual:true,troops};
}
module.exports={ARMY_RULES,TROOP_KINDS,powerFor,areaProfile,armyView,troopView,levelsFor,combatProfile,cardsNeeded};

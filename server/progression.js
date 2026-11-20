'use strict';
const ARMY_RULES=Object.freeze({maxLevel:10,powerStep:10,cpuPowerRatio:.8,defenderBaseCount:3,balanceVersion:'army-v1',
  upgradeCosts:Object.freeze([0,0,300,500,800,1250,2000,3150,5050,8100,12900])});
const powerFor=level=>Math.round((1+(level-1)*ARMY_RULES.powerStep/100)*100)/100;
function areaProfile(ordinal){
  return ordinal<=2?{resistance:'Baixa',cpuReward:300}:ordinal===3?{resistance:'Média',cpuReward:450}:{resistance:'Alta',cpuReward:600};
}
function armyView(wallet,available,minEntry){
  const level=wallet.level,maximum=level>=ARMY_RULES.maxLevel,nextLevel=maximum?null:level+1,nextCost=maximum?null:ARMY_RULES.upgradeCosts[nextLevel];
  const requiredBuffer=wallet.owned===0?BigInt(minEntry*100):0n,cost=BigInt((nextCost||0)*100);
  const reason=maximum?'Seu exército está no nível máximo.':available<cost?'Moedas disponíveis insuficientes.':available-cost<requiredBuffer?'Mantenha '+minEntry+' moedas disponíveis para iniciar seu próximo ataque.':null;
  return {level,power:powerFor(level),maxLevel:ARMY_RULES.maxLevel,nextLevel,nextPower:nextLevel?powerFor(nextLevel):null,nextCost,canUpgrade:!reason,reason};
}
module.exports={ARMY_RULES,powerFor,areaProfile,armyView};

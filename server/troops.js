'use strict';
const {combatRules}=require('./battle-engine');
const {armyView}=require('./progression');
function troopCatalog(army){
  army=army||armyView({level:1,owned:0},0n,100);
  return [
    {id:'tanque',name:'Tanque',category:'Tropa terrestre',base:'Garagem / quartel',description:'Avança pelos caminhos de terra e captura posições. Precisa de uma ligação terrestre até o alvo.',tip:'Reúna reforços antes de atravessar posições defendidas.',speed:combatRules.speed.tanque,interval:.3},
    {id:'desliz',name:'Bote',category:'Tropa de travessia',base:'Base de botes',description:'Viaja diretamente ao alvo e alcança posições sem ligação terrestre, incluindo ilhas.',tip:'Use para abrir rotas alternativas e alcançar bases isoladas.',speed:combatRules.speed.desliz,interval:.3},
    {id:'heli',name:'Helicóptero',category:'Tropa aérea',base:'Heliporto',description:'É a tropa mais rápida. Voa diretamente ao alvo e captura posições sem depender dos caminhos de terra.',tip:'Ataque posições distantes ou envie reforços com rapidez.',speed:combatRules.speed.heli,interval:.3},
    {id:'canhao',name:'Canhão',category:'Defesa fixa',base:'Posição de canhão',description:'Dispara automaticamente contra a tropa inimiga mais próxima dentro do alcance. Ao enviar tropas desta posição, elas avançam como tanques.',tip:'Proteja as rotas próximas; o canhão permanece na posição.',range:combatRules.range.canhao/combatRules.hexRadius,interval:combatRules.fire.canhao},
    {id:'central',name:'Bombardeiro central',category:'Arma estratégica',base:'Central do mapa',description:'Dispara automaticamente contra tropas inimigas próximas. Começa com o defensor e pode ser capturado durante a batalha.',tip:'Sua captura traz vantagem estratégica. A vitória exige eliminar as bases e tropas inimigas.',range:combatRules.range.central/combatRules.hexRadius,interval:combatRules.fire.central}
  ].map(troop=>{const view=army?.troops?.[troop.id],power=view?.power||1,next=view?.nextPower??null;
    return {...troop,...view,level:view?.level||1,power,nextPower:next,damage:power,nextDamage:next};});
}
module.exports={troopCatalog};

(function(root){
'use strict';
const CORE=['tanque','desliz','heli','canhao','central'];
const UNLOCKS=[{level:2,kind:'batedor',types:2,troopLevel:2,battles:10},{level:3,kind:'foguetes',types:3,troopLevel:3,battles:30},{level:4,kind:'blindado',types:4,troopLevel:4,battles:60},{level:5,kind:'antiaereo',types:5,troopLevel:5,battles:100},{level:6,kind:'engenheiro',types:6,troopLevel:6,battles:160},{level:7,kind:'artilharia',types:7,troopLevel:7,battles:250}];
const DEFINITIONS={
 tanque:{name:'Tanque',category:'Tropa terrestre',base:'Garagem',description:'Avança por caminhos de terra e captura posições.',tip:'Reúna reforços para romper posições defendidas.',speed:42,attack:1,armor:1,interval:.3,production:1},
 desliz:{name:'Bote',category:'Tropa de travessia',base:'Base de botes',description:'Alcança posições sem ligação terrestre, incluindo ilhas.',tip:'Abra rotas alternativas entre as ilhas.',speed:52,attack:1,armor:1,interval:.3},
 heli:{name:'Helicóptero',category:'Tropa aérea',base:'Heliporto',description:'Voa diretamente ao alvo sem depender dos caminhos de terra.',tip:'Ataque posições distantes e envie reforços rapidamente.',speed:62,attack:1,armor:1,interval:.3},
 canhao:{name:'Canhão',category:'Defesa fixa',base:'Posição de canhão',description:'Dispara contra inimigos próximos. As tropas enviadas usam o tanque.',tip:'Proteja rotas de passagem próximas.',range:2.6,attack:1,armor:1,interval:.95},
 central:{name:'Bombardeiro central',category:'Arma estratégica',base:'Central do mapa',description:'Começa com o defensor e dispara contra tropas próximas; pode ser capturado.',tip:'Sua captura é uma vantagem. A vitória exige eliminar os adversários.',range:3.5,attack:1,armor:1,interval:.42},
 batedor:{name:'Batedor',category:'Reconhecimento',base:'Posto de reconhecimento',description:'Jipe rápido para pressionar vários pontos e capturar bases pouco defendidas.',tip:'Evite confrontos diretos com tanques e blindados.',speed:68,attack:.65,armor:.75,interval:.25,production:1.15},
 foguetes:{name:'Lança-foguetes',category:'Antiblindado',base:'Bateria de foguetes',description:'Especialista em combater tanques e blindados; é lento e vulnerável a ataques aéreos.',tip:'Contra tanques: 1,6× de dano. Contra blindados: 2×.',speed:33,attack:1,armor:.9,interval:.4,production:.95},
 blindado:{name:'Blindado pesado',category:'Assalto pesado',base:'Fábrica de blindados',description:'Resiste mais ao fogo inimigo e ajuda a romper posições defendidas.',tip:'Avança lentamente. Proteja-o de lança-foguetes.',speed:28,attack:1.25,armor:1.8,interval:.42,production:.75},
 antiaereo:{name:'Antiaéreo',category:'Defesa aérea',base:'Posto antiaéreo',description:'Veículo com canhões duplos, especializado em interceptar helicópteros.',tip:'Contra helicópteros: 2,4× de dano. Pouco eficiente contra tropas terrestres.',speed:37,attack:.9,armor:.95,interval:.28,production:1},
 engenheiro:{name:'Engenheiro',category:'Apoio',base:'Oficina de engenharia',description:'Ao chegar a uma base aliada, reforça a guarnição e cria uma fortificação temporária.',tip:'A fortificação absorve ataques e se desgasta com o tempo. É fraco em combate.',speed:38,attack:.35,armor:.85,interval:.5,production:1},
 artilharia:{name:'Artilharia móvel',category:'Cerco',base:'Arsenal de artilharia',description:'Para antes de bases inimigas e bombardeia à distância. Precisa se aproximar para capturar.',tip:'O alcance supera o canhão comum. É lenta e vulnerável a flanqueamentos.',speed:25,attack:1.1,armor:.8,interval:.6,production:.8,range:3}
};
const KINDS=Object.keys(DEFINITIONS),GROUND=['tanque',...UNLOCKS.map(x=>x.kind)];
function commander(levels={},battles=0){
 let level=1;for(const rule of UNLOCKS){const count=KINDS.filter(k=>k!=='central'&&(levels[k]||1)>=rule.troopLevel).length;if(count<rule.types||battles<rule.battles)break;level=rule.level;}
 const next=UNLOCKS.find(r=>r.level===level+1);
 return{level,battles,next:next?{...next,typesReady:KINDS.filter(k=>k!=='central'&&(levels[k]||1)>=next.troopLevel).length}:null};
}
const required=kind=>UNLOCKS.find(x=>x.kind===kind)?.level||1;
function loadout(value,commanderLevel=1){const selected=Array.isArray(value)?[...new Set(value)].filter(k=>GROUND.includes(k)&&required(k)<=commanderLevel).slice(0,3):[];return selected.length?selected:['tanque'];}
function matchup(a,b){if(a==='foguetes')return b==='blindado'?2:b==='tanque'?1.6:b==='heli'?.35:b==='batedor'?.7:1;if(a==='antiaereo')return b==='heli'?2.4:.55;return 1;}
const api={CORE,KINDS,GROUND,DEFINITIONS,UNLOCKS,commander,required,loadout,matchup};
if(typeof module==='object'&&module.exports)module.exports=api;else root.DOMINATION_TROOP_RULES=api;
})(typeof self==='object'?self:globalThis);

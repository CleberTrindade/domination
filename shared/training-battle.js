/* Isolated practice scenario. Uses the combat engine, never the world or wallet. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.DOMINATION_TRAINING=factory();})(typeof self==='object'?self:this,function(){
'use strict';
const lessons=[
 {title:'Bem-vindo ao campo de treino',text:'Azul é seu exército; vermelho é o inimigo; cinza são bases neutras. Os números indicam tropas. Suas bases produzem reforços até o limite. Aqui você aprende com calma, sem gastar moedas ou alterar suas conquistas.',source:4},
 {title:'Conquiste sua primeira base',text:'Toque na base azul marcada 1 e depois na garagem marcada 2. Você também pode arrastar da origem até o alvo. As tropas disponíveis saem da origem, que continua produzindo. Espere suas tropas chegarem: a base conquistada passa a produzir para você.',source:4,target:10},
 {title:'Capture um heliporto',text:'Use a garagem marcada 1 para atacar o heliporto marcado 2. As garagens produzem tropas terrestres; heliportos produzem helicópteros. Mais bases significam mais produção e opções de ataque.',source:10,target:14},
 {title:'Atravesse a água',text:'Envie helicópteros do heliporto 1 para a base de botes 2, na ilha. Tanques precisam de caminhos terrestres; helicópteros e botes alcançam ilhas. A base capturada produzirá botes.',source:14,target:6},
 {title:'Use os botes e a defesa fixa',text:'Agora envie os botes da ilha 1 para o canhão 2. Canhões atacam automaticamente inimigos dentro do alcance; capturá-los ajuda a proteger sua expansão.',source:6,target:16},
 {title:'A vantagem do bombardeiro',text:'Envie helicópteros de 1 para o bombardeiro 2. Ele ataca automaticamente dentro do alcance. É uma vantagem estratégica, não a condição de vitória. Em uma área ocupada, ele começa com o proprietário.',source:14,target:0},
 {title:'Reforce uma base',text:'Toque no botão do paraquedas e depois no heliporto marcado. Quando carregado, ele adiciona 12 tropas a uma base sua. Durante uma batalha real, espere a recarga antes de usá-lo novamente.',source:14,drop:true},
 {title:'Vença a batalha',text:'Ataque a última base vermelha com os helicópteros de 1. A vitória vem ao eliminar as bases e tropas dos outros exércitos. Nas partidas reais, preserve bases, combine rotas e reforce posições; desistir conta como derrota.',source:14,target:1}
];
function createTraining(engine){
 const config={mapId:'classic',balanceVersion:'troops-v3',combatVersion:'bombardiers-v2',seed:73,defenderPower:.6,centralOwner:2,maxSeconds:3600};
 const battle=engine.createBattle(config),initial=battle.checkpoint();initial.cd=0;initial.ais=[];initial.par[2].prod=0;
 for(const site of initial.sites){site.owner=[0,1].includes(site.id)?2:site.id===4?1:0;site.hq=site.id===1||site.id===4;site.troops=site.id===4?45:3;site.cd=9999;}
 initial.dropM[1]=1;battle.restore(initial);battle.setDefenderControlled(true);
 let index=0,ready=true,moving=false;
 function state(){return {index,total:lessons.length,lesson:lessons[index],ready,moving,finished:index===lessons.length-1&&ready,snapshot:battle.snapshot(),config};}
 function next(){
  if(!ready||index>=lessons.length-1)return false;index++;ready=false;moving=false;
  const saved=battle.checkpoint(),lesson=lessons[index];saved.sites[lesson.source].troops=60;
  if(lesson.drop)saved.dropM[1]=1;
  battle.restore(saved);return true;
 }
 function command(action){
  const lesson=lessons[index];if(ready||moving||!action)return false;
  if(lesson.drop){if(action.type!=='drop'||action.site!==lesson.source)return false;}
  else if(action.type!=='send'||action.target!==lesson.target||!Array.isArray(action.sources)||action.sources.length!==1||action.sources[0]!==lesson.source)return false;
  const accepted=battle.command(action,1);if(accepted){moving=!lesson.drop;ready=!!lesson.drop;}return accepted;
 }
 function step(dt){
  if(ready)return;
  // The instructor pauses between tasks. No autonomous attacker can punish reading.
  const count=Math.ceil(Math.min(.2,Math.max(0,dt))*30);
  for(let i=0;i<count&&!ready;i++){
   battle.step(1/30);
   if(moving&&battle.snapshot().sites[lessons[index].target].owner===1){ready=true;moving=false;}
  }
 }
 return {state,next,command,step};
}
return {lessons,createTraining};
});

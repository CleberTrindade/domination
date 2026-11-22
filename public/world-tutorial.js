/* Account onboarding: local practice, then a guided tour of the real screens. */
(function(){
'use strict';
window.createWorldTutorial=function({bridge,getData,post,navigate,modal,dialog,render}){
 const coach=document.createElement('section');coach.id='worldTutorial';coach.setAttribute('role','region');coach.setAttribute('aria-label','Tutorial guiado');coach.hidden=true;document.body.append(coach);
 const tours=[
  {page:'territories',selector:'.w-lobby-campaign',title:'Seu mundo aberto',text:'Este é Sergipe. Toque em uma área do mapa para selecioná-la. Azul é sua; vermelho é de outro comandante; áreas livres são defendidas pela CPU. Todas podem ser disputadas, sem ordem obrigatória.'},
  {page:'territories',selector:'[data-action="area-details"]',title:'Conheça o desafio antes de atacar',text:'O botão de informações da área mostra proprietário, mapa, resistência e recompensas. Batalhar inicia a disputa selecionada. Em área ocupada, a CPU usa as tropas do dono até ele assumir a defesa.'},
  {page:'territories',selector:'[data-action="wallet"]',title:'Moedas e conquistas',text:'Toque no saldo no topo para abrir a carteira. Áreas conquistadas produzem moedas pelo tempo de posse, inclusive offline. A primeira conquista da CPU pode dar um bônus. A carteira explica a produção e registra movimentações.'},
  {page:'troops',army:'formations',selector:'.w-formation-panel',title:'Monte suas formações',text:'Em Tropas → Formações, escolha até três tipos terrestres liberados. O primeiro ocupa sua base inicial. Crie, duplique, renomeie, salve e ative outras formações. Botes, helicópteros, canhão e bombardeiro são apoio fixo.'},
  {page:'troops',army:'collection',selector:'.w-collection-heading',title:'Coleção, cartas e melhorias',text:'Em Todas as tropas, selecione uma carta e toque em Ver detalhes. A aba Carta explica sua função e a aba Ataque mostra os atributos. Melhorar exige cartas daquele tipo e moedas; confira o próximo nível e confirme a compra. Novas tropas são liberadas conforme o nível de comandante.'},
  {page:'rewards',selector:'.w-daily-rewards',title:'Recompensas diárias',text:'Acesse Menu → Recompensas diárias, ou o baú na tela de batalha. Acompanhe os objetivos e as cartas aleatórias recebidas pelas partidas e desafios. As cartas ficam na coleção; acumular cartas não melhora a tropa automaticamente.'},
  {page:'profile',selector:'.w-profile-hero',title:'Seu perfil e suas estatísticas',text:'Perfil reúne sua conta, vitórias, derrotas, aproveitamento e áreas. O treino não entra nessas estatísticas. Use seu usuário e senha para acessar a mesma conta em outro aparelho.'},
  {page:'history',selector:'.w-social-screen',title:'Registro de batalhas',text:'Menu → Registro de batalhas mostra suas partidas e as do mundo. Veja adversários, tropas, resultados e recompensas. Os detalhes ficam no registro; Assistir aparece quando existe um replay disponível.'},
  {page:'friends',selector:'.w-social-screen',title:'Convide seus amigos',text:'Menu → Amigos permite compartilhar seu código ou link, procurar comandantes e enviar pedidos. A amizade só é criada depois que a outra pessoa aceitar. Acompanhe seus amigos e abra seus perfis por aqui.'},
  {page:'received',selector:'.w-heading',title:'Defesa, revanche e contra-ataque',text:'Ataques reúne as invasões sofridas. Se sua área estiver sob ataque, o aviso permite assumir a defesa; offline, a CPU defende. Depois, consulte a lista para uma revanche ou escolha uma área rival para contra-atacar.'},
  {page:'territories',selector:'.w-lobby-campaign',title:'Outros participantes e saque',text:'As espadas indicam uma área em batalha. Você pode assistir e, se houver vaga e base neutra, entrar como invasor. O vencedor fica com a área. O saque é 40% do menor saldo disponível na entrada entre vencedor e cada perdedor. Com saldo zero, você pode jogar: sem saque nem perda de moedas.'},
  {page:'ranking',selector:'.w-heading',title:'Ranking e avaliação de dificuldade',text:'Menu → Ranking mostra a disputa por territórios. Após sua primeira tentativa em cada área livre e em cada área já ocupada, uma enquete pede a dificuldade de 1 a 5 estrelas. Ela ajuda a equilibrar o jogo.'},
  {page:'more',selector:'.w-menu-list',title:'Tudo ao seu alcance',text:'O Menu reúne amigos, recompensas, ranking, histórico, carteira e o modo clássico. Em Tutorial guiado você pode repetir o treino ou rever este passeio. O treino não conquista áreas, não dá recompensas e não gasta moedas.'},
  {page:'territories',selector:'[data-action="attack"]',title:'Pronto para sua primeira conquista!',text:'Escolha uma área, confira o campo de batalha e prepare sua formação. Expanda, aproveite os apoios e elimine os exércitos adversários. Boa conquista, comandante!'}
 ];
 let owner=null,mode=null,worker=null,state=null,repeated=false,step=0,saving=false,paused=false,started=false,highlight=null,digest='',message='';
 const active=()=>!!mode;
 function clearHighlight(){highlight?.classList.remove('w-tutorial-highlight');highlight=null;}
 function cleanup(){worker?.terminate();worker=null;state=null;started=false;digest='';bridge.guide?.(null);clearHighlight();document.body.classList.remove('tutorial-training','tutorial-touring');document.querySelector('#btnDrop')?.classList.remove('w-tutorial-highlight');coach.hidden=true;mode=null;}
 function stop(){const wasTraining=mode==='training';cleanup();if(wasTraining){bridge.stop();bridge.show();}render();}
 async function persist(phase,index){
  if(repeated)return true;
  const player=owner;
  try{const result=await post('/api/world/tutorial',{phase,step:index});if(getData()?.player?.id!==player)return false;getData().tutorial=result.tutorial;return true;}
  catch(e){message='Não foi possível salvar o tutorial. Confira a conexão e tente novamente.';return false;}
 }
 function card(title,text,progress,button,disabled=false,success=''){
  coach.innerHTML='<header><span>'+progress+'</span><button type="button" data-guide="pause" aria-label="Pausar tutorial">PAUSAR</button></header><h2 tabindex="-1">'+title+'</h2><p>'+text+'</p>'+(success?'<p class="w-guide-success">'+success+'</p>':'')+(message?'<p role="alert">'+message+'</p>':'')+'<footer><button type="button" data-guide="'+(mode==='training'?'next':'tour-next')+'" '+(disabled?'disabled':'')+'>'+button+'</button></footer>';
  coach.hidden=false;
 }
 function practiceCard(){
  if(!state)return;const key=[state.index,state.ready,state.moving,saving,message].join(':');if(key===digest)return;digest=key;
  const finished=state.finished;
  card(finished?'Treinamento concluído!':state.lesson.title,finished?'Você venceu sua batalha de teste. Agora vamos conhecer as telas e recursos do Mundo Aberto. Esta partida não altera suas moedas, cartas ou estatísticas.':state.lesson.text,'TREINO · '+(state.index+1)+'/'+state.total,saving?'SALVANDO…':finished?'CONHECER O JOGO':state.index===0?'COMEÇAR':state.ready?'PRÓXIMA ETAPA':state.moving?'TROPAS A CAMINHO…':'FAÇA A AÇÃO NO MAPA',saving||!state.ready,state.ready&&state.index>0&&!finished?'✓ Ação concluída!':'');
  bridge.guide?.(state.ready?{source:state.lesson.source}:{source:state.lesson.source,target:state.lesson.target});
  document.querySelector('#btnDrop')?.classList.toggle('w-tutorial-highlight',!!state.lesson.drop&&!state.ready);
 }
 function startTraining(manual=false){
  if(active())cleanup();repeated=manual;owner=getData()?.player?.id||null;paused=false;message='';mode='training';dialog.close();document.body.classList.add('tutorial-training');
  worker=new Worker('/training-worker.js');const thisWorker=worker;
  card('Preparando o treinamento','Preparando seu campo de treinamento…','TREINO','AGUARDE',true);
  worker.onmessage=event=>{
   if(worker!==thisWorker||paused)return;const m=event.data;
   if(m.type==='training-command'){if(!m.accepted)bridge.commandStatus('Siga as marcas: origem 1 e alvo 2. No reforço, use o paraquedas e toque na base.',true);return;}
   if(m.type!=='training-state')return;state=m;
   if(!started){started=true;bridge.start({id:'training',training:true,config:m.config,playerOwner:1,maxOwners:2,ordinal:1,snapshot:m.snapshot,attackerName:'Você',defenderName:'Instrutor CPU',players:[{owner:1,name:'Você'},{owner:2,name:'Instrutor CPU'}]},command=>{worker?.postMessage({type:'command',command});});}
   else bridge.apply(m.snapshot);
   practiceCard();
  };
  worker.onerror=()=>{message='O treino não carregou. Pause e tente novamente pelo Menu → Tutorial guiado.';card('Treino indisponível',message,'TREINO','AGUARDE',true);};
  worker.postMessage({type:'start'});
 }
 function decorate(){if(mode!=='tour')return;clearHighlight();highlight=document.querySelector(tours[step].selector)||document.querySelector('#worldRoot .w-heading');highlight?.classList.add('w-tutorial-highlight');}
 function showTour(){
  clearHighlight();dialog.close();message='';const item=tours[step];navigate(item.page,item.army);document.body.classList.add('tutorial-touring');
  card(item.title,item.text,'CONHEÇA O JOGO · '+(step+1)+'/'+tours.length,saving?'SALVANDO…':step===tours.length-1?'CONCLUIR TUTORIAL':'PRÓXIMO',saving);
  // The screen remains usable; highlight an existing control instead of a screenshot.
  decorate();highlight?.scrollIntoView?.({block:'center',behavior:'instant'});
  coach.querySelector('h2')?.focus({preventScroll:true});
 }
 function startTour(manual=false,index=0){cleanup();mode='tour';repeated=manual;paused=false;owner=getData()?.player?.id||null;step=Math.min(tours.length-1,Math.max(0,index));showTour();}
 async function advance(){
  if(saving)return;
  if(mode==='training'){
   if(!state?.ready)return;
   if(!state.finished){worker.postMessage({type:'next'});return;}
   saving=true;message='';practiceCard();const ok=await persist('tour',0);saving=false;if(ok) {bridge.stop();bridge.show();startTour(repeated,0);}else practiceCard();return;
  }
  if(mode!=='tour')return;
  saving=true;const done=step===tours.length-1;coach.querySelector('[data-guide="tour-next"]').disabled=true;
  const ok=await persist(done?'done':'tour',done?0:step+1);saving=false;
  if(!ok){card(tours[step].title,tours[step].text,'CONHEÇA O JOGO · '+(step+1)+'/'+tours.length,'TENTAR NOVAMENTE');return;}
  if(done){cleanup();navigate('territories');render();return;}step++;showTour();
 }
 function pause(){paused=true;const training=mode==='training';stop();modal('<h2>Tutorial pausado</h2><p>'+(training?'Seu treino não altera o mundo. Você pode reiniciá-lo':'O passeio pode continuar da etapa salva')+' pelo Menu → Tutorial guiado.</p><button class="w-cta" data-dialog="close">CONTINUAR NO JOGO</button>');}
 function sync(){
  const data=getData(),id=data?.player?.id||null;
  if(owner&&owner!==id){stop();paused=false;owner=id;}
  if(active())return;
  if(paused||!data?.player||data.activeBattle||dialog.open)return;
  if(data.tutorial?.phase==='training')startTraining();
  else if(data.tutorial?.phase==='tour')startTour(false,data.tutorial.step);
 }
 function menu(){
  if(getData()?.activeBattle){modal('<h2>Você está em batalha</h2><p>Conclua a batalha antes de iniciar o tutorial.</p><button class="w-cta" data-dialog="close">VOLTAR</button>');return;}
  modal('<h2>Tutorial guiado</h2><p>Aprenda os controles em uma batalha de teste ou conheça as telas do Mundo Aberto. Sem gastar moedas ou alterar estatísticas.</p><div class="w-dialog-buttons"><button class="w-cta" data-guide-start="training">BATALHA DE TREINAMENTO</button><button class="w-cta" data-guide-start="tour">CONHECER OS RECURSOS</button>'+(getData()?.tutorial?.phase==='tour'?'<button class="w-textbtn" data-guide-start="resume">RETOMAR PASSEIO</button>':'')+'<button class="w-textbtn" data-dialog="close">VOLTAR</button></div>');
 }
 coach.addEventListener('click',e=>{const action=e.target.closest('button')?.dataset.guide;if(action==='pause')pause();if(action==='next'||action==='tour-next')advance();});
 dialog.addEventListener('click',e=>{const action=e.target.closest('button')?.dataset.guideStart;if(!action)return;dialog.close();if(action==='training')startTraining(getData()?.tutorial?.phase!=='training');else startTour(action!=='resume',action==='resume'?getData().tutorial.step:0);});
 return {active,decorate,sync,menu,pause,stop};
};
})();

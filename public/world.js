/* Combat runs in the attacker's browser worker. The server relays inputs and saves validated results. */
(() => {
  'use strict';
  const root = document.querySelector('#worldRoot'), dialog = document.querySelector('#worldDialog');
  const bridge = window.DOMINATION_WORLD_BRIDGE;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money=value=>Math.trunc(Number(value||0)).toLocaleString('pt-BR');
  const stat=value=>Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:2});
  const entryStake=()=>Math.floor((data?.wallet?.available||0)*(data?.economy?.lootPercent||40)/100);
  const geography=window.DOMINATION_SERGIPE_MAP,position=geography.positions,shapes=geography.regions;
  let data = null, selected = 'se-litoral-sul', tab = 'territories', lastDigest = '', error = '', busy = false;
  let events = null, current = null, reconnecting = false;
  let socket=null,socketPlayer=null,socketReady=false,retryTimer=null,retryDelay=1000,requestId=0,refreshTimer=null,switchingDefense=false;
  const pending=new Map(),threats=new Map(),watchedThreats=new Map();let alertDigest='';
  let reviewOnReturn=true;
  let upgrading=false,upgradeRequest=null,selectedTroop='tanque',troopDetailTab='carta',selectedTroopCard=null,upgradeConfirmation=null,armyTab='formations';
  let formationOwner=null,formationDraft=null,selectedFormation='initial',formationDirty=false,formationMessage='',formationFailed=false,savingFormations=false,editingFormationSlot=null;
  let profile=null,profileOwner=null,profileLoading=false,profileError='',profileRequest=0;
  const troopNames={tanque:'Tanque',desliz:'Bote',heli:'Helicóptero',canhao:'Canhão',central:'Bombardeiro central',batedor:'Batedor',foguetes:'Lança-foguetes',blindado:'Blindado pesado',antiaereo:'Antiaéreo',engenheiro:'Engenheiro',artilharia:'Artilharia móvel'};
  const dateTime=value=>new Date(value).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const troopIcon=kind=>window.DOMINATION_TROOP_ART?.card(kind)||`<svg viewBox="0 0 100 76" aria-hidden="true" class="w-troop-art"><ellipse cx="50" cy="65" rx="36" ry="5" fill="#263a6114"/><g fill="#658bbe" stroke="#284d7b" stroke-width="3" stroke-linejoin="round">${({tanque:'<rect x="16" y="44" width="67" height="17" rx="8" fill="#284d7b"/><path d="M22 44l8-16h37l11 16z"/><rect x="38" y="19" width="25" height="14" rx="4"/><path d="M58 21h32v6H58z"/><path d="M29 51h40" stroke="#aac9ed" stroke-dasharray="6 4"/>',desliz:'<path d="M13 41h74L73 59H29z"/><path d="M29 39V25h36l8 14z"/><path d="M48 25V12m0 0 17 10H48"/><path d="M11 66q10-7 20 0t20 0 20 0 20 0" fill="none" stroke="#74bcd8"/>',heli:'<path d="M23 37q1-16 25-16t25 16q0 13-22 13H38z"/><path d="m23 31-15-8v19l18-4M50 21V11m-30 0h60M37 50v8m25-8v8m-34 0h44" fill="none"/><path d="M60 26v13h12" fill="#c4e6ee"/>',canhao:'<circle cx="37" cy="53" r="12" fill="#284d7b"/><path d="m34 36 42-24 6 11-41 26z"/><path d="m49 47 23 14H32" fill="none"/><circle cx="37" cy="53" r="5" fill="#acc4e6"/>',central:'<circle cx="50" cy="39" r="28" fill="#a6b7d3"/><path d="m50 16 7 17 26 10v6l-27-5-2 13h-8l-2-13-27 5v-6l26-10z" fill="#edf5ff"/><circle cx="50" cy="39" r="34" fill="none" stroke="#e2b84d" stroke-width="4"/>'})[kind]||''}</g></svg>`;
  const reviewedAttacks=new Map();
  let simulation=null,pendingCompletion=null,completing=false,completionTimer=null,relayBusy=false,lastHttpRelay=0,localOrders=0;
  const alerts=document.createElement('aside');alerts.id='worldAlerts';alerts.setAttribute('aria-live','polite');document.body.append(alerts);
  const battlePanel=document.createElement('div');battlePanel.id='worldBattlePanel';document.querySelector('#game').append(battlePanel);let panelDigest='',relayReceipts=[];
  async function api(path, options = {}) {
    const {timeout=15000,...request}=options,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    try{
      const response = await fetch(path, { credentials: 'same-origin', ...request,signal:controller.signal,
        headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {const error=new Error(result.error || 'Não foi possível conectar. Tente novamente.');error.status=response.status;throw error;}
      return result;
    }catch(e){if(e.name==='AbortError')throw new Error('A conexão demorou. Confira o estado da batalha antes de repetir a ordem.');throw e;}
    finally{clearTimeout(timer);}
  }
  const post = (path, body = {}) => api(path, { method: 'POST', body: JSON.stringify(body) });
  const swords=()=>'<svg class="w-swords" viewBox="0 0 32 32" aria-hidden="true"><g class="sword-left"><path d="M5 3l5 2 14 16-4 4L5 8z"/><path d="M17 24l7-7m-1 7 5 5"/></g><g class="sword-right"><path d="M27 3l-5 2L8 21l4 4L27 8z"/><path d="M15 24l-7-7m1 7-5 5"/></g></svg>';
  function renderAlerts(){
    const visible=[...threats.values()].filter(t=>current?.id!==t.battleId);
    const html=visible.map(t=>`<button class="w-attack-alert" data-defense="${esc(t.battleId)}">${swords()}<span><strong>Sua área está sob ataque!</strong><small>${esc(t.areaName)} · ${esc(t.attackerName||'Comandante rival')}</small><b>ASSUMIR DEFESA ›</b></span></button>`).join('')+[...watchedThreats.values()].filter(t=>current?.id!==t.battleId).map(t=>`<button class="w-attack-alert public-battle" data-watch="${esc(t.battleId)}">${swords()}<span><strong>${esc(t.areaName)} sob ataque</strong><small>Batalha em andamento · acompanhe a disputa</small><b>ASSISTIR BATALHA ›</b></span></button>`).join('');
    if(html!==alertDigest){alertDigest=html;alerts.innerHTML=html;}
  }
  function syncThreats(){
    threats.clear();watchedThreats.clear();
    for(const area of data?.areas||[])if(area.battle_id&&area.owner_id===data.player?.id)threats.set(area.battle_id,{battleId:area.battle_id,areaId:area.id,areaName:area.name,attackerName:area.attacker_name});
    for(const area of data?.areas||[])if(data.player&&area.battle_id&&area.owner_id!==data.player.id&&area.attacker_id!==data.player.id&&!area.participant_ids?.includes(data.player.id))watchedThreats.set(area.battle_id,{battleId:area.battle_id,areaName:area.name});
    renderAlerts();
  }
  function ensureSocket(){
    const playerId=data?.player?.id||null;
    if(playerId===socketPlayer&&socket&&(socket.readyState===0||socket.readyState===1))return;
    clearTimeout(retryTimer);socket?.close();socket=null;socketReady=false;socketPlayer=playerId;
    if(!playerId)return;
    const ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/api/world/socket');socket=ws;
    ws.onmessage=event=>{
      if(socket!==ws)return;
      let message;try{message=JSON.parse(event.data);}catch{return;}
      if(message.type==='ready'){socketReady=true;retryDelay=1000;return;}
      if(message.type==='battle_input'&&current?.id===message.battleId){simulation?.postMessage({type:'input',input:message.input});return;}
      if(message.type==='battle_host'){hostChanged(message.record);return;}
      if(message.type==='ack'){
        const entry=pending.get(message.requestId);if(!entry||entry.battleId!==message.battleId)return;
        clearTimeout(entry.timer);pending.delete(message.requestId);entry.resolve(message);return;
      }
      if(message.type==='under_attack'){threats.set(message.battleId,message);renderAlerts();}
      if(message.type==='area_under_attack'&&message.attackerId!==data?.player?.id&&message.defenderId!==data?.player?.id){watchedThreats.set(message.battleId,message);renderAlerts();}
      if(message.type==='world_changed'){
        clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>refresh(),250);
      }
    };
    ws.onerror=()=>{};
    ws.onclose=()=>{
      if(socket!==ws)return;socketReady=false;socket=null;
      for(const [id,entry]of pending){clearTimeout(entry.timer);entry.resolve({accepted:false,uncertain:true,message:'A conexão caiu antes da confirmação. Confira suas tropas antes de repetir.'});pending.delete(id);}
      if(data?.player?.id===playerId){retryTimer=setTimeout(()=>ensureSocket(),retryDelay);retryDelay=Math.min(8000,retryDelay*2);}
    };
  }
  function socketCommand(battleId,command){
    return new Promise(resolve=>{
      const id=++requestId;
      const timer=setTimeout(()=>{pending.delete(id);resolve({accepted:false,uncertain:true,message:'A confirmação demorou. Confira suas tropas antes de repetir a ordem.'});},3500);
      pending.set(id,{battleId,timer,resolve});
      try{socket.send(JSON.stringify({type:'command',battleId,requestId:id,command}));}
      catch{clearTimeout(timer);pending.delete(id);resolve({accepted:false,uncertain:true,message:'Conexão interrompida. Aguarde a reconexão.'});}
    });
  }
  function areaClass(area) { return area.owner_id ? (area.owner_id === data?.player?.id ? 'mine' : 'rival') : ''; }
  const menuIcon=key=>`<svg viewBox="0 0 24 24" aria-hidden="true">${({
    profile:'<circle cx="12" cy="7" r="4" fill="#8fb8f2"/><path d="M4 22v-3a8 8 0 0 1 16 0v3z" fill="#6d7bb8"/>',
    troops:'<path d="M12 2 20 5v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z" fill="#6d7bb8"/><path d="m12 6 5 5h-3v5h-4v-5H7z" fill="#fff"/>',
    territories:'<path d="m4 3 10 10M20 3 10 13" stroke="#8fb8f2" stroke-width="3.2" stroke-linecap="round"/><path d="m6 14 4 4m8-4-4 4M4 20l3-3m13 3-3-3" stroke="#6d7bb8" stroke-width="3" stroke-linecap="round"/>',
    received:'<path d="M5 17h14l-2-4V9A5 5 0 0 0 7 9v4z" fill="#8fb8f2" stroke="#6d7bb8" stroke-width="1.8"/><path d="M10 21h4" stroke="#6d7bb8" stroke-width="2.5" stroke-linecap="round"/>',
    more:'<path d="M4 6h16M4 12h16M4 18h16" stroke="#6d7bb8" stroke-width="3" stroke-linecap="round"/>',
    ranking:'<path d="M7 3h10v5c0 8-10 8-10 0z" fill="#edc45a"/><path d="M7 5H3v3q0 5 6 5m8-8h4v3q0 5-6 5M12 15v5m-4 1h8" fill="none" stroke="#a88b48" stroke-width="2"/>',
    history:'<circle cx="12" cy="12" r="9" fill="#e1e8f5" stroke="#6d7bb8" stroke-width="2"/><path d="M12 6v6l4 3" fill="none" stroke="#6d7bb8" stroke-width="2" stroke-linecap="round"/>',
    wallet:'<rect x="3" y="5" width="18" height="15" rx="3" fill="#8fb8f2"/><path d="M3 7V5l14-3v3" fill="none" stroke="#6d7bb8" stroke-width="2"/><path d="M16 10h6v6h-6z" fill="#6d7bb8"/><circle cx="18" cy="13" r="1" fill="white"/>',
    classic:'<path d="m3 5 6-2 6 3 6-2v15l-6 2-6-3-6 2z" fill="#8fb8f2"/><path d="M9 3v15m6-12v15" stroke="#fff" stroke-width="1.5"/>'
  })[key]||''}</svg>`;
  function mainNavigation(){
    const active=['ranking','history','rewards','more'].includes(tab)?'more':tab;
    return `<nav id="worldNav" class="w-world-nav" aria-label="Navegação principal do mundo" role="tablist">${[['profile','PERFIL'],['troops','TROPAS'],['territories','BATALHA'],['received','ATAQUES'],['more','MENU']].map(([key,label])=>`<button role="tab" data-tab="${key}" aria-selected="${active===key}" class="${active===key?'on':''}">${lobbyIcon(({troops:'cards',territories:'swords',received:'bell'})[key]||key)}<span>${label}</span>${key==='received'&&data.receivedAttacks?.length?'<b class="w-nav-count" aria-label="'+data.receivedAttacks.length+' ataques recentes">'+data.receivedAttacks.length+'</b>':''}</button>`).join('')}</nav>`;
  }
  function mainMenu(){
    const items=[['troops','Recompensas diárias','Cartas aleatórias e progresso dos objetivos','tab','rewards'],['ranking','Ranking','Comandantes e áreas conquistadas','tab','ranking'],['history','Histórico do mundo','As últimas disputas de Sergipe','tab','history'],...(data.wallet?[['wallet','Carteira','Saldo, produção e movimentações','action','wallet']]:[]),['profile',data.player?'Minha conta':'Entrar na conta',data.player?'Perfil e histórico das suas partidas':'Acesse suas conquistas em qualquer aparelho','action','account'],['classic','Modo clássico','Campanha, duelos e melhorias do clássico','action','classic']];
    return `<div class="w-heading"><div><h1>Menu</h1><p>Todos os caminhos do seu comandante.</p></div></div><nav class="w-menu-list" aria-label="Outras opções do jogo">${items.map(([icon,title,description,attribute,value])=>`<button class="w-menu-item" data-${attribute}="${value}"><i>${lobbyIcon(({troops:'chest',profile:'commander'})[icon]||icon)}</i><span><strong>${title}</strong><small>${description}</small></span><b aria-hidden="true">›</b></button>`).join('')}</nav>`;
  }
  function tacticalMap(area){
    const catalog=window.DOMINATION_MAPS;if(!catalog||!area.map_id)return '';
    const map=catalog.geometry(area.map_id),defense=new Set(area.map_defender_sites||[]),attacker=area.map_attacker_site;
    const points=(x,y)=>Array.from({length:6},(_,i)=>{const a=(60*i-90)*Math.PI/180;return (x+25*Math.cos(a)).toFixed(1)+','+(y+25*Math.sin(a)).toFixed(1);}).join(' ');
    const color=id=>defense.has(id)?'#ed9d90':id===attacker?'#77adf0':'#ddd9ee';
    const labels={C:'✦',P:'Q',G:'G',B:'B',H:'H',A:'A'};
    return `<svg class="w-tactical-map" viewBox="0 0 390 640" role="img" aria-label="Prévia do campo ${esc(area.map_name)}">${map.cells.map(cell=>'<polygon points="'+points(cell.x,cell.y)+'" fill="'+color(cell.t)+'" stroke="#ffffff" stroke-width="2"/>').join('')}${map.seeds.map((seed,id)=>{const cell=map.cells[seed.cell];return '<g><circle cx="'+cell.x+'" cy="'+cell.y+'" r="14" fill="'+(defense.has(id)?'#ae554f':id===attacker?'#387fe2':'#697a9c')+'" stroke="white" stroke-width="2"/><text x="'+cell.x+'" y="'+(cell.y+4)+'" text-anchor="middle" fill="white" font-size="13" font-weight="900">'+labels[seed.n]+'</text></g>';}).join('')}</svg>`;
  }
  function showMapPreview(){
    const area=data.areas.find(a=>a.id===selected);if(!area?.map_id)return;
    modal(`<h2>${esc(area.map_name)}</h2><p>${esc(area.map_description)}</p>${tacticalMap(area)}<div class="w-legend"><span><i style="background:#77adf0"></i>Atacante</span><span><i style="background:#ed9d90"></i>Defensor / CPU</span><span><i style="background:#ddd9ee"></i>Neutras</span></div><p class="w-map-key">Q: quartel · G: garagem · B: botes<br>H: heliporto · A: canhão · ✦: bombardeiro</p><p>Formação inicial: 3 bases e bombardeiro para a defesa. Tanques seguem a terra; botes e helicópteros alcançam outras ilhas.</p><button class="w-cta" data-dialog="area-details">VOLTAR À ÁREA</button>`);
  }
  const selectedArea=()=>data?.areas.find(a=>a.id===selected)||data?.areas[0];
  function areaState(area){
    const mine=!!area.owner_id&&area.owner_id===data.player?.id;
    const ownBattle=!!area.battle_id&&(area.attacker_id===data.player?.id||area.participant_ids?.includes(data.player?.id));
    const canDefend=mine&&!!area.battle_id;
    return {mine,ownBattle,canDefend,action:canDefend?'ASSUMIR DEFESA':ownBattle?'RETOMAR BATALHA':area.battle_id?'ASSISTIR BATALHA':mine?'SOB SEU COMANDO':'BATALHAR'};
  }
  function showAreaDetails(){
    const area=selectedArea();if(!area)return;
    const {mine,ownBattle,canDefend,action}=areaState(area);
    modal(`      <section class="w-area" aria-label="Área selecionada"><div class="w-area-top"><div><div class="w-kicker">ÁREA ${String(area.ordinal).padStart(2, '0')}</div><h2>${esc(area.name)}</h2></div><span class="w-status ${mine ? 'mine' : ''}">${area.battle_id ? 'EM DISPUTA' : mine ? 'CONQUISTADA' : area.owner_id ? 'OCUPADA' : 'NÃO CONQUISTADA'}</span></div>
        <p class="w-owner">${area.owner_id ? 'Comandante: <strong>' + esc(area.owner_name) + '</strong>'+(area.owner_level?' · Maior nível: '+area.owner_level:'') : 'Sob controle da <strong>guarnição da CPU</strong>'}</p>
        ${area.map_id?'<button class="w-map-teaser" data-dialog="preview-map">'+tacticalMap(area)+'<span><small>'+esc(area.map_tag)+'</small><strong>'+esc(area.map_name)+'</strong><b>VER CAMPO DE BATALHA ›</b></span></button>':''}
        <div class="w-def"><span>Ocupação inicial da defesa</span><b>≈ ${Math.round((area.defense_share??(area.owner_id ? .5 : area.cpu_share)) * 100)}% do mapa</b></div>
        ${area.defense_bases?'<p class="w-defense-summary">'+area.defense_bases+' bases + bombardeiro central · Resistência '+esc(area.resistance)+(area.owner_id?' · Níveis individuais do proprietário':' · CPU com '+Math.round((data.progression?.cpuPowerRatio||.8)*100)+'% da força do atacante')+'</p>':''}
        <div class="w-area-coins"><strong>🪙 ${mine?'Produção incluída na sua renda diária':area.economy?'+ '+money(area.economy.productionPerDay)+' moedas/dia na sua renda':'Até 1.000 moedas por dia'}</strong><small>${mine?'Produz enquanto a área estiver sob seu comando, inclusive offline.':area.economy?(data.wallet?.available===0?'Sem saldo na entrada: sem saque nem bônus em moedas.':area.owner_id?'Saque possível: até '+money(area.economy.maxLoot)+' moedas.':'Primeira conquista: +'+money(area.economy.cpuReward)+' moedas.')+' Reserva para entrar: '+money(area.economy.atRisk)+' moedas.':!area.owner_id&&!area.cpu_reward_claimed&&area.first_capture_reward?'Primeira conquista: +'+money(area.first_capture_reward)+' moedas.':'Conquiste para começar a produzir moedas.'}</small></div>
        <button class="w-cta" data-dialog="area-battle" ${busy || (mine&&!canDefend) ? 'disabled' : ''}>${busy ? 'PREPARANDO…' : action}</button>
        ${!mine&&!area.battle_id&&data.wallet?'<p class="w-money-note">'+(data.wallet.available===0?'Sem moedas: você pode conquistar a área, sem ganhos nem perdas de moedas nesta batalha.':area.owner_id?'Saque: 40% do menor saldo disponível entre vencedor e cada perdedor, arredondado para baixo.':'Se a CPU vencer, você perde o valor reservado. Valores sempre em moedas inteiras.')+'</p>':''}
        <p class="w-detail">${esc(area.description)} ${area.owner_id ? area.defender_controlled?'O proprietário está comandando a defesa online.':'A CPU defende até o proprietário assumir o controle.' : 'Vença a guarnição para registrar a área em seu nome.'} O bombardeiro central começa com ${area.owner_id?'o proprietário':'a CPU'}.</p>
      </section><button class="w-textbtn" data-dialog="close">VOLTAR AO MAPA</button>`,'area');
  }
  function lobbyIcon(kind,klass=''){
    const slots={commander:0,chest:1,cards:2,swords:3,bell:4,base:5},slot=slots[kind];
    if(slot===undefined)return menuIcon(kind);
    return '<svg class="w-lobby-icon '+klass+'" viewBox="0 0 512 512" aria-hidden="true"><svg width="512" height="512" viewBox="'+(slot%3*512)+' '+(Math.floor(slot/3)*512)+' 512 512" overflow="hidden"><image href="/art/lobby-icons-v1.webp" width="1536" height="1024"/></svg></svg>';
  }
  function lobbyHeader(){
    return `<header class="w-lobby-top"><button class="w-lobby-player" data-action="account" aria-label="${data.player?'Perfil de '+esc(data.player.name):'Entrar na conta'}">${lobbyIcon('commander')}<strong>${data.player?esc(data.player.name):'ENTRAR'}</strong></button><button class="w-lobby-coins" data-action="${data.player?'wallet':'account'}" aria-label="${data.player?'Carteira: '+money(data.wallet?.available)+' moedas disponíveis':'Entre para salvar suas moedas'}"><i class="w-gold-coin" aria-hidden="true">★</i><strong>${money(data.wallet?.available)}</strong><span aria-hidden="true">+</span></button><button class="w-lobby-menu" data-tab="more" aria-label="Abrir menu">${menuIcon('more')}</button></header><div class="w-lobby-logo"><img src="/art/lobby-logo-v1.webp" width="1086" height="362" alt="DOMINATION — MUNDO ABERTO"></div>`;
  }
  function lobbyBoard(){
    const area=selectedArea(),labels={'se-sao-francisco':'SÃO FRANCISCO','se-aracaju':'CAPITAL'},props={'se-litoral-sul':[138,307],'se-agreste':[118,228],'se-sao-francisco':[293,169]};
    const regions=data.areas.map(a=>`<polygon data-map-area="${a.id}" class="w-territory ${areaClass(a)}" points="${shapes[a.id]}"/>`).join('');
    const bushes=[[126,64],[157,118],[227,131],[137,216],[249,196],[179,315]].map(([x,y])=>`<g transform="translate(${x} ${y})"><ellipse cy="3" rx="8" ry="3" fill="#001e5277"/><circle cx="-4" r="4" fill="#147a59"/><circle cx="4" r="4" fill="#1b9668"/><circle cy="-3" r="4" fill="#42ad66"/><path d="m-5-2 2-2m5 1 2-2" stroke="#82ca69" stroke-width="2"/></g>`).join('');
    const bases=data.areas.filter(a=>props[a.id]).map(a=>{const [x,y]=props[a.id];return `<g class="w-board-base ${areaClass(a)}" transform="translate(${x-17} ${y-33})"><svg width="34" height="39" viewBox="0 0 512 512">${lobbyIcon('base')}</svg></g>`;}).join('');
    const nodes=data.areas.map(a=>{const [px,py]=position[a.id],x=px*4,y=py*3.7,label=labels[a.id]||a.name.toUpperCase(),width=Math.max(43,label.length*5.4+11);return `<g class="w-board-node ${areaClass(a)} ${a.id===area.id?'selected':''} ${a.battle_id?'in-battle':''}" transform="translate(${x} ${y})" data-map-area="${a.id}" role="button" tabindex="0" aria-label="${esc(a.name)}${a.battle_id?' — em batalha':''}" aria-pressed="${a.id===area.id}"><rect class="w-node-depth" x="-14" y="-17" width="28" height="28" rx="8"/><rect class="w-node-face" x="-14" y="-20" width="28" height="28" rx="8"/><text class="w-node-number" text-anchor="middle" y="2">${a.ordinal}</text><rect class="w-node-label" x="${-width/2}" y="11" width="${width}" height="13" rx="5"/><text class="w-node-name" text-anchor="middle" y="20.5">${esc(label)}</text>${a.battle_id?'<g transform="translate(7 -33) scale(.53)">'+swords().replace('<svg ', '<svg width="32" height="32" ')+'</g>':''}</g>`;}).join('');
    return `<svg class="w-lobby-board" viewBox="44 5 309 352" aria-label="Mapa de campanha de Sergipe"><defs><clipPath id="lobbyBoundary"><path d="${geography.outline}"/></clipPath><linearGradient id="boardBlue" x2=".3" y2="1"><stop stop-color="#559fff"/><stop offset="1" stop-color="#1869d2"/></linearGradient><linearGradient id="boardRed" x2=".3" y2="1"><stop stop-color="#ff8177"/><stop offset="1" stop-color="#cf3f42"/></linearGradient><linearGradient id="boardNeutral" x2=".3" y2="1"><stop stop-color="#a2adc9"/><stop offset="1" stop-color="#536586"/></linearGradient><linearGradient id="boardRock" x2="0" y2="1"><stop stop-color="#8199b2"/><stop offset=".55" stop-color="#3a657c"/><stop offset="1" stop-color="#173b60"/></linearGradient><filter id="boardGlow" x="-35%" y="-25%" width="170%" height="160%"><feDropShadow dx="0" dy="8" stdDeviation="5" flood-color="#00ceff" flood-opacity=".7"/></filter><pattern id="boardTexture" width="19" height="17" patternUnits="userSpaceOnUse"><path d="m0 6 8-5 11 5-3 10H4Z" fill="#fff" fill-opacity=".025" stroke="#092d69" stroke-opacity=".12" stroke-width=".6"/><path d="m8 1 2 7-6 8m6-8 9-2" fill="none" stroke="#fff" stroke-opacity=".06"/></pattern></defs><path d="${geography.outline}" transform="translate(0 9)" fill="url(#boardRock)" stroke="#6ad2e0" stroke-width="2" filter="url(#boardGlow)"/><path d="${geography.outline}" transform="translate(0 5)" fill="#1b719b" stroke="#9ab9c8" stroke-width="2"/><g clip-path="url(#lobbyBoundary)">${regions}<path d="${geography.outline}" fill="url(#boardTexture)" pointer-events="none"/>${bushes}</g><path class="w-board-coast" d="${geography.outline}"/><g clip-path="url(#lobbyBoundary)"><polygon class="w-board-selection" points="${shapes[area.id]}"/></g>${bases}${nodes}</svg>`;
  }
  function map(){
    const area=selectedArea();if(!area)return '<p class="w-empty">O mapa está sendo preparado.</p>';
    selected=area.id;
    const owned=data.areas.filter(a=>a.owner_id&&a.owner_id===data.player?.id).length,{mine,ownBattle,canDefend,action}=areaState(area),count=data.receivedAttacks?.length||0;
    return `<section class="w-lobby-campaign" aria-label="Campanha de Sergipe"><header class="w-lobby-region"><div><small>BRASIL <span>› SERGIPE</span></small><h1>Sergipe</h1></div><b aria-label="${owned} de ${data.areas.length} áreas sob seu comando"><em>${owned}</em>/${data.areas.length} ÁREAS</b></header><div class="w-lobby-stage">${lobbyBoard()}${count?'<button class="w-lobby-attacks" data-action="received" aria-label="Ver '+count+' ataques sofridos">'+lobbyIcon('swords')+'<b>'+count+'</b></button>':''}${data.activeBattle&&!ownBattle?'<button class="w-lobby-resume" data-action="resume">RETOMAR BATALHA ›</button>':''}${owned===data.areas.length?'<span class="w-lobby-complete">Sergipe sob seu comando!</span>':''}</div></section><section class="w-lobby-selection ${areaClass(area)}" aria-label="Área selecionada"><span class="w-lobby-flag" aria-hidden="true">⚑</span><div><h2>${esc(area.name)}</h2><p>${area.battle_id?'EM DISPUTA · ':''}${esc(area.owner_name||'Guarnição da CPU')} · ${mine?'Sua área':area.economy?'+'+money(area.economy.productionPerDay)+' moedas/dia':'Até 1.000 moedas/dia'}</p></div><button data-action="area-details" aria-label="Informações de ${esc(area.name)}">i</button></section><div class="w-lobby-actions"><button class="w-lobby-shortcut" data-action="troops" aria-label="Tropas e evolução individual">${lobbyIcon('cards')}</button><button class="w-lobby-battle" data-action="${canDefend?'defend':ownBattle?'resume':'attack'}" ${area.battle_id?'data-battle="'+esc(area.battle_id)+'"':''} ${busy||(mine&&!canDefend)?'disabled':''}><strong>${busy?'PREPARANDO…':action}</strong><small>${esc(area.name)}</small></button><button class="w-lobby-shortcut" data-tab="rewards" aria-label="Ver recompensas diárias">${lobbyIcon('chest')}</button></div>`;
  }

  function ranking() {
    return `<div class="w-heading"><div><h1>Comandantes</h1><p>Quem controla Sergipe agora.</p></div></div><div class="w-list">${data.ranking.length ? data.ranking.map((p, i) => `<div class="w-list-row"><span class="place">${i + 1}</span><div><strong>${esc(p.name)}</strong><small>${p.id === data.player?.id ? 'Você · ' : ''}Áreas sob comando</small></div><span class="score">${p.areas}</span></div>`).join('') : '<div class="w-empty">O mapa ainda está sob controle da CPU.<br>Seja o primeiro comandante a conquistar uma área.</div>'}</div>`;
  }
  const statusLabel = { won: 'conquistou', lost: 'teve o ataque contido em', abandoned: 'desistiu do ataque a', interrupted: 'teve o ataque interrompido em', expired: 'teve o ataque encerrado em' };
  function history() {
    return `<div class="w-heading"><div><h1>Últimas disputas</h1><p>Conquistas e defesas do mundo compartilhado.</p></div></div><div class="w-list">${data.history.length ? data.history.map(h => `<div class="w-list-row"><span class="place">${h.status === 'won' ? '⚑' : '◇'}</span><div><strong>${esc(h.area_name)}</strong><small>${esc(h.status==='won'?(h.winner_name||h.attacker_name):h.attacker_name)} ${statusLabel[h.status] || 'atacou'} ${esc(h.area_name)}.</small><small>${h.status === 'won' ? 'Novo proprietário registrado' : 'Propriedade preservada'} · ${new Date(h.finished_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></div></div>`).join('') : '<div class="w-empty">As batalhas concluídas aparecerão aqui.<br>Cada conquista faz parte da história de Sergipe.</div>'}</div>`;
  }
  async function loadProfile(page=1){
    if(!data?.player)return;
    const owner=data.player.id,request=++profileRequest;profileOwner=owner;profileLoading=true;profileError='';render();
    try{const result=await api('/api/world/profile?page='+page);if(request!==profileRequest||data?.player?.id!==owner)return;profile=result;}
    catch(e){if(request!==profileRequest||data?.player?.id!==owner)return;profileError=e.message;}
    finally{if(request===profileRequest&&data?.player?.id===owner){profileLoading=false;render();}}
  }
  function navigate(key){
    tab=key;if(key==='received')markReceivedSeen();render();
    if(key==='profile')loadProfile();
    document.querySelector('#worldScreen').scrollTop=0;
  }
  function playerProfile(){
    if(!data.player)return '<div class="w-heading"><div><h1>Seu perfil</h1><p>Sua trajetória como comandante.</p></div></div><div class="w-empty">Entre para ver suas conquistas e o histórico pessoal.<br><button class="w-textbtn" data-action="account">ENTRAR NA CONTA</button></div>';
    const owned=data.areas.filter(a=>a.owner_id===data.player.id),stats=profile?.stats;
    const labels={won:'VITÓRIA',lost:'DERROTA',left:'DESISTÊNCIA',cancelled:'INTERROMPIDA'},roles={attacker:'Ataque',defender:'Defesa',invader:'Invasão'};
    return `<div class="w-heading"><div><h1>Seu perfil</h1><p>Conquistas, defesa e evolução.</p></div><button class="w-textbtn" data-action="profile-refresh" ${profileLoading?'disabled':''}>ATUALIZAR</button></div>
      <section class="w-profile-hero"><div class="w-avatar" aria-hidden="true">${lobbyIcon('commander')}</div><div><span class="w-kicker">COMANDANTE</span><h2>${esc(data.player.name)}</h2><p>@${esc(data.player.username)}</p>${profile?'<small>Desde '+new Date(profile.player.createdAt).toLocaleDateString('pt-BR')+'</small>':''}</div></section>
      <div class="w-profile-stats">${[[owned.length,'Áreas atuais'],[stats?.wins??'—','Vitórias'],[stats?.losses??'—','Derrotas'],[stats?.winRate==null?'—':stats.winRate+'%','Vitórias em decisões']].map(([value,label])=>'<div><strong>'+value+'</strong><small>'+label+'</small></div>').join('')}</div>
      <section class="w-profile-assets"><div><span class="w-kicker">SEU EXÉRCITO</span><div class="w-level-chips">${Object.entries(data.army?.troops||{}).map(([kind,t])=>'<span>'+troopNames[kind]+' <b>Nv. '+t.level+'</b></span>').join('')}</div><button class="w-textbtn" data-action="troops">VER TROPAS E EVOLUIR ›</button></div><button class="w-wallet" data-action="wallet"><span>🪙 <strong>${money(data.wallet?.available)}</strong><small> DISPONÍVEIS</small></span><span>CARTEIRA ›</span></button><p class="w-detail">${owned.length?owned.map(a=>esc(a.name)).join(' · '):'Você ainda não possui áreas.'}</p></section>
      <div class="w-heading"><div><h2>Suas partidas</h2><p>${stats?stats.total+' concluídas · '+stats.withdrawals+' desistências · '+stats.cancelled+' interrompidas':'Ataques, defesas e invasões.'}</p></div></div>
      <p class="w-detail">A taxa considera vitórias, derrotas e desistências. Partidas interrompidas não entram no cálculo. Defesas automáticas também aparecem no histórico.</p>
      ${data.activeBattle?'<button class="w-banner" data-action="resume">BATALHA EM ANDAMENTO · RETOMAR ›</button>':''}
      ${profileError?'<div class="w-error" role="alert">'+esc(profileError)+' <button class="w-textbtn" data-action="profile-refresh">TENTAR NOVAMENTE</button></div>':''}
      ${profileLoading?'<div class="w-empty" role="status">Carregando seu histórico…</div>':profile?.matches.length?'<div class="w-personal-history">'+profile.matches.map(m=>`<article class="w-match"><div class="w-match-heading"><span class="w-match-outcome ${m.outcome}">${labels[m.outcome]||'ENCERRADA'}</span><time>${dateTime(m.finished_at)}</time></div><h3>${esc(m.area_name)}</h3><p>${roles[m.role]}${m.army_level?' · Maior nível na entrada: '+m.army_level:''}${m.automatic_defense?' · Defesa pela CPU':''}</p>${m.troop_levels?'<div class="w-level-chips">'+Object.entries(m.troop_levels).map(([kind,t])=>'<span>'+troopNames[kind]+' <b>Nv. '+t.level+'</b></span>').join('')+'</div>':''}<p>Atacante: <strong>${esc(m.attacker_name)}</strong><br>Defensor: <strong>${esc(m.defender_name||'Guarnição da CPU')}</strong>${m.winner_name?'<br>Vencedor: <strong>'+esc(m.winner_name)+'</strong>':''}</p><div class="w-match-footer"><small>Início: ${dateTime(m.started_at)}</small><b class="${m.coin_change<0?'negative':'positive'}">${m.coin_change>0?'+':''}${money(m.coin_change)} 🪙</b></div></article>`).join('')+'</div>':!profileError?'<div class="w-empty">Nenhuma partida concluída ainda.<br>Suas próximas batalhas aparecerão aqui.</div>':''}
      ${profile&&!profileLoading&&profile.pagination.pages>1?'<div class="w-pagination"><button data-profile-page="'+(profile.pagination.page-1)+'" '+(profile.pagination.page===1?'disabled':'')+'>ANTERIOR</button><span>'+profile.pagination.page+' / '+profile.pagination.pages+'</span><button data-profile-page="'+(profile.pagination.page+1)+'" '+(profile.pagination.page===profile.pagination.pages?'disabled':'')+'>PRÓXIMA</button></div>':''}
      <button class="w-textbtn w-logout" data-action="logout-confirm">SAIR DA CONTA</button>`;
  }
  function troopMetrics(t){
    return `<div class="w-troop-metrics"><div><small>FORÇA</small><b>${Math.round(t.power*100)}%</b></div><div><small>DANO POR DISPARO</small><b>${stat(t.damage)}</b></div><div><small>${t.speed?'VELOCIDADE RELATIVA':'ALCANCE EM HEXÁGONOS'}</small><b>${t.speed?Math.round(t.speed/42*100)+'%':stat(t.range)}</b></div><div><small>INTERVALO DE TIROS</small><b>${stat(t.interval)} s</b></div></div>`;
  }
  function commanderPanel(){
    const c=data.army?.commander,next=c?.next;if(!c)return '<h2>Seu comandante</h2><p>Entre para acompanhar seu nível e os próximos desbloqueios.</p>';
    return `<section class="w-commander"><span class="w-kicker">SEU COMANDANTE</span><h2>NÍVEL ${c.level}</h2><p>${c.battles} batalhas válidas concluídas</p>${next?'<strong>Próximo desbloqueio: '+troopNames[next.kind]+'</strong><p>'+Math.min(next.typesReady,next.types)+'/'+next.types+' tipos no nível '+next.troopLevel+' · '+Math.min(c.battles,next.battles)+'/'+next.battles+' batalhas</p>':'<strong>Todos os tipos foram desbloqueados.</strong>'}<small>Contam batalhas concluídas com pelo menos 30 s de combate e participação efetiva. Desistências e defesas automáticas não contam.</small></section>`;
  }
  function ensureFormations(){
    const owner=data.player?.id||'guest',revision=data.army?.formationRevision||0;
    if(formationOwner!==owner||!formationDraft||(!formationDirty&&formationDraft.revision!==revision)){
      const forms=data.army?.formations?.length?data.army.formations:[{id:'initial',name:'Formação 1',troops:data.army?.loadout||['tanque']}];
      formationDraft={formations:forms.map(f=>({...f,troops:f.troops.slice()})),activeFormationId:data.army?.activeFormationId||forms[0].id,revision};
      if(formationOwner!==owner||!forms.some(f=>f.id===selectedFormation))selectedFormation=formationDraft.activeFormationId;
      formationOwner=owner;formationDirty=false;formationMessage='';formationFailed=false;
    }
    return formationDraft.formations.find(f=>f.id===selectedFormation)||formationDraft.formations[0];
  }
  function formationChanged(){formationDirty=true;formationMessage='Alterações ainda não salvas.';formationFailed=false;render();}
  function createFormation(duplicate=false){
    if(savingFormations)return;if(!data.player){authForm();return;}
    const current=ensureFormations();if(formationDraft.formations.length>=(data.army?.maxFormations||10))return;
    const next={id:crypto.randomUUID(),name:duplicate?(current.name+' — cópia').slice(0,32):'Formação '+(formationDraft.formations.length+1),troops:duplicate?current.troops.slice():['tanque']};
    formationDraft.formations.push(next);selectedFormation=next.id;formationChanged();
  }
  function renameFormation(){
    if(savingFormations)return;const f=ensureFormations();
    modal(`<h2>Renomear formação</h2><form id="formationNameForm"><label for="formationName">Nome da formação</label><input id="formationName" name="name" value="${esc(f.name)}" maxlength="32" required autocomplete="off"><div class="w-dialog-buttons"><button class="w-cta" type="submit">APLICAR NOME</button><button class="w-textbtn" type="button" data-dialog="close">CANCELAR</button></div></form><p>O nome será gravado ao salvar a formação.</p>`);
  }
  function showFormationPicker(slot){
    if(savingFormations)return;const f=ensureFormations();if(!Number.isInteger(slot)||slot<0||slot>2)return;slot=Math.min(slot,f.troops.length);
    editingFormationSlot=slot;
    const choices=(data.troops||[]).filter(t=>window.DOMINATION_TROOP_RULES?.GROUND.includes(t.id));
    modal(`<h2>${slot===0?'Tropa da base inicial':'Escolher tropa'}</h2><p>Selecione um tipo terrestre. Cada formação aceita de um a três tipos diferentes.</p><div class="w-loadout-choices w-formation-choices">${choices.map(t=>{const used=f.troops.includes(t.id)&&f.troops[slot]!==t.id;return `<button data-formation-kind="${t.id}" aria-pressed="${f.troops[slot]===t.id}" ${t.locked||used?'disabled':''}>${detailArt(t.id)}<span>${esc(t.name)}</span><small>${t.locked?'Comandante '+t.unlockLevel:used?'Já está nesta formação':'Nível '+t.level}</small></button>`;}).join('')}</div><div class="w-dialog-buttons">${slot>0?'<button class="w-cta" data-dialog="formation-first">USAR NA BASE INICIAL</button>':''}${f.troops[slot]&&f.troops.length>1?'<button class="w-textbtn" data-dialog="formation-remove">REMOVER DA FORMAÇÃO</button>':''}<button class="w-textbtn" data-dialog="close">VOLTAR À FORMAÇÃO</button></div>`);
  }
  function chooseFormationKind(kind){
    if(savingFormations)return;const f=ensureFormations(),slot=editingFormationSlot,t=(data.troops||[]).find(t=>t.id===kind);
    if(slot===null||slot>f.troops.length||slot<0||slot>2||!t||t.locked||!window.DOMINATION_TROOP_RULES?.GROUND.includes(kind)||f.troops.some((k,i)=>k===kind&&i!==slot))return;
    f.troops[slot]=kind;editingFormationSlot=null;dialog.close();formationChanged();
  }
  async function saveFormations(activate=false){
    if(savingFormations)return;if(!data.player){authForm();return;}
    const f=ensureFormations(),owner=data.player.id,wanted=f.id;
    const payload={expectedRevision:formationDraft.revision,activeFormationId:activate?wanted:formationDraft.activeFormationId,formations:formationDraft.formations.map(f=>({...f,troops:f.troops.slice()}))};
    savingFormations=true;formationMessage='Salvando…';formationFailed=false;render();
    try{
      const result=await post('/api/world/army/formations',payload);if(data.player?.id!==owner)return;
      data.army=result.army;syncTroopViews();formationDraft=null;formationDirty=false;ensureFormations();selectedFormation=wanted;
      formationMessage=activate?'Formação ativa nas próximas batalhas.':'Formações salvas na sua conta.';
      await refresh(true);
    }catch(e){if(data.player?.id===owner){formationMessage=e.message;formationFailed=true;formationDirty=true;if(e.status===409)await refresh(true);}}
    finally{savingFormations=false;render();}
  }
  function formationScreen(){
    const f=ensureFormations(),active=f.id===formationDraft.activeFormationId,limit=data.army?.maxFormations||10,find=k=>(data.troops||[]).find(t=>t.id===k);
    const slots=Array.from({length:3},(_,slot)=>{const kind=f.troops[slot],t=find(kind);return `<button class="w-formation-slot ${slot===0?'initial':''} ${kind?'':'empty'}" data-formation-slot="${slot}" ${savingFormations?'disabled':''} aria-label="${kind?'Trocar '+esc(t?.name||troopNames[kind]):'Adicionar tropa ao espaço '+(slot+1)}">${kind?`<strong>${esc(t?.name||troopNames[kind])}</strong><small>Nível ${t?.level||1}</small><span class="w-formation-art">${detailArt(kind)}</span><b>${slot===0?'BASE INICIAL':'⇄'}</b>`:'<b>+</b><strong>Adicionar</strong><small>Tipo terrestre</small>'}</button>`;}).join('');
    return `<div class="w-formation-presets" aria-label="Formações salvas">${formationDraft.formations.map((form,i)=>`<button data-formation="${esc(form.id)}" aria-pressed="${form.id===f.id}" aria-label="Selecionar ${esc(form.name)}${form.id===formationDraft.activeFormationId?' — ativa':''}" ${savingFormations?'disabled':''}>${i+1}${form.id===formationDraft.activeFormationId?'<i aria-hidden="true"></i>':''}</button>`).join('')}<button data-action="formation-new" aria-label="Criar formação" ${savingFormations||formationDraft.formations.length>=limit?'disabled':''}>+</button></div><section class="w-formation-panel"><header><button class="w-formation-pencil" data-action="formation-rename" aria-label="Renomear formação" ${savingFormations?'disabled':''}>✎</button><div><h2>${esc(f.name)}</h2><p>${f.troops.length}/3 tipos terrestres</p></div><span class="w-formation-state ${active?'active':''}">${active?'ATIVA':(data.army?.formations?.some(saved=>saved.id===f.id)?'SALVA':'NOVA')+(formationDirty?' *':'')}</span></header><div class="w-formation-slots">${slots}</div><p class="w-formation-tip">Toque em uma tropa para trocar</p></section><section class="w-fixed-support"><h3>APOIO FIXO</h3><div>${['desliz','heli','canhao','central'].map(kind=>{const t=find(kind);return `<button data-troop="${kind}" aria-label="Ver detalhes de ${esc(t?.name||troopNames[kind])}"><strong>${esc(t?.name||troopNames[kind])}</strong><small>Nível ${t?.level||1}</small><span>${detailArt(kind)}</span></button>`;}).join('')}</div><p>Disponíveis em todas as formações</p></section><div class="w-formation-tools"><button data-action="formation-rename" ${savingFormations?'disabled':''}>✎ Renomear</button><button data-action="formation-duplicate" ${savingFormations||formationDraft.formations.length>=limit?'disabled':''}>▣ Duplicar</button></div><div class="w-formation-save">${!active&&data.player?`<button class="w-cta" data-action="formation-activate" ${savingFormations?'disabled':''}>${formationDirty?'SALVAR E USAR':'USAR FORMAÇÃO'}</button>`:''}<button class="${active?'w-cta':'w-textbtn'}" data-action="formation-save" ${savingFormations||(!formationDirty&&data.player)?'disabled':''}>${savingFormations?'SALVANDO…':data.player?'SALVAR FORMAÇÃO':'ENTRAR PARA SALVAR'}</button><p class="w-formation-message ${formationFailed?'failed':''}" role="status">${esc(formationMessage||'Escolha a formação antes da batalha')}</p>${formationFailed?'<button class="w-textbtn" data-action="formation-reload">RECARREGAR FORMAÇÕES DA CONTA</button>':''}</div>`;
  }
  const cardList=cards=>Object.entries(cards||{}).map(([kind,count])=>'<span><b>+'+money(count)+'</b> '+esc(troopNames[kind]||kind)+'</span>').join('');
  function dailyRewardsPanel(compact=false){
    const d=data?.dailyRewards;
    if(!d)return '<section class="w-daily-rewards"><strong>CARTAS ALEATÓRIAS</strong><p>Entre para receber cartas pelas batalhas e pelos objetivos diários.</p></section>';
    return `<section class="w-daily-rewards"><div class="w-rewards-heading"><div><span class="w-kicker">RECOMPENSAS DIÁRIAS</span><h2>${d.total} / 120 cartas</h2></div><b class="w-reward-chest" aria-hidden="true">${lobbyIcon('chest')}</b></div><p>Batalhas: <strong>${d.battleCards} / 60</strong> · Objetivos: <strong>${d.missionCards} / 60</strong></p>${compact?'<button class="w-textbtn" data-tab="rewards">VER OBJETIVOS E RECOMPENSAS ›</button>':`<div class="w-daily-missions">${d.missions.map(m=>`<article class="${m.completed?'complete':''}"><div><strong>${esc(m.label)}</strong><small>${m.progress} / ${m.target} · ${m.completed?'RECOMPENSA PROCESSADA':'EM ANDAMENTO'}</small></div><b>${m.completed?'✓':'+20 🃏'}</b></article>`).join('')}</div><p>Vitória: 10 cartas · Derrota válida: 5 · Abandono: 0. Recompensas entregues automaticamente ao encerrar a partida.</p><small>Reinicia à meia-noite de Fortaleza. Uma batalha válida exige 30 s de participação ativa e ao menos uma ordem executada. Só as primeiras 3 disputas do dia contra o mesmo grupo de adversários — ou contra a CPU na mesma área — dão cartas e avançam objetivos. Cada base inimiga conta uma vez por batalha; bases neutras não contam.</small>`}</section>`;
  }
  function rewardsScreen(){
    const d=data?.dailyRewards;
    return '<div class="w-heading"><div><h1>Recompensas diárias</h1><p>Jogue, complete objetivos e receba cartas aleatórias.</p></div></div>'+dailyRewardsPanel()+'<section class="w-training-note"><strong>COMO AS CARTAS SÃO SORTEADAS</strong><p>Cada carta pode ser de qualquer tipo desbloqueado. A formação escolhida para a batalha não altera o sorteio. Tipos com todas as cartas necessárias para chegar ao nível 10 deixam de receber cartas, mesmo antes de comprar as melhorias.</p><small>Se todos os tipos disponíveis já estiverem completos, não há novas cartas até desbloquear outro tipo. Seus níveis e moedas anteriores foram preservados.</small></section>'+(d?.recent?.length?'<section class="w-reward-history"><h2>Últimos pacotes recebidos</h2>'+d.recent.map(r=>'<article><time>'+dateTime(r.at)+'</time><p>'+r.battleCards+' por batalha + '+r.missionCards+' por objetivos</p><div class="w-card-drops">'+cardList(r.cards)+'</div></article>').join('')+'</section>':'');
  }
  function battleCardsResult(final){
    const r=final.cardRewards?.find(p=>p.playerId===data?.player?.id);if(!r)return '';
    const total=Object.values(r.cards||{}).reduce((a,b)=>a+b,0);
    const reasons={unverified:'Esta forma de encerramento não dá cartas.',abandoned:'Abandono não dá cartas.',inactive:'É preciso participar ativamente por pelo menos 30 segundos.',no_orders:'É preciso executar ao menos uma ordem para receber cartas.',repeated_opponent:'Limite diário de recompensas contra estes adversários atingido.',all_cards_collected:'Você já reuniu todas as cartas para os tipos desbloqueados.'};
    return '<section class="w-result-cards"><strong>'+ (total?'🃏 +'+total+' cartas':'Sem cartas nesta batalha')+'</strong>'+(total?'<div class="w-card-drops">'+cardList(r.cards)+'</div><p>'+r.battleCards+' por batalha + '+r.missionCards+' por objetivos</p>':'<p>'+esc(reasons[r.reason]||'Limites diários atingidos.')+'</p>')+'</section>';
  }
  function troopsScreen(){
    const collection=armyTab==='collection',selectedCard=(data.troops||[]).find(t=>t.id===selectedTroopCard);
    return `<section class="w-army-screen"><header class="w-heading"><h1>Exército</h1><button class="w-textbtn" data-action="commander">Comandante Nv. ${data.army?.commander?.level||1} ⓘ</button></header><div class="w-army-tabs" role="tablist" aria-label="Telas do exército"><button role="tab" data-army-tab="formations" aria-selected="${!collection}" aria-controls="armyPanel" tabindex="${!collection?0:-1}">Formações</button><button role="tab" data-army-tab="collection" aria-selected="${collection}" aria-controls="armyPanel" tabindex="${collection?0:-1}">Todas as tropas</button></div><div id="armyPanel" role="tabpanel" aria-label="${collection?'Todas as tropas':'Formações'}">${collection?`<div class="w-collection-heading"><span class="w-kicker">COLEÇÃO</span><b>${(data.troops||[]).filter(t=>!t.locked).length}/${(data.troops||[]).length} liberadas</b></div>
      <div class="w-troop-collection">${(data.troops||[]).map(t=>`<article class="w-collection-slot ${selectedTroopCard===t.id?'selected':''} ${t.locked?'locked':''}"><button class="w-collection-card ${t.id}" data-select-troop="${t.id}" aria-pressed="${selectedTroopCard===t.id}" aria-label="Selecionar ${esc(t.name)}, nível ${t.level}"><span class="w-card-level">${t.locked?'COMANDANTE '+t.unlockLevel:'NÍVEL '+t.level}</span><span class="w-card-art">${detailArt(t.id)}</span><strong>${esc(t.name)}</strong><span class="w-card-progress"><i style="width:${t.nextCards?Math.min(100,(t.cards||0)/t.nextCards*100):100}%"></i></span><small>${t.locked?'BLOQUEADO':t.nextCards?money(t.cards)+' / '+money(t.nextCards)+' CARTAS':'NÍVEL MÁXIMO'}</small></button></article>`).join('')}</div>
<div class="w-collection-details"><button class="w-cta" ${selectedCard?'data-troop="'+selectedCard.id+'" aria-label="Ver detalhes de '+esc(selectedCard.name)+'"':'disabled'}>VER DETALHES</button><p>Selecione uma tropa para ver atributos e melhorar</p></div>`:formationScreen()}</div></section>`;
  }
  const receivedLabel={active:'EM ANDAMENTO',won:'ÁREA PERDIDA',lost:'DEFESA BEM-SUCEDIDA',abandoned:'ATAQUE ABANDONADO',interrupted:'BATALHA INTERROMPIDA',expired:'BATALHA ENCERRADA'};
  function receivedList(){
    const attacks=data.receivedAttacks||[];
    if(!data.player)return '<div class="w-empty">Entre na sua conta para consultar os ataques às suas áreas.</div>';
    if(!attacks.length)return '<div class="w-empty">Nenhum ataque sofrido até agora.<br>As próximas disputas aparecerão aqui.</div>';
    return `<div class="w-received-list">${attacks.map(a=>`<article class="w-received-card"><div class="w-received-top"><span class="w-received-icon">${a.status==='active'?swords():'⚔'}</span><div><strong>${esc(a.attacker_name)}</strong><small>Atacou ${esc(a.area_name)}</small></div></div><span class="w-received-status ${a.status==='won'?'lost':''}">${receivedLabel[a.status]||'BATALHA ENCERRADA'}</span><time>${new Date(a.started_at).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</time><div class="w-received-actions">${a.canDefend?`<button class="w-reply defend" data-respond-defense="${esc(a.id)}">DEFENDER AGORA</button>`:''}${a.revengeArea?`<button class="w-reply" data-respond="${esc(a.id)}" data-target="${esc(a.revengeArea.id)}" ${busy||a.revengeArea.busy?'disabled':''}>REVANCHE${a.revengeArea.busy?' · EM DISPUTA':''}</button>`:''}${a.counterAreas?.length?`<button class="w-reply secondary" data-counter="${esc(a.id)}" ${busy||a.counterAreas.every(area=>area.busy)?'disabled':''}>CONTRA-ATACAR</button>`:''}</div>${a.status!=='active'&&!a.revengeArea&&!a.counterAreas?.length?'<small class="w-no-target">O agressor não possui áreas para contra-atacar.</small>':''}</article>`).join('')}</div>`;
  }
  function markReceivedSeen(){
    if(!data?.player)return;
    const signature=(data.receivedAttacks||[]).map(a=>a.id+':'+a.status).join('|');
    reviewedAttacks.set(data.player.id,signature);
    try{localStorage.setItem('domination_received_'+data.player.id,signature);}catch{}
  }
  function showReceived(){
    const count=(data.receivedAttacks||[]).length;
    modal(`<h2>${count===1?'Você sofreu um ataque':count?'Últimos '+count+' ataques sofridos':'Ataques sofridos'}</h2><p>Confira as últimas disputas e escolha como responder.</p>${receivedList()}<p class="w-form-error" role="alert"></p><div class="w-dialog-buttons"><button class="w-cta" data-dialog="close">VOLTAR AO MAPA</button></div>`);
    markReceivedSeen();
  }
  function reviewReceived(){
    if(!reviewOnReturn||!data?.player||current||dialog.open)return;
    reviewOnReturn=false;
    let seen=reviewedAttacks.get(data.player.id);
    if(seen===undefined)try{seen=localStorage.getItem('domination_received_'+data.player.id);}catch{}
    const attacks=data.receivedAttacks||[],signature=attacks.map(a=>a.id+':'+a.status).join('|');
    if(attacks.length&&seen!==signature)showReceived();
  }
  async function respond(id,areaId){
    if(busy)return;
    if(current){modal('<h2>Você está em batalha</h2><p>Conclua seu ataque ou devolva a defesa à CPU antes de iniciar uma revanche ou contra-ataque.</p><div class="w-dialog-buttons"><button class="w-cta" data-dialog="close">CONTINUAR</button></div>');return;}
    busy=true;
    try{const record=await post('/api/world/battles/'+id+'/retaliate',{areaId});dialog.close();connectBattle(record);}
    catch(e){await refresh(true);busy=false;showReceived();dialog.querySelector('.w-form-error').textContent=e.message;}
    finally{busy=false;if(!current)render();}
  }
  function receivedAction(button){
    if(button.dataset.respondDefense){dialog.close();defend(button.dataset.respondDefense);return true;}
    if(button.dataset.respond){respond(button.dataset.respond,button.dataset.target);return true;}
    if(button.dataset.counter){
      const attack=(data.receivedAttacks||[]).find(a=>a.id===button.dataset.counter);if(!attack)return true;
      modal(`<h2>Escolha onde contra-atacar</h2><p>Áreas dos adversários que participaram desta disputa.</p><div class="w-counter-targets">${attack.counterAreas.map(area=>`<button class="w-reply" data-respond="${esc(attack.id)}" data-target="${esc(area.id)}" ${area.busy?'disabled':''}>${esc(area.name)}${area.ownerName?' · '+esc(area.ownerName):''}${area.busy?' · em disputa':''}</button>`).join('')}</div><p class="w-form-error" role="alert"></p><div class="w-dialog-buttons"><button class="w-textbtn" data-dialog="received">VOLTAR AOS ATAQUES</button></div>`);return true;
    }
    return false;
  }
  function render() {
    const lobby=!!data&&tab==='territories';root.classList.add('w-themed');root.dataset.page=tab;dialog.classList.add('w-themed');root.classList.toggle('w-lobby',lobby);document.querySelector('#worldScreen').classList.add('w-themed-screen');document.querySelector('#worldScreen').classList.toggle('w-lobby-screen',lobby);
    if (!data) {
      root.innerHTML = `<div class="w-lobby-logo"><img src="/art/lobby-logo-v1.webp" width="1086" height="362" alt="DOMINATION — MUNDO ABERTO"></div><div class="w-empty">${esc(error || 'Conectando ao mundo…')}${error ? '<br><button class="w-textbtn" data-action="refresh">TENTAR NOVAMENTE</button><br><button class="w-textbtn" data-action="classic">MODO CLÁSSICO ›</button>' : ''}</div>`; return;
    }
    root.innerHTML = `${lobbyHeader()}
      ${error ? '<div class="w-error" role="alert">' + esc(error) + '</div>' : ''}
      ${tab === 'territories' ? map() : tab==='troops'?troopsScreen():tab==='rewards'?rewardsScreen():tab==='profile'?playerProfile():tab==='more'?mainMenu():tab==='received'?'<div class="w-heading"><div><h1>Ataques sofridos</h1><p>Seus últimos 20 ataques, do mais recente ao mais antigo.</p></div></div>'+receivedList():tab === 'ranking' ? ranking() : history()}
      ${lobby?'':'<footer class="w-footer"><p><span class="w-sync">● Conquistas salvas online</span><br>Cada área pode trocar de comandante.</p></footer>'}${mainNavigation()}`;
  }
  async function refresh(force = false) {
    try {
      const hadError = !!error;
      const next = await api('/api/world'); const digest = JSON.stringify(next);
      if(next.player?.id!==profileOwner){profile=null;profileError='';profileLoading=false;profileOwner=next.player?.id||null;profileRequest++;}
      data = next; error = '';ensureSocket();syncThreats();
      if (force || hadError || digest !== lastDigest) { lastDigest = digest; render(); }
      reviewReceived();
      if(tab==='profile'&&data.player&&!profile&&!profileLoading&&!profileError)loadProfile();
    } catch (e) { error = e.message; render(); }
  }
  function modal(html,view='') {
    const replace=dialog.open&&view==='troop'&&dialog.dataset.view==='troop';
    if(dialog.open&&!replace)dialog.close();
    dialog.dataset.view=view;dialog.classList.toggle('w-dialog-troop',view==='troop');dialog.innerHTML=html;
    if(!replace)dialog.showModal();
  }
  const detailArt=kind=>kind==='tanque'?'<img class="w-detail-art" data-art="transparent-hero" src="/art/tank-detail-v2.webp" alt="" width="900" height="600">':window.DOMINATION_TROOP_ART?.detail(kind)||troopIcon(kind);
  const fixedTroop=kind=>['canhao','central'].includes(kind);
  function detailGlyph(kind){
    const emoji={damage:'💥',power:'💪',interval:'⏱️'};
    if(emoji[kind])return '<span class="w-stat-emoji" aria-hidden="true">'+emoji[kind]+'</span>';
    if(kind==='speed')return '<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M4 23a12 12 0 1 1 20 0" fill="none" stroke="#46c9ff" stroke-width="4"/><path d="M23 7a12 12 0 0 1 1 16" fill="none" stroke="#fa6451" stroke-width="4"/><path d="m13 15 9-10-5 13Z" fill="#ffda54" stroke="#8d6112" stroke-width=".7"/><circle cx="14" cy="17" r="3" fill="#fff2ac"/></svg>';
    const paths={range:'M3 12h18M12 3v18m-9-9 4-4m-4 4 4 4m14-4-4-4m4 4-4 4',targets:'M12 2v4m0 12v4M2 12h4m12 0h4M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z',movement:'M5 8h14a4 4 0 0 1 0 8H5a4 4 0 0 1 0-8Zm1 4h.01M12 12h.01M18 12h.01'};
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+paths[kind]+'" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  function attackPreview(troop){
    const repair=troop.id==='engenheiro',label='Ilustração de '+esc(troop.name)+(repair?' reforçando uma base aliada':' enfrentando uma base inimiga');
    if(troop.id==='tanque')return '<div class="w-attack-preview" role="img" aria-label="'+label+'"><img class="w-preview-scene" src="/art/tank-attack-v2.webp" width="960" height="320" alt=""></div>';
    const scene=repair?window.DOMINATION_TROOP_ART?.baseCard(troop.id):'<img class="w-preview-scene" src="/art/battle-plate-v2.webp" width="960" height="320" alt="">';
    return '<div class="w-attack-preview '+(repair?'repair':'')+'" role="img" aria-label="'+label+'">'+scene+'<div class="w-preview-unit">'+detailArt(troop.id)+'</div><div class="w-preview-beam" aria-hidden="true">'+(repair?'✚':'✦')+'</div></div>';
  }
  function detailAttack(troop){
    const fixed=fixedTroop(troop.id),movement=fixed?'Fixo':troop.id==='heli'?'Aéreo':troop.id==='desliz'?'Travessia':'Terrestre';
    const metrics=[['damage','Dano por disparo',stat(troop.damage)],['power','Força',Math.round(troop.power*100)+'%'],['interval','Intervalo de tiros',stat(troop.interval)+' s'],[fixed?'range':'speed',fixed?'Alcance (hex.)':'Velocidade',fixed?stat(troop.range):Math.round(troop.speed/42*100)+'%'],['targets','Alvos',fixed?'Tropas':'Bases e tropas'],['movement','Movimento',movement]];
    return '<div class="w-attack-stats">'+metrics.map(([icon,label,value])=>'<div class="w-attack-stat"><i>'+detailGlyph(icon)+'</i><span><small>'+label+'</small><b>'+value+'</b></span></div>').join('')+'</div>'+attackPreview(troop);
  }
  function detailCard(troop){
    return '<p class="w-card-description">'+esc(troop.description)+'</p><figure class="w-origin-preview">'+(troop.id==='tanque'?'<img class="w-origin-scene" src="/art/tank-garage-v2.webp" width="960" height="400" alt="Garagem de tanques">':window.DOMINATION_TROOP_ART?.baseCard(troop.id)||troopIcon(troop.id))+'<figcaption>Base de origem: <strong>'+esc(troop.base)+'</strong></figcaption></figure><p class="w-card-strategy"><span aria-hidden="true">💡</span>'+esc(troop.tip)+'</p>';
  }
  function showArmy(kind=selectedTroop,message='',failed=false){
    if(kind!==selectedTroop)troopDetailTab='carta';selectedTroop=kind;upgradeConfirmation=null;
    const troop=(data.troops||[]).find(t=>t.id===kind),army=data.army?.troops?.[kind];if(!troop)return;
    const maximum=!troop.nextLevel,cards=troop.cards||0,needed=troop.nextCards||0,progress=maximum?100:Math.min(100,cards/Math.max(1,needed)*100);
    const reason=troop.locked?'Requer comandante nível '+troop.unlockLevel+'.':army?.reason;
    const notice=message||(!maximum&&reason)||'',label=troop.locked?'COMANDANTE '+troop.unlockLevel:maximum?'NÍVEL MÁXIMO':'Melhorar';
    const button=!data.player?'<button class="w-upgrade-action w-upgrade-login" data-dialog="login">ENTRAR PARA MELHORAR</button>':'<button class="w-upgrade-action" data-dialog="review-upgrade" '+(!army?.canUpgrade||upgrading?'disabled':'')+' aria-describedby="troopUpgradeHint" aria-label="'+esc(maximum?'Nível máximo':troop.locked?label:'Melhorar '+troop.name+' por '+needed+' cartas e '+troop.nextCost+' moedas')+'"><span>'+(upgrading?'MELHORANDO…':label)+'</span>'+(!maximum&&!troop.locked?'<b><i aria-hidden="true">🪙</i> '+money(troop.nextCost)+'</b>':'')+'</button>';
    const active=troopDetailTab==='ataque'?'ataque':'carta';
    modal(`<section class="w-troop-detail" aria-labelledby="troopDetailTitle"><div class="w-troop-showcase" aria-hidden="true">${detailArt(kind)}</div><div class="w-troop-sheet"><button class="w-detail-close" data-dialog="close" aria-label="Fechar detalhes">×</button><header class="w-troop-identity"><div class="w-detail-portrait">${detailArt(kind)}</div><div><h2 id="troopDetailTitle">${esc(troop.name)}</h2><strong>Nível ${troop.level}</strong><span><i aria-hidden="true">${detailGlyph('movement')}</i>${esc(troop.category.replace(/^Tropa /i,''))}</span></div></header><div class="w-detail-tabs" role="tablist" aria-label="Informações da tropa"><button id="troopTabCarta" role="tab" data-troop-tab="carta" aria-selected="${active==='carta'}" aria-controls="troopDetailsPanel" tabindex="${active==='carta'?0:-1}">Carta</button><button id="troopTabAtaque" role="tab" data-troop-tab="ataque" aria-selected="${active==='ataque'}" aria-controls="troopDetailsPanel" tabindex="${active==='ataque'?0:-1}">Ataque</button></div><div id="troopDetailsPanel" class="w-troop-content" role="tabpanel" aria-labelledby="troopTab${active==='carta'?'Carta':'Ataque'}" tabindex="0">${active==='carta'?detailCard(troop):detailAttack(troop)}</div><footer class="w-troop-upgrade"><div class="w-detail-card-progress"><span class="w-card-stack" aria-hidden="true">▱</span><div><div class="w-card-meter" role="progressbar" aria-label="Cartas de ${esc(troop.name)} para a próxima melhoria" aria-valuemin="0" aria-valuemax="${maximum?1:needed}" aria-valuenow="${maximum?1:Math.min(cards,needed)}"><i style="width:${progress}%"></i><b>${maximum?'COLEÇÃO COMPLETA':money(cards)+' / '+money(needed)+' cartas'}</b></div><small>${maximum?'Nível máximo':`Nível ${troop.level} <span aria-hidden="true">➜</span> ${troop.nextLevel}`}</small></div></div>${button}<p id="troopUpgradeHint" class="w-troop-upgrade-hint ${message?(failed?'failed':'success'):''}" role="status">${esc(notice)}</p></footer></div></section>`,'troop');
  }
  function selectTroopTab(value){
    if(!['carta','ataque'].includes(value)||!dialog.open||dialog.dataset.view!=='troop')return;
    troopDetailTab=value;showArmy();dialog.querySelector('[data-troop-tab="'+value+'"]').focus?.();
  }
  function reviewUpgrade(){
    const kind=selectedTroop,troop=(data?.troops||[]).find(t=>t.id===kind),army=data?.army?.troops?.[kind];
    if(upgrading||!troop||!army?.canUpgrade)return;
    upgradeConfirmation={kind,level:army.level,cost:army.nextCost,cards:army.nextCards};
    modal(`<section class="w-upgrade-confirm" aria-labelledby="upgradeConfirmTitle"><div class="w-troop-modal-art">${troopIcon(kind)}</div><span class="w-kicker">CONFIRMAR MELHORIA</span><h2 id="upgradeConfirmTitle">Melhorar ${esc(troop.name)}?</h2><div class="w-army-next"><strong>Nível ${army.level} → ${army.nextLevel}</strong><p>Força: ${Math.round(army.power*100)}% → ${Math.round(army.nextPower*100)}%<br>Dano: ${stat(troop.damage)} → ${stat(troop.nextDamage)} por disparo</p></div><p>Você vai gastar <strong>${money(army.nextCost)} moedas e ${money(army.nextCards)} cartas de ${esc(troop.name)}</strong>.<br>Cartas restantes: <strong>${money(army.cards-army.nextCards)}</strong>.<br>Saldo disponível após a melhoria: <strong>${money(data.wallet.available-army.nextCost)} moedas</strong>.</p><p>A melhoria vale apenas para esta tropa, nas próximas batalhas. As moedas reservadas continuam protegidas.</p><div class="w-dialog-buttons"><button class="w-cta" data-dialog="confirm-upgrade">CONFIRMAR · ${money(army.nextCost)} 🪙</button><button class="w-textbtn" data-dialog="troop-details">CANCELAR E VOLTAR AOS DETALHES</button></div></section>`);
  }
  async function upgradeArmy(){
    const confirmation=upgradeConfirmation,kind=confirmation?.kind,army=data?.army?.troops?.[kind];
    if(upgrading||!confirmation)return;
    if(!army){showArmy(kind);return;}
    if(army.level!==confirmation.level||army.nextCost!==confirmation.cost||army.nextCards!==confirmation.cards){showArmy(kind,'Os dados da melhoria mudaram. Confira o nível e o custo antes de confirmar novamente.',true);return;}
    if(!army.canUpgrade){showArmy(kind);return;}
    const level=army.level;
    if(upgradeRequest?.expectedLevel!==level||upgradeRequest?.troopKind!==kind)upgradeRequest={troopKind:kind,expectedLevel:level,requestId:crypto.randomUUID()};
    upgrading=true;showArmy(kind);
    try{const result=await post('/api/world/army/upgrade',upgradeRequest);if(result.army)data.army=result.army;if(result.wallet)data.wallet={...data.wallet,...result.wallet};syncTroopViews();await refresh(true);upgradeRequest=null;upgrading=false;showArmy(kind,'Melhoria confirmada! '+troopNames[kind]+' evoluiu para as próximas batalhas.');}
    catch(e){await refresh(true);upgrading=false;if(data?.army?.troops?.[kind]?.level>level){upgradeRequest=null;showArmy(kind,'Seu novo nível já foi confirmado.');}else showArmy(kind,e.message,true);}
  }
  function syncTroopViews(){
    data.troops=(data.troops||[]).map(t=>{const view=data.army?.troops?.[t.id];return view?{...t,...view,damage:(t.attack||1)*view.power,nextDamage:view.nextPower===null?null:(t.attack||1)*view.nextPower}:t;});
  }
  function showWallet(){
    if(!data?.wallet)return;
    const wallet=data.wallet,rules=data.economy,labels={production:'Produção das áreas',battle_loot:'Saque da batalha',cpu_reward:'Primeira conquista da CPU',cpu_loss:'Derrota para a CPU',army_upgrade:'Evolução do exército'};
    const rewards=(data.areas||[]).map(a=>a.first_capture_reward||rules.cpuReward),minReward=Math.min(rules.cpuReward,...rewards),maxReward=Math.max(rules.cpuReward,...rewards),rewardText=minReward===maxReward?money(minReward):'de '+money(minReward)+' a '+money(maxReward);
    modal(`<h2>Sua carteira</h2><div class="w-wallet-summary"><strong>🪙 ${money(wallet.balance)} moedas</strong><p>${money(wallet.available)} disponíveis · ${money(wallet.reserved)} reservadas<br>Produção das suas áreas: ${money(wallet.productionPerDay)} por dia</p></div><p>Produção por tempo de posse, inclusive offline: as primeiras 5 áreas rendem 1.000 moedas/dia cada; da 6ª à 10ª, 500 cada; as demais, 250 cada. O total é limitado a 10.000 moedas/dia. Saques ficam fora desse limite.</p><p>Você pode atacar, defender ou entrar como invasor com qualquer saldo, inclusive zero. Sem saldo disponível na entrada, não ganha nem perde moedas nessa batalha, incluindo o bônus da CPU. Reservamos 40% do saldo disponível na entrada, arredondado para baixo. O vencedor recebe de cada perdedor 40% do menor saldo entre os dois. O restante da reserva é liberado.</p><p>A primeira conquista de uma área da CPU rende ${rewardText} moedas, conforme a resistência da guarnição. Perder para a CPU desconta a reserva. Todos os valores são inteiros. Sem moedas, você ainda pode conquistar a área e iniciar sua produção diária.</p><p>Desistir conta como derrota. Uma queda curta permite reconectar; uma interrupção do servidor libera as reservas sem saque.</p><h3>Últimas movimentações concluídas</h3><div class="w-coin-ledger">${wallet.entries.length?wallet.entries.map(entry=>`<div><span>${labels[entry.kind]||'Movimentação'}<small>${entry.kind==='production'?'Produção acumulada':entry.kind==='army_upgrade'?(troopNames[entry.troop_kind]||'Treinamento geral')+' · Nível '+entry.upgrade_level:esc(entry.area_name)} · ${new Date(entry.created_at).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</small></span><b class="${entry.amount<0?'negative':''}">${entry.amount>0?'+':''}${money(entry.amount)}</b></div>`).join(''):'<p>Saldo inicial: '+money(rules.initialCoins)+' moedas. As próximas batalhas aparecerão aqui.</p>'}</div><button class="w-cta" data-dialog="close">VOLTAR AO MAPA</button>`);
  }
  function renderBattlePanel(){
    if(!current){battlePanel.innerHTML='';panelDigest='';return;}
    const me=current.playerOwner??1,sites=current.joinableSites||[],eliminated=me>0&&Array.isArray(current.snapshot.activeOwners)&&!current.snapshot.activeOwners.includes(me)&&!current.snapshot.over;
    const digest=JSON.stringify({me,sites,canJoin:current.canJoin,joinState:current.joinState,joinError:current.joinError,eliminated,busy,economy:current.economy,available:data?.wallet?.available,level:data?.army?.level,players:current.players});
    if(digest===panelDigest)return;panelDigest=digest;
    battlePanel.classList.toggle('is-participant',me>0);
    const selected=battlePanel.querySelector('select')?.value;
    const kind={P:'Garagem',G:'Garagem',H:'Heliporto',B:'Botes',A:'Canhão'};
    if(me===0){
      const pending=current.joinState==='pending';
      battlePanel.innerHTML=`<strong>ESPECTADOR · BATALHA EM ANDAMENTO</strong>${current.joinError?'<p class="w-join-error">'+esc(current.joinError)+'</p>':''}${pending?'<p>Aguardando a confirmação da sua entrada…</p>':current.canJoin&&sites.length?`<p>Escolha uma base neutra para entrar com 25 tropas.${data?.army?' Suas tropas entram com os níveis individuais atuais.':''}</p>${data?.wallet?'<p>Reserva: '+money(entryStake())+' moedas. '+(data.wallet.available===0?'Sem saldo: sem ganhos nem perdas de moedas.':'Saque de 40% do menor saldo contra cada adversário, arredondado para baixo.')+'</p>':''}<div class="w-join-controls"><select id="worldJoinSite" aria-label="Base neutra para entrar"><option value="" disabled selected>Escolha uma base livre</option>${sites.map(site=>`<option value="${site.id}">Base ${site.id+1} · ${kind[site.kind]||'Base'}</option>`).join('')}</select><button data-battle-action="join" ${busy?'disabled':''}>ENTRAR</button></div>`:'<p>'+(current.joinState==='left'?'Você saiu desta disputa e pode acompanhar o restante.':sites.length?'Os quatro exércitos já estão ocupados.':'Não há base neutra disponível. Você pode continuar assistindo.')+'</p>'}`;
      const input=battlePanel.querySelector('select');if(selected&&sites.some(site=>String(site.id)===selected)&&input)input.value=selected;
    }else battlePanel.innerHTML=eliminated?'<strong>SEU EXÉRCITO FOI ELIMINADO</strong><p>A reserva continua vinculada ao resultado.</p><button data-battle-action="leave">VOLTAR AO MAPA</button>':current.economy?'<strong>'+((current.players||[]).find(p=>p.owner===me)?.level?'Maior nível: '+current.players.find(p=>p.owner===me).level+' · ':'')+'🪙 '+money(current.economy.atRisk)+' reservadas</strong><p>Saque possível: até '+money(current.economy.maxLoot)+' moedas'+(current.economy.cpuReward?' · CPU: +'+money(current.economy.cpuReward):'')+'</p>':'';
  }
  async function watch(id){
    if(!data?.player){authForm();return;}
    if(current&&current.id!==id&&(current.playerOwner??1)>0){modal('<h2>Você está em batalha</h2><p>Conclua sua participação ou saia da batalha atual antes de acompanhar outra disputa.</p><button class="w-cta" data-dialog="close">CONTINUAR</button>');return;}
    if(current?.id!==id)stopStream();
    return resume(id);
  }
  async function joinCurrent(){
    if(!current||current.playerOwner!==0||busy)return;
    const value=document.querySelector('#worldJoinSite')?.value,site=Number(value);
    if(value===''||!current.joinableSites?.some(s=>s.id===site)){bridge.commandStatus('Escolha uma base neutra disponível.',true);return;}
    busy=true;renderBattlePanel();
    try{const record=await post('/api/world/battles/'+current.id+'/join',{site});if(record.final)battleResult(record.final);else applyRecord(record);}
    catch(e){bridge.commandStatus(e.message,true);if(current)try{applyRecord(await api('/api/world/battles/'+current.id));}catch{}}
    finally{busy=false;renderBattlePanel();}
  }
  function authForm(register = false) {
    modal(`<h2>${register ? 'Novo comandante' : 'Bem-vindo de volta'}</h2><p>${register ? 'Crie sua conta para conquistar áreas e acessá-las em outro aparelho.' : 'Entre para continuar sua disputa por Sergipe.'}</p><form id="worldAuthForm" data-register="${register}">
      ${register ? '<label for="commanderName">Nome do comandante</label><input id="commanderName" name="name" minlength="2" maxlength="24" autocomplete="nickname" required>' : ''}
      <label for="commanderUser">Usuário</label><input id="commanderUser" name="username" minlength="3" maxlength="24" pattern="[a-zA-Z0-9_]{3,24}" autocomplete="username" autocapitalize="none" spellcheck="false" required>
      <label for="commanderPassword">Senha</label><input id="commanderPassword" name="password" type="password" minlength="8" maxlength="128" autocomplete="${register ? 'new-password' : 'current-password'}" required>
      <p class="w-form-error" role="alert"></p><button class="w-cta" type="submit">${register ? 'CRIAR CONTA' : 'ENTRAR'}</button></form>
      <div class="w-dialog-buttons"><button class="w-textbtn" data-dialog="${register ? 'login' : 'register'}">${register ? 'JÁ TENHO UMA CONTA' : 'CRIAR NOVA CONTA'}</button><button class="w-textbtn" data-dialog="close">VOLTAR AO MAPA</button></div>`);
  }
  function applyRecord(record){
    if(current?.id!==record.id)return;
    if(record.epoch===current.epoch&&(record.revision||0)<(current.revision||0))return;
    const changedSide=record.playerOwner!==undefined&&record.playerOwner!==current.playerOwner;
    if(simulation&&(record.isHost===false||record.hostEpoch&&record.hostEpoch!==current.hostEpoch)){simulation.terminate();simulation=null;pendingCompletion=null;clearTimeout(completionTimer);completionTimer=null;}
    Object.assign(current,record);
    if(changedSide)bridge.start({...current,ordinal:data?.areas.find(a=>a.id===current.areaId)?.ordinal||1},sendCommand);
    else if(!simulation)bridge.apply(record.snapshot);
    bridge.control(record.defenderControlled,record);renderBattlePanel();renderAlerts();
  }
  function startSimulation(record){
    simulation?.terminate();simulation=null;pendingCompletion=null;clearTimeout(completionTimer);completionTimer=null;
    relayReceipts=[];
    if(record.mode!=='browser'||!(record.isHost??record.playerOwner===1))return;
    const worker=new Worker('/battle-worker.js');simulation=worker;
    worker.onmessage=event=>{
      if(simulation!==worker||current?.id!==record.id)return;
      const message=event.data;
      if(message.type==='state'){
        current.snapshot=message.snapshot;bridge.apply(message.snapshot);
        renderBattlePanel();
        if(!message.snapshot.over)pendingCompletion=null;
      }
      if(message.type==='command'&&message.owner===current.playerOwner)bridge.commandStatus(message.accepted?'Ordem executada':'Ordem recusada: confira as tropas e a rota.',!message.accepted);
      if(message.type==='relay')relayState(record.id,message);
      if(message.type==='complete'){pendingCompletion=message.completion;finishSimulation();}
    };
    worker.onerror=()=>bridge.commandStatus('A simulação foi interrompida. Recarregue para retomar a batalha.',true);
    worker.postMessage({type:'start',record});
    for(const input of record.authorizedInputs||[])worker.postMessage({type:'input',input});
  }
  function hostChanged(record){
    if(current?.id!==record.id)return;
    const restart=record.isHost&&(!simulation||record.hostEpoch!==current.hostEpoch);
    applyRecord(record);if(restart)startSimulation(record);
  }
  async function relayState(id,message){
    if(current?.id!==id)return;
    relayReceipts.push(...(message.receipts||[]));
    if(socketReady&&socket.bufferedAmount<256*1024){socket.send(JSON.stringify({type:'relay',battleId:id,hostEpoch:current.hostEpoch,snapshot:message.snapshot,resume:message.resume,receipts:relayReceipts.splice(0,64)}));return;}
    if(relayBusy||Date.now()-lastHttpRelay<500)return;
    relayBusy=true;lastHttpRelay=Date.now();
    const receipts=relayReceipts.splice(0,64);
    try{await post('/api/world/battles/'+id+'/relay',{hostEpoch:current.hostEpoch,snapshot:message.snapshot,resume:message.resume,receipts});}catch{relayReceipts.unshift(...receipts);}finally{relayBusy=false;}
  }
  async function finishSimulation(){
    if(!simulation||!pendingCompletion||completing||localOrders||completionTimer)return;
    const id=current?.id;if(!id)return;completing=true;
    try{
      bridge.commandStatus('Validando e salvando o resultado…');
      const final=await post('/api/world/battles/'+id+'/complete',{...pendingCompletion,hostEpoch:current.hostEpoch});
      if(current?.id===id)battleResult(final.final||final);
    }catch(e){if(current?.id===id){if(e.status===404){battleResult({status:'interrupted',reason:'server_restart'});return;}bridge.commandStatus(e.message,true);clearTimeout(completionTimer);completionTimer=setTimeout(()=>{completionTimer=null;finishSimulation();},2000);}}
    finally{completing=false;}
  }
  async function sendCommand(command) {
    if (!current||current.playerOwner===0) return;
    const id=current.id;
    command={...command,nonce:crypto.randomUUID()};
    const optimistic=!!simulation&&socketReady;
    if(optimistic)simulation.postMessage({type:'input',input:{nonce:command.nonce,kind:'command',owner:current.playerOwner,command}});
    else bridge.commandStatus('Enviando ordem…');
    localOrders++;
    try {
      let result;
      if(socketReady){
        result=await socketCommand(id,command);
        // Retry the same idempotency key if acknowledgement was lost.
        if(result.uncertain)result=await api('/api/world/battles/'+id+'/commands',{method:'POST',body:JSON.stringify(command),timeout:6000});
      }else result=await api('/api/world/battles/'+id+'/commands',{method:'POST',body:JSON.stringify(command),timeout:6000});
      if(current?.id!==id)return;
      if(!result.accepted){if(optimistic)simulation?.postMessage({type:'reject',nonce:command.nonce});bridge.commandStatus(result.message||'A ordem não pôde ser executada.',true);return;}
      if(simulation&&result.input)simulation.postMessage({type:'input',input:result.input});
      if(result.record)applyRecord(result.record);
      if(!simulation)bridge.commandStatus('Ordem enviada ao combate');
    }
    catch (e) {
      if(current?.id===id){if(optimistic)simulation?.postMessage({type:'reject',nonce:command.nonce});bridge.commandStatus(e.message,true);}
    }
    finally{localOrders--;finishSimulation();}
  }
  function stopStream() { events?.close(); events = null;simulation?.terminate();simulation=null;pendingCompletion=null;clearTimeout(completionTimer);completionTimer=null; current = null; bridge.stop();renderAlerts();renderBattlePanel(); }
  function battleResult(final) {
    profile=null;
    if (!current) return;
    const areaName = final.areaName || current.areaName,defending=current.playerOwner===2,me=current.playerOwner??1;
    stopStream(); refresh(true);
    const conquered=final.status==='won',win=me>0&&(final.winnerOwner!=null?final.winnerOwner===me:defending?!conquered:conquered);
    const title=me===0?'Batalha encerrada':win?(defending?'Defesa concluída!':'Território conquistado!'):defending&&conquered?'Território perdido':'Batalha encerrada';
    const message=conquered?(win?'A área agora está sob seu comando. A conquista foi salva.':esc(final.winnerName||'Um comandante rival')+' conquistou a área.'):
      final.status==='expired'||final.status==='interrupted'?'A batalha foi interrompida. A área manteve seu proprietário.':'A defesa manteve o território. O resultado foi salvo no mundo compartilhado.';
    const economicResult=final.economy?.participants.find(p=>p.playerId===data?.player?.id),change=economicResult?.change;
    const reward=economicResult?'<p class="w-result-coins '+(change<0?'negative':'')+'">🪙 '+(change>0?'+':'')+money(change)+' moedas</p><p>A reserva foi liberada.'+(win&&conquered?' A nova área foi incluída na sua produção diária, conforme as faixas da carteira.':'')+'</p>':'';
    modal(`<div class="w-result"><div class="w-result-icon">${win?'⚑':'◇'}</div><h2>${title}</h2><p><strong>${esc(areaName)}</strong></p><p>${message}</p>${reward}${battleCardsResult(final)}<button class="w-cta" data-dialog="close">VOLTAR AO MAPA</button></div>`);
  }
  function connectBattle(record) {
    if (record.final || record.status !== 'active') { current = record; battleResult(record.final || { status: record.status }); return; }
    events?.close(); current = record;renderAlerts();
    const area = data?.areas.find(a => a.id === record.areaId);
    bridge.start({ ...record, ordinal: area?.ordinal || 1 }, sendCommand);
    startSimulation(record);
    renderBattlePanel();
    events = new EventSource('/api/world/battles/' + record.id + '/events');
    events.addEventListener('state', event => applyRecord(JSON.parse(event.data)));
    events.addEventListener('host',event=>hostChanged(JSON.parse(event.data)));
    events.addEventListener('input',event=>{if(current?.id===record.id)simulation?.postMessage({type:'input',input:JSON.parse(event.data)});});
    events.addEventListener('result', event => { if (!switchingDefense&&current?.id === record.id) battleResult(JSON.parse(event.data)); });
    events.addEventListener('saving', () => { document.querySelector('#hint').textContent = 'Salvando o resultado…'; document.querySelector('#hint').style.opacity = 1; });
    events.onerror = async () => {
      if (!current || reconnecting) return;
      document.querySelector('#hint').textContent = 'Reconectando… mantenha esta janela aberta.'; document.querySelector('#hint').style.opacity = 1;
      reconnecting = true;
      try { const latest = await api('/api/world/battles/' + record.id); if(current?.id===record.id){if(latest.final)battleResult(latest.final);else{applyRecord(latest);if(latest.isHost&&!simulation)startSimulation(latest);}} }
      catch (e) { if(current?.id===record.id&&e.status===404)battleResult({status:'interrupted',reason:'server_restart'});else if (current) document.querySelector('#hint').textContent = e.message; }
      finally { reconnecting = false; }
    };
  }
  async function attack() {
    if (busy || !data) return;
    if (!data.player) { authForm(false); return; }
    const area = data.areas.find(a => a.id === selected);
    if(area.battle_id)return watch(area.battle_id);
    busy = true; error = ''; render();
    try { connectBattle(await post('/api/world/areas/' + area.id + '/attack')); }
    catch (e) { await refresh(); error = e.message; }
    finally { busy = false; if (!current) render(); }
  }
  async function resume(id = data?.activeBattle) {
    if (!id || busy) return;
    busy = true;
    try { connectBattle(await api('/api/world/battles/' + id)); }
    catch (e) { error = e.message; render(); }
    finally { busy = false; renderBattlePanel(); }
  }
  async function defend(id,confirmed=false){
    if(!id||busy)return;
    if(current?.id===id&&current.playerOwner===2)return resume(id);
    if(current&&current.id!==id&&current.playerOwner!==2&&!confirmed){
      modal(`<h2>Assumir a defesa?</h2><p>Seu ataque atual será encerrado para você defender a área sob ataque.</p><div class="w-dialog-buttons"><button class="w-cta" data-dialog="switch-defense" data-battle="${esc(id)}">ENCERRAR ATAQUE E DEFENDER</button><button class="w-textbtn" data-dialog="close">CONTINUAR ATAQUE</button></div><p class="w-form-error" role="alert"></p>`);return;
    }
    busy=true;switchingDefense=true;
    try{
      if(current&&current.id!==id){
        if(current.playerOwner===2)await post('/api/world/battles/'+current.id+'/release');
        else await post('/api/world/battles/'+current.id+'/surrender');
        stopStream();
      }
      const record=await post('/api/world/battles/'+id+'/defend');
      dialog.close();connectBattle(record);
    }catch(e){bridge.commandStatus(e.message,true);error=e.message;if(!current){render();}else{const target=dialog.querySelector('.w-form-error');if(target)target.textContent=e.message;}}
    finally{busy=false;switchingDefense=false;}
  }
  window.WorldApp = {
    selectJoinSite(id){if(current?.playerOwner!==0||!current.canJoin||!current.joinableSites?.some(site=>site.id===id))return;const input=document.querySelector('#worldJoinSite');if(input)input.value=String(id);bridge.selectJoinSite?.(id);},
    show() { if(current?.playerOwner===2){this.requestSurrender();return;}bridge.show(); refresh(true); },
    requestSurrender() {
      if(current?.playerOwner===0){stopStream();refresh(true);return;}
      if(current?.playerOwner===2){
        modal('<h2>Devolver a defesa à CPU?</h2><p>A CPU continuará defendendo sua área. Isso não encerra a batalha nem entrega o território.</p><div class="w-dialog-buttons"><button class="w-cta" data-dialog="close">CONTINUAR DEFENDENDO</button><button class="w-textbtn" data-dialog="release-defense">VOLTAR AO MAPA</button></div><p class="w-form-error" role="alert"></p>');return;
      }
      modal('<h2>Sair da batalha?</h2><p>Desistir conta como derrota. Suas moedas reservadas continuam em risco até o resultado. Se houver outros participantes, a batalha continua entre eles.</p><div class="w-dialog-buttons"><button class="w-cta" data-dialog="close">CONTINUAR BATALHA</button><button class="w-textbtn" data-dialog="surrender">SAIR DA DISPUTA</button></div><p class="w-form-error" role="alert"></p>');
    }
  };
  root.addEventListener('keydown',event=>{if(event.target.closest?.('[data-army-tab]')?.dataset.armyTab){const value={ArrowLeft:'formations',ArrowRight:'collection',Home:'formations',End:'collection'}[event.key];if(value){event.preventDefault();armyTab=value;render();root.querySelector('[data-army-tab="'+value+'"]').focus?.();}return;}const node=event.target.closest?.('[data-map-area]');if(node&&['Enter',' '].includes(event.key)){event.preventDefault();selected=node.dataset.mapArea;tab='territories';render();root.querySelector('[data-map-area="'+selected+'"]').focus?.();}});
  root.addEventListener('click', async event => {
    const mapArea=event.target.closest('[data-map-area]');if(mapArea?.dataset.mapArea){selected=mapArea.dataset.mapArea;tab='territories';render();return;}
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    if (button.dataset.area) { selected = button.dataset.area; tab = 'territories'; render(); return; }
    if (button.dataset.tab) { navigate(button.dataset.tab); return; }
    if(button.dataset.armyTab){if(['formations','collection'].includes(button.dataset.armyTab)){armyTab=button.dataset.armyTab;render();}return;}
    if(button.dataset.formation){if(!savingFormations){ensureFormations();if(formationDraft.formations.some(f=>f.id===button.dataset.formation)){selectedFormation=button.dataset.formation;render();}}return;}
    if(button.dataset.formationSlot!==undefined){showFormationPicker(Number(button.dataset.formationSlot));return;}
    if(button.dataset.selectTroop){selectedTroopCard=button.dataset.selectTroop;render();return;}
    if(button.dataset.troop){troopDetailTab='carta';showArmy(button.dataset.troop);return;}
    if(button.dataset.profilePage){loadProfile(Number(button.dataset.profilePage));return;}
    if(receivedAction(button))return;
    const action = button.dataset.action;
    if (action === 'refresh') refresh(true);
    if(action==='preview-map')showMapPreview();
    if(action==='area-details')showAreaDetails();
    if(action==='wallet')showWallet();
    if(action==='army'||action==='troops')navigate('troops');
    if(action==='commander')modal(commanderPanel()+'<button class="w-cta" data-dialog="close">VOLTAR AO EXÉRCITO</button>');
    if(action==='formation-new')createFormation();
    if(action==='formation-duplicate')createFormation(true);
    if(action==='formation-rename')renameFormation();
    if(action==='formation-save')await saveFormations();
    if(action==='formation-activate')await saveFormations(true);
    if(action==='formation-reload'&&!savingFormations){formationDraft=null;formationDirty=false;ensureFormations();render();}
    if(action==='profile-refresh')loadProfile(profile?.pagination.page||1);
    if(action==='logout-confirm')modal('<h2>Sair da conta?</h2><p>Use seu usuário e senha para retornar às suas conquistas.</p><button class="w-cta" data-dialog="logout">SAIR DA CONTA</button><button class="w-textbtn" data-dialog="close">CONTINUAR NO JOGO</button>');
    if(action==='received')showReceived();
    if (action === 'attack') attack();
    if(action==='defend')defend(data.areas.find(a=>a.id===selected)?.battle_id);
    if (action === 'resume') resume(button.dataset.battle);
    if (action === 'classic') { bridge.classic(); }
    if (action === 'account') {
      if (!data?.player) authForm();
      else navigate('profile');
    }
  });
  dialog.addEventListener('cancel',()=>{upgradeConfirmation=null;});
  dialog.addEventListener('keydown',event=>{
    if(!event.target.closest?.('[data-troop-tab]'))return;
    const next={ArrowLeft:'carta',ArrowRight:'ataque',Home:'carta',End:'ataque'}[event.key];
    if(next){event.preventDefault();selectTroopTab(next);}
  });
  dialog.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button) return;
    if(button.disabled)return;
    if(receivedAction(button))return;
    if(button.dataset.formationKind){chooseFormationKind(button.dataset.formationKind);return;}
    const action = button.dataset.dialog;
    if(action==='area-details'){showAreaDetails();return;}
    if(action==='preview-map'){showMapPreview();return;}
    if(action==='area-battle'){const area=selectedArea();if(!area)return;const state=areaState(area);if(state.mine&&!state.canDefend)return;dialog.close();if(state.canDefend)await defend(area.battle_id);else if(state.ownBattle)await resume(area.battle_id);else await attack();return;}
    if(action==='formation-first'||action==='formation-remove'){
      if(savingFormations)return;const f=ensureFormations(),slot=editingFormationSlot;
      if(Number.isInteger(slot)&&slot>=0&&slot<f.troops.length){if(action==='formation-first'&&slot>0)f.troops.unshift(f.troops.splice(slot,1)[0]);if(action==='formation-remove'&&f.troops.length>1)f.troops.splice(slot,1);editingFormationSlot=null;dialog.close();formationChanged();}return;
    }
    if(button.dataset.troopTab){selectTroopTab(button.dataset.troopTab);return;}
    if (action === 'close') {upgradeConfirmation=null;dialog.close();}
    if (action === 'register') authForm(true);
    if (action === 'login') authForm(false);
    if(action==='review-upgrade')reviewUpgrade();
    if(action==='troop-details')showArmy();
    if(action==='confirm-upgrade')await upgradeArmy();
    if(action==='received')showReceived();
    if(action==='switch-defense')defend(button.dataset.battle,true);
    if(action==='release-defense'&&current?.playerOwner===2){
      button.disabled=true;
      try{await post('/api/world/battles/'+current.id+'/release');stopStream();dialog.close();await refresh(true);}
      catch(e){dialog.querySelector('.w-form-error').textContent=e.message;button.disabled=false;}
    }
    if (action === 'logout') { try { await post('/api/auth/logout');stopStream(); dialog.close(); await refresh(true); } catch (e) { error = e.message; dialog.close(); render(); } }
    if (action === 'surrender' && current) {
      button.disabled = true;
      try { const result = await post('/api/world/battles/' + current.id + '/surrender');if(result.left||result.watching){stopStream();dialog.close();refresh(true);}else if (current) battleResult(result); }
      catch (e) { const target = dialog.querySelector('.w-form-error'); if (target) target.textContent = e.message; button.disabled = false; }
    }
  });
  dialog.addEventListener('submit', async event => {
    if(event.target.id==='formationNameForm'){
      event.preventDefault();if(savingFormations)return;const name=String(new FormData(event.target).get('name')||'').trim();if(!name||name.length>32)return;ensureFormations().name=name;dialog.close();formationChanged();return;
    }
    if (event.target.id !== 'worldAuthForm') return;
    event.preventDefault(); const form = event.target, submit = form.querySelector('[type=submit]');
    const input = Object.fromEntries(new FormData(form)); submit.disabled = true;
    try { await post('/api/auth/' + (form.dataset.register === 'true' ? 'register' : 'login'), input); dialog.close();reviewOnReturn=true; await refresh(true); }
    catch (e) { form.querySelector('.w-form-error').textContent = e.message; submit.disabled = false; }
  });
  document.querySelector('#backToWorld').addEventListener('click', () => window.WorldApp.show());
  alerts.addEventListener('click',event=>{const button=event.target.closest('button');if(button?.dataset.defense)defend(button.dataset.defense);else if(button?.dataset.watch)watch(button.dataset.watch);});
  battlePanel.addEventListener('click',event=>{const action=event.target.closest('button')?.dataset.battleAction;if(action==='join')joinCurrent();if(action==='leave')window.WorldApp.requestSurrender();});
  battlePanel.addEventListener('change',event=>{if(event.target.id==='worldJoinSite')window.WorldApp.selectJoinSite(Number(event.target.value));});
  document.addEventListener('visibilitychange', () => { if (!document.hidden) {reviewOnReturn=true;refresh(true);ensureSocket();} });
  setInterval(()=>{if(socketReady)socket.send(JSON.stringify({type:'ping'}));},20000);
  setInterval(() => { if (!document.hidden&&(!current||!socketReady)) refresh(); }, 12000);
  refresh(true);
})();

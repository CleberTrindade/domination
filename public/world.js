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
  let upgrading=false,upgradeRequest=null,selectedTroop='tanque';
  let profile=null,profileOwner=null,profileLoading=false,profileError='',profileRequest=0;
  const troopNames={tanque:'Tanque',desliz:'Bote',heli:'Helicóptero',canhao:'Canhão',central:'Bombardeiro central'};
  const dateTime=value=>new Date(value).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const troopIcon=kind=>`<svg viewBox="0 0 100 76" aria-hidden="true" class="w-troop-art"><ellipse cx="50" cy="65" rx="36" ry="5" fill="#263a6114"/><g fill="#658bbe" stroke="#284d7b" stroke-width="3" stroke-linejoin="round">${({tanque:'<rect x="16" y="44" width="67" height="17" rx="8" fill="#284d7b"/><path d="M22 44l8-16h37l11 16z"/><rect x="38" y="19" width="25" height="14" rx="4"/><path d="M58 21h32v6H58z"/><path d="M29 51h40" stroke="#aac9ed" stroke-dasharray="6 4"/>',desliz:'<path d="M13 41h74L73 59H29z"/><path d="M29 39V25h36l8 14z"/><path d="M48 25V12m0 0 17 10H48"/><path d="M11 66q10-7 20 0t20 0 20 0 20 0" fill="none" stroke="#74bcd8"/>',heli:'<path d="M23 37q1-16 25-16t25 16q0 13-22 13H38z"/><path d="m23 31-15-8v19l18-4M50 21V11m-30 0h60M37 50v8m25-8v8m-34 0h44" fill="none"/><path d="M60 26v13h12" fill="#c4e6ee"/>',canhao:'<circle cx="37" cy="53" r="12" fill="#284d7b"/><path d="m34 36 42-24 6 11-41 26z"/><path d="m49 47 23 14H32" fill="none"/><circle cx="37" cy="53" r="5" fill="#acc4e6"/>',central:'<circle cx="50" cy="39" r="28" fill="#a6b7d3"/><path d="m50 16 7 17 26 10v6l-27-5-2 13h-8l-2-13-27 5v-6l26-10z" fill="#edf5ff"/><circle cx="50" cy="39" r="34" fill="none" stroke="#e2b84d" stroke-width="4"/>'})[kind]||''}</g></svg>`;
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
    modal(`<h2>${esc(area.map_name)}</h2><p>${esc(area.map_description)}</p>${tacticalMap(area)}<div class="w-legend"><span><i style="background:#77adf0"></i>Atacante</span><span><i style="background:#ed9d90"></i>Defensor / CPU</span><span><i style="background:#ddd9ee"></i>Neutras</span></div><p class="w-map-key">Q: quartel · G: garagem · B: botes<br>H: heliporto · A: canhão · ✦: bombardeiro</p><p>Formação inicial: 3 bases e bombardeiro para a defesa. Tanques seguem a terra; botes e helicópteros alcançam outras ilhas.</p><button class="w-cta" data-dialog="close">VOLTAR À ÁREA</button>`);
  }
  function map() {
    const owned = data.areas.filter(a => a.owner_id && a.owner_id === data.player?.id).length;
    const area = data.areas.find(a => a.id === selected) || data.areas[0];
    selected = area.id;
    const mine = area.owner_id && area.owner_id === data.player?.id;
    const ownBattle = area.battle_id && (area.attacker_id === data.player?.id||area.participant_ids?.includes(data.player?.id));
    const canDefend=mine&&area.battle_id;
    const action = canDefend?'ASSUMIR DEFESA':ownBattle ? 'RETOMAR BATALHA' : area.battle_id ? 'ASSISTIR BATALHA' : mine ? 'SOB SEU COMANDO' : 'ATACAR ÁREA';
    return `<div class="w-heading"><div><h1>Sergipe</h1><p>Cinco áreas. Uma conquista compartilhada.</p></div><div class="w-total">${owned}<span style="font-size:16px;color:#a9b5c8"> / 5</span><small>SUAS ÁREAS</small></div></div>
      ${owned === 5 ? '<div class="w-claim">Sergipe está sob seu comando. Defenda suas cinco áreas!</div>' : ''}
      ${data.activeBattle && !ownBattle ? '<button class="w-banner" data-action="resume">Você tem uma batalha em andamento. Toque para retomar.</button>' : ''}
      <div class="w-map" aria-label="Mapa de campanha de Sergipe">
        <svg viewBox="${geography.viewBox}" aria-hidden="true"><defs><filter id="islandShadow"><feDropShadow dx="0" dy="5" stdDeviation="1" flood-color="#427f9a" flood-opacity=".4"/></filter><clipPath id="sergipeBoundary"><path d="${geography.outline}"/></clipPath></defs>
          <path class="sea-line" d="M18 77h23m-12 5h25M337 48h30m-16 5h24M23 239h39m-28 6h20M303 300h45m-35 5h26"/>
          <path class="w-state-shadow" d="${geography.outline}" filter="url(#islandShadow)"/>
          <g clip-path="url(#sergipeBoundary)">${data.areas.map(a => `<polygon data-map-area="${a.id}" class="w-territory ${areaClass(a)} ${a.id === selected ? 'chosen' : ''}" points="${shapes[a.id]}"/>`).join('')}</g>
          <path class="w-state-outline" d="${geography.outline}"/>
          <g class="w-compass" transform="translate(354 35)"><text y="-7" text-anchor="middle">N</text><path d="M0 0l-5 17 5-4 5 4z"/></g>
          <text class="w-neighbor" x="74" y="220" transform="rotate(-65 74 220)">BAHIA</text><text class="w-neighbor" x="280" y="99" transform="rotate(28 280 99)">ALAGOAS</text>
          <text class="w-ocean" x="270" y="295" transform="rotate(-48 270 295)">OCEANO ATLÂNTICO</text>
        </svg>
        ${data.areas.map(a => `<button class="w-node ${areaClass(a)} ${a.id === selected ? 'selected' : ''} ${a.battle_id?'in-battle':''}" style="left:${position[a.id][0]}%;top:${position[a.id][1]}%" data-area="${a.id}" aria-label="${esc(a.name)}${a.battle_id?' — em batalha':''}" aria-pressed="${a.id === selected}"><span>${a.ordinal}${a.battle_id ? '<b class="w-busy">'+swords()+'</b>' : ''}</span><em>${a.id === 'se-sao-francisco' ? 'SÃO FRANCISCO' : a.id === 'se-aracaju' ? 'CAPITAL' : esc(a.name.toUpperCase())}</em></button>`).join('')}
        <small class="w-map-note">CONTORNO IBGE · 5 SETORES DE JOGO</small>
      </div>
      <div class="w-legend"><span><i style="background:#b4afce"></i>CPU</span><span><i style="background:#78aef0"></i>Suas áreas</span><span><i style="background:#ee9a8e"></i>Rivais</span></div>
      <section class="w-area" aria-label="Área selecionada"><div class="w-area-top"><div><div class="w-kicker">ÁREA ${String(area.ordinal).padStart(2, '0')}</div><h2>${esc(area.name)}</h2></div><span class="w-status ${mine ? 'mine' : ''}">${area.battle_id ? 'EM DISPUTA' : mine ? 'CONQUISTADA' : area.owner_id ? 'OCUPADA' : 'NÃO CONQUISTADA'}</span></div>
        <p class="w-owner">${area.owner_id ? 'Comandante: <strong>' + esc(area.owner_name) + '</strong>'+(area.owner_level?' · Maior nível: '+area.owner_level:'') : 'Sob controle da <strong>guarnição da CPU</strong>'}</p>
        ${area.map_id?'<button class="w-map-teaser" data-action="preview-map">'+tacticalMap(area)+'<span><small>'+esc(area.map_tag)+'</small><strong>'+esc(area.map_name)+'</strong><b>VER CAMPO DE BATALHA ›</b></span></button>':''}
        <div class="w-def"><span>Ocupação inicial da defesa</span><b>≈ ${Math.round((area.defense_share??(area.owner_id ? .5 : area.cpu_share)) * 100)}% do mapa</b></div>
        ${area.defense_bases?'<p class="w-defense-summary">'+area.defense_bases+' bases + bombardeiro central · Resistência '+esc(area.resistance)+(area.owner_id?' · Níveis individuais do proprietário':' · CPU com '+Math.round((data.progression?.cpuPowerRatio||.8)*100)+'% da força do atacante')+'</p>':''}
        <div class="w-area-coins"><strong>🪙 ${money(data.economy?.productionPerDay||1000)} moedas por dia</strong><small>${mine?'Produz enquanto a área estiver sob seu comando, inclusive offline.':area.economy?(data.wallet?.available===0?'Sem saldo na entrada: sem saque nem bônus em moedas.':area.owner_id?'Saque possível: até '+money(area.economy.maxLoot)+' moedas.':'Primeira conquista: +'+money(area.economy.cpuReward)+' moedas.')+' Reserva para entrar: '+money(area.economy.atRisk)+' moedas.':!area.owner_id&&!area.cpu_reward_claimed&&area.first_capture_reward?'Primeira conquista: +'+money(area.first_capture_reward)+' moedas.':'Conquiste para começar a produzir moedas.'}</small></div>
        <button class="w-cta" data-action="${canDefend?'defend':'attack'}" ${busy || (mine&&!canDefend) ? 'disabled' : ''}>${busy ? 'PREPARANDO…' : action}</button>
        ${!mine&&!area.battle_id&&data.wallet?'<p class="w-money-note">'+(data.wallet.available===0?'Sem moedas: você pode conquistar a área, sem ganhos nem perdas de moedas nesta batalha.':area.owner_id?'Saque: 40% do menor saldo disponível entre vencedor e cada perdedor, arredondado para baixo.':'Se a CPU vencer, você perde o valor reservado. Valores sempre em moedas inteiras.')+'</p>':''}
        <p class="w-detail">${esc(area.description)} ${area.owner_id ? area.defender_controlled?'O proprietário está comandando a defesa online.':'A CPU defende até o proprietário assumir o controle.' : 'Vença a guarnição para registrar a área em seu nome.'} O bombardeiro central começa com ${area.owner_id?'o proprietário':'a CPU'}.</p>
      </section>
      <p class="w-detail" style="margin:0;text-align:center">Vence quem eliminar o inimigo. O bombardeiro é uma vantagem disputável.</p>`;
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
      <section class="w-profile-hero"><div class="w-avatar" aria-hidden="true">${esc(data.player.name.slice(0,1).toUpperCase())}</div><div><span class="w-kicker">COMANDANTE</span><h2>${esc(data.player.name)}</h2><p>@${esc(data.player.username)}</p>${profile?'<small>Desde '+new Date(profile.player.createdAt).toLocaleDateString('pt-BR')+'</small>':''}</div></section>
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
  function troopsScreen(){
    return `<div class="w-heading"><div><h1>Suas tropas</h1><p>Conheça seu exército. Escolha o que evoluir.</p></div></div><div class="w-training-note"><strong>EVOLUÇÃO INDIVIDUAL</strong><p>Cada tipo possui seu próprio nível, de 1 a 10. Cada evolução acrescenta ${data.progression?.powerStep||10} pontos de força apenas ao tipo escolhido.</p><small>As melhorias valem nas próximas batalhas. As disputas em andamento mantêm os níveis de entrada.</small></div>
      ${!data.player?'<button class="w-banner" data-action="account">ENTRE PARA SALVAR E EVOLUIR SUAS TROPAS ›</button>':''}
      <div class="w-troop-list">${(data.troops||[]).map(t=>`<article class="w-troop-card"><div class="w-troop-heading"><div class="w-troop-illustration ${t.id}">${troopIcon(t.id)}</div><div><span class="w-kicker">${esc(t.category)}</span><h2>${esc(t.name)}</h2><span class="w-troop-level">NÍVEL ${t.level} / 10</span></div></div><p>${esc(t.description)}</p><div class="w-troop-metrics"><div><small>FORÇA</small><b>${Math.round(t.power*100)}%</b></div><div><small>DANO POR DISPARO</small><b>${stat(t.damage)}</b></div><div><small>${t.speed?'VELOCIDADE RELATIVA':'ALCANCE EM HEXÁGONOS'}</small><b>${t.speed?Math.round(t.speed/42*100)+'%':stat(t.range)}</b></div><div><small>INTERVALO DE TIROS</small><b>${stat(t.interval)} s</b></div></div><p class="w-troop-tip"><strong>Origem:</strong> ${esc(t.base)}<br>${esc(t.tip)}</p><button class="w-cta" data-troop="${t.id}">${!data.player?'VER EVOLUÇÃO':t.nextCost?'EVOLUIR · '+money(t.nextCost)+' 🪙':'NÍVEL MÁXIMO'}</button></article>`).join('')}</div><p class="w-detail">Velocidade relativa ao tanque. O dano representa tropas retiradas por disparo; capturas também consideram a força da guarnição. Canhões e bombardeiro evoluem seus disparos fixos. As tropas enviadas dessas posições usam o nível dos tanques.</p>`;
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
    if (!data) {
      root.innerHTML = `<header class="w-top"><div class="w-brand">DOMINATION<small>MUNDO ABERTO</small></div></header><div class="w-empty">${esc(error || 'Conectando ao mundo…')}${error ? '<br><button class="w-textbtn" data-action="refresh">TENTAR NOVAMENTE</button><br><button class="w-textbtn" data-action="classic">MODO CLÁSSICO ›</button>' : ''}</div>`; return;
    }
    root.innerHTML = `<header class="w-top"><div class="w-brand">DOMINATION<small>MUNDO ABERTO</small></div><div><button class="w-account" data-action="account">${data.player ? esc(data.player.name) : 'ENTRAR'}</button><span class="w-online">MUNDO COMPARTILHADO</span></div></header>
      ${data.wallet?'<button class="w-wallet" data-action="wallet" aria-label="Carteira e regras de moedas"><span>🪙 <strong>'+money(data.wallet.available)+'</strong><small> DISPONÍVEIS</small></span><span>'+money(data.wallet.reserved)+' reservadas · +'+money(data.wallet.productionPerDay)+'/dia ›</span></button>':''}
      ${data.army?'<button class="w-army-card" data-action="troops" aria-label="Tropas e evolução individual"><span><strong>SEU EXÉRCITO</strong><small>5 tipos · níveis individuais</small></span><b>VER TROPAS ›</b></button>':''}
      <div class="w-breadcrumb">BRASIL <span>›</span> NORDESTE <span>›</span> <span>SERGIPE</span></div>
      <nav class="w-tabs" aria-label="Navegação do mundo" role="tablist">${[['territories', 'TERRITÓRIOS'], ['troops','TROPAS'], ['profile','PERFIL'], ['received','ATAQUES'], ['ranking', 'RANKING'], ['history', 'HISTÓRICO']].map(([key, label]) => `<button role="tab" data-tab="${key}" aria-selected="${tab === key}">${label}${key==='received'&&data.receivedAttacks?.length?'<span class="w-tab-count">'+data.receivedAttacks.length+'</span>':''}</button>`).join('')}</nav>
      ${error ? '<div class="w-error" role="alert">' + esc(error) + '</div>' : ''}
      ${tab==='territories'&&data.receivedAttacks?.length?'<button class="w-banner w-received-banner" data-action="received">⚔ '+data.receivedAttacks.length+' ataques sofridos · Ver lista e responder ›</button>':''}
      ${tab === 'territories' ? map() : tab==='troops'?troopsScreen():tab==='profile'?playerProfile():tab==='received'?'<div class="w-heading"><div><h1>Ataques sofridos</h1><p>Seus últimos 20 ataques, do mais recente ao mais antigo.</p></div></div>'+receivedList():tab === 'ranking' ? ranking() : history()}
      <footer class="w-footer"><p><span class="w-sync">● Conquistas salvas online</span><br>Cada área pode trocar de comandante.</p><button class="w-textbtn" data-action="classic">MODO CLÁSSICO ›</button></footer>`;
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
  function modal(html) { if (dialog.open) dialog.close(); dialog.innerHTML = html; dialog.showModal(); }
  function showArmy(kind=selectedTroop,message='',failed=false){
    selectedTroop=kind;
    const troop=(data.troops||[]).find(t=>t.id===kind),army=data.army?.troops?.[kind];
    if(!troop)return;
    const costs=data.progression.upgradeCosts;
    modal(`<div class="w-troop-modal-art">${troopIcon(kind)}</div><h2>${esc(troop.name)} · Nível ${troop.level}</h2><p>${esc(troop.description)}</p><div class="w-army-next">${troop.nextPower?'<strong>Nível '+troop.level+' → '+(troop.level+1)+'</strong><p>Força: '+Math.round(troop.power*100)+'% → '+Math.round(troop.nextPower*100)+'%<br>Dano: '+stat(troop.damage)+' → '+stat(troop.nextDamage)+' por disparo<br>Custo: '+money(troop.nextCost)+' moedas</p>':'<strong>Este tipo atingiu o nível máximo.</strong>'}</div><p>Esta compra evolui apenas <strong>${esc(troop.name)}</strong>. A melhoria vale nas próximas batalhas. As moedas reservadas para disputas continuam protegidas.</p>${data.wallet?'<p>Disponíveis: '+money(data.wallet.available)+' moedas · Reservadas: '+money(data.wallet.reserved)+'</p>':''}${army?.reason?'<p class="w-form-error">'+esc(army.reason)+'</p>':''}${message?'<p class="'+(failed?'w-form-error':'w-upgrade-success')+'" role="status">'+esc(message)+'</p>':''}${!data.player?'<button class="w-cta" data-dialog="login">ENTRAR PARA EVOLUIR</button>':'<button class="w-cta" data-dialog="upgrade-army" '+(!army?.canUpgrade||upgrading?'disabled':'')+'>'+(upgrading?'EVOLUINDO…':army.nextCost?'EVOLUIR POR '+money(army.nextCost)+' MOEDAS':'NÍVEL MÁXIMO')+'</button>'}<details class="w-upgrade-details"><summary>Ver níveis e custos deste tipo</summary><table><thead><tr><th>Nível</th><th>Força</th><th>Custo</th></tr></thead><tbody>${costs.slice(1).map((cost,i)=>'<tr class="'+(i+1===troop.level?'current':'')+'"><td>'+(i+1)+'</td><td>'+(100+i*data.progression.powerStep)+'%</td><td>'+(cost?money(cost):'Inicial')+'</td></tr>').join('')}</tbody></table></details><button class="w-textbtn" data-dialog="close">VOLTAR ÀS TROPAS</button>`);
  }
  async function upgradeArmy(){
    const kind=selectedTroop,army=data?.army?.troops?.[kind];
    if(upgrading||!army?.canUpgrade)return;
    const level=army.level;
    if(upgradeRequest?.expectedLevel!==level||upgradeRequest?.troopKind!==kind)upgradeRequest={troopKind:kind,expectedLevel:level,requestId:crypto.randomUUID()};
    upgrading=true;showArmy(kind);
    try{const result=await post('/api/world/army/upgrade',upgradeRequest);if(result.army)data.army=result.army;if(result.wallet)data.wallet={...data.wallet,...result.wallet};syncTroopViews();await refresh(true);upgradeRequest=null;upgrading=false;showArmy(kind,'Melhoria confirmada! '+troopNames[kind]+' evoluiu para as próximas batalhas.');}
    catch(e){await refresh(true);upgrading=false;if(data?.army?.troops?.[kind]?.level>level){upgradeRequest=null;showArmy(kind,'Seu novo nível já foi confirmado.');}else showArmy(kind,e.message,true);}
  }
  function syncTroopViews(){
    data.troops=(data.troops||[]).map(t=>{const view=data.army?.troops?.[t.id];return view?{...t,...view,damage:view.power,nextDamage:view.nextPower}:t;});
  }
  function showWallet(){
    if(!data?.wallet)return;
    const wallet=data.wallet,rules=data.economy,labels={production:'Produção das áreas',battle_loot:'Saque da batalha',cpu_reward:'Primeira conquista da CPU',cpu_loss:'Derrota para a CPU',army_upgrade:'Evolução do exército'};
    const rewards=(data.areas||[]).map(a=>a.first_capture_reward||rules.cpuReward),minReward=Math.min(rules.cpuReward,...rewards),maxReward=Math.max(rules.cpuReward,...rewards),rewardText=minReward===maxReward?money(minReward):'de '+money(minReward)+' a '+money(maxReward);
    modal(`<h2>Sua carteira</h2><div class="w-wallet-summary"><strong>🪙 ${money(wallet.balance)} moedas</strong><p>${money(wallet.available)} disponíveis · ${money(wallet.reserved)} reservadas<br>Produção das suas áreas: ${money(wallet.productionPerDay)} por dia</p></div><p>Cada área produz ${money(rules.productionPerDay)} moedas por dia, proporcional ao tempo de posse, inclusive offline.</p><p>Você pode atacar, defender ou entrar como invasor com qualquer saldo, inclusive zero. Sem saldo disponível na entrada, não ganha nem perde moedas nessa batalha, incluindo o bônus da CPU. Reservamos 40% do saldo disponível na entrada, arredondado para baixo. O vencedor recebe de cada perdedor 40% do menor saldo entre os dois. O restante da reserva é liberado.</p><p>A primeira conquista de uma área da CPU rende ${rewardText} moedas, conforme a resistência da guarnição. Perder para a CPU desconta a reserva. Todos os valores são inteiros. Sem moedas, você ainda pode conquistar a área e iniciar sua produção diária.</p><p>Desistir conta como derrota. Uma queda curta permite reconectar; uma interrupção do servidor libera as reservas sem saque.</p><h3>Últimas movimentações concluídas</h3><div class="w-coin-ledger">${wallet.entries.length?wallet.entries.map(entry=>`<div><span>${labels[entry.kind]||'Movimentação'}<small>${entry.kind==='production'?'Produção acumulada':entry.kind==='army_upgrade'?(troopNames[entry.troop_kind]||'Treinamento geral')+' · Nível '+entry.upgrade_level:esc(entry.area_name)} · ${new Date(entry.created_at).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</small></span><b class="${entry.amount<0?'negative':''}">${entry.amount>0?'+':''}${money(entry.amount)}</b></div>`).join(''):'<p>Saldo inicial: '+money(rules.initialCoins)+' moedas. As próximas batalhas aparecerão aqui.</p>'}</div><button class="w-cta" data-dialog="close">VOLTAR AO MAPA</button>`);
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
    const reward=economicResult?'<p class="w-result-coins '+(change<0?'negative':'')+'">🪙 '+(change>0?'+':'')+money(change)+' moedas</p><p>A reserva foi liberada.'+(win&&conquered?' Sua nova área produz '+money(data?.economy?.productionPerDay||1000)+' moedas por dia.':'')+'</p>':'';
    modal(`<div class="w-result"><div class="w-result-icon">${win?'⚑':'◇'}</div><h2>${title}</h2><p><strong>${esc(areaName)}</strong></p><p>${message}</p>${reward}<button class="w-cta" data-dialog="close">VOLTAR AO MAPA</button></div>`);
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
  root.addEventListener('click', async event => {
    const mapArea=event.target.closest('[data-map-area]');if(mapArea?.dataset.mapArea){selected=mapArea.dataset.mapArea;tab='territories';render();return;}
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    if (button.dataset.area) { selected = button.dataset.area; tab = 'territories'; render(); return; }
    if (button.dataset.tab) { navigate(button.dataset.tab); return; }
    if(button.dataset.troop){showArmy(button.dataset.troop);return;}
    if(button.dataset.profilePage){loadProfile(Number(button.dataset.profilePage));return;}
    if(receivedAction(button))return;
    const action = button.dataset.action;
    if (action === 'refresh') refresh(true);
    if(action==='preview-map')showMapPreview();
    if(action==='wallet')showWallet();
    if(action==='army'||action==='troops')navigate('troops');
    if(action==='profile-refresh')loadProfile(profile?.pagination.page||1);
    if(action==='logout-confirm')modal('<h2>Sair da conta?</h2><p>Use seu usuário e senha para retornar às suas conquistas.</p><button class="w-cta" data-dialog="logout">SAIR DA CONTA</button><button class="w-textbtn" data-dialog="close">CONTINUAR NO JOGO</button>');
    if(action==='received')showReceived();
    if (action === 'attack') attack();
    if(action==='defend')defend(data.areas.find(a=>a.id===selected)?.battle_id);
    if (action === 'resume') resume();
    if (action === 'classic') { bridge.classic(); }
    if (action === 'account') {
      if (!data?.player) authForm();
      else navigate('profile');
    }
  });
  dialog.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button) return;
    if(button.disabled)return;
    if(receivedAction(button))return;
    const action = button.dataset.dialog;
    if (action === 'close') dialog.close();
    if (action === 'register') authForm(true);
    if (action === 'login') authForm(false);
    if(action==='upgrade-army')await upgradeArmy();
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

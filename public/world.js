/* Combat runs in the attacker's browser worker. The server relays inputs and saves validated results. */
(() => {
  'use strict';
  const root = document.querySelector('#worldRoot'), dialog = document.querySelector('#worldDialog');
  const bridge = window.DOMINATION_WORLD_BRIDGE;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const geography=window.DOMINATION_SERGIPE_MAP,position=geography.positions,shapes=geography.regions;
  let data = null, selected = 'se-litoral-sul', tab = 'territories', lastDigest = '', error = '', busy = false;
  let events = null, current = null, reconnecting = false;
  let socket=null,socketPlayer=null,socketReady=false,retryTimer=null,retryDelay=1000,requestId=0,refreshTimer=null,switchingDefense=false;
  const pending=new Map(),threats=new Map(),watchedThreats=new Map();let alertDigest='';
  let reviewOnReturn=true;
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
        <p class="w-owner">${area.owner_id ? 'Comandante: <strong>' + esc(area.owner_name) + '</strong>' : 'Sob controle da <strong>guarnição da CPU</strong>'}</p>
        <div class="w-def"><span>Ocupação inicial da defesa</span><b>≈ ${Math.round((area.owner_id ? .5 : area.cpu_share) * 100)}% do mapa</b></div>
        <button class="w-cta" data-action="${canDefend?'defend':'attack'}" ${busy || (mine&&!canDefend) ? 'disabled' : ''}>${busy ? 'PREPARANDO…' : action}</button>
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
      <div class="w-breadcrumb">BRASIL <span>›</span> NORDESTE <span>›</span> <span>SERGIPE</span></div>
      <nav class="w-tabs" aria-label="Navegação do mundo" role="tablist">${[['territories', 'TERRITÓRIOS'], ['received','ATAQUES'], ['ranking', 'RANKING'], ['history', 'HISTÓRICO']].map(([key, label]) => `<button role="tab" data-tab="${key}" aria-selected="${tab === key}">${label}${key==='received'&&data.receivedAttacks?.length?'<span class="w-tab-count">'+data.receivedAttacks.length+'</span>':''}</button>`).join('')}</nav>
      ${error ? '<div class="w-error" role="alert">' + esc(error) + '</div>' : ''}
      ${tab==='territories'&&data.receivedAttacks?.length?'<button class="w-banner w-received-banner" data-action="received">⚔ '+data.receivedAttacks.length+' ataques sofridos · Ver lista e responder ›</button>':''}
      ${tab === 'territories' ? map() : tab==='received'?'<div class="w-heading"><div><h1>Ataques sofridos</h1><p>Seus últimos 20 ataques, do mais recente ao mais antigo.</p></div></div>'+receivedList():tab === 'ranking' ? ranking() : history()}
      <footer class="w-footer"><p><span class="w-sync">● Conquistas salvas online</span><br>Cada área pode trocar de comandante.</p><button class="w-textbtn" data-action="classic">MODO CLÁSSICO ›</button></footer>`;
  }
  async function refresh(force = false) {
    try {
      const hadError = !!error;
      const next = await api('/api/world'); const digest = JSON.stringify(next);
      data = next; error = '';ensureSocket();syncThreats();
      if (force || hadError || digest !== lastDigest) { lastDigest = digest; render(); }
      reviewReceived();
    } catch (e) { error = e.message; render(); }
  }
  function modal(html) { if (dialog.open) dialog.close(); dialog.innerHTML = html; dialog.showModal(); }
  function renderBattlePanel(){
    if(!current){battlePanel.innerHTML='';panelDigest='';return;}
    const me=current.playerOwner??1,sites=current.joinableSites||[],eliminated=me>0&&Array.isArray(current.snapshot.activeOwners)&&!current.snapshot.activeOwners.includes(me)&&!current.snapshot.over;
    const digest=JSON.stringify({me,sites,canJoin:current.canJoin,joinState:current.joinState,joinError:current.joinError,eliminated,busy});
    if(digest===panelDigest)return;panelDigest=digest;
    const selected=battlePanel.querySelector('select')?.value;
    const kind={P:'Garagem',G:'Garagem',H:'Heliporto',B:'Botes',A:'Canhão'};
    if(me===0){
      const pending=current.joinState==='pending';
      battlePanel.innerHTML=`<strong>ESPECTADOR · BATALHA EM ANDAMENTO</strong>${current.joinError?'<p class="w-join-error">'+esc(current.joinError)+'</p>':''}${pending?'<p>Aguardando a confirmação da sua entrada…</p>':current.canJoin&&sites.length?`<p>Escolha uma base neutra para entrar com 25 tropas.</p><div class="w-join-controls"><select id="worldJoinSite" aria-label="Base neutra para entrar"><option value="" disabled selected>Escolha uma base livre</option>${sites.map(site=>`<option value="${site.id}">Base ${site.id+1} · ${kind[site.kind]||'Base'}</option>`).join('')}</select><button data-battle-action="join" ${busy?'disabled':''}>ENTRAR</button></div>`:'<p>'+(current.joinState==='left'?'Você saiu desta disputa e pode acompanhar o restante.':sites.length?'Os quatro exércitos já estão ocupados.':'Não há base neutra disponível. Você pode continuar assistindo.')+'</p>'}`;
      if(selected&&sites.some(site=>String(site.id)===selected))battlePanel.querySelector('select').value=selected;
    }else battlePanel.innerHTML=eliminated?'<strong>SEU EXÉRCITO FOI ELIMINADO</strong><p>Acompanhe a disputa ou volte ao mapa.</p><button data-battle-action="leave">VOLTAR AO MAPA</button>':'';
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
    if (!current) return;
    const areaName = final.areaName || current.areaName,defending=current.playerOwner===2,me=current.playerOwner??1;
    stopStream(); refresh(true);
    const conquered=final.status==='won',win=me>0&&(final.winnerOwner!=null?final.winnerOwner===me:defending?!conquered:conquered);
    const title=me===0?'Batalha encerrada':win?(defending?'Defesa concluída!':'Território conquistado!'):defending&&conquered?'Território perdido':'Batalha encerrada';
    const message=conquered?(win?'A área agora está sob seu comando. A conquista foi salva.':esc(final.winnerName||'Um comandante rival')+' conquistou a área.'):
      final.status==='expired'||final.status==='interrupted'?'A batalha foi interrompida. A área manteve seu proprietário.':'A defesa manteve o território. O resultado foi salvo no mundo compartilhado.';
    modal(`<div class="w-result"><div class="w-result-icon">${win?'⚑':'◇'}</div><h2>${title}</h2><p><strong>${esc(areaName)}</strong></p><p>${message}</p><button class="w-cta" data-dialog="close">VOLTAR AO MAPA</button></div>`);
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
    finally { busy = false; }
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
      modal('<h2>Sair da batalha?</h2><p>Você abandona seu exército. Se houver outros participantes, a batalha continua entre eles.</p><div class="w-dialog-buttons"><button class="w-cta" data-dialog="close">CONTINUAR BATALHA</button><button class="w-textbtn" data-dialog="surrender">SAIR DA DISPUTA</button></div><p class="w-form-error" role="alert"></p>');
    }
  };
  root.addEventListener('click', async event => {
    const mapArea=event.target.closest('[data-map-area]');if(mapArea?.dataset.mapArea){selected=mapArea.dataset.mapArea;tab='territories';render();return;}
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    if (button.dataset.area) { selected = button.dataset.area; tab = 'territories'; render(); return; }
    if (button.dataset.tab) { tab = button.dataset.tab;if(tab==='received')markReceivedSeen(); render(); return; }
    if(receivedAction(button))return;
    const action = button.dataset.action;
    if (action === 'refresh') refresh(true);
    if(action==='received')showReceived();
    if (action === 'attack') attack();
    if(action==='defend')defend(data.areas.find(a=>a.id===selected)?.battle_id);
    if (action === 'resume') resume();
    if (action === 'classic') { bridge.classic(); }
    if (action === 'account') {
      if (!data?.player) authForm();
      else modal(`<h2>${esc(data.player.name)}</h2><p>Seu usuário: <strong>${esc(data.player.username)}</strong><br>Use essa conta para acessar suas conquistas em outro aparelho.</p><div class="w-dialog-buttons"><button class="w-cta" data-dialog="close">VOLTAR AO MAPA</button><button class="w-textbtn" data-dialog="logout">SAIR DA CONTA</button></div>`);
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

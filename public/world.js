/* Shared-world UI. Ownership, commands and battle outcomes are server-controlled. */
(() => {
  'use strict';
  const root = document.querySelector('#worldRoot'), dialog = document.querySelector('#worldDialog');
  const bridge = window.DOMINATION_WORLD_BRIDGE;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const position = { 'se-litoral-sul': [47, 77], 'se-agreste': [40, 49], 'se-alto-sertao': [36, 24], 'se-sao-francisco': [68, 25], 'se-aracaju': [72, 59] };
  const shapes = {
    'se-alto-sertao': '100,28 164,22 196,64 184,116 139,137 81,108 69,67',
    'se-sao-francisco': '164,22 246,30 303,70 322,118 269,144 228,121 184,116 196,64',
    'se-agreste': '81,108 139,137 184,116 228,121 246,177 212,214 159,222 107,200 79,159',
    'se-aracaju': '269,144 322,118 344,163 328,218 294,256 254,249 212,214 246,177 228,121',
    'se-litoral-sul': '107,200 159,222 212,214 254,249 294,256 258,295 211,320 155,300 127,258'
  };
  let data = null, selected = 'se-litoral-sul', tab = 'territories', lastDigest = '', error = '', busy = false;
  let events = null, current = null, reconnecting = false;
  let socket=null,socketPlayer=null,socketReady=false,retryTimer=null,retryDelay=1000,requestId=0,refreshTimer=null,switchingDefense=false;
  const pending=new Map(),threats=new Map();
  const alerts=document.createElement('aside');alerts.id='worldAlerts';alerts.setAttribute('aria-live','polite');document.body.append(alerts);
  async function api(path, options = {}) {
    const {timeout=15000,...request}=options,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    try{
      const response = await fetch(path, { credentials: 'same-origin', ...request,signal:controller.signal,
        headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Não foi possível conectar. Tente novamente.');
      return result;
    }catch(e){if(e.name==='AbortError')throw new Error('A conexão demorou. Confira o estado da batalha antes de repetir a ordem.');throw e;}
    finally{clearTimeout(timer);}
  }
  const post = (path, body = {}) => api(path, { method: 'POST', body: JSON.stringify(body) });
  const swords=()=>'<svg class="w-swords" viewBox="0 0 32 32" aria-hidden="true"><g class="sword-left"><path d="M5 3l5 2 14 16-4 4L5 8z"/><path d="M17 24l7-7m-1 7 5 5"/></g><g class="sword-right"><path d="M27 3l-5 2L8 21l4 4L27 8z"/><path d="M15 24l-7-7m1 7-5 5"/></g></svg>';
  function renderAlerts(){
    const visible=[...threats.values()].filter(t=>current?.id!==t.battleId);
    alerts.innerHTML=visible.map(t=>`<button class="w-attack-alert" data-defense="${esc(t.battleId)}">${swords()}<span><strong>Sua área está sob ataque!</strong><small>${esc(t.areaName)} · ${esc(t.attackerName||'Comandante rival')}</small><b>ASSUMIR DEFESA ›</b></span></button>`).join('');
  }
  function syncThreats(){
    threats.clear();
    for(const area of data?.areas||[])if(area.battle_id&&area.owner_id===data.player?.id)threats.set(area.battle_id,{battleId:area.battle_id,areaId:area.id,areaName:area.name,attackerName:area.attacker_name});
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
      if(message.type==='ack'){
        const entry=pending.get(message.requestId);if(!entry||entry.battleId!==message.battleId)return;
        clearTimeout(entry.timer);pending.delete(message.requestId);entry.resolve(message);return;
      }
      if(message.type==='under_attack'){threats.set(message.battleId,message);renderAlerts();}
      if(message.type==='world_changed'){
        clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>refresh(),250);
      }
    };
    ws.onerror=()=>{};
    ws.onclose=()=>{
      if(socket!==ws)return;socketReady=false;socket=null;
      for(const [id,entry]of pending){clearTimeout(entry.timer);entry.resolve({accepted:false,message:'A conexão caiu antes da confirmação. Confira suas tropas antes de repetir.'});pending.delete(id);}
      if(data?.player?.id===playerId){retryTimer=setTimeout(()=>ensureSocket(),retryDelay);retryDelay=Math.min(8000,retryDelay*2);}
    };
  }
  function socketCommand(battleId,command){
    return new Promise(resolve=>{
      const id=++requestId;
      const timer=setTimeout(()=>{pending.delete(id);resolve({accepted:false,message:'A confirmação demorou. Confira suas tropas antes de repetir a ordem.'});},3500);
      pending.set(id,{battleId,timer,resolve});
      try{socket.send(JSON.stringify({type:'command',battleId,requestId:id,command}));}
      catch{clearTimeout(timer);pending.delete(id);resolve({accepted:false,message:'Conexão interrompida. Aguarde a reconexão.'});}
    });
  }
  function areaClass(area) { return area.owner_id ? (area.owner_id === data?.player?.id ? 'mine' : 'rival') : ''; }
  function map() {
    const owned = data.areas.filter(a => a.owner_id && a.owner_id === data.player?.id).length;
    const area = data.areas.find(a => a.id === selected) || data.areas[0];
    selected = area.id;
    const mine = area.owner_id && area.owner_id === data.player?.id;
    const ownBattle = area.battle_id && area.attacker_id === data.player?.id;
    const canDefend=mine&&area.battle_id;
    const action = canDefend?'ASSUMIR DEFESA':ownBattle ? 'RETOMAR BATALHA' : area.battle_id ? 'ÁREA EM DISPUTA' : mine ? 'SOB SEU COMANDO' : 'ATACAR ÁREA';
    return `<div class="w-heading"><div><h1>Sergipe</h1><p>Cinco áreas. Uma conquista compartilhada.</p></div><div class="w-total">${owned}<span style="font-size:16px;color:#a9b5c8"> / 5</span><small>SUAS ÁREAS</small></div></div>
      ${owned === 5 ? '<div class="w-claim">Sergipe está sob seu comando. Defenda suas cinco áreas!</div>' : ''}
      ${data.activeBattle && !ownBattle ? '<button class="w-banner" data-action="resume">Você tem uma batalha em andamento. Toque para retomar.</button>' : ''}
      <div class="w-map" aria-label="Mapa de campanha de Sergipe">
        <svg viewBox="0 0 400 330" aria-hidden="true"><defs><filter id="islandShadow"><feDropShadow dx="0" dy="8" stdDeviation="0" flood-color="#599dbb" flood-opacity=".6"/></filter></defs>
          <path class="sea-line" d="M18 77h23m-12 5h25M337 48h30m-16 5h24M23 239h39m-28 6h20M303 300h45m-35 5h26"/>
          <g filter="url(#islandShadow)">${data.areas.map(a => `<polygon class="w-territory ${areaClass(a)} ${a.id === selected ? 'chosen' : ''}" points="${shapes[a.id]}"/>`).join('')}</g>
        </svg>
        ${data.areas.map(a => `<button class="w-node ${areaClass(a)} ${a.id === selected ? 'selected' : ''} ${a.battle_id?'in-battle':''}" style="left:${position[a.id][0]}%;top:${position[a.id][1]}%" data-area="${a.id}" aria-label="${esc(a.name)}${a.battle_id?' — em batalha':''}" aria-pressed="${a.id === selected}"><span>${a.ordinal}${a.battle_id ? '<b class="w-busy">'+swords()+'</b>' : ''}</span><em>${a.id === 'se-sao-francisco' ? 'SÃO FRANCISCO' : a.id === 'se-aracaju' ? 'CAPITAL' : esc(a.name.toUpperCase())}</em></button>`).join('')}
        <small class="w-map-note">MAPA DE CAMPANHA · 5 SETORES</small>
      </div>
      <div class="w-legend"><span><i style="background:#b4afce"></i>CPU</span><span><i style="background:#78aef0"></i>Suas áreas</span><span><i style="background:#ee9a8e"></i>Rivais</span></div>
      <section class="w-area" aria-label="Área selecionada"><div class="w-area-top"><div><div class="w-kicker">ÁREA ${String(area.ordinal).padStart(2, '0')}</div><h2>${esc(area.name)}</h2></div><span class="w-status ${mine ? 'mine' : ''}">${area.battle_id ? 'EM DISPUTA' : mine ? 'CONQUISTADA' : area.owner_id ? 'OCUPADA' : 'NÃO CONQUISTADA'}</span></div>
        <p class="w-owner">${area.owner_id ? 'Comandante: <strong>' + esc(area.owner_name) + '</strong>' : 'Sob controle da <strong>guarnição da CPU</strong>'}</p>
        <div class="w-def"><span>Ocupação inicial da defesa</span><b>≈ ${Math.round((area.owner_id ? .5 : area.cpu_share) * 100)}% do mapa</b></div>
        <button class="w-cta" data-action="${canDefend?'defend':'attack'}" ${busy || (mine&&!canDefend) || (area.battle_id && !ownBattle&&!canDefend) ? 'disabled' : ''}>${busy ? 'PREPARANDO…' : action}</button>
        <p class="w-detail">${esc(area.description)} ${area.owner_id ? area.defender_controlled?'O proprietário está comandando a defesa online.':'A CPU defende até o proprietário assumir o controle.' : 'Vença a guarnição para registrar a área em seu nome.'}</p>
      </section>
      <p class="w-detail" style="margin:0;text-align:center">Vence quem eliminar o inimigo. O bombardeiro é uma vantagem disputável.</p>`;
  }
  function ranking() {
    return `<div class="w-heading"><div><h1>Comandantes</h1><p>Quem controla Sergipe agora.</p></div></div><div class="w-list">${data.ranking.length ? data.ranking.map((p, i) => `<div class="w-list-row"><span class="place">${i + 1}</span><div><strong>${esc(p.name)}</strong><small>${p.id === data.player?.id ? 'Você · ' : ''}Áreas sob comando</small></div><span class="score">${p.areas}</span></div>`).join('') : '<div class="w-empty">O mapa ainda está sob controle da CPU.<br>Seja o primeiro comandante a conquistar uma área.</div>'}</div>`;
  }
  const statusLabel = { won: 'conquistou', lost: 'teve o ataque contido em', abandoned: 'desistiu do ataque a', interrupted: 'teve o ataque interrompido em', expired: 'teve o ataque encerrado em' };
  function history() {
    return `<div class="w-heading"><div><h1>Últimas disputas</h1><p>Conquistas e defesas do mundo compartilhado.</p></div></div><div class="w-list">${data.history.length ? data.history.map(h => `<div class="w-list-row"><span class="place">${h.status === 'won' ? '⚑' : '◇'}</span><div><strong>${esc(h.area_name)}</strong><small>${esc(h.attacker_name)} ${statusLabel[h.status] || 'atacou'} ${esc(h.area_name)}.</small><small>${h.status === 'won' ? 'Novo proprietário registrado' : 'Propriedade preservada'} · ${new Date(h.finished_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></div></div>`).join('') : '<div class="w-empty">As batalhas concluídas aparecerão aqui.<br>Cada conquista faz parte da história de Sergipe.</div>'}</div>`;
  }
  function render() {
    if (!data) {
      root.innerHTML = `<header class="w-top"><div class="w-brand">DOMINATION<small>MUNDO ABERTO</small></div></header><div class="w-empty">${esc(error || 'Conectando ao mundo…')}${error ? '<br><button class="w-textbtn" data-action="refresh">TENTAR NOVAMENTE</button><br><button class="w-textbtn" data-action="classic">MODO CLÁSSICO ›</button>' : ''}</div>`; return;
    }
    root.innerHTML = `<header class="w-top"><div class="w-brand">DOMINATION<small>MUNDO ABERTO</small></div><div><button class="w-account" data-action="account">${data.player ? esc(data.player.name) : 'ENTRAR'}</button><span class="w-online">MUNDO COMPARTILHADO</span></div></header>
      <div class="w-breadcrumb">BRASIL <span>›</span> NORDESTE <span>›</span> <span>SERGIPE</span></div>
      <nav class="w-tabs" aria-label="Navegação do mundo" role="tablist">${[['territories', 'TERRITÓRIOS'], ['ranking', 'RANKING'], ['history', 'HISTÓRICO']].map(([key, label]) => `<button role="tab" data-tab="${key}" aria-selected="${tab === key}">${label}</button>`).join('')}</nav>
      ${error ? '<div class="w-error" role="alert">' + esc(error) + '</div>' : ''}
      ${tab === 'territories' ? map() : tab === 'ranking' ? ranking() : history()}
      <footer class="w-footer"><p><span class="w-sync">● Conquistas salvas online</span><br>Cada área pode trocar de comandante.</p><button class="w-textbtn" data-action="classic">MODO CLÁSSICO ›</button></footer>`;
  }
  async function refresh(force = false) {
    try {
      const hadError = !!error;
      const next = await api('/api/world'); const digest = JSON.stringify(next);
      data = next; error = '';ensureSocket();syncThreats();
      if (force || hadError || digest !== lastDigest) { lastDigest = digest; render(); }
    } catch (e) { error = e.message; render(); }
  }
  function modal(html) { if (dialog.open) dialog.close(); dialog.innerHTML = html; dialog.showModal(); }
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
    Object.assign(current,record);bridge.apply(record.snapshot);bridge.control(record.defenderControlled);
  }
  async function sendCommand(command) {
    if (!current) return;
    const id=current.id;
    bridge.commandStatus('Enviando ordem…');
    try {
      const result=socketReady?await socketCommand(id,command):await api('/api/world/battles/'+id+'/commands',{method:'POST',body:JSON.stringify(command),timeout:6000});
      if(current?.id!==id)return;
      if(!result.accepted){bridge.commandStatus(result.message||'A ordem não pôde ser executada.',true);return;}
      if(result.record)applyRecord(result.record);
      bridge.commandStatus('Ordem confirmada');
    }
    catch (e) {
      if(current?.id===id)bridge.commandStatus(e.message,true);
    }
  }
  function stopStream() { events?.close(); events = null; current = null; bridge.stop();renderAlerts(); }
  function battleResult(final) {
    if (!current) return;
    const areaName = final.areaName || current.areaName,defending=current.playerOwner===2;
    stopStream(); refresh(true);
    const conquered=final.status==='won',win=defending?!conquered:conquered;
    const title=defending?(conquered?'Território perdido':'Defesa concluída!'):(conquered?'Território conquistado!':final.status==='lost'?'Ataque contido':'Batalha encerrada');
    const message=defending?(conquered?'O atacante conquistou a área. Prepare suas tropas para reconquistá-la.':'Sua área foi preservada. A defesa e o resultado foram salvos no mundo compartilhado.'):
      conquered?'A área agora está sob seu comando. A conquista foi salva no mundo compartilhado.':final.reason==='time'?'O tempo de ataque terminou. A defesa manteve a área.':final.reason==='disconnected'?'A conexão ficou ausente por mais de 30 segundos. A propriedade da área foi preservada.':final.status==='expired'||final.status==='interrupted'?'A batalha foi encerrada. A área manteve seu proprietário.':'A defesa manteve o território. Reorganize sua estratégia e tente novamente.';
    modal(`<div class="w-result"><div class="w-result-icon">${win?'⚑':'◇'}</div><h2>${title}</h2><p><strong>${esc(areaName)}</strong></p><p>${message}</p><button class="w-cta" data-dialog="close">VOLTAR AO MAPA</button></div>`);
  }
  function connectBattle(record) {
    if (record.final || record.status !== 'active') { current = record; battleResult(record.final || { status: record.status }); return; }
    events?.close(); current = record;renderAlerts();
    const area = data?.areas.find(a => a.id === record.areaId);
    bridge.start({ ...record, ordinal: area?.ordinal || 1 }, sendCommand);
    events = new EventSource('/api/world/battles/' + record.id + '/events');
    events.addEventListener('state', event => applyRecord(JSON.parse(event.data)));
    events.addEventListener('result', event => { if (!switchingDefense&&current?.id === record.id) battleResult(JSON.parse(event.data)); });
    events.addEventListener('saving', () => { document.querySelector('#hint').textContent = 'Salvando o resultado…'; document.querySelector('#hint').style.opacity = 1; });
    events.onerror = async () => {
      if (!current || reconnecting) return;
      document.querySelector('#hint').textContent = 'Reconectando… mantenha esta janela aberta.'; document.querySelector('#hint').style.opacity = 1;
      reconnecting = true;
      try { const latest = await api('/api/world/battles/' + record.id); if (latest.final && current?.id === record.id) battleResult(latest.final); }
      catch (e) { if (current) document.querySelector('#hint').textContent = e.message; }
      finally { reconnecting = false; }
    };
  }
  async function attack() {
    if (busy || !data) return;
    if (!data.player) { authForm(false); return; }
    const area = data.areas.find(a => a.id === selected);
    if (area.battle_id && area.attacker_id === data.player.id) return resume(area.battle_id);
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
    show() { if(current?.playerOwner===2){this.requestSurrender();return;}bridge.show(); refresh(true); },
    requestSurrender() {
      if(current?.playerOwner===2){
        modal('<h2>Devolver a defesa à CPU?</h2><p>A CPU continuará defendendo sua área. Isso não encerra a batalha nem entrega o território.</p><div class="w-dialog-buttons"><button class="w-cta" data-dialog="close">CONTINUAR DEFENDENDO</button><button class="w-textbtn" data-dialog="release-defense">VOLTAR AO MAPA</button></div><p class="w-form-error" role="alert"></p>');return;
      }
      modal('<h2>Sair da batalha?</h2><p>Desistir encerra seu ataque. A área mantém o proprietário atual.</p><div class="w-dialog-buttons"><button class="w-cta" data-dialog="close">CONTINUAR BATALHA</button><button class="w-textbtn" data-dialog="surrender">DESISTIR DO ATAQUE</button></div><p class="w-form-error" role="alert"></p>');
    }
  };
  root.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    if (button.dataset.area) { selected = button.dataset.area; tab = 'territories'; render(); return; }
    if (button.dataset.tab) { tab = button.dataset.tab; render(); return; }
    const action = button.dataset.action;
    if (action === 'refresh') refresh(true);
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
    const action = button.dataset.dialog;
    if (action === 'close') dialog.close();
    if (action === 'register') authForm(true);
    if (action === 'login') authForm(false);
    if(action==='switch-defense')defend(button.dataset.battle,true);
    if(action==='release-defense'&&current?.playerOwner===2){
      button.disabled=true;
      try{await post('/api/world/battles/'+current.id+'/release');stopStream();dialog.close();await refresh(true);}
      catch(e){dialog.querySelector('.w-form-error').textContent=e.message;button.disabled=false;}
    }
    if (action === 'logout') { try { await post('/api/auth/logout');stopStream(); dialog.close(); await refresh(true); } catch (e) { error = e.message; dialog.close(); render(); } }
    if (action === 'surrender' && current) {
      button.disabled = true;
      try { const result = await post('/api/world/battles/' + current.id + '/surrender'); if (current) battleResult(result); }
      catch (e) { const target = dialog.querySelector('.w-form-error'); if (target) target.textContent = e.message; button.disabled = false; }
    }
  });
  dialog.addEventListener('submit', async event => {
    if (event.target.id !== 'worldAuthForm') return;
    event.preventDefault(); const form = event.target, submit = form.querySelector('[type=submit]');
    const input = Object.fromEntries(new FormData(form)); submit.disabled = true;
    try { await post('/api/auth/' + (form.dataset.register === 'true' ? 'register' : 'login'), input); dialog.close(); await refresh(true); }
    catch (e) { form.querySelector('.w-form-error').textContent = e.message; submit.disabled = false; }
  });
  document.querySelector('#backToWorld').addEventListener('click', () => window.WorldApp.show());
  alerts.addEventListener('click',event=>{const button=event.target.closest('[data-defense]');if(button)defend(button.dataset.defense);});
  document.addEventListener('visibilitychange', () => { if (!document.hidden) {refresh(true);ensureSocket();} });
  setInterval(()=>{if(socketReady)socket.send(JSON.stringify({type:'ping'}));},20000);
  setInterval(() => { if (!document.hidden) refresh(); }, 12000);
  refresh(true);
})();

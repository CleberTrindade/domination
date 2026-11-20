# Domination — Mundo Aberto

Primeira versão do mundo compartilhado, desenvolvida na branch `mundo-aberto`.
A publicação e o banco de produção da `main` permanecem independentes.

## O que está disponível

- Brasil → Nordeste → Sergipe, com cinco áreas de campanha: Litoral Sul, Agreste,
  Alto Sertão, Vale do São Francisco e Aracaju · Capital. São setores de jogo,
  recortados no contorno real de Sergipe do IBGE; as áreas internas são setores
  de jogo, não divisões administrativas oficiais.
- Cadastro com usuário, nome de comandante e senha; sessões persistidas no banco
  permitem entrar na mesma conta em outro aparelho.
- Primeiro ataque: a CPU ocupa aproximadamente 30%–40% dos hexágonos.
- Ataque a uma área conquistada: a defesa começa com aproximadamente metade dos
  hexágonos. A CPU comanda até o proprietário clicar em **Assumir defesa**.
- O proprietário online recebe um aviso de ataque. A área em disputa exibe duas
  espadas animadas no mapa; o aviso também aparece ao entrar durante uma batalha.
- Os demais jogadores online recebem um aviso público e podem **Assistir batalha**.
  Espectadores acompanham o campo sem controlar tropas nem receber o registro
  privado da simulação.
- Havendo vaga, o espectador escolhe uma base neutra numerada no campo ou na lista
  e clica em **Entrar**. Começa com 25 tropas em um exército próprio. São até quatro
  exércitos: atacante, defensor/CPU e dois invasores. Entradas na mesma base são
  confirmadas uma por vez; quem sair não pode reaparecer nessa disputa.
- Ao assumir a defesa, o proprietário controla suas bases, tropas e paraquedas
  no mesmo combate do atacante. Seus exércitos aparecem em azul na sua tela.
  Ao sair ou perder a conexão, a CPU retoma a defesa sem entregar o território.
- A aba **Ataques** lista os últimos 20 ataques sofridos, incluindo os que estão
  em andamento. Ao entrar ou retornar, novidades abrem a lista com agressor,
  área, data e resultado. A visualização é lembrada por conta neste navegador.
- **Revanche** tenta recuperar a área perdida que ainda pertence ao agressor.
  **Contra-atacar** permite escolher outra área dele. Ataques em andamento têm
  a opção **Defender agora**. Se o agressor não tem áreas, não há alvo disponível.
- O bombardeiro central começa com o proprietário da área (lado defensor); em
  áreas ainda livres, começa com a CPU. Ele entra no cálculo dos 30%–40% ou 50%
  de ocupação inicial e continua podendo ser capturado durante o combate.
- Uma posição inicial para o atacante; as outras posições começam neutras.
- Vitória por eliminação das bases **e** tropas inimigas. O bombardeiro continua
  disputável e não é uma condição de vitória.
- Ao vencer, o servidor transfere a área para o comandante vencedor, inclusive
  um invasor que entrou depois, numa transação do banco.
  Derrota, desistência, interrupção e tempo esgotado preservam o proprietário.
- Ranking por áreas sob comando e histórico das últimas doze disputas.
- Carteira de moedas com saldo disponível, reservado, produção diária e extrato.
  Saldo inicial de 1.000 moedas; mínimo de 100 disponíveis para atacar ou entrar
  como invasor. Defender não exige saldo mínimo.
- Uma batalha ativa por área e uma participação ativa por jogador. As demais áreas ficam livres.
- O combate começa no navegador do atacante, em um Web Worker. O servidor
  repassa ordens, reserva a área em memória e grava a batalha somente no final,
  depois de validar o resultado.
- Batalhas usam o mapa e a arte clássicos; as cinco áreas variam a ocupação inicial
  e o comportamento da defesa. Melhorias e moedas locais não afetam esse modo.
- O modo clássico (campanha, CPU, duelo local e salas online) continua disponível.

## Simulação, reconexão e encerramento

O navegador atacante calcula produção, movimento, CPU, combate e vitória em passos
de 1/30 s. Ordens locais respondem sem aguardar a viagem ao servidor. O Web Worker
separa essa simulação da interface. Defensor, invasores e espectadores acompanham
posições retransmitidas a cada 100 ms. Participantes enviam ordens ao navegador
que hospeda a batalha. A CPU pausa ao
assumir a defesa e volta quando o proprietário sai.

Não há INSERT de batalha no início nem checkpoints no banco durante o combate.
Reservas, ordens autorizadas e o último estado para reconexão ficam em RAM.
Ao finalizar, o servidor reproduz uma vez a sequência autorizada com o mesmo
motor e semente, verifica a vitória e grava resultado e propriedade na mesma
transação. Vencedor e participantes são determinados pela reprodução das entradas
autorizadas; o registro de participantes também é gravado somente no final.
Informar apenas `won` ou inventar tropas no pacote não conquista áreas.
Contas, sessões e consultas ao mapa continuam usando PostgreSQL.

Ordens e avisos usam WebSocket autenticado, com HTTP como alternativa. A sessão
é reutilizada por até um minuto e revalidada depois desse prazo. Cada ordem tem
um identificador: retransmiti-la após perder a confirmação não envia as tropas
novamente. O cliente descarta posições antigas que cheguem tarde.

Recarregar a página permite **Retomar batalha** a partir do último estado em RAM,
normalmente com até 500 ms de diferença. Após três segundos sem estados do navegador
responsável, outro participante conectado pode assumir a simulação. Espectadores
não assumem essa função. Sem um participante disponível por mais de 30 segundos,
a disputa termina preservando o proprietário. O combate tem
seis minutos mais a contagem inicial. Voltar ao mapa mantém a simulação ativa.
Trocar um ataque próprio por uma defesa pede a saída da participação atual.
Sair de uma disputa com invasores libera suas bases e mantém os demais no combate;
se necessário, o navegador responsável também é trocado.

Como partidas ativas não são persistidas, reinícios/publicações do servidor
interrompem as batalhas em andamento e preservam o proprietário. Elas não têm
mais recuperação por checkpoint no banco. Batalhas ativas da arquitetura
anterior também são encerradas sem transferir áreas na migração.

## Moedas, produção e saque

- Cada área produz **1.000 moedas a cada 24 horas**, proporcionalmente ao tempo de
  posse, inclusive offline. A produção começa na conquista. Para contas e áreas
  anteriores à economia, começa na aplicação da migração 005, sem retroatividade.
- A primeira conquista de cada área da CPU dá **300 moedas** ao vencedor. Áreas
  já conquistadas antes da migração não pagam esse bônus novamente.
- Na entrada, **40% do saldo disponível** de cada participante ficam reservados
  em RAM. O defensor recebe uma reserva automática no início do ataque, mesmo
  offline. Reservas de outras disputas são descontadas do saldo disponível; uma
  mesma moeda não pode ser comprometida em duas batalhas deste servidor.
- O saldo de referência fica fixo para aquela entrada. Produção ou saques de
  outras disputas posteriores não aumentam o valor em risco nessa batalha.
- O vencedor recebe de **cada perdedor** o menor valor entre as duas reservas:
  `40% × min(saldo disponível do vencedor na entrada, saldo disponível do perdedor na entrada)`.
  Com 1.000 contra 5.000, o saque é de 400 em qualquer direção. Vencendo outros
  três exércitos com pelo menos 1.000 cada, o jogador recebe 1.200 no total.
- O vencedor também conquista a área. Perdedores não pagam uns aos outros. O
  restante de cada reserva é liberado. Desistir não evita a perda para o vencedor;
  sair com outros invasores mantém a reserva vinculada ao encerramento da disputa.
- A CPU não possui carteira saqueável. Quando vence, as reservas dos derrotados
  são descontadas e registradas como `cpu_loss`. Quando perde, paga somente o
  bônus de primeira conquista; eventuais perdedores humanos seguem o saque normal.
- Um defensor com zero moedas pode comandar sua defesa e manter ou perder a área.
  Sua reserva é zero: não perde moedas e não recebe saque dos adversários caso vença.
- Interrupção/reinício do servidor e expiração por versão da área liberam reservas
  sem saque ou bônus. Desconexão sem recuperação por mais de 30 segundos conta
  como abandono, preservando a área e aplicando a derrota.

Os valores ficam em `server/economy.js` (`RULES`); a migração 005 concede o saldo
inicial às contas existentes. Moedas são persistidas em centésimos inteiros;
frações menores da produção são carregadas para o próximo cálculo. Consultar a
carteira apenas projeta a produção, sem gravar nem exigir cron. Antes de trocar
o proprietário, a transação final credita a produção acumulada ao dono anterior
e inicia o período do novo dono, preservando a divisão correta do rendimento.

No encerramento, saldo, extrato (`world_coin_ledger`), resultado e propriedade são
atualizados na mesma transação. Uma falha desfaz tudo; repetir a conclusão não
duplica moedas. Comandos, posições e checkpoints continuam sem consultas ou
gravações adicionais por causa da economia. Reservas ativas não sobrevivem a um
reinício, que também interrompe a disputa sem cobrança.

## Mapa de Sergipe

O contorno vem da [API de Malhas do IBGE, UF 28](https://servicodados.ibge.gov.br/api/v3/malhas/estados/28?formato=application%2Fvnd.geo%2Bjson&qualidade=intermediaria).
O GeoJSON original está em `shared/geography/sergipe-ibge.geojson`. O SVG usa
projeção geográfica com correção de longitude pela latitude média, preservando
o formato e a orientação norte. Cinco setores são recortados por esse contorno.
O arquivo estático `public/sergipe-map.js` evita consultas ao IBGE ao abrir o jogo.

## Estrutura

```
public/index.html       arte e renderização clássicos, ponte para o modo mundo
public/world.js         mapa de campanha, conta, ranking e cliente de batalha
public/world-motion.js  interpolação visual das tropas, separada do combate
public/world.css        interface responsiva do mundo aberto
public/battle-worker.js simulação local fora da thread da interface
public/sergipe-map.js   contorno IBGE e setores de campanha
shared/browser-battle.js simulação local e validação final reproduzível
shared/map.json         definição do mapa usada pelo simulador do servidor
server/index.js         HTTP, arquivos estáticos, saúde e salas WebSocket clássicas
server/auth.js          senhas scrypt e sessões com cookie HttpOnly
server/world-service.js entrada do serviço de mundo
server/browser-world.js API, reservas em RAM, retransmissão e gravação final
server/browser-assets.js entrega do mesmo motor para o navegador
server/battle-engine.js movimento, produção, combate, bombardeiros e CPU
server/economy.js       carteira, reservas, produção offline e saque final
server/database.js      aplicação transacional de migrações versionadas
server/migrations/      esquema e áreas iniciais
```

## Configuração e execução

Variáveis exclusivamente no servidor:

- `DATABASE_URL`: conexão PostgreSQL da branch Neon **mundo-aberto**. Na aplicação
  publicada, use TLS com `sslmode=verify-full`. Não usar a conexão de `production`.
- `NODE_ENV=production` no Render.
- `APP_ENV=mundo-aberto`.
- `PORT`: definida pelo Render; localmente, o padrão é `10000`.

```
npm ci
npm start
```

A aplicação atende o site e as partidas no mesmo endereço. O WebSocket clássico
usa a origem da página; este ambiente nunca conecta às salas da `main`.
O comando de início aplica as migrações pendentes antes de receber requisições.
As migrações iniciais são aditivas e não redefinem contas nem áreas conquistadas.
A `DATABASE_URL` permanece nas variáveis do Render, sem credenciais no repositório.

Sem banco, o modo clássico abre localmente, mas o mundo compartilhado retorna 503.

## Verificação

```
npm run check
npm test
```

Os testes usam PostgreSQL em WASM (PGlite), isolado em memória. Cobrem autenticação,
reservas concorrentes, comandos inválidos, vitória confirmada pelo servidor,
transferência e preservação de propriedade, reconexão em memória, abandono,
ocupação por hexágonos e regressão das salas clássicas. Exercitam o worker real,
ordens idempotentes e a ausência de gravações no início e durante o combate.
Incluem avisos públicos, espectador sem controle, entradas concorrentes, limite de
quatro exércitos, troca do navegador responsável e conquista por um invasor tardio.
Também cobrem saque simétrico e com quatro exércitos, saldo zero, produção offline
e suas frações, reservas em ataques simultâneos, recompensa única da CPU,
desistência, interrupção, repetição da conclusão e rollback de falha no extrato.
Os testes não acessam o banco de jogadores do Render/Neon.

- `GET /api/health`: conexão com PostgreSQL e prontidão do mundo.
- `GET /api/world`: mapa, proprietários, ranking e histórico.
- `POST /api/auth/register`, `/login`, `/logout`: conta e sessão.
- `POST /api/world/areas/:id/attack`: reserva e início de batalha.
- `GET /api/world/battles/:id`: estado ou resultado, com visualização para jogadores autenticados.
- `GET /api/world/battles/:id/events`: fluxo de estados e resultado.
- `POST /api/world/battles/:id/commands`: ordens validadas no servidor.
- `POST /api/world/battles/:id/surrender`: desistência.
- `POST /api/world/battles/:id/join`: solicitar entrada pela base neutra `{site}`.
- `POST /api/world/battles/:id/leave`: sair da participação e permitir que os demais continuem.
- `POST /api/world/battles/:id/defend`: assumir defesa (somente proprietário).
- `POST /api/world/battles/:id/release`: devolver defesa à CPU.
- `POST /api/world/battles/:id/relay`: repassar estado do navegador, apenas em RAM.
- `POST /api/world/battles/:id/complete`: validar e salvar a batalha encerrada.
- `POST /api/world/battles/:id/retaliate`: iniciar revanche ou contra-ataque;
  somente o defensor original pode responder, e o alvo deve pertencer a um dos
  adversários registrados nessa disputa.
  O vínculo com a batalha original é gravado em `retaliation_of` apenas no final.
- `WS /api/world/socket`: avisos de ataque e ordens com confirmação imediata.

## Publicação

- Render: projeto **Domination - Mundo Aberto**, ambiente **Desenvolvimento**.
- Serviço Node: `domination-mundo-aberto`, plano gratuito, região Ohio.
- Código: branch `mundo-aberto`, publicação automática em commits.
- Build: `npm ci`; início: `npm start`; saúde: `/api/health`.
- Neon: projeto `domination`, branch `mundo-aberto`.
- `render.yaml` registra a configuração do serviço; não há Blueprint ativo.

## Próximas etapas

Mais estados/países, novas topologias de campo e recuperação de senha por e-mail
são evoluções futuras.
O servidor de desenvolvimento opera em uma única instância; várias instâncias
exigirão coordenação das simulações e do fluxo de estados entre processos.

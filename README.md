# Domination — Mundo Aberto

Primeira versão do mundo compartilhado, desenvolvida na branch `mundo-aberto`.
A publicação e o banco de produção da `main` permanecem independentes.

## O que está disponível

- Brasil → Nordeste → Sergipe, com cinco áreas de campanha: Litoral Sul, Agreste,
  Alto Sertão, Vale do São Francisco e Aracaju · Capital. São setores de jogo,
  representados por um mapa ilustrativo; não são divisões administrativas oficiais.
- Cadastro com usuário, nome de comandante e senha; sessões persistidas no banco
  permitem entrar na mesma conta em outro aparelho.
- Primeiro ataque: a CPU ocupa aproximadamente 30%–40% dos hexágonos.
- Ataque a uma área conquistada: a CPU defende em nome do proprietário com
  aproximadamente metade dos hexágonos. Essa defesa automática vale também
  quando o proprietário está online nesta primeira versão.
- Uma posição inicial para o atacante; as outras posições começam neutras.
- Vitória por eliminação das bases **e** tropas inimigas. O bombardeiro continua
  disputável e não é uma condição de vitória.
- Ao vencer, o servidor transfere a área para o atacante numa transação do banco.
  Derrota, desistência, interrupção e tempo esgotado preservam o proprietário.
- Ranking por áreas sob comando e histórico das últimas doze disputas.
- Uma batalha ativa por área e uma por atacante. As demais áreas ficam livres.
- O combate acontece no servidor. O cliente só envia ordens de envio de tropas e
  de paraquedas; não pode informar o vencedor ou a quantidade de tropas.
- Batalhas usam o mapa e a arte clássicos; as cinco áreas variam a ocupação inicial
  e o comportamento da defesa. Melhorias e moedas locais não afetam esse modo.
- O modo clássico (campanha, CPU, duelo local e salas online) continua disponível.

## Reconexão e encerramento

O navegador recebe o estado por SSE e pode se reconectar à mesma batalha. Após
recarregar a página, use **Retomar batalha**. A simulação continua durante uma
queda breve. Mais de 30 segundos sem um cliente conectado encerra o ataque.
O limite de cada combate é de seis minutos, além da contagem inicial.

As reservas são renovadas no banco e expiram em até 90 segundos após uma falha
abrupta do processo. O desligamento normal encerra os ataques como interrompidos.
A simulação em andamento é mantida em memória; ela não é retomada após reiniciar
o servidor. A propriedade conquistada, as contas e o histórico ficam no banco.

## Estrutura

```
public/index.html       arte e renderização clássicos, ponte para o modo mundo
public/world.js         mapa de campanha, conta, ranking e cliente de batalha
public/world.css        interface responsiva do mundo aberto
shared/map.json         definição do mapa usada pelo simulador do servidor
server/index.js         HTTP, arquivos estáticos, saúde e salas WebSocket clássicas
server/auth.js          senhas scrypt e sessões com cookie HttpOnly
server/world-service.js API, reservas, controle das batalhas e persistência
server/battle-engine.js movimento, produção, combate, bombardeiros e CPU
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
transferência e preservação de propriedade, reconexão, expiração, reinício,
migrações idempotentes, ocupação por hexágonos e regressão das salas clássicas.
Os testes não acessam o banco de jogadores do Render/Neon.

- `GET /api/health`: conexão com PostgreSQL e prontidão do mundo.
- `GET /api/world`: mapa, proprietários, ranking e histórico.
- `POST /api/auth/register`, `/login`, `/logout`: conta e sessão.
- `POST /api/world/areas/:id/attack`: reserva e início de batalha.
- `GET /api/world/battles/:id`: estado ou resultado da própria batalha.
- `GET /api/world/battles/:id/events`: fluxo de estados e resultado.
- `POST /api/world/battles/:id/commands`: ordens validadas no servidor.
- `POST /api/world/battles/:id/surrender`: desistência.

## Publicação

- Render: projeto **Domination - Mundo Aberto**, ambiente **Desenvolvimento**.
- Serviço Node: `domination-mundo-aberto`, plano gratuito, região Ohio.
- Código: branch `mundo-aberto`, publicação automática em commits.
- Build: `npm ci`; início: `npm start`; saúde: `/api/health`.
- Neon: projeto `domination`, branch `mundo-aberto`.
- `render.yaml` registra a configuração do serviço; não há Blueprint ativo.

## Próximas etapas

Esta primeira versão tem defesa automática pela CPU. Defesa humana em tempo real,
mais estados/países, novas topologias de campo, recuperação de senha por e-mail e
continuidade da simulação após reiniciar o servidor são evoluções futuras.
O servidor de desenvolvimento opera em uma única instância; várias instâncias
exigirão coordenação das simulações e do fluxo de estados entre processos.

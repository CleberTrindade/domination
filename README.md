# Domination — Mundo Aberto

Primeira versão do mundo compartilhado, desenvolvida na branch `mundo-aberto`.
A publicação e o banco de produção da `main` permanecem independentes.

## O que está disponível

- Brasil → Nordeste → Sergipe, com cinco áreas de mundo aberto: Litoral Sul, Agreste,
  Alto Sertão, Vale do São Francisco e Aracaju · Capital. São setores de jogo,
  recortados no contorno real de Sergipe do IBGE; as áreas internas são setores
  de jogo, não divisões administrativas oficiais.
- Cadastro com usuário, nome de comandante e senha; sessões persistidas no banco
  permitem entrar na mesma conta em outro aparelho.
- Toda defesa começa com **três bases mais o bombardeiro central**: quartel,
  garagem e base de botes próximos ao quartel, mais a central. São quatro posições
  e aproximadamente **23,5% dos hexágonos**. As demais posições começam neutras.
- Em área livre, a guarnição usa **80% da força do atacante**. Em área conquistada,
  preserva o nível real do dono. A CPU comanda até o proprietário assumir a defesa.
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
  áreas ainda livres, começa com a CPU. Ele faz parte das quatro posições da
  defesa e continua podendo ser capturado durante o combate.
- O atacante começa com uma posição e 38 tropas; a defesa tem 56–72 tropas
  distribuídas nas quatro posições, conforme o perfil do setor.
- Vitória por eliminação das bases **e** tropas inimigas. O bombardeiro continua
  disputável e não é uma condição de vitória.
- Ao vencer, o servidor transfere a área para o comandante vencedor, inclusive
  um invasor que entrou depois, numa transação do banco.
  Derrota, desistência, interrupção e tempo esgotado preservam o proprietário.
- Ranking por áreas sob comando e histórico das últimas doze disputas.
- Carteira de moedas com saldo disponível, reservado, produção diária e extrato.
  Saldo inicial de 1.000 moedas; ataques, invasões e defesas permitidos com
  qualquer saldo, inclusive zero. Valores sempre em moedas inteiras.
- Uma batalha ativa por área e uma participação ativa por jogador. As demais áreas ficam livres.
- O combate começa no navegador do atacante, em um Web Worker. O servidor
  repassa ordens, reserva a área em memória e grava a batalha somente no final,
  depois de validar o resultado.
- Batalhas usam o mapa e a arte clássicos; cada setor mantém um perfil de
  guarnição e resistência. Treinamento online evolui de 1 a 10; recursos do modo
  clássico permanecem separados.
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

- Ataques, defesas e entradas como invasor são permitidos com **qualquer saldo,
  inclusive zero**. Sem saldo disponível na entrada, o participante não ganha nem
  perde moedas por saque, mas recebe o bônus da primeira conquista da CPU. Pode
  conquistar a área e receber sua produção diária a partir da conquista.
- Saldos, reservas, saques e novos lançamentos usam **moedas inteiras**.
  A reserva é `floor(40% × saldo disponível)`: com 80 moedas, reserva 32;
  com 1 ou 2 moedas, reserva zero. Saldo positivo mantém a mesma regra de saque.

- A produção diária por jogador tem faixas: primeiras 5 áreas, **1.000 cada**;
  áreas 6–10, **500 cada**; demais, **250 cada**, com teto de **10.000/dia**.
  O crédito é proporcional ao tempo de posse, inclusive offline. A produção começa na conquista. Para contas e áreas
  anteriores à economia, começa na aplicação da migração 005, sem retroatividade.
- A primeira conquista da CPU rende **250 moedas** no Litoral Sul/Agreste,
  **450** no Alto Sertão e **600** no São Francisco/Capital. O bônus fica fora do teto de produção diária. O bônus independe do saldo de entrada e é único por área; conquistas anteriores
  não recebem novamente. O saque de jogadores é independente desse bônus.
- Na entrada, **40% do saldo disponível** de cada participante ficam reservados
  em RAM. O defensor recebe uma reserva automática no início do ataque, mesmo
  offline. Reservas de outras disputas são descontadas do saldo disponível; uma
  mesma moeda não pode ser comprometida em duas batalhas deste servidor.
- O saldo de referência fica fixo para aquela entrada. Produção ou saques de
  outras disputas posteriores não aumentam o valor em risco nessa batalha.
- O vencedor recebe de **cada perdedor** o menor valor entre as duas reservas:
  `floor(40% × min(saldo disponível do vencedor na entrada, saldo disponível do perdedor na entrada))`.
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
inicial às contas existentes. A escala de armazenamento de centésimos é mantida por compatibilidade, com
saldos e lançamentos novos sempre em múltiplos de 100. A migração 009 converte
frações de saldo existentes em crédito pendente de produção e preserva o histórico
original de lançamentos. A renda só libera uma moeda quando ela fica completa;
o restante é carregado para o próximo cálculo, inclusive após trocar de dono. Consultar a
carteira apenas projeta a produção, sem gravar nem exigir cron. Antes de trocar
o proprietário, a transação final credita a produção acumulada ao dono anterior
e inicia o período do novo dono, preservando a divisão correta do rendimento.

No encerramento, saldo, extrato (`world_coin_ledger`), resultado e propriedade são
atualizados na mesma transação. Uma falha desfaz tudo; repetir a conclusão não
duplica moedas. Comandos, posições e checkpoints continuam sem consultas ou
gravações adicionais por causa da economia. Reservas ativas não sobrevivem a um
reinício, que também interrompe a disputa sem cobrança.

## Campos de batalha por área

Cada área usa um mapa fixo e versionado, definido em `shared/battle-maps.js`.
A tela de território mostra uma miniatura e **Ver campo de batalha** com a
formação inicial e a legenda das bases.

| Área | Mapa | Mudança estratégica |
| --- | --- | --- |
| Litoral Sul | Arquipélago costeiro (`coast-v1`) | Sete ilhas; expansão entre ilhas exige botes ou helicópteros. |
| Agreste | Encruzilhadas (`crossroads-v1`) | Rede terrestre com corredores externos e caminho central. |
| Alto Sertão | Passagens (`passes-v1`) | Gargalo terrestre entre as duas metades; transporte permite flanquear. |
| São Francisco | Travessias (`river-v1`) | Rio com duas travessias e central em uma ilha. |
| Aracaju | Cerco à Capital (`citadel-v1`) | Anel terrestre e fortaleza central isolada. |

Os cinco mapas possuem 17 posições, quatro quartéis para permitir até quatro
exércitos, e defesa inicial de três bases mais o bombardeiro. A ocupação em
hexágonos varia com o terreno. A CPU continua em 80% do poder individual do
atacante nas áreas livres; áreas ocupadas usam os níveis do proprietário.
Nenhuma área exige conquistar outra antes.

`config.mapId` é fixado na entrada e preservado na recuperação, migração de host
e reprodução final. Servidor, worker, prévia, seleção de alvos e renderização
compartilham a mesma geometria. A configuração sem `mapId` continua usando o
mapa clássico original, preservando a leitura dos resultados anteriores.
Os identificadores são versionados: alterações futuras na geometria devem
criar outro ID para manter partidas antigas reproduzíveis.

Validação: conectividade terrestre, gargalos, formação, entradas, checkpoint,
reprodução e equivalência dos assets de navegador/servidor estão nos testes.
`node experiments/battle-maps/smoke.js 12` executa 60 partidas com CPU ativa e
um bot coordenado. No ensaio inicial o bot conquistou os cinco mapas em todos
os casos; isto verifica viabilidade, não estima a taxa de vitória de humanos.
O balanceamento será ajustado com as partidas reais.

## Perfil e tropas

A tela principal tem menu inferior fixo no estilo clássico: **Perfil, Tropas,
Batalha, Ataques e Menu**, com indicador de ataques e destaque da opção ativa.
**Menu** reúne ranking, histórico do mundo, carteira, conta e acesso ao modo
clássico. A barra fica oculta durante batalhas e a área rolável reserva espaço
para não cobrir o conteúdo. O nome no cabeçalho também abre o próprio perfil. O perfil mostra nome, usuário, data de criação, áreas atuais,
níveis individuais, vitórias, derrotas, desistências e histórico pessoal em
páginas de 20 partidas. Inclui ataques, defesas automáticas/online e invasores,
com resultado individual, participantes originais, vencedor, datas e moedas
líquidas da disputa (produção e compras ficam somente na carteira).
Partidas interrompidas/expiradas não entram na taxa de vitórias; desistências
entram como decisões sem vitória. Histórico legado sem roster usa os IDs do
atacante/defensor. A consulta exige a sessão do próprio jogador e é feita ao
abrir/atualizar o perfil, sem acrescentar leitura por comando de combate.

A tela Tropas apresenta uma coleção de cartas com ilustração, nível e progresso.
Selecionar uma carta revela **Detalhes**, no visual azul aprovado, com a ilustração
sem fundo acima da janela e duas abas acessíveis:

- **Carta**: descrição, base de origem e dica de estratégia.
- **Ataque**: dano por disparo, força, intervalo, velocidade/alcance, alvos e movimento.
  A tabela completa de preços fica recolhida nesta aba.

O rodapé permanece visível ao alternar as abas e ao rolar o conteúdo: mostra cartas
acumuladas/exigidas, nível atual/próximo e o botão **Melhorar** com custo em moedas.
Tipos bloqueados, nível máximo, falta de recursos e contas visitantes têm estados
próprios. As setas esquerda/direita e Home/End também alternam as abas.
**Melhorar** abre a confirmação; somente **Confirmar** envia a compra. Cancelar
retorna à aba anterior. Nível e custos são conferidos novamente antes do envio,
preservando a compra individual e a proteção contra duplicidade. A troca de abas
não chama a API nem toca o combate.

As ilustrações transparentes usadas apenas nos detalhes ficam nos WebPs versionados
`public/art/troop-heroes-initial-v1.webp`, `troop-heroes-expanded-v1.webp` e
`troop-hero-central-v1.webp`. Foram extraídas das pranchas aprovadas, sem legendas,
fundos ou plataformas, preservando o estilo e a transparência. Cada arquivo é um
atlas recortado por viewport SVG; é carregado ao abrir detalhes e servido com cache
imutável. Os sprites da batalha permanecem vetoriais e não carregam esses arquivos.

### Arte das unidades

Tanque, bote, helicóptero, canhão e bombardeiro central usam o conceito visual
3D na branch `mundo-aberto`. `public/troop-art.js` fornece modelos com cores de
exército, 32 direções de movimento, canhão giratório e seis bocas de disparo
na central. O helicóptero mantém o rotor e a oscilação animados. As casas de
produção e as regras de combate continuam com o comportamento existente.

A coleção e os detalhes usam recortes por viewport SVG das duas pranchas
aprovadas em `public/art/`, sem repetir seus textos de apresentação. Os PNGs
possuem nomes versionados e cache HTTP de um ano; uma alteração de imagem
exige novo nome. As imagens de apresentação não são carregadas pelo combate.
Os sprites do combate são rasterizados uma vez por tipo, cor e direção; o
pré-carregamento ocorre em lotes de quatro e a geometria é compartilhada
entre as cores. Não há geração de modelos a cada quadro nem consulta ao banco.
A expansão inclui seis tropas terrestres com bases próprias: batedor,
lança-foguetes, blindado pesado, antiaéreo, engenheiro e artilharia móvel.
Quartel, garagem, heliporto e base de botes usam modelos nativos mais detalhados:
quartel octogonal com posto de comando, hangares com portão blindado e veículo
na saída, heliporto com torre lateral e oficina naval com ventilador e rampa.
As seis bases especializadas mantêm esses detalhes e seus equipamentos próprios.
A versão `concept-bases-v2` identifica o desenho e também a chave de cache das
bases no canvas; `troop-art.js?v=bases-v2` força a seleção do recurso atualizado.
Os modelos são rasterizados uma vez por tipo e cor, sem trabalho novo por quadro.
A coleção permite alternar a visualização entre a tropa e sua base de origem.
As novas pranchas ficam em `public/art/*-expanded-v1.png` e
`public/art/bases-initial-v1.png`. As compras exigem cartas individuais e moedas,
com confirmação antes do gasto.

### Formações salvas e coleção

A tela Exército tem duas abas: **Formações** e **Todas as tropas**. Cada conta
pode guardar até 10 formações com nomes de até 32 caracteres, duplicar uma
formação e definir a ativa. Cada grupo aceita de um a três tipos terrestres
já desbloqueados; a primeira tropa equipa o quartel inicial. Botes,
helicópteros, canhões e bombardeiro continuam como apoio fixo do mapa.

As edições ficam em rascunho até **Salvar formação**. **Usar formação** (ou
**Salvar e usar**, quando há rascunhos) também altera a seleção ativa. Os
rascunhos permanecem ao alternar abas. As melhorias individuais continuam nos
detalhes de cada tropa, com confirmação de cartas e moedas.

A migração 012 mantém a formação já equipada como a primeira e acrescenta
`army_formations`, `active_formation_id` e `formation_revision` em
`world_players`. `POST /api/world/army/formations` recebe a lista, a ativa e
`expectedRevision`; uma transação com bloqueio da conta evita sobrescritas
entre dispositivos. Repetir o mesmo salvamento é idempotente. A rota antiga
`/army/loadout` permanece compatível e atualiza a formação ativa e sua revisão.
Trocar formações não custa moedas e só altera as próximas batalhas: os
exércitos dos participantes já em combate mantêm a formação de entrada.

### Comandante e formação terrestre

O comandante usa os níveis de tipos diferentes (sem contar a central) e um
contador de batalhas válidas. Os requisitos são cumulativos:

| Comandante | Desbloqueio | Treinamento mínimo | Batalhas |
|---|---|---|---:|
| 2 | Batedor | 2 tipos no nível 2 | 10 |
| 3 | Lança-foguetes | 3 tipos no nível 3 | 30 |
| 4 | Blindado pesado | 4 tipos no nível 4 | 60 |
| 5 | Antiaéreo | 5 tipos no nível 5 | 100 |
| 6 | Engenheiro | 6 tipos no nível 6 | 160 |
| 7 | Artilharia móvel | 7 tipos no nível 7 | 250 |

A migração 010 acrescenta `battles_completed` e `ground_loadout`. Resultados
verificados contam uma vez, na transação de encerramento, quando o participante
permanece pelo menos 30 segundos no combate sem desistir. A defesa precisa
estar sob controle humano por esse período. Partidas canceladas e defesas
inteiramente automáticas não contam. O histórico anterior compatível é
contabilizado pela migração, sem alterar resultados ou saldos.

`POST /api/world/army/loadout` salva de um a três tipos terrestres distintos,
validados pelo servidor. O primeiro equipa o quartel inicial. Os demais são
distribuídos deterministicamente pelos quartéis e garagens conquistados;
heliportos, botes, canhões e central mantêm suas especialidades. Capturar uma
base aplica a formação do novo dono, sem liberar tipos bloqueados. A formação
e os níveis ficam congelados no início ou na entrada como invasor, incluindo
a defesa offline. A CPU de área livre usa a formação do atacante com a força
individual reduzida já configurada. Os mapas continuam com 17 posições.

A configuração `troops-v3` habilita velocidade, resistência, cadência,
produção e vantagens contra alvos por tipo. Batedores são rápidos e frágeis;
foguetes enfrentam tanques/blindados; antiaéreos enfrentam helicópteros;
blindados resistem mais e são lentos. Engenheiros que chegam a bases aliadas
criam até 20 pontos de fortificação, consumidos antes da guarnição e desgastados
a 0,3 por segundo. Artilharia para a três hexágonos do alvo e atira a cada
1,3 segundo; o cerco não conquista à distância, exigindo chegada das tropas.

As regras são compartilhadas por `shared/troop-rules.js`, pelo worker do
navegador e pelo replay de validação. Checkpoints guardam formação, fortalezas,
cadência do cerco e tempo de participação; entradas tardias usam dados do
ticket autorizado. Configurações antigas continuam no comportamento anterior.
Nenhuma ordem de movimento consulta o banco. Os coeficientes iniciais precisam
de acompanhamento durante testes de jogadores, sem promessa de taxa de vitória.

## Evolução individual e parâmetros de teste

Contas novas possuem onze níveis independentes: tanque (`tanque`), bote
(`desliz`), helicóptero (`heli`), canhão (`canhao`), bombardeiro (`central`),
batedor (`batedor`), lança-foguetes (`foguetes`), blindado (`blindado`),
antiaéreo (`antiaereo`), engenheiro (`engenheiro`) e artilharia (`artilharia`).
Os cinco tipos originais ficam disponíveis no início; os seis novos são
liberados pelo comandante e sempre começam no nível 1, inclusive em contas
com treinamento anterior. Níveis e moedas já comprados são preservados.
A migração 008 preserva o treinamento geral já comprado como nível inicial de
**cada** tipo. A primeira compra individual materializa os cinco níveis em
`world_players.troop_levels`; `army_level` passa a representar o maior nível,
para compatibilidade e resumos. Compras futuras evoluem somente o tipo escolhido.
A mesma tabela de custos vale separadamente para cada tipo.
O poder cresce linearmente: `1 + 0,10 × (nível − 1)`, chegando a 190% no nível 10.
Produção por base, capacidade, velocidade e frequência de tiros mantêm as regras
anteriores. O multiplicador da tropa móvel afeta seus disparos e capturas contra o tipo
produzido pela posição alvo. Canhão/bombardeiro evoluem os disparos fixos; tropas
enviadas dessas posições usam o nível dos tanques. A IA considera o poder dos
tipos presentes ao escolher ataques.

| Nível alcançado | Força | Moedas | Cartas da tropa |
| --- | ---: | ---: | ---: |
| 1 | 100% | Inicial | 0 |
| 2 | 110% | 100 | 10 |
| 3 | 120% | 250 | 20 |
| 4 | 130% | 500 | 40 |
| 5 | 140% | 1.000 | 80 |
| 6 | 150% | 2.000 | 140 |
| 7 | 160% | 4.000 | 220 |
| 8 | 170% | 7.000 | 340 |
| 9 | 180% | 11.000 | 500 |
| 10 | 190% | 18.000 | 750 |

O custo acumulado por tipo é **43.850 moedas e 2.100 cartas**, partindo do nível 1.
As cartas são consumidas nas melhorias. Níveis e saldos anteriores são preservados;
a migração 011 credita primeiro a produção pendente pela taxa antiga. Não há concessão
retroativa de cartas nem cobrança pelas melhorias antigas.
A compra usa apenas moedas disponíveis e cartas do tipo selecionado, mantendo as
reservas de batalha. Ambos os recursos, nível, auditoria e extrato mudam na mesma
transação. `requestId` impede gastos duplicados; `expectedLevel` impede saltos.
Preços e saldos de cartas enviados pelo cliente não são aceitos como autoridade.

### Recompensas de cartas e objetivos diários

O menu **Recompensas diárias**, também acessível em Tropas, mostra os contadores,
objetivos e os cinco últimos pacotes recebidos. As recompensas são automáticas:

- Vitória: 10 cartas; derrota válida: 5; abandono: zero; teto de 60 cartas/dia por batalhas.
- Concluir 3 batalhas válidas: 20 cartas.
- Conquistar 5 bases inimigas: 20 cartas. Neutras não contam; a mesma base conta uma vez por batalha.
- Vencer uma batalha: 20 cartas.
- Total máximo: **120 cartas por dia**, com reinício à meia-noite de **America/Fortaleza**.

Cada carta é sorteada no servidor, com probabilidades iguais entre tipos elegíveis:
precisa estar desbloqueado e ainda não ter todas as cartas para alcançar o nível 10.
Não existe tropa preferida para recompensas. Cartas acumuladas são mantidas ao virar o
dia e gastar moedas não é necessário para tirar um tipo já completo do sorteio.
Se todos os tipos desbloqueados estiverem completos, novos pacotes não geram cartas.

Para cartas e objetivos, uma batalha deve terminar com resultado verificado, ter
pelo menos 30 segundos de participação ativa e uma ordem realmente executada.
Defesas automáticas, espectadores, deserções e encerramentos sem replay não recebem
cartas. Ganhar/perder é determinado por participante, incluindo defesa humana e invasores.
Só as primeiras **3 batalhas válidas/dia contra o mesmo grupo de adversários** contam;
contra a CPU o limite se aplica à mesma área. Isso não bloqueia novos ataques, saques
ou conquistas. Objetivos podem se sobrepor e dar cartas na mesma partida.

`world_players.troop_cards` guarda o estoque. `world_daily_rewards` guarda os limites
e objetivos por dia; `world_card_rewards` audita cada pacote com chave única por
batalha/jogador. Os dados de ordens e capturas vêm do replay do motor compartilhado,
nunca dos números declarados pelo navegador. Toda concessão faz parte da transação
do resultado; repetir o envio ou reiniciar o servidor não repete as cartas. Não há
consultas extras ao banco por comando durante a batalha.

A melhoria vale nas próximas disputas. Os níveis individuais do atacante e do dono
são fixados no início; invasores usam seus próprios níveis no momento de pedir
entrada. Nas áreas livres a CPU usa 80% do poder **de cada tipo** do atacante;
áreas ocupadas preservam os níveis individuais reais do dono. Uma
compra não altera exércitos já comprometidos. Checkpoints e migração do navegador
responsável preservam todos os perfis; a reprodução final usa a configuração e
as entradas autorizadas, incluindo o treinamento dos invasores.

As cinco áreas estão acessíveis sem sequência obrigatória. A formação usa o
quartel, duas bases próximas e a central, conforme o mapa; a configuração antiga `cpu_share` é mantida como dado
legado. `defense_share` na API informa a ocupação efetiva. As bases neutras seguem
a referência de força do atacante. O perfil do setor ainda define tropas por
posição, produção e intervalo de decisões da CPU. A entrada de um invasor mais
forte não recalcula a guarnição; isso faz parte dos próximos testes de equilíbrio.

A versão atual é **troops-v2**, sucedendo **army-v1**, com constantes em `server/progression.js`.
O objetivo de 60%–83% é uma meta de balanceamento, não uma taxa garantida. Nesta
publicação, o teste de quatro posições passa a valer em áreas livres e ocupadas;
o fator de 80% é exclusivo das livres. As estimativas anteriores não são taxas
reais de partidas humanas e os setores ainda precisarão de ajustes.

No encerramento, `world_battles.result.balance` registra versão, configuração,
ocupação inicial, níveis/forças e se o dono assumiu a defesa. A coluna
`world_battle_participants.army_level` guarda o maior nível de entrada; os cinco
perfis completos estão em `result.balance.armies` e na configuração do combate.
Esses registros permitem separar resultados contra CPU, defesa offline, dono
participante e invasores ao avaliar as partidas publicadas. Incrementar a versão
de balanceamento quando os parâmetros forem ajustados.

Os estudos em `experiments/troop-progression` usam uma cópia congelada do motor
anterior, em `reference-engine.js`, para continuar reproduzíveis após esta versão.

## Mapa de Sergipe

O contorno vem da [API de Malhas do IBGE, UF 28](https://servicodados.ibge.gov.br/api/v3/malhas/estados/28?formato=application%2Fvnd.geo%2Bjson&qualidade=intermediaria).
O GeoJSON original está em `shared/geography/sergipe-ibge.geojson`. O SVG usa
projeção geográfica com correção de longitude pela latitude média, preservando
o formato e a orientação norte. Cinco setores são recortados por esse contorno.
O arquivo estático `public/sergipe-map.js` evita consultas ao IBGE ao abrir o jogo.

## Avaliação de dificuldade por área

Após a primeira tentativa concluída de conquista, o jogador avalia de 1 a 5:
Muito fácil, Fácil, Normal, Difícil e Muito difícil. Cada conta tem uma pergunta
por área livre (`cpu`) e outra por área já dominada (`occupied`), tanto em vitória
quanto em derrota ou desistência. O contexto é o proprietário no início da
batalha, inclusive se estiver offline. Invasores participantes também avaliam;
defensores e espectadores não. Partidas interrompidas ou expiradas não contam.

A migração `013_difficulty_surveys.sql` cria `world_difficulty_surveys`, com
jogador, área, contexto, primeira batalha, lado, resultado, nota e datas. A
pergunta é criada na mesma transação do resultado, uma única vez por
`(player_id,area_id,context)`. A FK da batalha permite cruzar a avaliação com
configuração do mapa, níveis e resultado já gravados. Nenhum dado é gravado a
cada comando de combate.

`GET /api/world` inclui as perguntas pendentes da própria conta. A tela de
resultado antecede a enquete; se o jogador adiar, ela permanece no banco e
reaparece em um próximo acesso. `POST /api/world/difficulty-surveys/:id`, com
`{ "rating": 1 }` até 5, exige autenticação, valida a propriedade e salva a nota
uma única vez. Repetir a mesma resposta é seguro após perda de conexão;
tentativas de alterar uma resposta já enviada são rejeitadas.

## Registro de batalhas e amigos

O perfil e o menu abrem o **Registro de batalhas**, com abas Minhas partidas
(autenticada) e Mundo (pública), dez confrontos por página. Os cartões mostram
participantes, formação e níveis congelados na entrada, resultado, moedas e
cartas do jogador. Os detalhes incluem todos os invasores. Informação ausente
em registros antigos aparece como não registrada, sem inventar níveis ou ganhos.
`GET /api/world/history?scope=mine|world&page=1` entrega os registros paginados.

As novas partidas concluídas por simulação validada salvam um replay na mesma
transação do resultado (`world_battle_replays`, migração 014). O log contém
configuração, número de frames e ordens autorizadas com seus frames de execução.
`GET /api/world/replays/:id` exige login. A reprodução roda em um worker separado,
sem ordens, reservas, transferências ou novas recompensas; permite pausar,
reiniciar e velocidades 1×/2×/4×. Partidas antigas, interrompidas ou desistências
sem log completo têm Assistir desabilitado. Mudanças incompatíveis no motor
precisam atualizar `REPLAY_VERSION` em `server/battle-history.js`.

**Amigos**, no menu, oferece código público individual, busca por nome, usuário
ou código, copiar código e compartilhar o link `?invite=CODIGO`. WhatsApp e
compartilhamento nativo só são acionados pelo jogador. Links de convite não
autenticam ninguém e não aceitam amizade automaticamente: após entrar/criar a
conta, o destinatário busca o código e envia a solicitação para revisão.

`world_friendships` mantém um único par ordenado por jogadores, com remetente e
estado pendente/aceito. Somente o destinatário aceita ou recusa; o remetente pode
cancelar; ambos podem remover uma amizade aceita. A tela separa recebidos e
enviados, confirma a remoção e pagina a lista de amigos. Presença vem das
conexões WebSocket autenticadas e participação real em batalhas. Pings não
gravam no banco. O perfil público mostra comandante, estatísticas e áreas,
preservando carteira, cartas, credenciais e histórico pessoal.

APIs autenticadas: `GET /api/world/friends`, `GET /api/world/friends/search?q=...`,
`POST /api/world/friends/request` com `playerId`,
`POST /api/world/friends/:id/accept|reject|cancel|remove` e
`GET /api/world/friends/players/:id`. Contas e progresso são preservados pela
migração; alianças não fazem parte desta entrega.

## Comando operacional: reset de batalha

Quando o responsável pedir **“reset de batalha”**, executar este procedimento no
Mundo Aberto. Preservar contas, senhas, sessões, códigos/amizades e todas as
enquetes, inclusive suas notas, datas, resultado original e configuração da
partida. Zerar histórico, participantes, replays, saques/lançamentos, melhorias,
recompensas diárias, moedas, cartas, progresso de comandante e áreas dominadas.
Tropas voltam ao nível 1 e à formação inicial com tanque. Cada área retorna à
CPU, com bônus de primeira conquista disponível.

1. Conferir que a conexão é a branch Neon **mundo-aberto**, nunca `prod`.
2. Suspender o serviço Render `domination-mundo-aberto` e confirmar a suspensão.
   As batalhas ativas ficam em RAM; não executar o reset com o processo rodando.
3. Com `APP_ENV=mundo-aberto` e `DATABASE_URL` já configuradas, conferir a prévia:

   ```bash
   npm run reset:batalha
   ```

4. Executar o comando explicitamente:

   ```bash
   npm run reset:batalha -- --service-stopped --confirm "reset de batalha"
   ```

5. Conferir os totais zerados e a quantidade de enquetes preservadas, reativar o
   serviço e validar o mapa. Jogadores devem atualizar a página.

O comando fica em `scripts/reset-battles.js`, com SQL compartilhado/testado em
`server/maintenance/reset-battles.js`. Não existe endpoint público de reset.
Tudo é aplicado em uma transação com bloqueios; uma falha desfaz todas as
alterações. `world_reset_events` registra o comando, a data e os totais anteriores.
A migração 015 mantém o contexto histórico em `world_difficulty_surveys.battle_context`
e remove somente as FKs da enquete para as batalhas/participantes que serão
apagados. A regra de uma resposta por jogador/área/contexto continua válida.

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
server/progression.js   custos de treinamento, força e perfis das guarnições
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
A evolução tem testes de compra concorrente/idempotente, saldo reservado, produção
acumulada, auditoria, limite de nível, preços completos e compra sem confirmação.
O motor publicado é comparado ao protótipo de quatro posições em 18 configurações
com CPU ativa; invasores, reconexão e validação final preservam suas forças.
Os testes não acessam o banco de jogadores do Render/Neon.

- `GET /api/health`: conexão com PostgreSQL e prontidão do mundo.
- `GET /api/world`: mapa, proprietários, carteira, evolução, ranking e histórico.
- `GET /api/world/profile?page=1`: perfil e histórico pessoal paginado, autenticado.
- `POST /api/world/army/upgrade`: evoluir um tipo com `{troopKind, expectedLevel, requestId}`. O tipo é obrigatório; valores permitidos: `tanque`, `desliz`, `heli`, `canhao`, `central`.
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

## Tutorial guiado

Novos cadastros entram automaticamente em uma batalha de treinamento isolada.
Ela usa o mesmo motor, controles e artes do jogo, com instruções em português,
origem/alvo numerados no campo, pausa para leitura e avanço somente após a ação.
São ensinados conquista e produção, garagem, helicópteros, ilhas/botes, canhão,
bombardeiro, paraquedas e eliminação do exército rival. O instrutor oferece tropas
e uma defesa reduzida somente nesse cenário. O bombardeiro é explicado como
vantagem estratégica, nunca como condição geral de vitória.

O treino roda em `training-worker.js`, sem criar batalha, participante, saque,
moedas, cartas, conquistas, replay ou enquete no mundo compartilhado. Ao terminar,
a conta passa ao passeio por mapa, informações da área, carteira, formações,
coleção/melhoria individual, recompensas, perfil, histórico, amigos, ataques,
participação de terceiros, ranking e menu. Os recursos reais são abertos e
seus controles destacados. O passeio não compra melhorias ou inicia ataques.

`world_players.tutorial_phase` e `tutorial_step` guardam a conclusão do treino e
a etapa do passeio. A atualização autenticada `POST /api/world/tutorial` é
monotônica: repetições e abas antigas não desfazem o progresso. Uma recarga durante
o treino reinicia a prática; durante o passeio, retoma a etapa salva. Pausar
permite jogar e retomar pelo **Menu → Tutorial guiado**. Contas anteriores à
migração 016 não são interrompidas automaticamente e podem repetir pelo menu.
Repetir um tutorial concluído não altera o progresso salvo. O reset de batalha
preserva também esse estado da conta, além das enquetes e credenciais.

O orientador usa o avatar padrão do comandante da tela principal. O botão
**Ouvir** habilita a narração em português; as próximas instruções são lidas
automaticamente, com **Repetir áudio** e **Desligar áudio** disponíveis. Mudar de
etapa ou sair cancela a fala anterior; esconder a página também interrompe o
áudio. A síntese usa as vozes do navegador/aparelho (`SpeechSynthesis`), prioriza
pt-BR e mantém o texto se não houver suporte ou voz em português. Não exige
microfone, chave de API ou alterações no banco.

No treino, uma máscara escurece o campo e mantém origem/destino iluminados, com
as marcações 1 e 2. No passeio, uma janela de destaque acompanha o recurso real
mesmo após rolagem ou redimensionamento; o painel do orientador permanece claro.
Os formulários de cadastro e login permitem mostrar/ocultar a senha sem trocar
seu valor ou enviar o formulário.

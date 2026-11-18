# Domination

Jogo de conquista de territórios em mapa de hexágonos (estilo State.io), feito em HTML/JS puro — um único arquivo, sem build.

## Como jogar
- O mapa é um desafio simétrico de 17 regiões em hexágonos. Cada jogador começa num canto; o **Bombardeiro Central** fica à mesma distância de todos.
- Arraste da sua base até outra para enviar tropas (passe por várias bases suas para atacar com todas). Cada envio sai como um grupo com o número de tropas:
  - **Garagem → tanque:** anda casa a casa, só por terra.
  - **Heliporto → helicóptero:** voa em linha reta por cima de tudo.
  - **Botes → deslizador:** cruza a água em linha reta (únicas bases nas ilhas).
- **Bombardeiros** (central e laterais) giram e atiram reto na tropa inimiga mais próxima dentro do alcance (-1 por tiro). Quem captura passa a atirar nos outros.
- Grupos inimigos que se encontram no caminho lutam; o maior segue com a diferença.
- Bases neutras: garagem 40% da base inicial média (10), bombardeiros e heliporto 55% (14), botes 45% (11).
- O paraquedas (canto inferior direito) carrega com o tempo e reforça uma base sua.
- **A partida só termina quando todos os inimigos forem eliminados** (sem bases e sem tropas andando). Tomar o centro é só uma vantagem.

## Modos
- **Campanha:** níveis com 1 a 3 inimigos e dificuldade crescente.
- **Melhorias:** Guarnição, Produção e Capacidade, compradas com moedas.
- **Missões diárias** com estrelas e baús.
- **Duelo local:** dois jogadores no mesmo aparelho (azul × vermelho).
- **Online, 2 a 4 jogadores:** crie uma sala, passe o código de 4 letras (ou os amigos entram pela lista de salas abertas) e toque em INICIAR quando quiser. Cada jogador se vê em azul; a classificação final dá 150 moedas ao 1º e 30 ao último. Se o criador sair, a partida termina para todos. Fora do Claude o jogo usa o servidor de salas em `server/`; dentro do Claude usa a sala em tempo real do próprio Claude.

O progresso fica salvo no `localStorage` do navegador.

## Estrutura
```
public/index.html   # o jogo inteiro (mapa, arte em SVG e lógica embutidos)
server/index.js     # servidor de salas do duelo online (WebSocket, Node + ws)
package.json        # dependências do servidor
render.yaml         # configuração dos dois serviços no Render
```

## Rodar localmente
Abra `public/index.html` no navegador, ou sirva a pasta:
```
npx serve public
```

## Rodar o servidor de salas localmente
```
npm install
npm start            # porta 10000
```
Para testar, troque `WS_URL` em `public/index.html` por `ws://localhost:10000`.

## Deploy no Render
Dois serviços, no mesmo repositório:
- **domination** (site estático): sem build, publica a pasta `public`.
- **domination-ws** (web service Node, plano free): `npm install` e `node server/index.js`. O endereço dele está fixo em `WS_URL` no `index.html` (`wss://domination-ws.onrender.com`).

No plano free o servidor hiberna sem uso; a primeira conexão do dia pode levar até 1 minuto.

# Domination

Jogo de conquista de territórios no mapa-múndi (estilo State.io), feito em HTML/JS puro — um único arquivo, sem build.

## Como jogar
- Arraste da sua base (azul) até outra base para enviar tropas. Passe por várias bases suas para atacar com todas.
- Bases brancas são neutras; verde, vermelho e roxo são inimigos. O coração é a base principal de cada lado.
- O paraquedas (canto inferior direito) carrega com o tempo e reforça uma base sua.
- Elimine todos os inimigos para vencer o nível.

## Modos
- **Campanha:** 17 regiões reais do mundo (América Central, Bálcãs, América do Sul, EUA…), dificuldade crescente.
- **Melhorias:** Guarnição, Produção e Capacidade, compradas com moedas.
- **Missões diárias** com estrelas e baús.
- **Duelo local:** dois jogadores no mesmo aparelho (azul × vermelho).
- **Online, 2 a 4 jogadores:** crie uma sala, passe o código de 4 letras (ou os amigos entram pela lista de salas abertas) e toque em INICIAR quando quiser. Cada jogador se vê em azul; a classificação final dá 150 moedas ao 1º e 30 ao último. Se o criador sair, a partida termina para todos. Fora do Claude o jogo usa o servidor de salas em `server/`; dentro do Claude usa a sala em tempo real do próprio Claude.

O progresso fica salvo no `localStorage` do navegador.

## Estrutura
```
public/index.html   # o jogo inteiro (dados do mapa embutidos: world-atlas 50m e us-atlas, simplificados)
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

Dados de mapa: [world-atlas](https://github.com/topojson/world-atlas) e [us-atlas](https://github.com/topojson/us-atlas) (Natural Earth, domínio público).

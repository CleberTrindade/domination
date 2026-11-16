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
- **Duelo online:** só funciona quando o jogo é aberto como artefato no Claude (usa a sala em tempo real do Claude). Na versão hospedada no Render esse modo aparece como indisponível.

O progresso fica salvo no `localStorage` do navegador.

## Estrutura
```
public/index.html   # o jogo inteiro (dados do mapa embutidos: world-atlas 50m e us-atlas, simplificados)
render.yaml         # configuração do site estático no Render
```

## Rodar localmente
Abra `public/index.html` no navegador, ou sirva a pasta:
```
npx serve public
```

## Deploy no Render
Site estático: build command vazio (`echo ok`) e publish directory `public`. O `render.yaml` já traz essa configuração.

Dados de mapa: [world-atlas](https://github.com/topojson/world-atlas) e [us-atlas](https://github.com/topojson/us-atlas) (Natural Earth, domínio público).

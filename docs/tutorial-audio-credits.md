# Narração do comandante

Os MP3 em `public/audio/tutorial` são arquivos estáticos gerados por IA, em
português brasileiro, com a voz masculina `pt_BR-faber-medium` do Piper.
Não há chamada a um serviço de síntese durante o jogo, nem seleção de voz do
Google/navegador. O jogador precisa tocar em Ouvir para habilitar a narração.

Fontes do modelo e da ferramenta:

- Modelo e documentação: https://huggingface.co/rhasspy/piper-voices/tree/main/pt/pt_BR/faber/medium
- Model card: https://huggingface.co/rhasspy/piper-voices/blob/main/pt/pt_BR/faber/medium/MODEL_CARD
- Dataset informado no model card: https://github.com/OHF-Voice/voice-datasets — CC0.
- Ferramenta usada apenas na geração: https://github.com/OHF-Voice/piper1-gpl — GPL-3.0.

O modelo e o runtime não são distribuídos com o jogo. Foram usados Piper 1.8.0
e ONNX Runtime 1.32.0 em um processo local com a rede isolada por `unshare --net`,
`ORT_DISABLE_TELEMETRY=1` antes do import e `disable_telemetry_events()`.
O SHA-256 do modelo, os textos, durações e hashes dos MP3 estão em
`public/tutorial-audio.json`. O texto do tutorial não deve mudar sem gerar os
MP3 correspondentes; os testes detectam diferenças.

O personagem de corpo inteiro usa o mockup aprovado, derivado do avatar original,
comprimido para WebP nas mesmas dimensões e com transparência preservada.

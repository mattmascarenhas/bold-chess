# Prompt: animações reativas do Robôzinho 3D da Bold

Você é um engenheiro sênior de front-end especialista em Three.js + React + TypeScript.
Vou anexar arquivos de um projeto de xadrez (Bold Chess). Sua tarefa: fazer o mascote 3D
"Robôzinho da Bold" reagir com animações/expressões diferentes conforme ações do jogo e emotes.

## Contexto do projeto
- Stack: React 19, TypeScript, three 0.187 (sem GLTF/assets externos, tudo procedural), Vite.
- O robô é construído em `createBoldRobot3D()` (`pieces.ts`, ~linha 591) como um `THREE.Group`
  com meshes soltos (torso, escudo no peito, 2 braços, cabeça, crista, 2 ear pods, 2 antenas,
  visor azul, bezel verde, 2 olhos "^ ^" feitos de TorusGeometry meio arco).
  Hoje NENHUMA parte tem referência nomeada: só retorna o grupo raiz.
- Ele é instanciado em `ChessScene.tsx.txt` (~linha 434) ao lado do tabuleiro (pos 5.45, 1.35, -1.6)
  e animado em `stepAnimations(dt)` (~linha 776) apenas com flutuação senoidal + um "bounce"
  (`robotBounceRef`) disparado em capturas/convocação/xeque (~linha 983).
- `ChessScene` recebe a prop `robotMood: 'idle' | 'happy' | 'alert' | 'excited'`, mas ela só é
  passada pelo `App.tsx.txt` como `inCheck ? 'alert' : 'idle'` e NÃO é usada de fato na animação.
- Fala do robô (balão no HUD) é controlada em `App.tsx.txt` via `setRobotSpeech/setRobotSpeaker`
  (xeque, xeque-mate, capturas, peças especiais, emotes) e exibida em `GameHUD.tsx`.
- Emotes: `MEME_EMOTES` em `game/types.ts` (ids: mim_de_papai, receba, que_isso, tome,
  bora_bill, uiuiui, eita_giovanna, fala_comigo). Disparados em `App.tsx.txt` (emote local ~linha 930
  e emote recebido do oponente via websocket ~linha 621). Áudio em `audio/soundEngine.ts`.
- `MoveKind`/histórico (`capturedKind`, `isCheck`, `isCheckmate`, `kind: 'convocation' | 'promotion'
  | 'castling' | ...`) estão em `game/types.ts`.
- O loop de render é "on demand" (`loopFnRef.current?.()` acorda o loop; `needsLoop` ~linha 607
  decide se continua). Qualquer animação nova deve manter o loop vivo enquanto durar e deixá-lo
  dormir depois (não pode queimar GPU parado). Há modo software-GL (`isSoftwareGl`) que deve
  continuar barato.

## O que fazer
1. **Refatorar `createBoldRobot3D`** para retornar `{ root, parts }` (ou um objeto tipado
   `BoldRobotRig`) expondo referências: torso, head, visor, bezel, leftArm/rightArm (com pivôs
   nos ombros para rotacionar bem), leftEye/rightEye, antenas, pods, shield, e os materiais
   (visorBlue, mintGlow, eyeGlow) para animar emissive/cor. Atualizar o uso em `ChessScene.tsx`.
2. **Criar um módulo novo `src/three/robotAnimator.ts`** com um controlador de estados
   (máquina de estados simples + blend/lerp suave entre poses, sem libs novas) com API tipo:
   `robotAnimator.play('happy' | 'alert' | 'excited' | ..., opts?)`, `update(dt, elapsed)` e
   `isActive()` (para o loop saber se deve continuar rodando). Estados one-shot voltam para `idle`.
3. **Estados/animações mínimos** (ajuste a seu critério artístico, mantendo o tom divertido):
   - `idle`: flutuar + piscar de olhos ocasional + leve balanço das antenas.
   - `happy`: olhos "^ ^", pulinho, braços para cima (ex.: jogada boa/captura própria).
   - `excited`: pulos repetidos, braços balançando, brilho verde mais forte (convocação,
     promoção, xeque-mate a favor).
   - `alert`: olhos arregalados (trocar geometria/escala para círculos), visor pisca em
     vermelho/âmbar, tremor leve, antenas eretas (xeque contra o jogador).
   - `sad/defeat`: olhos "v v"/caídos, cabeça baixa, braços caídos, emissive reduzido
     (perdeu peça importante / xeque-mate contra).
   - `thinking`: olha de lado, mão no "queixo", pontinhos no visor (IA pensando / vez do oponente).
   - `smug`: olhos meio fechados, inclinação da cabeça (captura de peça valiosa).
   - **Um mapeamento por emote** (os 8 de `MEME_EMOTES`), cada um com personalidade própria.
     Ex.: `mim_de_papai` = pedindo colo (braços abertos, olhos grandes/brilhantes);
     `receba` = pose de "toma essa" com um braço estendido; `que_isso` = balança a cabeça/
     braços de "calma"; `tome` = soco/golpe + tremor; `bora_bill` = pulos de torcida;
     `uiuiui` = rebolado/balanço lateral; `eita_giovanna` = susto, olhos arregalados, recuo;
     `fala_comigo` = inclina a cabeça, olhos em coração/brilho suave, braço acenando.
   - Expressão de olhos via troca/escala de geometria ou grupos de olhos alternativos
     (esconder/mostrar), não recriando meshes a cada frame.
4. **Ligar às ações do jogo.** Em `ChessScene.tsx.txt` e/ou `App.tsx`:
   - Substituir o uso morto de `robotMood` por um evento/estado real que chame o animator.
   - Capturas, convocação, promoção, roque, xeque, xeque-mate (vitória/derrota), vez da IA
     pensando, peça especial usada, e cada emote (local E recebido do oponente) disparam o
     estado correspondente. Pode estender a prop para algo como
     `robotCue: { id: RobotCue; nonce: number } | null` (nonce garante re-disparo do mesmo cue).
   - Manter o `robotBounceRef` existente integrado ou removê-lo se o animator o substituir.
5. **Performance/robustez**: sem alocação por frame, reaproveitar vetores, respeitar
   `isSoftwareGl` (menos efeitos), pausar quando a aba estiver oculta como o loop atual já faz,
   fazer dispose dos materiais/geometrias novos no cleanup existente da cena.
6. **Testes/validação**: `npm run lint` (tsc --noEmit) deve passar e os testes existentes
   (`npm test`) não podem quebrar. Se possível, adicione teste unitário para a lógica pura da
   máquina de estados (transições/timers) sem depender de WebGL.

## Restrições
- Sem dependências novas, sem assets/modelos externos: tudo procedural em Three.js.
- Manter o visual atual (branco acetinado, visor azul real, detalhes verde neon, olhos ciano)
  e a posição/escala do robô na cena.
- Código e comentários seguindo o estilo atual; mensagens/fala em PT-BR.
- Mudanças cirúrgicas: não reformatar arquivos nem mexer em lógica de xadrez/servidor.

## Entrega esperada
- Arquivos alterados/criados completos (ou diffs claros), com um resumo curto de: como o rig
  foi exposto, tabela cue → animação, e onde cada cue é disparado.
- Indique como testar manualmente (ex.: um atalho/debug para disparar cada animação em dev).

## Arquivos anexados (referência)
Obs.: anexados como `.txt` (conteúdo é TypeScript/TSX; o nome real do original está entre parênteses).
- `pieces.ts.txt`      → construção do robô (`createBoldRobot3D`) e materiais (`PieceMaterialSet`)
- `ChessScene.tsx.txt` → cena Three.js, loop de animação, uso do robô, prop `robotMood`
- `game-types.ts.txt`  → `MoveKind`, histórico de lances, `MEME_EMOTES`, tipos do jogo (era `src/game/types.ts`)
- `App.tsx.txt`        → onde fala/emotes/eventos de jogo são disparados e `robotMood` é passado
- `GameHUD.tsx.txt`    → balão de fala do robô (contexto visual)
- `soundEngine.ts.txt` → áudio dos emotes (para sincronizar duração da animação, se útil)

# Plano de desenvolvimento: Bold Chess no Bold Workspace

## 1. Objetivo
Transformar o Bold Chess em app embarcado (iframe) do Bold Workspace:
- Identidade 100% vinda do Workspace (SSO), sem tabela de usuários/empresas no app.
- Multiplayer global: qualquer usuário, de qualquer empresa ou workspace, joga com qualquer outro.
- Lobby com usuários online, desafio com um clique, convite por código/link, espectadores.
- Pontuação e leaderboard global.
- Testado, inclusive com um Workspace simulado (host falso com iframe).

## 2. Decisões de arquitetura (fechadas)
| Tema | Decisão |
|---|---|
| Identidade | `BoldBridge.getSSOToken()` no front, `bold.sso.verify()` no servidor ao abrir o WebSocket. Id do usuário = `id` do SSO. |
| Escopo de salas | Global. Nenhum filtro por `account_id`/`workspace_id`. Os ids são gravados só como metadados. |
| Quem está online | Conexões WebSocket autenticadas do próprio jogo. Não usa `getUsers()` (só vê o workspace atual). |
| Convite | Mensagem WebSocket `invite` com Aceitar/Recusar no jogo. Reserva: código de 6 letras e link `/sala/ABC123`. Notificação do Workspace é extra opcional, falha silenciosa. |
| Reconexão | Token renovado (`refreshSSOToken`), `resume` da sala, vaga do jogador guardada por 60 s. |
| Persistência | Interface `Store` com implementação em arquivo JSON agora. Troca por Postgres depois sem mexer no resto. Tabelas com `account_id`, `workspace_id`, `user_id` seguindo o SDK. |
| Modo dev | Sem `BOLD_CLIENT_ID`/`BOLD_CLIENT_SECRET`, o servidor aceita token fake `dev:<id>:<nome>`. Desligado em produção. |
| Pontuação | Vitória +30, derrota +10, empate +15. Bônus +5 ao vencedor se o perdedor tem mais pontos. Desistência conta como derrota. Anti-farm: só pontua após 10 jogadas; mesma dupla no máximo 5 partidas pontuadas por dia. |
| Jogo contra IA | Não pontua (a confirmar com o dono). |

## 3. Estrutura de arquivos alvo
```
src/shared/protocol.ts      contrato de mensagens cliente<->servidor (fase 0)
src/shared/scoring.ts       regra de pontos (pura, testável)
server/auth.ts              verificação SSO + modo dev
server/store.ts             interface Store + JsonStore
server/presence.ts          usuários online, desafios, convites
server/rooms.ts             salas, vagas, espectadores, reconexão
server/leaderboard.ts       registro de partidas e ranking
server.ts                   só monta Express + WS e delega
src/workspace/bridge.ts     wrapper do BoldBridge com fallback dev
src/net/socket.ts           WebSocket com auth, reconexão e resume
src/components/Lobby.tsx, Leaderboard.tsx, InviteToast.tsx, SpectatorBar.tsx
tests/                      unit, integração, e2e
tools/workspace-sim/        host falso do Workspace
```

## 4. Agentes e responsabilidades
Regra de ouro: cada agente só edita os arquivos do seu bloco, para não haver conflito. Nenhum faz commit; o agente principal integra.

### Fase 0 — Fundação (agente principal, sequencial, antes de tudo)
- Instalar `@bold-workspace/sdk` do registry (sem token, leitura pública).
- Ler `dist/iframe/bridge.js` e registrar os tipos de mensagem `postMessage` reais (`BOLD_*`), base do simulador.
- Escrever `src/shared/protocol.ts` (todas as mensagens e erros) e `src/shared/scoring.ts` com a assinatura.
- Entregável: contrato congelado. Os agentes seguintes só consomem.

### Fase 1 — Paralela (4 agentes em worktrees próprios)
**Agente A — Backend Auth + Store** (`server/auth.ts`, `server/store.ts`)
- `verifyToken(token)` retorna `{userId, name, avatarUrl, accountId, workspaceId}`; usa `sso.verify`, com modo dev.
- `Store` com `saveMatch`, `getStats`, `getTop`, `countPairToday`; `JsonStore` com escrita atômica.
- Testes unitários: token válido, expirado, inválido; dev desligado em produção; escrita concorrente.

**Agente B — Backend Presença, Salas e Convites** (`server/presence.ts`, `server/rooms.ts`, ajustes em `server.ts`)
- Migrar o controle de vagas de cor para `userId`; espectadores com lista; `resume` por 60 s.
- Lobby: online, salas abertas, partidas ao vivo; `challenge`/`invite`/`accept`/`decline`; expiração do convite em 60 s.
- Fim de partida emite evento `matchEnded` (consumido por C).
- Testes de integração com cliente WS real e auth fake: desafio aceito, recusado, expirado, reconexão, espectador entra e não joga, dois logins do mesmo usuário.

**Agente C — Pontuação e Leaderboard** (`src/shared/scoring.ts`, `server/leaderboard.ts`, `src/components/Leaderboard.tsx`)
- Implementar a regra de pontos e o anti-farm; ranking global, "minha posição", últimas partidas.
- Endpoint `GET /api/leaderboard`.
- Testes unitários exaustivos (vitória, derrota, empate, desistência, bônus, limites, partida curta).

**Agente D — Frontend Workspace + Lobby** (`src/workspace/bridge.ts`, `src/net/socket.ts`, `Lobby.tsx`, `InviteToast.tsx`, `SpectatorBar.tsx`, ajustes em `App.tsx`)
- Wrapper do bridge: `isEmbedded`, `getContext`, `getSSOToken`, tema e idioma; `setReady`, `setTitle`; fora do iframe, modo dev ou `redirectToLogin`.
- Socket com auth, reconexão com backoff, renovação de token, `resume`.
- Telas: lobby, convite recebido, espectadores, link/código copiável, deep link `/sala/ABC123` com `setRoute`/`onNavigate`.
- Pausar o que for pesado quando a aba estiver inativa (`onTabActiveChange`).

### Fase 2 — Simulador do Workspace (agente E, em paralelo à fase 1)
**Agente E — Workspace Sim** (`tools/workspace-sim/`)
- Página host que embute o jogo num iframe e responde às mensagens `BOLD_*` exatamente como o bridge real (contexto, SSO token, tema, idioma, aba ativa).
- Gera tokens de teste aceitos pelo modo dev e permite abrir vários usuários (empresas e workspaces diferentes) lado a lado.
- Entregável: `npm run sim` abre N hosts.

### Fase 3 — Integração (agente principal)
- Mesclar os blocos, rodar `tsc --noEmit`, testes unitários e de integração, resolver conflitos de contrato.

### Fase 4 — QA e fim a fim (agente F, depois da fase 3)
**Agente F — QA E2E**
Cenários no simulador, com dois ou três usuários de empresas diferentes:
1. Usuário A abre pelo host, aparece no lobby de B.
2. A desafia B; B aceita; partida começa com as cores corretas.
3. Terceiro usuário assiste; não consegue mover; vê a partida em tempo real.
4. Fim de partida: pontos corretos e leaderboard atualizado para todos.
5. Convite por link: usuário offline abre o link depois e entra.
6. Queda de rede e token expirado no meio da partida: reconecta e volta à mesma sala.
7. Mesmo usuário em duas abas; saída de um jogador (desistência); revanche.
8. Fora do iframe: comportamento definido, sem tela quebrada.
- Entrega relatório com falhas e correção; reexecuta até passar.

### Fase 5 — Revisão
- Agente de revisão de código e de segurança: validação do token em toda conexão, nenhum cliente pode mover pelo outro, sem vazamento de segredo, limites de taxa (convites e emotes), dados mínimos expostos no lobby.

## 5. Ordem e paralelismo
```
Fase 0 (sequencial)
   ├── A  ┐
   ├── B  │ paralelo
   ├── C  │
   ├── D  │
   └── E  ┘
Fase 3 integração -> Fase 4 QA (F) -> Fase 5 revisão
```

## 6. Critérios de pronto
- `tsc --noEmit` e todos os testes passam.
- Os 8 cenários E2E passam no simulador.
- Nenhuma tabela de usuário/empresa/workspace criada.
- Partida entre usuários de empresas diferentes funciona.
- Leaderboard bate com as partidas gravadas.
- Alternar para o Workspace real exige apenas definir `BOLD_CLIENT_ID`, `BOLD_CLIENT_SECRET` e a URL base.

## 7. Riscos e pendências
| Item | Tratamento |
|---|---|
| Credenciais do app no Workspace | Modo dev até receber; troca é só configuração. |
| Mensagens reais do bridge | Fase 0 lê o código do SDK; simulador copia fielmente. |
| Banco definitivo | Interface `Store`; JSON agora, Postgres depois. |
| Jogo com IA pontua? | Fora do ranking até confirmação. |
| Servidor único | Estado das salas em memória; fica para escalar depois se necessário. |

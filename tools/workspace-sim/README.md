# Workspace Sim

Host falso do Bold Workspace: embute o jogo em iframe e responde ao protocolo `postMessage` do `BoldBridge`.

## Uso

```
npm run dev        # jogo em http://localhost:3000 (WS em /ws)
npm run sim        # simulador em http://localhost:4000 (SIM_PORT, GAME_URL)
```

- Tres usuarios lado a lado (Ana, Bruno, Carla): http://localhost:4000/?auto
- Painel com checkboxes (inclui Diego): http://localhost:4000/
- Um host: `/host?user=ana&name=Ana&account=bold-solution&workspace=atendimento&theme=dark&lang=pt-BR&route=/sala/ABC234`

Usuarios: Ana (Bold Solution/Atendimento), Bruno (Acme Corp/Vendas), Carla (Globex/Suporte), Diego (Bold Solution/Vendas). Qualquer outro `user` vira um usuario ad hoc.

## Comportamento

- Respondidos: `BOLD_GET_CONTEXT|USERS|WORKSPACES|SSO_TOKEN|TAB_ACTIVE_STATE` (+ `BOLD_DOWNLOAD_FILE`; contatos devolvem `BOLD_ERROR`). `requestId` e ecoado.
- Token SSO: `dev:<id>:<nome>:<account>:<workspace>`. Nunca vai em `?ssoToken` na URL do iframe.
- Painel lateral: log de todas as mensagens, tema/idioma, aba ativa/inativa, rede on/off (host para de responder, simula timeout), expirar/renovar token (resposta passa a ser `expired.invalid.token`), recarregar iframe, `BOLD_NAVIGATE`, notificacoes, barra de endereco (`/:conta/:workspace/chess/<rota>`).
- Logica pura em `protocol-handlers.ts` (testada em `tests/sim.test.ts`).

## Limitacoes

- Iframes de mesma origem (o jogo em localhost:3000) compartilham `localStorage`/`sessionStorage` entre hosts; o jogo embutido nao deve depender deles para identidade.
- "Rede off" e do lado do host (sem respostas ao bridge); nao derruba o WebSocket do jogo. Use "recarregar" ou DevTools offline para isso.
- O bridge real resolve TODAS as requisicoes pendentes ao receber `BOLD_SSO_TOKEN_RESPONSE` (comportamento do SDK, nao do simulador).

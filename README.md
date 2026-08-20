# Mental Madness - Estoque

Sistema de produção sob demanda pros drops exclusivos e itens básicos,
baseado nos pedidos "processado / não processado" das duas lojas Shopify.

**Em produção:** https://mental-estoque.vercel.app
**Repositório:** https://github.com/eijilucas/mental-madness-estoque (privado)

## Como está estruturado

```
src/
  server.js          servidor HTTP puro — só pra rodar local (npm start)
  db.js              persistência no Supabase (Postgres via REST)
  supabase.js        cliente HTTP mínimo pra API REST do Supabase
  calc/produce.js    as duas regras (exclusivo/básico) + cálculo de crítico
  calc/variantKey.js chave única de tamanho+cor, usada em todo lugar
  shopify/auth.js    troca client_id + client_secret por access_token
  shopify/client.js  chamada autenticada + paginação na Admin API
  shopify/mapping.js Shopify → formato interno (produto/variante/pedido)
  shopify/sync.js    orquestra a sincronização das duas lojas
  routes/api.js      endpoints da API (usados local e no Vercel)
api/index.js         function serverless do Vercel — delega pro routes/api.js
public/               painel (HTML/CSS/JS), tema da marca (Horst Blackletter + Cinzel + Oswald)
vercel.json           rewrites de estático + roteamento de /api
.github/workflows/    sincroniza a cada 5 min via GitHub Actions
```

## Rodar local

Precisa de Node 20.6+ e das credenciais no `.env` (copiar de `.env.example`).
Sem `npm install` — não usa nenhuma dependência externa, só `fetch` nativo.

```bash
npm start   # sobe em http://localhost:3000, já lendo o .env
```

## Deploy (Vercel + Supabase + GitHub Actions)

- **Dados**: Postgres no Supabase (tabelas `drops`, `products`, `variants`,
  `orders` — ver SQL no histórico do projeto ou recriar a partir de `src/db.js`).
- **App**: Vercel, deployado a partir do GitHub (`git push` na branch
  `master` dispara redeploy automático). Pra deploy manual: `npx vercel deploy --prod`.
- **Variáveis de ambiente**: as mesmas do `.env` local, cadastradas em
  Production e Preview via `npx vercel env add NOME production`.
- **Sincronização automática**: o Vercel Hobby (grátis) só libera Cron 1x/dia,
  então quem dispara a cada 5 minutos é o GitHub Actions
  (`.github/workflows/sync.yml`), chamando `GET /api/cron-sync` com o header
  `Authorization: Bearer $CRON_SECRET`. O secret precisa existir nos dois
  lugares: `CRON_SECRET` no Vercel **e** `gh secret set CRON_SECRET` no repo.

## Regras implementadas (ver `src/calc/produce.js`)

- **Exclusivo**: `produzir = máx(0, não processados − restantes)` — sem
  estoque de segurança, drop fechado = lista final, não recalcula mais.
- **Básico**: `produzir = máx(0, mínimo − estoque real)`, mínimo por produto
  (calças = 15, demais = 10, todos os tamanhos).
- **Crítico**: `estoque restante < 10` — dispara o alerta visual, não dispara
  produção.
- Cada **tamanho + cor** é tratado como variante própria — duas cores do
  mesmo tamanho são peças diferentes pra produzir.

## Sincronização com o Shopify (`src/shopify/`)

- Autenticação: **client credentials grant** — troca `client_id` +
  `client_secret` por um `access_token` via
  `POST https://{shop}.myshopify.com/admin/oauth/access_token`. Sem token fixo
  pra copiar/colar.
- Escopos do custom app: só `read_orders` e `read_products` (leitura).
  **Não precisa de `read_inventory`**: o Shopify sempre mostra 500 por
  variante (número falso, só pra não travar venda) — o sistema ignora esse
  campo e mantém o estoque real só aqui.
- **Drop atual do exclusivo**: auto-detectado (pega o produto mais recente
  com título "Peça - Nome Do Drop" e usa esse nome como filtro). Só
  preencher `SHOPIFY_EXCLUSIVO_CURRENT_DROP` no `.env` se precisar forçar
  manualmente.
- **Paliativo** (`SHOPIFY_BASICO_EXCLUDE_DROPS`): a loja básico tem produto
  de drop antigo cadastrado nela por engano — isso esconde pelo nome até a
  loja ser limpa de verdade no Shopify.

## Login (`src/auth/`)

- Autenticação usa o **Supabase Auth** direto (GoTrue REST API, sem SDK) —
  os usuários são criados manualmente no painel do Supabase em
  **Authentication > Users**, não existe cadastro pelo próprio app.
- `POST /api/auth/login` troca e-mail/senha por uma sessão do Supabase e
  guarda o `access_token`/`refresh_token` em cookies `httpOnly` (`mm_at` e
  `mm_rt`). Toda rota de `/api/*` (exceto `/api/auth/login` e
  `/api/cron-sync`, que usa o próprio `CRON_SECRET`) exige essa sessão.
- Sessão expira em 1h e é renovada sozinha pelo refresh token
  (`src/auth/session.js`) sem precisar logar de novo toda hora.
- Tela de login em `/login.html`; o painel redireciona pra lá sozinho se a
  API responder 401.

## O que ainda falta

- [ ] Webhook de verdade (`orders/fulfilled`/`orders/cancelled`) em vez de
      depender só do polling — reagiria na hora, não em até 5 min.
- [ ] Preencher o estoque real inicial de cada variante (hoje começa em 0
      pra tudo que nunca foi ajustado manualmente).
- [ ] Paginação além de 250 itens por loja no Shopify (limite de 5 páginas
      por segurança em `src/shopify/client.js`).
- [ ] Limpar a loja `m3ntalmadness.myshopify.com` de verdade (aí dá pra tirar
      o paliativo `SHOPIFY_BASICO_EXCLUDE_DROPS`).

## Pendências de negócio (confirmar com o Vitor)

- [ ] Confirmar se o mínimo de 15/10 vale igual pra todos os tamanhos de cada
      produto, ou se algum tamanho específico foge da regra.
- [ ] Confirmar se o limite de crítico (10) deve ser diferente por categoria
      (hoje é fixo pro catálogo inteiro).

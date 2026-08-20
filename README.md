# Mental Madness - Estoque

Sistema de produção sob demanda pros drops exclusivos e itens básicos, baseado
nos pedidos "processado / não processado" do Shopify. Ver o playbook completo
(regras, exemplos, mockup original) no artifact que gerou esse projeto.

## Rodar local

Só precisa de Node.js 18+. Sem `npm install` — o MVP não usa nenhuma
dependência externa.

```bash
npm run seed   # popula data/db.json com os dados de exemplo
npm start      # sobe o servidor em http://localhost:3000
```

Abra `http://localhost:3000` — é o painel de produção, já ligado na API.

## Como está estruturado

```
src/
  server.js        servidor HTTP puro (sem framework), serve o painel + API
  db.js             persistência em arquivo JSON (data/db.json)
  calc/produce.js   as duas regras: exclusivo e básico, + cálculo de crítico
  shopify/sync.js   busca pedidos — cai pro stub local se faltar CLIENT_ID
  shopify/auth.js   troca client_id + client_secret por access_token
  routes/api.js     endpoints da API
public/
  dashboard.html/js/css   painel (mesmo visual do mockup, agora ligado a dados reais)
data/db.json        "banco de dados" — produtos, tamanhos, pedidos, config
scripts/seed.js      gera o data/db.json de exemplo
```

## Regras implementadas (ver `src/calc/produce.js`)

- **Exclusivo**: `produzir = máx(0, não processados − restantes)`
- **Básico**: `produzir = máx(0, mínimo − estoque real)`, mínimo por produto
  (calças = 15, demais = 10, todos os tamanhos)
- **Crítico**: `estoque restante < 10` — dispara o alerta visual (sino + faixa),
  não dispara produção

## O que falta pra ligar no Shopify de verdade

1. Criar um **custom app** na loja Shopify (Configurações → Apps e canais de
   vendas → Desenvolver apps) com só estes dois escopos, ambos de leitura:
   - `read_orders` — pra puxar `fulfillment_status` (processado/não processado)
     e registrar o webhook de pedido enviado/cancelado
   - `read_products` — pra mapear variante → produto/tamanho (SKU, título da
     variante)
   Não precisa de `read_inventory`: o Shopify vai mostrar sempre 500 por
   variante (número falso, só pra não travar venda), e o sistema ignora esse
   campo de propósito — o estoque real vive só aqui. Também não precisa de
   nenhum escopo de escrita, já que o sistema nunca altera nada no Shopify.
2. Pegar o **Client ID** e o **Client Secret** nas credenciais da API do app
   (o Client Secret é o `shpss_...` que já está guardado no `.env`). Não existe
   mais token fixo pra copiar — o app troca essas duas credenciais por um
   `access_token` em tempo real, via **client credentials grant**:
   ```
   POST https://{shop}.myshopify.com/admin/oauth/access_token
   { "client_id": "...", "client_secret": "...", "grant_type": "client_credentials" }
   ```
   Isso já está implementado em `src/shopify/auth.js` — só falta preencher
   `SHOPIFY_BASICO_CLIENT_ID` e `SHOPIFY_EXCLUSIVO_CLIENT_ID` no `.env`.
3. Assim que os dois `CLIENT_ID` estiverem no `.env`, `fetchOrdersFromShopify()`
   em `src/shopify/sync.js` já passa a buscar pedido de verdade nas duas lojas
   (hoje cai pro stub local automaticamente enquanto faltar credencial) — falta
   só mapear o formato do pedido do Shopify pro formato interno
   (`{ id, productId, size, status }`) usando SKU/variant_id.
4. Cadastrar um webhook de `orders/fulfilled` (e `orders/cancelled`) apontando
   pra um endpoint novo (ex: `/webhooks/orders-fulfilled`) que chame
   `markProcessado()` automaticamente, em vez de precisar chamar
   `/api/orders/mark-processado` na mão.
5. Deixar cada variante do Shopify sempre com **500 no estoque** (fixo) — é só
   pra não travar venda, o sistema ignora esse número no cálculo.

## Pendências de negócio (confirmar com o Vitor)

- [ ] Confirmar se o mínimo de 15/10 vale igual pra todos os tamanhos de cada
      produto, ou se algum tamanho específico foge da regra.
- [ ] Confirmar se o limite de crítico (10) deve ser diferente por categoria
      (hoje é fixo pro catálogo inteiro).

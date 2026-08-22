// Script de setup (rodar uma vez, ou de novo se a URL de produção mudar) —
// registra os webhooks de pedido nas duas lojas Shopify, apontando pro
// endpoint /api/webhooks/shopify. Idempotente: pula tópico que já existe
// apontando pra mesma URL.

const { shopifyFetch } = require("../src/shopify/client");
const { configuredStores } = require("../src/shopify/sync");

const APP_URL = process.env.APP_URL || "https://mental-estoque.vercel.app";
const ADDRESS = `${APP_URL}/api/webhooks/shopify`;
const TOPICS = ["orders/create", "orders/updated", "orders/cancelled"];

async function ensureWebhooks(store) {
  const { webhooks: existing } = await shopifyFetch(store, "webhooks.json?limit=250");

  for (const topic of TOPICS) {
    const already = existing.find((w) => w.topic === topic && w.address === ADDRESS);
    if (already) {
      console.log(`[${store.shop}] já existe: ${topic}`);
      continue;
    }
    await shopifyFetch(store, "webhooks.json", {
      method: "POST",
      body: JSON.stringify({ webhook: { topic, address: ADDRESS, format: "json" } }),
    });
    console.log(`[${store.shop}] criado: ${topic}`);
  }
}

async function main() {
  const stores = configuredStores();
  if (stores.length === 0) {
    console.error("Nenhuma loja configurada no .env");
    process.exit(1);
  }
  for (const store of stores) {
    await ensureWebhooks(store);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

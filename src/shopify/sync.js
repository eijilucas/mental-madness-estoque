// Camada de integração com o Shopify.
//
// Enquanto os client_id das lojas não existirem no .env, essa camada cai pro
// stub local (data/db.json). Assim que estiverem preenchidos, syncAll() busca
// produtos + pedidos de verdade nas duas lojas e atualiza o data/db.json.

const { load, save } = require("../db");
const { fetchAllPages } = require("./client");
const { variantKey } = require("../calc/variantKey");
const {
  mapProduct,
  mapDrop,
  mapOrderLineItem,
  detectCurrentDropKeyword,
  readVariantAttributes,
} = require("./mapping");

const STORES = {
  basico: {
    type: "basico",
    shop: process.env.SHOPIFY_BASICO_SHOP,
    clientId: process.env.SHOPIFY_BASICO_CLIENT_ID,
    clientSecret: process.env.SHOPIFY_BASICO_SECRET,
    // Paliativo: a loja básico tem produto de drop antigo cadastrado nela por
    // engano (confirmado com o Lucas em 19/08 — não é pra estar lá, mas
    // arrumar isso é trabalho manual no Shopify). Enquanto isso não é limpo
    // na própria loja, esconde daqui pelo nome do drop.
    excludeKeywords: (process.env.SHOPIFY_BASICO_EXCLUDE_DROPS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
  exclusivo: {
    type: "exclusivo",
    shop: process.env.SHOPIFY_EXCLUSIVO_SHOP,
    clientId: process.env.SHOPIFY_EXCLUSIVO_CLIENT_ID,
    clientSecret: process.env.SHOPIFY_EXCLUSIVO_SECRET,
    // A loja exclusivo acumula produto de todo drop já feito, mas só o drop
    // atual interessa pra produção. Por padrão isso é AUTO-DETECTADO (pega o
    // produto "Peça - Nome Do Drop" mais recente e usa o nome do drop dele) —
    // ver detectCurrentDropKeyword em mapping.js. Só preencher essa variável
    // se precisar forçar manualmente (ex: auto-detect errou).
    currentDropKeyword: process.env.SHOPIFY_EXCLUSIVO_CURRENT_DROP || null,
  },
};

function isConfigured(store) {
  return Boolean(store.shop && store.clientId && store.clientSecret);
}

function configuredStores() {
  return Object.values(STORES).filter(isConfigured);
}

// Junta produto novo do Shopify com o que já existe local, sem perder
// estoqueReal (que é controlado por aqui, não pelo Shopify) nem drop.status
// (que pode ter sido fechado manualmente no painel).
function mergeProduct(existing, incoming) {
  if (!existing) return incoming;

  // preserva só o estoqueReal (é o único campo que é ajustado por aqui) —
  // o resto (size, color, ...) sempre vem fresco do Shopify, pra não travar
  // num formato antigo se o mapeamento mudar
  const sizes = { ...incoming.sizes };
  for (const key of Object.keys(sizes)) {
    if (existing.sizes[key]) {
      sizes[key] = { ...sizes[key], estoqueReal: existing.sizes[key].estoqueReal };
    }
  }
  return { ...incoming, sizes };
}

function mergeDrop(existing, incoming) {
  if (!existing) return incoming;
  // status é a fonte de verdade local (pode ter sido fechado manualmente),
  // só herda do Shopify se ainda não existia.
  return { ...incoming, status: existing.status, closedAt: existing.closedAt };
}

async function syncProducts(db, store) {
  let shopifyProducts = await fetchAllPages(store, "products.json?limit=250");

  const beforeCount = shopifyProducts.length;

  const dropKeyword =
    store.currentDropKeyword ||
    (store.type === "exclusivo" ? detectCurrentDropKeyword(shopifyProducts) : null);
  if (dropKeyword) {
    const keyword = dropKeyword.toLowerCase();
    shopifyProducts = shopifyProducts.filter((sp) => sp.title.toLowerCase().includes(keyword));
  }
  if (store.excludeKeywords && store.excludeKeywords.length > 0) {
    const excludeList = store.excludeKeywords.map((k) => k.toLowerCase());
    shopifyProducts = shopifyProducts.filter(
      (sp) => !excludeList.some((k) => sp.title.toLowerCase().includes(k))
    );
  }

  if (shopifyProducts.length !== beforeCount) {
    // esconde (remove local) produto/drop/pedido que não passou no filtro
    // dessa loja — só existe uma loja de cada tipo, então "type === X" já
    // basta pra identificar o que é dela
    const keepIds = new Set(shopifyProducts.map((sp) => `shopify-${sp.id}`));
    const isStale = (item) =>
      item.type === store.type && item.id.startsWith("shopify-") && !keepIds.has(item.id);

    const staleProductIds = new Set(db.products.filter(isStale).map((p) => p.id));
    db.products = db.products.filter((p) => !isStale(p));
    // drop.id === product.id no nosso modelo (1 produto = 1 drop)
    db.drops = db.drops.filter((d) => !(d.id.startsWith("shopify-") && !keepIds.has(d.id)));
    db.orders = db.orders.filter((o) => !staleProductIds.has(o.productId));
  }

  for (const sp of shopifyProducts) {
    const product = { ...mapProduct(sp, store.type), _store: store.shop };
    const existing = db.products.find((p) => p.id === product.id);
    const merged = mergeProduct(existing, product);

    if (existing) {
      Object.assign(existing, merged);
    } else {
      db.products.push(merged);
    }

    if (store.type === "exclusivo") {
      const drop = { ...mapDrop(sp), _store: store.shop };
      const existingDrop = db.drops.find((d) => d.id === drop.id);
      const mergedDrop = mergeDrop(existingDrop, drop);
      if (existingDrop) Object.assign(existingDrop, mergedDrop);
      else db.drops.push(mergedDrop);
    }
  }

  return shopifyProducts;
}

async function syncOrders(db, store, shopifyProducts) {
  // index variant_id -> { productId, size, color } pra casar linha de pedido com produto
  const byVariantId = new Map();
  for (const sp of shopifyProducts) {
    const productId = `shopify-${sp.id}`;
    for (const variant of sp.variants || []) {
      const { size, color } = readVariantAttributes(sp, variant);
      byVariantId.set(variant.id, { productId, size, color });
    }
  }

  const shopifyOrders = await fetchAllPages(
    store,
    "orders.json?status=any&limit=250&fields=id,created_at,fulfillment_status,line_items"
  );

  const mapped = [];
  for (const order of shopifyOrders) {
    for (const lineItem of order.line_items || []) {
      const row = mapOrderLineItem(order, lineItem, byVariantId);
      if (row) mapped.push(row);
    }
  }

  // substitui só os pedidos dessa loja (identificados pelos productId que ela sincronizou)
  const storeProductIds = new Set([...byVariantId.values()].map((v) => v.productId));
  db.orders = db.orders.filter((o) => !storeProductIds.has(o.productId));
  db.orders.push(...mapped);
}

async function syncAll() {
  const stores = configuredStores();
  if (stores.length === 0) {
    return { synced: false, reason: "Nenhuma loja configurada (falta CLIENT_ID no .env)" };
  }

  const db = await load();
  for (const store of stores) {
    const shopifyProducts = await syncProducts(db, store);
    await syncOrders(db, store, shopifyProducts);
  }
  await save(db);

  return { synced: true, stores: stores.map((s) => s.shop) };
}

// Simula o que acontece quando o Shopify confirma o envio de um pedido:
// o pedido sai da fila de não processado e o estoque real cai em 1.
// Quando o webhook de orders/fulfilled estiver configurado, ele chama isso
// automaticamente em vez de precisar do endpoint /api/orders/mark-processado.
async function markProcessado(orderId) {
  const db = await load();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw new Error(`Pedido ${orderId} não encontrado`);
  if (order.status === "processado") return db;

  order.status = "processado";

  const product = db.products.find((p) => p.id === order.productId);
  const key = variantKey(order.size, order.color);
  if (product && product.sizes[key]) {
    product.sizes[key].estoqueReal = Math.max(0, product.sizes[key].estoqueReal - 1);
  }

  await save(db);
  return db;
}

module.exports = { syncAll, markProcessado, configuredStores };

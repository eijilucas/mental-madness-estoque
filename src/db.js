// Camada de persistência — Supabase (Postgres via REST/PostgREST).
//
// O resto do código (calc, routes, shopify/sync) continua trabalhando com um
// objeto único { drops, products, orders, config } igual antes, montado a
// partir de 4 tabelas. load() monta esse objeto; save() grava tudo de volta,
// reconciliando o que foi removido (produto/variante/pedido que sumiu do
// array não fica órfão no banco).

const { sbSelectAll, sbUpsert, sbFetch } = require("./supabase");

function config() {
  return {
    minimoPorCategoria: {
      calca: Number(process.env.MINIMO_CALCA || 15),
      default: Number(process.env.MINIMO_DEFAULT || 10),
    },
    estoqueCritico: Number(process.env.ESTOQUE_CRITICO || 10),
  };
}

async function load() {
  const [dropRows, productRows, variantRows, orderRows] = await Promise.all([
    sbSelectAll("drops"),
    sbSelectAll("products"),
    sbSelectAll("variants"),
    sbSelectAll("orders"),
  ]);

  const sizesByProduct = new Map();
  for (const v of variantRows) {
    if (!sizesByProduct.has(v.product_id)) sizesByProduct.set(v.product_id, {});
    sizesByProduct.get(v.product_id)[v.variant_key] = {
      size: v.size,
      color: v.color || null,
      estoqueReal: v.estoque_real,
    };
  }

  const products = productRows.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    ...(p.category ? { category: p.category } : {}),
    ...(p.drop_id ? { dropId: p.drop_id } : {}),
    sizes: sizesByProduct.get(p.id) || {},
  }));

  const drops = dropRows.map((d) => ({
    id: d.id,
    name: d.name,
    status: d.status,
    closedAt: d.closed_at,
  }));

  const orders = orderRows.map((o) => ({
    id: o.id,
    shopifyOrderId: o.shopify_order_id,
    productId: o.product_id,
    size: o.size,
    color: o.color || null,
    status: o.status,
    createdAt: o.created_at,
  }));

  return { drops, products, orders, config: config() };
}

// deleta do banco as linhas que existem lá mas não estão mais em `currentRows`
async function reconcileDeletes(table, idColumns, currentRows) {
  const existing = await sbFetch(`${table}?select=${idColumns.join(",")}`);
  const keyOf = (row) => idColumns.map((c) => row[c]).join("::");
  const currentKeys = new Set(currentRows.map(keyOf));
  const stale = existing.filter((row) => !currentKeys.has(keyOf(row)));

  for (const row of stale) {
    const filter = idColumns.map((c) => `${c}=eq.${encodeURIComponent(row[c])}`).join("&");
    await sbFetch(`${table}?${filter}`, { method: "DELETE" });
  }
}

async function save(db) {
  const dropRows = db.drops.map((d) => ({
    id: d.id,
    name: d.name,
    status: d.status,
    closed_at: d.closedAt || null,
  }));

  const productRows = db.products.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    category: p.category || null,
    drop_id: p.dropId || null,
  }));

  const variantRows = [];
  for (const p of db.products) {
    for (const [key, v] of Object.entries(p.sizes)) {
      variantRows.push({
        product_id: p.id,
        variant_key: key,
        size: v.size,
        color: v.color || null,
        estoque_real: v.estoqueReal,
      });
    }
  }

  const orderRows = db.orders.map((o) => ({
    id: o.id,
    shopify_order_id: o.shopifyOrderId || null,
    product_id: o.productId,
    size: o.size,
    color: o.color || null,
    status: o.status,
    created_at: o.createdAt || null,
  }));

  // deletar filho antes de pai (variants/orders referenciam products; products referencia drops)
  await reconcileDeletes("variants", ["product_id", "variant_key"], variantRows);
  await reconcileDeletes("orders", ["id"], orderRows);
  await reconcileDeletes("products", ["id"], productRows);
  await reconcileDeletes("drops", ["id"], dropRows);

  // inserir/atualizar pai antes de filho
  await sbUpsert("drops", dropRows, "id");
  await sbUpsert("products", productRows, "id");
  await Promise.all([
    sbUpsert("variants", variantRows, "product_id,variant_key"),
    sbUpsert("orders", orderRows, "id"),
  ]);
}

module.exports = { load, save };

// Mesma ideia de mmEtiquetas.js (dá baixa/devolve estoque quando o
// mm-etiquetas gera/cancela uma etiqueta), mas para pedido do sistema de
// Vendas Externas — não existe pedido Shopify real por trás, então não há
// shopifyLineItemId pra casar. Casa direto por catalog_product_id + size/
// color, que os dois sistemas (Vendas Externas e este) já compartilham (é
// o mesmo `product.id` que GET /api/catalog/variants devolve).
//
// Cada item rastreado aqui vive em db.orders com id determinístico
// `external-order-{externalOrderId}-item-{itemId}` — diferente do prefixo
// `shopify-order-...` usado pros pedidos Shopify reais, pra nunca colidir.
// Ao contrário de mmEtiquetas.js, a linha não precisa existir de antemão
// (não vem de nenhum sync automático) — o primeiro applyExternalLabelGenerated
// já cria a linha na hora.

const { load, save } = require("./db");
const { variantKey } = require("./calc/variantKey");

function orderRowId(externalOrderId, itemId) {
  return `external-order-${externalOrderId}-item-${itemId}`;
}

// { applied: [...], skipped: [...] } — skipped = já processado (idempotência)
// ou item sem productId (não casou com catálogo no Vendas Externas, nada
// pra descontar).
async function applyExternalLabelGenerated(externalOrderId, items) {
  const db = await load();
  const applied = [];
  const skipped = [];

  for (const { itemId, productId, size, color, quantity } of items) {
    const rowId = orderRowId(externalOrderId, itemId);
    if (!productId) {
      skipped.push(rowId);
      continue;
    }

    let order = db.orders.find((o) => o.id === rowId);
    if (order && order.status === "processado") {
      skipped.push(rowId);
      continue;
    }

    if (!order) {
      order = {
        id: rowId,
        shopifyOrderId: externalOrderId,
        productId,
        size: size || null,
        color: color || null,
        status: "nao_processado",
        createdAt: new Date().toISOString(),
      };
      db.orders.push(order);
    }

    order.status = "processado";
    const product = db.products.find((p) => p.id === order.productId);
    const key = variantKey(order.size, order.color);
    if (product && product.sizes[key]) {
      product.sizes[key].estoqueReal = Math.max(0, product.sizes[key].estoqueReal - quantity);
    }
    applied.push(rowId);
  }

  if (applied.length > 0) await save(db);
  return { applied, skipped };
}

// { applied: [...], skipped: [...] } — skipped = não rastreado ou nunca
// tinha sido marcado "processado" (nada pra devolver).
async function applyExternalLabelCancelled(externalOrderId, items) {
  const db = await load();
  const applied = [];
  const skipped = [];

  for (const { itemId, quantity } of items) {
    const rowId = orderRowId(externalOrderId, itemId);
    const order = db.orders.find((o) => o.id === rowId);
    if (!order || order.status !== "processado") {
      skipped.push(rowId);
      continue;
    }

    order.status = "nao_processado";
    const product = db.products.find((p) => p.id === order.productId);
    const key = variantKey(order.size, order.color);
    if (product && product.sizes[key]) {
      product.sizes[key].estoqueReal += quantity;
    }
    applied.push(rowId);
  }

  if (applied.length > 0) await save(db);
  return { applied, skipped };
}

module.exports = { applyExternalLabelGenerated, applyExternalLabelCancelled, orderRowId };

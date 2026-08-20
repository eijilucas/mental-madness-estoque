// Integração com o mm-etiquetas: ele chama isso assim que gera uma etiqueta
// (dá baixa) e quando cancela uma etiqueta já comprada (devolve).
//
// Cada linha de pedido rastreada aqui vive em db.orders com id determinístico
// `shopify-order-{shopifyOrderId}-item-{lineItemId}` (ver mapOrderLineItem em
// shopify/mapping.js) — não precisamos que o mm-etiquetas conheça esse
// formato, só que ele mande shopifyOrderId + shopifyLineItemId, que ele já
// tem de qualquer forma.
//
// Item de pedido que essa loja não rastreia (produto de outro drop, etc.)
// é ignorado, não é erro — nem todo pedido do mm-etiquetas é dessa loja.

const { load, save } = require("./db");
const { variantKey } = require("./calc/variantKey");

function orderRowId(shopifyOrderId, shopifyLineItemId) {
  return `shopify-order-${shopifyOrderId}-item-${shopifyLineItemId}`;
}

// { applied: [...], skipped: [...] } — skipped = item não rastreado aqui.
async function applyLabelGenerated(shopifyOrderId, items) {
  const db = await load();
  const applied = [];
  const skipped = [];

  for (const { shopifyLineItemId, quantity } of items) {
    const rowId = orderRowId(shopifyOrderId, shopifyLineItemId);
    const order = db.orders.find((o) => o.id === rowId);
    if (!order) {
      skipped.push(rowId);
      continue;
    }
    // Idempotente: já processado (chamada duplicada, reprocessamento do
    // mm-etiquetas) não desconta de novo.
    if (order.status === "processado") {
      skipped.push(rowId);
      continue;
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
async function applyLabelCancelled(shopifyOrderId, items) {
  const db = await load();
  const applied = [];
  const skipped = [];

  for (const { shopifyLineItemId, quantity } of items) {
    const rowId = orderRowId(shopifyOrderId, shopifyLineItemId);
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

module.exports = { applyLabelGenerated, applyLabelCancelled, orderRowId };

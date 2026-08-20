// Traduz o formato do Shopify pro formato interno do sistema.
//
// Presunções que valem confirmar com o Vitor depois:
// - Categoria "calça" = título do produto contém "calça" (case-insensitive).
//   Frágil por escolha — se algum produto fugir do padrão de nome, a conta do
//   mínimo sai errada. Trocar por product_type ou tag é mais robusto.
// - Drop do exclusivo = o próprio produto (1 produto = 1 drop). Status do
//   drop: Shopify "active" → ativo, "archived"/"draft" → encerrado.
// - Tamanho/cor = lidos pelo NOME da opção no Shopify ("Tamanho"/"Size",
//   "Cor"/"Color"), não pela posição — um produto pode ter só tamanho, ou
//   tamanho + cor, em qualquer ordem.

const { variantKey } = require("../calc/variantKey");

const SIZE_OPTION_NAMES = ["tamanho", "size", "tam"];
const COLOR_OPTION_NAMES = ["cor", "color", "cores"];

function titleCase(str) {
  return str.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

function findOptionIndex(options, names) {
  const idx = (options || []).findIndex((o) => names.includes((o.name || "").trim().toLowerCase()));
  return idx === -1 ? null : idx;
}

function isCalca(title) {
  return (title || "").toLowerCase().includes("calça");
}

// Extrai { size, color } de uma variante, usando os índices de opção do
// produto (não assume que option1 é sempre tamanho).
function readVariantAttributes(product, variant) {
  const sizeIdx = findOptionIndex(product.options, SIZE_OPTION_NAMES);
  const colorIdx = findOptionIndex(product.options, COLOR_OPTION_NAMES);

  const optionValue = (idx) => (idx === null ? null : variant[`option${idx + 1}`]);

  const rawSize = optionValue(sizeIdx);
  const rawColor = optionValue(colorIdx);

  return {
    size: rawSize ? rawSize.trim().toUpperCase() : "ÚNICO",
    color: rawColor ? titleCase(rawColor.trim().toLowerCase()) : null,
  };
}

function mapProduct(shopifyProduct, storeType) {
  const id = `shopify-${shopifyProduct.id}`;
  const sizes = {};
  for (const variant of shopifyProduct.variants || []) {
    const { size, color } = readVariantAttributes(shopifyProduct, variant);
    const key = variantKey(size, color);
    if (!sizes[key]) sizes[key] = { size, color, estoqueReal: 0 };
  }

  const product = {
    id,
    name: shopifyProduct.title,
    type: storeType,
    sizes,
  };

  if (storeType === "basico") {
    product.category = isCalca(shopifyProduct.title) ? "calca" : "outro";
  } else {
    product.dropId = id; // 1 produto = 1 drop, pro exclusivo
  }

  return product;
}

function mapDrop(shopifyProduct) {
  const id = `shopify-${shopifyProduct.id}`;
  return {
    id,
    name: shopifyProduct.title,
    status: shopifyProduct.status === "active" ? "ativo" : "encerrado",
    closedAt: null,
  };
}

// Descobre productId + tamanho/cor a partir de um line item de pedido,
// casando pelo variant_id com os produtos já mapeados.
function mapOrderLineItem(order, lineItem, productsByVariantId) {
  const match = productsByVariantId.get(lineItem.variant_id);
  if (!match) return null; // variante não encontrada nos produtos sincronizados

  return {
    id: `shopify-order-${order.id}-item-${lineItem.id}`,
    shopifyOrderId: order.id,
    productId: match.productId,
    size: match.size,
    color: match.color,
    status: order.fulfillment_status === "fulfilled" ? "processado" : "nao_processado",
    createdAt: order.created_at,
  };
}

// Auto-detecta o drop exclusivo "atual": entre os produtos cujo título segue
// o padrão "Peça - Nome Do Drop", pega o mais recente (created_at) e usa o
// nome do drop dele como filtro — assim, quando um drop novo é lançado, ele
// vira o atual sozinho, sem precisar editar .env.
function detectCurrentDropKeyword(shopifyProducts) {
  const candidates = shopifyProducts
    .map((sp) => {
      const idx = sp.title.lastIndexOf(" - ");
      if (idx === -1) return null;
      const suffix = sp.title.slice(idx + 3).trim();
      return { sp, suffix };
    })
    .filter(Boolean);

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => new Date(b.sp.created_at) - new Date(a.sp.created_at));
  const latestSuffix = candidates[0].suffix;

  // normaliza (tira a palavra "drop" solta) pra "Hell Hounds Drop" e
  // "Hell Hounds" caírem no mesmo grupo
  return latestSuffix.replace(/\bdrop\b/gi, "").trim().toLowerCase();
}

module.exports = {
  mapProduct,
  mapDrop,
  mapOrderLineItem,
  detectCurrentDropKeyword,
  readVariantAttributes,
  isCalca,
};

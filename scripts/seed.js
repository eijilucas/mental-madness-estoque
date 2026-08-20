// Popula data/db.json com os dados de exemplo usados no mockup, pra rodar o painel local
// sem depender do Shopify ainda. Rode com: npm run seed

const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "db.json");

function orderBatch(productId, size, count, prefix) {
  const orders = [];
  for (let i = 0; i < count; i++) {
    orders.push({
      id: `${prefix}-${productId}-${size}-${i + 1}`,
      shopifyOrderId: null, // preenchido quando a sincronização real existir
      productId,
      size,
      status: "nao_processado",
      createdAt: new Date().toISOString(),
    });
  }
  return orders;
}

const db = {
  // Sem drops/produtos/pedidos de exemplo — fica vazio até a sincronização
  // real com o Shopify (ou cadastro manual) popular isso.
  drops: [],
  products: [],
  orders: [],

  config: {
    minimoPorCategoria: { calca: 15, default: 10 },
    estoqueCritico: 10,
  },
};

fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
console.log(`Seed gravado em ${DB_PATH}`);

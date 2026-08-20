const { load, save } = require("../db");
const { calcExclusivo, calcBasico, isCritico } = require("../calc/produce");
const { variantKey } = require("../calc/variantKey");
const { markProcessado, syncAll, configuredStores } = require("../shopify/sync");

async function buildProductionList() {
  const db = await load();
  const { products, orders, config, drops } = db;

  const dropById = Object.fromEntries(drops.map((d) => [d.id, d]));

  const result = products.map((product) => {
    const rows =
      product.type === "exclusivo"
        ? calcExclusivo(product, orders)
        : calcBasico(product, config);

    const drop = product.dropId ? dropById[product.dropId] : null;

    return {
      id: product.id,
      name: product.name,
      type: product.type,
      category: product.category || null,
      drop: drop ? { id: drop.id, name: drop.name, status: drop.status } : null,
      sizes: rows.map((r) => ({
        ...r,
        critico: isCritico(r.restantes ?? r.estoqueReal, config),
      })),
    };
  });

  return result;
}

function buildSummary(productionList) {
  let pecasAProduzir = 0;
  let skusAfetados = 0;
  let pedidosNaoProcessados = 0;

  for (const product of productionList) {
    for (const row of product.sizes) {
      pecasAProduzir += row.produzir;
      if (row.produzir > 0) skusAfetados += 1;
      if (typeof row.naoProcessados === "number") {
        pedidosNaoProcessados += row.naoProcessados;
      }
    }
  }

  return { pecasAProduzir, skusAfetados, pedidosNaoProcessados };
}

function buildAlerts(productionList) {
  const alerts = [];
  for (const product of productionList) {
    for (const row of product.sizes) {
      if (row.critico) {
        alerts.push({
          productId: product.id,
          productName: product.name,
          size: row.size,
          color: row.color || null,
          estoque: row.restantes ?? row.estoqueReal,
        });
      }
    }
  }
  return alerts;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

// Retorna true se tratou a rota, false se não é uma rota de API conhecida.
async function handleApi(req, res, url) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "GET" && url.pathname === "/api/production") {
    const list = await buildProductionList();
    res.end(JSON.stringify({ products: list, summary: buildSummary(list) }));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/sync/status") {
    res.end(JSON.stringify({ configured: configuredStores().map((s) => s.shop) }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/sync") {
    try {
      const result = await syncAll();
      res.end(JSON.stringify(result));
    } catch (err) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: `Falha ao sincronizar com o Shopify: ${err.message}` }));
    }
    return true;
  }

  // Chamado pelo cron (Vercel Cron ou GitHub Actions) — mesma coisa que
  // POST /api/sync, mas via GET (cron só faz GET) e com um segredo simples
  // pra ninguém de fora disparar sync à toa.
  if (req.method === "GET" && url.pathname === "/api/cron-sync") {
    const expected = process.env.CRON_SECRET;
    const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (expected && got !== expected) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "Não autorizado" }));
      return true;
    }
    try {
      const result = await syncAll();
      res.end(JSON.stringify(result));
    } catch (err) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: `Falha ao sincronizar com o Shopify: ${err.message}` }));
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/alerts") {
    const list = await buildProductionList();
    res.end(JSON.stringify({ alerts: buildAlerts(list) }));
    return true;
  }

  // Aceita ajuste relativo ({ delta }) — pros botões −/+ — ou absoluto
  // ({ value }) — pra quando precisa digitar uma quantidade grande de uma vez.
  if (req.method === "POST" && url.pathname === "/api/stock/adjust") {
    try {
      const body = await readJsonBody(req);
      const { productId, size, color, delta, value } = body;

      const hasDelta = typeof delta === "number";
      const hasValue = typeof value === "number";

      if (!productId || !size || (!hasDelta && !hasValue)) {
        res.statusCode = 400;
        res.end(
          JSON.stringify({ error: "productId, size e (delta ou value, ambos number) são obrigatórios" })
        );
        return true;
      }

      const key = variantKey(size, color);
      const db = await load();
      const product = db.products.find((p) => p.id === productId);
      if (!product || !product.sizes[key]) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "Produto ou variante não encontrada" }));
        return true;
      }

      const atual = product.sizes[key].estoqueReal;
      product.sizes[key].estoqueReal = hasValue ? Math.max(0, value) : Math.max(0, atual + delta);
      await save(db);

      res.end(JSON.stringify({ ok: true, estoqueReal: product.sizes[key].estoqueReal }));
    } catch (err) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "JSON inválido" }));
    }
    return true;
  }

  // Simula o webhook de pedido processado (enviado) — útil pra testar o painel
  // sem depender do Shopify ainda.
  if (req.method === "POST" && url.pathname === "/api/orders/mark-processado") {
    try {
      const body = await readJsonBody(req);
      if (!body.orderId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "orderId é obrigatório" }));
        return true;
      }
      await markProcessado(body.orderId);
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  return false;
}

module.exports = { handleApi };

const { load, save } = require("../db");
const { calcExclusivo, calcBasico, isCritico } = require("../calc/produce");
const { variantKey } = require("../calc/variantKey");
const { markProcessado, syncAll, configuredStores } = require("../shopify/sync");
const { applyLabelGenerated, applyLabelCancelled } = require("../mmEtiquetas");
const { loginWithPassword } = require("../auth/supabaseAuth");
const { setSessionCookies, clearSessionCookies, getSessionUser } = require("../auth/session");

function isAuthorized(req) {
  const expected = process.env.MM_ETIQUETAS_SECRET;
  const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return Boolean(expected) && got === expected;
}

// Autenticação do endpoint de leitura de catálogo usado pelo sistema de
// vendas externas (ver docs/api-contracts/01-catalog-read.md nesse repo).
// Secret dedicado — não reaproveita MM_ETIQUETAS_SECRET nem CRON_SECRET,
// pra poder rotacionar cada integração de forma independente.
function isCatalogReadAuthorized(req) {
  const expected = process.env.CATALOG_READ_SECRET;
  const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return Boolean(expected) && got === expected;
}

// Rotas que não exigem sessão logada — login em si, o cron (usa CRON_SECRET)
// e os webhooks do mm-etiquetas / vendas externas (usam seus próprios
// segredos, checados à parte em isAuthorized/isCatalogReadAuthorized).
const PUBLIC_ROUTES = new Set([
  "/api/auth/login",
  "/api/cron-sync",
  "/api/mm-etiquetas/label-generated",
  "/api/mm-etiquetas/label-cancelled",
  "/api/catalog/variants",
]);

// Molda o catálogo no formato do contrato de leitura externo. "active"
// resolve a mesma regra usada no restante do painel: produto básico está
// sempre disponível; produto exclusivo só está ativo enquanto o drop dele
// não foi encerrado (ver README/calc/produce.js — estoqueReal em 0 aqui é
// normal para exclusivo: produção é sob demanda, não indica indisponibilidade).
function buildCatalogVariants(db) {
  const { products, drops } = db;
  const dropById = Object.fromEntries(drops.map((d) => [d.id, d]));

  return products.map((product) => {
    const drop = product.dropId ? dropById[product.dropId] : null;
    const active = product.type === "exclusivo" ? Boolean(drop && drop.status === "ativo" && !drop.closedAt) : true;

    return {
      id: product.id,
      name: product.name,
      type: product.type,
      category: product.category || null,
      drop: drop ? { id: drop.id, name: drop.name, status: drop.status } : null,
      active,
      variants: Object.entries(product.sizes).map(([variantKey, data]) => ({
        variantKey,
        size: data.size,
        color: data.color || null,
        estoqueReal: data.estoqueReal,
        // Preço de venda real vindo da Shopify (sync) — null enquanto o
        // produto não passou por um sync desde que este campo existe.
        price: data.price ?? null,
      })),
    };
  });
}

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

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    try {
      const { email, password } = await readJsonBody(req);
      if (!email || !password) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "E-mail e senha são obrigatórios" }));
        return true;
      }
      const session = await loginWithPassword(email, password);
      if (!session || !session.access_token) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: "E-mail ou senha inválidos" }));
        return true;
      }
      setSessionCookies(req, res, session);
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "JSON inválido" }));
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    clearSessionCookies(req, res);
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  if (!PUBLIC_ROUTES.has(url.pathname)) {
    const user = await getSessionUser(req, res);
    if (!user) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "Não autenticado" }));
      return true;
    }
  }

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

  // Leitura de catálogo para o sistema de vendas externas — somente leitura,
  // sem side effects. Ver docs/api-contracts/01-catalog-read.md.
  if (req.method === "GET" && url.pathname === "/api/catalog/variants") {
    if (!isCatalogReadAuthorized(req)) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "unauthorized" }));
      return true;
    }
    const db = await load();
    res.end(
      JSON.stringify({ syncedAt: new Date().toISOString(), products: buildCatalogVariants(db) }),
    );
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

  // Chamado pelo mm-etiquetas assim que ele gera uma etiqueta — desconta o
  // estoque real da(s) variante(s) do pedido. Idempotente (ver mmEtiquetas.js),
  // então retry/reprocessamento do lado do mm-etiquetas é seguro.
  if (req.method === "POST" && url.pathname === "/api/mm-etiquetas/label-generated") {
    if (!isAuthorized(req)) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "Não autorizado" }));
      return true;
    }
    try {
      const body = await readJsonBody(req);
      if (!body.shopifyOrderId || !Array.isArray(body.items)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "shopifyOrderId e items (array) são obrigatórios" }));
        return true;
      }
      const result = await applyLabelGenerated(body.shopifyOrderId, body.items);
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (err) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // Contrapartida: chamado quando o mm-etiquetas cancela uma etiqueta já
  // comprada — devolve o estoque só do que realmente tinha sido descontado.
  if (req.method === "POST" && url.pathname === "/api/mm-etiquetas/label-cancelled") {
    if (!isAuthorized(req)) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "Não autorizado" }));
      return true;
    }
    try {
      const body = await readJsonBody(req);
      if (!body.shopifyOrderId || !Array.isArray(body.items)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "shopifyOrderId e items (array) são obrigatórios" }));
        return true;
      }
      const result = await applyLabelCancelled(body.shopifyOrderId, body.items);
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (err) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  return false;
}

module.exports = { handleApi };

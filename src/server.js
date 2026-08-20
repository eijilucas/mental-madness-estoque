const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { handleApi } = require("./routes/api");
const { syncAll, configuredStores } = require("./shopify/sync");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "..", "public");

// Sem URL pública, não dá pra usar webhook do Shopify — então o servidor
// sincroniza sozinho de tempos em tempos (polling). Ajustável via .env.
const SYNC_INTERVAL_MINUTES = Number(process.env.SYNC_INTERVAL_MINUTES || 5);

async function autoSync() {
  if (configuredStores().length === 0) return; // sem CLIENT_ID, nem tenta
  try {
    const result = await syncAll();
    console.log(`[auto-sync] ok — ${result.stores.join(", ")}`);
  } catch (err) {
    console.error(`[auto-sync] falhou: ${err.message}`);
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/dashboard.html" : pathname;
  const filePath = path.join(PUBLIC_DIR, safePath);

  // impede sair da pasta public/
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith("/api/")) {
    const handled = await handleApi(req, res, url);
    if (handled) return;
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Rota de API não encontrada" }));
    return;
  }

  serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`Painel de produção rodando em http://localhost:${PORT}`);

  if (configuredStores().length > 0) {
    console.log(`Sincronizando com o Shopify a cada ${SYNC_INTERVAL_MINUTES} min`);
    autoSync(); // já sincroniza uma vez ao subir, sem esperar o primeiro intervalo
    setInterval(autoSync, SYNC_INTERVAL_MINUTES * 60 * 1000);
  }
});

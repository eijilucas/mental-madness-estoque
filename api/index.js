// Function serverless do Vercel — todo /api/* cai aqui (ver rewrites no
// vercel.json) e delega pro mesmo roteador usado no servidor local.

const { URL } = require("url");
const { handleApi } = require("../src/routes/api");

module.exports = async (req, res) => {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const handled = await handleApi(req, res, url);
  if (!handled) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Rota de API não encontrada" }));
  }
};

// Cliente HTTP autenticado pra Admin API, com paginação por cursor (header
// Link) — a Shopify manda no máximo 250 itens por página.

const { getAccessToken } = require("./auth");

const API_VERSION = "2024-10";
const MAX_PAGES = 5; // trava de segurança pro MVP — dá pra tirar depois

function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  const match = linkHeader.split(",").find((part) => part.includes('rel="next"'));
  if (!match) return null;
  const urlMatch = match.match(/<([^>]+)>/);
  return urlMatch ? urlMatch[1] : null;
}

// Busca todas as páginas de um recurso (products, orders...) de uma loja.
async function fetchAllPages(store, path) {
  const token = await getAccessToken(store.shop, store.clientId, store.clientSecret);
  let url = `https://${store.shop}/admin/api/${API_VERSION}/${path}`;
  let items = [];
  let pages = 0;

  while (url && pages < MAX_PAGES) {
    const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    if (!res.ok) {
      throw new Error(`Shopify ${store.shop} ${path} → HTTP ${res.status}`);
    }
    const data = await res.json();
    const key = Object.keys(data)[0]; // "products" ou "orders"
    items = items.concat(data[key] ?? []);
    url = parseNextLink(res.headers.get("link"));
    pages += 1;
  }

  return items;
}

// Chamada única (sem paginação) — usado pro setup de webhooks.
async function shopifyFetch(store, path, options = {}) {
  const token = await getAccessToken(store.shop, store.clientId, store.clientSecret);
  const res = await fetch(`https://${store.shop}/admin/api/${API_VERSION}/${path}`, {
    ...options,
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Shopify ${store.shop} ${path} → HTTP ${res.status}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

module.exports = { fetchAllPages, shopifyFetch };

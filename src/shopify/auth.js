// Client credentials grant — fluxo atual da Shopify pra apps de uma loja só
// da própria organização. Troca client_id + client_secret por um
// access_token (expira, por isso o cache com expiração).
//
// Doc: POST https://{shop}/admin/oauth/access_token
//      { client_id, client_secret, grant_type: "client_credentials" }
//      → { access_token, expires_in, ... }

const tokenCache = new Map(); // shop -> { token, expiresAt }

async function getAccessToken(shop, clientId, clientSecret) {
  const cached = tokenCache.get(shop);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });

  if (!res.ok) {
    throw new Error(`Falha ao trocar credenciais por access_token (${shop}): HTTP ${res.status}`);
  }

  const data = await res.json();
  const expiresInMs = (data.expires_in ?? 3600) * 1000;
  // renova 1 minuto antes de expirar, pra não correr risco de usar token vencido
  tokenCache.set(shop, { token: data.access_token, expiresAt: Date.now() + expiresInMs - 60_000 });
  return data.access_token;
}

module.exports = { getAccessToken };

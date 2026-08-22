// Verifica a assinatura HMAC que o Shopify manda em todo webhook (header
// X-Shopify-Hmac-Sha256), calculada sobre o corpo cru da requisição usando o
// client_secret da loja. Sem isso, qualquer um poderia forjar um POST pro
// endpoint do webhook e disparar sync à toa.

const crypto = require("crypto");

function verifyHmac(rawBody, hmacHeader, secret) {
  if (!hmacHeader) return false;
  const digest = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");

  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { verifyHmac };

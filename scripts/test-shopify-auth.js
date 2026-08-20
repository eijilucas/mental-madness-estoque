// Testa rapidamente se as credenciais no .env conseguem trocar por um
// access_token de verdade. Rode com: node --env-file=.env scripts/test-shopify-auth.js

const { getAccessToken } = require("../src/shopify/auth");

async function test(label, shop, clientId, clientSecret) {
  if (!shop || !clientId || !clientSecret) {
    console.log(`${label}: faltando shop/clientId/secret no .env`);
    return;
  }
  try {
    const token = await getAccessToken(shop, clientId, clientSecret);
    console.log(`${label} (${shop}): OK — token começa com "${token.slice(0, 10)}..."`);
  } catch (err) {
    console.log(`${label} (${shop}): ERRO — ${err.message}`);
  }
}

async function main() {
  await test(
    "Básico",
    process.env.SHOPIFY_BASICO_SHOP,
    process.env.SHOPIFY_BASICO_CLIENT_ID,
    process.env.SHOPIFY_BASICO_SECRET
  );
  await test(
    "Exclusivo",
    process.env.SHOPIFY_EXCLUSIVO_SHOP,
    process.env.SHOPIFY_EXCLUSIVO_CLIENT_ID,
    process.env.SHOPIFY_EXCLUSIVO_SECRET
  );
}

main();

// Cliente HTTP mínimo pra API REST do Supabase (PostgREST) — sem dependência
// externa, só fetch, igual o resto do projeto faz com o Shopify.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function headers(extra = {}) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function isConfigured() {
  return Boolean(SUPABASE_URL && SERVICE_KEY);
}

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Supabase ${options.method || "GET"} ${path} → HTTP ${res.status}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function sbSelectAll(table) {
  return sbFetch(`${table}?select=*`);
}

// upsert (insere ou atualiza por conflito de PK)
async function sbUpsert(table, rows, onConflict) {
  if (!rows.length) return [];
  return sbFetch(`${table}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(rows),
  });
}

// deleta linhas cujo campo `column` esteja na lista `values`
async function sbDeleteIn(table, column, values) {
  if (!values.length) return;
  const list = values.map((v) => `"${String(v).replace(/"/g, '\\"')}"`).join(",");
  await sbFetch(`${table}?${column}=in.(${list})`, { method: "DELETE" });
}

module.exports = { isConfigured, sbSelectAll, sbUpsert, sbDeleteIn, sbFetch };

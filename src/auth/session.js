// Sessão baseada em cookie httpOnly guardando o access/refresh token do
// Supabase Auth. Nada de biblioteca de cookie — parse/serialize na mão.

const { refreshSession, getUser } = require("./supabaseAuth");

const AT_COOKIE = "mm_at";
const RT_COOKIE = "mm_rt";

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

// Vercel roda atrás de proxy HTTPS; local dev é HTTP simples e não aceita
// cookie "Secure". Detecta pelo host do request em vez de uma env var fixa.
function isHttps(req) {
  return req.headers["x-forwarded-proto"] === "https";
}

function setSessionCookies(req, res, session) {
  const secure = isHttps(req) ? "Secure; " : "";
  const cookies = [
    `${AT_COOKIE}=${encodeURIComponent(session.access_token)}; HttpOnly; ${secure}SameSite=Lax; Path=/; Max-Age=${session.expires_in}`,
    `${RT_COOKIE}=${encodeURIComponent(session.refresh_token)}; HttpOnly; ${secure}SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`,
  ];
  res.setHeader("Set-Cookie", cookies);
}

function clearSessionCookies(req, res) {
  const secure = isHttps(req) ? "Secure; " : "";
  res.setHeader("Set-Cookie", [
    `${AT_COOKIE}=; HttpOnly; ${secure}SameSite=Lax; Path=/; Max-Age=0`,
    `${RT_COOKIE}=; HttpOnly; ${secure}SameSite=Lax; Path=/; Max-Age=0`,
  ]);
}

// Retorna o usuário logado, renovando a sessão pelo refresh token se o
// access token já tiver expirado. Retorna null se não tiver sessão válida.
async function getSessionUser(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  if (!cookies[AT_COOKIE]) return null;

  const user = await getUser(cookies[AT_COOKIE]);
  if (user) return user;

  if (!cookies[RT_COOKIE]) return null;
  const refreshed = await refreshSession(cookies[RT_COOKIE]);
  if (!refreshed) return null;

  setSessionCookies(req, res, refreshed);
  return refreshed.user;
}

module.exports = { parseCookies, setSessionCookies, clearSessionCookies, getSessionUser };

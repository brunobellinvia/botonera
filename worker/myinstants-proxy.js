/* Botonera — intermediario para MyInstants y Freesound (Cloudflare Worker)

   MyInstants no habilita CORS, así que el navegador no deja que la app lea
   sus búsquedas ni sus MP3. Este worker los pide en nombre de la app y los
   devuelve con permiso para el origen de la app.

   Rutas:
     GET /                          → {ok:true}  (para probar la conexión)
     GET /search?q=texto&page=1     → {results:[{title, path, url, slug}], page, hasMore}
     GET /list?kind=trending&page=1 → mismo formato. kind: trending, best, recent o cat (con &cat=memes)
     GET /sound?path=/media/sounds/archivo.mp3  → el MP3

   Freesound (configuración en el README):
     GET /fs/search?q=texto&page=1&sort=score&short=1 → {results:[...], page, hasMore, count}
     GET /fs/preview?u=URL          → preescucha de cdn.freesound.org
     GET /fs/login?state=X          → inicia sesión en Freesound (OAuth2)
     GET /fs/callback               → vuelta de Freesound; guarda los tokens en KV
     GET /fs/claim?state=X          → la app retira su clave de sesión una vez que el login terminó
     GET /fs/status, /fs/logout     → estado y cierre de la sesión (header X-Botonera-Session)
     GET /fs/download?id=123        → archivo original (header X-Botonera-Session)

   Secretos y variables del worker (Settings → Variables and secrets):
     FREESOUND_KEY        "Client secret/Api key" de tus credenciales de Freesound (secreto)
     FREESOUND_CLIENT_ID  "Client id" de esas credenciales (solo para bajar originales)
     FS_KV                KV namespace vinculado (solo para bajar originales)

   Solo pide páginas de búsqueda, los listados de arriba y archivos de /media/sounds/ de myinstants.com,
   y la API, las preescuchas y las descargas de freesound.org: no sirve como proxy abierto para otros sitios. */

// Orígenes que pueden usar el worker. Agregá otros si abrís la app desde otra dirección.
const ALLOWED_ORIGINS = ["https://brunobellinvia.github.io"];

const BASE = "https://www.myinstants.com";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const PAGE_SIZE = 36;
const MAX_MP3_BYTES = 15 * 1024 * 1024;
// País de los listados de populares y "lo mejor"
const REGION = "ar";
// Categorías que existen en MyInstants (las únicas que acepta /list?kind=cat)
const CATEGORIES = ["anime & manga", "games", "memes", "movies", "music", "politics", "pranks", "reactions",
  "sound effects", "sports", "television", "tiktok trends", "viral", "whatsapp audios"];

const FS_API = "https://freesound.org/apiv2";
const FS_PAGE = 30;
const FS_MAX_BYTES = 40 * 1024 * 1024;
const FS_FIELDS = "id,name,tags,previews,duration,type,samplerate,license,username,filesize";
const FS_SORTS = ["score", "downloads_desc", "rating_desc", "created_desc", "duration_asc"];

export default {
  async fetch(req, env) {
    env = env || {};
    const url = new URL(req.url);
    const origin = req.headers.get("Origin");
    const cors = corsHeaders(origin);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405, cors);
    // Un pedido desde otro sitio web se rechaza; uno sin Origin (abrir la dirección a mano) se deja pasar para probar
    if (origin && !cors["Access-Control-Allow-Origin"]) return json({ error: "origin_not_allowed" }, 403, {});

    try {
      if (url.pathname === "/" || url.pathname === "") return json({ ok: true, service: "botonera-myinstants",
        freesound: { search: !!env.FREESOUND_KEY, originals: !!(env.FREESOUND_KEY && env.FREESOUND_CLIENT_ID && env.FS_KV) } }, 200, cors);
      if (url.pathname.indexOf("/fs/") === 0) return await freesound(url, req, env, cors);
      if (url.pathname === "/search") return await search(url, cors);
      if (url.pathname === "/list") return await list(url, cors);
      if (url.pathname === "/sound") return await sound(url, cors);
      return json({ error: "not_found" }, 404, cors);
    } catch (e) {
      return json({ error: "upstream_failed", detail: String(e && e.message || e) }, 502, cors);
    }
  }
};

async function search(url, cors) {
  const q = (url.searchParams.get("q") || "").trim().slice(0, 80);
  const page = clampInt(url.searchParams.get("page"), 1, 50, 1);
  if (!q) return json({ results: [], page, hasMore: false }, 200, cors);

  // MyInstants responde 404 cuando la búsqueda o la página no tienen resultados; fetchList lo devuelve como lista vacía
  return await fetchList(BASE + "/en/search/?name=" + encodeURIComponent(q) + (page > 1 ? "&page=" + page : ""), page, cors);
}

async function list(url, cors) {
  const kind = url.searchParams.get("kind") || "trending";
  const page = clampInt(url.searchParams.get("page"), 1, 200, 1);
  let path;
  if (kind === "trending") path = "/en/trending/" + REGION + "/";
  else if (kind === "best") path = "/en/best_of_all_time/" + REGION + "/";
  else if (kind === "recent") path = "/en/recent/";
  else if (kind === "cat") {
    const cat = (url.searchParams.get("cat") || "").toLowerCase();
    if (CATEGORIES.indexOf(cat) < 0) return json({ error: "bad_category" }, 400, cors);
    path = "/en/categories/" + encodeURIComponent(cat) + "/" + REGION + "/";
  } else return json({ error: "bad_kind" }, 400, cors);
  return await fetchList(BASE + path + (page > 1 ? "?page=" + page : ""), page, cors);
}

async function fetchList(target, page, cors) {
  const r = await fetch(target, {
    headers: { "User-Agent": UA, "Accept": "text/html", "Accept-Language": "es-AR,es;q=0.9,en;q=0.8" },
    cf: { cacheTtl: 600, cacheEverything: true }
  });
  if (r.status === 404) return json({ results: [], page, hasMore: false }, 200, cors);
  if (!r.ok) return json({ error: "upstream_status", status: r.status }, 502, cors);
  const results = parseResults(await r.text());
  return json({ results, page, hasMore: results.length >= PAGE_SIZE }, 200,
    Object.assign({ "Cache-Control": "public, max-age=600" }, cors));
}

async function sound(url, cors) {
  const path = url.searchParams.get("path") || "";
  if (!isSoundPath(path)) return json({ error: "bad_path" }, 400, cors);

  const r = await fetch(BASE + encodeURI(path), {
    headers: { "User-Agent": UA, "Referer": BASE + "/" },
    cf: { cacheTtl: 86400, cacheEverything: true }
  });
  if (!r.ok) return json({ error: "upstream_status", status: r.status }, 502, cors);
  const len = r.headers.get("Content-Length");
  if (len && Number(len) > MAX_MP3_BYTES) return json({ error: "too_big" }, 413, cors);

  const h = new Headers(cors);
  h.set("Content-Type", "audio/mpeg");
  h.set("Cache-Control", "public, max-age=86400");
  if (len) h.set("Content-Length", len);
  return new Response(r.body, { status: 200, headers: h });
}

/* Cada resultado del HTML de búsqueda tiene esta forma:
   <div class="instant"> … <button class="small-button" onclick="play('/media/sounds/x.mp3', 'loader-1', 'slug')" …>
   … <a href="/en/instant/slug/" class="instant-link link-secondary">Título</a> … */
export function parseResults(html) {
  const out = [];
  const seen = new Set();
  const blocks = html.split('<div class="instant">').slice(1);
  for (const b of blocks) {
    const m = b.match(/play\('([^']+)'/);
    const t = b.match(/class="instant-link[^"]*"[^>]*>([\s\S]*?)<\/a>/);
    if (!m || !t) continue;
    const path = decodeEntities(m[1]);
    if (!isSoundPath(path) || seen.has(path)) continue;
    seen.add(path);
    const slug = (b.match(/href="\/[a-z-]+\/instant\/([^"\/]+)\/?"/) || [])[1] || "";
    const title = decodeEntities(t[1].replace(/<[^>]*>/g, "").trim()) || slug;
    out.push({ title, path, url: BASE + encodeURI(path), slug });
  }
  return out;
}

export function isSoundPath(p) {
  return typeof p === "string" && p.length < 300 && /^\/media\/sounds\/[^\/?#\\]+\.mp3$/i.test(p) && p.indexOf("..") < 0;
}

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function corsHeaders(origin) {
  const h = { "Vary": "Origin" };
  if (origin && (ALLOWED_ORIGINS.indexOf(origin) >= 0 || ALLOWED_ORIGINS.indexOf("*") >= 0)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "GET, OPTIONS";
    h["Access-Control-Allow-Headers"] = "X-Botonera-Session";
    h["Access-Control-Expose-Headers"] = "X-Sound-Type, X-Sound-Name";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}

function json(obj, status, headers) {
  const h = new Headers(headers || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(obj), { status, headers: h });
}

function clampInt(v, lo, hi, def) {
  const n = parseInt(v, 10);
  return isNaN(n) ? def : Math.max(lo, Math.min(hi, n));
}

/* ---------------- Freesound ---------------- */

async function freesound(url, req, env, cors) {
  const p = url.pathname;
  if (!env.FREESOUND_KEY) return json({ error: "freesound_not_configured" }, 503, cors);
  if (p === "/fs/search") return await fsSearch(url, env, cors);
  if (p === "/fs/preview") return await fsPreview(url, cors);
  const oauth = !!(env.FREESOUND_CLIENT_ID && env.FS_KV);
  if (!oauth) return json({ error: "originals_not_configured" }, 503, cors);
  if (p === "/fs/login") return fsLogin(url, env);
  if (p === "/fs/callback") return await fsCallback(url, env);
  if (p === "/fs/claim") return await fsClaim(url, env, cors);
  const session = req.headers.get("X-Botonera-Session") || "";
  const valid = /^[a-f0-9]{64}$/.test(session) && !!(await env.FS_KV.get("session:" + session));
  if (p === "/fs/status") {
    if (!valid) return json({ connected: false }, 200, cors);
    const me = await fsAuthed(env, FS_API + "/me/").catch(() => null);
    const info = me && me.ok ? await me.json().catch(() => ({})) : {};
    return json({ connected: !!(me && me.ok), user: info.username || null }, 200, cors);
  }
  if (!valid) return json({ error: "not_connected" }, 401, cors);
  if (p === "/fs/logout") { await env.FS_KV.delete("session:" + session); return json({ ok: true }, 200, cors); }
  if (p === "/fs/download") return await fsDownload(url, env, cors);
  return json({ error: "not_found" }, 404, cors);
}

async function fsSearch(url, env, cors) {
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const page = clampInt(url.searchParams.get("page"), 1, 100, 1);
  let sort = url.searchParams.get("sort") || "score";
  if (FS_SORTS.indexOf(sort) < 0) sort = "score";
  const filters = [];
  if (url.searchParams.get("short") === "1") filters.push("duration:[0 TO 10]");
  const qs = new URLSearchParams({ query: q, page: String(page), page_size: String(FS_PAGE), fields: FS_FIELDS, sort });
  if (filters.length) qs.set("filter", filters.join(" "));
  const headers = { "Authorization": "Token " + env.FREESOUND_KEY, "Accept": "application/json" };
  // La documentación actual usa /search/; las versiones anteriores, /search/text/
  let r = await fetch(FS_API + "/search/?" + qs, { headers, cf: { cacheTtl: 600, cacheEverything: true } });
  if (r.status === 404) r = await fetch(FS_API + "/search/text/?" + qs, { headers, cf: { cacheTtl: 600, cacheEverything: true } });
  if (r.status === 401 || r.status === 403) return json({ error: "freesound_key_rejected" }, 502, cors);
  if (r.status === 429) return json({ error: "freesound_rate_limited" }, 429, cors);
  if (!r.ok) return json({ error: "upstream_status", status: r.status }, 502, cors);
  const d = await r.json();
  const results = (d.results || []).map(fsItem).filter(Boolean);
  return json({ results, page, hasMore: !!d.next, count: d.count || results.length }, 200,
    Object.assign({ "Cache-Control": "public, max-age=600" }, cors));
}

export function fsItem(x) {
  if (!x || !x.id || !x.previews) return null;
  const pv = x.previews["preview-hq-mp3"] || x.previews["preview-lq-mp3"];
  if (!pv) return null;
  return {
    source: "freesound", id: x.id, path: "fs:" + x.id, title: String(x.name || x.id).replace(/\.(wav|aiff?|flac|mp3|ogg|m4a)$/i, ""),
    preview: pv, duration: x.duration || 0, type: x.type || "", samplerate: x.samplerate || 0,
    license: fsLicense(x.license), user: x.username || "", filesize: x.filesize || 0,
    tags: Array.isArray(x.tags) ? x.tags.slice(0, 6).map(String) : []
  };
}
function fsLicense(l) {
  l = String(l || "");
  if (/publicdomain\/zero|Creative Commons 0/i.test(l)) return "CC0";
  if (/by-nc|NonCommercial/i.test(l)) return "CC BY-NC";
  if (/sampling\+/i.test(l)) return "Sampling+";
  if (/\/by\/|Attribution/i.test(l)) return "CC BY";
  return l ? "Otra" : "";
}
export function isFsPreview(u) {
  try {
    const x = new URL(u);
    return x.protocol === "https:" && ((x.hostname === "cdn.freesound.org" && x.pathname.indexOf("/previews/") === 0) ||
      (x.hostname === "freesound.org" && x.pathname.indexOf("/data/previews/") === 0)) && /\.(mp3|ogg)$/i.test(x.pathname);
  } catch (e) { return false; }
}
async function fsPreview(url, cors) {
  const u = url.searchParams.get("u") || "";
  if (!isFsPreview(u)) return json({ error: "bad_preview" }, 400, cors);
  const r = await fetch(u, { cf: { cacheTtl: 86400, cacheEverything: true } });
  if (!r.ok) return json({ error: "upstream_status", status: r.status }, 502, cors);
  const h = new Headers(cors);
  h.set("Content-Type", /\.ogg$/i.test(u) ? "audio/ogg" : "audio/mpeg");
  h.set("Cache-Control", "public, max-age=86400");
  return new Response(r.body, { status: 200, headers: h });
}

/* Login: la app abre /fs/login con un state al azar y después consulta /fs/claim con ese mismo state.
   Así funciona aunque el login se haga en Safari y la app esté instalada en la pantalla de inicio,
   que en iOS tienen almacenamientos separados. */
function fsLogin(url, env) {
  const state = url.searchParams.get("state") || "";
  if (!/^[a-z0-9]{24,64}$/.test(state)) return new Response("Pedido inválido.", { status: 400 });
  const q = new URLSearchParams({ client_id: env.FREESOUND_CLIENT_ID, response_type: "code", state });
  return Response.redirect(FS_API + "/oauth2/authorize/?" + q, 302);
}
async function fsCallback(url, env) {
  const code = url.searchParams.get("code"), state = url.searchParams.get("state") || "";
  if (url.searchParams.get("error")) return page("No se conectó", "Cancelaste el permiso en Freesound. Podés volver a la Botonera e intentar de nuevo.");
  if (!code || !/^[a-z0-9]{24,64}$/.test(state)) return page("No se conectó", "Faltan datos en la respuesta de Freesound. Probá de nuevo desde la Botonera.");
  const tok = await fsToken(env, { grant_type: "authorization_code", code });
  if (!tok) return page("No se conectó", "Freesound no aceptó el código. Revisá que FREESOUND_CLIENT_ID y FREESOUND_KEY sean de las mismas credenciales.");
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
  const session = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  await env.FS_KV.put("session:" + session, "1");
  await env.FS_KV.put("pair:" + state, session, { expirationTtl: 900 });
  return page("Freesound conectado", "Listo. Volvé a la Botonera: en unos segundos aparece como conectada.");
}
async function fsClaim(url, env, cors) {
  const state = url.searchParams.get("state") || "";
  if (!/^[a-z0-9]{24,64}$/.test(state)) return json({ error: "bad_state" }, 400, cors);
  const session = await env.FS_KV.get("pair:" + state);
  if (!session) return json({ pending: true }, 200, cors);
  await env.FS_KV.delete("pair:" + state);
  return json({ session }, 200, cors);
}
async function fsToken(env, params) {
  const body = new URLSearchParams(Object.assign({ client_id: env.FREESOUND_CLIENT_ID, client_secret: env.FREESOUND_KEY }, params));
  const r = await fetch(FS_API + "/oauth2/access_token/", { method: "POST", body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  if (!r.ok) return null;
  const t = await r.json().catch(() => null);
  if (!t || !t.access_token) return null;
  const auth = { access: t.access_token, refresh: t.refresh_token, exp: Date.now() + ((t.expires_in || 86400) - 120) * 1000 };
  await env.FS_KV.put("auth", JSON.stringify(auth));
  return auth;
}
/* Pedido a la API con el token de usuario; lo renueva si venció */
async function fsAuthed(env, target, init) {
  let auth = JSON.parse((await env.FS_KV.get("auth")) || "null");
  if (!auth) throw new Error("no_auth");
  if (Date.now() > auth.exp) auth = await fsToken(env, { grant_type: "refresh_token", refresh_token: auth.refresh });
  if (!auth) throw new Error("refresh_failed");
  const go = a => fetch(target, Object.assign({}, init || {}, { headers: { "Authorization": "Bearer " + a.access } }));
  let r = await go(auth);
  if (r.status === 401) {
    auth = await fsToken(env, { grant_type: "refresh_token", refresh_token: auth.refresh });
    if (!auth) return r;
    r = await go(auth);
  }
  return r;
}
async function fsDownload(url, env, cors) {
  const id = url.searchParams.get("id") || "";
  if (!/^\d{1,10}$/.test(id)) return json({ error: "bad_id" }, 400, cors);
  const info = await fetch(FS_API + "/sounds/" + id + "/?fields=name,type,filesize",
    { headers: { "Authorization": "Token " + env.FREESOUND_KEY } }).then(r => r.ok ? r.json() : null).catch(() => null);
  if (info && info.filesize > FS_MAX_BYTES) return json({ error: "too_big", filesize: info.filesize }, 413, cors);
  let r;
  try { r = await fsAuthed(env, FS_API + "/sounds/" + id + "/download/"); }
  catch (e) { return json({ error: "not_connected" }, 401, cors); }
  if (r.status === 401) return json({ error: "not_connected" }, 401, cors);
  if (!r.ok) return json({ error: "upstream_status", status: r.status }, 502, cors);
  const h = new Headers(cors);
  const type = (info && info.type) || "";
  h.set("Content-Type", r.headers.get("Content-Type") || "application/octet-stream");
  h.set("X-Sound-Type", type);
  if (info && info.name) h.set("X-Sound-Name", encodeURIComponent(info.name));
  const len = r.headers.get("Content-Length"); if (len) h.set("Content-Length", len);
  return new Response(r.body, { status: 200, headers: h });
}
function page(title, text) {
  const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(title) + '</title><body style="margin:0;background:#141518;color:#e9e6df;font:18px/1.4 -apple-system,Helvetica,sans-serif;padding:40px 24px">' +
    '<h1 style="font-size:26px;margin:0 0 12px">' + esc(title) + '</h1><p style="max-width:32em;color:#c9c6bf">' + esc(text) + '</p></body>',
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/* Botonera — intermediario para MyInstants (Cloudflare Worker)

   MyInstants no habilita CORS, así que el navegador no deja que la app lea
   sus búsquedas ni sus MP3. Este worker los pide en nombre de la app y los
   devuelve con permiso para el origen de la app.

   Rutas:
     GET /                          → {ok:true}  (para probar la conexión)
     GET /search?q=texto&page=1     → {results:[{title, path, url, slug}], page, hasMore}
     GET /list?kind=trending&page=1 → mismo formato. kind: trending, best, recent o cat (con &cat=memes)
     GET /sound?path=/media/sounds/archivo.mp3  → el MP3

   Solo pide páginas de búsqueda, los listados de arriba y archivos de /media/sounds/ de myinstants.com:
   no sirve como proxy abierto para otros sitios. */

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

export default {
  async fetch(req) {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin");
    const cors = corsHeaders(origin);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405, cors);
    // Un pedido desde otro sitio web se rechaza; uno sin Origin (abrir la dirección a mano) se deja pasar para probar
    if (origin && !cors["Access-Control-Allow-Origin"]) return json({ error: "origin_not_allowed" }, 403, {});

    try {
      if (url.pathname === "/" || url.pathname === "") return json({ ok: true, service: "botonera-myinstants" }, 200, cors);
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

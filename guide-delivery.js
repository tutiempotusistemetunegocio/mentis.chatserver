// Módulo 04 → entrega de guías gratis vía ManyChat (9/9/2026, pedido
// explícito de Rodrigo: "falta el ManyChat... para que el sistema ya
// comience, la gente tenga acceso a las guías y pague").
//
// El catálogo de guías (weekly-guides.js) ya arma el contenido y lo deja
// guardado en Dropbox — este módulo es la pieza que faltaba para que ese
// contenido le llegue de verdad a alguien: cuando una persona comenta la
// palabra clave (ej. "MENTIS") en una publicación de Instagram, ManyChat
// dispara un pedido a este servidor, que elige una guía gratis que esa
// persona todavía no recibió y la manda de vuelta lista para insertar en el
// DM. El mismo pedido sirve también para el reenganche cada 15 días (Módulo
// 04, "sin repetir nunca una guía ya enviada a ese mismo cliente") — no hace
// falta ninguna ruta nueva para eso, ManyChat solo tiene que llamar de
// vuelta a la misma con el mismo subscriberId.
//
// Importante, por seguridad: la guía en sí (el PDF) se sirve desde una URL
// PÚBLICA sin secreto (GET /guia/<id>, ver server.js) porque va a viajar
// dentro de un DM de Instagram a cualquiera que haya comentado — no puede
// llevar el secreto del panel personal de Rodrigo (eso expondría todo su
// panel privado a cualquier desconocido). Por eso esta ruta pública SOLO
// sirve guías con tipo:"gratis" — nunca una premium, aunque alguien
// adivinara o probara un id premium a mano.
//
// Qué NO hace todavía, a propósito: no manda nada por su cuenta (ManyChat es
// quien dispara el pedido y arma el DM) y no resuelve el acceso a las guías
// PREMIUM para quien ya pagó — hoy el pago (Systeme.io) solo habilita el
// chat conversacional (/chat), no una lectura de guías premium fuera del
// panel privado de Rodrigo. Si hace falta eso, es un módulo aparte.

const { getDropboxAccessToken } = require('./dropbox-auth');

const GUIDES_FOLDER = process.env.DROPBOX_GUIDES_FOLDER || '/mentis-guias';
const CONTENT_FOLDER = process.env.DROPBOX_CONTENT_FOLDER || '/mentis-contenido';
const HISTORY_PATH = `${GUIDES_FOLDER}/manychat-history.json`;
// Qué guía le tocó "hoy" al reel del día — ver guiaDelReelDeHoy() más abajo.
const REEL_GUIDE_CACHE_PATH = `${GUIDES_FOLDER}/guia-del-reel-hoy.json`;
const FETCH_TIMEOUT_MS = 20000;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

async function dropboxDownloadJSON(token, dropboxPath, fallback) {
  try {
    const res = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath }) },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return fallback;
    return JSON.parse(await res.text());
  } catch {
    return fallback;
  }
}

async function dropboxDownloadBinary(token, dropboxPath) {
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath }) },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} descargando ${dropboxPath}`);
  return Buffer.from(await res.arrayBuffer());
}

async function dropboxUpload(token, dropboxPath, buffer) {
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath, mode: 'overwrite', mute: true }),
      'Content-Type': 'application/octet-stream',
    },
    body: buffer,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} subiendo ${dropboxPath}`);
}

// Elige, para un subscriptor puntual de ManyChat, la próxima guía gratis que
// todavía no le mandamos — al azar entre las candidatas (pedido explícito
// de Rodrigo, 2/9/2026: "una guía al azar del catálogo, sin repetir"). Si ya
// le mandamos TODAS las gratis que existen hoy (catálogo chico todavía, o
// alguien muy activo con el reenganche), en vez de fallar se le puede volver
// a repetir una — se prefiere eso a dejarlo sin nada, y el catálogo sigue
// creciendo 2+ por semana así que esto se resuelve solo con el tiempo.
async function pickGuideForSubscriber(baseUrl, subscriberId) {
  const token = await getDropboxAccessToken();
  const [catalog, history] = await Promise.all([
    dropboxDownloadJSON(token, `${GUIDES_FOLDER}/guide-catalog.json`, { entries: [] }),
    dropboxDownloadJSON(token, HISTORY_PATH, { bySubscriber: {} }),
  ]);

  const gratisConPdf = catalog.entries.filter((e) => e.tipo === 'gratis' && e.archivoPdf);
  if (gratisConPdf.length === 0) {
    return { ok: false, error: 'Todavía no hay ninguna guía gratis con PDF cargada en el catálogo.' };
  }

  if (!history.bySubscriber || typeof history.bySubscriber !== 'object') history.bySubscriber = {};
  const yaEnviadas = new Set(history.bySubscriber[subscriberId] || []);
  const candidatas = gratisConPdf.filter((e) => !yaEnviadas.has(e.id));
  const pool = candidatas.length > 0 ? candidatas : gratisConPdf; // catálogo agotado para este subscriptor: se permite repetir antes que no mandar nada
  const chosen = pool[Math.floor(Math.random() * pool.length)];

  const enviadasNuevas = Array.from(new Set([...yaEnviadas, chosen.id]));
  history.bySubscriber[subscriberId] = enviadasNuevas;
  try {
    await dropboxUpload(token, HISTORY_PATH, Buffer.from(JSON.stringify(history, null, 2)));
  } catch (err) {
    // No perdés la entrega por esto — la guía ya se eligió y se puede mandar
    // igual; en el peor caso, si esta escritura falla seguido, alguien
    // puede recibir una guía repetida antes de lo esperado. Se avisa en el
    // log de Render para poder notarlo si pasa seguido.
    console.error('No se pudo guardar manychat-history.json (la guía se manda igual):', err.message);
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/guia/${encodeURIComponent(chosen.id)}`;
  return {
    ok: true,
    id: chosen.id,
    titulo: chosen.titulo,
    url,
    mensaje: `${chosen.titulo}: ${url}`,
  };
}

// Sirve el PDF de una guía puntual por su id, SIN secreto — pensada para
// viajar en un DM a cualquiera. Por eso valida explícitamente tipo:"gratis":
// nunca sirve una guía premium por esta ruta, sin importar qué id se pida.
async function servePublicGuidePdf(id) {
  const token = await getDropboxAccessToken();
  const catalog = await dropboxDownloadJSON(token, `${GUIDES_FOLDER}/guide-catalog.json`, { entries: [] });
  const entry = catalog.entries.find((e) => e.id === id);
  if (!entry || entry.tipo !== 'gratis' || !entry.archivoPdf) return null;
  return dropboxDownloadBinary(token, `${GUIDES_FOLDER}/${entry.tipo}/${entry.archivoPdf}`);
}

// Le pide a Mentis que elija, entre las guías gratis existentes, la que
// mejor combina como siguiente paso después de ver el reel de hoy — no
// necesita ser un match perfecto de tema, solo la más cercana. `null` si no
// hay ANTHROPIC_API_KEY o si la llamada falla por cualquier motivo (el
// llamador cae a elegir una al azar en ese caso, nunca deja a alguien sin
// guía por esto).
async function pedirleAMentisQueElijaLaGuia(anguloHoy, guionHoy, candidatas) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const lista = candidatas.map((g) => `- id:"${g.id}" | título: "${g.titulo}" | categorías: ${(g.categorias || []).join(' + ')}`).join('\n');
  const prompt = `El reel de hoy tiene este ángulo/gancho: "${anguloHoy || ''}"${guionHoy ? `\n\nGuion completo (para más contexto):\n${guionHoy.slice(0, 800)}` : ''}\n\nDe esta lista de guías gratis ya existentes en el catálogo, elegí la que mejor funciona como siguiente paso lógico para alguien que acaba de ver este reel y quiere profundizar — no hace falta un match perfecto de tema, solo la más cercana de las disponibles:\n${lista}\n\nDevolvé SOLO un objeto JSON, sin texto antes ni después, con esta forma exacta: {"id": "<el id elegido, copiado tal cual de la lista de arriba>"}`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const data = await res.json();
    if (!res.ok) return null;
    const raw = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.id || null;
  } catch {
    return null;
  }
}

// "La guía del reel" (9/9/2026, pedido explícito de Rodrigo: "también tienen
// que recibir la guía del reel" — además de la guía cero, que ya se manda
// como link fijo desde /guia-cero, ver server.js). A diferencia de
// pickGuideForSubscriber (arriba, pensada para que cada PERSONA reciba una
// guía distinta sin repetir, y por eso necesita el flujo completo de
// ManyChat con External Request), esta es la MISMA para cualquiera que
// comente HOY — la guía del catálogo que mejor combina con el reel de hoy —
// así que se puede servir como un link FIJO simple (GET /guia-del-reel, sin
// parámetros), compatible con el asistente rápido de ManyChat que solo
// acepta links fijos.
//
// Se recalcula UNA vez por día, no en cada pedido: guarda la elección en
// guia-del-reel-hoy.json (misma carpeta que el catálogo) junto con la fecha,
// y solo le vuelve a preguntar a Mentis cuál combina mejor cuando cambia el
// día — evita gastar una llamada a la API de Claude por cada persona que
// comenta el mismo día.
async function guiaDelReelDeHoy() {
  const token = await getDropboxAccessToken();
  const dateStr = todayUTC();

  const catalog = await dropboxDownloadJSON(token, `${GUIDES_FOLDER}/guide-catalog.json`, { entries: [] });
  const gratisConPdf = catalog.entries.filter((e) => e.tipo === 'gratis' && e.archivoPdf);
  if (gratisConPdf.length === 0) {
    return { ok: false, error: 'Todavía no hay ninguna guía gratis con PDF cargada en el catálogo.' };
  }

  const cache = await dropboxDownloadJSON(token, REEL_GUIDE_CACHE_PATH, null);
  if (cache && cache.date === dateStr && cache.guideId) {
    const cached = gratisConPdf.find((g) => g.id === cache.guideId);
    if (cached) return { ok: true, id: cached.id, titulo: cached.titulo };
  }

  // Hay que elegir de nuevo — buscar el reel de hoy (o, si todavía no corrió
  // el guion diario, el más reciente que haya) en el historial de contenido.
  const history = await dropboxDownloadJSON(token, `${CONTENT_FOLDER}/content-history.json`, { entries: [] });
  const reelesRecientes = history.entries.filter((e) => e.tipo === 'reel').slice(-8).reverse();
  const reelHoy = reelesRecientes.find((e) => e.date === dateStr) || reelesRecientes[0] || null;

  let chosenId = null;
  if (reelHoy) {
    chosenId = await pedirleAMentisQueElijaLaGuia(reelHoy.angulo, reelHoy.guion, gratisConPdf);
  }
  const chosen = gratisConPdf.find((g) => g.id === chosenId) || gratisConPdf[Math.floor(Math.random() * gratisConPdf.length)];

  try {
    await dropboxUpload(token, REEL_GUIDE_CACHE_PATH, Buffer.from(JSON.stringify({ date: dateStr, guideId: chosen.id }, null, 2)));
  } catch (err) {
    // No perdés la entrega por esto — la guía ya se eligió y se sirve igual;
    // en el peor caso, si esta escritura falla seguido, se le vuelve a
    // preguntar a Mentis en cada pedido del mismo día (más gasto de API,
    // nunca un error para quien comentó).
    console.error('No se pudo guardar guia-del-reel-hoy.json (la guía se sirve igual):', err.message);
  }

  return { ok: true, id: chosen.id, titulo: chosen.titulo };
}

// Sirve directamente el PDF de la guía del reel de hoy — la ruta pública que
// llama server.js (GET /guia-del-reel, sin secreto, mismo criterio de
// seguridad que /guia-cero: es contenido gratis pensado para repartirse).
async function servePublicTodayReelGuidePdf() {
  const result = await guiaDelReelDeHoy();
  if (!result.ok) return null;
  return servePublicGuidePdf(result.id);
}

// Página combinada de las dos guías (9/9/2026). Contexto: Rodrigo confirmó
// en vivo que el asistente rápido de ManyChat ("Quick Automation") solo deja
// pegar UN link fijo en el mensaje final — ni al crearlo ni clickeando
// "Edit" después aparece un editor más completo (su reporte textual: "en
// edit, es la misma cosa. No aparece nada"). En vez de seguir buscando un
// rincón de ManyChat que acepte un segundo link, esta página da vuelta el
// problema: es UNA sola URL —la que sí entra en el único campo de link que
// ManyChat ofrece— que muestra los DOS links (guía cero + guía del reel de
// hoy) para que la persona toque los que quiera. Rodrigo solo tiene que
// cambiar, en la automatización que ya tiene funcionando, el link pegado en
// "a DM with a link" de "https://.../guia-cero" a
// "https://.../guias-de-hoy" — mismo campo, mismo botón, un solo click para
// editarlo, nada nuevo que buscar en la interfaz de ManyChat.
async function renderGuiasDeHoyHtml(baseUrl) {
  const base = baseUrl.replace(/\/+$/, '');
  let tituloReel = 'La guía de hoy';
  try {
    const info = await guiaDelReelDeHoy();
    if (info.ok && info.titulo) tituloReel = info.titulo;
  } catch {
    // Si falla (Dropbox lento, catálogo vacío, etc.) se muestra un título
    // genérico — el link de abajo sigue funcionando igual, nunca se rompe
    // la página entera por esto.
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tus guías de Mentis</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:32px 20px; background:#0f1115; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .card { max-width:420px; width:100%; }
  h1 { color:#fff; font-size:22px; margin:0 0 8px; }
  p.sub { color:#9aa3af; font-size:15px; margin:0 0 28px; line-height:1.4; }
  a.btn { display:block; text-decoration:none; background:#fff; color:#0f1115; border-radius:14px; padding:18px 20px; margin-bottom:14px; font-weight:600; font-size:16px; }
  a.btn span.tag { display:block; font-weight:400; font-size:13px; color:#6b7280; margin-top:4px; }
  a.btn.alt { background:#7c5cff; color:#fff; }
  a.btn.alt span.tag { color:#e4ddff; }
</style>
</head>
<body>
  <div class="card">
    <h1>¡Acá tenés tus guías! 🎁</h1>
    <p class="sub">Son gratis — descargá las dos.</p>
    <a class="btn" href="${base}/guia-cero">📘 Guía Cero<span class="tag">El sistema completo, paso a paso</span></a>
    <a class="btn alt" href="${base}/guia-del-reel">🎯 ${esc(tituloReel)}<span class="tag">La guía del reel de hoy</span></a>
  </div>
</body>
</html>`;
}

// Guías dentro del chat premium (9/9/2026, pedido explícito de Rodrigo:
// "gente tiene que tener acceso a las guías premium... cuando tiene acceso
// al chat, también tiene que tener automáticamente acceso a las guías
// premium... ponelo dentro del propio chat, guías, y ya"). A diferencia de
// servePublicGuidePdf (arriba, SOLO gratis — viaja sin protección por DM),
// acá quien pide ya pasó el mismo chequeo de acceso premium que protege
// POST /chat (mismo email, ver server.js), así que puede ver y leer
// CUALQUIER guía del catálogo, gratis o premium — no hace falta un acceso
// separado ni que Rodrigo configure nada aparte.
async function listAllGuidesForPremiumChat() {
  const token = await getDropboxAccessToken();
  const catalog = await dropboxDownloadJSON(token, `${GUIDES_FOLDER}/guide-catalog.json`, { entries: [] });
  return catalog.entries
    .filter((e) => e.archivoPdf)
    .map((e) => ({
      id: e.id, titulo: e.titulo, tipo: e.tipo, categorias: e.categorias || [],
    }))
    // Los ids empiezan con la fecha (ver weekly-guides.js) — orden
    // descendente simple deja las guías más nuevas primero, sin depender de
    // un campo de fecha aparte.
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

async function serveGuidePdfForPremiumChat(id) {
  const token = await getDropboxAccessToken();
  const catalog = await dropboxDownloadJSON(token, `${GUIDES_FOLDER}/guide-catalog.json`, { entries: [] });
  const entry = catalog.entries.find((e) => e.id === id);
  if (!entry || !entry.archivoPdf) return null;
  return dropboxDownloadBinary(token, `${GUIDES_FOLDER}/${entry.tipo}/${entry.archivoPdf}`);
}

module.exports = {
  pickGuideForSubscriber,
  servePublicGuidePdf,
  guiaDelReelDeHoy,
  servePublicTodayReelGuidePdf,
  renderGuiasDeHoyHtml,
  listAllGuidesForPremiumChat,
  serveGuidePdfForPremiumChat,
};

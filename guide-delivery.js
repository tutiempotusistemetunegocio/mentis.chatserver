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
const HISTORY_PATH = `${GUIDES_FOLDER}/manychat-history.json`;
const FETCH_TIMEOUT_MS = 20000;

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

module.exports = { pickGuideForSubscriber, servePublicGuidePdf };

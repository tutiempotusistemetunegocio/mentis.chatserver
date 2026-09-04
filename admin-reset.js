// Módulo 08 → herramienta puntual de administración, NO recurrente. Pedido
// explícito de Rodrigo (4/9/2026): "quiero que borres todas las guías y la
// vamos a hacer otra vez todo de nuevo con el nuevo mindset que tiene el
// sistema" — alcance confirmado con él antes de tocar nada real en Dropbox:
// guías + contenido diario + el registro de qué fotos ya se usaron (nunca
// las fotos en sí, ni sus descripciones ya generadas, ni /knowledge).
//
// Por qué esto corre DENTRO de mentis-chat-server (Render) y no desde la
// sesión de Cowork que lo escribió: esta sesión no tiene ningún acceso a
// Dropbox — las credenciales viven solo en las variables de entorno de
// Render. Mismo patrón que el resto del sistema: se expone como una ruta
// protegida (`POST /internal/admin-reset-content`, ver server.js) y se
// dispara una sola vez a mano desde GitHub Actions, nunca desde acá.
//
// Qué borra, y qué NO borra — la línea se trazó a propósito:
//  - Guías: TODOS los archivos (.md y .pdf) que haya bajo /mentis-guias
//    (gratis y premium), listado recursivo. `guide-catalog.json` no se
//    borra como archivo — se sobreescribe con {entries: []}, más simple que
//    dejar la carpeta sin ese archivo y que algo asuma que existe.
//  - Contenido diario: TODOS los archivos que haya bajo /mentis-contenido
//    (guiones .md de reel/carrusel/podcast, y los clips .mp4 ya
//    descargados). `content-history.json` y `video-history.json` se
//    resetean juntos a {entries: []} — se resetean los dos a la vez porque
//    cada entrada de video-history referencia una fecha/ángulo de
//    content-history; dejar vivo uno de los dos con fechas viejas that ya no
//    existen del otro lado generaría entradas fantasma en el panel.
//  - Fotos: acá NO se borra nada de lo caro de rehacer — ni las fotos en sí
//    ni `photo-catalog.json` (las descripciones ya generadas, una llamada a
//    Claude visión por foto). Solo se resetea `photo-history.json` a
//    {entries: []}, así la regla de "no repetir una foto usada en los
//    últimos 15 días" arranca de cero sin perder ese trabajo ya hecho.
//  - Conocimiento (/knowledge — reglas.md, categorías, ajustes de
//    estrategia, oportunidades de monetización): esto NO TOCA NADA acá.
//    Rodrigo no lo pidió, y es exactamente lo que el sistema nunca tiene que
//    perder (ver reglas.md: "nunca pierde lo que aprendió").
//
// Después de esto, no hace falta tocar nada más a mano: la próxima corrida
// de "weekly-guides" (Módulo 02) y de "daily-script"/"daily-photo" (Módulo
// 03) bajan de Dropbox estos mismos JSON vacíos al arrancar (mismo patrón de
// siempre) y generan todo de nuevo desde cero, ya con el cierre de venta, la
// rotación de ángulos y el resto del "mindset" nuevo incorporado.

const { getDropboxAccessToken } = require('./dropbox-auth');

const GUIDES_FOLDER = process.env.DROPBOX_GUIDES_FOLDER || '/mentis-guias';
const CONTENT_FOLDER = process.env.DROPBOX_CONTENT_FOLDER || '/mentis-contenido';
const MEDIA_FOLDER = process.env.DROPBOX_MEDIA_FOLDER || '/mentis-medios';

const FETCH_TIMEOUT_MS = 20000;

async function dropboxListFolderRecursive(token, folderPath) {
  let entries = [];
  let res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ path: folderPath, recursive: true }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  let data = await res.json();
  if (!res.ok) {
    const summary = data.error_summary || `HTTP ${res.status}`;
    if (summary.startsWith('path/not_found')) return []; // la carpeta todavía no existe — nada que borrar
    throw new Error(summary);
  }
  entries = entries.concat(data.entries || []);
  let cursor = data.cursor;
  let hasMore = data.has_more;
  while (hasMore) {
    res = await fetch('https://api.dropboxapi.com/2/files/list_folder/continue', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ cursor }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    data = await res.json();
    if (!res.ok) throw new Error(data.error_summary || `HTTP ${res.status}`);
    entries = entries.concat(data.entries || []);
    cursor = data.cursor;
    hasMore = data.has_more;
  }
  return entries;
}

async function dropboxDeleteFile(token, dropboxPath) {
  const res = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ path: dropboxPath }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.ok) return;
  const data = await res.json().catch(() => ({}));
  const summary = (data && data.error_summary) || `HTTP ${res.status}`;
  if (summary.startsWith('path_lookup/not_found')) return; // ya no está — no es un error
  throw new Error(summary);
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

async function deleteAllFilesUnder(token, folderPath, deletedList, failedList) {
  const entries = await dropboxListFolderRecursive(token, folderPath);
  for (const entry of entries) {
    if (entry['.tag'] !== 'file') continue;
    try {
      await dropboxDeleteFile(token, entry.path_lower);
      deletedList.push(entry.path_display || entry.name);
    } catch (err) {
      failedList.push({ path: entry.path_display || entry.name, error: err.message });
    }
  }
}

async function resetGuidesAndContent() {
  const dropboxToken = await getDropboxAccessToken();
  const emptyEntries = () => Buffer.from(JSON.stringify({ entries: [] }, null, 2));

  const deleted = { guias: [], contenido: [] };
  const failed = [];

  // Guías: todo lo que haya bajo /mentis-guias (gratis, premium, y el propio
  // guide-catalog.json — que se re-sube vacío después, así que borrarlo acá
  // también es inofensivo).
  await deleteAllFilesUnder(dropboxToken, GUIDES_FOLDER, deleted.guias, failed);
  await dropboxUpload(dropboxToken, `${GUIDES_FOLDER}/guide-catalog.json`, emptyEntries());

  // Contenido diario: todo lo que haya bajo /mentis-contenido (guiones y
  // clips, más content-history.json/video-history.json — mismo motivo que
  // arriba, se re-suben vacíos después).
  await deleteAllFilesUnder(dropboxToken, CONTENT_FOLDER, deleted.contenido, failed);
  await dropboxUpload(dropboxToken, `${CONTENT_FOLDER}/content-history.json`, emptyEntries());
  await dropboxUpload(dropboxToken, `${CONTENT_FOLDER}/video-history.json`, emptyEntries());

  // Fotos: acá NO se lista ni se borra nada de la carpeta — solo se
  // sobreescribe el registro de uso, dejando fotos y descripciones intactas.
  await dropboxUpload(dropboxToken, `${MEDIA_FOLDER}/photo-history.json`, emptyEntries());

  return {
    ok: failed.length === 0,
    deleted: { guias: deleted.guias.length, contenido: deleted.contenido.length },
    reset: ['guide-catalog.json', 'content-history.json', 'video-history.json', 'photo-history.json'],
    kept: ['knowledge/ (reglas.md y categorías, sin tocar)', 'photo-catalog.json (descripciones de fotos)', 'las fotos en sí, en /mentis-medios'],
    failed,
  };
}

module.exports = { resetGuidesAndContent };

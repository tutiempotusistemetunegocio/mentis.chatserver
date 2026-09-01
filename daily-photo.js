// Módulo 03 → carpeta de medios — elige, entre las fotos que Rodrigo ya
// subió a una carpeta plana de Dropbox, cuál acompaña mejor el guion del
// día. Corre DENTRO del mismo proceso que server.js, igual que
// daily-ingest.js/daily-script.js/daily-media.js: mismas variables ya
// cargadas en Render, ningún secreto nuevo salvo el propio de esta ruta.
//
// Independiente de Higgsfield (daily-media.js) a propósito: mientras ese
// sigue bloqueado por el 404 de cuenta/plan, esto ya funciona hoy con
// material real que Rodrigo suba — no depende de ninguna API externa más
// que la de Claude (Anthropic), que ya está conectada.
//
// LOS CRITERIOS DE SELECCIÓN, en orden (pedido explícito de Rodrigo,
// 31/8/2026 — el plano original los dejaba "pendientes de definir"):
//  1. Relación temática con el ángulo del guion de hoy — el criterio
//     principal. Cada foto se describe una sola vez con la API de Claude
//     (visión), y esa descripción se guarda; el día a día solo compara el
//     ángulo de hoy contra las descripciones ya guardadas, no vuelve a
//     mirar la foto en sí cada vez.
//  2. No repetir una foto usada en los últimos 15 días — se seguiría
//     viendo igual en el feed de Rodrigo si el sistema reusa la misma
//     imagen seguido. Si la carpeta tiene menos de 15 fotos utilizables,
//     esta regla se relaja sola (ver más abajo) en vez de trabar todo.
//  3. Entre las que cumplen 1 y 2, la relevancia temática decide — no hay
//     un tercer desempate por "más nueva" ni "mejor calidad": eso requeriría
//     inventar una métrica de calidad de imagen que hoy no existe, y sería
//     menos honesto que dejar que el ángulo del día decida solo.
//  4. Fotos demasiado pesadas (>8MB) no se analizan automáticamente — se
//     catalogan igual (para no reintentarlas cada día) pero quedan afuera
//     de la selección hasta que Rodrigo suba una versión más liviana. Esto
//     es a propósito: nada de procesar imágenes gigantes en un servidor con
//     512MB de memoria (ver la nota sobre el apagón por memoria en
//     higgsfield-metricool-preparacion.md/daily-media.md).
//
// Lo que NO hace todavía, a propósito:
//  - Video: por ahora solo evalúa fotos (.jpg/.jpeg/.png/.webp). Analizar
//    contenido de video real necesitaría extraer frames (ffmpeg u otra
//    herramienta), que es mucho más trabajo y memoria — se deja para una
//    versión futura. Los videos que Rodrigo suba a la misma carpeta se
//    listan pero se ignoran para la selección (se cuentan en
//    "videoSkipped" en la respuesta, para que quede visible que no se
//    perdieron, solo que no se usan todavía).
//  - Nada de "calidad de imagen" evaluada automáticamente — ver criterio 3.
//
// Qué hace runDailyPhoto(), en orden:
//  1. Baja el catálogo de fotos ya descritas y el historial de elecciones
//     recientes desde Dropbox (misma razón de siempre: el disco de Render
//     no sobrevive garantizado entre reinicios).
//  2. Lista la carpeta de medios (plana, sin subcarpetas — mismo criterio
//     que la carpeta de alimentación de libros).
//  3. Para las fotos nuevas o cambiadas que todavía no tienen descripción
//     (hasta un máximo por corrida, para no pasarse de memoria/costo): las
//     describe con la API de Claude (visión) y guarda la descripción.
//  4. Busca el ángulo del guion de HOY (ya generado por daily-script.js, en
//     content-history.json). Si no hay guion de hoy, no elige nada.
//  5. Entre las fotos ya descritas y no usadas recientemente, le pide a
//     Mentis que elija la que mejor conecta con el ángulo de hoy.
//  6. Guarda la elección en el historial y lo sube a Dropbox.

const fs = require('fs');
const path = require('path');
const { getDropboxAccessToken } = require('./dropbox-auth');

const CATALOG_PATH = path.join(__dirname, 'photo-catalog.json');
const HISTORY_PATH = path.join(__dirname, 'photo-history.json');
const MEDIA_FOLDER = process.env.DROPBOX_MEDIA_FOLDER || '/mentis-medios';
const CONTENT_FOLDER = process.env.DROPBOX_CONTENT_FOLDER || '/mentis-contenido';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const MAX_NEW_PER_RUN = parseInt(process.env.PHOTO_MAX_NEW_PER_RUN || '3', 10);
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // ver criterio 4 en el comentario de arriba
const HISTORY_LOOKBACK = 15; // ver criterio 2

const SUPPORTED_EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

async function dropboxListFolder(token, folderPath) {
  const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ path: folderPath }),
  });
  const data = await res.json();
  if (!res.ok) {
    const summary = data.error_summary || `HTTP ${res.status}`;
    if (summary.startsWith('path/not_found')) return []; // carpeta todavía no existe — nada subido aún
    throw new Error(summary);
  }
  return data.entries || [];
}

async function dropboxDownload(token, dropboxPath) {
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath }) },
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
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} subiendo ${dropboxPath}`);
}

function loadJSON(p, fallback) {
  if (!fs.existsSync(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return fallback;
  }
}

function saveJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

async function describePhoto(apiKey, buffer, mediaType) {
  const base64 = buffer.toString('base64');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 150,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: 'Describí esta foto en 1-2 frases cortas, en español: qué se ve y el ambiente/tono general (ej. "oficina de noche, luz cálida, alguien trabajando solo, sensación de foco y disciplina"). Sin inventar contexto que no se vea en la imagen. Devolvé SOLO la descripción, sin introducción ni comentario aparte.' },
        ],
      }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || `HTTP ${res.status} describiendo la foto`);
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
}

async function pickBestMatch(apiKey, angulo, candidates) {
  const list = candidates.map((c, i) => `${i + 1}. ${c.file}: ${c.description}`).join('\n');
  const prompt = `Sos Mentis eligiendo qué foto de la carpeta de medios de Rodrigo acompaña mejor el reel de hoy.

Ángulo/gancho del guion de hoy: "${angulo}"

Fotos disponibles (nombre: descripción):
${list}

Elegí la que mejor conecta temáticamente con ese ángulo — no hace falta que sea literal, alcanza con que el tono/ambiente acompañe el mensaje. Devolvé SOLO un objeto JSON, sin texto antes ni después, con esta forma exacta:
{"chosen": "<nombre exacto del archivo elegido, tal como aparece arriba>", "reason": "<1 frase corta explicando por qué>"}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 300, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || `HTTP ${res.status} eligiendo la foto`);
  const raw = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Mentis no devolvió JSON válido eligiendo la foto.');
  return JSON.parse(jsonMatch[0]);
}

async function runDailyPhoto() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: 'Falta ANTHROPIC_API_KEY en las variables de entorno.' };
  let dropboxToken;
  try {
    dropboxToken = await getDropboxAccessToken();
  } catch (err) {
    return { ok: false, error: err.message };
  }

  try {
    const buf = await dropboxDownload(dropboxToken, `${MEDIA_FOLDER}/photo-catalog.json`);
    fs.writeFileSync(CATALOG_PATH, buf);
  } catch {
    // primera corrida — sin catálogo todavía
  }
  try {
    const buf = await dropboxDownload(dropboxToken, `${MEDIA_FOLDER}/photo-history.json`);
    fs.writeFileSync(HISTORY_PATH, buf);
  } catch {
    // primera corrida — sin historial todavía
  }

  const catalog = loadJSON(CATALOG_PATH, { entries: {} });
  if (!catalog.entries) catalog.entries = {};

  const entries = await dropboxListFolder(dropboxToken, MEDIA_FOLDER);
  const fileEntries = entries.filter((e) => e['.tag'] === 'file' && !e.name.endsWith('.json'));
  const imageEntries = fileEntries.filter((e) => SUPPORTED_EXT[path.extname(e.name).toLowerCase()]);
  const videoSkipped = fileEntries.length - imageEntries.length;

  const toDescribe = imageEntries.filter((e) => {
    const known = catalog.entries[e.path_lower];
    return !known || known.content_hash !== e.content_hash;
  }).slice(0, MAX_NEW_PER_RUN);

  let newlyCataloged = 0;
  for (const entry of toDescribe) {
    if (entry.size && entry.size > MAX_PHOTO_BYTES) {
      catalog.entries[entry.path_lower] = {
        name: entry.name, content_hash: entry.content_hash, description: null,
        skipped: 'demasiado pesada para analizar automáticamente (>8MB) — subí una versión más liviana si querés que se use',
        catalogedAt: new Date().toISOString(),
      };
      continue;
    }
    try {
      const buffer = await dropboxDownload(dropboxToken, entry.path_lower);
      const mediaType = SUPPORTED_EXT[path.extname(entry.name).toLowerCase()];
      const description = await describePhoto(apiKey, buffer, mediaType);
      catalog.entries[entry.path_lower] = {
        name: entry.name, content_hash: entry.content_hash, description,
        catalogedAt: new Date().toISOString(),
      };
      newlyCataloged++;
    } catch (err) {
      catalog.entries[entry.path_lower] = {
        name: entry.name, content_hash: entry.content_hash, description: null,
        skipped: `error al analizar: ${err.message}`, catalogedAt: new Date().toISOString(),
      };
    }
  }
  if (toDescribe.length > 0) {
    saveJSON(CATALOG_PATH, catalog);
    await dropboxUpload(dropboxToken, `${MEDIA_FOLDER}/photo-catalog.json`, fs.readFileSync(CATALOG_PATH));
  }

  // Ángulo del día: ya lo generó daily-script.js esta misma mañana.
  let contentHistory = { entries: [] };
  try {
    const buf = await dropboxDownload(dropboxToken, `${CONTENT_FOLDER}/content-history.json`);
    contentHistory = JSON.parse(buf.toString('utf-8'));
  } catch {
    // sin guion todavía
  }
  const dateStr = new Date().toISOString().slice(0, 10);
  const todayEntry = (contentHistory.entries || []).find((e) => e.date === dateStr && e.tipo === 'reel');

  if (!todayEntry) {
    return {
      ok: true, chosen: null, date: dateStr, newlyCataloged, videoSkipped,
      reason: 'Hoy no hay guion de tipo "reel" en el historial (fin de semana, carrusel, o daily-script.js todavía no corrió) — no hay ángulo con qué elegir.',
    };
  }

  const history = loadJSON(HISTORY_PATH, { entries: [] });
  if (!Array.isArray(history.entries)) history.entries = [];
  const recentlyUsed = new Set(history.entries.slice(-HISTORY_LOOKBACK).map((e) => e.file));

  const described = Object.entries(catalog.entries).filter(([, v]) => v.description);
  let candidates = described.filter(([, v]) => !recentlyUsed.has(v.name));
  if (candidates.length === 0) candidates = described; // ver criterio 2 — se relaja si no alcanza

  if (candidates.length === 0) {
    return {
      ok: true, chosen: null, date: dateStr, angulo: todayEntry.angulo, newlyCataloged, videoSkipped,
      reason: 'Todavía no hay fotos catalogadas con descripción en la carpeta de medios — subí fotos a la carpeta y esperá a que se catalogen (unas pocas por día).',
    };
  }

  const pick = await pickBestMatch(apiKey, todayEntry.angulo, candidates.map(([, v]) => ({ file: v.name, description: v.description })));
  const chosenEntry = candidates.find(([, v]) => v.name === pick.chosen);
  if (!chosenEntry) {
    return { ok: false, error: `Mentis eligió "${pick.chosen}", que no está entre las opciones válidas — no se guardó nada.` };
  }

  history.entries.push({ date: dateStr, angulo: todayEntry.angulo, file: chosenEntry[1].name, reason: pick.reason });
  saveJSON(HISTORY_PATH, history);
  await dropboxUpload(dropboxToken, `${MEDIA_FOLDER}/photo-history.json`, fs.readFileSync(HISTORY_PATH));

  return {
    ok: true, date: dateStr, angulo: todayEntry.angulo,
    chosen: chosenEntry[1].name, path: `${MEDIA_FOLDER}/${chosenEntry[1].name}`,
    reason: pick.reason, candidatesConsidered: candidates.length, newlyCataloged, videoSkipped,
  };
}

module.exports = { runDailyPhoto };

// Módulo 03 → generación de video (Higgsfield) — el paso que sigue al guion
// diario (daily-script.js). Corre DENTRO del mismo proceso que server.js,
// igual que daily-ingest.js y daily-script.js: mismas variables ya cargadas
// en Render, ningún secreto nuevo viaja a otro lado salvo los propios de
// Higgsfield.
//
// Confirmado leyendo docs.higgsfield.ai directamente (31/8/2026) antes de
// escribir esto, para no repetir el error de asumir un diseño que después no
// es así (como pasó con Systeme.io):
//
//  - Ningún modelo de Higgsfield genera un clip de 60 segundos de una sola
//    vez — el máximo real por pedido es de 8 a 12 segundos según el modelo.
//    Por eso esta primera versión (decisión de Rodrigo, 31/8/2026) genera UN
//    clip corto (gancho/portada, no el reel completo) a partir del ángulo
//    del guion del día, y lo deja en Dropbox listo para que Rodrigo lo use
//    al armar el reel final a mano. El armado completo (varios clips +
//    carpeta de medios + edición) queda para una versión futura.
//  - Solo tiene sentido para "reel" — un "carrusel" son slides/imágenes, no
//    video, así que si el guion de hoy fue carrusel, esto no genera nada
//    (ver skip más abajo).
//  - Higgsfield es asíncrono: se pide el clip, avisa por webhook cuando
//    termina (o falla). La documentación de Higgsfield NO tiene ningún
//    mecanismo propio para firmar/verificar que el aviso vino de verdad de
//    ellos — así que, igual que con Systeme.io, el secreto viaja como
//    segmento de la propia URL del webhook
//    (/webhook/higgsfield-listo/<secreto>/<fecha>), no hay alternativa con
//    header acá tampoco porque Higgsfield nunca manda headers propios.
//  - El resultado es una URL, no un archivo — Higgsfield la mantiene viva
//    mínimo 7 días. Por eso el webhook descarga el video apenas avisa que
//    terminó y lo sube a Dropbox, en vez de guardar solo el link.
//
// Qué hace runDailyMedia() (paso 1, dispara el pedido):
//  1. Baja de Dropbox el historial de contenido más reciente (por si el
//     servicio se reinició desde que corrió daily-script.js esta mañana).
//  2. Busca la entrada de HOY en el historial. Si hoy no se generó reel
//     (fin de semana, o fue carrusel, o daily-script.js todavía no corrió),
//     no pide nada — no hay ángulo para convertir en video.
//  3. Arma un prompt visual corto a partir del ángulo del guion, y le pide a
//     Higgsfield un clip vertical de 10s (formato reel: aspect_ratio 9:16).
//  4. Devuelve el request_id — el resultado en sí llega después, por
//     webhook (ver handleHiggsfieldWebhook más abajo, llamado desde
//     server.js).
//
// Qué hace handleHiggsfieldWebhook() (paso 2, cuando Higgsfield avisa):
//  1. Si el status es "completed", descarga el video de la URL que da
//     Higgsfield y lo sube a Dropbox como <fecha>-clip.mp4, junto a los
//     guiones del mismo día.
//  2. Si es "failed" o "nsfw", no rompe nada — deja constancia en la
//     respuesta para que quede en el log de la corrida, y Rodrigo sigue
//     teniendo el guion en texto aunque el clip no haya salido.

const fs = require('fs');
const path = require('path');
const { syncFromDropbox } = require('./sync-dropbox');

const CONTENT_DIR = path.join(__dirname, 'contenido');
const HISTORY_PATH = path.join(__dirname, 'content-history.json');
const CONTENT_FOLDER = process.env.DROPBOX_CONTENT_FOLDER || '/mentis-contenido';
const HIGGSFIELD_API_BASE = 'https://api.higgsfield.ai';
// Seedance Lite: el modelo más básico de Higgsfield — se usa acá porque la
// prueba real (31/8/2026) mostró que "Pro Fast" devuelve 404 ("modelo no
// disponible para esta cuenta", según docs.higgsfield.ai/docs/concepts/errors
// — un tema de plan, no de código) en la cuenta gratis/de entrada de
// Rodrigo. Si más adelante paga un plan que incluya modelos superiores,
// cambiar de modelo es solo cambiar este valor (ver
// higgsfield-metricool-preparacion.md para el resto de los modelos
// disponibles).
const HIGGSFIELD_MODEL_PATH = '/bytedance/seedance/v1/lite/text-to-video';
const CLIP_DURATION_SECONDS = 10;

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

function loadHistory() {
  if (!fs.existsSync(HISTORY_PATH)) return { entries: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
    if (!Array.isArray(parsed.entries)) parsed.entries = [];
    return parsed;
  } catch {
    return { entries: [] };
  }
}

function todayUTC() {
  // Misma aproximación que daily-script.js — ver la salvedad de zona
  // horaria en daily-script.md, aplica igual acá.
  return new Date().toISOString().slice(0, 10);
}

function higgsfieldAuthHeader() {
  const keyId = process.env.HIGGSFIELD_KEY_ID;
  const keySecret = process.env.HIGGSFIELD_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  return `Key ${keyId}:${keySecret}`;
}

function buildVisualPrompt(entry) {
  return `Cinematic vertical short clip for a social media reel. Visual hook for the theme: "${entry.angulo}". Realistic, professional, high-energy footage suitable as an opening shot — no on-screen text, no logos, no watermarks.`;
}

async function submitHiggsfieldClip(prompt, webhookUrl) {
  const auth = higgsfieldAuthHeader();
  const url = `${HIGGSFIELD_API_BASE}${HIGGSFIELD_MODEL_PATH}?hf_webhook=${encodeURIComponent(webhookUrl)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      duration: CLIP_DURATION_SECONDS,
      resolution: 1080,
      aspect_ratio: '9:16',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status} pidiendo el clip a Higgsfield`);
  return data; // { status, request_id, status_url, cancel_url }
}

// Paso 1: dispara el pedido del clip. webhookBaseUrl es la URL pública del
// servidor (ej. https://mentis-chatserver.onrender.com) — la arma
// server.js a partir del secreto configurado, para no hardcodear el
// dominio acá.
async function runDailyMedia(webhookBaseUrl) {
  const dropboxToken = process.env.DROPBOX_ACCESS_TOKEN;
  const webhookSecret = process.env.HIGGSFIELD_WEBHOOK_SECRET;
  if (!dropboxToken) return { ok: false, error: 'Falta DROPBOX_ACCESS_TOKEN en las variables de entorno.' };
  if (!higgsfieldAuthHeader()) return { ok: false, error: 'Falta HIGGSFIELD_KEY_ID o HIGGSFIELD_KEY_SECRET en las variables de entorno.' };
  if (!webhookSecret) return { ok: false, error: 'Falta HIGGSFIELD_WEBHOOK_SECRET en las variables de entorno.' };

  await syncFromDropbox();
  try {
    const buf = await dropboxDownload(dropboxToken, `${CONTENT_FOLDER}/content-history.json`);
    fs.writeFileSync(HISTORY_PATH, buf);
  } catch {
    // sin historial todavía — nada que hacer, no hay ángulo de hoy
  }
  const history = loadHistory();
  const dateStr = todayUTC();
  const todayEntry = history.entries.find((e) => e.date === dateStr && e.tipo === 'reel');

  if (!todayEntry) {
    return { ok: true, submitted: false, date: dateStr, reason: 'Hoy no hay guion de tipo "reel" en el historial (fin de semana, carrusel, o daily-script.js todavía no corrió) — no hay ángulo para convertir en clip.' };
  }

  const prompt = buildVisualPrompt(todayEntry);
  const webhookUrl = `${webhookBaseUrl.replace(/\/+$/, '')}/webhook/higgsfield-listo/${webhookSecret}/${dateStr}`;
  const job = await submitHiggsfieldClip(prompt, webhookUrl);

  return { ok: true, submitted: true, date: dateStr, angulo: todayEntry.angulo, requestId: job.request_id, status: job.status };
}

// Paso 2: llamado desde server.js cuando Higgsfield avisa que el clip
// terminó (o falló). dateStr viene de la propia URL del webhook.
async function handleHiggsfieldWebhook(dateStr, payload) {
  const dropboxToken = process.env.DROPBOX_ACCESS_TOKEN;
  if (!dropboxToken) return { ok: false, error: 'Falta DROPBOX_ACCESS_TOKEN en las variables de entorno.' };

  if (payload.status !== 'completed') {
    return { ok: true, saved: false, date: dateStr, status: payload.status, error: payload.error || null };
  }

  const videoUrl = payload.payload && payload.payload.video && payload.payload.video.url;
  if (!videoUrl) {
    return { ok: false, error: 'Higgsfield avisó "completed" pero no vino ninguna URL de video en el payload.' };
  }

  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) throw new Error(`HTTP ${videoRes.status} descargando el clip desde Higgsfield`);
  const buf = Buffer.from(await videoRes.arrayBuffer());

  if (!fs.existsSync(CONTENT_DIR)) fs.mkdirSync(CONTENT_DIR, { recursive: true });
  const fname = `${dateStr}-clip.mp4`;
  fs.writeFileSync(path.join(CONTENT_DIR, fname), buf);
  await dropboxUpload(dropboxToken, `${CONTENT_FOLDER}/${fname}`, buf);

  return { ok: true, saved: true, date: dateStr, file: fname };
}

module.exports = { runDailyMedia, handleHiggsfieldWebhook };

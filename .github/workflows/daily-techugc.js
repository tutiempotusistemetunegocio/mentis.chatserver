// Módulo 08 → "Tech UGC" — pedido explícito de Rodrigo (15/9/2026): "quiero
// que en mi panel personal pongas una sección dedicada a Tech UGC, quiero
// que Mentis se dedique diariamente a buscar contenido de APP de IA, y me
// haga [un] reel para promocionarlo". Aclarado por él mismo al elegir entre
// las opciones que se le presentaron: "la primera y adiciona app existentes
// que generen interes" — es decir, primero se agotan las apps que Rodrigo ya
// tiene anotadas como de interés (la "watchlist"), y además Mentis puede
// sumar apps nuevas que encuentre buscando en vivo.
//
// Corre una vez por día (mismo patrón que el resto de daily-*.js), pero a
// diferencia de todos esos módulos, este es el PRIMERO que usa la
// herramienta de búsqueda web nativa de la API de Claude (server tool
// "web_search") — hasta ahora ningún módulo la tenía habilitada (ver el
// comentario de business-models.js explicando por qué en su momento no
// hacía falta). Acá sí hace falta de verdad: sin buscar en vivo no hay forma
// de saber qué app de IA está generando interés HOY.
//
// Cómo decide qué app promocionar cada día:
//  1. Si hay alguna entrada sin usar en la watchlist (techugc-watchlist.json,
//     la arma Rodrigo a mano vía POST /internal/techugc-watchlist, ver
//     server.js), se usa la más vieja sin usar — la watchlist tiene
//     prioridad, tal cual pidió Rodrigo.
//  2. Si la watchlist está vacía o ya se usó completa, Mentis busca en vivo
//     (web_search) una app de IA interesante que no se haya cubierto antes
//     (se le pasan los nombres ya usados, de techugc-history.json, para que
//     no repita).
// En los dos casos el resultado final es el mismo: un guion de reel UGC
// (en inglés, mostrando la cara/voz real de Rodrigo — mismo estilo ya
// establecido para el UGC de SideShift.app) que promociona/reseña esa app,
// más el porqué es interesante, guardado en techugc-history.json.

const fs = require('fs');
const path = require('path');
const { syncFromDropbox } = require('./sync-dropbox');
const { getDropboxAccessToken } = require('./dropbox-auth');

const HISTORY_PATH = path.join(__dirname, 'techugc-history.json');
const WATCHLIST_PATH = path.join(__dirname, 'techugc-watchlist.json');
const TECHUGC_FOLDER = process.env.DROPBOX_TECHUGC_FOLDER || '/mentis-techugc';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const FETCH_TIMEOUT_MS = 20000;
const GENERATE_TIMEOUT_MS = 120000; // más margen que el resto — la búsqueda web suma vueltas de ida y vuelta antes de la respuesta final

function loadJSON(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return parsed;
  } catch {
    return fallback;
  }
}

function saveJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function loadHistory() {
  const data = loadJSON(HISTORY_PATH, { entries: [] });
  if (!Array.isArray(data.entries)) data.entries = [];
  return data;
}

function loadWatchlist() {
  const data = loadJSON(WATCHLIST_PATH, { entries: [] });
  if (!Array.isArray(data.entries)) data.entries = [];
  return data;
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

async function dropboxDownload(token, dropboxPath) {
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath }) },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} descargando ${dropboxPath}`);
  return Buffer.from(await res.arrayBuffer());
}

// Le pide a Claude, en un solo llamado, que (si hace falta) busque en vivo y
// devuelva el guion completo — todo junto, para no gastar dos llamadas
// separadas. `watchlistApp` viene no-null cuando ya se sabe qué app tocar
// hoy (entonces Mentis NO necesita buscar, solo investigar esa app puntual
// para escribir el guion con datos reales); viene null cuando tiene que
// descubrir una app nueva por su cuenta.
async function generateTechUgc({ watchlistApp, yaUsadas }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const yaUsadasNote = yaUsadas.length
    ? `Apps que YA se cubrieron antes (nunca seleccionar ninguna de estas de nuevo):\n${yaUsadas.map((n) => `- ${n}`).join('\n')}`
    : 'Todavía no se cubrió ninguna app — esta es la primera corrida.';

  const tarea = watchlistApp
    ? `Rodrigo ya anotó esta app en su lista de interés para cubrir hoy: "${watchlistApp.name}"${watchlistApp.url ? ` (${watchlistApp.url})` : ''}${watchlistApp.nota ? `. Nota de Rodrigo sobre por qué le interesa: "${watchlistApp.nota}"` : ''}. Usá la búsqueda web para investigarla de verdad (qué hace, qué la hace interesante/diferente HOY, funciones nuevas recientes si las hay) antes de escribir el guion — no inventes funciones que no confirmaste buscando.`
    : `Rodrigo no dejó ninguna app anotada para hoy — usá la búsqueda web para encontrar VOS una app de inteligencia artificial que esté generando interés real ahora mismo (lanzamiento reciente, una función nueva que se está compartiendo mucho, una herramienta que resuelve algo de forma llamativa). Tiene que ser una app real, que exista, con nombre y sitio verificables por la búsqueda — nunca inventada.`;

  const prompt = `Sos Mentis, ayudando a Rodrigo con la sección "Tech UGC" de su sistema: cada día, una app de inteligencia artificial distinta, reseñada por él mismo en un reel de UGC (contenido generado por usuario) mostrando su cara y su voz real, en inglés — mismo estilo que ya usa para su portafolio de UGC de SideShift.app: cercano, directo, mostrando el uso real de la herramienta (no una lista de funciones leída), sin sonar a comercial armado. Usá alguno de sus formatos ya probados cuando encaje bien con la app del día — "problem → discovery → result" (algo le costaba, encontró esta app, así le resolvió el problema) o "I tried X for N days" — sin forzarlo si la app no se presta a ninguno de los dos.

${tarea}

${yaUsadasNote}

Después de investigar, devolvé SOLO un objeto JSON válido (sin texto antes ni después, sin bloque de código), con esta forma exacta:
{
  "appName": "nombre real de la app",
  "appUrl": "URL real del sitio de la app",
  "whyInteresting": "2-3 frases en español: por qué esta app es interesante HOY, con algo concreto que encontraste buscando (no genérico)",
  "reelScript": {
    "hook": "primera línea del guion, en inglés, la frase de gancho de los primeros 2-3 segundos, pensada para grabarse hablando directo a cámara",
    "script": "el guion completo en inglés, listo para grabar hablando a cámara (15-30s), mostrando el uso real de la app — no una lista de funciones leída, sino Rodrigo mostrando/probando la app como lo haría de verdad",
    "captionText": "el texto del caption en inglés, corto, para pantalla/descripción del post",
    "cta": "call to action de cierre en inglés, coherente con el estilo UGC (nunca vender directo el sistema de Rodrigo acá — este reel es sobre la app de IA, no sobre Mentis)"
  }
}

El guion tiene que sonar como alguien mostrando una herramienta que de verdad usó y le pareció interesante, no como una lectura de sus features. Nunca prometas resultados ni inventes datos que no confirmaste buscando.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || `HTTP ${res.status} generando Tech UGC`);
  // La respuesta con una server tool de por medio trae varios bloques
  // intercalados (server_tool_use, web_search_tool_result, text...) — solo
  // nos importa el texto final, igual que hace callClaude() en server.js con
  // las respuestas normales del chat.
  const raw = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Mentis no devolvió JSON válido generando el Tech UGC del día.');
  const parsed = JSON.parse(jsonMatch[0]);
  if (!parsed.appName || !parsed.reelScript) throw new Error('Mentis devolvió JSON incompleto (falta appName o reelScript).');
  return parsed;
}

async function runDailyTechUgc() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: 'Falta ANTHROPIC_API_KEY en las variables de entorno.' };
  let dropboxToken;
  try {
    dropboxToken = await getDropboxAccessToken();
  } catch (err) {
    return { ok: false, error: err.message };
  }

  // 1. Traer /knowledge (por las dudas de que algún día esto también lea
  //    conocimiento, mismo patrón que el resto), más el historial y la
  //    watchlist más recientes de Dropbox — nunca confiar en el disco local
  //    de Render entre corridas.
  await syncFromDropbox();
  try {
    const buf = await dropboxDownload(dropboxToken, `${TECHUGC_FOLDER}/techugc-history.json`);
    fs.writeFileSync(HISTORY_PATH, buf);
  } catch {
    // primera corrida — todavía no existe en Dropbox
  }
  try {
    const buf = await dropboxDownload(dropboxToken, `${TECHUGC_FOLDER}/techugc-watchlist.json`);
    fs.writeFileSync(WATCHLIST_PATH, buf);
  } catch {
    // todavía no hay watchlist — Rodrigo no agregó ninguna app a mano
  }

  const history = loadHistory();
  const watchlist = loadWatchlist();
  const yaUsadas = history.entries.map((e) => e.appName).filter(Boolean);

  // 2. Elegir: la entrada sin usar más vieja de la watchlist, o null (Mentis
  //    busca sola) si no queda ninguna.
  const pendingIndex = watchlist.entries.findIndex((w) => !w.usada);
  const watchlistApp = pendingIndex !== -1 ? watchlist.entries[pendingIndex] : null;

  // 3. Generar el guion (con búsqueda web real de por medio).
  let generated;
  try {
    generated = await generateTechUgc({ watchlistApp, yaUsadas });
  } catch (err) {
    return { ok: false, error: `No se pudo generar el Tech UGC de hoy: ${err.message}` };
  }

  if (watchlistApp) {
    watchlist.entries[pendingIndex].usada = true;
    watchlist.entries[pendingIndex].usadaEl = new Date().toISOString().slice(0, 10);
    saveJSON(WATCHLIST_PATH, watchlist);
  }

  const today = new Date().toISOString().slice(0, 10);
  const entry = {
    date: today,
    appName: generated.appName,
    appUrl: generated.appUrl || '',
    whyInteresting: generated.whyInteresting || '',
    source: watchlistApp ? 'watchlist' : 'descubierto',
    reelScript: {
      hook: (generated.reelScript && generated.reelScript.hook) || '',
      script: (generated.reelScript && generated.reelScript.script) || '',
      captionText: (generated.reelScript && generated.reelScript.captionText) || '',
      cta: (generated.reelScript && generated.reelScript.cta) || '',
    },
  };
  history.entries.push(entry);
  saveJSON(HISTORY_PATH, history);

  // 4. Subir historial (y watchlist, si se marcó una entrada como usada) a
  //    Dropbox. Mismo criterio que business-models.js: si la subida falla,
  //    ok:false a propósito, aunque el resultado ya se armó — para que quede
  //    claro en el log que no está garantizado que sobreviva hasta mañana.
  try {
    await dropboxUpload(dropboxToken, `${TECHUGC_FOLDER}/techugc-history.json`, fs.readFileSync(HISTORY_PATH));
    if (watchlistApp) {
      await dropboxUpload(dropboxToken, `${TECHUGC_FOLDER}/techugc-watchlist.json`, fs.readFileSync(WATCHLIST_PATH));
    }
  } catch (err) {
    return {
      ok: false,
      error: `Se generó el Tech UGC de hoy (${entry.appName}) pero no se pudo subir a Dropbox (${err.message}) — no está garantizado que sobreviva hasta la próxima corrida.`,
      entry,
    };
  }

  return { ok: true, entry };
}

// Agrega una app a la watchlist a mano (la llama POST /internal/techugc-watchlist
// en server.js) — mismo espíritu que el resto de las herramientas puntuales
// de administración: sincroniza, agrega, sube.
async function addToWatchlist({ name, url, nota }) {
  if (!name) throw new Error('Falta el nombre de la app.');
  let dropboxToken;
  try {
    dropboxToken = await getDropboxAccessToken();
  } catch (err) {
    throw new Error(`No se pudo conectar con Dropbox: ${err.message}`);
  }
  try {
    const buf = await dropboxDownload(dropboxToken, `${TECHUGC_FOLDER}/techugc-watchlist.json`);
    fs.writeFileSync(WATCHLIST_PATH, buf);
  } catch {
    // todavía no existe — arranca de una lista vacía
  }
  const watchlist = loadWatchlist();
  watchlist.entries.push({
    name, url: url || '', nota: nota || '', usada: false, agregadaEl: new Date().toISOString().slice(0, 10),
  });
  saveJSON(WATCHLIST_PATH, watchlist);
  await dropboxUpload(dropboxToken, `${TECHUGC_FOLDER}/techugc-watchlist.json`, fs.readFileSync(WATCHLIST_PATH));
  return watchlist;
}

if (require.main === module) {
  runDailyTechUgc()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (result.ok === false) process.exit(1);
    })
    .catch((err) => {
      console.error('Error generando el Tech UGC diario:', err.message);
      process.exit(1);
    });
}

module.exports = { runDailyTechUgc, addToWatchlist, loadHistory, loadWatchlist };

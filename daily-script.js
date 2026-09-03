// Módulo 03 → guion diario — genera el guion de reel/carrusel de cada día
// (lunes a viernes, un ángulo distinto por día — ver "Detalle: cómo prueba
// ángulos nuevos" en el plano) y el guion de podcast cada 3 días. Corre
// DENTRO del mismo proceso que server.js (mismo servicio de Render, mismas
// variables ya cargadas ahí) — igual que daily-ingest.js, ningún secreto
// nuevo viaja a ningún otro lado.
//
// Import honesto de lo que este archivo NO hace todavía: el plano describe
// que, con semanas de datos reales de Metricool, Mentis prioriza el ángulo
// ganador y vuelve a probar ángulos nuevos cuando ese cae. Como Metricool
// todavía no está conectado (Rodrigo lo confirmó al pedir este montaje), acá
// no hay ninguna lógica de "ángulo ganador" — cada día se le pide a Mentis un
// ángulo distinto a los últimos usados (guardados en el historial), para
// mantener la variedad de la tabla del plano, pero sin datos de rendimiento
// real todavía. El día que Metricool esté conectado, esta selección puede
// pasar a ser adaptativa de verdad — hoy es honesto que no lo es.
//
// Qué hace, en orden:
//  1. Baja de Dropbox el historial de contenido (por si el servicio se
//     reinició — mismo motivo que daily-ingest.js: el disco de Render no
//     está garantizado entre reinicios).
//  2. Decide qué generar hoy: reel/carrusel si es día hábil (lunes a
//     viernes — ver nota más abajo), y guion de podcast si pasaron 3 días
//     desde el último.
//  3. Le pide a Mentis (vía la API de Claude), con TODO el conocimiento
//     cargado como contexto, que escriba el guion — evitando repetir el
//     ángulo de los últimos días, y sin revelar nunca el mecanismo interno
//     (la regla del secreto aplica en especial acá, porque esto se publica).
//  4. Guarda el guion como archivo fechado y lo sube a Dropbox, y actualiza
//     el historial.
//
// Nota sobre "lunes a viernes": el plano solo especifica el reparto de
// ángulos para 5 días (LUN-VIE) — no dice qué pasa el fin de semana. Por
// default esto NO genera reel/carrusel sábado y domingo. Si Rodrigo quiere
// contenido los 7 días, es un cambio de una línea (WEEKDAYS_ONLY).

const fs = require('fs');
const path = require('path');
const { syncFromDropbox } = require('./sync-dropbox');
const { getDropboxAccessToken } = require('./dropbox-auth');

const KNOWLEDGE_DIR = path.join(__dirname, 'knowledge');
const CONTENT_DIR = path.join(__dirname, 'contenido');
const HISTORY_PATH = path.join(__dirname, 'content-history.json');
const CONTENT_FOLDER = process.env.DROPBOX_CONTENT_FOLDER || '/mentis-contenido';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const PODCAST_EVERY_N_DAYS = 3;
const WEEKDAYS_ONLY = true; // ver nota arriba — fácil de cambiar a 7 días
const HISTORY_LOOKBACK = 8; // cuántas entradas recientes se le muestran a Mentis para no repetir ángulo

// Ver el comentario largo en dropbox-auth.js (auditoría de confiabilidad,
// 2/9/2026): sin límite propio, una llamada colgada a Dropbox o a Claude
// dejaba la corrida esperando sin límite en vez de fallar limpio.
const FETCH_TIMEOUT_MS = 20000;
const GENERATE_TIMEOUT_MS = 90000; // escribir un guion completo tarda más que un llamado corto

async function dropboxDownload(token, dropboxPath) {
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

function saveHistory(history) {
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
}

function fullKnowledgeSnapshot() {
  if (!fs.existsSync(KNOWLEDGE_DIR)) return '';
  return fs.readdirSync(KNOWLEDGE_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => `### ${f}\n${fs.readFileSync(path.join(KNOWLEDGE_DIR, f), 'utf-8').trim()}`)
    .join('\n\n');
}

function todayUTC() {
  // Fecha en UTC como aproximación al día de Rodrigo — ver daily-script.md
  // para la salvedad sobre zonas horarias (mismo criterio que
  // daily-ingest.yml, que también corre en UTC).
  return new Date().toISOString().slice(0, 10);
}

function weekdayIndex(dateStr) {
  // 0=lunes ... 4=viernes, null=fin de semana. Date.getUTCDay(): 0=domingo.
  const d = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  if (d === 0 || d === 6) return null;
  return d - 1;
}

function daysSinceEpoch(dateStr) {
  const epoch = Date.UTC(2026, 0, 1); // ancla fija y arbitraria, solo para tener un ritmo de 3 días estable
  const d = Date.UTC(...dateStr.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  return Math.floor((d - epoch) / 86400000);
}

async function callMentis(prompt, maxTokens) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || `HTTP ${res.status} generando contenido`);
  const raw = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Mentis no devolvió JSON válido generando el guion.');
  return JSON.parse(jsonMatch[0]);
}

const VOICE_RULES = `Reglas fijas que nunca se rompen:
- Nunca reveles ni insinúes el mecanismo interno (que esto sale de libros cargados a un sistema, o cualquier detalle técnico de cómo funciona Mentis) — esto se publica en redes, tiene que sonar a criterio propio y experiencia real, con gancho y sin explicar el truco.
- Tono directo y sistemático, sin frases motivacionales vacías ni promesas de resultados garantizados.
- Nunca menciones que Rodrigo vive en Miami, y no le des mucho peso a su esposa — sí a su disciplina, su historia (Venezuela → Portugal → Canadá), el valor del tiempo y las ganas de ayudar a otros a salir de la mentalidad de empleado.`;

async function generateReelScript(dateStr, wIdx, history) {
  const recent = history.entries.slice(-HISTORY_LOOKBACK).filter((e) => e.tipo === 'reel');
  const recentAngles = recent.map((e) => `${e.date}: ${e.angulo}`).join('\n') || '(sin historial todavía)';
  const prompt = `Sos Mentis escribiendo el guion de contenido de hoy (${dateStr}) para Rodrigo, dueño de este sistema.

${VOICE_RULES}

Elegí un formato (reel corto de 30-60s, o carrusel de 5-8 slides) y un ángulo/gancho concreto para hoy, distinto a los últimos usados. Angulos usados recientemente (no repitas el mismo gancho central):
${recentAngles}

Basate en todo el conocimiento cargado más abajo — combiná lo que haga falta (marketing, mentalidad, ventas, redes, lo que aplique), como lo haría alguien que domina todas esas áreas a la vez.

Además del guion completo (pensado para narrarse en 30-60s), describí por separado una escena visual para el clip de video que se genera con IA a partir de esto: ese clip dura como máximo 12 segundos y es mudo (sin narración, sin diálogo, sin texto en pantalla), así que tiene que ser a propósito UN SOLO momento o toma concreta — nunca una secuencia de varias escenas ni algo que necesite más de 12 segundos para leerse o tener sentido. Condensá el gancho central de hoy en esa única imagen.

Lo más importante de esta escena es el CONTENIDO, no el estilo: tiene que mostrar una acción concreta directamente relacionada con el ángulo/gancho de hoy — alguien haciendo algo específico que dramatice ese gancho (ej. si el gancho es sobre disciplina y hábitos, no alcanza con "alguien trabajando de noche": mostrá la acción puntual que representa eso — apagando el teléfono para volver a escribir, tachando una tarea en una libreta, etc.). Empezá describiendo ESA acción concreta en una frase, y recién después sumá 1-2 detalles de ambiente/iluminación si hacen falta — nunca al revés, y nunca una escena que sea solo ambiente/mood sin ninguna acción puntual. Escribila directamente en inglés, lista para usarse tal cual como prompt de generación de video (describí solo lo que la cámara ve — acción, ambiente, iluminación — nunca diálogo ni texto en pantalla).

Además, para cuando el clip se genere a mano en la interfaz completa de Higgsfield (la que sí arma música y captions, a diferencia de la API que solo genera el video mudo), describí dos cosas más:
- "captionText": el texto EXACTO que tiene que aparecer en pantalla como caption/overlay durante el clip — corto (una frase, pensado para leerse en los 12s del clip), en español, el gancho central de hoy condensado a su forma más directa y llamativa (no el guion completo, no la CTA — solo el gancho, como titular).
- "musicStyle": el tipo de música de fondo que mejor acompaña el tono de hoy — corto, en inglés, como se describiría a una herramienta de generación (ej. "tense minimal piano, slow build" o "upbeat motivational synth, driving rhythm"), coherente con la energía del ángulo de hoy.

Devolvé SOLO un objeto JSON válido, sin texto antes ni después ni bloque de código, con esta forma exacta:
{"formato": "reel" o "carrusel", "angulo": "<etiqueta corta, 3-8 palabras, del gancho central de hoy>", "escenaVisual": "<en inglés, la escena única de hasta 12s descripta arriba>", "captionText": "<en español, el texto exacto del caption en pantalla>", "musicStyle": "<en inglés, el estilo de música de fondo>", "guion": "<el guion completo, listo para grabar/diseñar>", "cta": "<call to action del final, ej. invitar a comentar la palabra clave>"}

--- CONOCIMIENTO DE MENTIS ---
${fullKnowledgeSnapshot()}`;

  // 2000 -> 2500 (3/9/2026): se sumaron dos campos más al JSON de salida
  // (captionText, musicStyle) — mismo motivo que las subidas anteriores en
  // weekly-guides.js: más margen que lo justo, para no repetir el bug real
  // de truncamiento que ya pasó ahí dos veces.
  return callMentis(prompt, 2500);
}

async function generatePodcastScript(dateStr, history) {
  const recentTemas = history.entries.slice(-HISTORY_LOOKBACK).filter((e) => e.tipo === 'podcast')
    .map((e) => `${e.date}: ${e.tema}`).join('\n') || '(sin historial todavía)';
  const prompt = `Sos Mentis escribiendo el guion del episodio de podcast de hoy (${dateStr}) para Rodrigo — sale cada 3 días, como funnel gratuito.

${VOICE_RULES}

El guion tiene que salir de la propia experiencia acumulada de Mentis, conectando con los frameworks que ya tiene cargados — no un tema suelto sin fundamento. Elegí un tema distinto a los últimos episodios:
${recentTemas}

Devolvé SOLO un objeto JSON válido, sin texto antes ni después ni bloque de código, con esta forma exacta:
{"tema": "<tema del episodio, breve>", "guion": "<guion completo del episodio, listo para que Rodrigo lo grabe>"}

--- CONOCIMIENTO DE MENTIS ---
${fullKnowledgeSnapshot()}`;

  return callMentis(prompt, 3000);
}

async function runDailyScript() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: 'Falta ANTHROPIC_API_KEY en las variables de entorno.' };
  let dropboxToken;
  try {
    dropboxToken = await getDropboxAccessToken();
  } catch (err) {
    return { ok: false, error: err.message };
  }

  await syncFromDropbox(); // conocimiento fresco antes de escribir el guion
  try {
    const buf = await dropboxDownload(dropboxToken, `${CONTENT_FOLDER}/content-history.json`);
    fs.writeFileSync(HISTORY_PATH, buf);
  } catch {
    // primera corrida — no existe todavía en Dropbox, seguimos con historial vacío
  }
  const history = loadHistory();

  const dateStr = todayUTC();
  const wIdx = weekdayIndex(dateStr);
  const generated = [];
  let skippedReel = null;
  let podcastGenerated = false;
  const failures = [];

  if (!fs.existsSync(CONTENT_DIR)) fs.mkdirSync(CONTENT_DIR, { recursive: true });

  // Afinado el 2/9/2026 (auditoría de confiabilidad): antes, reel/carrusel y
  // podcast se generaban uno atrás del otro sin try/catch propio — si el
  // segundo fallaba (por ejemplo el podcast), toda la función tiraba error
  // ANTES de llegar al bloque que sube a Dropbox, así que el primero (el
  // reel, ya generado y ya pagado como llamada a la API) se perdía sin
  // guardarse ni avisar que había salido bien. Ahora cada uno se genera con
  // su propio try/catch: si uno falla, el otro igual se guarda, y la
  // respuesta cuenta cuál falló y por qué en vez de perder todo en silencio.
  if (wIdx !== null || !WEEKDAYS_ONLY) {
    try {
      const reel = await generateReelScript(dateStr, wIdx, history);
      const fname = `${dateStr}-${reel.formato === 'carrusel' ? 'carrusel' : 'reel'}.md`;
      const body = `# ${dateStr} — ${reel.formato}\n\n**Ángulo:** ${reel.angulo}\n\n---\n\n${reel.guion}\n\n---\n\n**CTA:** ${reel.cta}\n`;
      fs.writeFileSync(path.join(CONTENT_DIR, fname), body);
      history.entries.push({
        date: dateStr, tipo: 'reel', formato: reel.formato, angulo: reel.angulo,
        escenaVisual: reel.escenaVisual || null,
        captionText: reel.captionText || null,
        musicStyle: reel.musicStyle || null,
      });
      generated.push(fname);
    } catch (err) {
      failures.push({ tipo: 'reel', error: err.message });
    }
  } else {
    skippedReel = 'fin de semana — no se genera reel/carrusel (ver WEEKDAYS_ONLY en daily-script.js)';
  }

  if (daysSinceEpoch(dateStr) % PODCAST_EVERY_N_DAYS === 0) {
    try {
      const podcast = await generatePodcastScript(dateStr, history);
      const fname = `${dateStr}-podcast.md`;
      const body = `# ${dateStr} — Podcast\n\n**Tema:** ${podcast.tema}\n\n---\n\n${podcast.guion}\n`;
      fs.writeFileSync(path.join(CONTENT_DIR, fname), body);
      history.entries.push({ date: dateStr, tipo: 'podcast', tema: podcast.tema });
      generated.push(fname);
      podcastGenerated = true;
    } catch (err) {
      failures.push({ tipo: 'podcast', error: err.message });
    }
  }

  if (generated.length > 0) {
    saveHistory(history);
    for (const fname of generated) {
      const buf = fs.readFileSync(path.join(CONTENT_DIR, fname));
      await dropboxUpload(dropboxToken, `${CONTENT_FOLDER}/${fname}`, buf);
    }
    await dropboxUpload(dropboxToken, `${CONTENT_FOLDER}/content-history.json`, fs.readFileSync(HISTORY_PATH));
  }

  // ok:false solo si TODO lo que tocaba generar hoy falló — si al menos uno
  // salió bien, ok:true con "failures" listando lo que no, para no marcar
  // como error una corrida parcialmente exitosa.
  const ok = failures.length === 0 || generated.length > 0;
  return { ok, date: dateStr, generated, skippedReel, podcastGenerated, failures };
}

module.exports = { runDailyScript };

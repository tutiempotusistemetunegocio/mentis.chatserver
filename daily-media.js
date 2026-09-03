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
//
// Foto del día (agregado 3/9/2026, pedido explícito de Rodrigo — "que el
// reel trabaje siempre con una foto mía o una cualquiera"): daily-photo.js
// (corre antes, 10:40 UTC) ya elige una foto de la carpeta de medios que
// conecta con el ángulo de hoy. Este módulo la busca en photo-history.json y,
// si existe, pide el clip con el endpoint image-to-video de Higgsfield en
// vez de texto-a-video (mismo prompt, más `image_url` con un link temporal
// de Dropbox de esa foto — confirmado contra la documentación pública de
// Higgsfield, ver el comentario junto a HIGGSFIELD_IMAGE_MODEL_PATH). Si no
// hay foto de hoy por cualquier motivo, sigue funcionando como antes
// (texto-a-video) — nunca bloquea el pedido.
//
// Música y captions (actualizado 3/9/2026): la API (docs.higgsfield.ai/docs/
// openapi.json, revisada de nuevo) NO tiene ningún endpoint para agregar
// audio, subtítulos ni texto superpuesto — solo genera el clip mudo, sin
// texto, como ya se le pide en `buildVisualPrompt`. Rodrigo aclaró que el
// plan que paga (Plus) es el de la INTERFAZ WEB de consumo de Higgsfield,
// no la API — y que ahí, dándole la instrucción en el prompt, la propia
// interfaz arma música y captions como parte de la generación (no hace
// falta editar el video después). Por eso `buildManualHiggsfieldPrompt`
// (ver más abajo) arma un segundo prompt — separado del que usa el pedido
// automático a la API — con instrucciones explícitas de música y el texto
// exacto del caption, pensado para copiarse a mano en esa interfaz.
// Caveat honesto: esto no se pudo confirmar contra ninguna documentación
// pública (la única disponible es la de la API, que no cubre la interfaz
// web) — es la palabra de Rodrigo sobre su propia cuenta, y la forma real de
// confirmarlo es que lo pruebe una vez con el prompt completo y cuente qué
// pasó.

const fs = require('fs');
const path = require('path');
const { getDropboxAccessToken } = require('./dropbox-auth');

const CONTENT_DIR = path.join(__dirname, 'contenido');
const HISTORY_PATH = path.join(__dirname, 'content-history.json');
const CONTENT_FOLDER = process.env.DROPBOX_CONTENT_FOLDER || '/mentis-contenido';
// Misma carpeta que usa daily-photo.js (Módulo 03 → foto del día) — se lee
// acá también, de solo lectura, para saber si hoy ya se eligió una foto y
// poder pedirle a Higgsfield un clip a partir de ELLA (image-to-video) en
// vez de solo texto. Ver el comentario largo sobre esto más abajo, junto a
// PHOTO_HISTORY_PATH.
const MEDIA_FOLDER = process.env.DROPBOX_MEDIA_FOLDER || '/mentis-medios';
const HIGGSFIELD_API_BASE = 'https://api.higgsfield.ai';
// REACTIVADO (2/9/2026): Rodrigo pasó su cuenta de Higgsfield al plan Plus
// (1.200 créditos/mes, "acceso completo a todos los modelos Seedance"), que
// es justo lo que faltaba — la cuenta anterior tenía 0 créditos y solo dos
// modelos de imagen habilitados (Soul 2, Soul Cinema), por eso todo pedido
// de video daba 404 sin importar qué modelo se pidiera.
//
// Caveat honesto sobre el valor elegido acá: el panel de precios de
// higgsfield.ai muestra los modelos como "Seedance 2.5" (1080p) y "Seedance
// 2.0" (4K) — nombres de marketing. La especificación pública de la API
// (docs.higgsfield.ai/docs/openapi.json), revisada de nuevo hoy, todavía
// solo expone cuatro rutas de Seedance, todas bajo "v1": lite y pro/fast,
// cada una en texto→video e imagen→video — no hay ninguna ruta "v2" ni
// "2.5" documentada públicamente. La lectura más razonable es que "Pro
// Fast" (antes bloqueada por el plan viejo, de ahí el 404 original) es la
// que corresponde al acceso Seedance que da el plan Plus, así que se volvió
// a esa ruta en vez de la "lite". Esto es una inferencia de la documentación
// pública, no algo confirmado contra la cuenta real de Rodrigo — conviene
// disparar /internal/daily-media a mano una vez (o esperar al próximo 10:45
// UTC) y confirmar que ya no da 404 antes de darlo por resuelto del todo.
const HIGGSFIELD_MODEL_PATH = '/bytedance/seedance/v1/pro/fast/text-to-video';
// Pedido explícito de Rodrigo (3/9/2026): que el reel siempre trabaje con
// una foto suya (o cualquier otra) en vez de generar el clip de la nada.
// Confirmado contra la documentación pública de Higgsfield (docs.higgsfield.ai,
// revisado 3/9/2026): Seedance Pro Fast tiene una variante "image-to-video"
// (misma familia que la de texto, mismos parámetros de duración/resolución/
// aspect_ratio, más un `image_url` obligatorio) — no hace falta subir el
// archivo a Higgsfield, solo darle una URL desde donde puedan bajarlo ellos.
const HIGGSFIELD_IMAGE_MODEL_PATH = '/bytedance/seedance/v1/pro/fast/image-to-video';
// Catálogo/historial de fotos que arma daily-photo.js — se leen acá para
// saber si HOY ya se eligió una foto (ver runDailyMedia). Este archivo no
// escribe nunca en photo-history.json, solo lo lee.
const PHOTO_HISTORY_PATH = path.join(__dirname, 'photo-history.json');
// Rodrigo pidió (2/9/2026) que los clips tengan 25s. No es posible: la
// documentación pública de la API de Higgsfield (revisada de nuevo hoy)
// dice explícitamente que Seedance acepta `duration` entre 2 y 12 segundos
// por pedido — es un techo de la plataforma, no algo que se pueda subir
// desde acá. 12 es el máximo real, así que es el valor que se usa. Para
// llegar a ~20-25s hace falta pedir dos clips y unirlos en un solo video
// (edición/concatenación) — eso es una construcción aparte, todavía no
// existe, ver daily-media.md.
const CLIP_DURATION_SECONDS = 12;
const VIDEO_HISTORY_PATH = path.join(__dirname, 'video-history.json');

// Ver el comentario largo en dropbox-auth.js (auditoría de confiabilidad,
// 2/9/2026): sin límite propio, una llamada colgada dejaba la corrida
// esperando sin límite en vez de fallar limpio. El pedido a Higgsfield solo
// tiene que aceptar el trabajo (el video en sí llega después por webhook),
// así que no necesita un límite largo.
const FETCH_TIMEOUT_MS = 20000;
const SUBMIT_TIMEOUT_MS = 30000;
const VIDEO_DOWNLOAD_TIMEOUT_MS = 60000; // el webhook baja el clip ya terminado, puede pesar más

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

// Higgsfield no acepta un archivo subido directamente — el campo
// `image_url` de su endpoint image-to-video tiene que ser una URL que ELLOS
// puedan bajar. Dropbox da justo eso con `files/get_temporary_link`: un link
// directo de descarga, sin login, que dura 4 horas (de sobra para que
// Higgsfield la baje al toque de recibir el pedido).
async function dropboxGetTemporaryLink(token, dropboxPath) {
  const res = await fetch('https://api.dropboxapi.com/2/files/get_temporary_link', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ path: dropboxPath }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error_summary) || `HTTP ${res.status} pidiendo el link temporal de ${dropboxPath}`);
  return data.link;
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

// Reforzado (2/9/2026, pedido explícito de Rodrigo): siempre cinematográfico
// — se lo dice más de una vez al modelo, con vocabulario concreto de cámara
// (movimiento, lente, iluminación) en vez de solo la palabra "cinematic"
// suelta, que es más fácil de ignorar. "Silent" explícito porque el clip se
// usa sin narración (el guion en texto ya existe aparte) — Seedance no
// agrega diálogo si no se le da audio de entrada, pero decirlo ayuda a que
// tampoco intente sumar ambiente sonoro con gente hablando de fondo.
//
// Pedido explícito de Rodrigo (2/9/2026): que "el cerebro" (Mentis, al armar
// el guion del día en daily-script.js) ya sepa de antemano que el clip real
// dura como máximo 12 segundos, y condense el gancho en UNA escena concreta
// pensada para eso — en vez de que acá se agarre el ángulo corto (pensado
// como etiqueta del guion narrado de 30-60s) y se lo estire como si fuera
// una escena filmable. Por eso ahora se usa `entry.escenaVisual` (ya escrita
// en inglés por Mentis, pensada específicamente para 12s) cuando existe.
// `entry.angulo` queda como respaldo solo para entradas viejas, generadas
// antes de este cambio, que no tienen escenaVisual guardada.
//
// REORDENADO (3/9/2026, pedido explícito de Rodrigo: "no veo el contenido,
// solo dice de las cámaras"): antes, `escena` iba metida en el medio de dos
// bloques de lenguaje técnico (cinematografía primero, calidad/silencio
// después) — el contenido temático estaba, pero enterrado. Ahora `escena`
// (el contenido de hoy) va SIEMPRE primero, como la frase que abre el
// prompt, y el lenguaje de estilo/cámara/calidad va después como
// modificador — no al revés. Esto no cambia lo que se le pide a Higgsfield
// en el fondo, solo el orden y el peso relativo, para que el contenido
// temático sea lo primero que el modelo (y cualquiera que lea el prompt en
// el panel) vea.
function buildVisualPrompt(entry) {
  const escena = entry.escenaVisual || `Visual hook for the theme: "${entry.angulo}".`;
  return `${escena} Shot in a cinematic, high-production-value style for a vertical social media reel — deliberate camera movement (slow push-in, tracking, or handheld with purpose), dramatic natural lighting, shallow depth of field, realistic and professional. Silent footage, no dialogue, no voiceover, no on-screen text, no logos, no watermarks.`;
}

// Agregado (3/9/2026, pedido explícito de Rodrigo): "el prompt me diga todo
// — tipo de música, qué captions poner, cuáles son" — porque, a diferencia
// de la API (que solo genera el clip mudo, sin texto — confirmado contra la
// documentación pública, ver la nota grande al principio del archivo), la
// interfaz completa de Higgsfield en la web (la del plan Plus que Rodrigo
// pagó ahí) sí puede armar música y captions cuando se le da la instrucción
// en el prompt. Esto es un prompt DISTINTO al de arriba, pensado para
// pegarse a mano en esa interfaz web, no para el pedido automático a la API:
// le suma instrucciones de música y el texto exacto del caption, cosas que
// el pedido automático a la API ignoraría en el mejor de los casos (no las
// soporta) o podría interpretar mal en el peor (intentar "dibujar" texto en
// el clip sin la tipografía real de un editor, que suele salir ilegible).
// Por eso `buildVisualPrompt` de arriba se sigue usando tal cual para el
// pedido automático, y este solo se guarda para mostrarse en el panel.
//
// Honesto: no hay forma de confirmar desde acá si la interfaz de Higgsfield
// realmente interpreta instrucciones de música/captions escritas así dentro
// del prompt (la documentación pública que se pudo revisar es la de la API,
// que no cubre la interfaz web de consumo) — la forma de confirmarlo es que
// Rodrigo lo pruebe una vez y cuente qué pasó, mismo criterio que se usó
// para todo lo demás en este proyecto.
function buildManualHiggsfieldPrompt(entry) {
  const base = buildVisualPrompt(entry).replace(/ Silent footage, no dialogue, no voiceover, no on-screen text, no logos, no watermarks\.$/, '');
  const caption = entry.captionText ? `\n\nAdd on-screen text/captions displaying exactly: "${entry.captionText}"` : '';
  const music = entry.musicStyle ? `\n\nBackground music: ${entry.musicStyle}.` : '';
  return `${base} No dialogue, no voiceover, no logos, no watermarks.${caption}${music}`;
}

function loadVideoHistory() {
  if (!fs.existsSync(VIDEO_HISTORY_PATH)) return { entries: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(VIDEO_HISTORY_PATH, 'utf-8'));
    if (!Array.isArray(parsed.entries)) parsed.entries = [];
    return parsed;
  } catch {
    return { entries: [] };
  }
}

function saveVideoHistory(history) {
  fs.writeFileSync(VIDEO_HISTORY_PATH, JSON.stringify(history, null, 2));
}

// imageUrl es opcional: cuando viene (foto de hoy ya elegida por
// daily-photo.js, con link temporal de Dropbox), se usa el endpoint
// image-to-video en vez del de solo texto — mismos demás parámetros.
async function submitHiggsfieldClip(prompt, webhookUrl, imageUrl) {
  const auth = higgsfieldAuthHeader();
  const modelPath = imageUrl ? HIGGSFIELD_IMAGE_MODEL_PATH : HIGGSFIELD_MODEL_PATH;
  const url = `${HIGGSFIELD_API_BASE}${modelPath}?hf_webhook=${encodeURIComponent(webhookUrl)}`;
  const body = {
    prompt,
    duration: CLIP_DURATION_SECONDS,
    resolution: 1080,
    aspect_ratio: '9:16',
  };
  if (imageUrl) body.image_url = imageUrl;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status} pidiendo el clip a Higgsfield`);
  return data; // { status, request_id, status_url, cancel_url }
}

// Busca si HOY ya se eligió una foto (daily-photo.js corre antes, a las
// 10:40 UTC — este módulo corre después) y devuelve un link temporal de
// Dropbox para esa foto, listo para pasarle a Higgsfield como `image_url`.
// Devuelve null (nunca tira error) ante cualquier problema — sin foto de
// hoy, con foto pero sin poder pedir el link, historial corrupto, etc. — el
// pedido de video sigue andando igual, solo que como texto-a-video en vez de
// imagen-a-video. No es un fallback silencioso sin dejar rastro: el llamador
// (runDailyMedia) registra en video-history.json si se usó foto o no.
async function findTodayPhotoUrl(dropboxToken, dateStr) {
  try {
    const buf = await dropboxDownload(dropboxToken, `${MEDIA_FOLDER}/photo-history.json`);
    fs.writeFileSync(PHOTO_HISTORY_PATH, buf);
  } catch {
    return null; // daily-photo.js todavía no corrió nunca, o no hay nada elegido
  }
  let photoHistory;
  try {
    photoHistory = JSON.parse(fs.readFileSync(PHOTO_HISTORY_PATH, 'utf-8'));
  } catch {
    return null;
  }
  const entries = Array.isArray(photoHistory.entries) ? photoHistory.entries : [];
  const todayPhoto = entries.find((e) => e.date === dateStr && e.file);
  if (!todayPhoto) return null;
  try {
    const link = await dropboxGetTemporaryLink(dropboxToken, `${MEDIA_FOLDER}/${todayPhoto.file}`);
    return { file: todayPhoto.file, url: link };
  } catch {
    return null; // el link temporal falló — seguimos sin foto, no rompemos el pedido
  }
}

// Paso 1: dispara el pedido del clip. webhookBaseUrl es la URL pública del
// servidor (ej. https://mentis-chatserver.onrender.com) — la arma
// server.js a partir del secreto configurado, para no hardcodear el
// dominio acá.
async function runDailyMedia(webhookBaseUrl) {
  const webhookSecret = process.env.HIGGSFIELD_WEBHOOK_SECRET;
  if (!higgsfieldAuthHeader()) return { ok: false, error: 'Falta HIGGSFIELD_KEY_ID o HIGGSFIELD_KEY_SECRET en las variables de entorno.' };
  if (!webhookSecret) return { ok: false, error: 'Falta HIGGSFIELD_WEBHOOK_SECRET en las variables de entorno.' };
  let dropboxToken;
  try {
    dropboxToken = await getDropboxAccessToken();
  } catch (err) {
    return { ok: false, error: err.message };
  }

  // A diferencia de daily-script.js, esto NO necesita el conocimiento
  // (knowledge/) para nada — solo el ángulo ya guardado en el historial. Se
  // sacó el syncFromDropbox() de acá (se pedía sin usarlo) tras confirmar
  // que Render free tier se quedó sin memoria (512MB) en una corrida real —
  // menos trabajo innecesario por corrida ayuda a no acercarse a ese techo.
  try {
    const buf = await dropboxDownload(dropboxToken, `${CONTENT_FOLDER}/content-history.json`);
    fs.writeFileSync(HISTORY_PATH, buf);
  } catch {
    // sin historial todavía — nada que hacer, no hay ángulo de hoy
  }
  const history = loadHistory();
  const dateStr = todayUTC();
  // BUG REAL encontrado el 3/9/2026: daily-script.js guarda tipo:'reel' para
  // TODAS las entradas de guion corto (tanto reel como carrusel — la
  // diferencia real está en el campo `formato`, no en `tipo`). Este chequeo
  // solo miraba `tipo`, así que un día de carrusel también entraba acá y
  // terminaba pidiéndole un video a Higgsfield — justo lo que el comentario
  // de arriba decía que NO tenía que pasar. `formato || 'reel'` es a
  // propósito: entradas viejas del historial, de antes de que existiera el
  // campo `formato`, se tratan como reel (que es lo que siempre fueron).
  const todayEntry = history.entries.find((e) => e.date === dateStr && e.tipo === 'reel' && (e.formato || 'reel') === 'reel');

  if (!todayEntry) {
    return { ok: true, submitted: false, date: dateStr, reason: 'Hoy no hay guion de tipo "reel" (formato reel, no carrusel) en el historial (fin de semana, carrusel, o daily-script.js todavía no corrió) — no hay ángulo para convertir en clip.' };
  }

  const prompt = buildVisualPrompt(todayEntry);
  // Prompt aparte, para pegar a mano en la interfaz web de Higgsfield (plan
  // Plus) — incluye música y captions, que la API no soporta. Ver el
  // comentario largo junto a buildManualHiggsfieldPrompt.
  const promptCompleto = buildManualHiggsfieldPrompt(todayEntry);
  const webhookUrl = `${webhookBaseUrl.replace(/\/+$/, '')}/webhook/higgsfield-listo/${webhookSecret}/${dateStr}`;

  // Pedido explícito de Rodrigo (3/9/2026): que el reel siempre trabaje con
  // una foto (suya u otra) en vez de generarse de la nada. daily-photo.js
  // corre antes (10:40 UTC) y elige la foto del día en photo-history.json —
  // acá se busca esa elección y, si existe, se pide el video a partir de
  // ELLA (image-to-video). Si no hay foto de hoy por lo que sea (todavía no
  // se subió ninguna, daily-photo.js no corrió, falló el link temporal), se
  // sigue pidiendo el clip de texto como antes — no bloquea nada.
  const todayPhoto = await findTodayPhotoUrl(dropboxToken, dateStr);

  // Mientras la cuenta de API de Higgsfield no tenga créditos/modelo
  // habilitado (3/9/2026 — plan Plus comprado en la web normal, no en
  // cloud.higgsfield.ai, que sigue en 0), el pedido automático puede fallar.
  // Antes, si `submitHiggsfieldClip` tiraba error, TODO se perdía — ni
  // siquiera el prompt quedaba visible en ningún lado, y Rodrigo no tenía
  // forma de generar el video a mano con lo que Mentis ya escribió. Ahora el
  // pedido automático se envuelve en su propio try/catch: si falla, el
  // prompt se guarda igual (con status "manual — no se pudo pedir
  // automático") para que aparezca en el panel y Rodrigo pueda copiarlo y
  // generarlo él mismo en la web de Higgsfield con el plan que ya tiene.
  let job = null;
  let submitError = null;
  try {
    job = await submitHiggsfieldClip(prompt, webhookUrl, todayPhoto ? todayPhoto.url : null);
  } catch (err) {
    submitError = err.message;
  }

  // Pedido explícito de Rodrigo (2/9/2026): "no veo el prompt del video".
  // Antes esto se armaba y se mandaba a Higgsfield sin dejar rastro en
  // ningún lado — se guarda acá para que quede visible en el panel personal
  // (Módulo 08), igual que ya pasa con el catálogo de guías y el contenido
  // de texto. Si ESTE guardado falla, no tiene que tirar abajo el pedido que
  // ya se mandó — el video se genera igual, solo no queda registrado el
  // prompt (distinto del catch de arriba, que es sobre el pedido a
  // Higgsfield en sí).
  try {
    const videoHistory = loadVideoHistory();
    videoHistory.entries.push({
      date: dateStr, angulo: todayEntry.angulo, prompt, promptCompleto, duration: CLIP_DURATION_SECONDS,
      captionText: todayEntry.captionText || null,
      musicStyle: todayEntry.musicStyle || null,
      requestId: job ? job.request_id : null,
      status: job ? job.status : `manual — no se pudo pedir automático (${submitError})`,
      photoUsed: todayPhoto ? todayPhoto.file : null,
      submittedAt: new Date().toISOString(),
    });
    saveVideoHistory(videoHistory);
    const dropboxToken2 = await getDropboxAccessToken();
    await dropboxUpload(dropboxToken2, `${CONTENT_FOLDER}/video-history.json`, fs.readFileSync(VIDEO_HISTORY_PATH));
  } catch (err) {
    console.error('No se pudo guardar el historial de prompts de video:', err.message);
  }

  if (!job) {
    return {
      ok: true, submitted: false, date: dateStr, angulo: todayEntry.angulo, prompt, promptCompleto,
      photoUsed: todayPhoto ? todayPhoto.file : null,
      reason: `No se pudo pedir el clip automáticamente a Higgsfield (${submitError}) — el "promptCompleto" de arriba (con música y captions incluidos) ya está guardado y visible en el panel, listo para pegar a mano en la interfaz web de Higgsfield (plan Plus)${todayPhoto ? `, junto con la foto "${todayPhoto.file}" como referencia si querés mantener el mismo resultado` : ''}.`,
    };
  }

  return {
    ok: true, submitted: true, date: dateStr, angulo: todayEntry.angulo, prompt, promptCompleto,
    photoUsed: todayPhoto ? todayPhoto.file : null,
    requestId: job.request_id, status: job.status,
  };
}

// Paso 2: llamado desde server.js cuando Higgsfield avisa que el clip
// terminó (o falló). dateStr viene de la propia URL del webhook.
async function handleHiggsfieldWebhook(dateStr, payload) {
  let dropboxToken;
  try {
    dropboxToken = await getDropboxAccessToken();
  } catch (err) {
    return { ok: false, error: err.message };
  }

  if (payload.status !== 'completed') {
    return { ok: true, saved: false, date: dateStr, status: payload.status, error: payload.error || null };
  }

  const videoUrl = payload.payload && payload.payload.video && payload.payload.video.url;
  if (!videoUrl) {
    return { ok: false, error: 'Higgsfield avisó "completed" pero no vino ninguna URL de video en el payload.' };
  }

  const videoRes = await fetch(videoUrl, { signal: AbortSignal.timeout(VIDEO_DOWNLOAD_TIMEOUT_MS) });
  if (!videoRes.ok) throw new Error(`HTTP ${videoRes.status} descargando el clip desde Higgsfield`);
  const buf = Buffer.from(await videoRes.arrayBuffer());

  if (!fs.existsSync(CONTENT_DIR)) fs.mkdirSync(CONTENT_DIR, { recursive: true });
  const fname = `${dateStr}-clip.mp4`;
  fs.writeFileSync(path.join(CONTENT_DIR, fname), buf);
  await dropboxUpload(dropboxToken, `${CONTENT_FOLDER}/${fname}`, buf);

  return { ok: true, saved: true, date: dateStr, file: fname };
}

module.exports = { runDailyMedia, handleHiggsfieldWebhook };

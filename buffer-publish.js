// Módulo 03 → publicar en Instagram vía Buffer. Reemplaza a Metricool en este
// paso puntual (publicar + más adelante métricas) — decisión de Rodrigo
// (6/9/2026), después de confirmar contra la documentación real de las dos
// que Metricool exige su plan Advanced (~$53/mes) para tener API, mientras
// que Buffer da acceso a la API desde su plan gratis. Corre dentro del mismo
// mentis-chat-server, mismo patrón que el resto de los módulos.
//
// QUÉ HACE HOY: dos caminos independientes, uno de foto y uno de reel — ver
// más abajo el porqué del segundo, que es el que de verdad importa.
//
// CAMINO 1 — FOTO (publishDailyPhoto, el original): publica como borrador la
// foto que daily-photo.js eligió para el ángulo del día, entre las fotos
// sueltas que Rodrigo sube a /mentis-medios. Queda como camino OPCIONAL —
// Rodrigo no tiene por qué usarlo ni subir nada a esa carpeta.
//
// CAMINO 2 — REEL (publishDailyReel, agregado 8/9/2026): el que refleja cómo
// Rodrigo trabaja de verdad. Rodrigo me lo explicó así (8/9/2026): "tenemos
// que hacer el video manualmente, porque Higgsfield no está funcionando
// automáticamente con el API... cuando hago el video en Higgsfield, no le
// veo la ciencia [al paso de elegir foto]". Dicho de otra forma: mientras la
// integración automática con Higgsfield siga bloqueada (ver daily-media.js),
// el video no lo arma el sistema — lo arma Rodrigo a mano en la app de
// Higgsfield, usando el ángulo/guion del día como base. Pedirle al sistema
// que ADEMÁS elija una foto por su cuenta no tiene sentido: el video que
// Rodrigo ya hizo ES la elección. Por eso publishDailyReel() no elige nada
// — solo espera a que Rodrigo suba el reel terminado a una carpeta
// (DROPBOX_REEL_READY_FOLDER, por defecto /mentis-reel-listo) y lo toma de
// ahí tal cual. El día que Higgsfield esté confirmado funcionando por API,
// este es el camino al que se conectaría directo (en vez de esperar que
// Rodrigo suba el archivo a mano).
//
// POR QUÉ QUEDA COMO BORRADOR, NO PUBLICACIÓN AUTOMÁTICA (decisión mía,
// explicada acá porque Rodrigo no la pidió puntualmente): a diferencia de
// generar un guion o una guía — que se guardan en Dropbox y Rodrigo los
// revisa cuando quiere —, publicar en Instagram es la única acción de todo
// el sistema que sale hacia afuera, en vivo, frente a gente real. Un error
// acá (una imagen que no cargó bien, un caption raro, un día sin ángulo
// claro) es mucho más visible y más difícil de deshacer que un archivo mal
// generado. Por eso publishDailyPhoto() crea el post con `saveToDraft: true`
// — queda esperando en la app de Buffer para que Rodrigo lo revise y lo
// publique él mismo con un toque, en vez de salir solo. Si con el tiempo
// esto genera confianza, sacar el saveToDraft es un cambio de una línea acá
// (buscar "saveToDraft: true" más abajo).
//
// LA API DE BUFFER ES GraphQL, no REST (confirmado leyendo
// developers.buffer.com directamente, no supuesto) — un solo endpoint
// (https://api.buffer.com), todo viaja como una mutation/query de texto en
// el body. Autenticación: una clave personal generada a mano en Buffer
// (Configuración → API) — mismo patrón simple que Higgsfield/Dropbox, nada
// de OAuth ni app registrada.
//
// LÍMITE HONESTO CONFIRMADO CONTRA LA DOC (6/9/2026): las métricas que
// expone la API de Buffer para Instagram son reactions/comentarios/
// compartidos/guardados/nuevos seguidores — NO "vistas". El plano original
// pensaba juzgar el "ángulo ganador" con vistas/comentarios/compartidos; con
// Buffer, vistas queda afuera. Traer esas métricas es un paso aparte,
// todavía no construido — esto es solo el paso de publicar.
//
// CÓMO SE CONSIGUE EL channelId DE INSTAGRAM: llamar una vez a
// GET /internal/buffer-channels (ver server.js) con el secreto cargado, y
// copiar el "id" del canal con service:"instagram" a BUFFER_INSTAGRAM_CHANNEL_ID
// en Render. No hace falta volver a llamarla salvo que se reconecte la cuenta.
//
// CÓMO SUBE EL VIDEO DE VERDAD A BUFFER (confirmado leyendo
// developers.buffer.com/examples/create-video-post.html, no supuesto): la
// mutation es la misma createPost de siempre, pero el asset va como
// `{ video: { url } }` en vez de `{ image: { url } }` — la doc también
// permite un `metadata.thumbnailOffset` opcional (qué instante del video usar
// como miniatura); se deja afuera por ahora porque la doc confirma que es
// opcional, no obligatorio, y agregarlo es un cambio chico si Rodrigo quiere
// elegir la miniatura más adelante. Buffer exige, igual que con la foto, una
// URL pública desde la que bajar el archivo — no acepta los bytes directo.
//
// POR QUÉ EL PROXY DEL REEL BAJA EL ARCHIVO ENTERO A MEMORIA (igual que
// getPhotoBytes(), no como streaming): la primera versión de esto SÍ
// transmitía en vivo, para cuidar el límite de 512MB del plan gratis de
// Render (que este mismo proyecto ya sufrió una vez, ver la nota en
// daily-media.js, 3/9/2026). Pero se probó tres veces con un reel real y las
// tres veces el video llegó roto — a Buffer y hasta pidiéndolo directo desde
// el navegador — mientras que el archivo original siempre reprodujo
// perfecto en la Mac de Rodrigo (9/9/2026). El problema estaba en el
// streaming en sí, no en el archivo ni en Buffer. Se volvió al mismo patrón
// ya probado de las fotos: bajar todo a memoria con dropboxDownload() antes
// de responder (ver streamReelToResponse() más abajo para el detalle
// completo). Sigue siendo seguro porque un reel real pesa unos pocos MB, muy
// lejos de los 512MB — MAX_VIDEO_BYTES protege el caso de que alguien suba,
// por error, un archivo enorme sin comprimir.

const path = require('path');
const { getDropboxAccessToken } = require('./dropbox-auth');

const MEDIA_FOLDER = process.env.DROPBOX_MEDIA_FOLDER || '/mentis-medios';
const CONTENT_FOLDER = process.env.DROPBOX_CONTENT_FOLDER || '/mentis-contenido';
// Carpeta donde Rodrigo sube, a mano, el reel ya terminado (armado en
// Higgsfield o donde sea) — plana, sin subcarpetas. Los videos ya publicados
// NO se mueven de acá (ver REEL_HISTORY_PATH en publishDailyReel() para el
// porqué, 9/9/2026) — quedan anotados en un historial en vez de moverse.
const REEL_FOLDER = process.env.DROPBOX_REEL_READY_FOLDER || '/mentis-reel-listo';
const BUFFER_TOKEN = process.env.BUFFER_ACCESS_TOKEN;
const INSTAGRAM_CHANNEL_ID = process.env.BUFFER_INSTAGRAM_CHANNEL_ID;
const BUFFER_SECRET = process.env.BUFFER_SECRET;
const FETCH_TIMEOUT_MS = 20000;
// Más generoso que FETCH_TIMEOUT_MS a propósito — acá no solo se espera la
// respuesta, se espera a que TERMINE de pasar todo el video.
const VIDEO_FETCH_TIMEOUT_MS = 240000;
// Tope de sanidad, no de memoria (ver nota de streaming arriba) — un reel de
// Instagram real pesa muchísimo menos que esto; este número solo evita
// intentar servir, por error, un archivo gigante que no era un reel.
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;

const SUPPORTED_EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const SUPPORTED_VIDEO_EXT = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };

async function bufferGraphQL(query) {
  if (!BUFFER_TOKEN) throw new Error('Falta BUFFER_ACCESS_TOKEN en las variables de entorno.');
  const res = await fetch('https://api.buffer.com', {
    method: 'POST',
    headers: { Authorization: `Bearer ${BUFFER_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status} llamando a la API de Buffer`);
  if (data.errors && data.errors.length) throw new Error(data.errors.map((e) => e.message).join('; '));
  return data.data;
}

// Expuesta como GET /internal/buffer-channels — ver el comentario largo de
// arriba sobre cómo usarla.
//
// BUG REAL encontrado por Rodrigo probando esto en vivo (7/9/2026): la
// primera versión pedía "channels" directo, sin darle a Buffer el
// organizationId que su propio esquema exige — Buffer devolvía "Field
// \"channels\" argument \"input\" ... is required, but it was not
// provided." Corregido pidiendo primero las organizaciones de la cuenta
// (query aparte, confirmada contra developers.buffer.com) y recién con ese
// id pidiendo los canales de cada una — la inmensa mayoría de las cuentas
// (la de Rodrigo incluida) van a tener una sola organización, pero esto
// funciona igual si hubiera más de una.
async function getChannels() {
  const orgsQuery = 'query GetOrganizations { account { organizations { id name } } }';
  const orgsData = await bufferGraphQL(orgsQuery);
  const organizations = (orgsData.account && orgsData.account.organizations) || [];
  if (organizations.length === 0) {
    throw new Error('La clave de Buffer no tiene ninguna organización asociada — revisá que la cuenta de Buffer esté completa.');
  }

  const allChannels = [];
  for (const org of organizations) {
    const channelsQuery = `query GetChannels { channels(input: { organizationId: ${JSON.stringify(org.id)} }) { id name displayName service } }`;
    const data = await bufferGraphQL(channelsQuery);
    (data.channels || []).forEach((c) => {
      allChannels.push({ id: c.id, name: c.name, displayName: c.displayName, service: c.service, organization: org.name });
    });
  }
  return allChannels;
}

// Mismo patrón que dropboxListFolder en daily-photo.js — carpeta plana, sin
// recursividad. publishDailyReel() filtra por extensión de video, así que
// historial-publicados.json (que vive en esta misma carpeta) queda afuera
// solo, sin necesidad de ignorarlo a mano.
async function dropboxListFolder(token, folderPath) {
  const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ path: folderPath }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) {
    const summary = data.error_summary || `HTTP ${res.status}`;
    if (summary.startsWith('path/not_found')) return []; // carpeta todavía no existe — nada subido aún
    throw new Error(summary);
  }
  return data.entries || [];
}

// Sube (o sobrescribe) un archivo chico en Dropbox — la usa publishDailyReel
// para guardar el historial de reels ya publicados (ver el comentario grande
// ahí abajo, 9/9/2026, sobre por qué existe ese historial).
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
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error_summary || `HTTP ${res.status} subiendo ${dropboxPath}`);
  }
}

async function dropboxGetMetadata(token, dropboxPath) {
  const res = await fetch('https://api.dropboxapi.com/2/files/get_metadata', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ path: dropboxPath }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_summary || `HTTP ${res.status} pidiendo metadata de ${dropboxPath}`);
  return data;
}

// timeoutMs opcional — por defecto FETCH_TIMEOUT_MS (pensado para archivos
// chicos como fotos o JSON), pero streamReelToResponse() de abajo le manda
// VIDEO_FETCH_TIMEOUT_MS, más generoso, porque un video tarda más en bajar.
async function dropboxDownload(token, dropboxPath, timeoutMs = FETCH_TIMEOUT_MS) {
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath }) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} descargando ${dropboxPath}`);
  // Bajarlo entero con arrayBuffer() (en vez de ir transmitiendo el body a
  // medida que llega) es justamente lo que evita el bug real que encontramos
  // el 9/9/2026 al transmitir el video en vivo (ver el comentario largo en
  // streamReelToResponse, más abajo, con la explicación completa de qué
  // pasaba y por qué se abandonó ese camino).
  return Buffer.from(await res.arrayBuffer());
}

async function dropboxDownloadJSON(token, dropboxPath, fallback) {
  try {
    const buf = await dropboxDownload(token, dropboxPath);
    return JSON.parse(buf.toString('utf-8'));
  } catch {
    return fallback;
  }
}

// Descarga los bytes reales de una foto de la carpeta de medios — la usa la
// ruta GET /internal/photo-proxy/<secreto>/<archivo> en server.js, para
// darle a Buffer una URL pública desde la que bajar la imagen (la API de
// Buffer exige una URL, no acepta los bytes subidos directamente — confirmado
// contra la doc). El secreto va en la propia URL (mismo truco que el webhook
// de Higgsfield) porque quien la llama es el servidor de Buffer, no nosotros
// — no puede mandar headers propios.
async function getPhotoBytes(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mediaType = SUPPORTED_EXT[ext];
  if (!mediaType) throw new Error(`Tipo de archivo no soportado: ${filename}`);
  const dropboxToken = await getDropboxAccessToken();
  const buffer = await dropboxDownload(dropboxToken, `${MEDIA_FOLDER}/${filename}`);
  return { buffer, mediaType };
}

// Responde a una petición HEAD sobre la foto (sin bajar el archivo entero) —
// agregado 9/9/2026 al mismo tiempo que el de abajo para el reel, ver ese
// comentario para el porqué (Buffer probablemente revisa el archivo con HEAD
// antes de bajarlo entero, y hasta ahora esta ruta solo sabía responder GET).
async function headPhotoResponse(filename, res) {
  const ext = path.extname(filename).toLowerCase();
  const mediaType = SUPPORTED_EXT[ext];
  if (!mediaType) throw new Error(`Tipo de archivo no soportado: ${filename}`);
  const dropboxToken = await getDropboxAccessToken();
  const meta = await dropboxGetMetadata(dropboxToken, `${MEDIA_FOLDER}/${filename}`);
  res.writeHead(200, { 'Content-Type': mediaType, 'Content-Length': String(meta.size || 0) });
  res.end();
}

// Arma el texto del post (el caption real de Instagram — lo que se lee
// DEBAJO del post — no el texto quemado en pantalla del video, que
// daily-script.js guarda aparte como captionText/captionTextParte2. Se
// reusan esos campos porque ya vienen en español, en tono, y con la palabra
// clave a comentar (cta) — no hace falta pedirle a Mentis un texto nuevo
// solo para esto.
function buildPostText(entry) {
  const gancho = entry.captionTextParte2 || entry.captionText || entry.angulo || '';
  const partes = [gancho, entry.cta].filter(Boolean);
  return partes.join('\n\n');
}

async function publishDailyPhoto(baseUrl) {
  if (!BUFFER_TOKEN) return { ok: false, error: 'Falta BUFFER_ACCESS_TOKEN en las variables de entorno.' };
  if (!INSTAGRAM_CHANNEL_ID) return { ok: false, error: 'Falta BUFFER_INSTAGRAM_CHANNEL_ID — llamá primero a GET /internal/buffer-channels para encontrarlo.' };
  if (!BUFFER_SECRET) return { ok: false, error: 'Falta BUFFER_SECRET — hace falta para armar la URL pública de la foto que Buffer va a descargar.' };

  let dropboxToken;
  try {
    dropboxToken = await getDropboxAccessToken();
  } catch (err) {
    return { ok: false, error: err.message };
  }

  // La elección de hoy ya la hizo daily-photo.js — acá solo se lee, nunca se
  // vuelve a elegir nada.
  const history = await dropboxDownloadJSON(dropboxToken, `${MEDIA_FOLDER}/photo-history.json`, { entries: [] });
  const dateStr = new Date().toISOString().slice(0, 10);
  const todayChoice = (history.entries || []).slice().reverse().find((e) => e.date === dateStr);
  if (!todayChoice || !todayChoice.file) {
    return { ok: true, published: false, reason: 'Hoy no hay ninguna foto elegida por daily-photo.js todavía (fin de semana, carrusel, o no corrió) — nada que publicar.' };
  }

  const contentHistory = await dropboxDownloadJSON(dropboxToken, `${CONTENT_FOLDER}/content-history.json`, { entries: [] });
  const todayEntry = (contentHistory.entries || []).find((e) => e.date === dateStr && e.tipo === 'reel');
  const text = todayEntry ? buildPostText(todayEntry) : (todayChoice.angulo || 'Nuevo contenido.');

  const photoUrl = `${baseUrl.replace(/\/+$/, '')}/internal/photo-proxy/${BUFFER_SECRET}/${encodeURIComponent(todayChoice.file)}`;

  // Mutation armada como un solo string con los valores ya escapados vía
  // JSON.stringify (en vez de "variables" de GraphQL con un tipo de entrada
  // que no está confirmado en la doc) — mismo patrón literal que muestran
  // los ejemplos oficiales de developers.buffer.com.
  //
  // Mismo campo obligatorio que se encontró probando el camino del reel
  // (7/9/2026, ver el comentario largo en publishDailyReel) — Buffer exige
  // metadata.instagram.type para cualquier post de Instagram, no solo para
  // video. Acá siempre "post" (una foto normal de feed, no story ni reel).
  const mutation = `mutation CreateDraftPost {
    createPost(input: {
      text: ${JSON.stringify(text)},
      channelId: ${JSON.stringify(INSTAGRAM_CHANNEL_ID)},
      schedulingType: automatic,
      mode: addToQueue,
      saveToDraft: true,
      assets: [{ image: { url: ${JSON.stringify(photoUrl)} } }],
      metadata: { instagram: { type: post, shouldShareToFeed: true } }
    }) {
      ... on PostActionSuccess { post { id text } }
      ... on MutationError { message }
    }
  }`;

  const data = await bufferGraphQL(mutation);
  const result = data.createPost;
  if (result && result.message) {
    return { ok: false, error: `Buffer rechazó el post: ${result.message}` };
  }

  return {
    ok: true, published: false, draft: true, date: dateStr,
    file: todayChoice.file, text, bufferPostId: (result && result.post && result.post.id) || null,
  };
}

// Busca, entre las fechas AAAA-MM-DD al principio del nombre del archivo
// (ej. "2026-09-08.mp4"), el guion de ESE día exacto — así el caption
// publicado corresponde de verdad al video, aunque Rodrigo lo suba días
// después de haber visto el ángulo. Si el archivo no trae esa fecha, o no
// hay guion guardado para esa fecha, se cae al guion tipo "reel" más
// reciente que haya, y se avisa con un "warning" en la respuesta — como
// igual queda como borrador (ver el comentario grande de arriba sobre
// saveToDraft), Rodrigo lo revisa en Buffer antes de que salga, así que un
// caption levemente desalineado no llega a publicarse solo.
function extractDateFromFilename(filename) {
  const m = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

async function findScriptForReel(dropboxToken, filename) {
  const contentHistory = await dropboxDownloadJSON(dropboxToken, `${CONTENT_FOLDER}/content-history.json`, { entries: [] });
  const entries = contentHistory.entries || [];
  const fileDate = extractDateFromFilename(filename);

  if (fileDate) {
    const exact = entries.find((e) => e.date === fileDate && e.tipo === 'reel');
    if (exact) return { entry: exact, warning: null };
    return {
      entry: entries.slice().reverse().find((e) => e.tipo === 'reel') || null,
      warning: `El archivo "${filename}" trae la fecha ${fileDate} en el nombre, pero no hay ningún guion de ese día en el historial — se usó el guion "reel" más reciente en su lugar. Revisá el texto en Buffer antes de publicar.`,
    };
  }

  return {
    entry: entries.slice().reverse().find((e) => e.tipo === 'reel') || null,
    warning: `El archivo "${filename}" no empieza con una fecha (AAAA-MM-DD) — se usó el guion "reel" más reciente para el texto. Nombralo, por ejemplo, "2026-09-08.mp4" la próxima vez para que el sistema use el texto del día exacto.`,
  };
}

// BUG REAL encontrado por Rodrigo el 9/9/2026, y es la explicación de TODA
// la confusión con "el video se ve roto" de los intentos anteriores: esta
// función movía el archivo a REEL_FOLDER/publicados/ apenas Buffer aceptaba
// el post (createPost exitoso) — pero "aceptar el post" no es lo mismo que
// "ya terminé de bajar/procesar el video". Buffer sigue pidiendo el video
// desde nuestra URL (/internal/reel-proxy/...) DESPUÉS de ese momento —
// para armar el preview en su propia app, y de nuevo al momento real de
// publicar en Instagram, que puede ser minutos después (con "Next
// Available" no es inmediato). Como ya habíamos movido el archivo, esos
// pedidos posteriores chocaban con "path/not_found" — Buffer se quedaba con
// un video roto/inexistente, aunque el archivo original nunca tuvo nada
// malo. Rodrigo lo confirmó a mano: moviendo el archivo de vuelta al origen
// después de publicar, el reel apareció bien en Instagram.
//
// La solución: dejar de mover el archivo. En vez de eso, se guarda un
// historial (REEL_FOLDER/historial-publicados.json) con los nombres ya
// publicados, y esta función lo consulta para no volver a tomar el mismo
// video en la corrida de mañana. El archivo se queda en su lugar
// indefinidamente — Rodrigo puede borrarlo a mano de Dropbox cuando quiera
// (por ejemplo, una vez que confirmó en Instagram que salió bien), sin
// apuro, ya que el sistema nunca lo va a volver a publicar solo.
const REEL_HISTORY_PATH = `${REEL_FOLDER}/historial-publicados.json`;

// Expuesta como POST /internal/publish-reel — ver el comentario grande al
// principio del archivo (CAMINO 2) para el porqué de este camino entero.
async function publishDailyReel(baseUrl) {
  if (!BUFFER_TOKEN) return { ok: false, error: 'Falta BUFFER_ACCESS_TOKEN en las variables de entorno.' };
  if (!INSTAGRAM_CHANNEL_ID) return { ok: false, error: 'Falta BUFFER_INSTAGRAM_CHANNEL_ID — llamá primero a GET /internal/buffer-channels para encontrarlo.' };
  if (!BUFFER_SECRET) return { ok: false, error: 'Falta BUFFER_SECRET — hace falta para armar la URL pública del reel que Buffer va a descargar.' };

  let dropboxToken;
  try {
    dropboxToken = await getDropboxAccessToken();
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const history = await dropboxDownloadJSON(dropboxToken, REEL_HISTORY_PATH, { entries: [] });
  const yaPublicados = new Set(history.entries.map((e) => e.file));

  const entries = await dropboxListFolder(dropboxToken, REEL_FOLDER);
  const videoEntries = entries.filter(
    (e) => e['.tag'] === 'file' && SUPPORTED_VIDEO_EXT[path.extname(e.name).toLowerCase()] && !yaPublicados.has(e.name),
  );

  if (videoEntries.length === 0) {
    return { ok: true, published: false, reason: `No hay ningún video nuevo esperando en ${REEL_FOLDER} — subí ahí el reel terminado cuando lo tengas listo (formatos: ${Object.keys(SUPPORTED_VIDEO_EXT).join(', ')}).` };
  }

  // El más viejo primero (por si Rodrigo sube varios de una — se publican de
  // a uno por corrida, en el orden en que los subió).
  videoEntries.sort((a, b) => new Date(a.server_modified) - new Date(b.server_modified));
  const chosen = videoEntries[0];

  if (chosen.size && chosen.size > MAX_VIDEO_BYTES) {
    return { ok: false, error: `"${chosen.name}" pesa más de ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)}MB — revisá que sea realmente el reel (no un archivo de edición sin comprimir) antes de volver a intentar.` };
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const { entry: scriptEntry, warning } = await findScriptForReel(dropboxToken, chosen.name);
  const text = scriptEntry ? buildPostText(scriptEntry) : chosen.name;

  const videoUrl = `${baseUrl.replace(/\/+$/, '')}/internal/reel-proxy/${BUFFER_SECRET}/${encodeURIComponent(chosen.name)}`;

  // BUG REAL encontrado por Rodrigo probando esto en vivo (7/9/2026): Buffer
  // rechazó el primer intento con "Invalid post: Instagram posts require a
  // type (post, story, or reel)." — el ejemplo genérico de video de la doc
  // (create-video-post.html) no lo menciona, hace falta ir al tipo
  // InstagramPostMetadataInput (developers.buffer.com/types/
  // InstagramPostMetadataInput.html) para encontrarlo: va en
  // `metadata.instagram.type`, no al nivel de arriba del input. Los valores
  // válidos de PostType para Instagram son post/story/reel (confirmado en
  // developers.buffer.com/types/PostType.html) — acá siempre "reel", que es
  // justo lo que este módulo publica. `shouldShareToFeed` es OBLIGATORIO
  // junto con `type` (no opcional) — se manda en `true` para que el reel
  // también aparezca en el feed principal además de la pestaña Reels, que es
  // lo que conviene para construir audiencia; si Rodrigo prefiere que NO
  // aparezca en el feed, es cambiar este `true` a `false`.
  const mutation = `mutation CreateReelDraft {
    createPost(input: {
      text: ${JSON.stringify(text)},
      channelId: ${JSON.stringify(INSTAGRAM_CHANNEL_ID)},
      schedulingType: automatic,
      mode: addToQueue,
      saveToDraft: true,
      assets: [{ video: { url: ${JSON.stringify(videoUrl)} } }],
      metadata: { instagram: { type: reel, shouldShareToFeed: true } }
    }) {
      ... on PostActionSuccess { post { id text } }
      ... on MutationError { message }
    }
  }`;

  const data = await bufferGraphQL(mutation);
  const result = data.createPost;
  if (result && result.message) {
    return { ok: false, error: `Buffer rechazó el reel: ${result.message}` };
  }
  const bufferPostId = (result && result.post && result.post.id) || null;

  // Se anota en el historial recién DESPUÉS de que Buffer aceptó el post —
  // así, si algo falla antes (Buffer rechaza el video, se cae la conexión),
  // el archivo no queda anotado y la próxima corrida lo vuelve a intentar
  // solo, en vez de perderlo de vista. El archivo en sí NO se mueve ni se
  // borra (ver el comentario grande sobre REEL_HISTORY_PATH más arriba) —
  // Buffer puede necesitar volver a pedirlo por un rato todavía.
  history.entries.push({ file: chosen.name, date: dateStr, bufferPostId, publishedAt: new Date().toISOString() });
  try {
    await dropboxUpload(dropboxToken, REEL_HISTORY_PATH, Buffer.from(JSON.stringify(history, null, 2)));
  } catch (err) {
    return {
      ok: true, published: false, draft: true, date: dateStr, file: chosen.name, text, bufferPostId,
      warning: `El reel ya se creó como borrador en Buffer, pero no se pudo guardar el historial (${err.message}) — puede que mañana el sistema intente tomar este mismo video de nuevo. No hace falta que hagas nada; si pasa, avisame.`,
    };
  }

  return {
    ok: true, published: false, draft: true, date: dateStr,
    file: chosen.name, text, bufferPostId, ...(warning ? { warning } : {}),
  };
}

// Transmite en vivo (streaming) el video pedido directo desde Dropbox hacia
// la respuesta HTTP, sin juntarlo entero en memoria — ver el comentario
// grande al principio del archivo sobre por qué. La llama el propio
// servidor de Buffer, no nosotros, por eso el secreto viaja en la URL (ver
// GET /internal/reel-proxy/<secreto>/<archivo> en server.js).
// CAMBIO DE FONDO el 9/9/2026: esta función arrancó transmitiendo el video en
// vivo (streaming, sin juntarlo entero en memoria) para cuidar el límite de
// 512MB de Render. Se probó tres veces con un reel real y las tres veces
// Buffer terminó con un video roto o que no cargaba — incluso pidiendo el
// archivo directo desde el navegador, sin pasar por Buffer, se veía roto.
// El video original, en la Mac de Rodrigo, siempre reprodujo perfecto — así
// que el problema estaba en el streaming en sí (reenviar el content-length
// mal si Dropbox comprimía la respuesta, o algún corte de conexión a mitad
// de la transmisión que nadie agarraba), no en el archivo.
//
// En vez de seguir cazando ese bug a ciegas, se volvió al mismo patrón que
// ya funciona de punta a punta con las fotos (getPhotoBytes): bajar el
// archivo ENTERO a memoria con dropboxDownload() (que usa arrayBuffer(), no
// streaming) y mandarlo de una — así el tamaño que declaramos
// (buffer.length) es siempre exacto, porque es el mismo buffer que se manda,
// no un número reenviado de otro lado que puede no coincidir.
//
// Por qué esto no reabre el problema de memoria que motivó el streaming en
// primer lugar: un reel de Instagram real dura segundos, no horas — pesa
// unos pocos MB, muy lejos de los 512MB del plan gratis de Render. El chequeo
// de MAX_VIDEO_BYTES de abajo (contra la metadata, ANTES de bajar nada) es
// la protección para el caso raro de que alguien suba, por error, un archivo
// gigante sin comprimir en vez de un reel.
async function streamReelToResponse(filename, res) {
  const ext = path.extname(filename).toLowerCase();
  const mediaType = SUPPORTED_VIDEO_EXT[ext];
  if (!mediaType) throw new Error(`Tipo de archivo no soportado: ${filename}`);
  const dropboxToken = await getDropboxAccessToken();
  const meta = await dropboxGetMetadata(dropboxToken, `${REEL_FOLDER}/${filename}`);
  if (meta.size && meta.size > MAX_VIDEO_BYTES) {
    throw new Error(`"${filename}" pesa más de ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)}MB — no se sirve por seguridad de memoria.`);
  }
  const buffer = await dropboxDownload(dropboxToken, `${REEL_FOLDER}/${filename}`, VIDEO_FETCH_TIMEOUT_MS);
  res.writeHead(200, { 'Content-Type': mediaType, 'Content-Length': String(buffer.length) });
  res.end(buffer);
}

// Responde a una petición HEAD sobre el reel (sin bajar el video entero) —
// agregado 9/9/2026 tras un error real de Buffer: "Video could not be read
// from its URL" al publicar el primer reel de prueba. Hipótesis más probable
// (no confirmada en la documentación de Buffer, que no detalla su mecánica
// HTTP interna, pero es un patrón común en servicios que validan un archivo
// antes de descargarlo entero): Buffer capaz manda un HEAD primero para
// revisar el tipo/tamaño del archivo — y esta ruta, hasta ahora, solo sabía
// responder a GET, así que un HEAD hubiera caído en el 404 genérico del
// servidor. Pedir la metadata (rápido, sin bajar el video) en vez de armar
// todo el streaming de arriba solo para descartar el body es más liviano.
async function headReelResponse(filename, res) {
  const ext = path.extname(filename).toLowerCase();
  const mediaType = SUPPORTED_VIDEO_EXT[ext];
  if (!mediaType) throw new Error(`Tipo de archivo no soportado: ${filename}`);
  const dropboxToken = await getDropboxAccessToken();
  const meta = await dropboxGetMetadata(dropboxToken, `${REEL_FOLDER}/${filename}`);
  res.writeHead(200, { 'Content-Type': mediaType, 'Content-Length': String(meta.size || 0) });
  res.end();
}

module.exports = {
  getChannels, publishDailyPhoto, buildPostText, getPhotoBytes, headPhotoResponse,
  publishDailyReel, streamReelToResponse, headReelResponse,
};

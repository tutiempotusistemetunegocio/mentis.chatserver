// Módulo 03 → publicar en Instagram vía Buffer. Reemplaza a Metricool en este
// paso puntual (publicar + más adelante métricas) — decisión de Rodrigo
// (6/9/2026), después de confirmar contra la documentación real de las dos
// que Metricool exige su plan Advanced (~$53/mes) para tener API, mientras
// que Buffer da acceso a la API desde su plan gratis. Corre dentro del mismo
// mentis-chat-server, mismo patrón que el resto de los módulos.
//
// QUÉ HACE HOY (a propósito, acotado): publica como BORRADOR en Buffer la
// FOTO que daily-photo.js ya eligió para el ángulo del día — no depende de
// Higgsfield (que sigue pausado esperando confirmación de Rodrigo). El día
// que Higgsfield esté confirmado funcionando, este mismo módulo se puede
// extender para publicar el video en vez de (o además de) la foto.
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

const path = require('path');
const { getDropboxAccessToken } = require('./dropbox-auth');

const MEDIA_FOLDER = process.env.DROPBOX_MEDIA_FOLDER || '/mentis-medios';
const CONTENT_FOLDER = process.env.DROPBOX_CONTENT_FOLDER || '/mentis-contenido';
const BUFFER_TOKEN = process.env.BUFFER_ACCESS_TOKEN;
const INSTAGRAM_CHANNEL_ID = process.env.BUFFER_INSTAGRAM_CHANNEL_ID;
const BUFFER_SECRET = process.env.BUFFER_SECRET;
const FETCH_TIMEOUT_MS = 20000;

const SUPPORTED_EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

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

async function dropboxDownload(token, dropboxPath) {
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath }) },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} descargando ${dropboxPath}`);
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
  const mutation = `mutation CreateDraftPost {
    createPost(input: {
      text: ${JSON.stringify(text)},
      channelId: ${JSON.stringify(INSTAGRAM_CHANNEL_ID)},
      schedulingType: automatic,
      mode: addToQueue,
      saveToDraft: true,
      assets: [{ image: { url: ${JSON.stringify(photoUrl)} } }]
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

module.exports = { getChannels, publishDailyPhoto, buildPostText, getPhotoBytes };

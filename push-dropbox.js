// Módulo 08 — sube la carpeta /knowledge (ya actualizada por la lectura
// diaria, ver daily-ingest.md) de vuelta a Dropbox, para que la instancia
// servida del chat (que hace pull con sync-dropbox.js) tenga la versión
// más reciente. Sin dependencias externas, misma app de Dropbox y mismo
// token que sync-dropbox.js — solo necesita además el permiso
// files.content.write habilitado en la app.

const fs = require('fs');
const path = require('path');
const { getDropboxAccessToken } = require('./dropbox-auth');

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const KNOWLEDGE_DIR = path.join(__dirname, 'knowledge');
const DROPBOX_FOLDER = process.env.DROPBOX_KNOWLEDGE_FOLDER || '/mentis-reglas';

// BUG REAL encontrado en auditoría (3/9/2026): esta función nunca le decía a
// quien la llama si algo salió mal — ni si no consiguió el token, ni si un
// archivo puntual falló al subir (solo lo logueaba con console.error y
// seguía). Devolvía siempre undefined y el mensaje final era siempre "Subida
// completa.", diga lo que diga el log. Eso es grave concretamente en
// daily-ingest.js, la única llamadora real: esa función escribe el
// manifiesto (processed-files.json) INMEDIATAMENTE después de llamar a esto,
// dando por hecho que el conocimiento nuevo ya está a salvo en Dropbox. Si
// la subida fallaba en silencio y el disco de Render no sobrevivía hasta la
// próxima corrida (nunca está garantizado, ver el comentario grande de
// daily-ingest.md), el conocimiento aprendido ese día se perdía para
// siempre — pero el manifiesto igual quedaba marcando esos archivos como
// "ya procesados", así que ni siquiera se reintentaban solos. Ahora esta
// función devuelve {ok, uploaded, failed, error} para que el llamador pueda
// decidir con información real en vez de asumir éxito.
async function pushToDropbox() {
  let token;
  try {
    token = await getDropboxAccessToken();
  } catch (err) {
    console.log(`No se pudo obtener el access token de Dropbox: ${err.message}`);
    return { ok: false, uploaded: [], failed: [], error: err.message };
  }

  const files = fs.readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith('.md') || f.endsWith('.txt'));
  const uploaded = [];
  const failed = [];
  for (const name of files) {
    const localPath = path.join(KNOWLEDGE_DIR, name);
    const content = fs.readFileSync(localPath);
    const dropboxPath = `${DROPBOX_FOLDER}/${name}`;

    const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath, mode: 'overwrite', mute: true }),
        'Content-Type': 'application/octet-stream',
      },
      body: content,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`No se pudo subir ${name}: HTTP ${res.status} — ${errText}`);
      failed.push({ name, error: `HTTP ${res.status} — ${errText}` });
      continue;
    }
    uploaded.push(name);
    console.log(`Subido: ${name}`);
  }
  console.log(failed.length ? `Subida terminada CON ERRORES: ${failed.length} de ${files.length} archivo(s) no se pudieron subir.` : 'Subida completa.');
  return { ok: failed.length === 0, uploaded, failed };
}

if (require.main === module) {
  pushToDropbox().then((result) => {
    if (!result.ok) process.exit(1);
  }).catch((err) => {
    console.error('Error subiendo a Dropbox:', err.message);
    process.exit(1);
  });
}

module.exports = { pushToDropbox };

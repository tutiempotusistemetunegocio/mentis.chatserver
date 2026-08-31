// Módulo 08 — sincroniza la carpeta de conocimiento de Mentis desde Dropbox
// hacia la carpeta local /knowledge que server.js lee en cada pregunta.
// Sin dependencias externas: usa la API REST de Dropbox directo con fetch.
//
// Pensado para correr como tarea programada (cron) cada vez que el Módulo 07
// (aprendizaje continuo) termina de reescribir las reglas en el Mac de
// Rodrigo y las sube a Dropbox — así esta instancia servida siempre habla
// con la versión más reciente de Mentis, sin que él tenga que hacer nada
// a mano.
//
// Requiere una app de Dropbox con acceso de "App folder" (no a todo el
// Dropbox de la cuenta) y un access token guardado en DROPBOX_ACCESS_TOKEN
// (.env). Guía rápida: https://www.dropbox.com/developers/apps -> Create app
// -> Scoped access -> App folder -> pestaña "Permissions": habilitar
// files.metadata.read y files.content.read -> pestaña "Settings": generar
// el access token.

const fs = require('fs');
const path = require('path');

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

async function syncFromDropbox() {
  const token = process.env.DROPBOX_ACCESS_TOKEN;
  if (!token) {
    console.log('DROPBOX_ACCESS_TOKEN no está configurado — nada que sincronizar todavía.');
    console.log('Mientras tanto, server.js sigue leyendo los archivos que ya están en /knowledge.');
    return;
  }

  console.log(`Buscando archivos en Dropbox: ${DROPBOX_FOLDER}`);
  const listRes = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ path: DROPBOX_FOLDER }),
  });
  const listing = await listRes.json();
  if (!listRes.ok) throw new Error(listing.error_summary || `HTTP ${listRes.status}`);

  if (!fs.existsSync(KNOWLEDGE_DIR)) fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });

  for (const entry of listing.entries) {
    if (entry['.tag'] !== 'file') continue;
    if (!entry.name.endsWith('.md') && !entry.name.endsWith('.txt')) continue;

    const downloadRes = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({ path: entry.path_lower }),
      },
    });
    if (!downloadRes.ok) {
      console.error(`No se pudo descargar ${entry.name}: HTTP ${downloadRes.status}`);
      continue;
    }
    const buffer = Buffer.from(await downloadRes.arrayBuffer());
    fs.writeFileSync(path.join(KNOWLEDGE_DIR, entry.name), buffer);
    console.log(`Sincronizado: ${entry.name}`);
  }

  console.log('Sincronización completa.');
}

if (require.main === module) {
  syncFromDropbox().catch((err) => {
    console.error('Error sincronizando con Dropbox:', err.message);
    process.exit(1);
  });
}

module.exports = { syncFromDropbox };

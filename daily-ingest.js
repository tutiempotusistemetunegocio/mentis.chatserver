// Módulo 01 → conocimiento — implementación real de la lectura diaria descrita
// en daily-ingest.md. Corre DENTRO del mismo proceso que server.js (mismo
// servicio de Render, mismas variables de entorno ya cargadas ahí:
// ANTHROPIC_API_KEY y DROPBOX_ACCESS_TOKEN) — así ningún secreto nuevo tiene
// que pasar por ningún lado más que el panel de Render donde Rodrigo ya los
// cargó.
//
// Qué hace, en orden:
//  1. Baja de Dropbox la versión más reciente de /knowledge y del manifiesto
//     de archivos procesados (por si el servicio se reinició — Render no
//     garantiza que el disco local sobreviva un redeploy, así que Dropbox es
//     la fuente de verdad, no el disco local).
//  2. Lista la carpeta de alimentación (una sola carpeta plana, sin
//     subcarpetas por categoría — decisión explícita de Rodrigo) y compara
//     contra el manifiesto para encontrar archivos nuevos o cambiados.
//  3. Por cada archivo nuevo (hasta un máximo por corrida, para no pasarse de
//     tiempo ni de costo de API en una sola ejecución): lo descarga, extrae
//     el texto (PDF con pdf-parse, Word con mammoth, texto plano directo —
//     nada de notas de voz, esa vía se descartó), y le pide a Mentis (vía la
//     API de Claude) que decida a qué categorías aporta y qué principios
//     nuevos agregar, sin copiar texto textual y sin duplicar lo que ya está.
//  4. Aplica esos cambios a los archivos locales de /knowledge — nunca borra
//     una línea existente; si algo quedó desactualizado, lo marca con
//     "[desactualizado: ...]" en vez de eliminarlo (ver reglas.md).
//  4.5. Agregado 3/9/2026, pedido explícito de Rodrigo ("cada vez que se
//     carga nueva información, que ajuste la estrategia si hace falta"): si
//     esta corrida sumó algún principio nuevo, se le pregunta a Mentis una
//     vez más si eso cambia algo de la ESTRATEGIA central (reglas.md, cómo
//     vende — no un tema puntual) y, si sí, agrega esa línea a la sección
//     "Ajustes de estrategia" de reglas.md (nunca borra, mismo criterio que
//     el resto del archivo). Ver reviewStrategy() más abajo.
//  4.6. Agregado el mismo día, pedido explícito de Rodrigo ("buscar siempre
//     nuevas oportunidades para vender, para monetizar"): en la misma
//     llamada de 4.5, se le hace a Mentis una segunda pregunta, separada de
//     la anterior — no si hay que ajustar CÓMO ya vende, sino si el
//     documento sugiere algo NUEVO y concreto que Rodrigo podría vender. Si
//     Mentis dice que sí, se agrega como una entrada nueva (nunca se
//     sobreescribe ninguna) a strategy-opportunities.json, que después se
//     sube a Dropbox junto con /knowledge — el panel personal (Módulo 08,
//     ver panel.js) las muestra en su sección "Estrategia". Mismo criterio
//     exigente: la mayoría de los documentos no generan ninguna oportunidad
//     nueva, y eso es lo esperado.
//  5. Sube /knowledge y el manifiesto actualizado de vuelta a Dropbox.

const fs = require('fs');
const path = require('path');
const { syncFromDropbox } = require('./sync-dropbox');
const { getDropboxAccessToken } = require('./dropbox-auth');
const { pushToDropbox } = require('./push-dropbox');

const KNOWLEDGE_DIR = path.join(__dirname, 'knowledge');
const MANIFEST_PATH = path.join(__dirname, 'processed-files.json');
// Oportunidades de monetización que Mentis va señalando (ver reviewStrategy
// más abajo) — mismo patrón que video-history.json/photo-history.json: un
// array que solo crece, nunca se sobreescribe una entrada vieja.
const OPPORTUNITIES_PATH = path.join(__dirname, 'strategy-opportunities.json');
const FEEDING_FOLDER = process.env.DROPBOX_FEEDING_FOLDER || ''; // '' = raíz del App folder
const KNOWLEDGE_FOLDER = process.env.DROPBOX_KNOWLEDGE_FOLDER || '/mentis-reglas';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const MAX_FILES_PER_RUN = parseInt(process.env.INGEST_MAX_FILES_PER_RUN || '3', 10);
const MAX_CHARS_PER_DOC = 60000; // tope por documento, para acotar tiempo y costo por corrida

// Ver el comentario largo en dropbox-auth.js (auditoría de confiabilidad,
// 2/9/2026): sin esto, una llamada colgada a Dropbox o a Claude dejaba la
// corrida esperando sin límite en vez de fallar limpio. Clasificar un
// documento es lo más lento (puede analizar hasta 60.000 caracteres), por
// eso tiene su propio límite más generoso.
const FETCH_TIMEOUT_MS = 20000;
const CLASSIFY_TIMEOUT_MS = 90000;

// Las 17 categorías con módulo propio (ver "Categorías de libros de la
// carpeta de alimentación" en el plano — 18 categorías en total, "Fuentes
// oficiales de algoritmos" no es un libro y vive sintetizada dentro de
// redes-sociales.md, por eso no tiene archivo propio en esta lista).
const CATEGORY_FILES = [
  'redes-sociales.md', 'ventas.md', 'disciplina.md', 'mentalidad.md', 'finanzas.md',
  'emprendedurismo.md', 'multinivel.md', 'network-marketing.md', 'marketing.md',
  'como-hacerte-rico.md', 'inteligencia-artificial.md', 'liderazgo-equipos.md',
  'copywriting-persuasion.md', 'productividad-tiempo.md', 'storytelling-oratoria.md',
  'psicologia-consumidor.md', 'mentalidad-ceo.md',
];

const SUPPORTED_EXT = new Set(['.pdf', '.docx', '.txt']);

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return { _comment: 'Manifiesto de la lectura diaria.', processed: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    // Compatibilidad con el manifiesto de ejemplo original ({ processed: [] })
    if (Array.isArray(parsed.processed)) parsed.processed = {};
    return parsed;
  } catch {
    return { _comment: 'Manifiesto de la lectura diaria.', processed: {} };
  }
}

function loadOpportunities() {
  if (!fs.existsSync(OPPORTUNITIES_PATH)) return { entries: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(OPPORTUNITIES_PATH, 'utf-8'));
    if (!Array.isArray(parsed.entries)) parsed.entries = [];
    return parsed;
  } catch {
    return { entries: [] };
  }
}

function saveOpportunities(data) {
  fs.writeFileSync(OPPORTUNITIES_PATH, JSON.stringify(data, null, 2));
}

function saveManifest(manifest) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

async function dropboxListFolder(token, folderPath) {
  const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ path: folderPath }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_summary || `HTTP ${res.status} listando ${folderPath || '(raíz)'}`);
  return data.entries || [];
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

// Extrae texto plano de PDF, Word o texto. Requires lazy — así el servidor
// principal (server.js) no se cae si por algún motivo estos paquetes no
// llegaron a instalarse: solo falla este paso puntual, no el chat.
async function extractText(name, buffer) {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.pdf') {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return data.text;
  }
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  if (ext === '.txt') {
    return buffer.toString('utf-8');
  }
  return null;
}

function currentKnowledgeSnapshot() {
  return CATEGORY_FILES.map((f) => {
    const p = path.join(KNOWLEDGE_DIR, f);
    const content = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : `# Bloque: ${f}\n`;
    return `### ${f}\n${content.trim()}`;
  }).join('\n\n');
}

async function classifyAndSynthesize(docName, text) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const truncated = text.slice(0, MAX_CHARS_PER_DOC);
  const prompt = `Sos Mentis haciendo la lectura diaria de la carpeta de alimentación (Módulo 01). Te llegó un documento nuevo llamado "${docName}". Tu trabajo, en este orden:

1. Leé el contenido y decidí a cuáles de estas categorías aporta algo REAL y aplicado (puede ser una, varias, o ninguna): ${CATEGORY_FILES.join(', ')}.
2. Para cada categoría a la que aporta, escribí entre 1 y 6 principios NUEVOS, cortos y aplicados, en el mismo estilo que ya tienen esos archivos (formato "- principio."). Nunca copies texto textual del documento — sintetizá la idea con tus propias palabras. Si una idea ya está cubierta en el archivo actual (aunque con otras palabras), NO la repitas.
3. Si el documento contradice algo que ya está escrito en un archivo, no lo borres ni lo edites vos: devolvé el texto EXACTO de esa línea vieja en "outdated" para que el sistema la marque como desactualizada — nunca se elimina conocimiento, solo se deja de usar lo que quedó obsoleto.

Devolvé SOLO un objeto JSON válido, sin texto antes ni después ni bloque de código, con esta forma exacta:
{"additions": {"<archivo.md>": ["- principio nuevo"]}, "outdated": {"<archivo.md>": ["<línea exacta que quedó vieja>"]}}

Si el documento no aporta nada real a ninguna categoría, devolvé {"additions": {}, "outdated": {}}.

--- CONTENIDO ACTUAL DE CADA CATEGORÍA ---
${currentKnowledgeSnapshot()}

--- DOCUMENTO NUEVO: ${docName} ---
${truncated}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(CLASSIFY_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || `HTTP ${res.status} clasificando ${docName}`);
  const raw = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Mentis no devolvió JSON válido al clasificar "${docName}"`);
  return JSON.parse(jsonMatch[0]);
}

// Aplica el resultado a los archivos locales de /knowledge. Nunca borra una
// línea — suma principios nuevos (sin duplicar), y marca lo desactualizado
// con la etiqueta en vez de eliminarlo. Devuelve la lista de archivos que
// cambiaron.
function applyResult(result) {
  const updated = new Set();

  for (const [file, lines] of Object.entries(result.additions || {})) {
    if (!CATEGORY_FILES.includes(file) || !Array.isArray(lines) || !lines.length) continue;
    const p = path.join(KNOWLEDGE_DIR, file);
    let content = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : `# Bloque: ${file}\n`;
    const existing = new Set(content.split('\n').map((l) => l.trim()).filter(Boolean));
    const newLines = lines.map((l) => (l.trim().startsWith('-') ? l.trim() : `- ${l.trim()}`))
      .filter((l) => !existing.has(l));
    if (!newLines.length) continue;
    content = content.replace(/\n+$/, '') + '\n' + newLines.join('\n') + '\n';
    fs.writeFileSync(p, content);
    updated.add(file);
  }

  for (const [file, oldLines] of Object.entries(result.outdated || {})) {
    if (!CATEGORY_FILES.includes(file) || !Array.isArray(oldLines)) continue;
    const p = path.join(KNOWLEDGE_DIR, file);
    if (!fs.existsSync(p)) continue;
    let content = fs.readFileSync(p, 'utf-8');
    let changed = false;
    for (const oldLine of oldLines) {
      const trimmed = (oldLine || '').trim();
      if (!trimmed) continue;
      const withoutTag = content.split('\n').map((line) => {
        if (line.trim() === trimmed && !line.includes('[desactualizado')) {
          changed = true;
          return line.replace(trimmed, `[desactualizado: reemplazado por lectura más reciente] ${trimmed}`);
        }
        return line;
      });
      content = withoutTag.join('\n');
    }
    if (changed) {
      fs.writeFileSync(p, content);
      updated.add(file);
    }
  }

  return Array.from(updated);
}

// Pedido explícito de Rodrigo (3/9/2026): "cada vez que se carga nueva
// información, él se actualice también de forma a que ajuste la estrategia
// — si tiene una sugestión de mejoría, considerala automáticamente". Hasta
// acá, la lectura diaria solo sumaba conocimiento de TEMAS puntuales
// (categorías) — nunca se preguntaba si lo aprendido cambia algo de CÓMO
// Mentis vende (la estrategia central, guardada en reglas.md). Esto agrega
// ese paso: después de sumar los principios nuevos de este run, se le
// pregunta a Mentis una vez más si eso motiva un ajuste real de estrategia.
// A propósito, solo corre cuando este run realmente aprendió algo nuevo
// (learnedThisRun no vacío) — no tiene sentido ni cuesta gastar una llamada
// extra a la API si no hubo ningún principio nuevo que evaluar.
//
// Ampliado (3/9/2026, mismo día, pedido explícito de Rodrigo: "buscar
// siempre nuevas oportunidades para monetizar"): además del ajuste de
// estrategia de venta (arriba), se le pregunta a Mentis por separado si el
// documento de hoy sugiere una oportunidad NUEVA de monetización — no cómo
// vender lo que ya existe (eso es el ajuste de arriba), sino algo distinto
// que valga la pena ofrecer. Es la semilla de la sección "Estrategia" del
// panel personal (Módulo 08), que el plano describe y hasta hoy no existía
// con datos reales — ver panel.md. Mismo criterio exigente: la mayoría de
// las corridas no debería encontrar nada.
async function reviewStrategy(learnedThisRun) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const rulesPath = path.join(KNOWLEDGE_DIR, 'reglas.md');
  const reglasActuales = fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, 'utf-8') : '';
  const resumenAprendido = Object.entries(learnedThisRun)
    .map(([file, lines]) => `${file}:\n${lines.map((l) => `  ${l}`).join('\n')}`)
    .join('\n\n');

  const prompt = `Sos Mentis. Hoy incorporaste conocimiento nuevo real (recién agregado a tus categorías, no antes):

${resumenAprendido}

Tu estrategia central es la que está en reglas.md, completa acá:
--- REGLAS.MD ACTUAL ---
${reglasActuales}

Con este conocimiento nuevo, respondé dos preguntas distintas:

1. ¿La estrategia central (CÓMO Mentis vende — el enfoque general, el tipo de cierre, la forma de conectar — no un tema puntual de una categoría) sigue siendo la correcta, o hay un ajuste real y accionable que valga la pena agregar? Sé exigente: la respuesta correcta la mayoría de las veces es que NO hace falta ningún cambio — un principio nuevo sobre un tema no siempre cambia la estrategia de venta en sí. Proponé un ajuste SOLO si de verdad se conecta con cómo se vende, nunca por proponer algo.

2. Por separado: ¿este documento sugiere una oportunidad NUEVA y concreta de monetización — algo distinto que Rodrigo podría ofrecer o vender, no una mejora a cómo ya vende lo que tiene? Mismo criterio exigente: proponé algo SOLO si es una idea específica y accionable con este mercado (gente que quiere organizar su tiempo, vender por redes, salir de la mentalidad de empleado) — nunca una idea genérica que aplicaría a cualquier negocio.

Devolvé SOLO un objeto JSON válido, sin texto antes ni después ni bloque de código, con esta forma exacta (usá "ajuste": false y/o "oportunidad": false cuando no aplique — pueden ser independientes, uno puede ser true y el otro false):
{"ajuste": false o true, "razon": "<si ajuste=true: qué principio nuevo lo motiva, 1 frase corta>", "lineaNueva": "<si ajuste=true: el ajuste en sí, corto y accionable, mismo estilo del resto de reglas.md>", "oportunidad": false o true, "oportunidadIdea": "<si oportunidad=true: la idea concreta, 1-2 frases>", "oportunidadRazon": "<si oportunidad=true: qué del documento la motiva, 1 frase corta>"}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(CLASSIFY_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || `HTTP ${res.status} revisando la estrategia`);
  const raw = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Mentis no devolvió JSON válido revisando la estrategia.');
  return JSON.parse(jsonMatch[0]);
}

// Igual que applyResult() con las categorías: nunca borra una línea de
// reglas.md — la primera vez reemplaza el placeholder de la sección
// "Ajustes de estrategia" (ver knowledge/reglas.md), y de ahí en más agrega
// al final del archivo (esa sección es siempre la última). Si algún día un
// ajuste queda superado, se marca `[desactualizado: motivo]` a mano o desde
// una corrida futura de este mismo mecanismo — no desde acá, que solo suma.
function applyStrategyAdjustment(razon, lineaNueva) {
  const p = path.join(KNOWLEDGE_DIR, 'reglas.md');
  if (!fs.existsSync(p)) return;
  let content = fs.readFileSync(p, 'utf-8');
  const bullet = lineaNueva.trim().startsWith('-') ? lineaNueva.trim() : `- ${lineaNueva.trim()}`;
  const entry = razon ? `${bullet} [motivo: ${razon}]` : bullet;
  const placeholder = '(Todavía sin ajustes propios — vacío hasta el primer documento que motive uno.)';
  if (content.includes(placeholder)) {
    content = content.replace(placeholder, entry);
  } else {
    content = content.replace(/\n+$/, '') + '\n' + entry + '\n';
  }
  fs.writeFileSync(p, content);
}

async function runDailyIngest() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: 'Falta ANTHROPIC_API_KEY en las variables de entorno.' };
  let dropboxToken;
  try {
    dropboxToken = await getDropboxAccessToken();
  } catch (err) {
    return { ok: false, error: err.message };
  }

  // 1. Traer la versión más reciente desde Dropbox antes de tocar nada local
  //    — el disco de Render no está garantizado entre reinicios.
  await syncFromDropbox();
  try {
    const manifestBuf = await dropboxDownload(dropboxToken, `${KNOWLEDGE_FOLDER}/processed-files.json`);
    fs.writeFileSync(MANIFEST_PATH, manifestBuf);
  } catch {
    // Todavía no existe en Dropbox (primera corrida) — seguimos con el local/default.
  }
  const manifest = loadManifest();
  try {
    const oppBuf = await dropboxDownload(dropboxToken, `${KNOWLEDGE_FOLDER}/strategy-opportunities.json`);
    fs.writeFileSync(OPPORTUNITIES_PATH, oppBuf);
  } catch {
    // Todavía no existe en Dropbox (primera vez que esto corre) — seguimos con local/default.
  }

  // 2. Listar la carpeta de alimentación (plana, sin subcarpetas) y ver qué es nuevo.
  const entries = await dropboxListFolder(dropboxToken, FEEDING_FOLDER);
  const candidates = entries.filter((e) => {
    if (e['.tag'] !== 'file') return false;
    const ext = path.extname(e.name).toLowerCase();
    if (!SUPPORTED_EXT.has(ext)) return false;
    const known = manifest.processed[e.path_lower];
    return !known || known.content_hash !== e.content_hash;
  });

  const processedNow = [];
  const failed = [];
  const categoriesUpdated = new Set();
  const learnedThisRun = {}; // { "archivo.md": ["- principio nuevo", ...] } — ver reviewStrategy() más abajo

  for (const entry of candidates.slice(0, MAX_FILES_PER_RUN)) {
    try {
      const buffer = await dropboxDownload(dropboxToken, entry.path_lower);
      const text = await extractText(entry.name, buffer);
      if (!text || !text.trim()) {
        manifest.processed[entry.path_lower] = {
          name: entry.name, content_hash: entry.content_hash,
          processedAt: new Date().toISOString(), categories: [], note: 'sin texto extraíble',
        };
        continue;
      }
      const result = await classifyAndSynthesize(entry.name, text);
      const updatedFiles = applyResult(result);
      updatedFiles.forEach((f) => categoriesUpdated.add(f));
      for (const [file, lines] of Object.entries(result.additions || {})) {
        if (!Array.isArray(lines) || !lines.length) continue;
        if (!learnedThisRun[file]) learnedThisRun[file] = [];
        learnedThisRun[file].push(...lines);
      }
      manifest.processed[entry.path_lower] = {
        name: entry.name, content_hash: entry.content_hash,
        processedAt: new Date().toISOString(), categories: updatedFiles,
      };
      processedNow.push(entry.name);
    } catch (err) {
      failed.push({ name: entry.name, error: err.message });
    }
  }

  // 2.5. Pedido explícito de Rodrigo (3/9/2026): con lo aprendido HOY, ¿hay
  // que ajustar la estrategia central (reglas.md)? Solo se llama si de
  // verdad se aprendió algo nuevo esta corrida — no tiene sentido gastar una
  // llamada extra a la API sobre una corrida que no sumó ningún principio.
  // Un fallo acá (JSON inválido, timeout) no tira abajo el resto de la
  // corrida — el conocimiento de categorías ya procesado más arriba se
  // guarda igual; solo se pierde el ajuste de estrategia de esta vez en
  // particular.
  let strategyReview = { ajuste: false, oportunidad: false };
  let opportunitySaved = false;
  if (Object.keys(learnedThisRun).length > 0) {
    try {
      strategyReview = await reviewStrategy(learnedThisRun);
      if (strategyReview.ajuste && strategyReview.lineaNueva) {
        applyStrategyAdjustment(strategyReview.razon, strategyReview.lineaNueva);
      }
      // Pedido explícito de Rodrigo (3/9/2026): "buscar siempre nuevas
      // oportunidades para monetizar" — se guarda en su propio archivo (no
      // en reglas.md, que es sobre CÓMO vender lo que ya existe) para que
      // el panel personal (Módulo 08) las pueda listar como una sección de
      // "Estrategia" real, en vez de quedar enterradas en un log de
      // GitHub Actions que nadie vuelve a mirar.
      if (strategyReview.oportunidad && strategyReview.oportunidadIdea) {
        const opportunities = loadOpportunities();
        opportunities.entries.push({
          date: new Date().toISOString().slice(0, 10),
          fuente: processedNow.join(', ') || '(desconocida)',
          idea: strategyReview.oportunidadIdea,
          razon: strategyReview.oportunidadRazon || null,
        });
        saveOpportunities(opportunities);
        opportunitySaved = true;
      }
    } catch (err) {
      strategyReview = { ajuste: false, oportunidad: false, error: `No se pudo revisar la estrategia: ${err.message}` };
    }
  }

  // 3. Subir todo lo que haya cambiado — conocimiento, manifiesto y
  //    oportunidades — de vuelta a Dropbox.
  //
  // BUG REAL encontrado en auditoría (3/9/2026): antes, esto guardaba el
  // manifiesto (marcando estos archivos como "ya procesados") SIN chequear
  // si pushToDropbox() realmente había logrado subir el conocimiento nuevo —
  // esa función fallaba en silencio (ver el comentario grande en
  // push-dropbox.js). Si la subida fallaba y el disco de Render no
  // sobrevivía hasta la próxima corrida, lo aprendido hoy se perdía para
  // siempre, porque el manifiesto ya decía "esto no hace falta reprocesarlo".
  // Ahora el manifiesto (local y en Dropbox) solo se guarda si el
  // conocimiento realmente llegó a Dropbox — si algo falla, esta corrida
  // termina en error a propósito y los mismos archivos se reintentan
  // (reclasificar + resubir) en la próxima corrida en vez de darse por
  // perdidos en silencio.
  if (processedNow.length > 0) {
    const pushResult = await pushToDropbox();
    if (!pushResult.ok) {
      return {
        ok: false,
        error: `El conocimiento nuevo se generó pero no se pudo subir completo a Dropbox (${(pushResult.failed || []).map((f) => f.name).join(', ') || pushResult.error || 'error desconocido'}) — a propósito NO se guardó el manifiesto, para que la próxima corrida reintente estos mismos archivos en vez de darlos por procesados sin que el conocimiento haya llegado a la fuente de verdad.`,
        processed: processedNow,
        failed,
        categoriesUpdated: Array.from(categoriesUpdated),
        strategyReview,
      };
    }
    try {
      saveManifest(manifest);
      await dropboxUpload(dropboxToken, `${KNOWLEDGE_FOLDER}/processed-files.json`, fs.readFileSync(MANIFEST_PATH));
    } catch (err) {
      return {
        ok: false,
        error: `El conocimiento nuevo sí se subió bien a Dropbox, pero no se pudo actualizar el manifiesto (${err.message}) — la próxima corrida puede reprocesar estos mismos archivos (no duplica conocimiento, la deduplicación ya existente lo evita, solo repite el análisis) hasta que el manifiesto se actualice bien.`,
        processed: processedNow,
        failed,
        categoriesUpdated: Array.from(categoriesUpdated),
        strategyReview,
      };
    }
  }
  if (opportunitySaved) {
    await dropboxUpload(dropboxToken, `${KNOWLEDGE_FOLDER}/strategy-opportunities.json`, fs.readFileSync(OPPORTUNITIES_PATH));
  }

  return {
    ok: true,
    processed: processedNow,
    failed,
    categoriesUpdated: Array.from(categoriesUpdated),
    strategyReview,
    pendingAfterThisRun: Math.max(candidates.length - processedNow.length - failed.length, 0),
  };
}

module.exports = { runDailyIngest, applyResult, extractText };

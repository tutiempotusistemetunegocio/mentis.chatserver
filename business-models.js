// Módulo 08 → "Modelos de negocio para monetizar" — pedido explícito de
// Rodrigo (5/9/2026): "quiero que el sistema, con el conocimiento que tiene,
// me comience a dar sugestiones y estrategias para buscar negocios [...] que
// me recomiende negocios [...] de marketing digital, lo que sea [...] ¿Qué
// puedo hacer para monetizar?". Aclarado con él mismo cuando se le preguntó
// si esto debía buscar empresas reales en internet: "yo quiero es modelos de
// negocios, que yo los pueda utilizar para generar ingresos" — o sea, NO
// nombres de empresas reales ni búsqueda en internet (este servidor no tiene
// ninguna herramienta de búsqueda web, solo la API de Claude), sino modelos
// de negocio concretos que Rodrigo mismo podría ejecutar, generados
// razonando sobre el conocimiento ya acumulado en /knowledge.
//
// Distinto a la sección "Estrategia" que ya existe (ver
// strategy-opportunities.json / reviewStrategy() en daily-ingest.js): eso es
// sobre oportunidades de vender ALGO NUEVO a SU AUDIENCIA (la gente que sigue
// a Mentis/Rodrigo). Esto es al revés: modelos de negocio que Rodrigo puede
// montar y correr ÉL MISMO para generar ingreso propio — pueden ser de
// marketing digital o de cualquier otro rubro, mientras conecten con
// conocimiento real de la base (redes-sociales.md, copywriting-persuasion.md,
// ventas.md, emprendedurismo.md, como-hacerte-rico.md, multinivel.md,
// network-marketing.md, marketing.md, finanzas.md, inteligencia-artificial.md,
// etc. — ver CATEGORY_FILES más abajo).
//
// A diferencia de daily-ingest.js (que solo revisa la estrategia cuando se
// aprendió algo nuevo hoy), esto es una corrida DELIBERADA y recurrente —
// dispara sola cada semana (ver .github/workflows/business-models.yml),
// sin depender de que llegue un libro nuevo — pensado para leer TODO lo que
// ya hay en /knowledge de punta a punta y proponer modelos nuevos, sin
// repetir los que ya se sugirieron antes (se le pasan los títulos previos a
// Mentis para que no repita ideas).
//
// Corre DENTRO del mismo proceso que server.js (mismas variables de entorno
// ya cargadas: ANTHROPIC_API_KEY y las de Dropbox) — mismo patrón que el
// resto de los módulos, ningún secreto nuevo pasa por ningún lado más que
// Render y el secret de GitHub Actions que dispara esta ruta.

const fs = require('fs');
const path = require('path');
const { syncFromDropbox } = require('./sync-dropbox');
const { getDropboxAccessToken } = require('./dropbox-auth');

const KNOWLEDGE_DIR = path.join(__dirname, 'knowledge');
const BUSINESS_MODELS_PATH = path.join(__dirname, 'business-models.json');
const KNOWLEDGE_FOLDER = process.env.DROPBOX_KNOWLEDGE_FOLDER || '/mentis-reglas';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
// Cuántos modelos de negocio nuevos propone como máximo cada corrida — mismo
// motivo que el resto de los MAX_*_PER_RUN: no pasarse de tiempo/costo por
// ejecución, y porque una lista corta y bien pensada sirve más que una larga
// y genérica. Ajustable con BUSINESS_MODELS_PER_RUN si hace falta más volumen
// para arrancar rápido (mismo truco que weekly-guides: disparar el workflow
// a mano varias veces seguidas).
const MODELS_PER_RUN = parseInt(process.env.BUSINESS_MODELS_PER_RUN || '2', 10);
const FETCH_TIMEOUT_MS = 20000;
const GENERATE_TIMEOUT_MS = 90000;

// Mismas 17 categorías que daily-ingest.js (ver CATEGORY_FILES ahí) — se
// repite acá en vez de importarla porque este módulo lee el contenido
// COMPLETO de cada archivo (no solo lo aprendido hoy), a propósito: la idea
// es razonar sobre todo lo acumulado, no sobre una corrida puntual.
const CATEGORY_FILES = [
  'redes-sociales.md', 'ventas.md', 'disciplina.md', 'mentalidad.md', 'finanzas.md',
  'emprendedurismo.md', 'multinivel.md', 'network-marketing.md', 'marketing.md',
  'como-hacerte-rico.md', 'inteligencia-artificial.md', 'liderazgo-equipos.md',
  'copywriting-persuasion.md', 'productividad-tiempo.md', 'storytelling-oratoria.md',
  'psicologia-consumidor.md', 'mentalidad-ceo.md',
];

function loadBusinessModels() {
  if (!fs.existsSync(BUSINESS_MODELS_PATH)) return { entries: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(BUSINESS_MODELS_PATH, 'utf-8'));
    if (!Array.isArray(parsed.entries)) parsed.entries = [];
    return parsed;
  } catch {
    return { entries: [] };
  }
}

function saveBusinessModels(data) {
  fs.writeFileSync(BUSINESS_MODELS_PATH, JSON.stringify(data, null, 2));
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

function fullKnowledgeSnapshot() {
  return CATEGORY_FILES.map((f) => {
    const p = path.join(KNOWLEDGE_DIR, f);
    const content = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
    return content.trim() ? `### ${f}\n${content.trim()}` : null;
  }).filter(Boolean).join('\n\n');
}

async function generateBusinessModels(previousTitles) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const snapshot = fullKnowledgeSnapshot();
  const yaSugeridos = previousTitles.length
    ? `Modelos que YA se sugirieron antes (no los repitas, ni con otro nombre — proponé algo realmente distinto de cada uno de estos):\n${previousTitles.map((t) => `- ${t}`).join('\n')}`
    : 'Todavía no se sugirió ningún modelo antes — esta es la primera corrida.';

  const prompt = `Sos Mentis. Rodrigo te acaba de pedir esto directamente, con sus propias palabras: "quiero que el sistema, con el conocimiento que tiene, me dé sugerencias y estrategias para buscar negocios, que me recomiende negocios de marketing digital o lo que sea — modelos de negocio que yo pueda usar para generar ingresos". Aclaró él mismo que NO quiere nombres de empresas reales ni búsqueda en internet (no tenés esa herramienta) — quiere modelos de negocio concretos que ÉL MISMO pueda montar y ejecutar, para generar ingreso propio.

Esto es DISTINTO de las "oportunidades de monetización" que ya generás en la lectura diaria: aquellas son ideas de qué venderle a SU AUDIENCIA (la gente que sigue a Mentis). Esto es al revés: qué negocio puede montar RODRIGO, usando lo que ya sabe/tiene armado (un sistema de marketing con IA que genera contenido, guías y video solo; conocimiento profundo de redes sociales, copywriting, ventas, mentalidad de emprendedor, multinivel/network marketing, IA aplicada). Puede ser de marketing digital o de cualquier otro rubro, mientras conecte con algo real de la base de conocimiento de abajo — nada de ideas genéricas que aplicarían a cualquier persona ("vendé cursos online", "hacé dropshipping" sin más).

Generá exactamente ${MODELS_PER_RUN} modelo(s) de negocio NUEVO(s). ${yaSugeridos}

Para cada uno, devolvé:
- "titulo": nombre corto y concreto del modelo (no una frase genérica).
- "descripcion": 2-4 frases, qué es exactamente y cómo genera ingreso.
- "porQueEncaja": 1-2 frases, qué conocimiento/activo real de Rodrigo (de la base de abajo, o el propio sistema Mentis que ya tiene armado) hace que este modelo tenga sentido para él en particular, no para cualquiera.
- "primerosPasos": entre 3 y 5 pasos concretos y accionables para arrancar esta semana (no genéricos tipo "hacé un plan de negocio").
- "esfuerzo": "bajo", "medio" o "alto" — tiempo/trabajo que exige mantenerlo andando.
- "inversionInicial": "bajo", "medio" o "alto" — cualitativo, nunca inventes una cifra en dinero.

Sé exigente: cada modelo tiene que ser específico, accionable, y realista para una sola persona arrancando sin equipo. Nunca prometas cifras de ingresos ni garantías de resultado.

Devolvé SOLO un objeto JSON válido, sin texto antes ni después ni bloque de código, con esta forma exacta:
{"modelos": [{"titulo": "...", "descripcion": "...", "porQueEncaja": "...", "primerosPasos": ["...", "..."], "esfuerzo": "bajo|medio|alto", "inversionInicial": "bajo|medio|alto"}]}

--- BASE DE CONOCIMIENTO COMPLETA ---
${snapshot}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 3000, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || `HTTP ${res.status} generando modelos de negocio`);
  const raw = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Mentis no devolvió JSON válido generando modelos de negocio.');
  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed.modelos)) throw new Error('Mentis devolvió JSON sin la lista "modelos".');
  return parsed.modelos;
}

async function runBusinessModels() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: 'Falta ANTHROPIC_API_KEY en las variables de entorno.' };
  let dropboxToken;
  try {
    dropboxToken = await getDropboxAccessToken();
  } catch (err) {
    return { ok: false, error: err.message };
  }

  // 1. Traer /knowledge y el catálogo de modelos ya sugeridos, más recientes
  //    posibles — mismo motivo que el resto de los módulos: el disco de
  //    Render no está garantizado entre reinicios, Dropbox es la fuente de
  //    verdad.
  await syncFromDropbox();
  try {
    const buf = await dropboxDownload(dropboxToken, `${KNOWLEDGE_FOLDER}/business-models.json`);
    fs.writeFileSync(BUSINESS_MODELS_PATH, buf);
  } catch {
    // Todavía no existe en Dropbox (primera corrida) — seguimos con local/default.
  }
  const catalog = loadBusinessModels();
  const previousTitles = catalog.entries.map((e) => e.titulo).filter(Boolean);

  // 2. Generar los modelos nuevos.
  let modelos;
  try {
    modelos = await generateBusinessModels(previousTitles);
  } catch (err) {
    return { ok: false, error: `No se pudieron generar modelos de negocio: ${err.message}` };
  }
  if (!modelos.length) {
    return { ok: true, agregados: 0, nota: 'Mentis no devolvió ningún modelo nuevo esta corrida.' };
  }

  const today = new Date().toISOString().slice(0, 10);
  const nuevos = modelos.map((m) => ({
    date: today,
    titulo: m.titulo || '(sin título)',
    descripcion: m.descripcion || '',
    porQueEncaja: m.porQueEncaja || '',
    primerosPasos: Array.isArray(m.primerosPasos) ? m.primerosPasos : [],
    esfuerzo: m.esfuerzo || null,
    inversionInicial: m.inversionInicial || null,
  }));
  catalog.entries.push(...nuevos);
  saveBusinessModels(catalog);

  // 3. Subir el catálogo actualizado a Dropbox. Igual que el resto de los
  //    módulos (ver la auditoría de push-dropbox.js): si esto falla, se
  //    devuelve ok:false a propósito, para que quede claro en el log de
  //    GitHub Actions que los modelos generados esta corrida NO llegaron a
  //    la fuente de verdad (aunque sí quedaron en el disco local de Render,
  //    que no está garantizado que sobreviva hasta la próxima corrida).
  try {
    await dropboxUpload(dropboxToken, `${KNOWLEDGE_FOLDER}/business-models.json`, fs.readFileSync(BUSINESS_MODELS_PATH));
  } catch (err) {
    return {
      ok: false,
      error: `Se generaron ${nuevos.length} modelo(s) nuevo(s) pero no se pudieron subir a Dropbox (${err.message}) — no están garantizados de sobrevivir hasta la próxima corrida.`,
      agregados: nuevos.length,
      modelos: nuevos,
    };
  }

  return { ok: true, agregados: nuevos.length, modelos: nuevos };
}

if (require.main === module) {
  runBusinessModels()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (result.ok === false) process.exit(1);
    })
    .catch((err) => {
      console.error('Error generando modelos de negocio:', err.message);
      process.exit(1);
    });
}

module.exports = { runBusinessModels, loadBusinessModels };

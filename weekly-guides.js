// Módulo 02 → catálogo de guías (gratis y premium) — arma el "repositorio de
// guías" que describe el plano, cruzando 2+ categorías complementarias de
// conocimiento por guía (nunca un solo tema, tal como lo pidió Rodrigo).
// Mismo patrón que daily-script.js: corre DENTRO de mentis-chat-server,
// reutiliza las claves ya cargadas en Render, y ningún secreto nuevo viaja a
// ningún otro lado.
//
// Pedido explícito de Rodrigo (2/9/2026): antes de vender, arrancar con 10
// guías premium + 10 gratis ya cargadas — y que el catálogo quede "siempre
// alimentado": todas las semanas, al menos 2 guías gratis + 2 premium
// nuevas, para siempre (no es un lote único, es un módulo recurrente).
//
// Por qué el arranque de 10+10 y las semanas normales usan la MISMA corrida,
// sin un modo especial "primera vez": cada corrida genera hasta
// GUIDES_PER_RUN_FREE gratis + GUIDES_PER_RUN_PREMIUM premium (2+2 por
// default). Para juntar las primeras 20 rápido, Rodrigo puede disparar esta
// tarea a mano varias veces seguidas desde la pestaña "Actions" de GitHub —
// exactamente el mismo truco que ya usó para ponerse al día con los ~101
// libros pendientes de la lectura diaria. Después, el cron semanal solo
// hace la reposición de 2+2 — no hace falta ningún interruptor.
//
// Regla de contenido nueva, pedida junto con esto: si en algún momento una
// guía necesita citar una frase COMPLETA y textual de un autor/libro (no una
// paráfrasis), esa cita se tiene que atribuir explícitamente — nunca
// presentar la frase textual de otro como si fuera de Mentis. Fuera de eso,
// sigue aplicando la regla de siempre: nunca copiar texto ajeno sin citarlo,
// y nunca revelar el mecanismo interno (que esto sale de libros cargados a
// un sistema).
//
// Honesto sobre lo que este archivo NO hace todavía: solo arma el catálogo
// (el contenido, guardado en Dropbox). No manda nada a nadie — eso depende
// de dos piezas que todavía no existen: el disparador por comentario
// ("cuando alguien comenta la palabra clave, mandale una guía gratis") y el
// reenganche cada 15 días eligiendo una guía al azar sin repetir con el
// mismo cliente (Módulo 04) — los dos necesitan ManyChat conectado, que
// Rodrigo todavía no armó. El catálogo queda guardado con un id estable por
// guía justamente para que, el día que se conecte ManyChat, ese módulo solo
// tenga que leer esta misma lista y llevar su propio historial de qué le
// mandó a cada cliente — no hace falta rehacer nada de esto.
//
// Qué hace, en orden:
//  1. Baja de Dropbox el conocimiento y el catálogo de guías existente (por
//     si el servicio se reinició — mismo motivo de siempre).
//  2. Por cada tipo (gratis, premium), genera hasta su cupo por corrida:
//     le pide a Mentis que elija 2 o 3 categorías de conocimiento que se
//     complementen, evitando repetir una combinación ya usada hace poco,
//     y que escriba la guía completa con las reglas de voz + la regla de
//     citas nueva.
//  3. Guarda cada guía como archivo .md fechado y actualiza el índice del
//     catálogo (guide-catalog.json), y sube todo a Dropbox.

const fs = require('fs');
const path = require('path');
const { syncFromDropbox } = require('./sync-dropbox');
const { getDropboxAccessToken } = require('./dropbox-auth');

const KNOWLEDGE_DIR = path.join(__dirname, 'knowledge');
const GUIDES_DIR = path.join(__dirname, 'guias');
const CATALOG_PATH = path.join(__dirname, 'guide-catalog.json');
const GUIDES_FOLDER = process.env.DROPBOX_GUIDES_FOLDER || '/mentis-guias';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const GUIDES_PER_RUN_FREE = parseInt(process.env.GUIDES_PER_RUN_FREE || '2', 10);
const GUIDES_PER_RUN_PREMIUM = parseInt(process.env.GUIDES_PER_RUN_PREMIUM || '2', 10);
const HISTORY_LOOKBACK = 12; // cuántas combinaciones recientes del mismo tipo se le muestran a Mentis para no repetir

// Ver el comentario largo en dropbox-auth.js (auditoría de confiabilidad,
// 2/9/2026): sin límite propio, una llamada colgada dejaba la corrida
// esperando sin límite en vez de fallar limpio.
const FETCH_TIMEOUT_MS = 20000;
const GENERATE_TIMEOUT_MS = 120000; // una guía completa es más larga que un guion de reel

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
    if (summary.startsWith('path/not_found')) return [];
    throw new Error(summary);
  }
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

function loadCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) return { entries: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'));
    if (!Array.isArray(parsed.entries)) parsed.entries = [];
    return parsed;
  } catch {
    return { entries: [] };
  }
}

function saveCatalog(catalog) {
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));
}

function knowledgeCategories() {
  if (!fs.existsSync(KNOWLEDGE_DIR)) return [];
  return fs.readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith('.md'));
}

function fullKnowledgeSnapshot() {
  return knowledgeCategories()
    .map((f) => `### ${f}\n${fs.readFileSync(path.join(KNOWLEDGE_DIR, f), 'utf-8').trim()}`)
    .join('\n\n');
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function slugify(text) {
  return (text || 'guia')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // saca acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'guia';
}

const VOICE_RULES = `Reglas fijas que nunca se rompen:
- Nunca reveles ni insinúes el mecanismo interno (que esto sale de libros cargados a un sistema, o cualquier detalle técnico de cómo funciona Mentis) — esto se entrega a leads y clientes reales, tiene que sonar a criterio propio y experiencia real de Rodrigo.
- Nunca copies texto ajeno sin decirlo: si necesitás usar una frase COMPLETA y textual de un autor o libro conocido (una cita real, no una paráfrasis), tenés que atribuirla explícitamente — nombre del autor y, si aplica, el título del libro, dentro del propio texto de la guía (ej. "Como dice Robert Cialdini en Influence: '...'"). Fuera de esos casos puntuales, seguí sintetizando siempre con tus propias palabras.
- Tono directo y sistemático, sin frases motivacionales vacías ni promesas de resultados garantizados.
- Nunca menciones que Rodrigo vive en Miami, y no le des mucho peso a su esposa — sí a su disciplina, su historia (Venezuela → Portugal → Canadá), el valor del tiempo y las ganas de ayudar a otros a salir de la mentalidad de empleado.`;

async function callMentis(prompt, maxTokens) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || `HTTP ${res.status} generando la guía`);
  const raw = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Mentis no devolvió JSON válido generando la guía.');
  return JSON.parse(jsonMatch[0]);
}

async function generateGuide(tipo, recentCombos, categories) {
  const depthNote = tipo === 'premium'
    ? 'Es una guía PREMIUM (paga): profundidad real, varios frameworks combinados, ejemplos aplicados paso a paso — tiene que sentirse claramente más valiosa que una guía gratis, no solo más larga.'
    : 'Es una guía GRATIS (lead magnet): un framework claro y accionable, valor real y completo en sí mismo, pero sin agotar todo lo que Mentis sabe del tema — deja con ganas de más, nunca se siente incompleta a propósito.';

  const prompt = `Sos Mentis armando el catálogo de guías descargables del sistema (Módulo 02).

Categorías de conocimiento disponibles: ${categories.join(', ')}.

Elegí 2 o 3 de esas categorías que se complementen bien entre sí (nunca uses una sola categoría) y escribí UNA guía nueva y completa a partir de ellas. No repitas ninguna de estas combinaciones ya usadas recientemente para este mismo tipo de guía:
${recentCombos.length ? recentCombos.join('\n') : '(sin historial todavía)'}

${depthNote}

${VOICE_RULES}

Basate en todo el conocimiento cargado más abajo.

Devolvé SOLO un objeto JSON válido, sin texto antes ni después ni bloque de código, con esta forma exacta:
{"categorias": ["archivo1.md", "archivo2.md"], "titulo": "<título de la guía, claro y concreto>", "contenido": "<la guía completa en markdown, lista para entregar tal cual>", "citas": [{"autor": "...", "obra": "...", "frase": "..."}]}

"citas" va vacío ([]) si no usaste ninguna frase textual completa de un autor — solo se llena si de verdad citaste algo palabra por palabra.

--- CONOCIMIENTO DE MENTIS ---
${fullKnowledgeSnapshot()}`;

  return callMentis(prompt, 4000);
}

async function runWeeklyGuides() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: 'Falta ANTHROPIC_API_KEY en las variables de entorno.' };
  let dropboxToken;
  try {
    dropboxToken = await getDropboxAccessToken();
  } catch (err) {
    return { ok: false, error: err.message };
  }

  await syncFromDropbox(); // conocimiento fresco antes de escribir
  if (!fs.existsSync(GUIDES_DIR)) fs.mkdirSync(GUIDES_DIR, { recursive: true });
  try {
    const buf = await dropboxDownload(dropboxToken, `${GUIDES_FOLDER}/guide-catalog.json`);
    fs.writeFileSync(CATALOG_PATH, buf);
  } catch {
    // primera corrida — sin catálogo todavía
  }
  const catalog = loadCatalog();

  const categories = knowledgeCategories();
  if (categories.length < 2) {
    return { ok: false, error: 'Todavía no hay al menos 2 categorías de conocimiento cargadas — hace falta que corra la lectura diaria primero.' };
  }

  const dateStr = todayUTC();
  const generated = [];
  const failures = [];
  const plan = [
    { tipo: 'gratis', count: GUIDES_PER_RUN_FREE },
    { tipo: 'premium', count: GUIDES_PER_RUN_PREMIUM },
  ];

  for (const { tipo, count } of plan) {
    let recentCombos = catalog.entries
      .filter((e) => e.tipo === tipo)
      .slice(-HISTORY_LOOKBACK)
      .map((e) => e.categorias.join(' + '));

    for (let i = 0; i < count; i++) {
      try {
        const result = await generateGuide(tipo, recentCombos, categories);
        const cats = Array.isArray(result.categorias) ? result.categorias.filter((c) => categories.includes(c)) : [];
        if (cats.length < 2) throw new Error('Mentis devolvió menos de 2 categorías válidas para la guía — no se guardó.');

        const id = `${dateStr}-${tipo}-${slugify(result.titulo)}`;
        const fname = `${id}.md`;
        const citas = Array.isArray(result.citas) ? result.citas : [];
        const citasBlock = citas.length
          ? `\n\n---\n**Citas usadas:**\n${citas.map((c) => `- ${c.autor}${c.obra ? `, *${c.obra}*` : ''}: "${c.frase}"`).join('\n')}\n`
          : '';
        const body = `# ${result.titulo}\n\n*Guía ${tipo} — ${dateStr} — categorías: ${cats.join(', ')}*\n\n---\n\n${result.contenido}${citasBlock}`;
        fs.writeFileSync(path.join(GUIDES_DIR, fname), body);

        catalog.entries.push({
          id, tipo, categorias: cats, titulo: result.titulo, archivo: fname,
          creadaEn: new Date().toISOString(), citas: citas.length,
        });
        recentCombos.push(cats.join(' + '));
        generated.push({ id, tipo, titulo: result.titulo });
      } catch (err) {
        failures.push({ tipo, error: err.message });
      }
    }
  }

  if (generated.length > 0) {
    saveCatalog(catalog);
    for (const g of generated) {
      const entry = catalog.entries.find((e) => e.id === g.id);
      const buf = fs.readFileSync(path.join(GUIDES_DIR, entry.archivo));
      await dropboxUpload(dropboxToken, `${GUIDES_FOLDER}/${entry.tipo}/${entry.archivo}`, buf);
    }
    await dropboxUpload(dropboxToken, `${GUIDES_FOLDER}/guide-catalog.json`, fs.readFileSync(CATALOG_PATH));
  }

  const totals = {
    gratis: catalog.entries.filter((e) => e.tipo === 'gratis').length,
    premium: catalog.entries.filter((e) => e.tipo === 'premium').length,
  };

  return {
    ok: failures.length === 0 || generated.length > 0,
    date: dateStr, generated, failures, totals,
  };
}

module.exports = { runWeeklyGuides };

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

// PDF con diseño (Módulo 02 → guide-pdf.js), pedido de Rodrigo (2/9/2026):
// "¿tienes una estructura hecha? ¿versión PDF? ¿los colores?". Se requiere
// acá, no arriba, y adentro de un try/catch: si `pdfkit` todavía no está
// instalado en el deploy (por ejemplo, recién se subió este archivo pero
// todavía no corrió `npm install` en Render), el catálogo de guías tiene que
// seguir funcionando igual con el .md — nunca se cae todo el módulo por el
// PDF, que es la parte nueva y menos probada.
let renderGuidePDF = null;
try {
  ({ renderGuidePDF } = require('./guide-pdf'));
} catch (err) {
  console.error('guide-pdf.js no se pudo cargar (¿falta "npm install" de pdfkit en este deploy?):', err.message);
}

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
// 300s (5 min): en la corrida del 2/9/2026 una premium se abortó por este
// límite con 8.000 tokens de margen — al subir el techo de tokens de la
// premium (ver el comentario en generateGuide) hace falta más tiempo real
// también, así que se sube de 240s a 300s en el mismo cambio.
const GENERATE_TIMEOUT_MS = 300000;

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

// Convierte los "bloques" estructurados que devuelve Mentis (mismo formato
// que espera guide-pdf.js para armar el PDF con diseño) al markdown que se
// guarda como .md en Dropbox — así el .md y el PDF siempre muestran
// exactamente el mismo contenido, nunca dos versiones que puedan divergir.
function bloquesToMarkdown(bloques) {
  return (bloques || [])
    .map((b) => {
      if (b.tipo === 'titulo') return `## ${b.texto}`;
      if (b.tipo === 'lista') return (b.items || []).map((item) => `- ${item}`).join('\n');
      if (b.tipo === 'cita') {
        const attr = b.autor ? `\n> — ${b.autor}${b.obra ? `, *${b.obra}*` : ''}` : '';
        return `> "${b.texto}"${attr}`;
      }
      return b.texto || '';
    })
    .join('\n\n');
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
  // Si Claude se quedó sin espacio (max_tokens) a mitad de la guía, el JSON
  // queda cortado a la mitad — JSON.parse tira un error genérico ("Unexpected
  // end of JSON input") que no dice por qué. Se detecta acá antes de intentar
  // parsear, con un mensaje que sí explica la causa real (esto fue justamente
  // lo que estaba pasando con las guías premium — más profundidad = más
  // texto = más fácil llegar al techo de tokens que las gratis).
  if (data.stop_reason === 'max_tokens') {
    throw new Error(`La guía se cortó a mitad de camino por quedarse sin espacio de respuesta (max_tokens=${maxTokens}) — no se guardó. Hace falta más margen para este tipo de guía.`);
  }
  const raw = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Mentis no devolvió JSON válido generando la guía.');
  return JSON.parse(jsonMatch[0]);
}

async function generateGuide(tipo, recentCombos, categories) {
  // Las guías premium piden explícitamente más profundidad (varios
  // frameworks, ejemplos paso a paso) que las gratis — con el formato viejo
  // (un bloque de texto) 4000 tokens alcanzaba casi siempre, pero el nuevo
  // formato de "bloques" en JSON pesa más por la misma guía (comillas,
  // llaves, claves repetidas), y sumado a que premium ya de por sí pide más
  // contenido, 4000 se quedaba corto justo para premium — por eso las
  // gratis se estaban generando bien y las premium no, siempre fallando
  // silenciosamente con el mismo techo. Ver el chequeo de stop_reason arriba,
  // que ahora deja esto explícito en vez de un error genérico de JSON.
  //
  // Bug encontrado en la corrida real del 2/9/2026 (run #5): subir el techo
  // premium a 8.000 no alcanzó — una de las dos premium de esa corrida
  // volvió a cortarse justo en 8.000 tokens. La primera corrección asumía
  // que 8.000 era "bastante margen", pero no lo era: el modelo usado acá
  // (`claude-sonnet-4-5`, ver MODEL arriba) admite hasta 128.000 tokens de
  // respuesta sin necesitar ningún header especial (confirmado contra la
  // documentación pública de Anthropic el 2/9/2026, no es una suposición) —
  // 8.000 nunca fue un límite real del modelo, era un número elegido a ojo
  // que resultó ser insuficiente para el contenido que pide una guía
  // premium en formato "bloques". Se sube a 20.000, con margen amplio de
  // verdad esta vez: no cuesta más caro salvo que la guía realmente use
  // esos tokens (se paga por lo que se genera, no por el techo puesto).
  //
  // Segundo caso encontrado en la corrida real del 3/9/2026 (run #7): con
  // las premium ya arregladas (2/2 completas), le tocó el mismo corte a una
  // guía GRATIS — el mismo error, ahora con max_tokens=4500. Confirma que
  // 4.500 tampoco era un margen real, era otro número elegido a ojo que
  // esta vez le alcanzó a la mayoría pero no a todas. Mismo razonamiento
  // que con la premium: se sube a 8.000 (el doble), lejos todavía del techo
  // real del modelo.
  const maxTokens = tipo === 'premium' ? 20000 : 8000;

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

La guía se entrega en dos formatos que tienen que decir exactamente lo mismo: un PDF con diseño (portada, colores, tipografía) y un texto plano. Para que ambos salgan iguales sin escribir la guía dos veces, en vez de un bloque de texto libre devolvé el contenido dividido en "bloques" — cada uno es un párrafo, un título de sección, una lista o una cita, en el orden en que van apareciendo:
- {"tipo": "titulo", "texto": "..."} → encabezado de una sección dentro de la guía (no el título general, eso va aparte).
- {"tipo": "parrafo", "texto": "..."} → texto corrido normal.
- {"tipo": "lista", "items": ["...", "..."]} → una lista de puntos.
- {"tipo": "cita", "texto": "<la frase textual completa>", "autor": "...", "obra": "..." (opcional)} → SOLO para una frase textual completa de un autor/libro conocido, con su atribución — la regla de citar siempre que sea texto ajeno palabra por palabra.

Devolvé SOLO un objeto JSON válido, sin texto antes ni después ni bloque de código, con esta forma exacta:
{"categorias": ["archivo1.md", "archivo2.md"], "titulo": "<título de la guía, claro y concreto>", "subtitulo": "<una frase corta que va debajo del título en la portada>", "bloques": [ ...los bloques descriptos arriba, la guía completa... ], "citas": [{"autor": "...", "obra": "...", "frase": "..."}]}

"citas" es la lista resumen de auditoría: un elemento por cada bloque de tipo "cita" que hayas usado (mismo autor/obra/frase). Va vacío ([]) si no usaste ninguna cita textual.

--- CONOCIMIENTO DE MENTIS ---
${fullKnowledgeSnapshot()}`;

  return callMentis(prompt, maxTokens);
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
  const pdfJobs = []; // { id, fname, buffer } generados en memoria, a la espera de subirse a Dropbox junto con todo lo demás
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
        if (!Array.isArray(result.bloques) || result.bloques.length === 0) throw new Error('Mentis no devolvió bloques de contenido válidos para la guía — no se guardó.');

        const id = `${dateStr}-${tipo}-${slugify(result.titulo)}`;
        const fname = `${id}.md`;
        const citas = Array.isArray(result.citas) ? result.citas : [];
        const body = `# ${result.titulo}\n\n${result.subtitulo ? `*${result.subtitulo}*\n\n` : ''}*Guía ${tipo} — ${dateStr} — categorías: ${cats.join(', ')}*\n\n---\n\n${bloquesToMarkdown(result.bloques)}`;
        fs.writeFileSync(path.join(GUIDES_DIR, fname), body);

        catalog.entries.push({
          id, tipo, categorias: cats, titulo: result.titulo, archivo: fname,
          creadaEn: new Date().toISOString(), citas: citas.length,
        });
        recentCombos.push(cats.join(' + '));
        generated.push({ id, tipo, titulo: result.titulo });

        // El PDF es una entrega aparte del .md de arriba, que ya quedó
        // guardado y es válido por sí solo — si esto falla (o si pdfkit no
        // está disponible en este deploy), la guía sigue existiendo igual,
        // solo sin la versión con diseño para esta corrida puntual.
        if (renderGuidePDF) {
          try {
            const buffer = await renderGuidePDF({
              tipo, titulo: result.titulo, subtitulo: result.subtitulo, categorias: cats, bloques: result.bloques,
            });
            pdfJobs.push({ id, fname: `${id}.pdf`, buffer });
          } catch (err) {
            failures.push({ tipo, error: `PDF de "${result.titulo}": ${err.message}` });
          }
        }
      } catch (err) {
        failures.push({ tipo, error: err.message });
      }
    }
  }

  if (generated.length > 0) {
    for (const g of generated) {
      const entry = catalog.entries.find((e) => e.id === g.id);
      const buf = fs.readFileSync(path.join(GUIDES_DIR, entry.archivo));
      await dropboxUpload(dropboxToken, `${GUIDES_FOLDER}/${entry.tipo}/${entry.archivo}`, buf);
    }
    // Los PDF se suben después de los .md, y solo se marcan en el catálogo
    // (archivoPdf) si la subida realmente terminó bien — así el catálogo
    // nunca dice que hay un PDF que en realidad no llegó a Dropbox.
    for (const job of pdfJobs) {
      try {
        const entry = catalog.entries.find((e) => e.id === job.id);
        await dropboxUpload(dropboxToken, `${GUIDES_FOLDER}/${entry.tipo}/${job.fname}`, job.buffer);
        entry.archivoPdf = job.fname;
      } catch (err) {
        failures.push({ tipo: 'pdf-upload', error: err.message });
      }
    }
    saveCatalog(catalog);
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

// Reconstruye {titulo, subtitulo, bloques} a partir del .md ya guardado en
// Dropbox — es el inverso exacto de bloquesToMarkdown() y del armado del
// `body` de arriba (en runWeeklyGuides). Sirve para volver a generar el PDF
// de una guía YA EXISTENTE sin pedirle contenido nuevo a Mentis: mismo texto
// de siempre, solo se rearma el PDF con la versión corregida de
// guide-pdf.js. Es un parseo heurístico (no hay ningún JSON de bloques
// guardado aparte, solo el .md final) — funciona porque bloquesToMarkdown()
// es determinístico y cada bloque queda separado por una línea en blanco,
// así que alcanza con reconocer el prefijo de cada bloque para reconstruirlo.
function parseGuideMarkdown(md) {
  const lines = md.split('\n');
  let titulo = '';
  if (lines[0] && lines[0].startsWith('# ')) titulo = lines[0].slice(2).trim();

  const sepIndex = lines.findIndex((l) => l.trim() === '---');
  let subtitulo = '';
  for (let i = 1; i < (sepIndex >= 0 ? sepIndex : lines.length); i++) {
    const l = lines[i].trim();
    if (!l) continue;
    // La única línea de subtítulo posible es la primera línea no vacía
    // después del título — si en vez de eso ya aparece la línea fija de
    // metadata ("*Guía tipo — fecha — categorías: ...*"), es que esta guía
    // no tenía subtítulo.
    if (l.startsWith('*') && l.endsWith('*') && !l.startsWith('*Guía ')) subtitulo = l.slice(1, -1).trim();
    break;
  }

  const bodyLines = sepIndex >= 0 ? lines.slice(sepIndex + 1) : [];
  const body = bodyLines.join('\n').replace(/^\n+/, '');
  const chunks = body.split(/\n{2,}/).map((c) => c.trim()).filter(Boolean);

  const bloques = chunks.map((chunk) => {
    if (chunk.startsWith('## ')) return { tipo: 'titulo', texto: chunk.slice(3).trim() };
    if (chunk.startsWith('- ')) {
      const items = chunk.split('\n').map((l) => l.replace(/^- /, '').trim()).filter(Boolean);
      return { tipo: 'lista', items };
    }
    if (chunk.startsWith('> "')) {
      const chunkLines = chunk.split('\n');
      const texto = chunkLines[0].replace(/^> "/, '').replace(/"$/, '');
      const attrLine = chunkLines.find((l) => l.startsWith('> — '));
      let autor = '';
      let obra = '';
      if (attrLine) {
        const attr = attrLine.replace(/^> — /, '');
        const m = attr.match(/^(.*?)(?:, \*(.*)\*)?$/);
        if (m) { autor = (m[1] || '').trim(); obra = (m[2] || '').trim(); }
      }
      return { tipo: 'cita', texto, autor, obra };
    }
    return { tipo: 'parrafo', texto: chunk };
  });

  return { titulo, subtitulo, bloques };
}

// Regenera el PDF de una o varias guías YA EXISTENTES a partir del .md que
// ya está guardado en Dropbox (nunca vuelve a pedirle contenido a Mentis) —
// pensado para el día que se corrige un bug de armado en guide-pdf.js (como
// el de las páginas en blanco del 3/9/2026) y hace falta que los PDFs
// viejos, ya entregados, también queden bien — no solo los nuevos de acá en
// adelante. Sin `onlyId`, regenera TODAS las guías del catálogo que tengan
// un .md guardado (el PDF es barato de rehacer: no gasta nada de la API de
// Claude, solo pdfkit local + subir el archivo a Dropbox).
async function regenerateGuidePdfs(onlyId) {
  if (!renderGuidePDF) {
    return { ok: false, error: 'guide-pdf.js no está disponible en este deploy (¿pdfkit no terminó de instalar?) — no se puede regenerar ningún PDF.' };
  }
  const dropboxToken = await getDropboxAccessToken();
  const catalogBuf = await dropboxDownload(dropboxToken, `${GUIDES_FOLDER}/guide-catalog.json`);
  const catalog = JSON.parse(catalogBuf.toString('utf-8'));
  if (!Array.isArray(catalog.entries)) catalog.entries = [];

  const targets = onlyId ? catalog.entries.filter((e) => e.id === onlyId) : catalog.entries;
  if (onlyId && targets.length === 0) {
    return { ok: false, error: `No se encontró ninguna guía con id "${onlyId}" en el catálogo.` };
  }

  const regenerated = [];
  const failed = [];
  for (const entry of targets) {
    try {
      const mdBuf = await dropboxDownload(dropboxToken, `${GUIDES_FOLDER}/${entry.tipo}/${entry.archivo}`);
      const { titulo, subtitulo, bloques } = parseGuideMarkdown(mdBuf.toString('utf-8'));
      if (!bloques.length) throw new Error('no se pudo reconstruir el contenido en bloques a partir del .md guardado');
      const buffer = await renderGuidePDF({
        tipo: entry.tipo, titulo: titulo || entry.titulo, subtitulo, categorias: entry.categorias || [], bloques,
      });
      const fname = `${entry.id}.pdf`;
      await dropboxUpload(dropboxToken, `${GUIDES_FOLDER}/${entry.tipo}/${fname}`, buffer);
      entry.archivoPdf = fname;
      regenerated.push(entry.id);
    } catch (err) {
      failed.push({ id: entry.id, error: err.message });
    }
  }

  if (regenerated.length > 0) {
    await dropboxUpload(dropboxToken, `${GUIDES_FOLDER}/guide-catalog.json`, Buffer.from(JSON.stringify(catalog, null, 2)));
  }

  return { ok: failed.length === 0, total: targets.length, regenerated, failed };
}

module.exports = { runWeeklyGuides, regenerateGuidePdfs };

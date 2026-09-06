// Módulo 02 → "guía cero": la guía de referencia FIJA que explica el
// sistema completo (no un tema puntual). Pedido explícito de Rodrigo
// (6/9/2026): "¿Puedes codificar algo en mentis en que él me haga esa guía
// inicial? O sea, esa guía cero de referencia para enviar siempre al
// cliente, siempre que responde un CTA." — con todo lo charlado en esa
// misma conversación sobre qué tiene que decir (ver REGLAS_GUIA_CERO más
// abajo, y el detalle completo en guia-cero.md).
//
// Diferencia clave con el catálogo de weekly-guides.js: esto NO es una
// guía más del catálogo rotativo (gratis/premium, nuevas cada semana, sin
// repetir combinación de categorías). Es UNA sola guía fija y evergreen —
// siempre el mismo archivo (guia-cero.md / guia-cero.pdf en la raíz de la
// carpeta de guías, no adentro de gratis/ ni premium/), que se REGENERA
// (sobreescribe) cada vez que corre, nunca se acumula ni suma un id nuevo.
// Por eso el workflow que la dispara (guia-cero.yml) es manual, sin cron:
// no tiene sentido rehacerla todas las semanas como el catálogo, solo
// cuando Rodrigo quiera revisarla o mejorarla.
//
// Pensada para mandarse SIEMPRE junto con una segunda guía — la que
// matchea el tema puntual del reel que generó el contacto. Honesto: ese
// segundo mecanismo (elegir del catálogo la guía más relacionada al
// ángulo del reel del día) todavía no está construido — esto resuelve
// la primera mitad ("guía cero" fija), tal como lo pidió Rodrigo en este
// mismo mensaje. El envío en sí (mandarla por ManyChat cuando alguien
// comenta la palabra clave) tampoco existe todavía — mismo estado que el
// catálogo de weekly-guides.js, que ya deja esto mismo aclarado.
//
// Reutiliza exactamente el mismo formato de "bloques" que weekly-guides.js
// (titulo/parrafo/lista/cita) para que guide-pdf.js arme el PDF sin
// ningún cambio — ver el comentario de bloquesToMarkdown() ahí mismo.

const fs = require('fs');
const path = require('path');
const { syncFromDropbox } = require('./sync-dropbox');
const { getDropboxAccessToken } = require('./dropbox-auth');

// Mismo criterio que weekly-guides.js: si pdfkit no está instalado en este
// deploy todavía, la guía cero tiene que poder guardarse igual (solo el
// .md) — nunca se cae el módulo entero por el PDF.
let renderGuidePDF = null;
try {
  ({ renderGuidePDF } = require('./guide-pdf'));
} catch (err) {
  console.error('guide-pdf.js no se pudo cargar (¿falta "npm install" de pdfkit en este deploy?):', err.message);
}

const KNOWLEDGE_DIR = path.join(__dirname, 'knowledge');
const GUIDES_DIR = path.join(__dirname, 'guias');
const GUIDES_FOLDER = process.env.DROPBOX_GUIDES_FOLDER || '/mentis-guias';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

const FETCH_TIMEOUT_MS = 20000;
const GENERATE_TIMEOUT_MS = 300000; // mismo margen que weekly-guides.js para guías largas — ver el comentario ahí sobre por qué 300s y no menos.

// Esta guía es deliberadamente más larga que una guía gratis normal (5
// pilares + historia + cierre, todo en una sola pieza) — arranca con el
// mismo margen amplio que ya le hizo falta a una guía premium en real (ver
// el bug documentado en weekly-guides.js/generateGuide: 8.000 se quedó
// corto, después 20.000 anduvo bien). 12.000 da margen real sin ser
// exagerado para una guía que, a diferencia de la premium, no pide "toda
// la profundidad posible" — solo los 5 pilares bien desarrollados.
const MAX_TOKENS = 12000;

const GUIA_CERO_ID = 'guia-cero';
const MD_PATH = `${GUIDES_FOLDER}/${GUIA_CERO_ID}.md`;
const PDF_PATH = `${GUIDES_FOLDER}/${GUIA_CERO_ID}.pdf`;
const META_PATH = `${GUIDES_FOLDER}/${GUIA_CERO_ID}-meta.json`;

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

function knowledgeCategories() {
  if (!fs.existsSync(KNOWLEDGE_DIR)) return [];
  return fs.readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith('.md'));
}

function fullKnowledgeSnapshot() {
  return knowledgeCategories()
    .map((f) => `### ${f}\n${fs.readFileSync(path.join(KNOWLEDGE_DIR, f), 'utf-8').trim()}`)
    .join('\n\n');
}

// Idéntica a la de weekly-guides.js a propósito — mismo formato de
// "bloques", mismo markdown resultante, así el .md de la guía cero se ve y
// se parsea exactamente igual que cualquier otra guía del catálogo.
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

async function callMentis(prompt, maxTokens) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || `HTTP ${res.status} generando la guía cero`);
  // Mismo chequeo que weekly-guides.js — si Mentis se quedó sin espacio a
  // mitad de la guía, decirlo explícitamente en vez de un error genérico
  // de JSON cortado.
  if (data.stop_reason === 'max_tokens') {
    throw new Error(`La guía cero se cortó a mitad de camino por quedarse sin espacio de respuesta (max_tokens=${maxTokens}) — no se guardó.`);
  }
  const raw = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Mentis no devolvió JSON válido generando la guía cero.');
  return JSON.parse(jsonMatch[0]);
}

// Los 5 pilares del sistema, tal como los describió Rodrigo (6/9/2026) —
// esta guía SIEMPRE gira alrededor de estos mismos 5, a diferencia del
// catálogo semanal (que elige 2-3 categorías distintas cada vez).
const PILARES = `1. Vender sin sonar a vendedor — persuasión real, no manipulación barata.
2. Presencia en redes que sostiene en el tiempo, no un posteo suelto hoy y silencio la semana que viene.
3. La mentalidad que separa a quien construye algo propio de quien solo cambia de trabajo.
4. Ingreso adicional serio — incluido lo bueno del network marketing, sin el ruido ni las promesas vacías de ese mundo.
5. Disciplina y manejo del tiempo como base de todo lo anterior — sin esto, el resto es teoría.`;

// Reglas específicas de ESTA guía puntual — más estrictas que el
// VOICE_RULES general de weekly-guides.js porque varias vienen de un
// "no" explícito de Rodrigo sobre este contenido en particular, no de una
// regla de tono genérica: nunca Miami, nunca su trabajo actual, peso
// mínimo a la esposa (afinado en la sesión del 6/9/2026, después de un
// primer borrador que sí la mencionaba y que Rodrigo pidió recortar).
const REGLAS_GUIA_CERO = `Reglas fijas que nunca se rompen, específicas de esta guía:
- Esta es LA guía de referencia del sistema completo — no un tema puntual como las del catálogo normal. Se manda siempre junto con una segunda guía sobre el tema puntual del reel que generó el contacto; esta es la mitad "de fondo", la que explica el porqué de todo lo demás.
- Contá la historia real de Rodrigo para generar conexión: Venezuela (14 años), después Portugal, después Canadá (donde vive hoy, casi 3 años) — reconstruir la vida desde cero varias veces. Diez años en logística internacional (DHL) como el lugar donde aprendió sistemas y mejora continua. Su formación de ingeniero como la lente con la que ve los problemas (busca el sistema que los resuelve, no el parche de una sola vez).
- NUNCA menciones Miami.
- NUNCA menciones que hoy trabaja en construcción civil, ni des ningún detalle de su trabajo actual — se omite por completo, no se reemplaza por nada.
- Peso mínimo (o directamente ninguna mención) a su esposa — el foco humano de la historia es la disciplina, el tiempo y la mentalidad, no la familia.
- Explicá el sistema alrededor de estos 5 pilares, siempre los mismos:
${PILARES}
- Arrancá con un gancho fuerte en la primera o segunda oración — nunca una introducción lenta antes de enganchar.
- Tono directo y sistemático, sin frases motivacionales vacías ni promesas de resultados garantizados.
- Nunca reveles ni insinúes el mecanismo interno (que esto sale de un sistema con libros cargados) — tiene que sonar a criterio propio y experiencia real de Rodrigo.
- Si citás una frase textual completa de un autor/libro conocido, atribuila explícitamente (autor y, si aplica, obra) dentro del propio texto — fuera de eso, siempre en tus propias palabras.
- Adelantate a la objeción más probable de este público ("no tengo tiempo para esto"), resuelta con la propia historia de Rodrigo como prueba: el sistema devuelve tiempo, no suma otra tarea.
- Cierre de venta OBLIGATORIO como últimos bloques (un "titulo" corto + un "parrafo"): invitá a escribirle directo a Rodrigo para ir más profundo con el sistema completo aplicado a su caso puntual. NUNCA inventes un link, precio o fecha concreta — hoy no existen, y prometerlos sería mentirle a quien lo lee.`;

async function generateGuiaCero() {
  const prompt = `Sos Mentis escribiendo la "guía cero" — la guía de referencia fija que explica el sistema completo de Rodrigo (no un tema puntual del catálogo semanal). Esta es la guía que SIEMPRE se manda primero a un cliente cuando responde el CTA de un reel, junto con una segunda guía sobre el tema puntual de ese reel.

${REGLAS_GUIA_CERO}

Basate en todo el conocimiento cargado más abajo para dar profundidad real a cada pilar (ejemplos, mecanismos concretos) — no te quedes en la superficie de cada punto.

La guía se entrega en dos formatos que tienen que decir exactamente lo mismo: un PDF con diseño y un texto plano. Para que ambos salgan iguales, devolvé el contenido dividido en "bloques" — cada uno un párrafo, un título de sección, una lista o una cita, en el orden en que van apareciendo:
- {"tipo": "titulo", "texto": "..."} → encabezado de una sección dentro de la guía (no el título general, eso va aparte).
- {"tipo": "parrafo", "texto": "..."} → texto corrido normal.
- {"tipo": "lista", "items": ["...", "..."]} → una lista de puntos.
- {"tipo": "cita", "texto": "<la frase textual completa>", "autor": "...", "obra": "..." (opcional)} → SOLO para una frase textual completa de un autor/libro conocido, con su atribución.

Los ÚLTIMOS dos bloques del array tienen que ser el cierre de venta descripto arriba: un "titulo" y un "parrafo".

Devolvé SOLO un objeto JSON válido, sin texto antes ni después ni bloque de código, con esta forma exacta:
{"titulo": "<título de la guía>", "subtitulo": "<una frase corta que va debajo del título en la portada>", "bloques": [ ...la guía completa... ], "citas": [{"autor": "...", "obra": "...", "frase": "..."}]}

"citas" es la lista resumen de auditoría: un elemento por cada bloque de tipo "cita". Va vacío ([]) si no usaste ninguna cita textual.

--- CONOCIMIENTO DE MENTIS ---
${fullKnowledgeSnapshot()}`;

  return callMentis(prompt, MAX_TOKENS);
}

async function runGuiaCero() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: 'Falta ANTHROPIC_API_KEY en las variables de entorno.' };
  let dropboxToken;
  try {
    dropboxToken = await getDropboxAccessToken();
  } catch (err) {
    return { ok: false, error: err.message };
  }

  await syncFromDropbox(); // conocimiento fresco antes de escribir, mismo motivo que en weekly-guides.js
  if (!fs.existsSync(GUIDES_DIR)) fs.mkdirSync(GUIDES_DIR, { recursive: true });

  const categories = knowledgeCategories();
  if (categories.length < 2) {
    return { ok: false, error: 'Todavía no hay al menos 2 categorías de conocimiento cargadas — hace falta que corra la lectura diaria primero.' };
  }

  let result;
  try {
    result = await generateGuiaCero();
  } catch (err) {
    return { ok: false, error: err.message };
  }
  if (!Array.isArray(result.bloques) || result.bloques.length === 0) {
    return { ok: false, error: 'Mentis no devolvió bloques de contenido válidos — no se guardó.' };
  }

  const citas = Array.isArray(result.citas) ? result.citas : [];
  const generatedAt = new Date().toISOString();
  const body = `# ${result.titulo}\n\n${result.subtitulo ? `*${result.subtitulo}*\n\n` : ''}*Guía cero — referencia fija del sistema — actualizada ${generatedAt.slice(0, 10)}*\n\n---\n\n${bloquesToMarkdown(result.bloques)}`;
  fs.writeFileSync(path.join(GUIDES_DIR, `${GUIA_CERO_ID}.md`), body);
  await dropboxUpload(dropboxToken, MD_PATH, Buffer.from(body, 'utf-8'));

  // El PDF es una entrega aparte del .md de arriba, que ya quedó guardado y
  // es válido por sí solo — si esto falla (o si pdfkit no está disponible
  // en este deploy), la guía cero sigue existiendo igual, solo sin la
  // versión con diseño para esta corrida puntual. Mismo criterio que
  // weekly-guides.js.
  let archivoPdf = null;
  if (renderGuidePDF) {
    try {
      const buffer = await renderGuidePDF({
        tipo: 'sistema', titulo: result.titulo, subtitulo: result.subtitulo, categorias: [], bloques: result.bloques,
      });
      await dropboxUpload(dropboxToken, PDF_PATH, buffer);
      archivoPdf = `${GUIA_CERO_ID}.pdf`;
    } catch (err) {
      console.error('Error armando/subiendo el PDF de la guía cero (el .md ya se guardó igual):', err.message);
    }
  }

  const meta = {
    id: GUIA_CERO_ID, titulo: result.titulo, subtitulo: result.subtitulo,
    generatedAt, citas: citas.length, archivoPdf,
  };
  await dropboxUpload(dropboxToken, META_PATH, Buffer.from(JSON.stringify(meta, null, 2)));

  return { ok: true, ...meta };
}

module.exports = { runGuiaCero };

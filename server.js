// Módulo 08 — instancia servida de Mentis para clientes premium.
// Recibe una pregunta, elige el bloque de conocimiento relevante (no todo
// mezclado), arma el prompt con la voz de Mentis, y llama a la API de
// Claude directamente con fetch nativo — sin dependencias externas, así
// corre en cualquier lado con solo Node 18+ instalado.

const http = require('http');
const fs = require('fs');
const path = require('path');

// --- Carga simple de .env (sin depender de la librería dotenv) -------------
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
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

// --- Selección de conocimiento relevante -----------------------------------
// Palabras clave por bloque. Deliberadamente simple (no es búsqueda
// vectorial todavía) para que sea fácil de leer y ajustar a mano. Cuando el
// volumen de libros/experiencias crezca, este es el punto para subir a un
// vector store real.
// Un archivo por categoría del catálogo final de libros (18 categorías,
// ver "Categorías de libros de la carpeta de alimentación" en el plano —
// 17 tienen módulo propio, "Fuentes oficiales de algoritmos" no es un libro
// y se sintetiza directo dentro de redes-sociales.md con su propio refresco
// semanal). Cuando la lectura diaria (ver daily-ingest.md) agregue contenido
// nuevo a una categoría, este es el mismo archivo que se actualiza — el
// server y la ingesta comparten la misma carpeta /knowledge, no dos copias
// separadas. Cada bloque tiene además "adjacent": palabras más sueltas y
// generales que no alcanzan para traer el bloque entero, pero sí para que
// aporte una idea suelta de complemento (ver pickRelevantKnowledge).
const BLOCKS = [
  {
    file: 'redes-sociales.md',
    categoria: 'Social media marketing',
    keywords: ['reel', 'reels', 'video', 'contenido', 'gancho', 'hook', 'alcance',
      'seguidores', 'instagram', 'tiktok', 'viral', 'viralidad', 'publicar', 'publicación', 'algoritmo'],
    adjacent: ['red social', 'redes sociales', 'plataforma', 'engagement'],
  },
  {
    file: 'ventas.md',
    categoria: 'Ventas / cierre',
    keywords: ['vender', 'venta', 'ventas', 'cliente', 'clientes', 'lead', 'leads',
      'captar', 'captando', 'objeción', 'objeciones', 'cerrar', 'precio', 'precios',
      'seguimiento', 'oferta'],
    adjacent: ['convencer', 'negociar', 'propuesta'],
  },
  {
    file: 'disciplina.md',
    categoria: 'Disciplina',
    keywords: ['tiempo', 'organizar', 'organización', 'disciplina', 'planificar',
      'planificación', 'foco', 'agotada', 'agotado', 'balance', 'familia', 'hábito', 'hábitos', 'constancia'],
    adjacent: ['rutina', 'prioridad', 'prioridades'],
  },
  {
    file: 'mentalidad.md',
    categoria: 'Crecimiento personal',
    keywords: ['miedo', 'inseguridad', 'rechazo', 'duda', 'dudas', 'motivación',
      'mentalidad', 'confianza', 'comparar', 'comparación', 'impostor', 'no puedo', 'no sé si puedo'],
    adjacent: ['crecimiento personal', 'superación', 'propósito'],
  },
  {
    file: 'finanzas.md',
    categoria: 'Finanzas',
    keywords: ['dinero', 'ingreso', 'ingresos', 'ahorrar', 'invertir', 'inversión',
      'reinvertir', 'ganancia', 'ganancias', 'gasto', 'gastos', 'comisión', 'margen'],
    adjacent: ['plata', 'presupuesto'],
  },
  {
    file: 'emprendedurismo.md',
    categoria: 'Emprendimiento / negocios',
    keywords: ['negocio', 'emprender', 'emprendimiento', 'escalar', 'delegar',
      'sistema', 'sistemas', 'proceso', 'procesos', 'contratar', 'priorizar', 'crecer'],
    adjacent: ['startup', 'modelo de negocio'],
  },
  {
    file: 'multinivel.md',
    categoria: 'Multiniveles',
    keywords: ['multinivel', 'mlm', 'equipo', 'reclutar', 'reclutamiento', 'downline',
      'línea descendente', 'red de consultoras', 'auspiciar'],
    adjacent: ['patrocinar', 'línea', 'consultora'],
  },
  {
    file: 'network-marketing.md',
    categoria: 'Network marketing',
    keywords: ['network marketing', 'mercadeo en red', 'duplicar', 'duplicación',
      'presentación de negocio', 'plan de compensación'],
    adjacent: ['equipo', 'reclutar'],
  },
  {
    file: 'marketing.md',
    categoria: 'Marketing',
    keywords: ['marketing', 'posicionamiento', 'marca', 'branding', 'mensaje',
      'propuesta de valor', 'nicho', 'público objetivo', 'segmentar'],
    adjacent: ['comunicación', 'campaña'],
  },
  {
    file: 'como-hacerte-rico.md',
    categoria: 'Cómo hacerte rico',
    keywords: ['rico', 'riqueza', 'libertad financiera', 'patrimonio', 'activos',
      'ingresos pasivos', 'multiplicar el dinero'],
    adjacent: ['dinero', 'inversión'],
  },
  {
    file: 'inteligencia-artificial.md',
    categoria: 'Inteligencia artificial',
    keywords: ['inteligencia artificial', 'ia', 'automatizar', 'automatización',
      'prompt', 'herramienta de ia', 'chatgpt', 'claude'],
    adjacent: ['tecnología', 'tendencia'],
  },
  {
    file: 'liderazgo-equipos.md',
    categoria: 'Liderazgo y gestión de equipos',
    keywords: ['liderar', 'liderazgo', 'líder', 'gestionar equipo', 'delegar tareas',
      'cultura de equipo', 'feedback', 'motivar al equipo'],
    adjacent: ['equipo', 'gente'],
  },
  {
    file: 'copywriting-persuasion.md',
    categoria: 'Copywriting y persuasión',
    keywords: ['copywriting', 'copy', 'persuasión', 'persuadir', 'guion', 'guión',
      'texto de venta', 'titular', 'llamado a la acción', 'cta'],
    adjacent: ['escribir', 'mensaje'],
  },
  {
    file: 'productividad-tiempo.md',
    categoria: 'Productividad y gestión del tiempo',
    keywords: ['productividad', 'productivo', 'agenda', 'calendario', 'bloque de tiempo',
      'procrastinar', 'procrastinación', 'urgente', 'importante'],
    adjacent: ['tiempo', 'organizar'],
  },
  {
    file: 'storytelling-oratoria.md',
    categoria: 'Storytelling y oratoria',
    keywords: ['storytelling', 'historia', 'contar una historia', 'oratoria', 'hablar en público',
      'discurso', 'charla', 'presentación en vivo'],
    adjacent: ['comunicar', 'público'],
  },
  {
    file: 'psicologia-consumidor.md',
    categoria: 'Psicología del consumidor / neuromarketing',
    keywords: ['neuromarketing', 'psicología del consumidor', 'sesgo', 'sesgos',
      'decisión de compra', 'comportamiento del consumidor', 'gatillo mental'],
    adjacent: ['comprar', 'decisión'],
  },
  {
    file: 'mentalidad-ceo.md',
    categoria: 'Mentalidad de CEO / pensamiento estratégico',
    keywords: ['ceo', 'estrategia', 'estratégico', 'visión de negocio', 'decisión estratégica',
      'escalar el negocio', 'modelo de ingresos nuevo', 'oportunidad de negocio'],
    adjacent: ['negocio', 'crecer'],
  },
];

// Quita tildes para que "objecion" matchee con la palabra clave "objeción" —
// importante en español, sobre todo con texto escrito rápido o dictado por
// voz, donde las tildes se pierden seguido.
function stripAccents(str) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Matchea por palabra completa, no por substring — sin esto, palabras clave
// cortas como "ia" (de "inteligencia artificial") matcheaban por accidente
// adentro de "podría", "experiencia", etc. Se detectó probando el bloque de
// CEO y se corrigió antes de dejarlo andando en real.
function hasWholeWord(text, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
}

// Toma las primeras líneas con contenido real de un bloque (saltando el
// título y líneas en blanco) para usarlas como "idea suelta" — un resumen
// liviano, no el archivo entero. Esto es lo que separa un bloque "principal"
// (se manda completo) de uno "suelto" (aporta un empujón, no una clase entera).
function excerpt(content, maxLines = 4) {
  // Salta títulos y líneas vacías, y también lo marcado como desactualizado
  // — una idea suelta nunca debería traer justo la parte que Mentis ya no usa.
  const lines = content.split('\n').filter((l) => {
    const t = l.trim();
    return t && !t.startsWith('#') && !/^-?\s*\[desactualizado/i.test(t);
  });
  return lines.slice(0, maxLines).join('\n');
}

// Elige TODOS los bloques cuyas palabras clave "fuertes" aparecen en la
// pregunta — no uno solo. Una pregunta que mezcla marketing + multinivel +
// organización del tiempo en la misma consulta debe traer los tres bloques
// a la vez: la regla nunca fue "un tema = un bloque", fue "no mezclar todo
// por defecto, solo lo que la pregunta realmente toca". Si nada coincide, se
// cae de vuelta a todos los bloques — mejor una respuesta completa que una vacía.
//
// Además, y esto es lo que pidió Rodrigo explícitamente: Mentis no se queda
// encerrado en el/los bloque(s) principal(es). Sobre los bloques que NO
// matchearon fuerte, hace una segunda pasada más floja (con palabras más
// generales, "adjacent") y de ahí saca una idea suelta — un fragmento corto,
// no el archivo completo — para que la respuesta pueda apoyarse en una
// conexión de otra área sin diluirse en contenido que no viene al caso. Esta
// misma función se usa igual para las preguntas de Rodrigo y para las de un
// cliente premium pagando el acceso — no hay una versión "completa" y otra
// "recortada" del comportamiento.
function pickRelevantKnowledge(userMessage) {
  const lower = stripAccents(userMessage.toLowerCase());

  const primary = BLOCKS.filter((b) => b.keywords.some((k) => hasWholeWord(lower, stripAccents(k))));
  const primaryFiles = new Set(primary.map((b) => b.file));

  const loose = primary.length > 0
    ? BLOCKS.filter((b) => !primaryFiles.has(b.file)
        && (b.adjacent || []).some((k) => hasWholeWord(lower, stripAccents(k))))
      .slice(0, 2) // como mucho 2 ideas sueltas — complementa, no compite con el bloque principal
    : [];

  const mainBlocks = primary.length > 0 ? primary : BLOCKS;
  const usedBlocks = primary.length > 0
    ? mainBlocks.map((b) => b.file)
    : ['(ninguna palabra clave coincidió — se usaron todos)'];
  const looseBlocks = loose.map((b) => b.file);

  const mainKnowledge = mainBlocks.map((b) => {
    const content = fs.readFileSync(path.join(KNOWLEDGE_DIR, b.file), 'utf-8');
    return `<!-- bloque principal: ${b.file} (${b.categoria}) -->\n${content}`;
  }).join('\n\n---\n\n');

  const looseKnowledge = loose.map((b) => {
    const content = fs.readFileSync(path.join(KNOWLEDGE_DIR, b.file), 'utf-8');
    return `<!-- idea suelta de: ${b.file} (${b.categoria}) -->\n${excerpt(content)}`;
  }).join('\n\n');

  const reglas = fs.readFileSync(path.join(KNOWLEDGE_DIR, 'reglas.md'), 'utf-8');
  const knowledge = [`<!-- núcleo: reglas.md -->\n${reglas}`, mainKnowledge, looseKnowledge]
    .filter(Boolean).join('\n\n---\n\n');

  return { knowledge, usedBlocks, looseBlocks };
}

function buildSystemPrompt(knowledge, looseBlocks) {
  const looseNote = looseBlocks.length > 0
    ? `\n\nAdemás de los bloques principales, más abajo hay "ideas sueltas" de otras áreas que no son el tema central de la pregunta pero pueden aportar una conexión útil (marcadas como "idea suelta de: ..."). Úsalas solo si de verdad suman profundidad a la respuesta — un dato o ángulo que la enriquezca — nunca las fuerces ni las menciones solo por completar. Si no aportan nada real a esta pregunta puntual, ignoralas.`
    : '';
  return `Eres "Mentis", un sistema totalmente autónomo y automatizado de estrategia de marketing, ventas y organización del tiempo para clientes premium del sistema de Rodrigo. Respondes en español, directo y sistemático, sin frases motivacionales vacías. Das pasos concretos, aplicables ese mismo día. Nunca prometes cifras de ingresos ni resultados garantizados. Estás en constante aprendizaje: todos los días se incorpora experiencia nueva a tu base de conocimiento, y en cada respuesta buscás siempre la opción mejor fundamentada apoyándote en todo lo que sabés, no solo en lo más reciente.

A continuación tenés varios bloques de conocimiento, cada uno marcado con su fuente. Cuando la pregunta toca un solo tema, respondé apoyándote en ese bloque. Cuando la pregunta mezcla varios temas a la vez (por ejemplo marketing + multinivel + organización del tiempo, todo en la misma consulta), NO respondas cada tema por separado ni pegues respuestas una detrás de otra: combiná el conocimiento relevante de todos los bloques en una sola respuesta coherente y con profundidad técnica real, como lo haría alguien que domina las áreas a la vez y ve cómo se conectan entre sí. No inventes fuentes ni datos que no estén acá.${looseNote}

Nada de lo que aprendiste se pierde nunca — pero no todo sigue vigente. Si una línea de un bloque empieza con la etiqueta "[desactualizado: ...]", quedó ahí archivada a propósito: no la uses como base de tu respuesta, ignorala igual que ignorarías una nota vieja que ya no aplica. El resto del contenido, sin esa etiqueta, es lo que hoy Mentis considera vigente.

${knowledge}`;
}

async function callClaude(userMessage) {
  const { knowledge, usedBlocks, looseBlocks } = pickRelevantKnowledge(userMessage);
  const systemPrompt = buildSystemPrompt(knowledge, looseBlocks);

  if (!process.env.ANTHROPIC_API_KEY) {
    const looseNote = looseBlocks.length > 0 ? `\nIdeas sueltas de otras áreas: ${looseBlocks.join(', ')}` : '';
    return {
      reply: `[modo demo — falta ANTHROPIC_API_KEY en .env]\n\nTu pregunta llegó bien: "${userMessage}"\n\nBloques de conocimiento elegidos para responderla: ${usedBlocks.join(', ')}${looseNote}\n\nEn cuanto cargues una clave real de la API de Claude en el archivo .env, esta misma pregunta va a recibir una respuesta real generada por Mentis, combinando esos bloques en una sola respuesta coherente si son más de uno.`,
      mode: 'demo',
      usedBlocks,
      looseBlocks,
    };
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const message = (data && data.error && data.error.message) || `HTTP ${res.status}`;
    throw new Error(message);
  }
  const reply = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return { reply, mode: 'live', usedBlocks, looseBlocks };
}

// --- Acceso: dos sistemas separados, sin cruzarse ---------------------------
// Rodrigo pidió explícitamente dos accesos distintos: uno para el cliente
// premium del chat servido (Módulo 04/08 — paga el acceso a Mentis), y otro
// para el alumno de la formación en vivo que recibe su propia copia del
// panel personal (Módulo 02). Cada uno valida contra su propio manifiesto de
// compras y su propio secreto de webhook — uno nunca habilita al otro.
const PREMIUM_ACCESS_FILE = path.join(__dirname, 'access-premium.json');
const PANEL_ACCESS_FILE = path.join(__dirname, 'access-panel-alumnos.json');
const REQUIRE_ACCESS_CHECK = process.env.REQUIRE_ACCESS_CHECK === 'true';

function loadAccessList(file) {
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return {}; }
}

function saveAccessList(file, list) {
  fs.writeFileSync(file, JSON.stringify(list, null, 2));
}

function grantAccess(file, email) {
  const list = loadAccessList(file);
  list[email.toLowerCase()] = { active: true, updatedAt: new Date().toISOString() };
  saveAccessList(file, list);
}

function revokeAccess(file, email) {
  const list = loadAccessList(file);
  if (list[email.toLowerCase()]) list[email.toLowerCase()].active = false;
  saveAccessList(file, list);
}

function hasAccess(file, email) {
  if (!email) return false;
  const list = loadAccessList(file);
  const entry = list[email.toLowerCase()];
  return !!(entry && entry.active);
}

// Maneja los dos webhooks de Systeme.io (uno por producto) con la misma
// forma, pero cada uno solo puede tocar su propio archivo de acceso — están
// separados a nivel de función, no solo de dato, para que un error de
// configuración no termine dándole a un alumno acceso al chat premium o
// viceversa.
//
// Systeme.io no permite mandar headers propios en sus webhooks (solo se
// puede configurar la URL de destino) — así que el secreto viaja como un
// segmento más en la URL (/webhook/systeme-premium/<secreto>), no como
// header. Se sigue aceptando también el header x-webhook-secret, para poder
// seguir probando a mano con curl sin tener que pegar el secreto en la URL.
//
// El payload real de Systeme.io (ver help.systeme.io/article/2930) trae el
// email adentro de data.customer.email (venta) o data.contact.email
// (opt-in), y el tipo de evento en el campo "type" (ej.
// "customer.sale.completed", o algo con "cancel"/"refund" para una baja) —
// no es la forma simple {email, event} que se usó para probar con curl al
// principio. Se acepta cualquiera de las dos formas.
function extractWebhookEmail(parsed) {
  const email =
    parsed.email ||
    (parsed.data && parsed.data.customer && parsed.data.customer.email) ||
    (parsed.data && parsed.data.contact && parsed.data.contact.email) ||
    '';
  return String(email).trim();
}

function isCancelEvent(parsed) {
  const kind = String(parsed.event || parsed.type || '').toLowerCase();
  return kind.includes('cancel') || kind.includes('refund');
}

function handleAccessWebhook(req, res, file, secretEnvVar, urlSecret) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const expected = process.env[secretEnvVar];
    const headerSecret = req.headers['x-webhook-secret'];
    if (!expected) return sendJSON(res, 501, { error: `${secretEnvVar} no está configurado.` });
    if (urlSecret !== expected && headerSecret !== expected) return sendJSON(res, 401, { error: 'Secreto inválido.' });
    let parsed;
    try { parsed = JSON.parse(body || '{}'); } catch { return sendJSON(res, 400, { error: 'JSON inválido.' }); }
    const email = extractWebhookEmail(parsed);
    if (!email) return sendJSON(res, 400, { error: 'Falta el email.' });
    if (isCancelEvent(parsed)) {
      revokeAccess(file, email);
      return sendJSON(res, 200, { ok: true, email, active: false });
    }
    grantAccess(file, email);
    return sendJSON(res, 200, { ok: true, email, active: true });
  });
}

// --- Servidor HTTP mínimo, sin Express --------------------------------------
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(PUBLIC_DIR, filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Prohibido'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('No encontrado'); }
    const ext = path.extname(filePath);
    const type = ext === '.html' ? 'text/html; charset=utf-8' : 'text/plain';
    res.writeHead(200, { 'content-type': type });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return sendJSON(res, 200, { ok: true, mode: process.env.ANTHROPIC_API_KEY ? 'live' : 'demo' });
  }

  // Lectura diaria de la carpeta de alimentación (Módulo 01 → conocimiento,
  // ver daily-ingest.js y daily-ingest.md). Corre adentro de este mismo
  // servicio, con las mismas claves ya cargadas en Render — nunca se le pasa
  // ningún secreto nuevo a nadie más. Protegido con un secreto propio
  // (INGEST_SECRET) para que no cualquiera pueda dispararla desde afuera;
  // sin ese secreto configurado, la ruta queda cerrada por completo.
  if (req.method === 'POST' && req.url === '/internal/daily-ingest') {
    const expected = process.env.INGEST_SECRET;
    const got = req.headers['x-ingest-secret'];
    if (!expected) return sendJSON(res, 501, { error: 'INGEST_SECRET no está configurado — la lectura diaria está desactivada hasta que se cargue.' });
    if (got !== expected) return sendJSON(res, 401, { error: 'Secreto inválido.' });
    // eslint-disable-next-line global-require
    const { runDailyIngest } = require('./daily-ingest');
    runDailyIngest()
      .then((result) => sendJSON(res, result.ok === false ? 400 : 200, result))
      .catch((err) => {
        console.error('Error en la lectura diaria:', err.message);
        sendJSON(res, 500, { ok: false, error: err.message });
      });
    return;
  }

  // Guion diario (Módulo 03 → daily-script.js/daily-script.md). Mismo patrón
  // que la lectura diaria: corre adentro de este mismo servicio, reutiliza
  // las claves ya cargadas, y queda cerrada sin SCRIPT_SECRET configurado.
  if (req.method === 'POST' && req.url === '/internal/daily-script') {
    const expected = process.env.SCRIPT_SECRET;
    const got = req.headers['x-script-secret'];
    if (!expected) return sendJSON(res, 501, { error: 'SCRIPT_SECRET no está configurado — el guion diario está desactivado hasta que se cargue.' });
    if (got !== expected) return sendJSON(res, 401, { error: 'Secreto inválido.' });
    // eslint-disable-next-line global-require
    const { runDailyScript } = require('./daily-script');
    runDailyScript()
      .then((result) => sendJSON(res, result.ok === false ? 400 : 200, result))
      .catch((err) => {
        console.error('Error generando el guion diario:', err.message);
        sendJSON(res, 500, { ok: false, error: err.message });
      });
    return;
  }

  // Video del guion diario (Módulo 03 → daily-media.js, Higgsfield). Mismo
  // patrón de disparo externo que daily-ingest y daily-script, pero acá el
  // trabajo real llega después por webhook (Higgsfield es asíncrono) — ver
  // el comentario largo al principio de daily-media.js.
  if (req.method === 'POST' && req.url === '/internal/daily-media') {
    const expected = process.env.MEDIA_SECRET;
    const got = req.headers['x-media-secret'];
    if (!expected) return sendJSON(res, 501, { error: 'MEDIA_SECRET no está configurado — la generación de video está desactivada hasta que se cargue.' });
    if (got !== expected) return sendJSON(res, 401, { error: 'Secreto inválido.' });
    // eslint-disable-next-line global-require
    const { runDailyMedia } = require('./daily-media');
    const webhookBaseUrl = `https://${req.headers.host}`;
    runDailyMedia(webhookBaseUrl)
      .then((result) => sendJSON(res, result.ok === false ? 400 : 200, result))
      .catch((err) => {
        console.error('Error pidiendo el clip diario a Higgsfield:', err.message);
        sendJSON(res, 500, { ok: false, error: err.message });
      });
    return;
  }

  // Aviso de Higgsfield cuando el clip terminó (o falló). Higgsfield no
  // manda headers propios, así que el secreto y la fecha viajan como
  // segmentos de la propia URL — ver daily-media.js para el detalle.
  if (req.method === 'POST' && req.url.split('?')[0].replace(/\/+$/, '').startsWith('/webhook/higgsfield-listo/')) {
    const parts = req.url.split('?')[0].replace(/\/+$/, '').split('/').filter(Boolean);
    // parts = ['webhook', 'higgsfield-listo', '<secreto>', '<fecha>']
    const urlSecret = parts[2] || null;
    const dateStr = parts[3] || null;
    const expected = process.env.HIGGSFIELD_WEBHOOK_SECRET;
    if (!expected) return sendJSON(res, 501, { error: 'HIGGSFIELD_WEBHOOK_SECRET no está configurado.' });
    if (urlSecret !== expected) return sendJSON(res, 401, { error: 'Secreto inválido.' });
    if (!dateStr) return sendJSON(res, 400, { error: 'Falta la fecha en la URL del webhook.' });
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body || '{}'); } catch { return sendJSON(res, 400, { error: 'JSON inválido.' }); }
      // eslint-disable-next-line global-require
      const { handleHiggsfieldWebhook } = require('./daily-media');
      handleHiggsfieldWebhook(dateStr, parsed)
        .then((result) => sendJSON(res, result.ok === false ? 400 : 200, result))
        .catch((err) => {
          console.error('Error guardando el clip de Higgsfield:', err.message);
          sendJSON(res, 500, { ok: false, error: err.message });
        });
    });
    return;
  }

  // Carpeta de medios (Módulo 03 → daily-photo.js) — elige la foto que
  // acompaña el reel de hoy. A diferencia de daily-media (Higgsfield), esto
  // es síncrono: la llamada a Claude visión responde en la misma petición,
  // no hay webhook. Mismo patrón de secreto que el resto de las rutas
  // /internal/*.
  if (req.method === 'POST' && req.url === '/internal/daily-photo') {
    const expected = process.env.PHOTO_SECRET;
    const got = req.headers['x-photo-secret'];
    if (!expected) return sendJSON(res, 501, { error: 'PHOTO_SECRET no está configurado — la carpeta de medios está desactivada hasta que se cargue.' });
    if (got !== expected) return sendJSON(res, 401, { error: 'Secreto inválido.' });
    // eslint-disable-next-line global-require
    const { runDailyPhoto } = require('./daily-photo');
    runDailyPhoto()
      .then((result) => sendJSON(res, result.ok === false ? 400 : 200, result))
      .catch((err) => {
        console.error('Error eligiendo la foto diaria:', err.message);
        sendJSON(res, 500, { ok: false, error: err.message });
      });
    return;
  }

  // Catálogo de guías (Módulo 02 → weekly-guides.js) — arma hasta
  // GUIDES_PER_RUN_FREE gratis + GUIDES_PER_RUN_PREMIUM premium por corrida,
  // cruzando 2+ categorías de conocimiento. Mismo patrón de secreto que el
  // resto de las rutas /internal/*, disparada semanalmente por GitHub
  // Actions (ver weekly-guides.yml) — o a mano, varias veces seguidas, para
  // juntar rápido las primeras 20 (mismo truco que ya se usó con la lectura
  // diaria y el backlog de libros).
  if (req.method === 'POST' && req.url === '/internal/weekly-guides') {
    const expected = process.env.GUIDES_SECRET;
    const got = req.headers['x-guides-secret'];
    if (!expected) return sendJSON(res, 501, { error: 'GUIDES_SECRET no está configurado — el catálogo de guías está desactivado hasta que se cargue.' });
    if (got !== expected) return sendJSON(res, 401, { error: 'Secreto inválido.' });
    // eslint-disable-next-line global-require
    const { runWeeklyGuides } = require('./weekly-guides');
    runWeeklyGuides()
      .then((result) => sendJSON(res, result.ok === false ? 400 : 200, result))
      .catch((err) => {
        console.error('Error armando el catálogo de guías:', err.message);
        sendJSON(res, 500, { ok: false, error: err.message });
      });
    return;
  }

  // Panel personal de Rodrigo (Módulo 08 → panel.js) — a diferencia de las
  // rutas /internal/*, esta la abre él mismo desde el navegador, así que el
  // secreto viaja como segmento de la URL (igual que el webhook de
  // Higgsfield) en vez de un header. Sin PANEL_SECRET configurado, las dos
  // rutas quedan cerradas — devuelven 404 en vez de revelar que existen.
  if (req.method === 'GET' && req.url.startsWith('/panel/')) {
    const expected = process.env.PANEL_SECRET;
    const parts = req.url.split('?')[0].split('/').filter(Boolean); // ['panel', '<secreto>', 'guia'?, '<id>'?]
    const urlSecret = parts[1] || null;
    if (!expected || !urlSecret || urlSecret !== expected) { res.writeHead(404); return res.end('No encontrado'); }
    // eslint-disable-next-line global-require
    const { renderPanel, renderGuideContent, renderGuidePdf } = require('./panel');
    if (parts[2] === 'guia' && parts[3] && parts[4] === 'pdf') {
      renderGuidePdf(urlSecret, decodeURIComponent(parts[3]))
        .then((buffer) => {
          if (buffer === null) { res.writeHead(404); return res.end('Esta guía todavía no tiene PDF.'); }
          res.writeHead(200, { 'content-type': 'application/pdf' });
          res.end(buffer);
        })
        .catch((err) => {
          console.error('Error descargando el PDF de una guía:', err.message);
          res.writeHead(500); res.end('No se pudo descargar el PDF: ' + err.message);
        });
      return;
    }
    if (parts[2] === 'guia' && parts[3]) {
      renderGuideContent(urlSecret, decodeURIComponent(parts[3]))
        .then((text) => {
          if (text === null) { res.writeHead(404); return res.end('Guía no encontrada.'); }
          res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(text);
        })
        .catch((err) => {
          console.error('Error leyendo una guía del panel:', err.message);
          res.writeHead(500); res.end('No se pudo leer la guía: ' + err.message);
        });
      return;
    }
    renderPanel(urlSecret)
      .then((html) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); })
      .catch((err) => {
        console.error('Error armando el panel personal:', err.message);
        res.writeHead(500); res.end('No se pudo armar el panel: ' + err.message);
      });
    return;
  }

  // Acepta tanto /webhook/systeme-premium (secreto por header, para probar
  // con curl) como /webhook/systeme-premium/<secreto> (para pegar en
  // Systeme.io, que no permite headers propios) — mismo para -panel.
  if (req.method === 'POST' && req.url.split('?')[0].replace(/\/+$/, '').startsWith('/webhook/systeme-premium')) {
    const urlSecret = req.url.split('?')[0].replace(/\/+$/, '').slice('/webhook/systeme-premium'.length + 1) || null;
    return handleAccessWebhook(req, res, PREMIUM_ACCESS_FILE, 'SYSTEME_PREMIUM_WEBHOOK_SECRET', urlSecret);
  }

  if (req.method === 'POST' && req.url.split('?')[0].replace(/\/+$/, '').startsWith('/webhook/systeme-panel')) {
    const urlSecret = req.url.split('?')[0].replace(/\/+$/, '').slice('/webhook/systeme-panel'.length + 1) || null;
    return handleAccessWebhook(req, res, PANEL_ACCESS_FILE, 'SYSTEME_PANEL_WEBHOOK_SECRET', urlSecret);
  }

  if (req.method === 'POST' && req.url === '/chat') {
    if (REQUIRE_ACCESS_CHECK) {
      const email = (req.headers['x-mentis-email'] || '').toString().trim();
      if (!hasAccess(PREMIUM_ACCESS_FILE, email)) {
        return sendJSON(res, 401, { error: 'Este chat es para clientes premium. Verificá el email con el que compraste el acceso.' });
      }
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      let parsed;
      try { parsed = JSON.parse(body || '{}'); } catch { return sendJSON(res, 400, { error: 'JSON inválido.' }); }
      const userMessage = (parsed.message || '').trim();
      if (!userMessage) return sendJSON(res, 400, { error: 'Falta el mensaje.' });
      try {
        const result = await callClaude(userMessage);
        sendJSON(res, 200, result);
      } catch (err) {
        console.error('Error llamando a la API de Claude:', err.message);
        sendJSON(res, 500, { error: 'Mentis no pudo responder ahora mismo. Intentá de nuevo en un momento.' });
      }
    });
    return;
  }

  if (req.method === 'GET') return serveStatic(req, res);

  res.writeHead(404);
  res.end('No encontrado');
});

// Red de seguridad de último recurso — afinado el 2/9/2026 (auditoría de
// confiabilidad de "toda la programación"). Cada ruta /internal/* y
// /webhook/* ya envuelve su trabajo en .then()/.catch() propio (ver arriba),
// así que en la práctica esto nunca debería dispararse — pero si algún día
// aparece un error que se escapa de esos catch (un bug nuevo, una librería
// que rompe una promesa sin que nadie la espere), esto evita que TODO el
// servicio se caiga por ese único error, lo cual apagaría de golpe las
// cuatro tareas diarias y también el chat de los clientes premium. En vez de
// caerse, lo deja en el log y el proceso sigue vivo.
process.on('uncaughtException', (err) => {
  console.error('Error no capturado (el servicio sigue corriendo):', err);
});
process.on('unhandledRejection', (err) => {
  console.error('Promesa rechazada sin capturar (el servicio sigue corriendo):', err);
});

server.listen(PORT, () => {
  console.log(`Mentis servido escuchando en http://localhost:${PORT}`);
  console.log(`Modo: ${process.env.ANTHROPIC_API_KEY ? 'live (con API de Claude)' : 'demo (sin API key todavía)'}`);
});

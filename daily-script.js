// Módulo 03 → guion diario — genera el guion de reel/carrusel de TODOS los
// días de la semana (un ángulo distinto por día, siguiendo la tabla de
// "Ángulos en prueba esta semana" de reglas.md — ver "Detalle: cómo prueba
// ángulos nuevos" en el plano) y el guion de podcast cada 3 días. Corre
// DENTRO del mismo proceso que server.js (mismo servicio de Render, mismas
// variables ya cargadas ahí) — igual que daily-ingest.js, ningún secreto
// nuevo viaja a ningún otro lado.
//
// Import honesto de lo que este archivo NO hace todavía: el plano describe
// que, con semanas de datos reales de Metricool, Mentis prioriza el ángulo
// ganador y vuelve a probar ángulos nuevos cuando ese cae. Como Metricool
// todavía no está conectado (Rodrigo lo confirmó al pedir este montaje), acá
// no hay ninguna lógica de "ángulo ganador" — cada día se le pide a Mentis un
// ángulo distinto a los últimos usados (guardados en el historial), para
// mantener la variedad de la tabla del plano, pero sin datos de rendimiento
// real todavía. El día que Metricool esté conectado, esta selección puede
// pasar a ser adaptativa de verdad — hoy es honesto que no lo es.
//
// Qué hace, en orden:
//  1. Baja de Dropbox el historial de contenido (por si el servicio se
//     reinició — mismo motivo que daily-ingest.js: el disco de Render no
//     está garantizado entre reinicios).
//  2. Decide qué generar hoy: reel/carrusel todos los días (ver nota más
//     abajo — antes solo de lunes a viernes) y guion de podcast si pasaron 3
//     días desde el último.
//  3. Le pide a Mentis (vía la API de Claude), con TODO el conocimiento
//     cargado como contexto, que escriba el guion — evitando repetir el
//     ángulo de los últimos días, y sin revelar nunca el mecanismo interno
//     (la regla del secreto aplica en especial acá, porque esto se publica).
//  4. Guarda el guion como archivo fechado y lo sube a Dropbox, y actualiza
//     el historial.
//
// Nota sobre "todos los días" (cambiado 5/9/2026, pedido explícito de
// Rodrigo: "quiero que la generación de los prompts y de los reels sea toda
// la semana y no solamente de lunes a viernes"): originalmente esto NO
// generaba reel/carrusel sábado y domingo (WEEKDAYS_ONLY = true), porque el
// plano original solo definía el reparto de ángulos para 5 días. reglas.md
// ya tenía, desde antes, ángulos también para Sábado y Domingo en la tabla
// "Ángulos en prueba esta semana" — así que activar los 7 días no necesitó
// ningún ángulo nuevo, solo dejar de saltear el fin de semana. El cron de
// GitHub Actions (daily-script.yml) ya corría los 7 días — era este código
// el que descartaba sábado/domingo por su cuenta.
//
// Nota sobre "dosPartes" (agregado 6/9/2026, pedido explícito de Rodrigo:
// reels sin voz, solo música/ambiente/captions, con un mensaje visual de
// alto impacto — "puedes hacer dos clips de doce segundos, parte uno, parte
// dos"): Mentis ahora decide, día a día, si el ángulo de hoy entra en UN
// clip de 12s o si realmente tiene dos momentos que se benefician de
// separarse (parte 1 = gancho/problema, parte 2 = resolución + invitación a
// comentar "MENTIS"). Por defecto sigue siendo un solo clip — dos partes es
// la excepción, para no duplicar sin necesidad el costo/tiempo de cada
// pedido a Higgsfield. Ver daily-media.js para cómo esto se traduce en uno o
// dos pedidos de video reales.

const fs = require('fs');
const path = require('path');
const { syncFromDropbox } = require('./sync-dropbox');
const { getDropboxAccessToken } = require('./dropbox-auth');

const KNOWLEDGE_DIR = path.join(__dirname, 'knowledge');
const CONTENT_DIR = path.join(__dirname, 'contenido');
const HISTORY_PATH = path.join(__dirname, 'content-history.json');
const CONTENT_FOLDER = process.env.DROPBOX_CONTENT_FOLDER || '/mentis-contenido';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const PODCAST_EVERY_N_DAYS = 3;
// Cambiado a false el 5/9/2026, pedido explícito de Rodrigo (ver nota
// arriba) — reel/carrusel se genera los 7 días de la semana.
const WEEKDAYS_ONLY = false;
const HISTORY_LOOKBACK = 8; // cuántas entradas recientes se le muestran a Mentis para no repetir ángulo

// Ver el comentario largo en dropbox-auth.js (auditoría de confiabilidad,
// 2/9/2026): sin límite propio, una llamada colgada a Dropbox o a Claude
// dejaba la corrida esperando sin límite en vez de fallar limpio.
const FETCH_TIMEOUT_MS = 20000;
const GENERATE_TIMEOUT_MS = 90000; // escribir un guion completo tarda más que un llamado corto

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

function loadHistory() {
  if (!fs.existsSync(HISTORY_PATH)) return { entries: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
    if (!Array.isArray(parsed.entries)) parsed.entries = [];
    return parsed;
  } catch {
    return { entries: [] };
  }
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
}

function fullKnowledgeSnapshot() {
  if (!fs.existsSync(KNOWLEDGE_DIR)) return '';
  return fs.readdirSync(KNOWLEDGE_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => `### ${f}\n${fs.readFileSync(path.join(KNOWLEDGE_DIR, f), 'utf-8').trim()}`)
    .join('\n\n');
}

function todayUTC() {
  // Fecha en UTC como aproximación al día de Rodrigo — ver daily-script.md
  // para la salvedad sobre zonas horarias (mismo criterio que
  // daily-ingest.yml, que también corre en UTC).
  return new Date().toISOString().slice(0, 10);
}

function weekdayIndex(dateStr) {
  // 0=lunes ... 4=viernes, null=fin de semana. Date.getUTCDay(): 0=domingo.
  const d = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  if (d === 0 || d === 6) return null;
  return d - 1;
}

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Pedido explícito de Rodrigo (3/9/2026), a partir de una mejora que el
// propio Mentis señaló al revisar su estrategia: reglas.md YA tiene una
// tabla de rotación de ángulos por día ("Ángulos en prueba esta semana" —
// dolor+espejo, mito, detrás de cámaras, valor gratis, oferta directa, tu
// por qué, antes/después), pensada justamente para no repetir siempre el
// mismo tipo de gancho (redes-sociales.md: "nunca apostar todo a un solo
// ángulo"). Pero antes esa tabla solo viajaba como texto suelto dentro de
// todo el conocimiento cargado — nada obligaba a Mentis a seguirla de
// verdad, así que en la práctica podía terminar repitiendo el mismo tipo de
// ángulo varios días seguidos sin que nadie lo notara. Esta función la
// PARSEA en vivo desde el propio reglas.md (en vez de copiar la tabla acá
// con un valor fijo) para que, el día que el Módulo 07 la reescriba con
// datos reales de Metricool, este código la siga solo, sin ningún cambio.
// Si el parseo falla por lo que sea (formato cambiado, archivo movido),
// devuelve null y el guion se sigue generando igual, solo sin ese empujón.
function todaysAngleType(dateStr) {
  try {
    const p = path.join(KNOWLEDGE_DIR, 'reglas.md');
    if (!fs.existsSync(p)) return null;
    const content = fs.readFileSync(p, 'utf-8');
    const section = content.split(/^## /m).find((s) => s.startsWith('Ángulos en prueba'));
    if (!section) return null;
    const dayIdx = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=domingo
    const dayName = DAY_NAMES[(dayIdx + 6) % 7]; // reindexa a 0=lunes...6=domingo
    const needle = `${stripAccents(dayName.toLowerCase())}:`;
    const line = section.split('\n').find((l) => stripAccents(l.toLowerCase()).includes(needle));
    if (!line) return null;
    const tipo = line.split(':').slice(1).join(':').trim();
    return tipo || null;
  } catch {
    return null;
  }
}

function daysSinceEpoch(dateStr) {
  const epoch = Date.UTC(2026, 0, 1); // ancla fija y arbitraria, solo para tener un ritmo de 3 días estable
  const d = Date.UTC(...dateStr.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  return Math.floor((d - epoch) / 86400000);
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
  if (!res.ok) throw new Error((data.error && data.error.message) || `HTTP ${res.status} generando contenido`);
  const raw = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Mentis no devolvió JSON válido generando el guion.');
  return JSON.parse(jsonMatch[0]);
}

const VOICE_RULES = `Reglas fijas que nunca se rompen:
- Nunca reveles ni insinúes el mecanismo interno (que esto sale de libros cargados a un sistema, o cualquier detalle técnico de cómo funciona Mentis) — esto se publica en redes, tiene que sonar a criterio propio y experiencia real, con gancho y sin explicar el truco.
- Tono directo y sistemático, sin frases motivacionales vacías ni promesas de resultados garantizados.
- Nunca menciones que Rodrigo vive en Miami, y no le des mucho peso a su esposa — sí a su disciplina, su historia (Venezuela → Portugal → Canadá), el valor del tiempo y las ganas de ayudar a otros a salir de la mentalidad de empleado.
- Esto no es contenido por contenido: el objetivo final es vender (a Rodrigo mismo — sus guías, su sistema). Cada pieza tiene que usar, a propósito, lo que está cargado sobre neurociencia/psicología de la persuasión, redes sociales y network marketing — combinado con la historia personal de Rodrigo — para generar conexión real con quien lo lee/mira. La conexión no es el fin, es el medio: siempre tiene que llevar a una acción concreta de venta al cierre (ver CTA), nunca quedarse en "contenido de valor" suelto sin ningún objetivo comercial detrás.`;

async function generateReelScript(dateStr, wIdx, history) {
  const recent = history.entries.slice(-HISTORY_LOOKBACK).filter((e) => e.tipo === 'reel');
  const recentAngles = recent.map((e) => `${e.date}: ${e.angulo}`).join('\n') || '(sin historial todavía)';
  const angleType = todaysAngleType(dateStr);
  const angleTypeNote = angleType
    ? `Según la rotación de ángulos en prueba esta semana (reglas.md), hoy toca un ángulo del TIPO "${angleType}" — desarrollá el gancho concreto de hoy dentro de ese tipo (no elijas un tipo distinto), aunque el gancho específico tiene que ser nuevo, distinto a los últimos usados.`
    : '';
  const prompt = `Sos Mentis escribiendo el guion de contenido de hoy (${dateStr}) para Rodrigo, dueño de este sistema.

${VOICE_RULES}

Elegí un formato (reel corto de 30-60s, o carrusel de 5-8 slides) y un ángulo/gancho concreto para hoy, distinto a los últimos usados. Angulos usados recientemente (no repitas el mismo gancho central):
${recentAngles}

${angleTypeNote}

Basate en todo el conocimiento cargado más abajo — combiná lo que haga falta (marketing, mentalidad, ventas, redes, lo que aplique), como lo haría alguien que domina todas esas áreas a la vez.

Además del guion completo (pensado como registro/respaldo, no para narrarse: el reel se publica SIN voz, solo música + texto en pantalla), el clip de video que se genera con IA a partir de tu foto real de hoy dura como máximo 12 segundos por pedido — techo de la plataforma, no ajustable.

Antes de describir la escena, decidí "dosPartes": ¿el ángulo de hoy entra cómodo en UN SOLO momento de 12s, o realmente tiene DOS momentos distintos que se benefician de separarse en dos clips consecutivos (ej. el problema y después la vuelta, el mito y después la realidad, el antes y después el después)? Elegí dos partes SOLO cuando de verdad sume claridad al gancho — la mayoría de los días un solo momento bien elegido alcanza; no partas en dos por variedad ni porque sí, cada parte de más es un pedido de video real (costo y tiempo) que tiene que ganarse su lugar.

Si dosPartes es false (el caso más común): describí una sola escena ("escenaVisual") que condense el gancho central de hoy en UN SOLO momento concreto y filmable en 12s — nunca una secuencia de varias escenas ni algo que necesite más de 12s para leerse o tener sentido.

Si dosPartes es true: describí dos escenas separadas y consecutivas ("escenaVisualParte1", "escenaVisualParte2"), cada una su propio momento concreto de hasta 12s — Parte 1 planta el problema/gancho, Parte 2 es la vuelta/resolución. Cada una tiene que tener sentido como clip independiente, no depender de que se vean pegadas una a la otra.

En cualquiera de los dos casos, lo más importante de cada escena es el CONTENIDO, no el estilo: tiene que mostrar una acción concreta directamente relacionada con el momento que le toca — alguien haciendo algo específico que dramatice ese momento (ej. si el gancho es sobre disciplina y hábitos, no alcanza con "alguien trabajando de noche": mostrá la acción puntual que representa eso — apagando el teléfono para volver a escribir, tachando una tarea en una libreta, etc.). Empezá describiendo ESA acción concreta en una frase, y recién después sumá 1-2 detalles de ambiente/iluminación si hacen falta — nunca al revés, y nunca una escena que sea solo ambiente/mood sin ninguna acción puntual. Escribilas directamente en inglés, listas para usarse tal cual como prompt de generación de video (describí solo lo que la cámara ve — acción, ambiente, iluminación — nunca diálogo ni texto en pantalla).

Además, para cuando el clip se genera a mano en el modo "AI Director" de Higgsfield (Cinema Studio — arma música y captions, a diferencia de la API que solo genera el video mudo), describí también el texto en pantalla y la música. Regla fija para TODO reel (pedido explícito de Rodrigo, 9/9/2026, "quiero que todos los reel acaben com el CTA Mentis"): el texto en pantalla siempre tiene que ABRIR con un gancho o una frase que despierte curiosidad genuina sobre el tema de hoy (algo que frene el scroll en el primer segundo), y siempre tiene que CERRAR invitando a comentar la palabra "MENTIS" — ningún reel, sea de una parte o de dos, queda sin esa invitación en pantalla al final.
- Si dosPartes es false: "captionText" — el texto que aparece en pantalla durante el clip: empezá con el gancho/curiosidad de hoy en una frase corta y directa, y cerrá fundiendo eso con la invitación a comentar "MENTIS" — puede ser una sola frase que haga las dos cosas, o dos frases cortas en secuencia si el gancho lo pide, siempre en español, pensado para leerse cómodo en un clip de 12-15s.
- Si dosPartes es true: "captionTextParte1" (el gancho/curiosidad que abre, mismo criterio de arriba, sin el CTA todavía — eso lo cierra la parte 2) y "captionTextParte2" — como es el cierre del reel, ese texto en pantalla tiene que fundir la resolución CON la invitación a comentar "MENTIS" en una sola frase corta y natural (una sola idea que cierre y empuje a la acción a la vez, no dos frases pegadas).
- "musicStyle" (una sola, se usa en las dos partes si son dos): el tipo de música de fondo que mejor acompaña el tono de hoy — corto, en inglés, como se describiría a una herramienta de generación (ej. "tense minimal piano, slow build" o "upbeat motivational synth, driving rhythm"), coherente con la energía del ángulo de hoy.

El CTA final ("cta", el texto que Rodrigo pega como descripción real del post al publicarlo) tiene que ser una venta real, no un cierre genérico: usando la conexión que generaste en el guion (historia + el ángulo de hoy), invitá explícitamente a comentar la palabra "MENTIS" para recibir una guía gratis — esa palabra fija es la puerta de entrada al embudo completo (guía gratis → oferta premium), siempre la misma, nunca inventes otra distinta por día ni un link que no exista. Esto va siempre, tengas o no dosPartes — aunque con dosPartes el clip mismo ya insinúe la invitación en pantalla (captionTextParte2), el texto completo del CTA sigue yendo acá para pegarse como descripción del post.

Devolvé SOLO un objeto JSON válido, sin texto antes ni después ni bloque de código. Si dosPartes es false, con esta forma exacta:
{"formato": "reel" o "carrusel", "angulo": "<etiqueta corta, 3-8 palabras, del gancho central de hoy>", "dosPartes": false, "escenaVisual": "<en inglés, la escena única de hasta 12s>", "captionText": "<en español, el texto exacto del caption en pantalla>", "musicStyle": "<en inglés, el estilo de música de fondo>", "guion": "<el guion completo, listo para grabar/diseñar>", "cta": "<CTA de venta real, con la palabra clave a comentar>"}
Si dosPartes es true, en cambio, con esta forma exacta:
{"formato": "reel" o "carrusel", "angulo": "<etiqueta corta, 3-8 palabras>", "dosPartes": true, "escenaVisualParte1": "<en inglés>", "escenaVisualParte2": "<en inglés>", "captionTextParte1": "<en español>", "captionTextParte2": "<en español, resolución + invitación a comentar MENTIS>", "musicStyle": "<en inglés>", "guion": "<el guion completo>", "cta": "<CTA de venta real, con la palabra clave a comentar>"}

--- CONOCIMIENTO DE MENTIS ---
${fullKnowledgeSnapshot()}`;

  // 2000 -> 2500 (3/9/2026) -> 3000 (6/9/2026, pedido explícito de Rodrigo:
  // reel de dos partes cuando el ángulo lo amerite): con dosPartes el JSON de
  // salida casi duplica sus campos de video (dos escenas, dos captions en
  // vez de una) — mismo motivo que las subidas anteriores acá y en
  // weekly-guides.js: más margen que lo justo, para no repetir el bug real de
  // truncamiento que ya pasó dos veces en ese archivo.
  return callMentis(prompt, 3000);
}

async function generatePodcastScript(dateStr, history) {
  const recentTemas = history.entries.slice(-HISTORY_LOOKBACK).filter((e) => e.tipo === 'podcast')
    .map((e) => `${e.date}: ${e.tema}`).join('\n') || '(sin historial todavía)';
  const prompt = `Sos Mentis escribiendo el guion del episodio de podcast de hoy (${dateStr}) para Rodrigo — sale cada 3 días, como funnel gratuito.

${VOICE_RULES}

El guion tiene que salir de la propia experiencia acumulada de Mentis, conectando con los frameworks que ya tiene cargados — no un tema suelto sin fundamento. Elegí un tema distinto a los últimos episodios:
${recentTemas}

Devolvé SOLO un objeto JSON válido, sin texto antes ni después ni bloque de código, con esta forma exacta:
{"tema": "<tema del episodio, breve>", "guion": "<guion completo del episodio, listo para que Rodrigo lo grabe>"}

--- CONOCIMIENTO DE MENTIS ---
${fullKnowledgeSnapshot()}`;

  return callMentis(prompt, 3000);
}

async function runDailyScript() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: 'Falta ANTHROPIC_API_KEY en las variables de entorno.' };
  let dropboxToken;
  try {
    dropboxToken = await getDropboxAccessToken();
  } catch (err) {
    return { ok: false, error: err.message };
  }

  await syncFromDropbox(); // conocimiento fresco antes de escribir el guion
  try {
    const buf = await dropboxDownload(dropboxToken, `${CONTENT_FOLDER}/content-history.json`);
    fs.writeFileSync(HISTORY_PATH, buf);
  } catch {
    // primera corrida — no existe todavía en Dropbox, seguimos con historial vacío
  }
  const history = loadHistory();

  const dateStr = todayUTC();
  const wIdx = weekdayIndex(dateStr);
  const generated = [];
  let skippedReel = null;
  let podcastGenerated = false;
  const failures = [];

  if (!fs.existsSync(CONTENT_DIR)) fs.mkdirSync(CONTENT_DIR, { recursive: true });

  // Afinado el 2/9/2026 (auditoría de confiabilidad): antes, reel/carrusel y
  // podcast se generaban uno atrás del otro sin try/catch propio — si el
  // segundo fallaba (por ejemplo el podcast), toda la función tiraba error
  // ANTES de llegar al bloque que sube a Dropbox, así que el primero (el
  // reel, ya generado y ya pagado como llamada a la API) se perdía sin
  // guardarse ni avisar que había salido bien. Ahora cada uno se genera con
  // su propio try/catch: si uno falla, el otro igual se guarda, y la
  // respuesta cuenta cuál falló y por qué en vez de perder todo en silencio.
  if (wIdx !== null || !WEEKDAYS_ONLY) {
    try {
      const reel = await generateReelScript(dateStr, wIdx, history);
      const fname = `${dateStr}-${reel.formato === 'carrusel' ? 'carrusel' : 'reel'}.md`;
      const videoNote = reel.dosPartes ? '\n\n**Video:** 2 partes (parte 1 + parte 2)' : '';
      const body = `# ${dateStr} — ${reel.formato}\n\n**Ángulo:** ${reel.angulo}${videoNote}\n\n---\n\n${reel.guion}\n\n---\n\n**CTA:** ${reel.cta}\n`;
      fs.writeFileSync(path.join(CONTENT_DIR, fname), body);
      history.entries.push({
        date: dateStr, tipo: 'reel', formato: reel.formato, angulo: reel.angulo,
        dosPartes: !!reel.dosPartes,
        escenaVisual: reel.escenaVisual || null,
        escenaVisualParte1: reel.escenaVisualParte1 || null,
        escenaVisualParte2: reel.escenaVisualParte2 || null,
        captionText: reel.captionText || null,
        captionTextParte1: reel.captionTextParte1 || null,
        captionTextParte2: reel.captionTextParte2 || null,
        musicStyle: reel.musicStyle || null,
      });
      generated.push(fname);
    } catch (err) {
      failures.push({ tipo: 'reel', error: err.message });
    }
  } else {
    skippedReel = 'fin de semana — no se genera reel/carrusel (ver WEEKDAYS_ONLY en daily-script.js)';
  }

  if (daysSinceEpoch(dateStr) % PODCAST_EVERY_N_DAYS === 0) {
    try {
      const podcast = await generatePodcastScript(dateStr, history);
      const fname = `${dateStr}-podcast.md`;
      const body = `# ${dateStr} — Podcast\n\n**Tema:** ${podcast.tema}\n\n---\n\n${podcast.guion}\n`;
      fs.writeFileSync(path.join(CONTENT_DIR, fname), body);
      history.entries.push({ date: dateStr, tipo: 'podcast', tema: podcast.tema });
      generated.push(fname);
      podcastGenerated = true;
    } catch (err) {
      failures.push({ tipo: 'podcast', error: err.message });
    }
  }

  if (generated.length > 0) {
    saveHistory(history);
    for (const fname of generated) {
      const buf = fs.readFileSync(path.join(CONTENT_DIR, fname));
      await dropboxUpload(dropboxToken, `${CONTENT_FOLDER}/${fname}`, buf);
    }
    await dropboxUpload(dropboxToken, `${CONTENT_FOLDER}/content-history.json`, fs.readFileSync(HISTORY_PATH));
  }

  // ok:false solo si TODO lo que tocaba generar hoy falló — si al menos uno
  // salió bien, ok:true con "failures" listando lo que no, para no marcar
  // como error una corrida parcialmente exitosa.
  const ok = failures.length === 0 || generated.length > 0;
  return { ok, date: dateStr, generated, skippedReel, podcastGenerated, failures };
}

module.exports = { runDailyScript };

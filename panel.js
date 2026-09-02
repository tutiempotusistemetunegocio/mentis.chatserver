// Módulo 08 → panel personal de Rodrigo — v1, pedida el 2/9/2026 junto con
// el catálogo de guías ("quiero que en mi herramienta personal tengas eso,
// tanto las premium como las free"). Corre DENTRO de mentis-chat-server,
// expuesta como una ruta GET protegida — a diferencia de las rutas
// /internal/*, esta la abre Rodrigo directo desde el navegador, así que el
// secreto viaja como segmento de la URL (mismo patrón que ya se usa para el
// webhook de Higgsfield) en vez de un header: GET /panel/<PANEL_SECRET>.
//
// Honesto sobre el alcance de esta v1: el plano describe un panel completo
// (stats de cada pieza, videos para descargar, historial semanal, y una
// sección "Estrategia" donde Mentis piensa como CEO). De todo eso, hoy
// existen datos reales para dos cosas: el catálogo de guías
// (weekly-guides.js) y el contenido/fotos ya generados
// (daily-script.js/daily-photo.js). Lo demás — sobre todo Estrategia y el
// resumen semanal — necesita módulos que todavía no se construyeron, así
// que esta v1 los deja marcados como "todavía no construido" en vez de
// inventar números o secciones vacías disfrazadas de reales. El estado de
// cada conexión (Higgsfield, Metricool, Systeme.io, ManyChat) se calcula
// mirando si sus variables de entorno están cargadas — confirma que la
// configuración está puesta, no que la API en sí esté respondiendo bien hoy
// (para eso, la fuente real sigue siendo GitHub Actions).
//
// Tres rutas:
//  - GET /panel/<secreto>                → la página completa.
//  - GET /panel/<secreto>/guia/<id>      → el texto de una guía puntual (para
//    no tener que bajar el contenido de todas las guías en cada visita a
//    medida que el catálogo crezca semana a semana).
//  - GET /panel/<secreto>/guia/<id>/pdf  → el PDF con diseño de esa guía
//    (guide-pdf.js), si esta guía en particular llegó a tener uno — las
//    generadas antes de que existiera ese módulo, o cuya subida falló, no lo
//    tienen, y el link no aparece en la tabla para esas.

const { getDropboxAccessToken } = require('./dropbox-auth');

const GUIDES_FOLDER = process.env.DROPBOX_GUIDES_FOLDER || '/mentis-guias';
const CONTENT_FOLDER = process.env.DROPBOX_CONTENT_FOLDER || '/mentis-contenido';
const MEDIA_FOLDER = process.env.DROPBOX_MEDIA_FOLDER || '/mentis-medios';
const FETCH_TIMEOUT_MS = 20000;

async function dropboxDownloadJSON(token, dropboxPath, fallback) {
  try {
    const res = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath }) },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return fallback;
    return JSON.parse(await res.text());
  } catch {
    return fallback;
  }
}

async function dropboxDownloadText(token, dropboxPath) {
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath }) },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} descargando ${dropboxPath}`);
  return res.text();
}

async function dropboxDownloadBinary(token, dropboxPath) {
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath }) },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} descargando ${dropboxPath}`);
  return Buffer.from(await res.arrayBuffer());
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function connectionStatus() {
  const rows = [
    { name: 'Higgsfield (video diario)', on: !!(process.env.HIGGSFIELD_KEY_ID && process.env.HIGGSFIELD_KEY_SECRET), note: 'plan Plus activado y modelo actualizado a Seedance Pro Fast — falta la primera corrida manual que confirme que ya no da 404 antes de prender el cron diario de nuevo' },
    { name: 'Metricool (publicar + métricas)', on: false, note: 'cuenta creada (plan free), a propósito sin conectar hasta que Higgsfield funcione' },
    { name: 'ManyChat (comentario → guía gratis)', on: false, note: 'cuenta creada, todavía sin construir' },
    { name: 'Systeme.io + Stripe (cobro)', on: !!(process.env.SYSTEME_PREMIUM_WEBHOOK_SECRET || process.env.SYSTEME_PANEL_WEBHOOK_SECRET), note: 'en pausa — el plan gratis no alcanza para las reglas que hacen falta' },
  ];
  return rows;
}

async function loadPanelData() {
  const token = await getDropboxAccessToken();
  const [catalog, contentHistory, photoHistory, videoHistory] = await Promise.all([
    dropboxDownloadJSON(token, `${GUIDES_FOLDER}/guide-catalog.json`, { entries: [] }),
    dropboxDownloadJSON(token, `${CONTENT_FOLDER}/content-history.json`, { entries: [] }),
    dropboxDownloadJSON(token, `${MEDIA_FOLDER}/photo-history.json`, { entries: [] }),
    dropboxDownloadJSON(token, `${CONTENT_FOLDER}/video-history.json`, { entries: [] }),
  ]);
  return { token, catalog, contentHistory, photoHistory, videoHistory };
}

function guideRow(g, secret) {
  const cats = (g.categorias || []).join(' + ');
  const fecha = (g.creadaEn || '').slice(0, 10);
  const pdfLink = g.archivoPdf
    ? ` · <a href="/panel/${secret}/guia/${encodeURIComponent(g.id)}/pdf" target="_blank">PDF</a>`
    : ' · <span class="dim">sin PDF</span>';
  return `<tr>
    <td><a href="/panel/${secret}/guia/${encodeURIComponent(g.id)}" target="_blank">${esc(g.titulo)}</a>${pdfLink}</td>
    <td class="dim">${esc(cats)}</td>
    <td class="dim">${esc(fecha)}</td>
    <td class="dim">${g.citas ? `${g.citas} cita(s)` : '—'}</td>
  </tr>`;
}

async function renderPanel(secret) {
  let data;
  try {
    data = await loadPanelData();
  } catch (err) {
    return page('Panel personal', `<p class="error">No se pudo cargar Dropbox: ${esc(err.message)}</p>`);
  }

  const gratis = data.catalog.entries.filter((e) => e.tipo === 'gratis').sort((a, b) => (b.creadaEn || '').localeCompare(a.creadaEn || ''));
  const premium = data.catalog.entries.filter((e) => e.tipo === 'premium').sort((a, b) => (b.creadaEn || '').localeCompare(a.creadaEn || ''));

  const recentContent = [...data.contentHistory.entries].slice(-12).reverse();
  const recentPhotos = [...data.photoHistory.entries].slice(-6).reverse();
  const recentVideoPrompts = [...data.videoHistory.entries].slice(-8).reverse();

  const guidesSection = `
    <section>
      <h2>Guías <span class="count">${gratis.length} gratis · ${premium.length} premium</span></h2>
      <p class="hint">Se arman solas cada semana (weekly-guides.js) — al menos ${process.env.GUIDES_PER_RUN_FREE || 2} gratis y ${process.env.GUIDES_PER_RUN_PREMIUM || 2} premium por corrida. Tocá el título para leer la guía completa.</p>
      <div class="cols">
        <div>
          <h3>Gratis</h3>
          ${gratis.length ? `<table><tbody>${gratis.map((g) => guideRow(g, secret)).join('')}</tbody></table>` : '<p class="dim">Todavía no hay ninguna — corré "weekly-guides" desde GitHub Actions para generar las primeras.</p>'}
        </div>
        <div>
          <h3>Premium</h3>
          ${premium.length ? `<table><tbody>${premium.map((g) => guideRow(g, secret)).join('')}</tbody></table>` : '<p class="dim">Todavía no hay ninguna — corré "weekly-guides" desde GitHub Actions para generar las primeras.</p>'}
        </div>
      </div>
    </section>`;

  const contentSection = `
    <section>
      <h2>Contenido reciente</h2>
      <table><tbody>
        ${recentContent.map((e) => `<tr><td class="dim">${esc(e.date)}</td><td>${esc(e.tipo)}${e.formato && e.formato !== e.tipo ? ` · ${esc(e.formato)}` : ''}</td><td>${esc(e.angulo || e.tema || '')}</td></tr>`).join('') || '<tr><td class="dim">Sin datos todavía.</td></tr>'}
      </tbody></table>
      <h3 class="mt">Fotos elegidas</h3>
      <table><tbody>
        ${recentPhotos.map((e) => `<tr><td class="dim">${esc(e.date)}</td><td>${esc(e.file)}</td><td class="dim">${esc(e.angulo || '')}</td></tr>`).join('') || '<tr><td class="dim">Sin datos todavía.</td></tr>'}
      </tbody></table>
      <h3 class="mt">Prompt de video del día <span class="count">lo que se le pide a Higgsfield, no solo el resultado</span></h3>
      ${recentVideoPrompts.length ? recentVideoPrompts.map((e) => `
        <div class="promptcard">
          <div class="promptmeta"><span class="dim">${esc(e.date)}</span> · ${esc(e.duration || '')}s · <span class="dim">${esc(e.status || '')}</span></div>
          <div class="promptangulo">${esc(e.angulo || '')}</div>
          <pre class="promptbox">${esc(e.prompt || '')}</pre>
        </div>`).join('') : '<p class="dim">Sin datos todavía — se guarda a partir del primer pedido de video después de este cambio.</p>'}
    </section>`;

  const statusSection = `
    <section>
      <h2>Estado de las conexiones</h2>
      <table><tbody>
        ${connectionStatus().map((r) => `<tr><td>${esc(r.name)}</td><td class="${r.on ? 'ok' : 'pend'}">${r.on ? 'configurado' : 'no configurado'}</td><td class="dim">${esc(r.note)}</td></tr>`).join('')}
      </tbody></table>
    </section>`;

  const pendingSection = `
    <section>
      <h2>Todavía no construido</h2>
      <p class="dim">Estrategia (Mentis pensando como CEO) y el resumen semanal por WhatsApp/panel — necesitan sus propios módulos, que no existen todavía. Cuando se construyan, suman su sección acá, no reemplazan nada de lo de arriba.</p>
    </section>`;

  return page('Panel personal', guidesSection + contentSection + statusSection + pendingSection);
}

async function renderGuideContent(secret, id) {
  const token = await getDropboxAccessToken();
  const catalog = await dropboxDownloadJSON(token, `${GUIDES_FOLDER}/guide-catalog.json`, { entries: [] });
  const entry = catalog.entries.find((e) => e.id === id);
  if (!entry) return null;
  const text = await dropboxDownloadText(token, `${GUIDES_FOLDER}/${entry.tipo}/${entry.archivo}`);
  return text;
}

// Guías generadas antes de que existiera guide-pdf.js (o cuya subida de PDF
// falló en su momento) no tienen `archivoPdf` en el catálogo — acá se
// devuelve null en vez de tirar error, para que la ruta responda 404 en vez
// de un 500 confuso.
async function renderGuidePdf(secret, id) {
  const token = await getDropboxAccessToken();
  const catalog = await dropboxDownloadJSON(token, `${GUIDES_FOLDER}/guide-catalog.json`, { entries: [] });
  const entry = catalog.entries.find((e) => e.id === id);
  if (!entry || !entry.archivoPdf) return null;
  return dropboxDownloadBinary(token, `${GUIDES_FOLDER}/${entry.tipo}/${entry.archivoPdf}`);
}

function page(title, body) {
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Mentis</title>
<style>
  :root{ --bg:#081412; --card:#0e211d; --ink:#eaf4f0; --dim:#a7bdb5; --border:#1b332c; --accent:#3ee0a4; --amber:#f2ab3d; }
  *{ box-sizing:border-box; }
  body{ margin:0; background:var(--bg); color:var(--ink); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; padding:32px 24px 80px; }
  .wrap{ max-width:1100px; margin:0 auto; }
  h1{ font-size:26px; margin:0 0 4px; }
  .kicker{ font-family:ui-monospace,monospace; font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--accent); margin:0 0 8px; }
  section{ margin-top:34px; padding-top:26px; border-top:1px solid var(--border); }
  h2{ font-size:18px; margin:0 0 6px; display:flex; align-items:center; gap:10px; }
  h3{ font-size:14px; color:var(--dim); margin:18px 0 8px; text-transform:uppercase; letter-spacing:.04em; }
  .mt{ margin-top:26px; }
  .count{ font-family:ui-monospace,monospace; font-size:12px; color:var(--dim); font-weight:400; }
  .hint{ color:var(--dim); font-size:13px; margin:0 0 16px; }
  .cols{ display:grid; grid-template-columns:1fr 1fr; gap:28px; }
  @media (max-width:720px){ .cols{ grid-template-columns:1fr; } }
  table{ width:100%; border-collapse:collapse; font-size:13.5px; }
  td{ padding:8px 10px; border-bottom:1px solid var(--border); vertical-align:top; }
  tr:hover td{ background:#0f2a24; }
  a{ color:var(--ink); text-decoration:none; border-bottom:1px dotted var(--accent); }
  a:hover{ color:var(--accent); }
  .dim{ color:var(--dim); }
  .ok{ color:var(--accent); font-family:ui-monospace,monospace; font-size:12px; }
  .pend{ color:var(--amber); font-family:ui-monospace,monospace; font-size:12px; }
  .error{ color:var(--amber); }
  pre{ white-space:pre-wrap; line-height:1.6; font-family:inherit; font-size:15px; background:var(--card); border:1px solid var(--border); border-radius:10px; padding:24px; }
  .promptcard{ margin-top:12px; padding:14px 16px; background:var(--card); border:1px solid var(--border); border-radius:10px; }
  .promptmeta{ font-family:ui-monospace,monospace; font-size:11.5px; margin-bottom:4px; }
  .promptangulo{ font-size:13.5px; margin-bottom:8px; }
  .promptbox{ margin:0; padding:10px 12px; font-size:12.5px; background:var(--bg); border:1px solid var(--border); border-radius:6px; white-space:pre-wrap; }
</style>
</head><body><div class="wrap">
  <p class="kicker">MentisOS · panel personal</p>
  <h1>${esc(title)}</h1>
  ${body}
</div></body></html>`;
}

module.exports = { renderPanel, renderGuideContent, renderGuidePdf };

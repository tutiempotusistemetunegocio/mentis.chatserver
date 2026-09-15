// Directivas opcionales del chat premium — gráficos y PDF "según lo que pida
// el usuario" (pedido explícito de Rodrigo, 15/9/2026: "quiero que el chat
// premium pueda devolver gráficos, infografías, pdf"). Mentis decide SOLO,
// dentro de su propia respuesta, si hace falta uno de los dos (o ninguno) —
// no hay un menú fijo ni un comando especial que el cliente tenga que
// escribir. La instrucción de cómo pedirlo vive en server.js (se agrega al
// system prompt de callClaude); este archivo solo se encarga de:
//   1. sacar la(s) directiva(s) del texto que ve el cliente (nunca debe ver
//      JSON crudo mezclado con la respuesta),
//   2. convertir un ```mentis-chart en SVG embebido directo en la respuesta
//      (liviano, no hace falta guardarlo en ningún lado), y
//   3. convertir un ```mentis-pdf en un PDF real (mismo look que las guías,
//      vía doc-pdf.js) guardado un rato en memoria bajo un id al azar, listo
//      para descargarse desde /chat/render/<id>.pdf.
//
// Por qué en memoria y no en disco: Render free tier reinicia el proceso
// seguido (cold start, redeploys) y no hay nada acá que sea crítico perder —
// es un PDF armado al vuelo para una pregunta puntual, no una guía del
// catálogo. Con TTL corto y un tope de cuántos quedan guardados a la vez para
// no arriesgar la memoria del free tier (512MB) si alguien pide varios PDF
// seguidos y nunca los baja.

const crypto = require('crypto');
// require('./doc-pdf') queda diferido (adentro de processChatReply, no acá
// arriba) a propósito: así un gráfico (```mentis-chart) sigue funcionando
// entero aunque algo falle cargando pdfkit — no tiene sentido que un problema
// del lado del PDF tumbe también la parte de gráficos, que no depende de eso.

const PDF_RENDER_TTL_MS = 30 * 60 * 1000; // 30 minutos alcanza de sobra para bajarlo
const PDF_RENDER_MAX_ENTRIES = 30; // tope duro — protege memoria del free tier

const pdfStore = new Map(); // id -> { buffer, expiresAt }

function cleanupExpired() {
  const now = Date.now();
  for (const [id, entry] of pdfStore) {
    if (entry.expiresAt <= now) pdfStore.delete(id);
  }
}

function storePdf(buffer) {
  cleanupExpired();
  // Si igual quedó lleno (poco probable con el TTL de 30min, pero por las
  // dudas), se descarta el más viejo antes de sumar uno nuevo — nunca crece
  // sin límite.
  if (pdfStore.size >= PDF_RENDER_MAX_ENTRIES) {
    const oldestId = pdfStore.keys().next().value;
    if (oldestId) pdfStore.delete(oldestId);
  }
  const id = crypto.randomBytes(16).toString('hex');
  pdfStore.set(id, { buffer, expiresAt: Date.now() + PDF_RENDER_TTL_MS });
  return id;
}

function getPdf(id) {
  cleanupExpired();
  const entry = pdfStore.get(id);
  return entry ? entry.buffer : null;
}

// Saca del texto un bloque ```mentis-chart o ```mentis-pdf con fence de
// markdown estándar, y devuelve tanto el JSON parseado (o null si no vino,
// vino roto, o el JSON no pudo parsearse) como el texto ya limpio, sin el
// bloque ni el fence.
function extractFencedBlock(text, tag) {
  const re = new RegExp('```' + tag + '\\s*([\\s\\S]*?)```', 'i');
  const match = text.match(re);
  if (!match) return { spec: null, text };
  const cleanText = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim();
  let spec = null;
  try {
    spec = JSON.parse(match[1].trim());
  } catch {
    spec = null; // JSON roto — se ignora la directiva entera, nunca rompe el chat
  }
  return { spec, text: cleanText };
}

const CHART_COLORS = ['#5fd4c4', '#f2a65a', '#8fabc4', '#e8917a', '#a3e4d7'];
const CHART_INK = '#eaf2fa';
const CHART_INK_DIM = '#8fabc4';
const CHART_GRID = '#22405f';

function escapeXml(str) {
  return String(str).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}

function renderBarChart(spec) {
  const W = 640; const H = 360;
  const padL = 56; const padR = 24; const padT = 48; const padB = 56;
  const plotW = W - padL - padR; const plotH = H - padT - padB;
  const categorias = spec.categorias || [];
  const series = (spec.series || []).filter((s) => Array.isArray(s.valores));
  if (categorias.length === 0 || series.length === 0) return null;
  const allValues = series.flatMap((s) => s.valores.map((v) => Number(v) || 0));
  const maxVal = Math.max(1, ...allValues);
  const groupW = plotW / categorias.length;
  const barGap = 6;
  const barW = Math.max(4, (groupW - barGap * (series.length + 1)) / series.length);

  let bars = '';
  categorias.forEach((cat, ci) => {
    series.forEach((s, si) => {
      const val = Number(s.valores[ci]) || 0;
      const barH = (val / maxVal) * plotH;
      const x = padL + ci * groupW + barGap + si * (barW + barGap);
      const y = padT + plotH - barH;
      const color = CHART_COLORS[si % CHART_COLORS.length];
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="${color}" rx="2"/>`;
    });
    const labelX = padL + ci * groupW + groupW / 2;
    bars += `<text x="${labelX.toFixed(1)}" y="${H - padB + 20}" fill="${CHART_INK_DIM}" font-size="11" text-anchor="middle" font-family="Helvetica, Arial, sans-serif">${escapeXml(cat)}</text>`;
  });

  let grid = '';
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const y = padT + (plotH / steps) * i;
    const val = Math.round(maxVal - (maxVal / steps) * i);
    grid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="${CHART_GRID}" stroke-width="1"/>`;
    grid += `<text x="${padL - 8}" y="${(y + 3).toFixed(1)}" fill="${CHART_INK_DIM}" font-size="10" text-anchor="end" font-family="Helvetica, Arial, sans-serif">${val}</text>`;
  }

  let legend = '';
  if (series.length > 1) {
    series.forEach((s, si) => {
      const lx = padL + si * 120;
      legend += `<rect x="${lx}" y="${H - 18}" width="10" height="10" fill="${CHART_COLORS[si % CHART_COLORS.length]}" rx="2"/>`;
      legend += `<text x="${lx + 15}" y="${H - 9}" fill="${CHART_INK_DIM}" font-size="10" font-family="Helvetica, Arial, sans-serif">${escapeXml(s.nombre || '')}</text>`;
    });
  }

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(spec.titulo || 'Gráfico de barras')}">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#0a1f38" rx="10"/>
    <text x="${padL}" y="28" fill="${CHART_INK}" font-size="15" font-weight="bold" font-family="Helvetica, Arial, sans-serif">${escapeXml(spec.titulo || '')}</text>
    ${grid}
    ${bars}
    ${legend}
  </svg>`;
}

function renderLineChart(spec) {
  const W = 640; const H = 360;
  const padL = 56; const padR = 24; const padT = 48; const padB = 40;
  const plotW = W - padL - padR; const plotH = H - padT - padB;
  const categorias = spec.categorias || [];
  const series = (spec.series || []).filter((s) => Array.isArray(s.valores));
  if (categorias.length === 0 || series.length === 0) return null;
  const allValues = series.flatMap((s) => s.valores.map((v) => Number(v) || 0));
  const maxVal = Math.max(1, ...allValues);
  const minVal = Math.min(0, ...allValues);
  const range = maxVal - minVal || 1;
  const stepX = categorias.length > 1 ? plotW / (categorias.length - 1) : 0;

  let grid = '';
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const y = padT + (plotH / steps) * i;
    const val = Math.round(maxVal - (range / steps) * i);
    grid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="${CHART_GRID}" stroke-width="1"/>`;
    grid += `<text x="${padL - 8}" y="${(y + 3).toFixed(1)}" fill="${CHART_INK_DIM}" font-size="10" text-anchor="end" font-family="Helvetica, Arial, sans-serif">${val}</text>`;
  }

  let labels = '';
  categorias.forEach((cat, ci) => {
    const x = padL + ci * stepX;
    labels += `<text x="${x.toFixed(1)}" y="${H - padB + 20}" fill="${CHART_INK_DIM}" font-size="11" text-anchor="middle" font-family="Helvetica, Arial, sans-serif">${escapeXml(cat)}</text>`;
  });

  let lines = '';
  let legend = '';
  series.forEach((s, si) => {
    const color = CHART_COLORS[si % CHART_COLORS.length];
    const points = s.valores.map((v, ci) => {
      const val = Number(v) || 0;
      const x = padL + ci * stepX;
      const y = padT + plotH - ((val - minVal) / range) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    lines += `<polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5"/>`;
    points.forEach((p) => { lines += `<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="3.5" fill="${color}"/>`; });
    if (series.length > 1) {
      const lx = padL + si * 120;
      legend += `<rect x="${lx}" y="${H - 18}" width="10" height="10" fill="${color}" rx="2"/>`;
      legend += `<text x="${lx + 15}" y="${H - 9}" fill="${CHART_INK_DIM}" font-size="10" font-family="Helvetica, Arial, sans-serif">${escapeXml(s.nombre || '')}</text>`;
    }
  });

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(spec.titulo || 'Gráfico de líneas')}">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#0a1f38" rx="10"/>
    <text x="${padL}" y="28" fill="${CHART_INK}" font-size="15" font-weight="bold" font-family="Helvetica, Arial, sans-serif">${escapeXml(spec.titulo || '')}</text>
    ${grid}
    ${lines}
    ${labels}
    ${legend}
  </svg>`;
}

function renderPieChart(spec) {
  const W = 640; const H = 360;
  const cx = 220; const cy = 190; const r = 130;
  const categorias = spec.categorias || [];
  const serie = (spec.series || [])[0];
  if (categorias.length === 0 || !serie || !Array.isArray(serie.valores)) return null;
  const values = serie.valores.map((v) => Math.max(0, Number(v) || 0));
  const total = values.reduce((a, b) => a + b, 0) || 1;

  let angleStart = -Math.PI / 2;
  let slices = '';
  let legend = '';
  categorias.forEach((cat, i) => {
    const frac = values[i] / total;
    const angleEnd = angleStart + frac * Math.PI * 2;
    const x1 = cx + r * Math.cos(angleStart); const y1 = cy + r * Math.sin(angleStart);
    const x2 = cx + r * Math.cos(angleEnd); const y2 = cy + r * Math.sin(angleEnd);
    const largeArc = angleEnd - angleStart > Math.PI ? 1 : 0;
    const color = CHART_COLORS[i % CHART_COLORS.length];
    if (frac > 0) {
      slices += `<path d="M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${largeArc} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${color}" stroke="#0a1f38" stroke-width="2"/>`;
    }
    const pct = Math.round(frac * 100);
    const ly = 60 + i * 26;
    legend += `<rect x="480" y="${ly - 10}" width="10" height="10" fill="${color}" rx="2"/>`;
    legend += `<text x="495" y="${ly - 1}" fill="${CHART_INK_DIM}" font-size="11" font-family="Helvetica, Arial, sans-serif">${escapeXml(cat)} (${pct}%)</text>`;
    angleStart = angleEnd;
  });

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(spec.titulo || 'Gráfico de torta')}">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#0a1f38" rx="10"/>
    <text x="24" y="28" fill="${CHART_INK}" font-size="15" font-weight="bold" font-family="Helvetica, Arial, sans-serif">${escapeXml(spec.titulo || '')}</text>
    ${slices}
    ${legend}
  </svg>`;
}

// Devuelve un string SVG completo, o null si la directiva vino mal formada
// (nunca tira excepción — un gráfico roto no debe romper el chat entero).
function renderChartSVG(spec) {
  if (!spec || typeof spec !== 'object') return null;
  try {
    const tipo = String(spec.tipo || '').toLowerCase();
    if (tipo === 'barras') return renderBarChart(spec);
    if (tipo === 'lineas' || tipo === 'líneas') return renderLineChart(spec);
    if (tipo === 'torta') return renderPieChart(spec);
    return null;
  } catch {
    return null;
  }
}

// Procesa la respuesta cruda de Claude: saca las directivas (si vinieron),
// arma el gráfico/PDF que corresponda, y devuelve todo listo para que la
// ruta /chat (o la del panel) arme la respuesta JSON final. `baseUrl` se usa
// solo para armar el link de descarga del PDF (ej. "https://host").
async function processChatReply(replyText, baseUrl) {
  let text = replyText;
  let visual = null;
  let pdfUrl = null;

  const chartResult = extractFencedBlock(text, 'mentis-chart');
  text = chartResult.text;
  if (chartResult.spec) visual = renderChartSVG(chartResult.spec);

  const pdfResultRaw = extractFencedBlock(text, 'mentis-pdf');
  text = pdfResultRaw.text;
  if (pdfResultRaw.spec && pdfResultRaw.spec.bloques) {
    try {
      // eslint-disable-next-line global-require
      const { renderDocPDF } = require('./doc-pdf');
      const buffer = await renderDocPDF({
        kicker: 'MENTIS',
        badge: 'CHAT',
        titulo: pdfResultRaw.spec.titulo || 'Documento',
        subtitulo: pdfResultRaw.spec.subtitulo || '',
        meta: new Date().toLocaleDateString('es-AR', { year: 'numeric', month: 'long', day: 'numeric' }),
        bloques: pdfResultRaw.spec.bloques,
      });
      const id = storePdf(buffer);
      pdfUrl = `${baseUrl}/chat/render/${id}.pdf`;
    } catch (err) {
      console.error('Error armando el PDF pedido en el chat:', err.message);
      // No se cae el chat entero por esto — el cliente igual recibe el texto.
    }
  }

  return { text: text.trim(), visual, pdfUrl };
}

module.exports = { processChatReply, getPdf };

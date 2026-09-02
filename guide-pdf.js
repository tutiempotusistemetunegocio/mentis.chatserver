// Módulo 02 → PDF de cada guía, con la identidad visual del sistema (la
// misma que ya usan la página personal y el chat premium: fondo azul marino
// oscuro, acentos en teal y ámbar — ver plano-del-cerebro.html, sección
// "Identidad visual"). Pedido de Rodrigo (2/9/2026): que cada guía tenga una
// estructura y un diseño definidos, no texto suelto.
//
// Decisión técnica, explicada para que quede claro por qué: se usa
// `pdfkit` (JS puro, arma el PDF programáticamente) en vez de un navegador
// headless (Puppeteer/Playwright) para convertir HTML a PDF. Un navegador
// headless da más libertad de diseño, pero consume mucha más memoria — y el
// servidor de Render (free tier, 512MB) ya se quedó sin memoria una vez esta
// semana con una tarea más liviana que esta (ver daily-media.md). pdfkit no
// levanta ningún navegador, así que el costo de memoria de armar un PDF acá
// es chico y predecible, aunque el control de diseño sea más manual.
//
// Tipografía: se usan las fuentes que trae pdfkit por default (familia
// Helvetica) en vez de embeber IBM Plex Sans (la fuente real de la
// identidad visual) — así no depende de que un archivo de fuente externo
// llegue bien al deploy. Es un ajuste pendiente si Rodrigo quiere que
// coincida exactamente con la tipografía de la página personal; hoy prioriza
// que funcione siempre por sobre que coincida al pixel.
//
// renderGuidePDF(guide) devuelve una Promise<Buffer> con el PDF completo.
// Si algo falla acá, quien llama (weekly-guides.js) lo atrapa y sigue
// adelante igual con el archivo .md — un PDF que no se pudo armar nunca
// tiene que tirar abajo la guía en sí.

const PDFDocument = require('pdfkit');

const COLOR_BG = '#0a1f38';
const COLOR_BG_DEEP = '#081a30';
const COLOR_INK = '#eaf2fa';
const COLOR_INK_DIM = '#8fabc4';
const COLOR_TEAL = '#5fd4c4';
const COLOR_AMBER = '#f2a65a';

const MARGIN = { top: 76, bottom: 64, left: 60, right: 60 };

function drawPageBackground(doc) {
  doc.save();
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLOR_BG);
  doc.restore();
}

function drawFooter(doc, pageLabel) {
  doc.save();
  doc.font('Helvetica').fontSize(8.5).fillColor(COLOR_INK_DIM);
  doc.text('MENTIS', MARGIN.left, doc.page.height - 40, { width: 200, align: 'left', lineBreak: false });
  doc.text(pageLabel, 0, doc.page.height - 40, { width: doc.page.width - MARGIN.right, align: 'right', lineBreak: false });
  doc.restore();
}

function drawCover(doc, guide) {
  drawPageBackground(doc);

  // franja inferior más oscura, puramente decorativa, para dar profundidad
  doc.save();
  doc.rect(0, doc.page.height - 160, doc.page.width, 160).fill(COLOR_BG_DEEP);
  doc.restore();

  doc.font('Helvetica-Bold').fontSize(13).fillColor(COLOR_TEAL);
  doc.text('MENTIS', MARGIN.left, 64, { characterSpacing: 2 });

  const badgeText = guide.tipo === 'premium' ? 'GUÍA PREMIUM' : 'GUÍA GRATIS';
  const badgeColor = guide.tipo === 'premium' ? COLOR_AMBER : COLOR_TEAL;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(badgeColor);
  doc.text(badgeText, 0, 66, { width: doc.page.width - MARGIN.right, align: 'right', characterSpacing: 1 });

  doc.font('Helvetica-Bold').fontSize(30).fillColor(COLOR_INK);
  doc.text(guide.titulo, MARGIN.left, 220, { width: doc.page.width - MARGIN.left - MARGIN.right, align: 'left' });

  if (guide.subtitulo) {
    doc.moveDown(0.6);
    doc.font('Helvetica').fontSize(13).fillColor(COLOR_INK_DIM);
    doc.text(guide.subtitulo, MARGIN.left, doc.y, { width: doc.page.width - MARGIN.left - MARGIN.right });
  }

  const cats = (guide.categorias || []).map((c) => c.replace('.md', '').replace(/-/g, ' ')).join('  ·  ');
  doc.font('Helvetica').fontSize(9.5).fillColor(COLOR_INK_DIM);
  doc.text(cats.toUpperCase(), MARGIN.left, doc.page.height - 100, { width: doc.page.width - MARGIN.left - MARGIN.right, characterSpacing: 0.5 });
}

function renderBloque(doc, bloque) {
  const contentWidth = doc.page.width - MARGIN.left - MARGIN.right;
  if (bloque.tipo === 'titulo') {
    doc.moveDown(0.9);
    doc.font('Helvetica-Bold').fontSize(15).fillColor(COLOR_TEAL);
    doc.text(bloque.texto, { width: contentWidth });
    doc.moveDown(0.3);
    return;
  }
  if (bloque.tipo === 'lista') {
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(11).fillColor(COLOR_INK);
    (bloque.items || []).forEach((item) => {
      doc.text('•  ' + item, { width: contentWidth, lineGap: 3 });
      doc.moveDown(0.15);
    });
    doc.moveDown(0.3);
    return;
  }
  if (bloque.tipo === 'cita') {
    doc.moveDown(0.4);
    doc.font('Helvetica-Oblique').fontSize(11).fillColor(COLOR_AMBER);
    doc.text('"' + bloque.texto + '"', { width: contentWidth, lineGap: 3 });
    if (bloque.autor) {
      doc.font('Helvetica').fontSize(9.5).fillColor(COLOR_INK_DIM);
      doc.text('— ' + bloque.autor + (bloque.obra ? ', ' + bloque.obra : ''), { width: contentWidth });
    }
    doc.moveDown(0.4);
    return;
  }
  // 'parrafo' y cualquier tipo desconocido caen acá — nunca se pierde texto
  // por un tipo de bloque que no se reconoce.
  doc.font('Helvetica').fontSize(11).fillColor(COLOR_INK);
  doc.text(bloque.texto || '', { width: contentWidth, align: 'left', lineGap: 3 });
  doc.moveDown(0.5);
}

// BUG REAL encontrado en la primera corrida en vivo (2/9/2026) — el caveat
// que se le avisó a Rodrigo se cumplió, esto no se había podido ejecutar en
// el entorno de trabajo donde se escribió, solo revisar sintaxis. Las 3
// guías generadas ese día fallaron TODAS al armar el PDF con "Maximum call
// stack size exceeded". Causa: dibujar texto (`doc.text()`, en drawFooter)
// dentro del evento `pageAdded` mientras pdfkit todavía está paginando
// automáticamente por desborde de texto (dentro del forEach de bloques) lo
// hace reentrar en su propia lógica de layout — es un problema conocido de
// pdfkit, no un detalle menor. La corrección: el evento `pageAdded` ahora
// SOLO pinta el fondo (un rectángulo relleno, `doc.rect().fill()` — nunca
// texto, eso no dispara paginación). El pie de página con texto se agrega
// después, en un segundo paso sobre las páginas ya generadas
// (`bufferPages` + `switchToPage`), cuando ya no hay ninguna paginación
// automática en curso.
async function renderGuidePDF(guide) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margins: MARGIN, bufferPages: true, autoFirstPage: false });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Portada — maquetación libre, sin los márgenes de las páginas de contenido.
      doc.addPage({ size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } });
      drawCover(doc, guide);

      // A partir de acá, cada página nueva (esta primera manual, y las que
      // vengan solas por desborde de texto) pinta su propio fondo — nunca
      // texto en este evento, ver el comentario de arriba.
      doc.on('pageAdded', () => drawPageBackground(doc));

      doc.addPage({ size: 'A4', margins: MARGIN });
      drawPageBackground(doc);

      (guide.bloques || []).forEach((bloque) => renderBloque(doc, bloque));

      // Pie de página — recién ahora, en un paso aparte sobre las páginas de
      // contenido ya generadas (todas menos la portada, índice 0), con todo
      // el texto de la guía ya escrito y sin ninguna paginación en curso.
      const range = doc.bufferedPageRange();
      for (let i = range.start + 1; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        drawFooter(doc, String(i));
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { renderGuidePDF };

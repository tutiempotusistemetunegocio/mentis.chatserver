// Renderizador de PDF genérico — misma identidad visual y los mismos dos
// bugs reales de pdfkit ya resueltos que guide-pdf.js (ver los comentarios
// grandes en ese archivo para el detalle exacto de cada uno: el color de
// texto que desaparecía en los saltos de página automáticos, y las páginas
// en blanco de más por el pie de página). Se separa de guide-pdf.js a
// propósito, en vez de generalizar ese archivo — guide-pdf.js ya funciona en
// producción con guías reales y no hace falta tocarlo para sumar dos usos
// nuevos (15/9/2026): el PDF que arma el chat premium cuando alguien pide un
// documento/reporte, y el PDF de un reel/post del panel personal. Los tres
// (guías, chat, reels) comparten el mismo look pero no el mismo módulo,
// misma filosofía que el resto del sistema: no arriesgar código que ya
// funciona para ahorrarse duplicar un par de funciones.
//
// renderDocPDF({ kicker, badge, badgeColor, titulo, subtitulo, meta, bloques })
// devuelve Promise<Buffer>. `bloques` usa la misma forma que ya entienden las
// guías: [{tipo:'titulo'|'parrafo'|'lista'|'cita', texto|items, autor?, obra?}].

const PDFDocument = require('pdfkit');

const COLOR_BG = '#0a1f38';
const COLOR_BG_DEEP = '#081a30';
const COLOR_INK = '#eaf2fa';
const COLOR_INK_DIM = '#8fabc4';
const COLOR_TEAL = '#5fd4c4';
const COLOR_AMBER = '#f2a65a';

const MARGIN = { top: 76, bottom: 64, left: 60, right: 60 };

// Mismo bug y misma corrección que guide-pdf.js — ver el comentario largo
// ahí para el porqué exacto (doc._fillColor no lo cubre save()/restore()).
function drawPageBackground(doc) {
  const previousFillColor = doc._fillColor;
  doc.save();
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLOR_BG);
  doc.restore();
  doc._fillColor = previousFillColor;
}

// Mismo bug y misma corrección que guide-pdf.js — el pie de página va a
// propósito fuera del margen inferior normal, así que hay que engañar a
// pdfkit para que no agregue una página en blanco antes de dibujarlo.
function drawFooter(doc, pageLabel) {
  const originalBottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.save();
  doc.font('Helvetica').fontSize(8.5).fillColor(COLOR_INK_DIM);
  doc.text('MENTIS', MARGIN.left, doc.page.height - 40, { width: 200, align: 'left', lineBreak: false });
  doc.text(pageLabel, 0, doc.page.height - 40, { width: doc.page.width - MARGIN.right, align: 'right', lineBreak: false });
  doc.restore();
  doc.page.margins.bottom = originalBottomMargin;
}

function drawCover(doc, spec) {
  drawPageBackground(doc);

  doc.save();
  doc.rect(0, doc.page.height - 160, doc.page.width, 160).fill(COLOR_BG_DEEP);
  doc.restore();

  doc.font('Helvetica-Bold').fontSize(13).fillColor(COLOR_TEAL);
  doc.text(spec.kicker || 'MENTIS', MARGIN.left, 64, { characterSpacing: 2 });

  if (spec.badge) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(spec.badgeColor || COLOR_AMBER);
    doc.text(spec.badge, 0, 66, { width: doc.page.width - MARGIN.right, align: 'right', characterSpacing: 1 });
  }

  doc.font('Helvetica-Bold').fontSize(28).fillColor(COLOR_INK);
  doc.text(spec.titulo || 'Documento', MARGIN.left, 220, { width: doc.page.width - MARGIN.left - MARGIN.right, align: 'left' });

  if (spec.subtitulo) {
    doc.moveDown(0.6);
    doc.font('Helvetica').fontSize(13).fillColor(COLOR_INK_DIM);
    doc.text(spec.subtitulo, MARGIN.left, doc.y, { width: doc.page.width - MARGIN.left - MARGIN.right });
  }

  if (spec.meta) {
    doc.font('Helvetica').fontSize(9.5).fillColor(COLOR_INK_DIM);
    doc.text(String(spec.meta).toUpperCase(), MARGIN.left, doc.page.height - 100, { width: doc.page.width - MARGIN.left - MARGIN.right, characterSpacing: 0.5 });
  }
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
  doc.font('Helvetica').fontSize(11).fillColor(COLOR_INK);
  doc.text(bloque.texto || '', { width: contentWidth, align: 'left', lineGap: 3 });
  doc.moveDown(0.5);
}

async function renderDocPDF(spec) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margins: MARGIN, bufferPages: true, autoFirstPage: false });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.addPage({ size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } });
      drawCover(doc, spec);

      doc.on('pageAdded', () => drawPageBackground(doc));

      doc.addPage({ size: 'A4', margins: MARGIN });
      drawPageBackground(doc);

      (spec.bloques || []).forEach((bloque) => renderBloque(doc, bloque));

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

module.exports = { renderDocPDF };

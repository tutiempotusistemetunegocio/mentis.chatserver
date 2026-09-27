// Módulo 02 → PDF de cada guía, con la identidad visual del sistema.
//
// REDISEÑO COMPLETO (27/9/2026) — pedido explícito de Rodrigo: subió un PDF
// de referencia ("Cómo automatizar tu negocio sin perder el control",
// hecho aparte con Python/ReportLab + tipografía Poppins embebida) y pidió
// "reactualiza las guías todas, mantiene el padrón, los colores, la parte
// gráfica, la formatación de los párrafos". Este archivo reconstruye ESE
// patrón visual — páginas de contenido en blanco (antes eran azul marino
// entero), barra superior azul marino con la marca, tarjetas redondeadas en
// crema/menta/gris muy claro, acentos en teal y naranja, tipografía Poppins
// real — pero sigue armando el PDF con `pdfkit` (JS puro), nunca con un
// navegador headless: la razón de memoria que ya explicaba esto (Render
// free tier, 512MB, se quedó sin memoria una vez con algo más liviano que
// esto — ver daily-media.md) sigue siendo válida, y pdfkit soporta
// embeber una fuente TTF real sin levantar ningún navegador, así que se
// pudo sumar la tipografía real (carpeta fonts/, ~800KB en total, costo de
// memoria trivial) sin tener que resignar la arquitectura liviana.
//
// Los colores de acá se sacaron muestreando el PDF de referencia en
// pixeles reales (no "a ojo"), para que coincidan de verdad:
//   navy #0b1f3a · teal #2ec5b6 · naranja #f2a35f · crema #fdf1e5 ·
//   menta #e3f7f5 · tarjeta gris #f3f7fa
//
// renderGuidePDF(guide) devuelve una Promise<Buffer> con el PDF completo.
// Si algo falla acá, quien llama (weekly-guides.js / guia-cero.js) lo
// atrapa y sigue adelante igual con el archivo .md — un PDF que no se pudo
// armar nunca tiene que tirar abajo la guía en sí. Ese contrato NO cambió.

const path = require('path');
const PDFDocument = require('pdfkit');

// ---------------------------------------------------------------------------
// Paleta — ver el comentario grande de arriba sobre de dónde salió cada hex.
// ---------------------------------------------------------------------------
const COLOR_NAVY = '#0b1f3a'; // fondo de portada, barra superior, tarjetas oscuras (cita, cierre)
const COLOR_TEAL = '#2ec5b6';
const COLOR_ORANGE = '#f2a35f';
const COLOR_CREAM = '#fdf1e5'; // caja clara para "esto NO / el problema"
const COLOR_MINT = '#e3f7f5'; // caja clara para "esto SÍ / la solución"
const COLOR_CARD = '#f3f7fa'; // tarjeta neutra clara (listas numeradas, tabla)
const COLOR_WHITE = '#ffffff';
const COLOR_INK = '#152238'; // texto de títulos sobre fondo blanco
const COLOR_INK_SOFT = '#38465a'; // texto de párrafo sobre fondo blanco
const COLOR_INK_DIM = '#7c8aa0'; // texto secundario sobre fondo blanco (pie de página)
const COLOR_ON_NAVY = '#eef4fa'; // texto principal sobre fondo navy
const COLOR_ON_NAVY_DIM = '#93aec8'; // texto secundario sobre fondo navy

// Márgenes: MARGIN.top deja lugar debajo de la barra superior azul marino
// (HEADER_H) más un respiro; MARGIN.bottom deja lugar para el pie de
// página. Nunca un número pegado a A4 a mano en el resto del archivo — todo
// sale de estas dos constantes.
const HEADER_H = 60;
const MARGIN = {
  top: HEADER_H + 40, bottom: 70, left: 50, right: 50,
};

// ---------------------------------------------------------------------------
// Tipografía — Poppins real, embebida desde fonts/*.ttf (bajada de
// google/fonts, licencia OFL). Si por lo que sea los archivos no están en
// el deploy (ej. alguien los borró sin querer), esto NUNCA tira abajo el
// PDF entero: se cae a Helvetica y sigue. `F` es el mapa de nombres de
// fuente que usa TODO el resto del archivo — nunca un 'Helvetica-Bold' o
// 'Poppins-Bold' sueltos más abajo, siempre a través de F, así el
// fallback funciona en un solo lugar.
const FONT_DIR = path.join(__dirname, 'fonts');
function registerFonts(doc) {
  try {
    doc.registerFont('Poppins', path.join(FONT_DIR, 'Poppins-Regular.ttf'));
    doc.registerFont('Poppins-Light', path.join(FONT_DIR, 'Poppins-Light.ttf'));
    doc.registerFont('Poppins-Medium', path.join(FONT_DIR, 'Poppins-Medium.ttf'));
    doc.registerFont('Poppins-SemiBold', path.join(FONT_DIR, 'Poppins-SemiBold.ttf'));
    doc.registerFont('Poppins-Bold', path.join(FONT_DIR, 'Poppins-Bold.ttf'));
    return {
      reg: 'Poppins', light: 'Poppins-Light', med: 'Poppins-Medium', semi: 'Poppins-SemiBold', bold: 'Poppins-Bold',
    };
  } catch (err) {
    console.error('No se pudieron cargar las fuentes Poppins (carpeta fonts/) — se arma el PDF con Helvetica:', err.message);
    return {
      reg: 'Helvetica', light: 'Helvetica', med: 'Helvetica', semi: 'Helvetica-Bold', bold: 'Helvetica-Bold',
    };
  }
}

// ---------------------------------------------------------------------------
// Texto enriquecido: **negrita** dentro de cualquier bloque de texto.
// La guía de referencia de Rodrigo resalta frases clave adentro de un
// párrafo corrido ("que si tu negocio depende **100% de ti**") — esto no
// existía antes (todo bloque de texto era un solo estilo parejo). Se
// implementa con la API "continued" de pdfkit: se corta el texto en tramos
// por el delimitador **, y cada tramo se dibuja con su propia
// fuente/color, todos encadenados en la misma tirada para que el ajuste de
// línea (word-wrap) los trate como un solo párrafo.
//
// Importante (mismo motivo que el comentario grande sobre el cursor de
// pdfkit, más abajo): SOLO el primer tramo lleva x/y/width explícitos —
// los siguientes continúan exactamente donde quedó el anterior, a
// propósito, nunca repiten posición.
function drawRichText(doc, text, opts) {
  const {
    x, y, width, font, boldFont, size, color, boldColor, lineGap = 4, align = 'left',
  } = opts;
  const parts = String(text == null ? '' : text).split(/(\*\*[^*]+\*\*)/g).filter((p) => p !== '');
  if (parts.length === 0) return;
  parts.forEach((part, i) => {
    const isBold = part.startsWith('**') && part.endsWith('**');
    const runText = isBold ? part.slice(2, -2) : part;
    doc.font(isBold ? boldFont : font).fontSize(size).fillColor(isBold ? (boldColor || color) : color);
    const isLast = i === parts.length - 1;
    if (i === 0) {
      doc.text(runText, x, y, { width, lineGap, align, continued: !isLast });
    } else {
      doc.text(runText, { continued: !isLast });
    }
  });
}

// Altura aproximada de un texto enriquecido, para los chequeos de "¿entra
// en lo que queda de la página?" que ya usa todo el resto del archivo. No
// hay forma barata de medir un párrafo multi-estilo exacto en pdfkit, así
// que se mide el texto plano (sin los **) con el tamaño pedido — negrita y
// regular de Poppins al mismo tamaño ocupan prácticamente lo mismo, así que
// alcanza de sobra para decidir si hace falta saltar de página.
function richTextHeight(doc, text, font, size, width, lineGap = 4) {
  const plain = String(text == null ? '' : text).replace(/\*\*/g, '');
  doc.font(font).fontSize(size);
  return doc.heightOfString(plain, { width, lineGap });
}

// ---------------------------------------------------------------------------
// BUG REAL confirmado con guías reales (6/9/2026, sigue aplicando igual con
// el rediseño): `doc.fill(color)` guarda el color en `doc._fillColor`, una
// propiedad de JS separada del estado gráfico real de PDF que manejan
// `doc.save()`/`doc.restore()` — esos dos nunca tocan `_fillColor`. Cuando
// pdfkit agrega una página sola (desborde de texto), su propia lógica de
// salto "restaura" el color de relleno DESPUÉS de que el evento
// 'pageAdded' ya corrió — si acá adentro se pintó el fondo sin devolver
// `_fillColor` a mano, el texto que sigue queda escrito invisible (mismo
// color que el fondo). Por eso este handler SIEMPRE guarda y devuelve
// `_fillColor` a mano.
//
// Ahora, además del rectángulo de fondo, pinta la barra superior azul
// marino (HEADER_H) — sigue siendo SOLO formas, nunca texto acá (ver el
// comentario grande de más abajo sobre por qué el texto del header/pie de
// página se dibuja en un segundo paso, después de que termina toda la
// paginación automática).
function drawPageBackground(doc) {
  const previousFillColor = doc._fillColor;
  doc.save();
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLOR_WHITE);
  doc.rect(0, 0, doc.page.width, HEADER_H).fill(COLOR_NAVY);
  doc.restore();
  doc._fillColor = previousFillColor;
}

// Texto de la barra superior (marca "MENTIS" + "CHAT") — se dibuja en el
// mismo paso seguro que el pie de página (después de toda la paginación
// automática, nunca dentro de 'pageAdded'), salvo en la portada, donde se
// dibuja directo porque ahí no hay ningún evento de paginación en curso.
function drawHeaderText(doc, F) {
  doc.save();
  doc.font(F.bold).fontSize(12).fillColor(COLOR_TEAL);
  doc.text('MENTIS', MARGIN.left, HEADER_H / 2 - 7, { characterSpacing: 2, lineBreak: false });
  doc.font(F.semi).fontSize(10).fillColor(COLOR_ORANGE);
  doc.text('CHAT', 0, HEADER_H / 2 - 5, {
    width: doc.page.width - MARGIN.right, align: 'right', characterSpacing: 1, lineBreak: false,
  });
  doc.restore();
}

// BUG REAL encontrado con guías reales (3/9/2026, sigue aplicando): el pie
// de página se dibuja a propósito DENTRO del margen inferior — pdfkit, si
// el margen inferior real sigue puesto, asume que no entra y agrega una
// página en blanco de más antes de dibujarlo. Se achica el margen inferior
// a 0 solo mientras se dibuja, y se restaura enseguida.
function drawFooter(doc, F, pageLabel, footerTitle) {
  const originalBottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.save();
  doc.strokeColor(COLOR_INK_DIM).opacity(0.35).lineWidth(1);
  doc.moveTo(MARGIN.left, doc.page.height - 56).lineTo(doc.page.width - MARGIN.right, doc.page.height - 56).stroke();
  doc.opacity(1);
  doc.font(F.reg).fontSize(8.5).fillColor(COLOR_INK_DIM);
  doc.text(footerTitle || 'MENTIS', MARGIN.left, doc.page.height - 40, {
    width: doc.page.width - MARGIN.left - MARGIN.right - 60, align: 'left', lineBreak: false, ellipsis: true,
  });
  doc.text(pageLabel, 0, doc.page.height - 40, { width: doc.page.width - MARGIN.right, align: 'right', lineBreak: false });
  doc.restore();
  doc.page.margins.bottom = originalBottomMargin;
}

// ---------------------------------------------------------------------------
// Portada — maquetación libre sobre fondo navy entero, como en la guía de
// referencia: círculos decorativos arriba a la derecha, chip con el tipo de
// guía, título grande con las últimas palabras resaltadas en teal, filete
// naranja, subtítulo, categorías + fecha al pie.
function drawCover(doc, guide, F) {
  const previousFillColor = doc._fillColor;
  doc.save();
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLOR_NAVY);
  doc.restore();
  doc._fillColor = previousFillColor;

  // Círculos decorativos — puramente de ambientación, mismo lenguaje visual
  // que la referencia (dos círculos teal semitransparentes, arriba a la
  // derecha, que se salen del borde de la hoja sin problema).
  doc.save();
  doc.fillColor(COLOR_TEAL).fillOpacity(0.10).circle(doc.page.width - 60, 40, 230).fill();
  doc.fillOpacity(0.16).circle(doc.page.width + 10, 160, 160).fill();
  doc.fillOpacity(1);
  doc.restore();

  drawHeaderText(doc, F);

  const badgeText = guide.tipo === 'premium' ? 'GUÍA PREMIUM' : guide.tipo === 'sistema' ? 'GUÍA DEL SISTEMA' : 'GUÍA GRATIS';
  const badgeColor = guide.tipo === 'premium' ? COLOR_ORANGE : COLOR_TEAL;
  doc.font(F.semi).fontSize(9);
  const badgePaddingX = 16;
  const badgeWidth = doc.widthOfString(badgeText, { characterSpacing: 0.5 }) + badgePaddingX * 2;
  const badgeY = 210;
  doc.save();
  doc.fillColor(badgeColor).roundedRect(MARGIN.left, badgeY, badgeWidth, 30, 15).fill();
  doc.restore();
  doc.fillColor(COLOR_NAVY);
  doc.text(badgeText, MARGIN.left, badgeY + 10, { width: badgeWidth, align: 'center', characterSpacing: 0.5, lineBreak: false });

  // Título — últimas palabras resaltadas en teal (mismo efecto que
  // "sin perder el control" en la referencia). Heurística simple: con 5+
  // palabras resalta las últimas 3, con 3-4 resalta las últimas 2, con
  // menos de 3 no resalta nada (un título muy corto entero en teal se ve
  // raro, no aporta jerarquía).
  const titleY = badgeY + 58;
  const titleWidth = doc.page.width - MARGIN.left - MARGIN.right;
  const words = String(guide.titulo || '').trim().split(/\s+/).filter(Boolean);
  let splitAt = words.length;
  if (words.length >= 5) splitAt = words.length - 3;
  else if (words.length >= 3) splitAt = words.length - 2;
  const plainPart = words.slice(0, splitAt).join(' ');
  const accentPart = words.slice(splitAt).join(' ');
  doc.font(F.bold).fontSize(32);
  if (accentPart) {
    doc.fillColor(COLOR_WHITE).text(`${plainPart} `, MARGIN.left, titleY, { width: titleWidth, continued: true });
    doc.fillColor(COLOR_TEAL).text(accentPart, { continued: false });
  } else {
    doc.fillColor(COLOR_WHITE).text(guide.titulo || '', MARGIN.left, titleY, { width: titleWidth });
  }

  // Filete naranja debajo del título.
  const ruleY = doc.y + 14;
  doc.save();
  doc.fillColor(COLOR_ORANGE).rect(MARGIN.left, ruleY, 64, 5).fill();
  doc.restore();

  if (guide.subtitulo) {
    doc.font(F.reg).fontSize(14).fillColor(COLOR_ON_NAVY_DIM);
    doc.text(guide.subtitulo, MARGIN.left, ruleY + 22, { width: titleWidth, lineGap: 3 });
  }

  const cats = (guide.categorias || []).map((c) => c.replace('.md', '').replace(/-/g, ' ')).join('   ·   ');
  const fecha = new Date().toLocaleDateString('es-AR', {
    day: 'numeric', month: 'long', year: 'numeric',
  }).toUpperCase();
  doc.font(F.med).fontSize(9.5).fillColor(COLOR_ON_NAVY_DIM);
  doc.text(fecha, MARGIN.left, doc.page.height - 90, { characterSpacing: 0.6, lineBreak: false });
  if (cats) {
    doc.text(cats, MARGIN.left, doc.page.height - 90, {
      width: doc.page.width - MARGIN.left - MARGIN.right, align: 'right', characterSpacing: 0.4, lineBreak: false,
    });
  }
}

// ---------------------------------------------------------------------------
// Tarjeta genérica redondeada con una franja de acento a la izquierda —
// usada por 'destacado', 'cita' y 'alerta', que comparten la misma
// mecánica (medir alto → chequear espacio → dibujar caja → dibujar texto
// adentro) y solo cambian de color/contenido. Centralizarla evita
// triplicar el mismo bug-fix de espacio en tres bloques distintos.
function drawAccentCard(doc, { bgColor, accentColor, boxHeight, padding = 16 }) {
  const contentWidth = doc.page.width - MARGIN.left - MARGIN.right;
  if (doc.y + boxHeight > doc.page.height - MARGIN.bottom) {
    doc.addPage();
  }
  const boxY = doc.y;
  doc.save();
  doc.fillColor(bgColor).roundedRect(MARGIN.left, boxY, contentWidth, boxHeight, 10).fill();
  doc.restore();
  doc.save();
  doc.fillColor(accentColor).rect(MARGIN.left, boxY, 4, boxHeight).fill();
  doc.restore();
  return boxY;
}

// ---------------------------------------------------------------------------
// renderBloque — dibuja un bloque de contenido dentro del cuerpo de una
// página (fondo blanco). TODO texto acá pasa x explícita en su primera
// línea (MARGIN.left u otra a propósito) — nunca depende del cursor que
// dejó el bloque anterior (bug real documentado en versiones previas de
// este archivo: un bloque que dibuja en columnas corridas desalineaba al
// siguiente si este dependía del cursor implícito).
function renderBloque(doc, bloque, F) {
  const contentWidth = doc.page.width - MARGIN.left - MARGIN.right;

  if (bloque.tipo === 'titulo') {
    doc.moveDown(1.0);
    doc.font(F.bold).fontSize(21);
    const headingHeight = doc.heightOfString(bloque.texto, { width: contentWidth });
    if (doc.y + headingHeight + 24 > doc.page.height - MARGIN.bottom) {
      doc.addPage();
    }
    doc.fillColor(COLOR_INK);
    doc.text(bloque.texto, MARGIN.left, doc.y, { width: contentWidth });
    const ruleY = doc.y + 6;
    doc.save();
    doc.fillColor(COLOR_ORANGE).rect(MARGIN.left, ruleY, 46, 4).fill();
    doc.restore();
    doc.y = ruleY + 14;
    doc.x = MARGIN.left;
    return;
  }

  if (bloque.tipo === 'parrafo') {
    doc.moveDown(0.3);
    const h = richTextHeight(doc, bloque.texto, F.reg, 12.5, contentWidth, 5);
    if (doc.y + h > doc.page.height - MARGIN.bottom) doc.addPage();
    drawRichText(doc, bloque.texto, {
      x: MARGIN.left, y: doc.y, width: contentWidth, font: F.reg, boldFont: F.semi, size: 12.5, color: COLOR_INK_SOFT, boldColor: COLOR_INK, lineGap: 5,
    });
    doc.moveDown(0.55);
    doc.x = MARGIN.left;
    return;
  }

  if (bloque.tipo === 'lista') {
    doc.moveDown(0.35);
    const bulletX = MARGIN.left + 6;
    const textX = MARGIN.left + 20;
    const textWidth = contentWidth - 20;
    (bloque.items || []).forEach((item) => {
      const h = richTextHeight(doc, item, F.reg, 12, textWidth, 4);
      if (doc.y + h + 6 > doc.page.height - MARGIN.bottom) doc.addPage();
      doc.save();
      doc.fillColor(COLOR_TEAL).circle(bulletX, doc.y + 7, 2.6).fill();
      doc.restore();
      drawRichText(doc, item, {
        x: textX, y: doc.y, width: textWidth, font: F.reg, boldFont: F.semi, size: 12, color: COLOR_INK_SOFT, boldColor: COLOR_INK, lineGap: 4,
      });
      doc.moveDown(0.3);
      doc.x = MARGIN.left;
    });
    doc.moveDown(0.25);
    doc.x = MARGIN.left;
    return;
  }

  // 'cita' — ahora es una tarjeta oscura (navy) con franja naranja a la
  // izquierda y una gran comilla, igual que la referencia. `texto` puede
  // traer un salto de línea doble (\n\n) para separar la frase principal
  // (grande, en negrita) de una segunda línea explicativa más chica —
  // mismo truco que 'destacado' más abajo. Si no lo trae, se ve igual de
  // bien con una sola línea + la atribución de autor/obra, como antes.
  if (bloque.tipo === 'cita') {
    doc.moveDown(0.5);
    const padding = 22;
    const boxWidth = contentWidth;
    const innerWidth = boxWidth - padding * 2 - 8;
    const paragraphs = String(bloque.texto || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const lead = paragraphs[0] || '';
    const rest = paragraphs.slice(1);

    let h = padding + 30; // lugar para la comilla decorativa
    h += richTextHeight(doc, lead, F.bold, 16, innerWidth, 4);
    rest.forEach((p) => { h += 8 + richTextHeight(doc, p, F.reg, 11.5, innerWidth, 3); });
    if (bloque.autor) h += 20;
    h += padding;

    const boxY = drawAccentCard(doc, {
      bgColor: COLOR_NAVY, accentColor: COLOR_ORANGE, boxHeight: h, padding,
    });
    doc.font(F.bold).fontSize(30).fillColor(COLOR_ORANGE);
    doc.text('“', MARGIN.left + padding - 4, boxY + 8, { lineBreak: false });

    let cy = boxY + padding + 24;
    drawRichText(doc, lead, {
      x: MARGIN.left + padding + 8, y: cy, width: innerWidth, font: F.bold, boldFont: F.bold, size: 16, color: COLOR_ON_NAVY, boldColor: COLOR_TEAL, lineGap: 4,
    });
    cy = doc.y + 8;
    rest.forEach((p) => {
      drawRichText(doc, p, {
        x: MARGIN.left + padding + 8, y: cy, width: innerWidth, font: F.reg, boldFont: F.semi, size: 11.5, color: COLOR_ON_NAVY_DIM, boldColor: COLOR_ON_NAVY, lineGap: 3,
      });
      cy = doc.y + 8;
    });
    if (bloque.autor) {
      doc.font(F.med).fontSize(10.5).fillColor(COLOR_ON_NAVY_DIM);
      doc.text(`— ${bloque.autor}${bloque.obra ? `, ${bloque.obra}` : ''}`, MARGIN.left + padding + 8, cy, { width: innerWidth });
    }
    doc.y = boxY + h + 12;
    doc.x = MARGIN.left;
    return;
  }

  // 'pasos' — antes era una línea de tiempo vertical; ahora son tarjetas
  // numeradas apiladas (tarjeta clara + círculo numerado, alternando
  // teal/naranja), igual que "¿Qué se puede automatizar?" en la
  // referencia. Convención nueva, sin romper nada viejo: si el texto de un
  // paso arranca con **Título corto**, ese tramo se dibuja como mini-título
  // en negrita y el resto como descripción más suave debajo — si no trae
  // esa marca, el paso completo se dibuja como una sola línea de texto
  // (se sigue viendo bien, solo sin la jerarquía título/descripción).
  if (bloque.tipo === 'pasos') {
    doc.moveDown(0.4);
    const items = (bloque.items || []).filter(Boolean);
    const circleR = 20;
    const padding = 18;
    const textX = MARGIN.left + padding * 2 + circleR * 2;
    const textWidth = contentWidth - (padding * 2 + circleR * 2) - padding;

    items.forEach((raw, i) => {
      const m = /^\*\*([^*]+)\*\*:?\s*(.*)$/s.exec(raw);
      const titulo = m ? m[1].trim() : null;
      const cuerpo = m ? m[2].trim() : raw;

      let h = padding * 2;
      if (titulo) {
        doc.font(F.bold).fontSize(14.5);
        h += doc.heightOfString(titulo, { width: textWidth }) + 6;
      }
      if (cuerpo) h += richTextHeight(doc, cuerpo, F.reg, 11.5, textWidth, 3);
      h = Math.max(h, circleR * 2 + padding);

      if (doc.y + h > doc.page.height - MARGIN.bottom) doc.addPage();
      const boxY = doc.y;
      doc.save();
      doc.fillColor(COLOR_CARD).roundedRect(MARGIN.left, boxY, contentWidth, h, 10).fill();
      doc.restore();

      const badgeColor = i % 2 === 0 ? COLOR_TEAL : COLOR_ORANGE;
      const circleCY = boxY + padding + circleR;
      doc.save();
      doc.fillColor(badgeColor).circle(MARGIN.left + padding + circleR, circleCY, circleR).fill();
      doc.restore();
      doc.font(F.bold).fontSize(15).fillColor(COLOR_WHITE);
      doc.text(String(i + 1), MARGIN.left + padding, circleCY - 8, { width: circleR * 2, align: 'center', lineBreak: false });

      let ty = boxY + padding;
      if (titulo) {
        doc.font(F.bold).fontSize(14.5).fillColor(COLOR_INK);
        doc.text(titulo, textX, ty, { width: textWidth });
        ty = doc.y + 4;
      }
      if (cuerpo) {
        drawRichText(doc, cuerpo, {
          x: textX, y: ty, width: textWidth, font: F.reg, boldFont: F.semi, size: 11.5, color: COLOR_INK_SOFT, boldColor: COLOR_INK, lineGap: 3,
        });
      }
      doc.y = boxY + h + 14;
      doc.x = MARGIN.left;
    });
    doc.moveDown(0.2);
    doc.x = MARGIN.left;
    return;
  }

  // 'destacado' — caja crema con franja naranja (antes era un tinte teal
  // sobre fondo navy; ahora el fondo de página es blanco, así que se
  // invierte al tratamiento "callout claro" de la referencia, ej. "¿Qué NO
  // se puede automatizar?"). Mismo truco de \n\n que 'cita' para admitir
  // más de un párrafo corto adentro de la misma caja.
  if (bloque.tipo === 'destacado') {
    doc.moveDown(0.5);
    const padding = 18;
    const innerWidth = contentWidth - padding * 2 - 8;
    const paragraphs = String(bloque.texto || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    let h = padding * 2;
    paragraphs.forEach((p, i) => {
      h += richTextHeight(doc, p, F.semi, 13, innerWidth, 4);
      if (i < paragraphs.length - 1) h += 8;
    });
    const boxY = drawAccentCard(doc, {
      bgColor: COLOR_CREAM, accentColor: COLOR_ORANGE, boxHeight: h, padding,
    });
    let cy = boxY + padding;
    paragraphs.forEach((p) => {
      drawRichText(doc, p, {
        x: MARGIN.left + padding + 8, y: cy, width: innerWidth, font: F.semi, boldFont: F.bold, size: 13, color: COLOR_INK, boldColor: COLOR_INK, lineGap: 4,
      });
      cy = doc.y + 8;
    });
    doc.y = boxY + h + 10;
    doc.moveDown(0.3);
    doc.x = MARGIN.left;
    return;
  }

  // 'alerta' — bloque NUEVO (27/9/2026): caja sólida naranja con un "!"
  // grande, para un aviso fuerte de una sola idea (ej. "El error más
  // común" en la referencia). Mismo esquema de bloques de siempre —
  // {"tipo":"alerta","texto":"..."} — así que weekly-guides.js/guia-cero.js
  // solo necesitan sumar una línea al prompt para que Mentis lo use; si un
  // deploy viejo todavía no lo pide, simplemente no aparece, nada se rompe.
  if (bloque.tipo === 'alerta') {
    doc.moveDown(0.5);
    const padding = 20;
    const iconWidth = 40;
    const innerWidth = contentWidth - padding * 2 - iconWidth;
    const h = Math.max(richTextHeight(doc, bloque.texto, F.bold, 14, innerWidth, 4) + padding * 2, 70);
    if (doc.y + h > doc.page.height - MARGIN.bottom) doc.addPage();
    const boxY = doc.y;
    doc.save();
    doc.fillColor(COLOR_ORANGE).roundedRect(MARGIN.left, boxY, contentWidth, h, 10).fill();
    doc.restore();
    doc.font(F.bold).fontSize(30).fillColor(COLOR_WHITE);
    doc.text('!', MARGIN.left + padding, boxY + h / 2 - 18, { width: iconWidth, align: 'center', lineBreak: false });
    drawRichText(doc, bloque.texto, {
      x: MARGIN.left + padding + iconWidth,
      y: boxY + padding,
      width: innerWidth,
      font: F.semi,
      boldFont: F.bold,
      size: 14,
      color: COLOR_WHITE,
      boldColor: COLOR_NAVY,
      lineGap: 4,
    });
    doc.y = boxY + h + 12;
    doc.moveDown(0.3);
    doc.x = MARGIN.left;
    return;
  }

  // 'tabla' — {"headers":[...], "filas":[[...],...]}. Encabezado navy con
  // texto blanco, filas alternando blanco/tarjeta-clara — mismo esquema de
  // medir todo antes de dibujar (para que la fila no se corte a la mitad)
  // que ya tenía la versión anterior de este archivo.
  if (bloque.tipo === 'tabla') {
    doc.moveDown(0.4);
    const headers = bloque.headers || [];
    const filas = bloque.filas || [];
    const cols = headers.length || (filas[0] ? filas[0].length : 0);
    if (cols === 0) return;
    const colWidth = contentWidth / cols;
    const cellPad = 9;

    function cellHeight(text, fontName, fontSize) {
      doc.font(fontName).fontSize(fontSize);
      return doc.heightOfString(String(text == null ? '' : text), { width: colWidth - cellPad * 2, lineGap: 2 }) + cellPad * 2;
    }
    const headerHeight = Math.max(...headers.map((h) => cellHeight(h, F.semi, 11)), 28);
    const rowHeights = filas.map((fila) => Math.max(...fila.map((c) => cellHeight(c, F.reg, 11)), 24));

    if (doc.y + headerHeight + (rowHeights[0] || 0) > doc.page.height - MARGIN.bottom) {
      doc.addPage();
    }

    let y = doc.y;
    doc.save();
    doc.fillColor(COLOR_NAVY).rect(MARGIN.left, y, contentWidth, headerHeight).fill();
    doc.restore();
    doc.font(F.semi).fontSize(11).fillColor(COLOR_WHITE);
    headers.forEach((h, i) => {
      doc.text(String(h), MARGIN.left + i * colWidth + cellPad, y + cellPad, { width: colWidth - cellPad * 2, lineGap: 2 });
    });
    y += headerHeight;

    filas.forEach((fila, rIdx) => {
      const rh = rowHeights[rIdx];
      if (y + rh > doc.page.height - MARGIN.bottom) {
        doc.addPage();
        y = doc.y;
      }
      if (rIdx % 2 === 1) {
        doc.save();
        doc.fillColor(COLOR_CARD).rect(MARGIN.left, y, contentWidth, rh).fill();
        doc.restore();
      }
      doc.font(F.reg).fontSize(11).fillColor(COLOR_INK_SOFT);
      fila.forEach((c, i) => {
        doc.text(String(c == null ? '' : c), MARGIN.left + i * colWidth + cellPad, y + cellPad, { width: colWidth - cellPad * 2, lineGap: 2 });
      });
      y += rh;
    });
    doc.y = y + 12;
    doc.moveDown(0.3);
    doc.x = MARGIN.left;
    return;
  }

  // 'grafico' — barras horizontales, alternando teal/naranja por fila
  // (mismo lenguaje de color que los círculos numerados de 'pasos').
  if (bloque.tipo === 'grafico') {
    doc.moveDown(0.4);
    const categorias = bloque.categorias || [];
    const valores = (bloque.valores || []).map(Number);
    if (!categorias.length || !valores.length) return;
    const maxVal = Math.max(...valores, 1);
    const labelWidth = contentWidth * 0.32;
    const barAreaX = MARGIN.left + labelWidth;
    const barAreaWidth = contentWidth - labelWidth - 46;
    const barHeight = 16;
    const rowGap = 16;

    let tituloHeight = 0;
    if (bloque.titulo) {
      doc.font(F.semi).fontSize(12);
      tituloHeight = doc.heightOfString(bloque.titulo, { width: contentWidth }) + 5;
    }
    const chartHeight = tituloHeight + categorias.length * (barHeight + rowGap);
    const blankPageHeight = doc.page.height - MARGIN.top - MARGIN.bottom;
    if (doc.y + chartHeight > doc.page.height - MARGIN.bottom && chartHeight <= blankPageHeight) {
      doc.addPage();
    }

    if (bloque.titulo) {
      doc.font(F.semi).fontSize(12).fillColor(COLOR_INK);
      doc.text(bloque.titulo, MARGIN.left, doc.y, { width: contentWidth });
      doc.moveDown(0.35);
    }

    categorias.forEach((cat, i) => {
      if (doc.y + barHeight + rowGap > doc.page.height - MARGIN.bottom) {
        doc.addPage();
      }
      const val = valores[i] || 0;
      const y2 = doc.y;
      doc.font(F.reg).fontSize(10.5).fillColor(COLOR_INK_DIM);
      doc.text(String(cat), MARGIN.left, y2 + 3, {
        width: labelWidth - 8, lineGap: 2, lineBreak: false, ellipsis: true,
      });
      doc.save();
      doc.fillColor(COLOR_CARD).rect(barAreaX, y2, barAreaWidth, barHeight).fill();
      doc.restore();
      const w = Math.max(4, (val / maxVal) * barAreaWidth);
      doc.save();
      doc.fillColor(i % 2 === 0 ? COLOR_TEAL : COLOR_ORANGE).rect(barAreaX, y2, w, barHeight).fill();
      doc.restore();
      doc.font(F.semi).fontSize(10).fillColor(COLOR_INK);
      doc.text(`${val}${bloque.unidad || ''}`, barAreaX + barAreaWidth + 6, y2 + 3, { width: 40, lineBreak: false });
      doc.y = y2 + barHeight + rowGap;
    });
    doc.moveDown(0.3);
    doc.x = MARGIN.left;
    return;
  }

  // 'comparacion' — dos columnas lado a lado: izquierda crema (el
  // "antes"/problema), derecha menta (el "después"/solución) — mismo
  // contraste cream/mint de la referencia ("si la respuesta es NO" /
  // "si la respuesta es SÍ"), con una franja de acento arriba de cada
  // columna en vez del tinte de fondo que tenía la versión anterior.
  if (bloque.tipo === 'comparacion') {
    doc.moveDown(0.4);
    const colGap = 16;
    const colWidth = (contentWidth - colGap) / 2;
    const izq = bloque.izquierda || {};
    const der = bloque.derecha || {};

    function colHeight(col) {
      doc.font(F.bold).fontSize(13);
      let h = doc.heightOfString(col.titulo || '', { width: colWidth - 28 }) + 20;
      (col.items || []).forEach((item) => {
        h += richTextHeight(doc, item, F.reg, 11, colWidth - 40, 3) + 8;
      });
      return h + 20;
    }
    const boxHeight = Math.max(colHeight(izq), colHeight(der));

    if (doc.y + Math.min(boxHeight, 90) > doc.page.height - MARGIN.bottom) {
      doc.addPage();
    }
    const boxY = doc.y;

    function drawCol(col, x, bg, accent) {
      doc.save();
      doc.fillColor(bg).roundedRect(x, boxY, colWidth, boxHeight, 10).fill();
      doc.restore();
      doc.save();
      doc.fillColor(accent).roundedRect(x, boxY, colWidth, 6, 3).fill();
      doc.restore();
      doc.font(F.bold).fontSize(13).fillColor(COLOR_INK);
      doc.text(col.titulo || '', x + 14, boxY + 22, { width: colWidth - 28 });
      let cy = doc.y + 10;
      (col.items || []).forEach((item) => {
        doc.save();
        doc.fillColor(accent).circle(x + 18, cy + 6, 2.4).fill();
        doc.restore();
        drawRichText(doc, item, {
          x: x + 28, y: cy, width: colWidth - 40, font: F.reg, boldFont: F.semi, size: 11, color: COLOR_INK_SOFT, boldColor: COLOR_INK, lineGap: 3,
        });
        cy = doc.y + 8;
        doc.x = MARGIN.left;
      });
    }
    drawCol(izq, MARGIN.left, COLOR_CREAM, COLOR_ORANGE);
    drawCol(der, MARGIN.left + colWidth + colGap, COLOR_MINT, COLOR_TEAL);
    doc.y = boxY + boxHeight + 14;
    doc.moveDown(0.3);
    doc.x = MARGIN.left;
    return;
  }

  // Tipo desconocido (o ausente) — nunca se pierde texto por un tipo que no
  // se reconoce, se dibuja como párrafo normal.
  doc.font(F.reg).fontSize(12.5).fillColor(COLOR_INK_SOFT);
  doc.text(bloque.texto || '', MARGIN.left, doc.y, { width: contentWidth, align: 'left', lineGap: 5 });
  doc.moveDown(0.55);
  doc.x = MARGIN.left;
}

// Cierre de venta final — la referencia (última página, "¿Quieres que te
// ayude a armarlo? Hablemos.") lo dibuja como una tarjeta navy propia, no
// como texto corrido. En vez de sumar un tipo de bloque nuevo (que
// obligaría a tocar el prompt Y el ida-y-vuelta a markdown de
// weekly-guides.js/guia-cero.js para no perderlo al regenerar), esto
// detecta el patrón que YA es obligatorio en ambos prompts — "los últimos
// dos bloques tienen que ser un 'titulo' y un 'parrafo'" — y lo dibuja con
// este tratamiento especial en vez del título+párrafo normal de fondo
// blanco. Si algún día ese patrón cambia, esto simplemente deja de
// activarse y el cierre se ve como cualquier título+párrafo normal — nunca
// se rompe ni se pierde contenido.
function isClosingPair(bloques, i) {
  return bloques[i] && bloques[i].tipo === 'titulo'
    && bloques[i + 1] && bloques[i + 1].tipo === 'parrafo'
    && i + 2 === bloques.length;
}

function renderClosingCard(doc, titulo, parrafo, F) {
  const contentWidth = doc.page.width - MARGIN.left - MARGIN.right;
  doc.moveDown(1.0);
  const padding = 24;
  const innerWidth = contentWidth - padding * 2;
  let h = padding * 2;
  doc.font(F.bold).fontSize(19);
  h += doc.heightOfString(titulo, { width: innerWidth }) + 12;
  h += richTextHeight(doc, parrafo, F.reg, 12.5, innerWidth, 4);

  if (doc.y + h > doc.page.height - MARGIN.bottom) doc.addPage();
  const boxY = doc.y;
  doc.save();
  doc.fillColor(COLOR_NAVY).roundedRect(MARGIN.left, boxY, contentWidth, h, 12).fill();
  doc.restore();

  doc.font(F.bold).fontSize(19).fillColor(COLOR_WHITE);
  doc.text(titulo, MARGIN.left + padding, boxY + padding, { width: innerWidth });
  const py = doc.y + 12;
  drawRichText(doc, parrafo, {
    x: MARGIN.left + padding, y: py, width: innerWidth, font: F.reg, boldFont: F.bold, size: 12.5, color: COLOR_ON_NAVY_DIM, boldColor: COLOR_TEAL, lineGap: 4,
  });
  doc.y = boxY + h + 12;
  doc.x = MARGIN.left;
}

// ---------------------------------------------------------------------------
// 'Índice visual' — página aparte después de la portada, listando los
// títulos de sección como una línea de tiempo numerada. Mismo criterio que
// antes (solo si hay 3+ secciones), recoloreado para fondo blanco.
function drawVisualIndex(doc, titulos, F) {
  const contentWidth = doc.page.width - MARGIN.left - MARGIN.right;
  doc.font(F.bold).fontSize(20).fillColor(COLOR_INK);
  doc.text('En esta guía', MARGIN.left, doc.y, { width: contentWidth });
  const ruleY = doc.y + 6;
  doc.save();
  doc.fillColor(COLOR_ORANGE).rect(MARGIN.left, ruleY, 46, 4).fill();
  doc.restore();
  doc.y = ruleY + 24;

  const circleR = 13;
  const circleX = MARGIN.left + circleR;
  const gap = 16;
  const textX = circleX + circleR + gap;
  const textWidth = contentWidth - (circleR * 2 + gap);
  let prevBottom = null;

  titulos.forEach((t, i) => {
    if (doc.y + circleR * 2 + 24 > doc.page.height - MARGIN.bottom) {
      doc.addPage();
      prevBottom = null;
    }
    const stepTop = doc.y;
    const centerY = stepTop + circleR;
    if (prevBottom !== null) {
      doc.save();
      doc.strokeColor(COLOR_TEAL).opacity(0.35).lineWidth(1.4);
      doc.moveTo(circleX, prevBottom).lineTo(circleX, centerY - circleR).stroke();
      doc.restore();
    }
    doc.save();
    doc.fillColor(i % 2 === 0 ? COLOR_TEAL : COLOR_ORANGE).circle(circleX, centerY, circleR).fill();
    doc.restore();
    doc.save();
    doc.font(F.bold).fontSize(12).fillColor(COLOR_WHITE);
    doc.text(String(i + 1), circleX - circleR, centerY - 6, { width: circleR * 2, align: 'center', lineBreak: false });
    doc.restore();
    doc.font(F.semi).fontSize(13).fillColor(COLOR_INK);
    doc.text(t, textX, stepTop + 2, { width: textWidth, lineGap: 4 });
    const stepBottom = Math.max(doc.y, centerY + circleR);
    prevBottom = centerY + circleR;
    doc.y = stepBottom + 20;
  });
}

// BUG REAL encontrado en la primera corrida en vivo (2/9/2026, sigue
// aplicando): dibujar texto dentro del evento 'pageAdded' mientras pdfkit
// todavía está paginando por desborde reentra en su propia lógica de
// layout ("Maximum call stack size exceeded"). Por eso 'pageAdded' PINTA
// SOLO FORMAS (fondo blanco + barra navy, nunca texto) — el texto del
// header y del pie de página se agrega después, en un segundo paso sobre
// las páginas ya generadas (`bufferPages` + `switchToPage`), cuando ya no
// hay ninguna paginación automática en curso.
async function renderGuidePDF(guide) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4', margins: MARGIN, bufferPages: true, autoFirstPage: false,
      });
      const F = registerFonts(doc);
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Portada — maquetación libre, sin los márgenes de las páginas de contenido.
      doc.addPage({
        size: 'A4', margins: {
          top: 0, bottom: 0, left: 0, right: 0,
        },
      });
      drawCover(doc, guide, F);

      doc.on('pageAdded', () => drawPageBackground(doc));

      doc.addPage({ size: 'A4', margins: MARGIN });
      drawPageBackground(doc);

      const seccionTitulos = (guide.bloques || []).filter((b) => b.tipo === 'titulo').map((b) => b.texto).filter(Boolean);
      if (seccionTitulos.length >= 3) {
        drawVisualIndex(doc, seccionTitulos, F);
        doc.addPage({ size: 'A4', margins: MARGIN });
      }

      const bloques = guide.bloques || [];
      bloques.forEach((bloque, i) => {
        if (isClosingPair(bloques, i)) {
          renderClosingCard(doc, bloque.texto, bloques[i + 1].texto, F);
          return;
        }
        if (i > 0 && isClosingPair(bloques, i - 1)) return; // ya se dibujó junto con el título anterior
        renderBloque(doc, bloque, F);
      });

      // Header + pie de página — recién ahora, en un paso aparte sobre las
      // páginas de contenido ya generadas (todas menos la portada, índice
      // 0), con todo el texto de la guía ya escrito y sin paginación en curso.
      const range = doc.bufferedPageRange();
      for (let i = range.start + 1; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        drawHeaderText(doc, F);
        drawFooter(doc, F, String(i), guide.titulo);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { renderGuidePDF };

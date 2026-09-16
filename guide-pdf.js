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

// Márgenes achicados de 60 a 50 (15/9/2026, rediseño de legibilidad —
// ver el comentario grande más abajo, antes de renderBloque): un poco más
// de ancho de columna para compensar el cuerpo de texto más grande, sin
// tocar para nada el resto de las cuentas de la portada/pie de página, que
// ya usan MARGIN dinámicamente (nunca un número pegado a A4 a mano).
const MARGIN = { top: 76, bottom: 64, left: 50, right: 50 };

// BUG REAL confirmado con guías reales (6/9/2026): texto que desaparecía
// exactamente en los quiebres de página automáticos, en toda la guía (no un
// caso aislado — Rodrigo lo confirmó: "hay errores así por toda la guía").
// Se verificó la causa contra el código fuente real de pdfkit (no se pudo
// instalar pdfkit en este entorno para probarlo corriendo, así que se leyó
// el código de la librería para confirmarlo en vez de adivinar):
//
// `doc.fill(color)` (acá, `.fill(COLOR_BG)`) llama por dentro a
// `doc.fillColor(color)`, que guarda el color en `doc._fillColor` — una
// propiedad de JS común y corriente, SEPARADA del verdadero estado gráfico
// de PDF que manejan `doc.save()`/`doc.restore()` (esos dos solo apilan la
// matriz de transformación y emiten los operadores "q"/"Q" — nunca tocan
// `_fillColor`). O sea: el `save()`/`restore()` de acá abajo no protege para
// nada el color de relleno.
//
// ¿Por qué importa? Cuando un párrafo largo no entra en una página, pdfkit
// agrega una página nueva solo (evento 'pageAdded', el mismo que dispara
// esta función) y, en su propia lógica de ese salto (`nextSection()` en
// line_wrapper.js, parte del código fuente de pdfkit), hace exactamente
// esto para que el texto que sigue no cambie de color al pasar de página:
// `if (doc._fillColor) doc.fillColor(...doc._fillColor)`. El problema es el
// ORDEN: ese chequeo corre DESPUÉS de que ya se disparó 'pageAdded' — es
// decir, después de que esta función ya pisó `doc._fillColor` con
// [COLOR_BG, undefined]. Entonces pdfkit "restaura" el color del texto
// siguiente al color de FONDO, no al color real que tenía (COLOR_INK,
// COLOR_TEAL o COLOR_AMBER según el bloque). El texto sigue estando ahí,
// en el lugar correcto — pero queda escrito en el mismo color que el fondo,
// invisible a simple vista. Eso explica perfecto lo que reportó Rodrigo:
// una frase que se corta justo en el borde de la página y la continuación
// "no aparece en ningún lado" del PDF — no falta, está invisible.
//
// Corrección: guardar `doc._fillColor` antes de pintar el fondo y
// devolverlo después, a mano, porque `save()`/`restore()` no lo hace.
function drawPageBackground(doc) {
  const previousFillColor = doc._fillColor;
  doc.save();
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLOR_BG);
  doc.restore();
  doc._fillColor = previousFillColor;
}

// BUG REAL encontrado con guías reales (3/9/2026): las guías premium (con
// más páginas después de subirles el margen de tokens) aparecían con varias
// páginas en blanco de más. Causa: este pie de página se dibuja a propósito
// DENTRO del margen inferior de la página (MARGIN.bottom = 64, y este texto
// va en height-40 — más abajo del límite de contenido normal). pdfkit, antes
// de dibujar cualquier texto con `width` definido, chequea si entra dentro
// del límite de contenido (altura de la página menos el margen inferior) —
// como el pie de página cae fuera de ese límite a propósito, pdfkit asume
// que "no entra" y agrega una página nueva en blanco ahí mismo antes de
// dibujarlo, en vez de dibujarlo en la página que le pedimos con
// `switchToPage`. Eso pasaba una vez por cada página de contenido (achica
// el margen inferior a 0 temporalmente, solo mientras se dibuja el pie de
// página, así pdfkit deja de pensar que se sale de la hoja — se restaura
// enseguida después, para no afectar nada más del layout de esa página).
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

function drawCover(doc, guide) {
  drawPageBackground(doc);

  // franja inferior más oscura, puramente decorativa, para dar profundidad
  doc.save();
  doc.rect(0, doc.page.height - 160, doc.page.width, 160).fill(COLOR_BG_DEEP);
  doc.restore();

  doc.font('Helvetica-Bold').fontSize(13).fillColor(COLOR_TEAL);
  doc.text('MENTIS', MARGIN.left, 64, { characterSpacing: 2 });

  // 'sistema' es la guía cero (guia-cero.js, 6/9/2026) — la referencia fija
  // del sistema completo, distinta del catálogo rotativo de gratis/premium.
  // No se vende por separado, así que comparte el color teal de "gratis",
  // pero con su propio texto para que se distinga a simple vista en el panel.
  const badgeText = guide.tipo === 'premium' ? 'GUÍA PREMIUM' : guide.tipo === 'sistema' ? 'GUÍA DEL SISTEMA' : 'GUÍA GRATIS';
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

// Rediseño de legibilidad (15/9/2026) — feedback real que le llegó a
// Rodrigo sobre la guía cero: "muy poco atractiva visualmente, difícil de
// leer en un smartphone", con tres pedidos concretos: letra más grande,
// texto condensado (eso se resuelve en el PROMPT de guia-cero.js, acá no
// hay texto que condensar) y sumar figuras/gráficos/diagramas.
//
// Para "letra más grande": se sube el tamaño de cada tipo de bloque un
// 20-25% (11→13.5 el cuerpo, 15→18 los títulos) y se agranda el interlineado
// (lineGap 3→5). Aunque la página siga siendo A4, esto SÍ se nota leyendo en
// el celular: casi todos los lectores de PDF en el teléfono abren "ajustado
// al ancho" — el tamaño que se percibe en pantalla es directamente
// proporcional al tamaño de fuente sobre el ancho de la página, así que
// subir la fuente ~23% sube la letra percibida esa misma proporción, sin
// tocar para nada el ancho de página (que si se cambiara, obligaría a
// recalcular a mano toda la portada/pie de página de arriba — ver el
// comentario grande sobre esos dos bugs reales ya encontrados con esa
// misma cuenta; no vale la pena arriesgar eso de nuevo sin poder probarlo
// primero con pdfkit corriendo de verdad).
//
// Para "figuras/gráficos/diagramas": se suman dos bloques nuevos, dibujados
// a mano con las formas vectoriales de pdfkit (nunca una imagen externa ni
// un navegador headless — mismo motivo de memoria que ya explica todo este
// archivo): 'pasos' (una línea de tiempo vertical numerada, para procesos)
// y 'destacado' (una caja resaltada para una idea clave), que rompen la
// pared de texto sin agregar ningún costo de memoria real.
// BUG REAL confirmado con una guía real (16/9/2026, capturas de Rodrigo:
// "la guía tiene errores, no está bien" — texto empezando a mitad de página
// y cortado en el borde derecho). Causa, distinta de los dos bugs de pdfkit
// ya documentados arriba: pdfkit tiene un cursor interno (`doc.x`/`doc.y`)
// que cualquier `doc.text(str, x, y, opciones)` con x/y EXPLÍCITOS deja
// apuntando a esa x/y después de dibujar — no lo devuelve solo al margen
// izquierdo. Los bloques nuevos ('pasos', 'destacado', 'tabla', 'grafico',
// 'comparacion') dibujan texto en columnas o cajas con x explícita (por
// diseño, tienen que hacerlo). El problema era que 'titulo'/'lista'/'cita'/
// el 'parrafo' de siempre llamaban a `doc.text(str, { width })` SIN x — la
// forma "implícita", que arranca desde donde haya quedado el cursor. Si el
// bloque anterior era, por ejemplo, un 'grafico' (que termina su último
// `doc.text()` bien a la derecha, dibujando el valor al final de la barra),
// el título/párrafo que viniera después arrancaba desde ESA x —
// bien adentro de la página, no del margen izquierdo — y con el mismo
// ancho de columna completo (`contentWidth`) calculado para el margen
// izquierdo real, el texto se salía por el borde derecho de la hoja.
//
// Corrección: TODO texto en esta función ahora pasa x explícita
// (MARGIN.left, salvo los que ya la tenían distinta a propósito, como cada
// celda de una tabla o cada columna de una comparación) — nunca más se
// depende del cursor que haya dejado el bloque anterior. Ya no importa en
// qué orden vengan los bloques.
function renderBloque(doc, bloque) {
  const contentWidth = doc.page.width - MARGIN.left - MARGIN.right;
  if (bloque.tipo === 'titulo') {
    doc.moveDown(1.0);
    doc.font('Helvetica-Bold').fontSize(18);
    // Chequeo de espacio ANTES de dibujar (mismo patrón que 'pasos' y
    // 'destacado' más abajo) — bug real visto en producción (16/9/2026,
    // reportado por Rodrigo con captura): un título de dos líneas arrancaba
    // pegado al borde inferior de la página y el salto automático de
    // pdfkit lo partía a la mitad — "3. La mentalidad que separa construir
    // de solo cambiar" quedaba en una página, "de trabajo" solo y huérfano
    // arriba de la siguiente. Si el título completo (+ lugar para la
    // reglita de abajo) no entra entero en lo que queda de la página, se
    // fuerza el salto ANTES, nunca a mitad de su propio texto.
    const headingHeight = doc.heightOfString(bloque.texto, { width: contentWidth });
    if (doc.y + headingHeight + 24 > doc.page.height - MARGIN.bottom) {
      doc.addPage();
    }
    doc.fillColor(COLOR_TEAL);
    doc.text(bloque.texto, MARGIN.left, doc.y, { width: contentWidth });
    // Pequeña regla horizontal debajo del título — separa la sección a
    // simple vista, sin depender de que el lector note el cambio de color.
    const ruleY = doc.y + 4;
    doc.save();
    doc.strokeColor(COLOR_TEAL).opacity(0.5).lineWidth(1.5);
    doc.moveTo(MARGIN.left, ruleY).lineTo(MARGIN.left + 46, ruleY).stroke();
    doc.restore();
    doc.y = ruleY + 10;
    doc.x = MARGIN.left;
    return;
  }
  if (bloque.tipo === 'lista') {
    doc.moveDown(0.35);
    doc.font('Helvetica').fontSize(13).fillColor(COLOR_INK);
    (bloque.items || []).forEach((item) => {
      doc.text('•  ' + item, MARGIN.left, doc.y, { width: contentWidth, lineGap: 4 });
      doc.moveDown(0.2);
    });
    doc.moveDown(0.3);
    doc.x = MARGIN.left;
    return;
  }
  if (bloque.tipo === 'cita') {
    doc.moveDown(0.45);
    doc.font('Helvetica-Oblique').fontSize(13).fillColor(COLOR_AMBER);
    doc.text('"' + bloque.texto + '"', MARGIN.left, doc.y, { width: contentWidth, lineGap: 4 });
    if (bloque.autor) {
      doc.font('Helvetica').fontSize(10.5).fillColor(COLOR_INK_DIM);
      doc.text('— ' + bloque.autor + (bloque.obra ? ', ' + bloque.obra : ''), MARGIN.left, doc.y, { width: contentWidth });
    }
    doc.moveDown(0.45);
    doc.x = MARGIN.left;
    return;
  }
  // 'pasos' — línea de tiempo vertical numerada (un círculo con el número
  // por paso, unidos por una línea). Pensado para procesos ("cómo funciona
  // el sistema", "los pasos para arrancar") — mismo formato de entrada que
  // 'lista' ({"items": [...]}) para que sea fácil de generar y de leer en
  // el prompt, aunque el resultado visual sea muy distinto.
  //
  // Nota honesta sobre un límite conocido: si un paso individual es tan
  // largo que su texto cruza un salto de página automático de pdfkit, el
  // círculo del paso siguiente puede terminar en la página nueva sin la
  // línea que lo conecta con el anterior — es un defecto cosmético, nunca
  // se pierde texto (a diferencia de los dos bugs reales de arriba). El
  // chequeo de espacio de abajo evita el caso más común (un círculo solo,
  // huérfano, al pie de la página).
  if (bloque.tipo === 'pasos') {
    doc.moveDown(0.4);
    const items = (bloque.items || []).filter(Boolean);
    const circleR = 11;
    const circleX = MARGIN.left + circleR;
    const gap = 14;
    const textX = circleX + circleR + gap;
    const textWidth = contentWidth - (circleR * 2 + gap);
    let prevCircleBottom = null;
    items.forEach((item, i) => {
      // Si no entra ni el círculo + una línea de texto, se fuerza el salto
      // de página ANTES de dibujar nada de este paso — mejor un paso entero
      // en la página siguiente que un círculo cortado al final de esta.
      if (doc.y + circleR * 2 + 20 > doc.page.height - MARGIN.bottom) {
        doc.addPage();
        prevCircleBottom = null; // no conectar la línea a través del salto de página
      }
      const stepTop = doc.y;
      const circleCenterY = stepTop + circleR;
      if (prevCircleBottom !== null) {
        doc.save();
        doc.strokeColor(COLOR_TEAL).opacity(0.35).lineWidth(1.2);
        doc.moveTo(circleX, prevCircleBottom).lineTo(circleX, circleCenterY - circleR).stroke();
        doc.restore();
      }
      doc.save();
      doc.fillColor(COLOR_TEAL).circle(circleX, circleCenterY, circleR).fill();
      doc.restore();
      doc.save();
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COLOR_BG);
      doc.text(String(i + 1), circleX - circleR, circleCenterY - 5, { width: circleR * 2, align: 'center', lineBreak: false });
      doc.restore();
      doc.font('Helvetica').fontSize(12.5).fillColor(COLOR_INK);
      doc.text(item, textX, stepTop, { width: textWidth, lineGap: 4 });
      const stepBottom = Math.max(doc.y, circleCenterY + circleR);
      prevCircleBottom = circleCenterY + circleR;
      doc.y = stepBottom + 16;
    });
    doc.moveDown(0.3);
    doc.x = MARGIN.left; // ver el comentario grande sobre el cursor de pdfkit, arriba de renderBloque
    return;
  }
  // 'destacado' — caja resaltada para UNA idea clave (una sola frase corta,
  // no un párrafo entero: el punto es que se lea de un vistazo). Mismo
  // chequeo de espacio que 'pasos', por la misma razón.
  if (bloque.tipo === 'destacado') {
    doc.moveDown(0.5);
    const text = bloque.texto || '';
    const padding = 14;
    const boxWidth = contentWidth;
    doc.font('Helvetica-Bold').fontSize(13);
    const textHeight = doc.heightOfString(text, { width: boxWidth - padding * 2, lineGap: 4 });
    const boxHeight = textHeight + padding * 2;
    if (doc.y + boxHeight > doc.page.height - MARGIN.bottom) {
      doc.addPage();
    }
    const boxY = doc.y;
    doc.save();
    doc.fillOpacity(0.14);
    doc.fillColor(COLOR_TEAL).roundedRect(MARGIN.left, boxY, boxWidth, boxHeight, 8).fill();
    doc.restore();
    doc.save();
    doc.fillColor(COLOR_TEAL).rect(MARGIN.left, boxY, 3, boxHeight).fill();
    doc.restore();
    doc.fillOpacity(1);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(COLOR_INK);
    doc.text(text, MARGIN.left + padding, boxY + padding, { width: boxWidth - padding * 2, lineGap: 4 });
    doc.y = boxY + boxHeight + 10;
    doc.moveDown(0.3);
    doc.x = MARGIN.left; // ver el comentario grande sobre el cursor de pdfkit, arriba de renderBloque
    return;
  }
  // --- Segunda tanda de bloques visuales (16/9/2026) ------------------------
  // Rodrigo pidió, en su propio mensaje, específicamente "gráficos, tablas,
  // infografía" — 'pasos'/'destacado' de arriba ya ayudaban, pero seguía
  // siendo básicamente texto con alguna forma. Estos tres son más fuertes:
  // una tabla real, un gráfico de barras real, y una comparación de dos
  // columnas (muy propia del contenido de Rodrigo — "mentalidad de empleado
  // vs. mentalidad de dueño", "antes vs. después"). Mismo criterio de página
  // que 'pasos'/'destacado': si no entra, se pasa de hoja entera, nunca se
  // corta a la mitad de un dibujo.
  //
  // Cuidado importante, documentado acá porque no es obvio: un "gráfico" con
  // números sugiere un dato real y sustentado. El prompt (guia-cero.js /
  // weekly-guides.js) le prohíbe a Mentis usar estadísticas externas o cifras
  // de mercado que no puede sustentar — 'grafico' es solo para ilustrar un
  // punto conceptual PROPIO (ej. "cómo se reparte tu tiempo hoy vs. con el
  // sistema"), nunca para disfrazar de dato duro algo que no lo es. Acá, del
  // lado del dibujo, no hay forma de validar eso — es una regla de contenido,
  // no de render.

  // 'tabla' — {"headers":["...","..."], "filas":[["...","..."],...]}. Pensada
  // para 2-3 columnas (más que eso, las celdas quedan muy angostas para leer
  // cómodo en el celular) — el prompt le pide a Mentis respetar ese límite,
  // pero acá no se lo fuerza (ancho de columna simplemente se reparte parejo
  // entre las que vengan) para nunca perder una columna de más si el límite
  // no se respetó.
  if (bloque.tipo === 'tabla') {
    doc.moveDown(0.4);
    const headers = bloque.headers || [];
    const filas = bloque.filas || [];
    const cols = headers.length || (filas[0] ? filas[0].length : 0);
    if (cols === 0) return;
    const colWidth = contentWidth / cols;
    const cellPad = 8;

    function cellHeight(text, fontName, fontSize) {
      doc.font(fontName).fontSize(fontSize);
      return doc.heightOfString(String(text == null ? '' : text), { width: colWidth - cellPad * 2, lineGap: 2 }) + cellPad * 2;
    }
    const headerHeight = Math.max(...headers.map((h) => cellHeight(h, 'Helvetica-Bold', 11)), 26);
    const rowHeights = filas.map((fila) => Math.max(...fila.map((c) => cellHeight(c, 'Helvetica', 11)), 22));

    // Si ni siquiera entran el encabezado + la primera fila, se pasa la
    // tabla entera a la hoja siguiente — mejor una tabla completa más abajo
    // que un encabezado solo, huérfano, al pie de la página.
    if (doc.y + headerHeight + (rowHeights[0] || 0) > doc.page.height - MARGIN.bottom) {
      doc.addPage();
    }

    let y = doc.y;
    doc.save();
    doc.fillColor(COLOR_TEAL).rect(MARGIN.left, y, contentWidth, headerHeight).fill();
    doc.restore();
    doc.font('Helvetica-Bold').fontSize(11).fillColor(COLOR_BG);
    headers.forEach((h, i) => {
      doc.text(String(h), MARGIN.left + i * colWidth + cellPad, y + cellPad, { width: colWidth - cellPad * 2, lineGap: 2 });
    });
    y += headerHeight;

    filas.forEach((fila, rIdx) => {
      const rh = rowHeights[rIdx];
      // Salto de página POR FILA (no por tabla entera) a partir de acá — es
      // la misma limitación cosmética honesta que ya tiene 'pasos': el
      // encabezado no se repite en la página nueva, pero ningún dato se
      // pierde.
      if (y + rh > doc.page.height - MARGIN.bottom) {
        doc.addPage();
        y = doc.y;
      }
      if (rIdx % 2 === 1) {
        doc.save();
        doc.fillColor(COLOR_TEAL).fillOpacity(0.08).rect(MARGIN.left, y, contentWidth, rh).fill();
        doc.fillOpacity(1);
        doc.restore();
      }
      doc.font('Helvetica').fontSize(11).fillColor(COLOR_INK);
      fila.forEach((c, i) => {
        doc.text(String(c == null ? '' : c), MARGIN.left + i * colWidth + cellPad, y + cellPad, { width: colWidth - cellPad * 2, lineGap: 2 });
      });
      y += rh;
    });
    doc.y = y + 12;
    doc.moveDown(0.3);
    doc.x = MARGIN.left; // ver el comentario grande sobre el cursor de pdfkit, arriba de renderBloque
    return;
  }

  // 'grafico' — {"titulo":"... (opcional)", "categorias":["...","..."],
  // "valores":[10,20,...], "unidad":"% (opcional)"}. Barras HORIZONTALES a
  // propósito (no verticales): pdfkit no rota texto fácil, y una barra
  // horizontal deja usar etiquetas de largo variable sin tener que
  // inclinarlas. Categorías cortas (2-4 palabras) las pide el prompt, para
  // que la etiqueta nunca envuelva a dos líneas y desalinee la barra.
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

    // Alto total del gráfico (título opcional + todas las barras). Antes el
    // chequeo de espacio era fila por fila nomás, así que una categoría
    // "sobrante" podía terminar sola y huérfana arriba de la página
    // siguiente, con el resto del gráfico atrás en la anterior — no se
    // pierde ningún dato, pero queda feo (reportado por Rodrigo, 16/9/2026,
    // con captura de un gráfico de 4 barras partido así). Si el gráfico
    // completo entra en una página en blanco pero no en lo que queda de la
    // actual, se fuerza el salto ANTES de dibujar la primera barra, para
    // que todas queden juntas. Si el gráfico es tan largo que ni una
    // página en blanco le alcanza, se deja el chequeo fila por fila de
    // abajo como red de seguridad (nunca se corta una barra a la mitad).
    let tituloHeight = 0;
    if (bloque.titulo) {
      doc.font('Helvetica-Bold').fontSize(12);
      tituloHeight = doc.heightOfString(bloque.titulo, { width: contentWidth }) + 5;
    }
    const chartHeight = tituloHeight + categorias.length * (barHeight + rowGap);
    const blankPageHeight = doc.page.height - MARGIN.top - MARGIN.bottom;
    if (doc.y + chartHeight > doc.page.height - MARGIN.bottom && chartHeight <= blankPageHeight) {
      doc.addPage();
    }

    if (bloque.titulo) {
      doc.font('Helvetica-Bold').fontSize(12).fillColor(COLOR_INK);
      doc.text(bloque.titulo, MARGIN.left, doc.y, { width: contentWidth });
      doc.moveDown(0.35);
    }

    categorias.forEach((cat, i) => {
      if (doc.y + barHeight + rowGap > doc.page.height - MARGIN.bottom) {
        doc.addPage();
      }
      const val = valores[i] || 0;
      const y2 = doc.y;
      doc.font('Helvetica').fontSize(10.5).fillColor(COLOR_INK_DIM);
      doc.text(String(cat), MARGIN.left, y2 + 3, { width: labelWidth - 8, lineGap: 2, lineBreak: false, ellipsis: true });
      doc.save();
      doc.fillColor(COLOR_INK_DIM).fillOpacity(0.15).rect(barAreaX, y2, barAreaWidth, barHeight).fill();
      doc.fillOpacity(1);
      doc.restore();
      const w = Math.max(4, (val / maxVal) * barAreaWidth);
      doc.save();
      doc.fillColor(COLOR_TEAL).rect(barAreaX, y2, w, barHeight).fill();
      doc.restore();
      doc.font('Helvetica-Bold').fontSize(10).fillColor(COLOR_INK);
      doc.text(`${val}${bloque.unidad || ''}`, barAreaX + barAreaWidth + 6, y2 + 3, { width: 40, lineBreak: false });
      doc.y = y2 + barHeight + rowGap;
    });
    doc.moveDown(0.3);
    doc.x = MARGIN.left; // ver el comentario grande sobre el cursor de pdfkit, arriba de renderBloque
    return;
  }

  // 'comparacion' — {"izquierda":{"titulo":"...", "items":["...","..."]},
  // "derecha":{"titulo":"...", "items":["...","..."]}}. Dos columnas lado a
  // lado, izquierda en ámbar (el "antes"/problema) y derecha en teal (el
  // "después"/solución) — mapea directo al tipo de contraste que ya usa
  // Rodrigo en su contenido ("mentalidad de empleado" vs "mentalidad de
  // dueño"). Ambas columnas se miden ANTES de dibujar nada, así la caja sale
  // pareja (misma altura de las dos) sin importar cuál tenga más texto.
  if (bloque.tipo === 'comparacion') {
    doc.moveDown(0.4);
    const colGap = 16;
    const colWidth = (contentWidth - colGap) / 2;
    const izq = bloque.izquierda || {};
    const der = bloque.derecha || {};

    function colHeight(col) {
      doc.font('Helvetica-Bold').fontSize(12);
      let h = doc.heightOfString(col.titulo || '', { width: colWidth - 24 }) + 16;
      doc.font('Helvetica').fontSize(11);
      (col.items || []).forEach((item) => {
        h += doc.heightOfString('•  ' + item, { width: colWidth - 24, lineGap: 3 }) + 6;
      });
      return h + 18;
    }
    const boxHeight = Math.max(colHeight(izq), colHeight(der));

    if (doc.y + Math.min(boxHeight, 90) > doc.page.height - MARGIN.bottom) {
      doc.addPage();
    }
    const boxY = doc.y;

    function drawCol(col, x, color) {
      doc.save();
      doc.fillColor(color).fillOpacity(0.12).roundedRect(x, boxY, colWidth, boxHeight, 8).fill();
      doc.fillOpacity(1);
      doc.restore();
      doc.save();
      doc.fillColor(color).rect(x, boxY, colWidth, 3).fill();
      doc.restore();
      doc.font('Helvetica-Bold').fontSize(12).fillColor(COLOR_INK);
      doc.text(col.titulo || '', x + 12, boxY + 16, { width: colWidth - 24 });
      let cy = doc.y + 8;
      doc.font('Helvetica').fontSize(11).fillColor(COLOR_INK_DIM);
      (col.items || []).forEach((item) => {
        doc.text('•  ' + item, x + 12, cy, { width: colWidth - 24, lineGap: 3 });
        cy = doc.y + 6;
      });
    }
    drawCol(izq, MARGIN.left, COLOR_AMBER);
    drawCol(der, MARGIN.left + colWidth + colGap, COLOR_TEAL);
    doc.y = boxY + boxHeight + 14;
    doc.moveDown(0.3);
    doc.x = MARGIN.left; // ver el comentario grande sobre el cursor de pdfkit, arriba de renderBloque
    return;
  }

  // 'parrafo' y cualquier tipo desconocido caen acá — nunca se pierde texto
  // por un tipo de bloque que no se reconoce.
  doc.font('Helvetica').fontSize(13.5).fillColor(COLOR_INK);
  doc.text(bloque.texto || '', MARGIN.left, doc.y, { width: contentWidth, align: 'left', lineGap: 5 });
  doc.moveDown(0.55);
  doc.x = MARGIN.left;
}

// 'Índice visual' (16/9/2026) — página aparte, justo después de la portada,
// que lista las secciones de la guía como una línea de tiempo numerada
// (mismo lenguaje visual que 'pasos' de arriba, pero para el índice
// completo). Pedido explícito de Rodrigo: quiere la guía "más visual y no
// tan textual" — esto ataca el problema desde la primera página después de
// la portada, antes de que el lector vea una sola línea de texto corrido:
// de un vistazo entiende la estructura completa de lo que va a leer. Se
// arma SOLO — no hace falta que el prompt genere nada especial para esto —
// leyendo los bloques "titulo" que Mentis ya devuelve, así que funciona
// igual para la guía cero como para cualquier guía del catálogo semanal.
function drawVisualIndex(doc, titulos) {
  const contentWidth = doc.page.width - MARGIN.left - MARGIN.right;
  doc.font('Helvetica-Bold').fontSize(20).fillColor(COLOR_TEAL);
  doc.text('En esta guía', MARGIN.left, doc.y, { width: contentWidth });
  doc.moveDown(1.1);

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
    doc.fillColor(COLOR_TEAL).circle(circleX, centerY, circleR).fill();
    doc.restore();
    doc.save();
    doc.font('Helvetica-Bold').fontSize(12).fillColor(COLOR_BG);
    doc.text(String(i + 1), circleX - circleR, centerY - 6, { width: circleR * 2, align: 'center', lineBreak: false });
    doc.restore();
    doc.font('Helvetica-Bold').fontSize(13).fillColor(COLOR_INK);
    doc.text(t, textX, stepTop + 2, { width: textWidth, lineGap: 4 });
    const stepBottom = Math.max(doc.y, centerY + circleR);
    prevBottom = centerY + circleR;
    doc.y = stepBottom + 20;
  });
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

      // Página de índice visual — solo si hay al menos 3 secciones (con
      // menos, no suma nada y sería una página casi vacía). Si aplica, la
      // página recién agregada de arriba se usa PARA el índice, y se agrega
      // una más para arrancar el contenido de verdad; si no aplica, la
      // página de arriba ES directamente la primera de contenido, cero
      // cambio de comportamiento para guías cortas.
      const seccionTitulos = (guide.bloques || []).filter((b) => b.tipo === 'titulo').map((b) => b.texto).filter(Boolean);
      if (seccionTitulos.length >= 3) {
        drawVisualIndex(doc, seccionTitulos);
        doc.addPage({ size: 'A4', margins: MARGIN }); // el fondo lo pinta solo el handler 'pageAdded' de arriba
      }

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

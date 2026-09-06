# Guía cero — Módulo 02 → referencia fija del sistema

Genera y actualiza LA guía de referencia fija que explica el sistema completo de Rodrigo — no un tema puntual, el porqué de todo lo demás. Implementada igual que el resto de las tareas: la lógica vive en `guia-cero.js`, corriendo dentro del mismo servidor (`mentis-chat-server`, Módulo 08), expuesta como la ruta protegida `POST /internal/guia-cero`.

Pedido explícito de Rodrigo (6/9/2026), después de charlar sobre qué guía(s) mandar cuando un lead responde el CTA de un reel: *"¿Puedes codificar algo en mentis en que él me haga esa guía inicial? O sea, esa guía cero de referencia para enviar siempre al cliente, siempre que responde un CTA."*

## Por qué esto no es "una guía más" del catálogo

`weekly-guides.js` (el catálogo de `guides` gratis/premium) arma guías nuevas todas las semanas, cada una sobre 2-3 categorías de conocimiento distintas, sin repetir combinación. La guía cero es lo opuesto a propósito: **una sola guía fija y evergreen**, siempre el mismo archivo (`guia-cero.md` / `guia-cero.pdf`, guardados en la raíz de la carpeta de guías en Dropbox — no adentro de `gratis/` ni `premium/`, y sin id ni entrada en `guide-catalog.json`). Cada vez que corre, la SOBREESCRIBE — nunca genera una nueva ni acumula versiones.

Por eso el workflow que la dispara (`guia-cero.yml`) es manual, sin cron: no tiene sentido rehacerla sola cada semana como el catálogo. Se dispara a mano desde la pestaña "Actions" de GitHub cuando Rodrigo quiere revisarla o mejorar el contenido.

## Cómo se usa (pensado, todavía no conectado)

La idea acordada con Rodrigo: cuando un lead responde el CTA de un reel (comentando la palabra clave), se le mandan **dos guías**, no una — la guía cero (esta, siempre la misma) más una segunda guía del catálogo que matchee el tema puntual del reel que generó el contacto. La guía cero da el contexto de fondo ("por qué existe todo esto"); la segunda entra en el tema específico que lo enganchó.

Honesto sobre lo que falta: el mecanismo que elige automáticamente cuál guía del catálogo matchea mejor con el ángulo del reel del día todavía no está construido. Y el envío en sí (mandar cualquier guía por ManyChat cuando alguien comenta la palabra clave) tampoco existe todavía — depende de que Rodrigo conecte ManyChat, igual que aclara `weekly-guides.md`. Esto resuelve la primera mitad (la guía cero fija) tal como se pidió explícitamente.

## Bug real reportado por Rodrigo (6/9/2026, mismo día): frases incompletas y sin títulos

Primera corrida real, primer reporte: "esta funcionando. pero la guía tiene errores" → "frases incompletas, falta de titulos". Importante entender qué NO fue esto: el JSON de Mentis llegó completo y bien formado — nunca disparó el chequeo de `stop_reason === 'max_tokens'` que ya existía en `callMentis` (el mismo que atrapó el bug real de las guías premium del catálogo, ver `weekly-guides.md`). Es decir, no fue una respuesta cortada por falta de espacio: fue un problema de **contenido**. El prompt original le pedía a Mentis que desarrollara los 5 pilares, pero nunca le exigía explícitamente un bloque `"titulo"` por pilar — así que Mentis escribió todo como bloques de texto corrido, sin separadores, y en el camino algunas ideas quedaron sin terminar.

Corrección de dos partes:

1. **Prompt más explícito** (`REGLAS_GUIA_CERO`): ahora exige, en mayúsculas, una estructura mínima obligatoria — un `"titulo"` antes de la historia, uno antes de cada uno de los 5 pilares, y uno antes del cierre (mínimo 7 títulos en total) — y exige que cada bloque de texto termine en una oración gramaticalmente cerrada, nunca a mitad de camino.
2. **Chequeo automático después de generar** (`detectarProblemasDeCalidad()` en `guia-cero.js`): cuenta los bloques de tipo `"titulo"` (rechaza si hay menos de 5) y revisa que ningún bloque de texto de más de 25 caracteres termine sin un signo de cierre de oración (`.`, `?`, `!`, comillas de cierre, etc.). Si detecta cualquiera de los dos problemas, **no guarda nada** — ni el `.md` ni el PDF se sobreescriben, la guía anterior (si había una) queda como estaba — y devuelve el error explicando exactamente qué faltó, para disparar el workflow de nuevo en vez de quedarse con una guía rota en silencio.

Como con el bug del PDF de páginas en blanco (ver `weekly-guides.md`), esto no se pudo probar contra una corrida real en el momento de escribirlo — la sintaxis está verificada, la heurística de "frase cortada" se probó con casos sueltos a mano, pero la confirmación real es la próxima vez que Rodrigo dispare el workflow.

## Reglas de contenido — por qué son estas y no las genéricas del catálogo

`weekly-guides.js` tiene su propio `VOICE_RULES` (tono, nunca revelar el mecanismo interno, atribuir citas textuales). La guía cero reutiliza ese mismo espíritu pero con un set de reglas más específico (`REGLAS_GUIA_CERO` en `guia-cero.js`), porque varias vienen de un "no" explícito de Rodrigo sobre ESTE contenido puntual — no son reglas de tono generales:

- **Historia real, para generar conexión**: Venezuela (14 años) → Portugal → Canadá (donde vive hoy, casi 3 años) — reconstruir la vida desde cero varias veces. Diez años en logística internacional (DHL), donde aprendió sistemas y mejora continua. Su formación de ingeniero como la lente con la que ve los problemas.
- **Nunca Miami.**
- **Nunca su trabajo actual (construcción civil)** — pedido explícito de Rodrigo el 6/9/2026, después de un primer borrador que sí lo mencionaba: se omite por completo, no se reemplaza por nada.
- **Peso mínimo a su esposa** — mismo pedido, mismo día: el foco humano de la historia es la disciplina, el tiempo y la mentalidad, no la familia.
- **Los 5 pilares del sistema, siempre los mismos** (a diferencia del catálogo, que elige categorías al azar): vender sin sonar a vendedor, presencia en redes sostenida en el tiempo, la mentalidad de quien construye algo propio, ingreso adicional serio (incluido lo bueno del network marketing), y disciplina/manejo del tiempo como base de todo lo anterior.
- **Gancho fuerte desde la primera o segunda oración** — nunca una introducción lenta.
- **Cierre de venta obligatorio, sin inventar nada**: invita a escribirle directo a Rodrigo para ir más profundo — nunca un link, precio o fecha concreta, porque hoy no existen (mismo criterio que toda guía del catálogo, ver `weekly-guides.js`).

Estas reglas vienen directo de dos borradores que se revisaron a mano con Rodrigo antes de codificar esto (`mentis-guia-sistema-borrador.md` → `mentis-guia-sistema-v2.md`, fuera del repo, solo para la revisión): la primera vuelta mencionaba el trabajo en construcción civil, y Rodrigo pidió sacarlo. La versión que quedó ya reforzaba el gancho inicial a pedido suyo también. Esta guía, construida por el pipeline real, sigue exactamente esos mismos ajustes — no hace falta repetir la conversación cada vez que se regenera.

## Formato — mismo mecanismo que el catálogo, cero código nuevo en `guide-pdf.js`

Igual que `weekly-guides.js`, Mentis devuelve el contenido como "bloques" (`titulo`/`parrafo`/`lista`/`cita`) — el mismo formato exacto que ya entiende `guide-pdf.js` y que `bloquesToMarkdown()` convierte a markdown. Por eso el `.md` y el PDF de la guía cero salen siempre iguales, sin ningún cambio al renderer.

Único ajuste real en `guide-pdf.js`: la portada ahora reconoce un tercer `tipo` posible, `'sistema'` (antes solo existían `'gratis'`/`'premium'`) — muestra el badge "GUÍA DEL SISTEMA" en vez de "GUÍA GRATIS"/"GUÍA PREMIUM", con el mismo color teal de las gratis (no se vende por separado). El resto del renderer no cambió.

## Dónde aparece — panel personal

`panel.js` tiene una sección nueva, "Guía cero", arriba de la sección de "Guías" (el catálogo) — muestra el título/subtítulo actual, cuándo se generó por última vez, y los links para ver el texto completo o el PDF. Dos rutas nuevas, separadas del resto porque la guía cero no tiene id ni vive en `guide-catalog.json`:

- `GET /panel/<PANEL_SECRET>/guia-cero`
- `GET /panel/<PANEL_SECRET>/guia-cero/pdf`

## Configuración necesaria (una sola vez)

En Render: cargar `GUIA_CERO_SECRET` (un string largo y random, distinto a todos los demás secretos). En GitHub (Settings → Secrets and variables → Actions): `MENTIS_GUIA_CERO_URL` (la URL del servidor + `/internal/guia-cero`) y `MENTIS_GUIA_CERO_SECRET` (el mismo valor que `GUIA_CERO_SECRET` en Render).

## Cómo generarla o actualizarla

Desde la pestaña "Actions" de GitHub, correr el workflow "Guía cero de Mentis" a mano (botón "Run workflow"). Tarda lo mismo que una guía premium del catálogo (hasta unos minutos, según cuánto conocimiento cargado haya). El workflow reintenta hasta 6 veces si el servidor todavía está despertando (mismo criterio que "Borrar guías y contenido") — Render (plan free) se apaga solo tras 15 minutos sin uso, y este workflow no tiene ningún otro que lo despierte antes en el mismo día.

## Lo que falta (honesto)

- El matching automático de la segunda guía (la del tema puntual del reel) — no construido todavía.
- El envío real de ambas guías cuando alguien comenta la palabra clave — depende de ManyChat, que Rodrigo todavía no conectó.
- No se probó todavía contra una corrida real (mismo caveat de siempre con código nuevo escrito fuera del entorno de despliegue): la sintaxis está verificada, pero la primera corrida real en Render es la que confirma que todo el camino completo (Dropbox → Mentis → PDF → Dropbox de nuevo) funciona de punta a punta.

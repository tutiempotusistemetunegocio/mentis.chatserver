# Catálogo de guías — Módulo 02 → contenido pago y gratis

Arma las guías descargables del sistema (el "repositorio de guías" que describe el plano) — tanto las gratis (lead magnet) como las premium (parte del acceso pago). Implementado igual que el resto de las tareas diarias: la lógica vive en `weekly-guides.js`, corriendo dentro del mismo servidor (`mentis-chat-server`, Módulo 08), expuesta como la ruta protegida `POST /internal/weekly-guides`.

Pedido explícito de Rodrigo (2/9/2026): antes de vender, arrancar con 10 guías premium + 10 gratis ya cargadas, y que el catálogo quede "siempre alimentado" — todas las semanas, al menos 2 gratis + 2 premium nuevas, para siempre. No es un lote único: es un módulo recurrente, como la lectura diaria o el guion diario, pero con ritmo semanal en vez de diario.

## Por qué el arranque y las semanas normales son la misma corrida

Cada corrida genera hasta `GUIDES_PER_RUN_FREE` gratis + `GUIDES_PER_RUN_PREMIUM` premium (2 y 2 por default) — no hay un "modo primera vez" especial. Para juntar rápido las primeras 20, Rodrigo dispara esta tarea a mano varias veces seguidas desde la pestaña "Actions" de GitHub — el mismo truco que ya usó para ponerse al día con los ~101 libros pendientes de la lectura diaria. Después de eso, el cron semanal (lunes 11:00 UTC, ajustable) solo hace la reposición de 2+2 — no hace falta tocar nada.

## Cómo arma cada guía

1. Baja de Dropbox el conocimiento y el catálogo de guías existente (mismo motivo de siempre: el disco de Render no sobrevive garantizado entre reinicios).
2. Por cada tipo (gratis, premium), hasta su cupo por corrida: le pide a Mentis que elija 2 o 3 categorías de conocimiento que se complementen — nunca una sola categoría, tal como lo pidió Rodrigo — evitando repetir una combinación ya usada hace poco para ese mismo tipo.
3. Mentis escribe la guía completa con las reglas de voz de siempre (nunca revelar el mecanismo interno) más una regla nueva, explicada abajo.
4. Guarda la guía como archivo `.md` fechado, actualiza el índice del catálogo (`guide-catalog.json`) y sube todo a Dropbox.

## Diferencia entre gratis y premium

Es una decisión mía, no viene del plano — se la marco a Rodrigo por las dudas: la guía gratis entrega un framework claro y completo en sí mismo, pero sin agotar todo lo que Mentis sabe del tema (deja con ganas de más, a propósito). La premium busca sentirse claramente más valiosa: varios frameworks combinados, más profundidad y ejemplos aplicados paso a paso — no solo "más larga". Si Rodrigo quiere otro criterio de diferenciación, es un cambio de prompt, no de arquitectura.

## Bug encontrado y corregido: las premium se cortaban a mitad de camino

Rodrigo reportó (2/9/2026) que el catálogo solo estaba cargando guías gratis, ninguna premium. La causa: al pedirle a Claude una guía completa, se le pedía un límite fijo de 4.000 tokens de respuesta para los dos tipos por igual. Las guías premium piden explícitamente más profundidad (varios frameworks, ejemplos paso a paso), y con el formato nuevo de "bloques" en JSON (que pesa más que texto plano por las comillas y llaves) la respuesta se quedaba sin espacio a mitad de la guía — el JSON quedaba cortado, no se podía leer, y esa guía se perdía en silencio (quedaba solo en el registro de fallas de la corrida, no visible en el panel). Las gratis, al pedir menos profundidad, entraban casi siempre dentro del mismo límite y por eso sí se estaban generando.

Corrección (primera vuelta): las guías premium ahora piden hasta 8.000 tokens de respuesta (las gratis, 4.500), y se agregó una verificación explícita que detecta este corte a tiempo y explica la causa real en el mensaje de error, en vez de un "JSON inválido" genérico que no decía por qué. También se subió el tiempo máximo de esta llamada (de 2 a 3 minutos) y el `--max-time` del workflow de GitHub Actions (de 10 a 15 minutos), para que una guía premium más larga tenga tiempo real de terminar.

**Esa primera corrección no alcanzó**: en la corrida real del 2/9/2026 (run #5), una de las dos guías premium volvió a cortarse — esta vez justo en el nuevo techo de 8.000 tokens. El error explícito agregado en la primera vuelta funcionó exactamente como estaba pensado (mostró la causa real, no un "JSON inválido" genérico), pero el número elegido (8.000) seguía siendo insuficiente para el contenido real que pide una guía premium en formato "bloques". Se confirmó contra la documentación pública de Anthropic (2/9/2026) que el modelo usado acá (`claude-sonnet-4-5`) admite hasta 128.000 tokens de respuesta sin necesitar ningún header especial — 8.000 nunca fue un límite real del modelo, era solo un número elegido a ojo. Corrección real: se sube el techo de la premium a 20.000 tokens (con margen amplio de verdad esta vez, no solo el doble de lo que ya había fallado una vez), y el tiempo máximo de la llamada de 4 a 5 minutos (`GENERATE_TIMEOUT_MS`) más el `--max-time` del workflow de 20 a 25 minutos, para darle tiempo real a una guía que efectivamente use ese margen. Subir el techo no encarece nada salvo que la guía realmente necesite esos tokens — se paga por lo que se genera, no por el número puesto como límite.

**Con las premium ya resueltas, el mismo corte apareció del lado gratis**: en la corrida del 3/9/2026 (run #7), las dos guías premium salieron completas (confirma que el arreglo de arriba funcionó), pero una guía GRATIS se cortó con el mismo error, esta vez en `max_tokens=4500` — el número de las gratis tampoco era un margen real, solo uno que le alcanzaba a la mayoría. Mismo diagnóstico, misma corrección: se sube el techo de las gratis de 4.500 a 8.000 tokens.

## Bug real encontrado en la primera corrida en vivo (2/9/2026): el PDF fallaba siempre

Confirmó exactamente el caveat que se le avisó a Rodrigo cuando se entregó `guide-pdf.js`: no se había podido ejecutar en el entorno de trabajo donde se escribió (el registro de npm estaba bloqueado ahí), solo se revisó la sintaxis. En la primera corrida real, las 3 guías se generaron bien (el `.md` de cada una se guardó sin problema — el aislamiento entre guía y PDF funcionó como estaba pensado), pero el PDF de las 3 falló con "Maximum call stack size exceeded".

Causa real: dentro del evento `pageAdded` de pdfkit se dibujaba el pie de página con texto (`doc.text()`) mientras pdfkit todavía estaba paginando automáticamente por desborde de texto — eso lo hace reentrar en su propia lógica de layout, un problema conocido de esa librería. Corregido: ese evento ahora solo pinta el fondo de color (un rectángulo relleno, nunca texto), y el pie de página se agrega en un paso aparte, después, sobre las páginas ya generadas — cuando ya no hay ninguna paginación automática en curso. Las 3 guías de esa primera corrida se quedaron sin PDF (quedan así, no se regeneran solas); las que se generen de acá en adelante sí deberían salir bien.

También en esa misma corrida, una de las dos guías premium se abortó por el límite de tiempo (180s no le alcanzó siempre con el nuevo margen de tokens) — se subió a 240s.

## Cada guía sale también en PDF con diseño

Pedido explícito de Rodrigo (2/9/2026): "¿tienes una estructura hecha? ¿versión PDF? ¿los colores?". Cada guía ahora se arma en dos formatos que dicen exactamente lo mismo: el `.md` de siempre (para leerla en el panel) y un PDF (`guide-pdf.js`) con la misma identidad visual que la página personal y el chat premium — fondo azul marino oscuro, acentos en teal y ámbar, portada con título/subtítulo/categorías. Para lograr que ambos coincidan siempre, Mentis ya no devuelve un bloque de texto libre: devuelve la guía dividida en "bloques" (títulos de sección, párrafos, listas, citas), y de ahí se arman tanto el `.md` como el PDF.

Decisión técnica, para que quede claro por qué: el PDF se arma con `pdfkit` (arma el archivo programáticamente, sin levantar ningún navegador) en vez de un navegador headless tipo Puppeteer — el servidor en Render (free tier, 512MB) ya se quedó sin memoria una vez con una tarea más liviana (ver `daily-media.md`), y no vale la pena repetir ese riesgo por un PDF. La tipografía usa las fuentes que trae pdfkit por default en vez de embeber IBM Plex Sans (la fuente real de la marca) — así no depende de que un archivo de fuente llegue bien al deploy; es un ajuste pendiente si Rodrigo quiere que coincida al pixel.

**Caveat honesto**: `pdfkit` es una librería nueva en este proyecto y, por una restricción de red de este entorno de trabajo (el registro de paquetes de npm estaba bloqueado acá), no se pudo instalar ni correr localmente para verlo generar un PDF real antes de entregarlo — solo se revisó que el código no tenga errores de sintaxis. Debería funcionar bien apenas Render corra su propio `npm install` (que sí tiene acceso normal a npm), pero vale la pena que Rodrigo mire el primer PDF que se genere después de este deploy antes de confiar en el ritmo semanal.

Si por lo que sea el PDF de una guía puntual falla al armarse o al subirse a Dropbox (por ejemplo, si `pdfkit` todavía no terminó de instalarse en un deploy), la guía en sí NUNCA se pierde: el `.md` ya quedó guardado antes de intentar el PDF, y solo esa guía puntual queda sin versión con diseño hasta que se regenere. El catálogo (`archivoPdf`) solo marca un PDF como disponible después de confirmar que la subida a Dropbox terminó bien.

## Regla nueva: citar autor si se usa una frase textual completa

Pedido explícito de Rodrigo (2/9/2026), junto con este montaje: si en algún momento una guía necesita citar una frase COMPLETA y textual de un autor o libro conocido (no una paráfrasis), esa cita se tiene que atribuir explícitamente — nombre del autor y, si aplica, el título del libro, dentro del propio texto de la guía. Fuera de esos casos puntuales, sigue aplicando la regla de siempre: nunca copiar texto ajeno sin decirlo, sintetizando con las propias palabras de Mentis. Cada guía generada guarda si usó alguna cita (y cuál) en el índice del catálogo, para que quede auditable.

## Qué NO hace todavía, a propósito

Este módulo solo arma el catálogo — el contenido, guardado en Dropbox y visible en el [panel personal](panel.md). No manda nada a nadie. Eso depende de dos piezas que todavía no existen, las dos dentro de ManyChat (Módulo 04), que Rodrigo confirmó que todavía no construyó:

- **Entrega por comentario:** cuando alguien comenta la palabra clave en una publicación, mandarle automáticamente una guía gratis.
- **Reenganche cada 15 días:** a los leads fríos (comentaron pero no llegaron a premium), mandarles una guía elegida al azar del catálogo, sin repetir nunca una guía ya enviada a ese mismo cliente — pedido explícito de Rodrigo (2/9/2026).

El catálogo guarda un `id` estable por guía justamente para que, el día que se conecte ManyChat, ese módulo solo tenga que leer esta misma lista y llevar su propio historial de qué le mandó a cada cliente — no hace falta rehacer nada de lo de acá.

## Configuración necesaria, una sola vez

En Render, cargar (además de las que ya existen):
- `GUIDES_SECRET` — un string largo y random, distinto a los demás secretos, para proteger la ruta que dispara el armado.
- `DROPBOX_GUIDES_FOLDER` — opcional, por defecto `/mentis-guias`.
- `GUIDES_PER_RUN_FREE` / `GUIDES_PER_RUN_PREMIUM` — opcional, por defecto 2 y 2 (el ritmo semanal que pidió Rodrigo).

En GitHub (`Settings → Secrets and variables → Actions`): `MENTIS_GUIDES_URL` (la URL del servidor + `/internal/weekly-guides`) y `MENTIS_GUIDES_SECRET` (el mismo valor que `GUIDES_SECRET` en Render).

Sin `GUIDES_SECRET` configurado en Render, la ruta queda completamente cerrada, igual que el resto de las rutas `/internal/*`.

## Dónde aparece el resultado

Cada guía queda en `/mentis-guias/gratis/` o `/mentis-guias/premium/` dentro del App folder de Dropbox, más el índice `guide-catalog.json` con título, categorías, fecha y si usó alguna cita. Todo esto también se ve, ya ordenado y con links para leer cada guía, en el [panel personal](panel.md).

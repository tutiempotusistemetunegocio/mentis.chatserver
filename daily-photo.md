# Carpeta de medios — Módulo 03 → elige la foto del día

Corre en paralelo a `daily-media.js` (Higgsfield), no en lugar de él: mientras el clip generado desde cero sigue bloqueado por el error de cuenta/plan de Higgsfield, esto ya funciona hoy con fotos reales que Rodrigo suba, sin depender de ninguna API externa más que la de Claude (Anthropic), que ya está conectada. `daily-photo.js` corre dentro del mismo servidor (`mentis-chat-server`, Módulo 08), expuesto como una sola ruta protegida: `POST /internal/daily-photo`.

A diferencia de Higgsfield, esto es **síncrono**: la llamada a Claude (visión y texto) responde en la misma petición, no hace falta ningún webhook.

## Los criterios de selección

El plano original dejaba esto "pendiente de definir". Definidos el 31/8/2026, en este orden:

1. **Relación temática con el ángulo del guion de hoy** — el criterio principal. Cada foto se describe una sola vez con la API de Claude (visión), y esa descripción queda guardada; el día a día solo compara el ángulo de hoy contra las descripciones ya guardadas, no vuelve a mirar la foto en sí cada vez.
2. **No repetir una foto usada en los últimos 15 días** — si la carpeta tiene pocas fotos utilizables, esta regla se relaja sola (en vez de trabar todo) hasta que haya más material.
3. **Entre las que cumplen 1 y 2, la relevancia temática decide sola** — a propósito no hay un tercer desempate por "más nueva" ni "mejor calidad": eso requeriría inventar una métrica de calidad de imagen que hoy no existe, y sería menos honesto que dejar que el ángulo del día decida.
4. **Fotos de más de 8MB no se analizan automáticamente** — se catalogan igual (para no reintentarlas cada día), pero quedan afuera de la selección hasta que Rodrigo suba una versión más liviana. Esto es a propósito: el servidor de Render tiene un techo de 512MB de memoria (se quedó sin memoria una vez esta misma semana durante pruebas — ver `daily-media.md`), y procesar imágenes gigantes ahí es justo el tipo de cosa que lo puede volver a tirar.

## Qué NO hace todavía, a propósito

- **Video**: por ahora solo evalúa fotos (`.jpg`, `.jpeg`, `.png`, `.webp`). Analizar contenido de video real necesitaría extraer frames (con algo como ffmpeg), que es mucho más trabajo y memoria — se deja para una versión futura. Los videos que Rodrigo suba a la misma carpeta se listan pero se ignoran para elegir (se cuentan en `videoSkipped` en la respuesta, para que quede visible que no se perdieron, solo que no se usan todavía).
- **Calidad de imagen evaluada automáticamente** — ver criterio 3 arriba.

## Qué hace, paso a paso

Al llamar `POST /internal/daily-photo`:

1. Trae de Dropbox el catálogo de fotos ya descritas (`photo-catalog.json`) y el historial de elecciones recientes (`photo-history.json`) — si es la primera corrida, ninguno existe todavía y arranca de cero.
2. Lista la carpeta de medios (plana, sin subcarpetas — mismo criterio que la carpeta de alimentación de libros).
3. Para las fotos nuevas o cambiadas que todavía no tienen descripción (hasta un máximo de 3 por corrida, configurable, para no pasarse de memoria ni de costo en una sola llamada), las describe con la API de Claude (visión) y guarda la descripción.
4. Busca el ángulo del guion de **hoy** (ya generado por `daily-script.js`, en `content-history.json`). Si no hay guion de hoy, no elige nada — responde `chosen: null` con el motivo.
5. Entre las fotos ya descritas y no usadas en los últimos 15 días, le pide a Mentis que elija la que mejor conecta con el ángulo de hoy.
6. Guarda la elección en el historial y lo sube a Dropbox.

Si Mentis llegara a "elegir" un nombre de archivo que no está entre las opciones válidas (alucinación), la corrida se rechaza (`ok: false`) en vez de confiar ciegamente y guardar algo incorrecto.

## Configuración necesaria, una sola vez

En Render, cargar (además de las que ya existen):
- `DROPBOX_MEDIA_FOLDER` — la carpeta de Dropbox donde Rodrigo sube sus fotos, plana (sin subcarpetas). Por defecto `/mentis-medios` si no se configura.
- `PHOTO_SECRET` — un string largo y random, distinto a los demás secretos, para proteger la ruta que dispara la elección.
- `PHOTO_MAX_NEW_PER_RUN` — opcional, cuántas fotos nuevas describir por corrida (por defecto 3).

No hace falta ninguna clave nueva de Anthropic ni de Dropbox — reutiliza `ANTHROPIC_API_KEY` y las credenciales de Dropbox, que ya están cargadas (ver README.md, sección "Conectar Dropbox (con renovación automática)").

En GitHub (`Settings → Secrets and variables → Actions`): `MENTIS_PHOTO_URL` (la URL del servidor + `/internal/daily-photo`) y `MENTIS_PHOTO_SECRET` (el mismo valor que `PHOTO_SECRET` en Render).

Sin `PHOTO_SECRET` configurado en Render, la ruta queda completamente cerrada.

## Qué tiene que hacer Rodrigo para que esto sirva de algo

Subir fotos reales a la carpeta `/mentis-medios` en Dropbox (crearla si no existe). Sin fotos ahí, cada corrida responde `chosen: null` con el motivo — no hay nada roto, simplemente no hay de dónde elegir todavía. El catálogo se arma de a poco (3 fotos nuevas por corrida por defecto), así que si sube muchas de una, va a tardar unos días en describirlas todas.

## Dónde aparece el resultado

La elección del día (qué archivo, por qué) queda en la respuesta de la llamada y en `photo-history.json` dentro de la misma carpeta de medios — no mueve ni copia la foto elegida, Rodrigo la toma directamente de `/mentis-medios/<nombre>` al armar el reel a mano.

## Lo que falta para que este paso quede completo

- **Armado final del reel**: esto elige UNA foto — no arma el video ni lo combina con el clip de Higgsfield (cuando ese esté disponible). El armado sigue siendo manual por ahora.
- **Análisis de video**: como se explica arriba, los videos subidos a la carpeta se listan pero no se evalúan todavía.

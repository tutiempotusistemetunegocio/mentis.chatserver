# Publicar en Instagram — Módulo 03 → buffer-publish.js

Publica en Instagram, como borrador. Implementado igual que el resto de las tareas: la lógica vive en `buffer-publish.js`, corriendo dentro del mismo servidor (`mentis-chat-server`, Módulo 08).

**Dos caminos independientes** (agregado 8/9/2026, después de una confusión real con Rodrigo que vale la pena dejar escrita):

- **El REEL (el que importa de verdad)**: mientras Higgsfield siga sin funcionar por API (ver `daily-media.md`), el video no lo arma el sistema — lo arma Rodrigo a mano, usando el ángulo del guion del día como base. Este módulo NO vuelve a elegir nada: solo espera a que Rodrigo suba el reel ya terminado a una carpeta de Dropbox, y lo toma de ahí tal cual. Ver la sección "Camino del reel" más abajo.
- **La foto (opcional, el original de esta entrega)**: publica la foto que `daily-photo.js` eligió automáticamente de una carpeta de fotos sueltas. Rodrigo no tiene por qué usar este camino — no hace falta subir nada a esa carpeta si no lo querés.

La razón de por qué existían los dos: la primera versión de este módulo asumía que el sistema iba a elegir una foto automáticamente porque Higgsfield (que generaría el video) todavía estaba pausado. Rodrigo aclaró (8/9/2026): "tenemos que hacer el video manualmente... cuando hago el video en Higgsfield, no le veo la ciencia [al paso de elegir foto]" — con razón: si él ya arma el video a mano usando el ángulo del día, pedirle al sistema que ADEMÁS elija una foto por su cuenta no aporta nada. El camino del reel es la corrección de eso.

## Por qué Buffer y no Metricool

El plano original (`higgsfield-metricool-preparacion.md`) tenía pensado Metricool para esta parte. Investigando su documentación real se confirmó que el plan gratis y el Starter (~$20/mes) **no incluyen acceso a la API** — recién arranca en el plan Advanced, ~$53/mes. Rodrigo pidió alternativas gratis (6/9/2026) y, después de comparar varias contra su documentación oficial (no reseñas de terceros), Buffer fue la que mejor encajaba: plan gratis con API incluida (3.000 llamadas/mes), autenticación simple con una clave personal (nada de OAuth), y soporte directo para publicar en Instagram y traer métricas básicas.

**Limitación honesta que hay que tener presente**: las métricas que expone la API de Buffer para Instagram son reactions (likes), comentarios, compartidos, guardados y nuevos seguidores — no expone "vistas". El plano original pensaba juzgar el "ángulo ganador" con vistas/comentarios/compartidos (ver `nexo-portal`/Módulo 07 en el plano); con Buffer, vistas queda afuera de lo que se puede medir automáticamente. No cambia nada de lo ya construido, pero conviene saberlo antes de diseñar esa parte.

## Camino del reel (el que usa Rodrigo)

1. Cada mañana, `daily-script.js` ya genera el ángulo/guion del día (esto no cambia).
2. Rodrigo arma el video a mano — en la app de Higgsfield o donde sea — usando ese ángulo como base.
3. Rodrigo sube el reel terminado a la carpeta de Dropbox `DROPBOX_REEL_READY_FOLDER` (por defecto `/mentis-reel-listo`), plana, sin subcarpetas propias (la subcarpeta `publicados/` la crea el sistema solo, no hay que crearla a mano).
4. Rodrigo dispara `POST /internal/publish-reel` (a mano desde GitHub Actions, "Run workflow", apenas sube el video — no hace falta esperar ningún horario) o lo deja para el cron diario, que es solo una red de contención por si se olvida.
5. El sistema toma el video más viejo esperando en esa carpeta (si subió varios, se publican de a uno por corrida, en el orden en que los subió), arma un borrador en Buffer con ese video, y **mueve el archivo a `publicados/`** para no volver a tomarlo al día siguiente.

**Cómo se arma el texto del post**: si el archivo se llama con la fecha adelante (ej. `2026-09-08.mp4`), el sistema busca el guion de ESE día exacto en el historial y usa su caption — así el texto corresponde de verdad al video, aunque Rodrigo lo suba días después de haber visto el ángulo. Si el archivo no trae esa fecha, o no hay guion guardado para ese día, se usa el guion "reel" más reciente que haya, y la respuesta trae un aviso (`warning`) explicándolo — como de cualquier forma queda como borrador (ver más abajo), Rodrigo lo revisa en Buffer antes de que salga.

**Por qué transmite el video en vivo (streaming) en vez de cargarlo a memoria primero**: una foto pesa unos pocos MB, pero un video puede pesar bastante más — y este mismo proyecto ya se quedó sin memoria una vez en una corrida real con el límite de 512MB del plan gratis de Render (ver `daily-media.js`). `GET /internal/reel-proxy/...` va pasando los bytes de Dropbox directo hacia Buffer a medida que llegan, sin juntarlos enteros en la memoria del servidor en ningún momento.

## Camino de la foto (opcional)

Publica la **foto** que `daily-photo.js` elige automáticamente entre las que Rodrigo sube a una carpeta plana de fotos sueltas (`DROPBOX_MEDIA_FOLDER`) — pensado originalmente como reemplazo del video mientras Higgsfield no funcionaba por API. Sigue funcionando y sigue siendo útil si algún día Rodrigo quiere publicar una foto suelta sin pasar por todo el proceso del reel, pero no hace falta tocarlo ni subir nada a esa carpeta si no lo va a usar.

**No trae métricas todavía.** Ese es un paso aparte, no construido en esta entrega — quedó documentado como el límite honesto de arriba para cuando se construya.

## Por qué queda como borrador, no publicación automática

Decisión mía, no un pedido puntual de Rodrigo — la explico porque es la única parte del sistema que sale hacia afuera, en vivo, frente a gente real. Un guion o una guía mal generados quedan guardados en Dropbox hasta que alguien los revisa; una foto con un caption raro publicada directo en Instagram ya salió, la vio gente, y no hay forma de deshacerlo del todo. Por eso `publishDailyPhoto()` crea el post en Buffer con `saveToDraft: true` — queda esperando en la app de Buffer (o en su panel web) para que Rodrigo lo revise y lo publique él mismo con un toque. Si con el tiempo esto genera confianza, sacar el `saveToDraft` es un cambio de una línea en `buffer-publish.js`.

## Cómo funciona, en orden

1. Lee `photo-history.json` (que ya generó `daily-photo.js`) y busca la elección de hoy — si no hay ninguna (fin de semana, día de carrusel, o `daily-photo.js` no corrió), no hace nada.
2. Lee `content-history.json` para armar el texto del post: usa `captionText`/`captionTextParte2` (el gancho, ya escrito en español por Mentis) + `cta` (la invitación a comentar la palabra clave) — son los mismos campos que ya escribe `daily-script.js`, no se le pide a Mentis un texto nuevo para esto.
3. Arma una URL pública apuntando a la propia foto (`/internal/photo-proxy/<secreto>/<archivo>`) — la API de Buffer exige una URL desde la que descargar la imagen, no acepta que se le manden los bytes directo (confirmado contra la documentación).
4. Llama a la API de Buffer (mutation `createPost`, con `saveToDraft: true`) apuntando al canal de Instagram configurado.

## La API de Buffer es GraphQL, no REST

Un solo endpoint (`https://api.buffer.com`), todo viaja como una mutation/query de texto en el body — confirmado leyendo `developers.buffer.com` directamente, no asumido. La autenticación es una clave personal que se genera a mano en Buffer (Configuración → API), enviada como `Authorization: Bearer <clave>` — mismo patrón simple que ya se usa con Higgsfield/Dropbox.

## Configuración necesaria (una sola vez)

1. **Crear la cuenta gratis en Buffer** y conectar el Instagram — tiene que ser cuenta **Business o Creator**, no personal (si es personal, Buffer solo manda una notificación al celular en vez de poder publicar solo — se cambia desde la app de Instagram, Configuración → cambiar a cuenta profesional). **Confirmado funcionando por Rodrigo (7/9/2026)**, incluyendo un bache real: tener cuenta en Buffer no alcanza, el Instagram hay que conectarlo aparte, DENTRO de la app de Buffer (Channels → Connect Channel → Instagram).
2. **Generar la clave personal**: Buffer → Configuración → API → crear clave → copiarla a `BUFFER_ACCESS_TOKEN` en Render.
3. **Cargar `BUFFER_SECRET`** en Render (un string largo y random, distinto a los demás secretos) — protege las cinco rutas de este módulo.
4. **Encontrar el channelId de Instagram**: con `BUFFER_ACCESS_TOKEN` y `BUFFER_SECRET` ya cargados en Render, llamar una vez a `GET /internal/buffer-channels` (header `x-buffer-secret: <BUFFER_SECRET>`) — devuelve la lista de canales conectados; copiar el `id` del que tenga `service: "instagram"` a `BUFFER_INSTAGRAM_CHANNEL_ID` en Render. **Confirmado funcionando (7/9/2026)**.
5. **GitHub Actions**: tres secrets — `MENTIS_BUFFER_URL` (la URL del servidor + `/internal/publish-photo`, solo si se va a usar el camino opcional de la foto), `MENTIS_BUFFER_REEL_URL` (la URL del servidor + `/internal/publish-reel`, el que de verdad importa) y `MENTIS_BUFFER_SECRET` (el mismo valor que `BUFFER_SECRET` en Render, sirve para los dos).

## Cómo se dispara

- **Reel**: sin horario fijo — se dispara a mano desde Actions ("Run workflow" en "Publicar reel en Buffer") apenas Rodrigo sube el video, más un cron diario a las 18:00 UTC como red de contención por si se olvida de dispararlo a mano.
- **Foto (opcional)**: automático todos los días a las 10:50 UTC, 10 minutos después de que corre "Foto diaria de Mentis".

## Lo que falta (honesto)

- **El camino del reel no está probado todavía contra una corrida real** (mismo caveat de siempre con código nuevo escrito fuera del entorno de despliegue): la sintaxis está verificada, la mutation de video está armada exactamente como muestra el ejemplo oficial de Buffer (`developers.buffer.com/examples/create-video-post.html`), y el streaming se probó que existe en este Node — pero la confirmación real recién va a llegar cuando Rodrigo suba un video de verdad y dispare `publish-reel`.
- **El camino de la foto sí está confirmado** (Rodrigo probó `buffer-channels` en vivo el 7/9/2026 y funcionó) pero todavía no publicó ninguna foto real — falta subir fotos a `/mentis-medios` para probarlo de punta a punta, si es que lo va a usar.
- Traer **métricas** de los posts ya publicados (reactions/comentarios/compartidos/guardados/seguidores — sin vistas, ver la limitación de arriba) para empezar a alimentar la lógica de "ángulo ganador" del plano.
- Sacar el `saveToDraft` para que publique solo, si Rodrigo decide que ya confía en el paso de borrador.
- El `thumbnailOffset` del reel (qué instante del video usar como miniatura) no se está mandando — Buffer lo confirma como opcional, así que por ahora elige la miniatura sola; si Rodrigo quiere elegirla, es un cambio chico en `publishDailyReel()`.

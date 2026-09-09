# Publicar en Instagram — Módulo 03 → buffer-publish.js

Publica el reel del día en Instagram, como borrador. Implementado igual que el resto de las tareas: la lógica vive en `buffer-publish.js`, corriendo dentro del mismo servidor (`mentis-chat-server`, Módulo 08).

**Un solo camino, el del reel** — este módulo tuvo antes un segundo camino de foto (publicaba automáticamente una foto suelta elegida por `daily-photo.js`), pero Rodrigo pidió sacarlo del todo (9/9/2026: "Toda la foto no es necesario, puedes eliminarlo. No quiero fotos."). Junto con eso se sacó `daily-photo.js`, su documentación y sus dos workflows de GitHub Actions (`daily-photo.yml` y `publish-photo.yml`) — si hace falta alguno de vuelta, está en el historial de git.

Mientras Higgsfield siga sin funcionar por API (ver `daily-media.md`), el video no lo arma el sistema — lo arma Rodrigo a mano, usando el ángulo del guion del día como base. Este módulo NO elige nada: solo espera a que Rodrigo suba el reel ya terminado a una carpeta de Dropbox, y lo toma de ahí tal cual.

## Por qué Buffer y no Metricool

El plano original (`higgsfield-metricool-preparacion.md`) tenía pensado Metricool para esta parte. Investigando su documentación real se confirmó que el plan gratis y el Starter (~$20/mes) **no incluyen acceso a la API** — recién arranca en el plan Advanced, ~$53/mes. Rodrigo pidió alternativas gratis (6/9/2026) y, después de comparar varias contra su documentación oficial (no reseñas de terceros), Buffer fue la que mejor encajaba: plan gratis con API incluida (3.000 llamadas/mes), autenticación simple con una clave personal (nada de OAuth), y soporte directo para publicar en Instagram y traer métricas básicas.

**Limitación honesta que hay que tener presente**: las métricas que expone la API de Buffer para Instagram son reactions (likes), comentarios, compartidos, guardados y nuevos seguidores — no expone "vistas". El plano original pensaba juzgar el "ángulo ganador" con vistas/comentarios/compartidos (ver `nexo-portal`/Módulo 07 en el plano); con Buffer, vistas queda afuera de lo que se puede medir automáticamente. No cambia nada de lo ya construido, pero conviene saberlo antes de diseñar esa parte.

## Cómo funciona, en orden

1. Cada mañana, `daily-script.js` ya genera el ángulo/guion del día (esto no cambia).
2. Rodrigo arma el video a mano — en la app de Higgsfield o donde sea — usando ese ángulo como base.
3. Rodrigo sube el reel terminado a la carpeta de Dropbox `DROPBOX_REEL_READY_FOLDER` (por defecto `/mentis-reel-listo`), plana, sin subcarpetas.
4. Rodrigo dispara `POST /internal/publish-reel` (a mano desde GitHub Actions, "Run workflow", apenas sube el video — no hace falta esperar ningún horario) o lo deja para el cron diario, que es solo una red de contención por si se olvida.
5. El sistema toma el video más viejo esperando en esa carpeta que todavía no esté en el historial (si subió varios, se publican de a uno por corrida, en el orden en que los subió), arma un borrador en Buffer con ese video, y anota el nombre en `historial-publicados.json` (misma carpeta) para no volver a tomarlo mañana.

**Por qué el archivo NO se mueve ni se borra después de publicarlo** (cambio real, 9/9/2026): la primera versión SÍ lo movía a una subcarpeta `publicados/` apenas Buffer aceptaba el post. Pero Buffer sigue pidiendo el video desde nuestra URL después de ese momento — para armar el preview en su propia app, y de nuevo al publicarlo de verdad en Instagram (que con "Next Available" puede ser minutos después, no inmediato). Como el archivo ya se había movido, esos pedidos posteriores fallaban con "no encontrado", y el reel le llegaba roto a Buffer aunque el video original nunca tuvo nada malo — Rodrigo lo confirmó a mano moviendo el archivo de vuelta al origen, y ahí sí funcionó. Por eso ahora el archivo se queda donde Rodrigo lo subió, indefinidamente; el historial es lo único que evita que se vuelva a publicar solo. Rodrigo puede borrar del todo los videos ya confirmados en Instagram cuando quiera, a mano, sin apuro.

**Cómo se arma el texto del post**: si el archivo se llama con la fecha adelante (ej. `2026-09-08.mp4`), el sistema busca el guion de ESE día exacto en el historial y usa su caption (`captionText`/`captionTextParte2` + `cta`, los mismos campos que ya escribe `daily-script.js` — no se le pide a Mentis un texto nuevo para esto) — así el texto corresponde de verdad al video, aunque Rodrigo lo suba días después de haber visto el ángulo. Si el archivo no trae esa fecha, o no hay guion guardado para ese día, se usa el guion "reel" más reciente que haya, y la respuesta trae un aviso (`warning`) explicándolo — como de cualquier forma queda como borrador (ver más abajo), Rodrigo lo revisa en Buffer antes de que salga.

**Por qué se baja el video entero a memoria antes de mandarlo, no en vivo (streaming)**: la primera versión SÍ transmitía en vivo, para cuidar el límite de 512MB del plan gratis de Render (que este mismo proyecto ya sufrió una vez, ver `daily-media.js`). Se probó tres veces con un reel real y las tres veces el video llegó roto — a Buffer y hasta pidiéndolo directo desde el navegador — mientras que el archivo original siempre reprodujo perfecto en la Mac de Rodrigo (9/9/2026). El problema estaba en el streaming en sí, no en el archivo. Un reel real pesa unos pocos MB, muy lejos de los 512MB, así que bajarlo entero es seguro — `MAX_VIDEO_BYTES` protege el caso de que alguien suba, por error, un archivo enorme sin comprimir.

**Cómo se le manda el video a Buffer**: `createPost` con el asset como `{ video: { url } }`, apuntando a una URL propia (`/internal/reel-proxy/<secreto>/<archivo>`) — la API de Buffer exige una URL pública desde la que descargar el archivo, no acepta que se le manden los bytes directo (confirmado contra `developers.buffer.com/examples/create-video-post.html`). También exige `metadata.instagram.type` (acá siempre `reel`) y `metadata.instagram.shouldShareToFeed` (en `true`, para que además del feed de Reels aparezca en el feed principal) — ningún ejemplo genérico de la doc lo menciona, hubo que ir al tipo `InstagramPostMetadataInput` para encontrarlo.

## La API de Buffer es GraphQL, no REST

Un solo endpoint (`https://api.buffer.com`), todo viaja como una mutation/query de texto en el body — confirmado leyendo `developers.buffer.com` directamente, no asumido. La autenticación es una clave personal que se genera a mano en Buffer (Configuración → API), enviada como `Authorization: Bearer <clave>` — mismo patrón simple que ya se usa con Higgsfield/Dropbox.

## Por qué queda como borrador, no publicación automática

Decisión mía, no un pedido puntual de Rodrigo — la explico porque es la única parte del sistema que sale hacia afuera, en vivo, frente a gente real. Un guion o una guía mal generados quedan guardados en Dropbox hasta que alguien los revisa; un reel con un caption raro publicado directo en Instagram ya salió, la vio gente, y no hay forma de deshacerlo del todo. Por eso `publishDailyReel()` crea el post en Buffer con `saveToDraft: true` — queda esperando en la app de Buffer (o en su panel web) para que Rodrigo lo revise y lo publique él mismo con un toque. Si con el tiempo esto genera confianza, sacar el `saveToDraft` es un cambio de una línea en `buffer-publish.js`.

## Configuración necesaria (una sola vez)

1. **Crear la cuenta gratis en Buffer** y conectar el Instagram — tiene que ser cuenta **Business o Creator**, no personal (si es personal, Buffer solo manda una notificación al celular en vez de poder publicar solo — se cambia desde la app de Instagram, Configuración → cambiar a cuenta profesional). **Confirmado funcionando por Rodrigo (7/9/2026)**, incluyendo un bache real: tener cuenta en Buffer no alcanza, el Instagram hay que conectarlo aparte, DENTRO de la app de Buffer (Channels → Connect Channel → Instagram).
2. **Generar la clave personal**: Buffer → Configuración → API → crear clave → copiarla a `BUFFER_ACCESS_TOKEN` en Render.
3. **Cargar `BUFFER_SECRET`** en Render (un string largo y random, distinto a los demás secretos) — protege las tres rutas de este módulo.
4. **Encontrar el channelId de Instagram**: con `BUFFER_ACCESS_TOKEN` y `BUFFER_SECRET` ya cargados en Render, llamar una vez a `GET /internal/buffer-channels` (header `x-buffer-secret: <BUFFER_SECRET>`) — devuelve la lista de canales conectados; copiar el `id` del que tenga `service: "instagram"` a `BUFFER_INSTAGRAM_CHANNEL_ID` en Render. **Confirmado funcionando (7/9/2026)**.
5. **GitHub Actions**: dos secrets — `MENTIS_BUFFER_REEL_URL` (la URL del servidor + `/internal/publish-reel`) y `MENTIS_BUFFER_SECRET` (el mismo valor que `BUFFER_SECRET` en Render).

## Cómo se dispara

Sin horario fijo — se dispara a mano desde Actions ("Run workflow" en "Publicar reel en Buffer") apenas Rodrigo sube el video, más un cron diario a las 18:00 UTC como red de contención por si se olvida de dispararlo a mano.

## Confirmado funcionando de punta a punta (9/9/2026)

Rodrigo subió un reel de prueba, corrió el workflow, y el reel apareció publicado correctamente en su Instagram — video, audio y caption bien. En el camino se encontraron y corrigieron varios bugs reales (documentados arriba y en los comentarios de `buffer-publish.js`): el campo `metadata.instagram.type` faltante, la corrupción del video al transmitirlo en vivo, y el bug del archivo movido antes de tiempo.

## Lo que falta (honesto)

- Traer **métricas** de los posts ya publicados (reactions/comentarios/compartidos/guardados/seguidores — sin vistas, ver la limitación de arriba) para empezar a alimentar la lógica de "ángulo ganador" del plano.
- Sacar el `saveToDraft` para que publique solo, si Rodrigo decide que ya confía en el paso de borrador.
- El `thumbnailOffset` del reel (qué instante del video usar como miniatura) no se está mandando — Buffer lo confirma como opcional, así que por ahora elige la miniatura sola; si Rodrigo quiere elegirla, es un cambio chico en `publishDailyReel()`.

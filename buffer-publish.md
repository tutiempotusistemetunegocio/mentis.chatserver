# Publicar en Instagram — Módulo 03 → buffer-publish.js

Publica en Instagram, como borrador, la foto que `daily-photo.js` ya eligió para el ángulo del día. Implementado igual que el resto de las tareas: la lógica vive en `buffer-publish.js`, corriendo dentro del mismo servidor (`mentis-chat-server`, Módulo 08).

## Por qué Buffer y no Metricool

El plano original (`higgsfield-metricool-preparacion.md`) tenía pensado Metricool para esta parte. Investigando su documentación real se confirmó que el plan gratis y el Starter (~$20/mes) **no incluyen acceso a la API** — recién arranca en el plan Advanced, ~$53/mes. Rodrigo pidió alternativas gratis (6/9/2026) y, después de comparar varias contra su documentación oficial (no reseñas de terceros), Buffer fue la que mejor encajaba: plan gratis con API incluida (3.000 llamadas/mes), autenticación simple con una clave personal (nada de OAuth), y soporte directo para publicar en Instagram y traer métricas básicas.

**Limitación honesta que hay que tener presente**: las métricas que expone la API de Buffer para Instagram son reactions (likes), comentarios, compartidos, guardados y nuevos seguidores — no expone "vistas". El plano original pensaba juzgar el "ángulo ganador" con vistas/comentarios/compartidos (ver `nexo-portal`/Módulo 07 en el plano); con Buffer, vistas queda afuera de lo que se puede medir automáticamente. No cambia nada de lo ya construido, pero conviene saberlo antes de diseñar esa parte.

## Qué hace hoy (a propósito, acotado)

Publica la **foto** del día — no depende de Higgsfield (que sigue pausado). El día que Higgsfield esté confirmado funcionando, este mismo módulo se puede extender para publicar el video en vez de (o además de) la foto — la arquitectura ya está pensada para eso (el mismo truco de URL pública serviría para un video).

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

1. **Crear la cuenta gratis en Buffer** y conectar el Instagram — tiene que ser cuenta **Business o Creator**, no personal (si es personal, Buffer solo manda una notificación al celular en vez de poder publicar solo — se cambia desde la app de Instagram, Configuración → cambiar a cuenta profesional).
2. **Generar la clave personal**: Buffer → Configuración → API → crear clave → copiarla a `BUFFER_ACCESS_TOKEN` en Render.
3. **Cargar `BUFFER_SECRET`** en Render (un string largo y random, distinto a los demás secretos) — protege las tres rutas de este módulo.
4. **Encontrar el channelId de Instagram**: con `BUFFER_ACCESS_TOKEN` y `BUFFER_SECRET` ya cargados en Render, llamar una vez a `GET /internal/buffer-channels` (header `x-buffer-secret: <BUFFER_SECRET>`) — devuelve la lista de canales conectados; copiar el `id` del que tenga `service: "instagram"` a `BUFFER_INSTAGRAM_CHANNEL_ID` en Render.
5. **GitHub Actions**: dos secrets nuevos — `MENTIS_BUFFER_URL` (la URL del servidor + `/internal/publish-photo`) y `MENTIS_BUFFER_SECRET` (el mismo valor que `BUFFER_SECRET` en Render).

## Cómo se dispara

Automático todos los días a las 10:50 UTC (`.github/workflows/publish-photo.yml`), 10 minutos después de que corre "Foto diaria de Mentis" — le da tiempo a que esa corrida termine y guarde su elección en Dropbox antes de que esta la lea. También se puede disparar a mano desde la pestaña Actions con "Run workflow", por ejemplo para probarlo el primer día sin esperar al cron.

## Lo que falta (honesto)

- **No probado todavía contra una corrida real** (mismo caveat de siempre con código nuevo escrito fuera del entorno de despliegue): la sintaxis está verificada y la mutation de Buffer está armada exactamente como muestran sus ejemplos oficiales, pero la confirmación real es la primera vez que Rodrigo tenga `BUFFER_ACCESS_TOKEN`/`BUFFER_INSTAGRAM_CHANNEL_ID` cargados y dispare el workflow a mano.
- Publicar el **video** (no solo la foto) cuando Higgsfield esté confirmado funcionando.
- Traer **métricas** de los posts ya publicados (reactions/comentarios/compartidos/guardados/seguidores — sin vistas, ver la limitación de arriba) para empezar a alimentar la lógica de "ángulo ganador" del plano.
- Sacar el `saveToDraft` para que publique solo, si Rodrigo decide que ya confía en el paso de borrador.

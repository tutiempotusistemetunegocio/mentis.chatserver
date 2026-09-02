# Video diario — Módulo 03 → clip generado con Higgsfield

## Historial del 404 persistente — resuelto, falta la última confirmación

Después de ida y vuelta con soporte de Higgsfield sobre un 404 que no se iba, se confirmó la causa real mirando directamente el dashboard de la cuenta (`cloud.higgsfield.ai`): la API de Higgsfield es una plataforma separada del plan de la web, y la cuenta de Rodrigo nunca había activado esa parte — 0 créditos, y los únicos dos modelos habilitados eran Soul 2 y Soul Cinema, los dos de generación de imagen, ninguno de video. Por eso todo pedido fallaba, sin importar qué modelo de video se pidiera.

**Actualización (2/9/2026): Rodrigo pasó a Higgsfield Plus** (1.200 créditos/mes, acceso completo a los modelos Seedance) — eso resuelve la falta de plan. Se actualizó `HIGGSFIELD_MODEL_PATH` en `daily-media.js` a la ruta "pro/fast" en vez de "lite" (con el caveat completo, escrito en el propio código: es la lectura más razonable de la documentación pública de la API, ya que ahí no aparece ninguna ruta separada para los nombres de marketing "Seedance 2.5"/"Seedance 2.0" que muestra el panel de precios — no es algo ya confirmado contra la cuenta real).

Por eso el cron diario sigue apagado un paso más, a propósito: hace falta un "Run workflow" manual desde GitHub Actions que confirme que ya no da 404 antes de prender el cron de nuevo — así, si el modelo elegido no fuera el correcto, es un solo intento fallido en vez de toda una semana de runs rojos. Una vez confirmado, se descomenta la línea de `schedule` en `daily-media.yml` y queda corriendo solo como el resto de las tareas diarias.

Sigue al guion diario (`daily-script.js`): una vez que el guion del día está escrito y guardado, `daily-media.js` le pide a Higgsfield un clip de video corto basado en el ángulo de ese guion. Corre dentro del mismo servidor (`mentis-chat-server`, Módulo 08), expuesto como dos rutas protegidas: `POST /internal/daily-media` (dispara el pedido) y `POST /webhook/higgsfield-listo/<secreto>/<fecha>` (recibe el aviso cuando el clip está listo).

## Una salvedad honesta: esto genera un clip corto, no el reel completo

La documentación real de Higgsfield (consultada el 31/8/2026, y revisada de nuevo el 2/9/2026 contra el spec público de la API) confirma que **ningún modelo genera un video de 60 segundos de una sola vez** — Seedance acepta como máximo 12 segundos por pedido, es un límite de la plataforma, no algo que se pueda subir desde acá. Por decisión de Rodrigo (31/8/2026), esta primera versión pide un solo clip corto (ahora 12 segundos, el máximo, vertical) para usar como gancho/portada — no arma el reel completo. El armado final (varios clips, la carpeta de medios existente, edición) es un paso posterior, todavía no construido.

**Pedido de Rodrigo (2/9/2026) de clips de 20-25 segundos**: no es posible como un solo pedido a Higgsfield, por el límite de 12s de arriba. Para llegar a esa duración total hacen falta dos clips (por ejemplo 12s + 12s) unidos en un solo archivo de video — eso es edición/concatenación (típicamente con `ffmpeg`), que hoy no existe en el sistema y es una construcción aparte, no un ajuste de una línea. Además de la complejidad, duplica el costo en créditos de Higgsfield por "video" (dos pedidos en vez de uno) y suma un paso de procesamiento de video en el servidor — justo el tipo de trabajo pesado que ya causó el problema de memoria documentado más abajo (Render free tier, 512MB). **Decisión de Rodrigo (2/9/2026): nos quedamos con 12 segundos** — no se construye la edición/concatenación por ahora.

**El guion ya sabe del límite de 12s** (pedido explícito de Rodrigo, mismo día): en vez de que acá se agarre el ángulo corto del guion (pensado como etiqueta de un guion narrado de 30-60s) y se lo use tal cual como si fuera una escena filmable, ahora `daily-script.js` le pide a Mentis una `escenaVisual` aparte — un solo momento concreto, en inglés, pensado a propósito para caber en 12 segundos mudos — y `buildVisualPrompt()` acá usa ese campo cuando existe. Las entradas del historial generadas antes de este cambio no tienen `escenaVisual` guardada, así que para esas se sigue usando el ángulo corto como respaldo (funciona, solo que menos afinado para el límite de 12s). Ver `daily-script.md`.

**También pedido (2/9/2026): captions y música de fondo, sin voz.** "Sin voz" ya es el comportamiento por defecto — Seedance no agrega diálogo ni narración a menos que se le dé un audio de entrada, y el prompt ahora lo pide explícitamente (`silent footage, no dialogue, no voiceover`). Pero **los captions (texto en pantalla) y la música NO los genera Higgsfield a partir del prompt** — son un paso de edición aparte (superponer el texto del guion como subtítulos, mezclar una pista de música), tampoco construido todavía. Mismo comentario que arriba: es una construcción nueva, no un cambio de prompt.

**Cuántos videos por mes con el plan Plus**: no hay una tabla pública de "créditos por segundo" en la documentación de Higgsfield — el costo depende del modelo y los parámetros, y no lo publican en detalle. El panel de precios de Higgsfield estima ~53 videos Seedance 2.0/mes con 1.200 créditos, pero esa cifra asume la duración por defecto de la API (5s), no los 12s que se piden acá — con clips más largos, cada uno consume más créditos, así que el número real de videos/mes con clips de 12s va a ser menor a 53. Para saber el número exacto: generar algunos clips reales y mirar la pestaña "Usage" de `cloud.higgsfield.ai`, que sí muestra el consumo real por generación.

**Ahora se guarda el prompt de cada video** (pedido explícito de Rodrigo, "no veo el prompt del video"): antes se armaba y se mandaba a Higgsfield sin dejar rastro visible en ningún lado. Ahora cada pedido queda registrado en `video-history.json` (mismo patrón que `content-history.json`/`photo-history.json`) y aparece en el [panel personal](panel.md), con el ángulo del guion y el texto exacto que se le mandó a la IA.

También, por ahora, esto solo actúa cuando el guion del día fue de tipo **reel** — un carrusel es slides/imágenes, no video, así que en esos días no se pide ningún clip.

## Qué hace, paso a paso

1. **`POST /internal/daily-media`** (disparado por GitHub Actions, después de que corrió el guion diario):
   - Trae el historial de contenido más reciente de Dropbox.
   - Busca la entrada de hoy con `tipo: "reel"`. Si no hay (fin de semana, carrusel, o el guion diario todavía no corrió), no pide nada — responde `submitted: false` con el motivo.
   - Si hay, arma un prompt visual corto a partir del ángulo del guion y le pide a Higgsfield un clip vertical de 10s (modelo Seedance Pro Fast — cambiar de modelo es una línea en `daily-media.js`).
   - Responde con el `request_id` del pedido. El clip en sí todavía no está listo en este momento — Higgsfield tarda en generarlo.

2. **`POST /webhook/higgsfield-listo/<secreto>/<fecha>`** (Higgsfield llama acá solo cuando termina):
   - Si el clip salió bien (`status: "completed"`), lo descarga de la URL que da Higgsfield y lo sube a Dropbox como `<fecha>-clip.mp4`, junto a los guiones del mismo día.
   - Si falló o fue rechazado por moderación de contenido (`failed`/`nsfw`), no rompe nada — Rodrigo sigue teniendo el guion en texto, solo no hay clip ese día.

## Por qué el secreto va en la URL, no en un header

Igual que con los webhooks de Systeme.io: la documentación de Higgsfield no tiene ningún mecanismo propio para firmar o verificar que el aviso vino realmente de ellos, y nunca manda headers propios — solo se le puede pasar una URL de destino (`hf_webhook`). Por eso el secreto (`HIGGSFIELD_WEBHOOK_SECRET`) y la fecha del pedido viajan como segmentos de esa misma URL.

## Configuración necesaria, una sola vez

En Render, cargar cuatro variables nuevas:
- `HIGGSFIELD_KEY_ID` y `HIGGSFIELD_KEY_SECRET` — el par de claves que se generan en [cloud.higgsfield.ai](https://cloud.higgsfield.ai).
- `HIGGSFIELD_WEBHOOK_SECRET` — un string largo y random, inventado por nosotros (no lo da Higgsfield), para proteger el webhook de avisos falsos.
- `MEDIA_SECRET` — otro string largo y random, distinto a los demás, para proteger la ruta que dispara el pedido.

En GitHub (`Settings → Secrets and variables → Actions`): `MENTIS_MEDIA_URL` (la URL del servidor + `/internal/daily-media`) y `MENTIS_MEDIA_SECRET` (el mismo valor que `MEDIA_SECRET` en Render).

Sin `MEDIA_SECRET` configurado en Render, la ruta de disparo queda completamente cerrada. Sin `HIGGSFIELD_WEBHOOK_SECRET`, el webhook de aviso también queda cerrado — nada se genera hasta que las cuatro variables estén cargadas.

## Dónde aparece el resultado

El clip queda en la misma carpeta `/mentis-contenido` de Dropbox donde ya están los guiones — `<fecha>-clip.mp4`, junto a `<fecha>-reel.md`.

## Lo que falta para que este paso quede completo

- **Armado del reel completo**: hoy esto entrega un clip corto de gancho, no el video final montado — falta la edición (varios clips + carpeta de medios + texto en pantalla).
- **Carpeta de medios**: el plano prevé que el sistema también elija material ya existente de una carpeta que Rodrigo va llenando — no construido todavía.
- **Control de calidad pre-publicación**: analizar el clip ya generado y decidir si tiene potencial antes de usarlo — depende de que el armado final exista primero.

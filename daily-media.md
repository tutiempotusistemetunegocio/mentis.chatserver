# Video diario — Módulo 03 → clip generado con Higgsfield

## Actualización (3/9/2026): contenido del prompt reordenado, foto del día conectada, música/captions siguen sin construir

Tres pedidos de Rodrigo en el mismo mensaje, tratados por separado:

**1. "El prompt solo dice de las cámaras, no veo el contenido"** — cierto: `buildVisualPrompt()` armaba el prompt con dos bloques de lenguaje técnico de cámara/cinematografía (uno antes, uno después) y la `escenaVisual` (el contenido temático real, escrito por Mentis) quedaba metida en el medio, más fácil de pasar por alto al leerlo. Corregido en dos lugares:
- `daily-script.js`: la instrucción que le da a Mentis para escribir `escenaVisual` ahora pide explícitamente una ACCIÓN CONCRETA relacionada al ángulo de hoy (no solo un ambiente/mood), con un ejemplo de qué significa eso.
- `daily-media.js`: `buildVisualPrompt()` ahora arranca siempre con `escenaVisual` (el contenido) y deja el lenguaje de estilo/cámara/calidad como modificador al final, no al revés. No cambia lo que se le pide a Higgsfield en el fondo, cambia el orden y el peso relativo.

**2. "El reel siempre trabaje con una foto mía o una cualquiera"** — construido: `daily-photo.js` (Módulo 03, ya elegía la foto del día para uso manual) corre antes que este módulo (10:40 UTC vs. 10:45). `daily-media.js` ahora busca esa elección en `photo-history.json` y, si hay una foto para hoy, le pide a Higgsfield el clip con el endpoint **image-to-video** de Seedance Pro Fast (confirmado en la documentación pública: mismos parámetros que texto-a-video, más un `image_url` obligatorio) en vez de texto-a-video puro — usando un link temporal de Dropbox (`files/get_temporary_link`, válido 4h) para que Higgsfield pueda bajar la foto sin que haga falta subirla a ningún lado. Si por lo que sea no hay foto de hoy (todavía no se subió ninguna a la carpeta de medios, `daily-photo.js` no corrió, o falla el link temporal), sigue funcionando como antes (texto-a-video) — nunca bloquea el pedido. El panel ahora muestra qué foto se usó (o si no se usó ninguna) junto a cada prompt.

**3. "Música y captions, el sistema lo puede hacer con Higgsfield"** — la primera vuelta de esto decía que no, en base a la documentación pública de la **API** (`docs.higgsfield.ai/docs/openapi.json`), que confirmado de nuevo no tiene ningún endpoint de audio, subtítulos ni superposición de texto: la API solo genera el clip mudo, sin texto.

**Corrección (3/9/2026, aclaración de Rodrigo)**: el plan que paga ("Plus") es el de la **interfaz web de consumo** de Higgsfield, no el de la API — son productos separados (ver la sección del 404 más abajo, donde ya se había visto esta distinción para el billing). En esa interfaz web, según Rodrigo, dándole la instrucción en el prompt, el propio Higgsfield arma música y captions como parte de la generación — no hace falta editar el video después con ffmpeg ni nada por el estilo.

Con eso, se agregaron dos campos nuevos a lo que genera Mentis en `daily-script.js` — `captionText` (el texto exacto del caption, en español, corto) y `musicStyle` (el estilo de música de fondo, en inglés) — y `daily-media.js` arma un **segundo prompt** (`buildManualHiggsfieldPrompt`, guardado como `promptCompleto`) que suma esas dos instrucciones al prompt visual, pensado para copiarse tal cual en la interfaz web. El prompt que usa el pedido automático a la API (`prompt`, sin cambios) sigue siendo el mudo/sin texto de siempre — la API no soporta esto y pedírselo podría hacer que intente "dibujar" texto sin tipografía real, saliendo ilegible.

**Caveat honesto que sigue en pie**: no hay documentación pública de la interfaz web de consumo (solo de la API) para confirmar que de verdad interpreta instrucciones de música/captions escritas en el prompt — es la palabra de Rodrigo sobre su propia cuenta. La forma real de confirmarlo es probarlo una vez con el `promptCompleto` que ahora aparece en el [panel](panel.md) y ver qué sale.

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

**Bug real encontrado y corregido (3/9/2026)**: esto no se estaba cumpliendo. `daily-script.js` guarda `tipo: "reel"` para TODAS las entradas de guion corto, sea reel o carrusel — la diferencia real está en el campo `formato`, no en `tipo`. El chequeo de acá solo miraba `tipo`, así que un día de carrusel también pasaba el filtro y terminaba pidiéndole un clip a Higgsfield — justo lo que este mismo párrafo decía que no tenía que pasar. Corregido: ahora también exige `formato === "reel"` (con las entradas viejas del historial, de antes de que existiera ese campo, tratadas como reel — que es lo que siempre fueron).

## El 404 sigue sin resolverse — no es un tema de código

Primera corrida real contra Higgsfield con el modelo "Pro Fast" (3/9/2026, después del plan Plus): mismo 404 que antes. Se revisó la documentación de errores de Higgsfield — un 404 acá significa literalmente "modelo no disponible para esta cuenta", y se confirmó mirando directo el dashboard de `cloud.higgsfield.ai`: la cuenta sigue en 0 créditos, con los mismos dos modelos de imagen de siempre (Soul 2, Soul Cinema), y la pestaña Billing de esa plataforma muestra "No transactions found" — o sea, el plan Plus nunca se pagó ahí. Se confirma lo que ya había explicado soporte (Leo) desde el principio: la plataforma de API es un producto separado, con facturación separada, de la web normal de Higgsfield donde Rodrigo compró Plus. Mientras esta cuenta de API no tenga créditos propios, cualquier modelo de video (no solo "Pro Fast") va a seguir dando 404 — no es algo que se arregle cambiando la ruta del modelo en el código.

## Mientras tanto: el prompt nunca se pierde, aunque el pedido automático falle

Antes, si `submitHiggsfieldClip` fallaba (como con este 404), TODO se perdía — ni siquiera el prompt que Mentis ya había escrito quedaba visible en ningún lado, obligando a reconstruirlo a mano si Rodrigo quería generar el video él mismo. Corregido (3/9/2026): el pedido a Higgsfield ahora está en su propio try/catch — si falla, el prompt se guarda igual en `video-history.json` (con status `"manual — no se pudo pedir automático (<motivo>)"`) y queda visible en el [panel personal](panel.md) igual que uno exitoso. La respuesta de la ruta también cambia: en vez de `ok:false` (que el workflow de GitHub Actions marca en rojo), ahora es `ok:true, submitted:false` con el prompt adentro — no es un error del sistema, es información útil. Así, mientras se resuelve el acceso a la API, Rodrigo puede copiar el prompt del panel y generar el clip a mano en la web de Higgsfield con el plan que ya tiene pago.

## Qué hace, paso a paso

1. **`POST /internal/daily-media`** (disparado por GitHub Actions, después de que corrió el guion diario):
   - Trae el historial de contenido más reciente de Dropbox.
   - Busca la entrada de hoy con `tipo: "reel"` Y `formato: "reel"` (ver el bug corregido más abajo). Si no hay (fin de semana, carrusel, o el guion diario todavía no corrió), no pide nada — responde `submitted: false` con el motivo.
   - Si hay, arma un prompt visual corto a partir del ángulo del guion (con el contenido temático primero, el estilo cinematográfico después) y le pide a Higgsfield un clip vertical de 12s (modelo Seedance Pro Fast — cambiar de modelo es una línea en `daily-media.js`). Si `daily-photo.js` ya eligió una foto para hoy, el pedido usa esa foto como imagen de partida (image-to-video); si no, es texto-a-video puro.
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

- **Armado del reel completo**: hoy esto entrega un clip corto de gancho, no el video final montado — falta la edición (varios clips) para cuando se quiera algo más largo que 12s.
- **Música y captions**: el sistema ya arma el `promptCompleto` con las instrucciones (ver la actualización del 3/9/2026 arriba) — falta la primera confirmación real de Rodrigo probándolo en la interfaz web de Higgsfield, para saber si hace falta ajustar el texto.
- **Control de calidad pre-publicación**: analizar el clip ya generado y decidir si tiene potencial antes de usarlo — depende de que el armado final exista primero.

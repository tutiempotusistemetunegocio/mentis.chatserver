# Mentis Chat Server — Módulo 08

Esta es la pieza técnica que faltaba en el "Plano de Mentis": una instancia de Mentis **servida aparte**, siempre disponible, que un cliente premium puede usar para hacerle cualquier pregunta. Es un proceso propio, separado del Claude Code que corre las tareas programadas (lectura diaria, ciclo de reglas, catálogo de guías) — los dos corren en la nube, ninguno depende de una computadora prendida en algún lado.

No tiene dependencias externas: solo necesita **Node.js 18 o más nuevo**. Nada que instalar con `npm install`.

## Probarlo ahora mismo (modo demo, sin gastar nada)

```
node server.js
```

Abrí `http://localhost:3000` en el navegador. Vas a poder chatear y el servidor va a responder en "modo demo" — te confirma que tu pregunta llegó y que ya eligió el bloque de conocimiento correcto, pero todavía no llama a la API de Claude porque falta la clave.

## Pasar a modo real (respuestas de verdad)

1. Andá a [console.anthropic.com](https://console.anthropic.com) y creá una clave de API. **Es distinta de tu cuenta normal de Claude** — se paga por uso (por token), así que conviene que sea una cuenta/facturación separada de tu suscripción personal.
2. Copiá `.env.example` a `.env`:
   ```
   cp .env.example .env
   ```
3. Pegá tu clave en `ANTHROPIC_API_KEY` dentro de `.env`.
4. Reiniciá el servidor (`node server.js`). El log va a decir `Modo: live (con API de Claude)`.

## Cómo elige qué le dice al cliente

`server.js` no le manda a Mentis todo el conocimiento mezclado por defecto — mira la pregunta y elige **todos** los bloques principales que apliquen, no uno solo. Una pregunta de un solo tema (ej. "qué gancho uso para mi reel") trae un solo bloque; una pregunta que mezcla varios temas a la vez (ej. "quiero reels para reclutar gente a mi equipo pero también organizarme mejor con el tiempo") trae los bloques relevantes juntos, y el prompt le indica explícitamente al modelo que los combine en una sola respuesta coherente y con profundidad técnica — no que conteste cada tema por separado. El núcleo (`knowledge/reglas.md`, con tu personalidad y los límites de Mentis) siempre se incluye.

Además — esto es algo que pediste explícitamente — Mentis no se queda encerrado en el bloque principal. Sobre los bloques que no matchearon fuerte, hace una segunda pasada más floja y, si encuentra una conexión real, suma una **idea suelta** (un fragmento corto, no el archivo entero) de esa otra área para enriquecer la respuesta sin diluirla. Esto pasa igual para tus propias preguntas que para las de un cliente premium pagando el acceso — es el mismo comportamiento, no hay una versión recortada.

Bloques disponibles hoy — un archivo por categoría del catálogo final de libros (17 categorías con módulo propio; "Fuentes oficiales de algoritmos" no es un libro y se sintetiza dentro de `redes-sociales.md`, con su propio refresco semanal — ver el plano): `redes-sociales.md`, `ventas.md`, `disciplina.md`, `mentalidad.md`, `finanzas.md`, `emprendedurismo.md`, `multinivel.md`, `network-marketing.md`, `marketing.md`, `como-hacerte-rico.md`, `inteligencia-artificial.md`, `liderazgo-equipos.md`, `copywriting-persuasion.md`, `productividad-tiempo.md`, `storytelling-oratoria.md`, `psicologia-consumidor.md`, `mentalidad-ceo.md`. Se eligen por palabra completa (mirá el array `BLOCKS` en `server.js`), normalizando tildes antes de comparar — así "objecion" matchea igual que "objeción" — y comparando por palabra completa, no por substring, para que una palabra clave corta como "ia" no matchee por accidente adentro de "podría". Si ninguna palabra clave coincide, se usan todos los bloques — mejor una respuesta completa que una vacía.

Cuando tengas muchos más libros y experiencias cargadas, este es el punto exacto donde conviene subir de palabras clave a una búsqueda por vector store — pero para empezar, esto ya cumple la regla de "no mezclar todo por defecto, pero combinar lo que la pregunta realmente toca, más una idea suelta de otra área cuando aporta".

La respuesta del endpoint `/chat` incluye `usedBlocks` (bloques principales) y `looseBlocks` (ideas sueltas de otras áreas) — útil para verificar que la selección está funcionando bien mientras probás.

## Acceso — dos sistemas separados

Rodrigo pidió dos accesos que nunca se cruzan: uno para el cliente premium del chat (paga el acceso a Mentis, Módulo 04/08) y otro para el alumno de la formación en vivo que recibe su propia copia del panel personal (Módulo 02). Cada uno tiene su propio manifiesto (`access-premium.json` / `access-panel-alumnos.json`, ambos ignorados por git — nunca se suben), su propio webhook (`/webhook/systeme-premium` y `/webhook/systeme-panel`) y su propio secreto compartido con Systeme.io (`SYSTEME_PREMIUM_WEBHOOK_SECRET` / `SYSTEME_PANEL_WEBHOOK_SECRET` en `.env`). Con `REQUIRE_ACCESS_CHECK=false` (el default) el servidor no exige acceso, para poder seguir probando en local sin depender de Systeme.io — ponelo en `true` antes de mostrárselo a un cliente real.

Systeme.io no permite mandar headers propios en sus webhooks (solo se configura la URL de destino), así que el secreto de cada webhook va pegado al final de la URL: `/webhook/systeme-premium/<SYSTEME_PREMIUM_WEBHOOK_SECRET>` y `/webhook/systeme-panel/<SYSTEME_PANEL_WEBHOOK_SECRET>` — esas son las URLs que van directo en la automatización de Systeme.io ("Send Webhook"). El servidor también sigue aceptando el secreto por el header `x-webhook-secret` sobre la URL sin el segmento final, para poder seguir probando a mano con curl. El payload real de Systeme.io trae el email en `data.customer.email` (venta) o `data.contact.email` (opt-in) y el tipo de evento en `type` — el servidor entiende esa forma directamente; cualquier `type`/`event` que contenga "cancel" o "refund" revoca el acceso, cualquier otro lo otorga.

Configuración necesaria en Systeme.io, una por producto: **Automations → Workflows** (o, dentro del funnel del producto, **Automation Rules**) → una regla con trigger "New sale" → acción "Send Webhook" → pegar la URL de arriba con el secreto correspondiente; y una segunda regla igual pero con trigger "Sale canceled", apuntando a la misma URL, para que la baja también se refleje.

## Catálogo de guías

Igual que la lectura diaria, la generación del catálogo de guías (Módulo 02 — la oferta gratis y la premium) es una tarea que corre Claude Code en vivo, no un script. Regla fija: ninguna guía es de un solo tema, siempre cruza 2 o más categorías que se complementen — el resto del criterio se lo dejó Rodrigo al sistema. Ver **[`guide-catalog.md`](./guide-catalog.md)** para el detalle completo y el prompt de ejemplo.

## Carpeta de conocimiento y Dropbox

`knowledge/` tiene 18 archivos (`reglas.md` + un archivo por categoría) para que el servidor funcione desde ya. En producción, estos archivos se sincronizan desde Dropbox — la misma carpeta que Claude Code (corriendo en la nube como tarea programada, nunca instalado en ninguna computadora) actualiza cuando reescribe las reglas (Módulo 07), cuando corre la lectura diaria de la carpeta de alimentación (ver `daily-ingest.md`, más abajo), o cuando genera el catálogo de guías (ver `guide-catalog.md`).

### Conectar Dropbox (con renovación automática)

Primera vez, la app de Dropbox:

1. Creá una app en [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps) → **Scoped access** → **App folder** (así la app solo ve una carpeta, no todo tu Dropbox).
2. En la pestaña **Permissions**, activá `files.metadata.read`, `files.content.read` y `files.content.write` (esta última hace falta para que el servidor pueda subir, no solo bajar).
3. En la pestaña **Settings**, anotá el **App key** y el **App secret** — van a `DROPBOX_APP_KEY` y `DROPBOX_APP_SECRET` en `.env` / Render.

Ahora el refresh token — es un valor que se pide **una sola vez**, no vence nunca, y es lo que le permite al servidor renovarse el access token solo (el botón simple "Generate access token" de la pestaña Settings da un token que vence a las 4 horas — no sirve para producción, lo evitamos a propósito):

4. Con el App key del paso 3, armá esta URL (reemplazando `TU_APP_KEY`) y abrila en el navegador:
   ```
   https://www.dropbox.com/oauth2/authorize?client_id=TU_APP_KEY&response_type=code&token_access_type=offline
   ```
5. Autorizá el acceso. Dropbox te va a mostrar un **código corto** en la pantalla (no un link, no un archivo — un texto para copiar).
6. Con ese código, el App key y el App secret, hay que hacer un pedido a Dropbox para cambiarlo por el refresh token de verdad. La forma más simple es pedírmelo a mí en el chat con los tres valores — lo hago con un comando y te devuelvo el `refresh_token` para pegar en `.env`/Render. (Si preferís hacerlo vos mismo desde una terminal: `curl https://api.dropboxapi.com/oauth2/token -d code=EL_CODIGO -d grant_type=authorization_code -d client_id=TU_APP_KEY -d client_secret=TU_APP_SECRET` — la respuesta trae `refresh_token`.)
7. Pegá `DROPBOX_REFRESH_TOKEN`, `DROPBOX_APP_KEY` y `DROPBOX_APP_SECRET` en `.env` (local) y en Render (producción).

Con esas tres variables cargadas, `dropbox-auth.js` le pide un access token nuevo a Dropbox automáticamente cada vez que hace falta (y lo cachea en memoria hasta que esté por vencer) — nadie tiene que volver a generar ni pegar nada a mano nunca más. Si por algún motivo todavía no cargaste las tres, el servidor sigue aceptando `DROPBOX_ACCESS_TOKEN` directo como antes (puente de retrocompatibilidad), pero ese modo vuelve a vencer cada 4 horas.

Una vez conectado:

- Corré `npm run sync-knowledge` (o `node sync-dropbox.js`) para bajar los archivos de conocimiento.
- Corré `node push-dropbox.js` para subir cambios locales (por ejemplo después de la lectura diaria).
- Programá `sync-dropbox.js` como tarea periódica después de cada actualización de reglas, para que el chat de clientes nunca hable con una versión vieja de Mentis.

## Lectura diaria de la carpeta de alimentación

Esto responde a algo que pediste explícitamente: que Mentis lea todos los días lo que vas subiendo a la carpeta de alimentación (libros, notas, experiencias) en sus módulos de conocimiento, y aprenda de ahí — no que el conocimiento quede fijo desde el primer día.

**Ya está implementado**, no es solo una especificación: `daily-ingest.js` corre dentro de este mismo servidor, expuesto como la ruta protegida `POST /internal/daily-ingest`. No es un script puramente mecánico — para cada libro nuevo le pide a la API de Claude que decida a qué categorías aporta y sintetice los principios (nunca copia texto textual, nunca duplica lo que ya está), porque eso necesita razonamiento real, no solo mover archivos. La diferencia con la primera versión de este plano es dónde corre ese razonamiento: en vez de una sesión aparte de Claude Code, es una llamada directa a la API de Claude adentro del propio servidor — así reusa las mismas claves que ya están cargadas en Render (`ANTHROPIC_API_KEY`, `DROPBOX_ACCESS_TOKEN`) sin que ningún secreto tenga que pasar por ningún lado más.

El detalle completo de la lógica (qué carpeta mira, cómo decide qué es nuevo, cómo se dispara todos los días sin que Rodrigo haga nada) está en **[`daily-ingest.md`](./daily-ingest.md)**. En resumen: lee lo nuevo de la carpeta de alimentación (una carpeta plana, sin subcarpetas — Rodrigo sube todo junto), lo clasifica en una o varias de las categorías del catálogo, sintetiza las ideas útiles dentro de los archivos de `knowledge/` (sin copiar texto completo ni duplicar lo que ya está, y marcando — nunca borrando — lo que quedó desactualizado), y sube los cambios a Dropbox para que el chat de clientes los tenga ese mismo día.

**Cómo se dispara todos los días:** un workflow de GitHub Actions (`.github/workflows/daily-ingest.yml`, ya incluido en el repo) llama a esa ruta una vez por día — gratis, sin depender de ningún otro servicio. Solo hace falta cargar dos secretos una vez en GitHub (`Settings → Secrets and variables → Actions`): `MENTIS_INGEST_URL` (la URL del servidor + `/internal/daily-ingest`) y `MENTIS_INGEST_SECRET` (el mismo valor que `INGEST_SECRET` en Render). También se puede disparar a mano en cualquier momento desde la pestaña "Actions" de GitHub (botón "Run workflow"), útil para probar sin esperar al horario programado.

Rodrigo decidió sacar las notas de voz de la carpeta de alimentación — no otorgaban valor agregado frente a PDF, Word y texto, que son los tres formatos que se procesan.

## Guion diario (Módulo 03)

Mismo patrón que la lectura diaria, para la otra mitad del pedido: que Mentis escriba solo el guion de contenido de cada día. **Ya está implementado**: `daily-script.js` corre dentro de este mismo servidor, expuesto como `POST /internal/daily-script`, protegido con `SCRIPT_SECRET` y disparado a diario por `.github/workflows/daily-script.yml` (30 min después de la lectura diaria, para usar el conocimiento más fresco). Genera el guion de reel/carrusel los 7 días de la semana (un ángulo distinto cada día, sin repetir los últimos usados — hasta el 5/9/2026 era solo lunes a viernes) y el guion de podcast cada 3 días, usando todo el conocimiento cargado — y los deja como archivos fechados en `/mentis-contenido` dentro de Dropbox, junto a un historial para no repetir ángulos.

Tampoco prioriza un "ángulo ganador" de forma adaptativa todavía, porque eso necesita datos reales de Metricool que hoy no existen — el detalle completo, incluida esta salvedad, está en **[`daily-script.md`](./daily-script.md)**.

## Video diario (Módulo 03 → Higgsfield)

Sigue al guion diario: una vez que el guion de hoy está escrito, `daily-media.js` le pide a Higgsfield un clip de video corto (10s, vertical) basado en el ángulo de ese guion — expuesto como `POST /internal/daily-media` (dispara el pedido, protegido con `MEDIA_SECRET`) y `POST /webhook/higgsfield-listo/<secreto>/<fecha>` (recibe el aviso cuando el clip está listo y lo sube a Dropbox). Disparado a diario por `.github/workflows/daily-media.yml`, 15 minutos después del guion diario.

Como ningún modelo de Higgsfield genera un video de 60s de una sola vez (el máximo real es de 8 a 12s), esto entrega un clip corto de gancho/portada, no el reel completo armado — el detalle completo, incluida esta salvedad y por qué el secreto del webhook va en la URL (Higgsfield no manda headers propios ni firma sus avisos), está en **[`daily-media.md`](./daily-media.md)**. Metricool y el resto de las piezas de Módulo 03 (armado final, control de calidad) siguen documentadas como preparación, no construidas, en **[`higgsfield-metricool-preparacion.md`](./higgsfield-metricool-preparacion.md)**.

## Carpeta de medios — elige la foto del día (Módulo 03)

Corre en paralelo a Higgsfield, no en su lugar: mientras el clip generado desde cero sigue bloqueado por la cuenta/plan de Higgsfield, esto ya funciona hoy con fotos reales que Rodrigo suba a Dropbox. **Ya está implementado**: `daily-photo.js` corre dentro de este mismo servidor, expuesto como `POST /internal/daily-photo` (síncrono — no hay webhook, la llamada a Claude visión responde en la misma petición), protegido con `PHOTO_SECRET` y disparado a diario por `.github/workflows/daily-photo.yml`, 10 minutos antes del video diario.

Describe cada foto nueva una sola vez con Claude (visión) y guarda esa descripción; el día a día compara el ángulo del guion de hoy contra las descripciones ya guardadas y elige la que mejor conecta, evitando repetir una foto usada en los últimos 15 días. El detalle completo, incluidos los cuatro criterios de selección (por qué ese orden, y por qué a propósito no hay desempate por "calidad" ni análisis de video todavía), está en **[`daily-photo.md`](./daily-photo.md)**. Sin fotos subidas a `/mentis-medios` en Dropbox, cada corrida responde que no hay nada para elegir — no está roto, solo vacío.

## Ponerlo en línea (para que un cliente lo use desde cualquier lado)

No necesita nada especial — es un servidor Node común. Opciones simples, sin Docker:

- **Railway** o **Render**: conectás el repo, seteás las variables de entorno (`ANTHROPIC_API_KEY`, `DROPBOX_ACCESS_TOKEN`, etc.) desde su panel, y listo — quedan siempre prendidos, sin depender de tu Mac.
- **Fly.io**: parecido, un poco más manual pero más barato a escala.

Después, la página de venta en Systeme.io (Módulo 04) puede enlazar o embeber esta URL detrás del login de miembro premium — así solo quien pagó llega al chat.

## Seguridad — antes de mostrárselo a un cliente real

- Nunca subas el archivo `.env` a un repositorio — tiene tus claves privadas. Ya está listo un `.gitignore`.
- El control de acceso (dos manifiestos separados, dos webhooks) ya está armado — ver "Acceso — dos sistemas separados" más arriba. Lo que falta de tu lado es configurar en Systeme.io que llame a `/webhook/systeme-premium` y `/webhook/systeme-panel` cuando alguien compra, con el secreto que pongas en `.env`. Hasta que eso esté conectado, dejá `REQUIRE_ACCESS_CHECK=false`.
- Conviene un límite de preguntas por cliente por día, para controlar el costo de la API — no está implementado todavía.

## Archivos

```
server.js             → el servidor (rutas /health, /chat, /internal/daily-ingest, /internal/daily-script, /internal/daily-media, /webhook/higgsfield-listo, /internal/daily-photo; elige el conocimiento, llama a Claude)
daily-ingest.js        → implementación real de la lectura diaria — lee Dropbox, clasifica con la API de Claude, actualiza knowledge/
.github/workflows/daily-ingest.yml → dispara daily-ingest.js una vez por día, gratis, vía GitHub Actions
daily-script.js         → implementación real del guion diario (Módulo 03) — escribe el guion de reel/carrusel/podcast, lo sube a Dropbox
.github/workflows/daily-script.yml → dispara daily-script.js una vez por día, gratis, vía GitHub Actions
daily-media.js           → implementación real del video diario (Módulo 03) — le pide un clip corto a Higgsfield, lo sube a Dropbox cuando avisa que terminó
.github/workflows/daily-media.yml → dispara daily-media.js una vez por día, gratis, vía GitHub Actions
daily-photo.js           → implementación real de la carpeta de medios (Módulo 03) — elige, entre las fotos de Dropbox, cuál acompaña el reel de hoy
.github/workflows/daily-photo.yml → dispara daily-photo.js una vez por día, gratis, vía GitHub Actions
dropbox-auth.js         → renueva el access token de Dropbox solo (refresh token) — lo usan todos los módulos de arriba, ver "Conectar Dropbox" más abajo
sync-dropbox.js        → baja los archivos de conocimiento desde Dropbox
push-dropbox.js        → sube los archivos de conocimiento a Dropbox (tras la lectura diaria)
daily-ingest.md         → cómo funciona la lectura diaria, en detalle (complementa a daily-ingest.js)
daily-script.md         → cómo funciona el guion diario, en detalle (complementa a daily-script.js)
daily-media.md           → cómo funciona el video diario, en detalle (complementa a daily-media.js)
daily-photo.md           → cómo funciona la carpeta de medios, en detalle — incluye los 4 criterios de selección (complementa a daily-photo.js)
higgsfield-metricool-preparacion.md → lo que falta de Metricool y del armado final del Módulo 03, investigado pero no construido todavía
admin-reset.js           → herramienta puntual (NO recurrente) que borra guías + contenido diario + registro de fotos usadas, para volver a generar todo de cero
.github/workflows/admin-reset-content.yml → dispara admin-reset.js a mano (pide escribir "BORRAR" para confirmar) — nunca en cron
admin-reset.md           → qué borra y qué no borra admin-reset.js, en detalle
business-models.js       → genera modelos de negocio para que Rodrigo mismo monetice (Módulo 08), leyendo toda la base de conocimiento — no busca empresas reales en internet
.github/workflows/business-models.yml → dispara business-models.js una vez por semana, gratis, vía GitHub Actions (o a mano, varias veces seguidas, para juntar ideas rápido)
business-models.md       → qué genera business-models.js y en qué se diferencia de las "oportunidades de monetización" de daily-ingest.js
processed-files.json    → manifiesto de qué archivos de alimentación ya se procesaron
content-history.json    → historial de guiones generados, para no repetir ángulo/tema (se crea solo)
knowledge/               → un archivo por categoría + reglas.md (se actualiza solo con la lectura diaria)
contenido/               → guiones y clips generados por día (se crea solo, se sincroniza con Dropbox)
guide-catalog.md         → especificación de la generación del catálogo de guías (para Claude Code, no un script)
public/index.html       → la interfaz de chat que ve el cliente
.env.example             → plantilla de variables de entorno
access-premium.json      → manifiesto de acceso premium al chat (se crea solo, no se sube a git)
access-panel-alumnos.json → manifiesto de acceso al panel replicado de alumnos (se crea solo, no se sube a git)
```

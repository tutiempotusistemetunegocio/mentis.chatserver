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

Rodrigo pidió dos accesos que nunca se cruzan: uno para el cliente premium del chat (paga el acceso a Mentis, Módulo 04/08) y otro para el alumno de la formación en vivo que recibe su propia copia del panel personal (Módulo 02). Cada uno tiene su propio manifiesto (`access-premium.json` / `access-panel-alumnos.json`, ambos ignorados por git — nunca se suben), su propio webhook (`/webhook/systeme-premium` y `/webhook/systeme-panel`) y su propio secreto compartido con Systeme.io (`SYSTEME_PREMIUM_WEBHOOK_SECRET` / `SYSTEME_PANEL_WEBHOOK_SECRET` en `.env`). Con `REQUIRE_ACCESS_CHECK=false` (el default) el servidor no exige acceso, para poder seguir probando en local sin depender de Systeme.io — ponelo en `true` antes de mostrárselo a un cliente real. El chat exige el header `x-mentis-email` y valida contra `access-premium.json`; el acceso al panel replicado usa el mismo mecanismo (`access-panel-alumnos.json`) desde donde sea que termine sirviéndose ese panel.

Configurar el lado de Systeme.io (que llame a estos webhooks cuando alguien compra) queda pendiente de tu cuenta real — los endpoints y el manejo del secreto ya están armados y probados, falta conectarlos del otro lado.

## Catálogo de guías

Igual que la lectura diaria, la generación del catálogo de guías (Módulo 02 — la oferta gratis y la premium) es una tarea que corre Claude Code en vivo, no un script. Regla fija: ninguna guía es de un solo tema, siempre cruza 2 o más categorías que se complementen — el resto del criterio se lo dejó Rodrigo al sistema. Ver **[`guide-catalog.md`](./guide-catalog.md)** para el detalle completo y el prompt de ejemplo.

## Carpeta de conocimiento y Dropbox

`knowledge/` tiene 18 archivos (`reglas.md` + un archivo por categoría) para que el servidor funcione desde ya. En producción, estos archivos se sincronizan desde Dropbox — la misma carpeta que Claude Code (corriendo en la nube como tarea programada, nunca instalado en ninguna computadora) actualiza cuando reescribe las reglas (Módulo 07), cuando corre la lectura diaria de la carpeta de alimentación (ver `daily-ingest.md`, más abajo), o cuando genera el catálogo de guías (ver `guide-catalog.md`).

Para conectar Dropbox:

1. Creá una app en [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps) → **Scoped access** → **App folder** (así la app solo ve una carpeta, no todo tu Dropbox).
2. En la pestaña **Permissions**, activá `files.metadata.read` y `files.content.read`.
3. En la pestaña **Settings**, generá un access token y pegalo en `DROPBOX_ACCESS_TOKEN` dentro de `.env`.
4. Corré `npm run sync-knowledge` (o `node sync-dropbox.js`) para bajar los archivos.
5. Programalo como tarea periódica (cron) después de cada actualización de reglas, para que el chat de clientes nunca hable con una versión vieja de Mentis.

Para que este servidor *suba* cambios (no solo bajarlos) — por ejemplo después de la lectura diaria — habilitá también `files.content.write` en la app de Dropbox y corré `node push-dropbox.js`.

## Lectura diaria de la carpeta de alimentación

Esto responde a algo que pediste explícitamente: que Mentis lea todos los días lo que vas subiendo a la carpeta de alimentación (libros, notas, experiencias) en sus módulos de conocimiento, y aprenda de ahí — no que el conocimiento quede fijo desde el primer día.

**Ya está implementado**, no es solo una especificación: `daily-ingest.js` corre dentro de este mismo servidor, expuesto como la ruta protegida `POST /internal/daily-ingest`. No es un script puramente mecánico — para cada libro nuevo le pide a la API de Claude que decida a qué categorías aporta y sintetice los principios (nunca copia texto textual, nunca duplica lo que ya está), porque eso necesita razonamiento real, no solo mover archivos. La diferencia con la primera versión de este plano es dónde corre ese razonamiento: en vez de una sesión aparte de Claude Code, es una llamada directa a la API de Claude adentro del propio servidor — así reusa las mismas claves que ya están cargadas en Render (`ANTHROPIC_API_KEY`, `DROPBOX_ACCESS_TOKEN`) sin que ningún secreto tenga que pasar por ningún lado más.

El detalle completo de la lógica (qué carpeta mira, cómo decide qué es nuevo, cómo se dispara todos los días sin que Rodrigo haga nada) está en **[`daily-ingest.md`](./daily-ingest.md)**. En resumen: lee lo nuevo de la carpeta de alimentación (una carpeta plana, sin subcarpetas — Rodrigo sube todo junto), lo clasifica en una o varias de las categorías del catálogo, sintetiza las ideas útiles dentro de los archivos de `knowledge/` (sin copiar texto completo ni duplicar lo que ya está, y marcando — nunca borrando — lo que quedó desactualizado), y sube los cambios a Dropbox para que el chat de clientes los tenga ese mismo día.

**Cómo se dispara todos los días:** un workflow de GitHub Actions (`.github/workflows/daily-ingest.yml`, ya incluido en el repo) llama a esa ruta una vez por día — gratis, sin depender de ningún otro servicio. Solo hace falta cargar dos secretos una vez en GitHub (`Settings → Secrets and variables → Actions`): `MENTIS_INGEST_URL` (la URL del servidor + `/internal/daily-ingest`) y `MENTIS_INGEST_SECRET` (el mismo valor que `INGEST_SECRET` en Render). También se puede disparar a mano en cualquier momento desde la pestaña "Actions" de GitHub (botón "Run workflow"), útil para probar sin esperar al horario programado.

Rodrigo decidió sacar las notas de voz de la carpeta de alimentación — no otorgaban valor agregado frente a PDF, Word y texto, que son los tres formatos que se procesan.

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
server.js             → el servidor (rutas /health, /chat y /internal/daily-ingest, elige el conocimiento, llama a Claude)
daily-ingest.js        → implementación real de la lectura diaria — lee Dropbox, clasifica con la API de Claude, actualiza knowledge/
.github/workflows/daily-ingest.yml → dispara daily-ingest.js una vez por día, gratis, vía GitHub Actions
sync-dropbox.js        → baja los archivos de conocimiento desde Dropbox
push-dropbox.js        → sube los archivos de conocimiento a Dropbox (tras la lectura diaria)
daily-ingest.md         → cómo funciona la lectura diaria, en detalle (complementa a daily-ingest.js)
processed-files.json    → manifiesto de qué archivos de alimentación ya se procesaron
knowledge/               → un archivo por categoría + reglas.md (se actualiza solo con la lectura diaria)
guide-catalog.md         → especificación de la generación del catálogo de guías (para Claude Code, no un script)
public/index.html       → la interfaz de chat que ve el cliente
.env.example             → plantilla de variables de entorno
access-premium.json      → manifiesto de acceso premium al chat (se crea solo, no se sube a git)
access-panel-alumnos.json → manifiesto de acceso al panel replicado de alumnos (se crea solo, no se sube a git)
```

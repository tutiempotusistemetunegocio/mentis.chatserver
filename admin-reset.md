# Borrar guías y contenido — Módulo 08 → herramienta puntual (4/9/2026)

Pedido explícito de Rodrigo, después de ver las primeras guías con el cierre de venta ya andando bien: "quiero que borres todas las guías y la vamos a hacer otra vez todo de nuevo con el nuevo mindset que tiene el sistema". Alcance confirmado con él antes de tocar nada real en Dropbox: además de las guías, también el contenido diario ya generado y el registro de qué fotos ya se usaron.

**Es DESTRUCTIVO y no se puede deshacer.** No es una tarea recurrente — es una herramienta puntual, implementada en `admin-reset.js`, expuesta como `POST /internal/admin-reset-content` (mismo servidor, `mentis-chat-server`) y disparada a mano desde un workflow de GitHub Actions que pide escribir la palabra `BORRAR` antes de llamar a la ruta real.

## Por qué esto corre en Render y no desde la sesión que lo escribió

La sesión de Cowork que armó esto no tiene ningún acceso a Dropbox — las credenciales viven solo en las variables de entorno de Render. Mismo patrón que el resto del sistema: se expone como una ruta protegida y se dispara desde GitHub Actions, nunca directo.

## Qué borra, y qué NO borra — la línea se trazó a propósito

| | Se borra | No se toca |
|---|---|---|
| **Guías** | TODOS los `.md` y `.pdf` bajo `/mentis-guias` (gratis y premium), y `guide-catalog.json` se resetea a `{entries: []}` | — |
| **Contenido diario** | TODOS los guiones `.md` (reel/carrusel/podcast) y los clips `.mp4` ya descargados bajo `/mentis-contenido`, y `content-history.json` + `video-history.json` se resetean a `{entries: []}` | — |
| **Fotos** | Solo `photo-history.json` (el registro de qué foto se usó cada día) se resetea a `{entries: []}` | Las fotos en sí, y `photo-catalog.json` (las descripciones ya generadas — cuestan una llamada a Claude visión por foto cada una, no tiene sentido rehacerlas) |
| **Conocimiento** | Nada | `/knowledge` completo (`reglas.md`, las categorías, los ajustes de estrategia, las oportunidades de monetización) — esto es exactamente lo que el sistema nunca tiene que perder |

`content-history.json` y `video-history.json` se resetean juntos a propósito: cada entrada de `video-history` referencia una fecha/ángulo de `content-history`, así que dejar vivo uno de los dos con fechas viejas que ya no existen del otro lado generaría entradas fantasma en el panel.

## Cómo se dispara

Desde la pestaña "Actions" de GitHub, workflow **"Borrar guías y contenido (empezar de cero)"** → "Run workflow". Pide un campo de texto: escribí `BORRAR` (así, en mayúsculas) para confirmar — cualquier otra cosa cancela el workflow antes de llamar al servidor, no se toca nada.

## Después de correr esto

No hace falta nada más a mano — la próxima corrida de "Guías semanales de Mentis" y de la lectura/guion/foto diarios bajan estos mismos JSON vacíos de Dropbox al arrancar (mismo patrón de siempre: Dropbox es la fuente de verdad) y generan todo de nuevo desde cero, ya con el mindset actual del sistema (cierre de venta obligatorio, rotación de ángulos, objeciones resueltas, etc.). Para juntar rápido las primeras 10 gratis + 10 premium de nuevo, disparar "Guías semanales de Mentis" a mano varias veces seguidas desde Actions — mismo truco que la primera vez.

## Configuración necesaria, una sola vez

- En Render: cargar `ADMIN_RESET_SECRET` — un string largo y random, **distinto a todos los demás secretos** (a propósito no comparte ninguno, por ser destructivo).
- En GitHub (`Settings → Secrets and variables → Actions`): `MENTIS_ADMIN_URL` (la URL del servidor + `/internal/admin-reset-content`) y `MENTIS_ADMIN_SECRET` (el mismo valor que `ADMIN_RESET_SECRET` en Render).

Sin `ADMIN_RESET_SECRET` configurado en Render, la ruta queda completamente cerrada, igual que el resto de las rutas `/internal/*`.

## Si algo falla a mitad de camino

La respuesta incluye `deleted` (cuántos archivos se borraron de cada carpeta) y `failed` (qué archivo puntual no se pudo borrar y por qué, si hay alguno) — un archivo que falla no frena el resto, sigue intentando con los demás. Si `failed` no está vacío, los JSON de historial igual se resetean al final (así la regeneración puede arrancar), pero conviene mirar qué quedó sin borrar y, si hace falta, volver a correr el workflow una segunda vez.

# Video diario — Módulo 03 → clip generado con Higgsfield

Sigue al guion diario (`daily-script.js`): una vez que el guion del día está escrito y guardado, `daily-media.js` le pide a Higgsfield un clip de video corto basado en el ángulo de ese guion. Corre dentro del mismo servidor (`mentis-chat-server`, Módulo 08), expuesto como dos rutas protegidas: `POST /internal/daily-media` (dispara el pedido) y `POST /webhook/higgsfield-listo/<secreto>/<fecha>` (recibe el aviso cuando el clip está listo).

## Una salvedad honesta: esto genera un clip corto, no el reel completo

La documentación real de Higgsfield (consultada el 31/8/2026 antes de construir esto) confirma que **ningún modelo genera un video de 60 segundos de una sola vez** — el máximo por pedido es de 8 a 12 segundos según el modelo. Por decisión de Rodrigo (31/8/2026), esta primera versión pide un solo clip corto (10 segundos, vertical) para usar como gancho/portada — no arma el reel completo. El armado final (varios clips, la carpeta de medios existente, edición) es un paso posterior, todavía no construido.

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

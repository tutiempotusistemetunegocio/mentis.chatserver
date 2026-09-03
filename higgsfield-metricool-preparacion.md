# Preparación para Higgsfield y Metricool (Módulo 03, las dos piezas que faltan)

Este archivo documenta cómo se conectarían Higgsfield y Metricool al sistema, investigado contra su documentación oficial real (no supuesto) — para que el día que Rodrigo tenga esas cuentas, construir sea rápido y sin sorpresas de diseño, como pasó con Systeme.io (que no soportaba headers custom, algo que solo se supo investigando antes de construir).

**Nada de esto está construido ni probado todavía.** Es el plano de cómo se haría, no código funcionando — a diferencia de `daily-ingest.js` y `daily-script.js`, que ya corren en vivo.

## Higgsfield — generar el video/imagen a partir del guion

**Confirmado el 31/8/2026 leyendo `docs.higgsfield.ai` directamente (no fuentes de terceros).**

**Cómo se autentica:** un header `Authorization: Key {KEY_ID}:{KEY_SECRET}` — dos secretos nuevos en Render, no uno solo. La doc es explícita: nunca se llama desde el navegador o una app — solo servidor a servidor, exactamente como ya hacemos.

**Cómo funciona el flujo:** asíncrono. Se manda un POST a un endpoint de modelo específico (hay varios: Seedance/Bytedance, Veo, Kling — con distinta calidad/costo/duración máxima), devuelve un `request_id` al toque, y el resultado se genera en segundo plano (`queued` → `in_progress` → `completed`/`failed`/`nsfw`/`canceled`).

**Ojo con la duración — esto es importante y cambia el diseño:** ningún modelo de video genera un clip de 60 segundos de una sola vez. Los máximos reales por pedido son cortos: Seedance hasta 12s, Kling hasta 10s, Veo hasta 8s. Un reel completo de 60s (como el que ya generamos con `daily-script.js`) **no sale de un solo pedido a Higgsfield** — haría falta pedir varios clips cortos y editarlos juntos, o (más simple al principio) usar Higgsfield solo para generar UN clip corto de portada/gancho y completar el resto con la carpeta de medios existente, tal como ya preveía el plano. Esto hay que decidirlo antes de programar el paso de armado final.

**Webhook — con una salvedad de seguridad importante:** se pasa la URL propia como parámetro en la misma URL del pedido (`?hf_webhook=https://tu-servidor.com/...`), no como un campo separado con secreto como pensé antes de leer la doc real. **La documentación de Higgsfield no menciona ningún mecanismo para verificar que el aviso vino realmente de Higgsfield** (nada de firma ni secreto propio) — a diferencia de lo que asumí en la primera versión de este documento. Esto significa que hay que aplicar el mismo truco que ya usamos con Systeme.io: meter un secreto nuestro en la propia URL del webhook (`/webhook/higgsfield-listo/<secreto>`), para que nadie más pueda mandarnos avisos falsos.

**El resultado es una URL**, no un archivo — Higgsfield aloja el video/imagen y lo mantiene disponible **mínimo 7 días**, así que conviene descargarlo y subirlo a Dropbox pronto después de que esté listo, no confiar en que el link dure para siempre.

**Costo:** confirmado en la cuenta real de Rodrigo (creada el 31/8) — planes desde $19/mes (Starter, 270 créditos, sin acceso a los modelos más nuevos) hasta $115/mes (Ultra, 3.000 créditos). El plan Starter alcanzaría para ~15 videos cortos por mes — insuficiente si se genera un clip por cada guion de lunes a viernes (~20-22/mes); el plan Plus ($54/mes, 1.200 créditos) alcanzaría cómodo. Esto es una decisión de costo de Rodrigo, no una recomendación.

## Metricool — publicar el contenido y traer las métricas

También tiene API real y documentada (Swagger/OpenAPI versionado, `v2`), no es solo una app sin acceso externo.

**Publicar:** `POST /v2/scheduler/posts` — programa o publica en Instagram, TikTok, etc. El video/imagen tiene que estar en una URL pública primero (la de Higgsfield probablemente sirve).

**Métricas:** `GET /v2/analytics/reels/instagram` y endpoints equivalentes por red — esto es lo que haría falta para que el "ángulo ganador" de `daily-script.js` deje de ser el placeholder no-adaptativo que es hoy y pase a usar datos reales de rendimiento, como describe el plano.

**Cómo se autentica:** un token estático (`X-Mc-Auth`) más `userId` y `blogId`, todo generado a mano en su panel — no hay OAuth ni nada que rotar solo.

**Webhooks:** no confirmé que existan avisos automáticos (push) de Metricool hacia afuera — lo más probable es que haya que preguntar activamente ("¿ya se publicó?", "¿hay métricas nuevas?") en vez de esperar un aviso. Esto en realidad encaja perfecto con el patrón que ya usamos (GitHub Actions llamando una vez al día), así que no es un problema de diseño.

**Costo — esto es lo importante para decidir:** el plan gratis de Metricool y el plan Starter (~$20/mes) **no incluyen API**. El acceso a la API arranca recién en el plan Advanced (~$53/mes). Sin ese plan, Metricool serviría solo como app manual (programar posts a mano en su interfaz), no se podría automatizar desde acá. Esto es una decisión de costo real y te la dejo a vos — no te la recomiendo, es la misma lógica que con Systeme.io.

## Orden sugerido para construir esto, el día que decidas avanzar

1. **Higgsfield primero** — es lo que falta para que el guion se convierta en contenido posteable de verdad. No depende de un plan carísimo confirmado, solo de crear la cuenta y sacar las claves.
2. **Control de calidad pre-publicación** — analizar el video ya generado antes de publicar. Depende de que el paso 1 exista.
3. **Metricool al final** — es el que tiene el costo mensual más alto y más claro ($53/mes mínimo), así que tiene sentido dejarlo para cuando el resto ya esté probado y valga la pena pagar por la parte de publicación + métricas.

## Fuentes consultadas
- https://docs.higgsfield.ai/docs
- https://github.com/higgsfield-ai/higgsfield-js
- https://app.metricool.com/resources/apidocs/index.html
- https://help.metricool.com/basic-guide-for-api-integration-r97af
- https://help.metricool.com/en/article/api-limitations-per-social-network-508ay5/
- https://metricool.com/pricing/

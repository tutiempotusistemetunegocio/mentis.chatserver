# Preparación para Higgsfield y Metricool (Módulo 03, las dos piezas que faltan)

Este archivo documenta cómo se conectarían Higgsfield y Metricool al sistema, investigado contra su documentación oficial real (no supuesto) — para que el día que Rodrigo tenga esas cuentas, construir sea rápido y sin sorpresas de diseño, como pasó con Systeme.io (que no soportaba headers custom, algo que solo se supo investigando antes de construir).

**Nada de esto está construido ni probado todavía.** Es el plano de cómo se haría, no código funcionando — a diferencia de `daily-ingest.js` y `daily-script.js`, que ya corren en vivo.

## Higgsfield — generar el video/imagen a partir del guion

Tiene API real y documentada (`docs.higgsfield.ai`), con SDK oficial para Node (`@higgsfield/client`).

**Cómo se autentica:** un par de claves (Key ID + Key Secret), generadas en su panel ("Higgsfield Cloud"). Van como dos secretos nuevos en Render — no un solo token como los que ya usamos.

**Cómo funciona el flujo:** es asíncrono. Le mandás el prompt (derivado del guion del día), te devuelve un `request_id` al toque, y el video/imagen se genera en segundo plano (`queued` → `in_progress` → `completed`). Hay dos formas de enterarte cuándo terminó:
- **Webhook** (recomendado): Higgsfield sí soporta mandar un aviso a una URL propia con secreto (`webhook: { url, secret }` al pedir el job) — a diferencia de Systeme.io, esto sí lleva secreto propio, no hay que inventar el truco de la URL. Es el mismo patrón que ya usamos para los webhooks de Systeme.io, pero más simple.
- **Polling**: guardar el `request_id` y preguntar en la corrida del día siguiente si ya está listo. Más simple de programar pero más lento (el video puede tardar más de un día en aparecer).

**El resultado es una URL**, no un archivo que te manden directo — Higgsfield aloja el video/imagen y te da el link. Hay que decidir si se descarga y se sube a Dropbox (para tener respaldo propio) o se usa directo esa URL para el siguiente paso (Metricool también necesita una URL pública, así que podría alcanzar con la de Higgsfield sin pasar por Dropbox).

**Costo:** tiene planes pagos, pero las fuentes no coinciden en los precios exactos y el uso de la API se cobra aparte en créditos, no incluido sin más en la suscripción. Esto hay que confirmarlo recién al crear la cuenta, mirando `higgsfield.ai/pricing` directo.

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

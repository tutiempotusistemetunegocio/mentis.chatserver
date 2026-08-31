# Guion diario — Módulo 03 → contenido

Implementado igual que la lectura diaria (`daily-ingest.js`): la lógica vive en `daily-script.js`, corriendo dentro del mismo servidor (`mentis-chat-server`, Módulo 08) — expuesta como la ruta protegida `POST /internal/daily-script`. Sin Higgsfield ni Metricool conectados todavía (Rodrigo confirmó que no tiene esas cuentas armadas), esto se detiene en el guion: escribe el texto listo para grabar/diseñar, pero no genera el video ni lo publica — esos dos pasos (Higgsfield y Metricool) quedan para cuando Rodrigo tenga esas cuentas.

## Una salvedad honesta: el "ángulo ganador" todavía no es adaptativo

El plano describe que, con semanas de datos reales de Metricool, Mentis prioriza el ángulo que mejor funcionó y vuelve a probar ángulos nuevos cuando ese cae en rendimiento. Como Metricool no está conectado, `daily-script.js` **no tiene esa lógica todavía** — sería inventar datos de rendimiento que no existen. Lo que sí hace: le pasa a Mentis los ángulos usados en los últimos días (guardados en el historial) y le pide uno distinto, para mantener la variedad de la tabla del plano (lunes a viernes, un ángulo por día) sin repetirse. El día que Metricool esté conectado, este paso puede volverse realmente adaptativo — hoy es honesto que todavía no lo es.

## Qué hace, paso a paso

1. **Trae lo último de Dropbox primero** — sincroniza `knowledge/` (por si se cargó algo nuevo en la lectura diaria de esa misma mañana) y el historial de contenido (`content-history.json`) desde Dropbox, mismo motivo que `daily-ingest.js`: el disco de Render no está garantizado entre reinicios.
2. **Decide qué generar hoy:**
   - Reel o carrusel: de lunes a viernes (`WEEKDAYS_ONLY = true` en el código — el plano solo define el reparto de ángulos para esos 5 días; cambiar esto a 7 días es una línea si Rodrigo lo pide).
   - Podcast: cada 3 días, con un ritmo fijo desde una fecha ancla (no depende del día de la semana).
3. **Le pide a Mentis un guion**, con una llamada a la API de Claude, usando TODO el conocimiento cargado (los 17+ archivos de `knowledge/`) como contexto, evitando repetir el ángulo/tema de los últimos días (historial), y con reglas de voz fijas: nunca revelar el mecanismo interno (esto se publica, así que la regla del secreto aplica con más fuerza que en el chat privado), tono directo, sin promesas de resultados, y el resto de las pautas de la página personal (no mencionar Miami, poco peso a la esposa, foco en disciplina/tiempo/historia).
4. **Guarda el guion** como archivo fechado (`YYYY-MM-DD-reel.md`, `YYYY-MM-DD-carrusel.md` o `YYYY-MM-DD-podcast.md`) y lo sube a Dropbox, junto con el historial actualizado.

## Cómo se dispara todos los días

Un workflow de GitHub Actions (`.github/workflows/daily-script.yml`) llama a `POST /internal/daily-script` una vez por día, 30 minutos después de la lectura diaria (10:30 UTC, ajustable), para que el guion de hoy ya cuente con cualquier libro procesado esa misma mañana. También se puede disparar a mano desde la pestaña "Actions" del repositorio, para probar.

Configuración necesaria, una sola vez:
- En Render: cargar `SCRIPT_SECRET` (un string largo y random, distinto al de `INGEST_SECRET`) — ya deberían estar `ANTHROPIC_API_KEY` y `DROPBOX_ACCESS_TOKEN`.
- Opcional: `DROPBOX_CONTENT_FOLDER` (default `/mentis-contenido`) si querés otro nombre de carpeta.
- En GitHub (`Settings → Secrets and variables → Actions`): `MENTIS_SCRIPT_URL` (la URL del servidor + `/internal/daily-script`) y `MENTIS_SCRIPT_SECRET` (el mismo valor que `SCRIPT_SECRET` en Render).

Sin `SCRIPT_SECRET` configurado en Render, la ruta queda completamente cerrada, igual que `/internal/daily-ingest` sin `INGEST_SECRET`.

## Dónde aparece el resultado

Los guiones quedan en la carpeta `/mentis-contenido` (o la que hayas puesto en `DROPBOX_CONTENT_FOLDER`) dentro del App folder de Dropbox — el mismo lugar donde ya revisás los libros subiendo. Cada archivo es un `.md` legible con el ángulo/tema del día y el guion completo, listo para copiar a donde Rodrigo grabe o diseñe.

## Lo que falta para que este módulo quede completo (Módulo 03 completo)

- **Higgsfield**: generar el video/imagen a partir del guion (o encontrar el mejor material ya existente en la carpeta de medios) — no construido todavía, Rodrigo no tiene la cuenta armada.
- **Control de calidad pre-publicación**: analizar el video ya generado (no solo el guion) y decidir si tiene potencial real antes de publicar — depende de que Higgsfield esté conectado primero.
- **Metricool**: publicar/programar el contenido y traer las métricas — sin esto, tampoco hay forma de que el ángulo se vuelva adaptativo de verdad (ver la salvedad más arriba).

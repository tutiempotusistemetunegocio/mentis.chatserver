# Lectura diaria de la carpeta de alimentación — Módulo 01 → conocimiento

**Ya está implementado**, no es solo una especificación: la lógica completa vive en `daily-ingest.js`, corriendo dentro del mismo servidor (`mentis-chat-server`, Módulo 08) — expuesta como la ruta protegida `POST /internal/daily-ingest`. Esto reemplaza la idea original de una sesión aparte de Claude Code corriendo la tarea: en vez de eso, para cada libro nuevo el servidor le hace una llamada directa a la API de Claude para que decida a qué categorías aporta y sintetice los principios — sigue siendo razonamiento real, no un script puramente mecánico, pero corre adentro del mismo proceso que ya tiene las claves configuradas en Render, sin que ningún secreto tenga que viajar a ningún otro lado. Esta es la diferencia con `sync-dropbox.js` / `push-dropbox.js`, que son mecánicos de verdad (bajar/subir archivos tal cual) y no necesitan que Claude razone nada.

Aclaración explícita de Rodrigo, ya cumplida: esto corre **en la nube**, nunca en su computadora — el servidor vive en Render, se dispara desde GitHub Actions, y nada de esto depende de que Rodrigo tenga algo instalado o prendido de su lado.

## Qué hace, paso a paso (lo que hace `daily-ingest.js` en código real)

1. **Trae lo último de Dropbox primero.** Antes de tocar nada local, sincroniza `knowledge/` y el manifiesto (`processed-files.json`) desde Dropbox — el disco de Render no está garantizado entre reinicios, así que Dropbox es la fuente de verdad, nunca el disco local de la instancia.
2. **Lista lo nuevo.** Mira la carpeta de alimentación (Módulo 01, en Dropbox — **una sola carpeta plana, sin subcarpetas por categoría**: Rodrigo sube todo ahí junto, sin ordenar nada) y la compara contra el manifiesto usando el `content_hash` que da Dropbox. Solo procesa lo que es nuevo o cambió — nunca reprocesa todo desde cero.
3. **Extrae el texto de cada archivo nuevo**, hasta un máximo por corrida (`INGEST_MAX_FILES_PER_RUN`, default 3 — para no pasarse de tiempo ni de costo de API en una sola ejecución; lo que sobra queda para la corrida del día siguiente):
   - PDF: con la librería `pdf-parse`.
   - Word (.docx): con la librería `mammoth`.
   - Texto plano: directo.
   - Notas de voz: **descartadas** — decisión de Rodrigo, no agregaban valor extra frente a PDF/Word/texto. La carpeta de alimentación solo recibe esos tres formatos, y el código ni siquiera intenta procesar otra cosa.
4. **Clasifica por categoría — esto lo hace el sistema, nunca Rodrigo a mano**, con una llamada a la API de Claude por documento. Un mismo archivo puede tocar una o varias de las 17 categorías con módulo propio a la vez (ver el plano para la lista completa) — un libro de ventas puede tener un capítulo que en realidad es de mentalidad, y eso va al bloque de mentalidad. Justamente por esto la carpeta de origen queda plana y sin ordenar: pre-clasificar en subcarpetas no tendría sentido.
5. **Sintetiza, no pega.** Por cada idea nueva y realmente útil, la agrega al archivo `knowledge/<categoría>.md` correspondiente, en el mismo formato que ya tienen esos archivos (principios cortos, aplicados, sin relleno) — nunca copia el texto completo del libro. El código deduplica automáticamente: si una línea ya existe tal cual, no la vuelve a agregar. Lo aprendido en ciclos anteriores sigue vigente por defecto — esto suma, nunca reemplaza.
6. **Marca lo desactualizado, nunca lo borra.** Si el documento nuevo contradice algo que ya está escrito, el código no edita ni elimina esa línea — le agrega la etiqueta `[desactualizado: reemplazado por lectura más reciente]` delante, y la deja archivada en el mismo lugar. `server.js` ya sabe ignorar cualquier línea con esa etiqueta al armar sus respuestas (ver el prompt en `buildSystemPrompt`), pero la línea nunca desaparece del archivo. Esto es un límite duro en el código, no una preferencia de estilo: no hay ninguna ruta en `daily-ingest.js` que elimine una línea de conocimiento.
7. **Actualiza el manifiesto y sube todo a Dropbox** — `knowledge/` completo (vía `push-dropbox.js`) y el manifiesto actualizado — para que la instancia servida del chat (este mismo proceso, de hecho) tenga el conocimiento fresco al toque, y para que sobreviva si Render reinicia el servicio.

**Bug real corregido en auditoría (3/9/2026): el manifiesto ya no se guarda "a ciegas".** Antes, este paso guardaba el manifiesto (marcando los archivos de hoy como "ya procesados") sin chequear si `push-dropbox.js` realmente había logrado subir el conocimiento nuevo — esa función fallaba en silencio ante cualquier error real (token vencido, un archivo puntual que no subió), sin avisarle a nadie. Si eso pasaba y el disco de Render no sobrevivía hasta la próxima corrida (nunca está garantizado, ver el punto 1), lo aprendido ese día se perdía para siempre, porque el manifiesto ya decía que no hacía falta reprocesarlo. Ahora `push-dropbox.js` devuelve si realmente subió todo, y el manifiesto (local y en Dropbox) solo se guarda si eso fue así — si algo falla, la corrida termina en `ok: false` a propósito, y los mismos archivos se reintentan (reclasificar + resubir) en la corrida siguiente en vez de darse por perdidos en silencio.

## Revisión de estrategia (agregado 3/9/2026)

Pedido explícito de Rodrigo: "cada vez que se carga nueva información, [Mentis] se actualice también de forma a que ajuste la estrategia — si tiene una sugestión de mejoría, considerala automáticamente". Hasta acá, la lectura diaria solo aprendía TEMAS (los principios de cada categoría) — nunca se preguntaba si eso cambia algo de CÓMO Mentis vende. Esto viene de una revisión real que se le pidió a Mentis sobre la estrategia actual (guías + contenido diario con cierre de venta) — confirmó que el enfoque es correcto (con cita a principios concretos de `copywriting-persuasion.md`, `marketing.md`, `storytelling-oratoria.md`) y señaló tres mejoras puntuales, dos de las cuales ya se aplicaron directo (ver más abajo) y una tercera que se convirtió en este mecanismo permanente.

Cómo funciona: si una corrida de la lectura diaria aprendió al menos un principio nuevo real (`learnedThisRun` no vacío), se hace una llamada extra a Mentis con ese resumen + el contenido completo de `knowledge/reglas.md` (la estrategia central), preguntando si hace falta un ajuste. La consigna es exigente a propósito ("la respuesta correcta la mayoría de las veces es que no hace falta ningún cambio") para que esto no se convierta en ruido — un principio nuevo sobre un tema puntual no siempre cambia la estrategia de venta en sí. Si Mentis decide que sí hace falta un ajuste, se agrega como una línea nueva en la sección "Ajustes de estrategia" de `reglas.md` (agregada junto con esto), nunca reemplazando ni borrando nada — mismo criterio de "nunca pierde lo aprendido" que ya regía para el resto del conocimiento. La sección arranca vacía; no hay nada que forzar ahí hasta que un documento real motive el primer ajuste.

Distinto del bloque "Ángulos en prueba esta semana" (también en `reglas.md`): ese lo reescribe el Módulo 07 con datos de rendimiento real de Metricool — mide qué funciona. Este mecanismo nuevo es sobre conocimiento, no sobre métricas — analiza si lo que se está leyendo dice que el enfoque está bien, sin necesitar ningún dato de Metricool.

**Las otras dos mejoras que señaló Mentis, ya aplicadas directo (sin esperar a este mecanismo, porque ya eran evidentes hoy):**
- La tabla de rotación de ángulos de `reglas.md` estaba cargada como contexto pero nada obligaba a seguirla — `daily-script.js` ahora la parsea en vivo y le indica a Mentis qué tipo de ángulo le toca al día de la semana (ver `daily-script.md`).
- Las guías premium no se adelantaban a la objeción más probable de su público (falta de tiempo) — el cierre de venta ahora la incluye a propósito, citando el principio ya cargado en `ventas.md` (ver `weekly-guides.md`).

Una mejora que Mentis señaló y que **no se puede construir todavía**: usar prueba social real en los cierres. `psicologia-consumidor.md` confirma que reduce el riesgo percibido más que cualquier argumento — pero `reglas.md` prohíbe inventar resultados que no existen, y hoy no hay ningún alumno real de "replicar el sistema" ni comprador con resultado propio que citar. Queda pendiente hasta que exista el primer caso real.

## Oportunidades de monetización (agregado 3/9/2026)

Pedido explícito de Rodrigo, en el mismo momento que el mecanismo de arriba: "buscar siempre nuevas oportunidades para vender, para monetizar" — no solo ajustar cómo Mentis vende lo que ya existe (guías + sistema), sino detectar cuando el conocimiento nuevo sugiere algo distinto y concreto que Rodrigo podría ofrecer.

Es la misma llamada a Mentis que la revisión de estrategia (mismo `learnedThisRun`, mismo `reglas.md` como contexto) pero con una segunda pregunta independiente — pueden responderse distinto: puede haber ajuste de estrategia sin oportunidad nueva, oportunidad nueva sin ajuste, ambas, o ninguna (lo más común). Mismo criterio exigente que el resto de este mecanismo: la mayoría de los documentos no generan ninguna oportunidad.

Cuando Mentis sí identifica una, se guarda como una entrada nueva en `strategy-opportunities.json` (nunca se sobreescribe ni se borra ninguna entrada anterior — mismo principio de "nunca se pierde lo aprendido") y se sube a Dropbox junto con `/knowledge`. El panel personal (Módulo 08, `panel.js`) las muestra en su nueva sección "Estrategia" — ver `panel.md`. Esto es una lista de ideas para que Rodrigo evalúe y decida, no una acción automática: nada de esto arma ni publica una oferta nueva por sí solo.

## Cómo se dispara todos los días

Un workflow de GitHub Actions (`.github/workflows/daily-ingest.yml`) llama a `POST /internal/daily-ingest` una vez por día (10:00 UTC por default, ajustable en el archivo — pensado para correr antes de la generación de contenido de las 7am hora de Rodrigo, Módulo 03, así el guion del día ya cuenta con lo que se subió el día anterior). También se puede disparar a mano en cualquier momento desde la pestaña "Actions" del repositorio en GitHub, sin esperar al horario — útil para probar.

Configuración necesaria, una sola vez:
- En Render: cargar `INGEST_SECRET` (cualquier string largo y random) además de `ANTHROPIC_API_KEY` y las credenciales de Dropbox, que ya deberían estar (ver README.md, sección "Conectar Dropbox").
- En GitHub (`Settings → Secrets and variables → Actions`): `MENTIS_INGEST_URL` (la URL del servidor + `/internal/daily-ingest`) y `MENTIS_INGEST_SECRET` (el mismo valor que `INGEST_SECRET` en Render).

Sin `INGEST_SECRET` configurado en Render, la ruta queda completamente cerrada — ni siquiera intenta correr nada, devuelve un error explicando que falta configurarlo.

## Notas de voz: descartadas

Rodrigo decidió sacar esta vía — no iba a otorgar valor agregado frente a lo que ya cubren PDF, Word y texto, y evita la complejidad extra de elegir y pagar un servicio de transcripción. La carpeta de alimentación solo recibe esos tres formatos, y `daily-ingest.js` directamente no sabe procesar ningún otro.

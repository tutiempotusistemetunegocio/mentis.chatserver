# Lectura diaria de la carpeta de alimentación — Módulo 01 → conocimiento

Esto no es un script — es la tarea que corre **Claude Code en vivo**, todos los días, porque clasificar y sintetizar contenido nuevo necesita razonamiento real, no solo mover archivos. Esta es la diferencia con `sync-dropbox.js` / `push-dropbox.js`, que son mecánicos (bajar/subir archivos) y no necesitan a Claude despierto.

Aclaración explícita de Rodrigo: esto corre **en la nube**, como una tarea programada — no es algo que Rodrigo tenga que instalar ni dejar corriendo en su computadora. El entorno donde corre esta tarea es el mismo tipo de entorno en el que se diseñó y montó todo este sistema.

## Qué hace, paso a paso

1. **Lista lo nuevo.** Mira la carpeta de alimentación (Módulo 01, en Dropbox) y la compara contra `processed-files.json` (manifiesto: qué archivo, cuándo se procesó, con qué hash). Solo procesa lo que es nuevo o cambió — nunca reprocesa todo desde cero.
2. **Lee cada archivo nuevo.**
   - PDF y texto: Claude Code los lee directo, sin conversión.
   - Word (.docx): necesita un paso de conversión antes de leerse (`pandoc`, disponible en el entorno de la nube donde corre esta tarea) — Claude Code puede correr ese comando él mismo antes de leer el resultado.
   - Notas de voz: **descartadas** — decisión de Rodrigo, no agregaban valor extra frente a PDF/Word/texto. La carpeta de alimentación solo recibe esos tres formatos.
3. **Clasifica por módulo.** Cada archivo (o cada idea dentro de un archivo largo) puede tocar uno o varios de los módulos de conocimiento (uno por categoría — ver el plano para la lista completa, ya no son 7 fijos). No fuerza un solo módulo por archivo — un libro de ventas puede tener un capítulo que en realidad es de mentalidad, y eso va al bloque de mentalidad.
4. **Sintetiza, no pega.** Por cada idea nueva y realmente útil, la agrega al archivo `knowledge/<módulo>.md` correspondiente, en el mismo formato que ya tienen esos archivos (principios cortos, aplicados, sin relleno) — nunca copia el texto completo del libro o la nota. Si el archivo ya tiene una idea parecida, la actualiza o la funde con la existente en vez de duplicarla. Lo aprendido en ciclos anteriores sigue vigente por defecto — esto suma, no reemplaza.
5. **Condensa la redacción cuando hace falta — nunca borra conocimiento.** Si un archivo de módulo está creciendo mucho, este es el momento de repasarlo entero y apretar la redacción — juntar ideas repetidas, sacar relleno — igual que Rodrigo revisaría sus propias notas de vez en cuando. Esto es un límite duro, no una preferencia de estilo: **ninguna idea real se elimina del archivo, nunca, bajo ningún criterio de antigüedad.**
6. **Marca lo desactualizado, no lo borres.** Si una idea específica quedó obsoleta (algo más reciente y mejor fundamentado la contradice, o cambió la realidad que describía — por ejemplo, un dato de un algoritmo de red social que ya cambió), no se elimina la línea: se le agrega la etiqueta `[desactualizado: <motivo corto>]` al principio. Sigue físicamente en el archivo, archivada — Mentis simplemente no la usa como base para responder mientras tenga esa etiqueta. Si más adelante alguna otra información confirma que sí sigue vigente, se le puede sacar la etiqueta — por eso nunca se borra.
7. **Actualiza el manifiesto** (`processed-files.json`) marcando los archivos de este ciclo como procesados.
8. **Sube los cambios a Dropbox** corriendo `node push-dropbox.js`, para que la instancia servida del chat (Módulo 08) tenga el conocimiento fresco ese mismo día.

## Cuándo corre

Antes de la generación de contenido de las 7am (Módulo 03) — así el guion del día ya se arma con cualquier libro o nota que Rodrigo haya subido el día anterior. Sugerencia: 6:00am, como tarea programada diaria.

## Prompt de ejemplo para la tarea programada

```
Corré la lectura diaria de Mentis. Mirá la carpeta de alimentación en
Dropbox, compará contra processed-files.json, y procesá solo los archivos
nuevos o cambiados (PDF, Word o texto — no hay notas de voz, esa vía se
descartó). Para cada uno: leelo (convertí los .docx con pandoc antes si
hace falta), clasificalo en uno o varios de los módulos de conocimiento
correspondientes, y agregá al archivo knowledge/<módulo>.md las ideas
nuevas y útiles en el mismo formato que ya tienen esos archivos — sin
copiar texto completo, sin duplicar ideas ya presentes. Si algún archivo
de conocimiento quedó muy largo, apretá la redacción — pero nunca borres
una idea real. Si alguna idea existente quedó obsoleta o contradicha por
algo nuevo, marcala con "[desactualizado: motivo]" en vez de eliminarla.
Actualizá processed-files.json al final, y corré "node push-dropbox.js"
para subir los cambios.
```

## Notas de voz: descartadas

Rodrigo decidió sacar esta vía — no iba a otorgar valor agregado frente a lo que ya cubren PDF, Word y texto, y evita la complejidad extra de elegir y pagar un servicio de transcripción. La carpeta de alimentación solo recibe esos tres formatos.

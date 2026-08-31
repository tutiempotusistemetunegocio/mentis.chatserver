# Catálogo de guías — Módulo 02 (oferta gratis / paga)

Igual que `daily-ingest.md`, esto no es un script — es una tarea que corre **Claude Code en vivo**, porque decidir qué combinación de categorías realmente vale la pena como guía necesita criterio, no solo mezclar archivos al azar. Corre en la nube, como tarea programada — no instalado en la computadora de Rodrigo.

## La regla que puso Rodrigo

El catálogo lo genera el propio sistema, no Rodrigo a mano. La única regla fija: **ninguna guía es de un solo tema**. Toda guía cruza como mínimo 2 categorías del catálogo de libros que se complementen entre sí — por ejemplo network marketing + redes sociales, neurociencia/psicología del consumidor + redes sociales, o disciplina/productividad + redes sociales. Cómo elegir qué combinaciones armar se lo dejó explícitamente al sistema — el único límite real es que la guía tenga valor informativo de verdad, no que cumpla una cuota de cruces.

## Qué hace, paso a paso

1. **Mira el catálogo de categorías completo** (`knowledge/*.md`, uno por categoría — ver la lista en el plano) y el historial de qué guías ya existen, para no repetir un cruce ya cubierto.
2. **Propone combinaciones de 2 o más categorías** que tengan una conexión real, no forzada — el criterio no es "categorías que nunca se cruzaron", es "categorías donde juntarlas produce un ángulo que ninguna de las dos da por separado". Ejemplos de cruces con valor real: disciplina + redes sociales ("cómo publicar todos los días sin agotarte"), psicología del consumidor + copywriting ("por qué tu gancho no convierte, aunque sea creativo"), mentalidad de CEO + social media marketing ("cómo pensar tu contenido como un portafolio de negocio, no como posteos sueltos").
3. **Redacta la guía** sintetizando lo mejor de cada categoría cruzada en un documento corto y accionable — no un resumen de los libros, una guía práctica que alguien pueda aplicar el mismo día.
4. **Clasifica la guía** como gratis o premium según profundidad: las guías gratis (lead magnet, Módulo 02) dan una idea completa pero acotada; las guías premium (si aplica) van más a fondo o incluyen plantillas/checklists.
5. **Registra la guía** en el catálogo (nombre, categorías cruzadas, fecha, si es gratis o premium) para que la próxima corrida del catálogo sepa qué ya existe y busque cruces nuevos.

## Cuándo corre

No es diario como la lectura de la carpeta de alimentación — corre cuando el catálogo de categorías tiene contenido nuevo suficiente para justificar una guía nueva, o cuando Rodrigo la pide explícitamente. Sugerencia inicial: revisar una vez por semana si hay material nuevo que amerite una guía, en vez de forzar una guía nueva cada semana exista o no el material.

## Prompt de ejemplo para la tarea

```
Generá una guía nueva para el catálogo de Mentis. Mirá knowledge/*.md (todas
las categorías) y el registro de guías ya existentes en guide-catalog-log.json.
Elegí una combinación de 2 o más categorías que se complementen y que todavía
no se haya cubierto, donde cruzarlas produzca un ángulo con valor real — no
fuerces el cruce solo por variar. Redactá la guía como documento corto y
accionable, no como resumen de los libros. Clasificala como gratis o premium
según la profundidad. Registrala en guide-catalog-log.json con las categorías
que cruza.
```

## Relación con el resto del sistema

Las guías gratis alimentan el lead magnet de la página personal (Módulo 04) y el link en bio. Las guías premium, si las hay, son parte de lo que ve un cliente que ya pagó el acceso — mismo mecanismo de conocimiento cruzado que usa `pickRelevantKnowledge()` en `server.js` para responder preguntas en vivo, solo que acá el resultado queda fijado como documento en vez de responderse en el momento.

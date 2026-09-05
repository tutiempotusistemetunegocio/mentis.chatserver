# Modelos de negocio para monetizar — Módulo 08 (5/9/2026)

Pedido explícito de Rodrigo: "quiero que el sistema, con el conocimiento que tiene, me comience a dar sugestiones y estrategias para buscar negocios y que me recomiende negocios, sean de marketing digital, lo que sea, que busque y que me aparezca en mi herramienta personal. ¿Qué puedo hacer para monetizar?"

Cuando se le preguntó si esto debía buscar empresas reales en internet, aclaró: "yo quiero es modelos de negocios, que yo los pueda utilizar para generar ingresos" — es decir, **no** nombres de empresas reales ni búsqueda en internet (este servidor no tiene ninguna herramienta de búsqueda web, solo la API de Claude para generar texto). Lo que genera es modelos de negocio concretos que Rodrigo mismo podría montar y ejecutar, razonando sobre el conocimiento ya acumulado en `/knowledge`.

## En qué se diferencia de "Estrategia" (las oportunidades de `daily-ingest.js`)

Ya existía una sección "Estrategia" en el panel, alimentada por `strategy-opportunities.json` — pero esas son oportunidades de **vender algo nuevo a la audiencia de Mentis** (la gente que sigue las guías/contenido), y solo se evalúan cuando llega un libro nuevo a la carpeta de alimentación.

Esto es al revés y corre por su cuenta:

| | Estrategia (ya existía) | Modelos de negocio (nuevo) |
|---|---|---|
| ¿Para quién es el negocio? | Para la audiencia de Mentis | Para Rodrigo mismo |
| ¿Cuándo corre? | Solo si hoy se aprendió algo nuevo | Solo una vez por semana, deliberado |
| ¿Sobre qué razona? | Lo aprendido HOY | TODA la base de conocimiento acumulada |
| ¿Evita repetir? | No aplica (cada oportunidad es de un documento distinto) | Sí — se le pasan los títulos ya sugeridos para que no repita |

## Cómo genera cada modelo

Una vez por semana (o a mano, cuando se dispare el workflow), `business-models.js`:

1. Baja la versión más reciente de `/knowledge` y del catálogo de modelos ya sugeridos desde Dropbox (mismo criterio que el resto del sistema: Dropbox es la fuente de verdad, el disco de Render no está garantizado entre reinicios).
2. Le pasa a Mentis el contenido **completo** de las 17 categorías (redes-sociales, ventas, marketing, emprendedurismo, como-hacerte-rico, multinivel, network-marketing, finanzas, inteligencia-artificial, etc.) — no un resumen, todo el archivo — junto con los títulos de los modelos ya sugeridos antes.
3. Le pide entre 2 y 4 modelos nuevos (configurable con `BUSINESS_MODELS_PER_RUN`, default 2), cada uno con: título, descripción de cómo genera ingreso, por qué encaja específicamente con lo que Rodrigo ya sabe/tiene armado (no una idea genérica que serviría para cualquiera), entre 3 y 5 primeros pasos concretos para arrancar esa semana, y una estimación cualitativa de esfuerzo e inversión inicial (nunca una cifra de dinero inventada, y nunca una promesa de resultado).
4. Guarda los modelos nuevos en `business-models.json` (solo crece, nunca se sobreescribe un modelo viejo) y lo sube a Dropbox, en la misma carpeta que el resto del conocimiento (`DROPBOX_KNOWLEDGE_FOLDER`).

El panel personal (Módulo 08, `panel.js`) los muestra en su propia sección "Modelos de negocio", separada de "Estrategia".

## Cómo se dispara

Automático: workflow **"Modelos de negocio"** en GitHub Actions, todos los miércoles 11:00 UTC (separado del lunes de "Guías semanales" para no solaparse). También se puede disparar a mano ("Run workflow") cuantas veces haga falta — por ejemplo, para juntar varias ideas de entrada antes de esperar a la primera corrida programada.

## Configuración necesaria, una sola vez

- En Render: cargar `BUSINESS_MODELS_SECRET` — un string largo y random, distinto a todos los demás secretos.
- En GitHub (`Settings → Secrets and variables → Actions`): `MENTIS_BUSINESS_MODELS_URL` (la URL del servidor + `/internal/business-models`) y `MENTIS_BUSINESS_MODELS_SECRET` (el mismo valor que `BUSINESS_MODELS_SECRET` en Render).

Sin `BUSINESS_MODELS_SECRET` configurado en Render, la ruta queda completamente cerrada, igual que el resto de las rutas `/internal/*`.

## Si algo falla a mitad de camino

Si Mentis no devuelve un JSON válido, o Dropbox falla al subir el catálogo actualizado, la corrida termina con `ok: false` y un mensaje claro en el log de GitHub Actions — nunca se guardan modelos a medio generar ni se pierde en silencio lo que sí se generó (queda en el disco de Render, aunque no esté garantizado que sobreviva hasta la próxima corrida si Dropbox no lo recibió).

## Qué NO toca

Este módulo nunca borra nada — ni siquiera la herramienta de borrado (`admin-reset.js`, ver `admin-reset.md`) toca `business-models.json`: vive en la carpeta de conocimiento, que ese reseteo deja intacta a propósito. Las ideas generadas acá se consideran tan valiosas como el resto del conocimiento acumulado.

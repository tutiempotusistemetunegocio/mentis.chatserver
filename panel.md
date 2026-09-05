# Panel personal de Rodrigo — Módulo 08 (v1)

Pedido explícito de Rodrigo (2/9/2026), al mismo tiempo que el [catálogo de guías](weekly-guides.md): "quiero que en mi herramienta personal tengas eso, tanto las premium como las free". Implementado dentro de `panel.js`, corriendo en el mismo servidor (`mentis-chat-server`) que todo lo demás.

## Cómo se entra

A diferencia de las rutas `/internal/*` (pensadas para que las llame GitHub Actions), esta la abre Rodrigo directo desde el navegador — así que el secreto viaja como parte de la URL, no como header, igual que ya se hace con el webhook de Higgsfield:

```
https://<tu-servidor-en-render>/panel/<PANEL_SECRET>
```

Sin `PANEL_SECRET` configurado, o con el valor equivocado en la URL, la ruta devuelve 404 — no confirma ni siquiera que el panel existe. Conviene guardar esa URL completa en un lugar privado (el gestor de contraseñas, por ejemplo) en vez de tratar de memorizarla.

## Qué se ve, honestamente

El plano describe un panel completo: stats de cada pieza, videos para descargar, historial semanal, y una sección "Estrategia" donde Mentis piensa como CEO. De todo eso, esta v1 muestra lo que hoy tiene datos reales detrás:

- **Guías** (gratis y premium): el catálogo completo armado por `weekly-guides.js`, con categorías, fecha y si usó alguna cita — tocar el título abre el texto completo de la guía, y el link "PDF" al lado (cuando existe) descarga la versión con diseño. Las guías generadas antes del PDF, o cuya subida haya fallado en su momento, muestran "sin PDF" en vez del link.
- **Contenido reciente**: los últimos guiones (reel/carrusel/podcast), las últimas fotos elegidas, y el prompt exacto que se le mandó a Higgsfield para cada video (pedido explícito de Rodrigo, "no veo el prompt del video" — antes se armaba y se mandaba sin dejar rastro visible en ningún lado).
- **Estrategia** (agregado 3/9/2026, pedido explícito de Rodrigo: "buscar siempre nuevas oportunidades para vender, para monetizar"): lista las oportunidades de monetización que Mentis fue detectando solo — cada vez que la lectura diaria (`daily-ingest.js`) procesa un documento y aprende algo nuevo, se pregunta por separado si eso abre algo NUEVO y concreto que Rodrigo podría vender (no una mejora a lo que ya vende, eso ajusta `reglas.md` directo, sin pasar por acá). El criterio es exigente a propósito, así que esta sección puede quedar vacía semanas seguidas — no es una falla, es lo esperado hasta que aparezca algo que realmente lo amerite.
- **Modelos de negocio** (agregado 5/9/2026, pedido explícito de Rodrigo: "¿qué puedo hacer para monetizar?" — modelos de negocio que él mismo pueda ejecutar, no búsqueda de empresas reales en internet): a diferencia de "Estrategia" de arriba (que es sobre qué venderle a la audiencia de Mentis), esto es sobre qué negocio puede montar y correr Rodrigo mismo, generado por `business-models.js` una vez por semana leyendo toda la base de conocimiento acumulada — ver `business-models.md` para el detalle completo.
- **Estado de las conexiones**: si Higgsfield, Metricool, ManyChat y Systeme.io tienen sus variables de entorno cargadas — confirma que la configuración está puesta, **no** que la API esté respondiendo bien en este momento (para eso, la fuente real sigue siendo GitHub Actions).

De la sección "Estrategia" completa que describe el plano, esta v1 cubre la parte de oportunidades de monetización de cara a la audiencia y, por separado, los modelos de negocio para Rodrigo mismo. Lo que falta y todavía no tiene datos reales detrás — qué ángulo/formato funciona mejor en redes según Metricool, mejoras a la herramienta misma, y el resumen semanal — aparece marcado como "todavía no construido" en vez de inventar números o dejar una sección vacía disfrazada de terminada. El día que se construyan esos módulos, suman su propia parte acá, sin tocar nada de lo que ya funciona.

## Configuración necesaria, una sola vez

En Render, cargar `PANEL_SECRET` — un string largo y random, distinto a todos los demás secretos (ver `.env.example`). No hace falta ninguna clave nueva de Dropbox ni de Anthropic — reutiliza las que ya están cargadas.

## Costo de cada visita

Cada vez que se abre el panel, el servidor baja de Dropbox el catálogo de guías, los dos historiales de contenido, las oportunidades de estrategia y los modelos de negocio — seis archivos chicos. Para un uso personal y esporádico esto es más simple que mantener una copia sincronizada aparte, pero significa que cada visita tarda un segundo o dos de más mientras trae los datos frescos.

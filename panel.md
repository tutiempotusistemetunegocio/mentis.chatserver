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

- **Guías** (gratis y premium): el catálogo completo armado por `weekly-guides.js`, con categorías, fecha y si usó alguna cita — tocar el título abre el texto completo de la guía.
- **Contenido reciente**: los últimos guiones (reel/carrusel/podcast) y las últimas fotos elegidas.
- **Estado de las conexiones**: si Higgsfield, Metricool, ManyChat y Systeme.io tienen sus variables de entorno cargadas — confirma que la configuración está puesta, **no** que la API esté respondiendo bien en este momento (para eso, la fuente real sigue siendo GitHub Actions).

Lo que el plano describe y todavía no tiene datos reales detrás — Estrategia y el resumen semanal — aparece marcado como "todavía no construido" en vez de inventar números o dejar una sección vacía disfrazada de terminada. El día que se construyan esos módulos, suman su propia sección acá, sin tocar nada de lo que ya funciona.

## Configuración necesaria, una sola vez

En Render, cargar `PANEL_SECRET` — un string largo y random, distinto a todos los demás secretos (ver `.env.example`). No hace falta ninguna clave nueva de Dropbox ni de Anthropic — reutiliza las que ya están cargadas.

## Costo de cada visita

Cada vez que se abre el panel, el servidor baja de Dropbox el catálogo de guías y los dos historiales de contenido — tres archivos chicos. Para un uso personal y esporádico esto es más simple que mantener una copia sincronizada aparte, pero significa que cada visita tarda un segundo o dos de más mientras trae los datos frescos.

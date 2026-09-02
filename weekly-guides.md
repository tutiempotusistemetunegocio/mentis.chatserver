# Catálogo de guías — Módulo 02 → contenido pago y gratis

Arma las guías descargables del sistema (el "repositorio de guías" que describe el plano) — tanto las gratis (lead magnet) como las premium (parte del acceso pago). Implementado igual que el resto de las tareas diarias: la lógica vive en `weekly-guides.js`, corriendo dentro del mismo servidor (`mentis-chat-server`, Módulo 08), expuesta como la ruta protegida `POST /internal/weekly-guides`.

Pedido explícito de Rodrigo (2/9/2026): antes de vender, arrancar con 10 guías premium + 10 gratis ya cargadas, y que el catálogo quede "siempre alimentado" — todas las semanas, al menos 2 gratis + 2 premium nuevas, para siempre. No es un lote único: es un módulo recurrente, como la lectura diaria o el guion diario, pero con ritmo semanal en vez de diario.

## Por qué el arranque y las semanas normales son la misma corrida

Cada corrida genera hasta `GUIDES_PER_RUN_FREE` gratis + `GUIDES_PER_RUN_PREMIUM` premium (2 y 2 por default) — no hay un "modo primera vez" especial. Para juntar rápido las primeras 20, Rodrigo dispara esta tarea a mano varias veces seguidas desde la pestaña "Actions" de GitHub — el mismo truco que ya usó para ponerse al día con los ~101 libros pendientes de la lectura diaria. Después de eso, el cron semanal (lunes 11:00 UTC, ajustable) solo hace la reposición de 2+2 — no hace falta tocar nada.

## Cómo arma cada guía

1. Baja de Dropbox el conocimiento y el catálogo de guías existente (mismo motivo de siempre: el disco de Render no sobrevive garantizado entre reinicios).
2. Por cada tipo (gratis, premium), hasta su cupo por corrida: le pide a Mentis que elija 2 o 3 categorías de conocimiento que se complementen — nunca una sola categoría, tal como lo pidió Rodrigo — evitando repetir una combinación ya usada hace poco para ese mismo tipo.
3. Mentis escribe la guía completa con las reglas de voz de siempre (nunca revelar el mecanismo interno) más una regla nueva, explicada abajo.
4. Guarda la guía como archivo `.md` fechado, actualiza el índice del catálogo (`guide-catalog.json`) y sube todo a Dropbox.

## Diferencia entre gratis y premium

Es una decisión mía, no viene del plano — se la marco a Rodrigo por las dudas: la guía gratis entrega un framework claro y completo en sí mismo, pero sin agotar todo lo que Mentis sabe del tema (deja con ganas de más, a propósito). La premium busca sentirse claramente más valiosa: varios frameworks combinados, más profundidad y ejemplos aplicados paso a paso — no solo "más larga". Si Rodrigo quiere otro criterio de diferenciación, es un cambio de prompt, no de arquitectura.

## Regla nueva: citar autor si se usa una frase textual completa

Pedido explícito de Rodrigo (2/9/2026), junto con este montaje: si en algún momento una guía necesita citar una frase COMPLETA y textual de un autor o libro conocido (no una paráfrasis), esa cita se tiene que atribuir explícitamente — nombre del autor y, si aplica, el título del libro, dentro del propio texto de la guía. Fuera de esos casos puntuales, sigue aplicando la regla de siempre: nunca copiar texto ajeno sin decirlo, sintetizando con las propias palabras de Mentis. Cada guía generada guarda si usó alguna cita (y cuál) en el índice del catálogo, para que quede auditable.

## Qué NO hace todavía, a propósito

Este módulo solo arma el catálogo — el contenido, guardado en Dropbox y visible en el [panel personal](panel.md). No manda nada a nadie. Eso depende de dos piezas que todavía no existen, las dos dentro de ManyChat (Módulo 04), que Rodrigo confirmó que todavía no construyó:

- **Entrega por comentario:** cuando alguien comenta la palabra clave en una publicación, mandarle automáticamente una guía gratis.
- **Reenganche cada 15 días:** a los leads fríos (comentaron pero no llegaron a premium), mandarles una guía elegida al azar del catálogo, sin repetir nunca una guía ya enviada a ese mismo cliente — pedido explícito de Rodrigo (2/9/2026).

El catálogo guarda un `id` estable por guía justamente para que, el día que se conecte ManyChat, ese módulo solo tenga que leer esta misma lista y llevar su propio historial de qué le mandó a cada cliente — no hace falta rehacer nada de lo de acá.

## Configuración necesaria, una sola vez

En Render, cargar (además de las que ya existen):
- `GUIDES_SECRET` — un string largo y random, distinto a los demás secretos, para proteger la ruta que dispara el armado.
- `DROPBOX_GUIDES_FOLDER` — opcional, por defecto `/mentis-guias`.
- `GUIDES_PER_RUN_FREE` / `GUIDES_PER_RUN_PREMIUM` — opcional, por defecto 2 y 2 (el ritmo semanal que pidió Rodrigo).

En GitHub (`Settings → Secrets and variables → Actions`): `MENTIS_GUIDES_URL` (la URL del servidor + `/internal/weekly-guides`) y `MENTIS_GUIDES_SECRET` (el mismo valor que `GUIDES_SECRET` en Render).

Sin `GUIDES_SECRET` configurado en Render, la ruta queda completamente cerrada, igual que el resto de las rutas `/internal/*`.

## Dónde aparece el resultado

Cada guía queda en `/mentis-guias/gratis/` o `/mentis-guias/premium/` dentro del App folder de Dropbox, más el índice `guide-catalog.json` con título, categorías, fecha y si usó alguna cita. Todo esto también se ve, ya ordenado y con links para leer cada guía, en el [panel personal](panel.md).

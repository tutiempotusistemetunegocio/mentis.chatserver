# Entrega de guías vía ManyChat — Módulo 04 → guide-delivery.js

Pedido explícito de Rodrigo (9/9/2026): "falta el ManyChat... para que el sistema ya comience, la gente tenga acceso a las guías y pague". Esta pieza es la que faltaba para que el catálogo de guías (`weekly-guides.js`, ya funcionando) le llegue de verdad a alguien: hoy el catálogo solo vivía en Dropbox y en el panel privado de Rodrigo — nadie de afuera podía recibir una guía sola.

## Cómo funciona, en orden

1. Alguien comenta la palabra clave (ej. "MENTIS") en una publicación de Instagram.
2. ManyChat detecta el comentario (con su "Comment Growth Tool") y dispara un flujo que llama a `GET /internal/manychat-guide/<MANYCHAT_SECRET>?subscriberId=<id del suscriptor en ManyChat>`.
3. El servidor elige, al azar, una guía gratis que ESE suscriptor todavía no recibió (lo recuerda en `manychat-history.json`, en la misma carpeta de Dropbox que el catálogo) y devuelve JSON: `{"ok":true,"titulo":"...","url":"https://.../guia/<id>","mensaje":"<titulo>: <url>"}`.
4. ManyChat manda esa URL por DM. La URL (`GET /guia/<id>`) sirve el PDF de esa guía puntual, sin ningún secreto — puede viajar dentro de un DM a cualquiera, porque **solo sirve guías marcadas `gratis`**, nunca premium, sin importar qué id se pida.
5. El mismo pedido (mismo `subscriberId`) sirve para el reenganche cada 15 días: como el servidor ya sabe qué le mandó antes, automáticamente elige una guía distinta — no hace falta ninguna ruta nueva para eso.

**Si el catálogo gratis se agota** para un suscriptor puntual (le mandamos ya todas las que hay), en vez de fallar se le vuelve a repetir una al azar — mejor eso que dejarlo sin nada, y el catálogo sigue creciendo solo (2+ guías gratis por semana).

## Lo que armé yo (servidor) — listo

- `guide-delivery.js`: la lógica de elegir guía + servir el PDF público.
- `server.js`: dos rutas nuevas, `GET /internal/manychat-guide/<secreto>` (protegida) y `GET /guia/<id>` (pública, solo gratis).
- `.env.example`: `MANYCHAT_SECRET` — cargalo en Render con un string largo y random (`openssl rand -hex 24`), distinto a los demás secretos.

## Lo que falta de tu lado — configurar ManyChat (una sola vez)

1. **Cargar `MANYCHAT_SECRET`** en Render (Environment), el mismo valor que vas a pegar en ManyChat en el paso 4.
2. En ManyChat: **Automation → Comment Growth Tool** (a veces aparece como "Comments Autoresponder") → elegí la publicación (o "todas las publicaciones futuras") → palabra clave: `MENTIS` (o la que prefieras).
3. Ese trigger dispara un Flow — dentro del Flow, agregá un paso **"External Request"** (a veces aparece como "HTTP Request" o dentro de "Actions → External Request"):
   - Método: `GET`
   - URL: `https://mentis-chatserver.onrender.com/internal/manychat-guide/<MANYCHAT_SECRET>?subscriberId={{user_id}}` — el campo `{{user_id}}` es un campo del sistema que ManyChat inserta solo (a veces aparece como `{{ig_username}}` o `{{subscriber_id}}` según la versión; cualquier ID estable del suscriptor sirve).
   - Guardá la respuesta: mapeá el campo `mensaje` (o `titulo` + `url` por separado, si preferís armar el texto vos) a un **Custom User Field** de ManyChat, por ejemplo `guia_entregada`.
4. Después del External Request, agregá un paso de **mensaje de texto** que use ese campo: `¡Acá tenés tu guía! {{guia_entregada}}`.
5. Poné un **fallback**: si el External Request falla (`ok:false` — por ejemplo, todavía no hay ninguna guía gratis con PDF), un mensaje simple tipo "Dame un toque que ya te la mando yo" — así nunca queda a alguien sin respuesta.
6. **Para el reenganche de 15 días**: armá una **Sequence** en ManyChat (o un "Default Reply" con delay) que, 15 días después del primer mensaje, repita los pasos 3-4 con el mismo `subscriberId` — automáticamente va a traer una guía distinta.

## Probar antes de conectarlo a Instagram de verdad

Con `MANYCHAT_SECRET` ya cargado en Render, podés probar a mano con curl (o Postman) antes de tocar ManyChat:

```
curl "https://mentis-chatserver.onrender.com/internal/manychat-guide/<MANYCHAT_SECRET>?subscriberId=prueba-1"
```

Debería devolver un JSON con `ok:true` y una URL de guía — abrí esa URL en el navegador y debería bajarte un PDF real. Si corrés el mismo curl de nuevo con `subscriberId=prueba-1`, tendría que devolverte una guía DISTINTA (o la misma, si ya agotaste el catálogo gratis) — así confirmás que el "no repetir" funciona.

## Lo que esto NO resuelve todavía

- **Guías premium para quien ya pagó**: hoy el pago (Systeme.io) solo habilita el chat conversacional (`/chat`), no una forma de leer guías premium fuera del panel privado de Rodrigo. Si querés que un cliente premium también pueda leer sus guías premium por su cuenta (no solo preguntarle al chat), es un módulo aparte — avisame si lo querés.
- **El pago en sí**: esta pieza solo entrega guías GRATIS. Para que "la gente... pague" hace falta terminar la configuración de Systeme.io (funnel premium + reglas de automatización) — ver el README, sección "Acceso — dos sistemas separados", y el mensaje de Rodrigo del 9/9/2026 donde confirmó que ya tiene el plan pago de Systeme.io (antes bloqueado por el límite de reglas del plan gratis).

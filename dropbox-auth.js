// Autenticación de Dropbox con renovación automática — reemplaza depender de
// un DROPBOX_ACCESS_TOKEN pegado a mano, que Dropbox vence cada 4 horas por
// default (el problema real que encontramos el 1/9/2026: "expired_access_token"
// tirando abajo las cuatro tareas diarias que dependen de Dropbox — lectura
// diaria, guion diario, video diario y carpeta de medios — cada vez que
// pasaban más de 4hs desde la última vez que Rodrigo regeneraba el token a
// mano).
//
// Cómo funciona: Dropbox permite pedir un "refresh token" una sola vez (con
// autorización manual de Rodrigo, una vez, ver la guía en README.md). Ese
// refresh token no vence nunca. Con el refresh token más el App key/secret
// de la app de Dropbox (los tres son secretos propios de la app, no de una
// sesión), el servidor le pide a Dropbox un access token nuevo (de corta
// duración) él solo, cada vez que lo necesita — sin que Rodrigo tenga que
// volver a generar nada a mano nunca más.
//
// getDropboxAccessToken() cachea el access token en memoria (compartida por
// todo el proceso, ya que server.js corre todos los módulos juntos) y lo
// renueva solo cuando está por vencer (con 5 minutos de margen), para no
// pedirle un token nuevo a Dropbox en cada llamada.
//
// Retrocompatibilidad a propósito: si todavía no se cargó el refresh token
// (por ejemplo, justo después de este cambio, antes de que Rodrigo complete
// la configuración nueva), sigue aceptando DROPBOX_ACCESS_TOKEN directo como
// venía siendo — así nada se rompe de un día para el otro. Pero ese modo
// sigue venciendo cada 4hs; es solo un puente.

// Afinado el 2/9/2026, parte de la auditoría de confiabilidad de "toda la
// programación": ninguna llamada a una API externa tenía límite de tiempo
// propio — si Dropbox o Claude se colgaban en vez de responder con un error,
// la corrida se quedaba esperando indefinidamente en vez de fallar limpio
// (esto es justo lo que hace que una corrida se vea "todavía corriendo" en
// GitHub Actions mucho más de lo normal). AbortSignal.timeout() corta la
// espera después de este límite y la convierte en un error normal, que ya
// sabe manejar el resto del código.
const FETCH_TIMEOUT_MS = 20000;

let cached = { token: null, expiresAt: 0 };

async function getDropboxAccessToken() {
  const now = Date.now();
  if (cached.token && now < cached.expiresAt) {
    return cached.token;
  }

  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;

  if (!refreshToken || !appKey || !appSecret) {
    // Puente de retrocompatibilidad — ver comentario de arriba. No cachea
    // nada porque no hay nada que renovar; simplemente devuelve lo que haya.
    if (process.env.DROPBOX_ACCESS_TOKEN) return process.env.DROPBOX_ACCESS_TOKEN;
    throw new Error('Falta configurar DROPBOX_REFRESH_TOKEN + DROPBOX_APP_KEY + DROPBOX_APP_SECRET en las variables de entorno (o, temporalmente, DROPBOX_ACCESS_TOKEN) — ver README.md, sección "Conectar Dropbox (con renovación automática)".');
  }

  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: appKey,
      client_secret: appSecret,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data && data.error_description) || `HTTP ${res.status} renovando el access token de Dropbox`);
  }

  // 5 minutos de margen antes del vencimiento real, para no arriesgarse a
  // que una llamada larga termine justo cuando el token ya venció.
  cached = { token: data.access_token, expiresAt: now + (data.expires_in * 1000) - 5 * 60 * 1000 };
  return cached.token;
}

module.exports = { getDropboxAccessToken };

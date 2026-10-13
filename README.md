# Botonera

Pad sampler táctil para iPad. Grilla de pads configurable de 1×1 a 12×12, un sonido por pad cargado desde Archivos, presets guardados en el dispositivo, fader de volumen general y botón Panic.

Se instala como app desde Safari y funciona sin internet. Los sonidos se pueden recortar por pad y buscar en MyInstants (esto último necesita conexión).

## Buscar sonidos en MyInstants

MyInstants no permite que otras páginas lean sus búsquedas ni sus MP3, así que la app los pide a través de un intermediario propio: un Cloudflare Worker gratuito (`worker/myinstants-proxy.js`). Solo consulta páginas de búsqueda y archivos de sonido de myinstants.com, y solo atiende pedidos de esta app.

### Publicar el worker (una sola vez)

1. Creá una cuenta gratis en [dash.cloudflare.com](https://dash.cloudflare.com).
2. Entrá a **Workers & Pages → Create → Create Worker**. Ponele de nombre `botonera-myinstants` y tocá **Deploy**.
3. Tocá **Edit code**, borrá todo el código de ejemplo, pegá el contenido de `worker/myinstants-proxy.js` y tocá **Deploy**.
4. Copiá la dirección del worker. Tiene esta forma: `https://botonera-myinstants.TU-SUBDOMINIO.workers.dev`.

Desde la terminal también se puede: `cd worker && npx wrangler deploy`.

Si abrís la app desde otra dirección que no sea `https://brunobellinvia.github.io`, agregala a `ALLOWED_ORIGINS` al principio del worker.

### Configurarlo en la app

En **Editar**, tocá un pad → **Buscar sonido** → pegá la dirección del worker → **Guardar**. La app prueba la conexión antes de guardarla. Para cambiarla después, usá el botón **Proxy** de esa pantalla.

### Uso

- Buscá por texto. En inglés suele haber más resultados.
- El círculo reproduce el sonido sin cargarlo; pasa por el fader master y suena aunque el iPad esté en silencio.
- **Usar** baja el MP3, lo guarda en el iPad y lo asigna al pad. Desde ahí funciona sin conexión.
- **Quitar silencio inicial al cargar** (activado de entrada) corta el silencio del principio del MP3 con un recorte no destructivo, que podés ajustar después en **Recortar**.

Si MyInstants cambia el formato de sus páginas, la búsqueda deja de devolver resultados y hay que actualizar la función `parseResults` del worker.

## Publicar en GitHub Pages

1. En GitHub, creá un repositorio nuevo **público**, por ejemplo `botonera`. En cuentas gratis, GitHub Pages solo publica repos públicos.
2. Subí todo el contenido de esta carpeta a la raíz del repo, con las carpetas `fonts` e `icons` incluidas. Desde la web: **Add file → Upload files**, arrastrá los archivos y las dos carpetas, y tocá **Commit changes**.
3. Andá a **Settings → Pages**. En **Build and deployment**, elegí **Deploy from a branch**, rama `main`, carpeta `/ (root)`, y guardá.
4. Esperá uno o dos minutos. La app queda en `https://TU-USUARIO.github.io/botonera/`.

Si preferís la terminal, desde esta carpeta:

```
git init
git add .
git commit -m "Botonera"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/botonera.git
git push -u origin main
```

Y después activá Pages como en el paso 3.

## Instalar en el iPad

1. Abrí la dirección en **Safari**. Desde Chrome no se puede instalar en iPadOS.
2. Esperá a que cargue del todo, con conexión. En esa primera visita se guarda la app completa para usarla offline.
3. Tocá **Compartir → Agregar a pantalla de inicio**.
4. Abrila desde el ícono. Se abre a pantalla completa, sin la barra de Safari.

Para comprobar que quedó offline: activá modo avión, cerrá la app desde el selector de apps y volvé a abrirla.

## Datos

- Los sonidos y los presets se guardan dentro de la app instalada. Ese almacenamiento es aparte del de Safari: lo que cargues en Safari no aparece en la app, y al revés.
- Si borrás la app de la pantalla de inicio, se borran sus datos. Antes, exportá tus presets.
- **Exportar** (en Presets) abre Compartir. Elegí **Guardar en Archivos**. El `.json` lleva la grilla y los sonidos adentro.
- **Importar** levanta ese `.json` en cualquier instalación.

## Formato de sonido recomendado

WAV PCM de 16 bits, 44,1 o 48 kHz, con el silencio inicial recortado. También acepta MP3, M4A/AAC y AIFF. El MP3 agrega un silencio de codificación al principio que se nota como latencia. Safari en iOS 15 no decodifica OGG.

## Actualizar la app

1. Modificá los archivos en el repo.
2. En `sw.js`, subí el número de `VERSION`, por ejemplo de `1.0.0` a `1.0.1`. Sin este paso, el iPad sigue usando la versión guardada.
3. Abrí la app con conexión. En **Presets** aparece **Actualizar ahora**. La app nunca se recarga sola, así que no te va a cambiar en medio de un show.

Si agregás archivos nuevos, sumalos a la lista `FILES` de `sw.js` para que también queden disponibles offline.

## Archivos

| Archivo | Para qué |
|---|---|
| `index.html` | La app completa: interfaz, audio y almacenamiento |
| `sw.js` | Service worker: guarda la app para usarla sin internet |
| `manifest.webmanifest` | Nombre, ícono y modo pantalla completa de la app instalada |
| `icons/` | Íconos y pantallas de carga para iPad de 9,7" |
| `fonts/` | Barlow Condensed e IBM Plex Mono, con sus licencias (SIL OFL) |
| `.nojekyll` | Le indica a GitHub Pages que publique los archivos tal cual |

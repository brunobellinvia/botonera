# Botonera

Pad sampler táctil para iPad. Grilla de pads configurable de 1×1 a 12×12, un sonido por pad cargado desde Archivos, MyInstants o Freesound, recorte y fade out por pad, presets guardados en el dispositivo, volumen general con medidor de nivel (fader en tablet, knob en celular) y botón Panic.

Se instala como app desde Safari y funciona sin internet. Los sonidos se pueden recortar por pad y buscar en MyInstants (esto último necesita conexión).

## Freesound

En **Buscar sonido**, el selector de arriba cambia entre MyInstants y Freesound. Freesound tiene grabaciones de mejor calidad, con duración, formato, frecuencia de muestreo, autor y licencia en cada resultado. **Cortos (hasta 10 s)** viene activado; tocalo para ver también sonidos largos.

Hay dos niveles:

- **Solo con la API key:** búsqueda y preescucha. Al tocar **Usar** se carga la preescucha en MP3 de 128 kbps.
- **Con tu cuenta conectada:** **Usar** baja el archivo original (WAV, AIFF, FLAC, MP3 o M4A, hasta 40 MB). Los originales en OGG se reemplazan por la preescucha, porque Safari de iOS 15 no decodifica OGG.

### Configurar Freesound (una sola vez)

1. **Credenciales de la API.** Con tu sesión de Freesound abierta, entrá a [freesound.org/apiv2/apply](https://freesound.org/apiv2/apply) y creá una credencial nueva. En **Callback URL** poné exactamente:
   `https://botonera-myinstants.brunebell8.workers.dev/fs/callback`
   Freesound te da un **Client id** y un **Client secret/Api key**.
2. **Secretos del worker.** En Cloudflare: **Workers & Pages → botonera-myinstants → Settings → Variables and secrets → Add**.
   - `FREESOUND_KEY`, de tipo **Secret**, con el Client secret/Api key.
   - `FREESOUND_CLIENT_ID`, con el Client id.
3. **Almacenamiento para el login.** En **Storage & databases → Workers KV**, creá un namespace (por ejemplo `botonera-freesound`). Después, en el worker: **Settings → Bindings → Add → KV namespace**, con el nombre de variable `FS_KV` y ese namespace.
4. **Código nuevo.** **Edit code**, reemplazá todo por `worker/myinstants-proxy.js` y tocá **Deploy**.

Con solo el paso 2 (`FREESOUND_KEY`) y el 4 ya funcionan la búsqueda y la preescucha. Los pasos 1 a 3 completos habilitan bajar originales.

La API key queda guardada como secreto en Cloudflare, nunca en este repositorio, que es público.

### Conectar tu cuenta

En la app, con Freesound elegido, tocá **Conectar Freesound**. Se abre Safari para que entres y autorices; cuando termina, volvé a la Botonera, que en unos segundos muestra **Conectado como …**. El worker guarda los tokens en el KV y los renueva solo. La app guarda una clave de sesión propia; **Desconectar** la borra. También podés revocar el acceso desde la configuración de tu cuenta de Freesound.

### Licencias

Cada resultado muestra su licencia. **CC0** se usa libremente. **CC BY** pide mencionar al autor cuando publiques algo que lo use. **CC BY-NC** (en ámbar) no permite uso comercial: revisalo antes de usar esos sonidos en un show pago. La licencia y el autor quedan guardados junto con cada sonido.

## Ordenar los pads

En **Editar**, mantené apretado un pad 0,4 s: se levanta y los demás tiemblan, como en la pantalla de inicio de iOS. Arrastralo sobre otro pad y soltalo: intercambian lugar con todo su contenido (sonido, recorte, color y opciones). Si lo soltás fuera de la grilla, vuelve a su lugar. Un toque corto sigue abriendo el editor del pad.

## Nombre automático

Cada vez que cargás un sonido en un pad (desde Archivos, MyInstants, Freesound o la lista de ya cargados), el pad toma solo un nombre nuevo, aunque ya tuviera otro. El nombre sale del título del sonido, limpio: sin extensión, sin números de serie ni etiquetas de relleno ("Sound Effect", "HQ", "[MP3]", "320kbps"), con los guiones bajos y el camelCase separados, y cortado en una palabra entera hasta 24 letras. Por ejemplo, `kickDrum_808_v2.wav` queda **Kick Drum 808** y "Vine Boom Sound Effect (HQ)" queda **Vine Boom**.

Si el título no dice qué es (Audio 2, Grabación, Hit, Loop, 01…), suma una aclaración corta: lo que buscaste, el listado de donde salió o una etiqueta de Freesound. Un "Hit" buscado como "tambor" queda **Tambor hit**. Lo podés cambiar a mano en **Nombre del pad**, y se guarda solo.

## Elegir la salida

En **Presets → Salida**, **Elegir salida** abre el selector de audio de iOS, el mismo de AirPlay del Centro de control. Con auriculares Bluetooth, elegí **iPad** y el sonido sale por el parlante; para volver, elegí los auriculares. Con auriculares de cable, iOS no ofrece el parlante: hay que desenchufarlos.

## Salida mono

En **Presets → Salida**, activá **Salida mono** cuando conectes el iPad a una consola o un parlante. Con un cable mono, o en un canal mono de la consola, se pierde el canal derecho o se suman los dos. Los sonidos grabados de un solo lado dejan de sonar, y los que tienen un canal invertido (común en efectos "anchos") se anulan al sumarse. En mono, la app suma los dos canales, manda lo mismo por los dos lados y corrige los sonidos invertidos. Esa corrección se calcula una vez por sonido; al tocar no suma trabajo. Con auriculares o los parlantes del iPad, dejala apagada para conservar el estéreo.

## Igualar volumen

Cada pad tiene la opción **Igualar volumen**, activada de entrada. Mide la loudness del sonido (la parte recortada) con el método de EBU R128 y aplica una ganancia fija para llevarlo a −12 LUFS: baja los sonidos muy comprimidos y sube los bajitos, hasta +15 dB y sin que el pico pase de −1 dBFS. Se calcula una vez al cargar o recortar el sonido; al tocar no suma trabajo. La preescucha del buscador usa el mismo cálculo. En el editor se ve cuánto se corrigió.

Un sonido bajito con un golpe muy fuerte (por ejemplo, un click al principio) casi no sube, porque el golpe ya está cerca del techo de pico. Recortá el golpe y el volumen se recalcula.

## Buscar sonidos en MyInstants

MyInstants no permite que otras páginas lean sus búsquedas ni sus MP3, así que la app los pide a través de un intermediario propio: un Cloudflare Worker gratuito (`worker/myinstants-proxy.js`). Solo consulta páginas de búsqueda y archivos de sonido de myinstants.com, y solo atiende pedidos de esta app.

### Publicar el worker (una sola vez)

1. Creá una cuenta gratis en [dash.cloudflare.com](https://dash.cloudflare.com).
2. Entrá a **Workers & Pages → Create → Create Worker**. Ponele de nombre `botonera-myinstants` y tocá **Deploy**.
3. Tocá **Edit code**, borrá todo el código de ejemplo, pegá el contenido de `worker/myinstants-proxy.js` y tocá **Deploy**.
4. Copiá la dirección del worker. Tiene esta forma: `https://botonera-myinstants.TU-SUBDOMINIO.workers.dev`.

El worker está conectado a este repo (Workers Builds): cada cambio que se sube a `main` lo publica Cloudflare solo, con la configuración de `worker/wrangler.toml`. Desde la terminal también se puede: `cd worker && npx wrangler deploy`.

Si abrís la app desde otra dirección que no sea `https://brunobellinvia.github.io`, agregala a `ALLOWED_ORIGINS` al principio del worker.

### Actualizar el worker

Cuando cambia `worker/myinstants-proxy.js`, hay que volver a publicarlo: en Cloudflare, **Workers & Pages → botonera-myinstants → Edit code**, reemplazá todo por el código nuevo y tocá **Deploy**. Los listados para explorar (Populares, Lo mejor, Recientes y categorías) necesitan la versión que tiene la ruta `/list`.

### Configurarlo en la app

En **Editar**, tocá un pad → **Buscar sonido** → La app ya viene configurada con `https://botonera-myinstants.brunebell8.workers.dev`. Si publicás el worker en otra dirección, cambiala con el botón **Proxy** de esa pantalla; la app prueba la conexión antes de guardarla.

### Uso

- Buscá por texto. En inglés suele haber más resultados.
- Sin buscar, explorá con los listados de arriba: Populares y Lo mejor (de Argentina), Recientes y categorías. La × del buscador borra la búsqueda y vuelve a Populares.
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

- **Guardado automático:** cada cambio (cargar un sonido, recortar, renombrar, mover pads, cambiar la grilla) se guarda solo en la botonera abierta. Si estabas en el kit demo, se crea una botonera nueva ("Mi botonera", "Mi botonera 2"…). **Guardar una copia**, en Presets, la duplica.
- La app le pide a iOS almacenamiento persistente para que no borre sus datos cuando falta espacio. Igual conviene exportar un respaldo de vez en cuando.

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

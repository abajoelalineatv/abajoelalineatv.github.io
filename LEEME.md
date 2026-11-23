# Web de Abajo’e la Línea TV

Sitio estático y gratis: no tiene servidor propio ni base de datos externa.

## Subir una noticia (administrador)
1. Entra a **https://app.pagescms.org** con tu cuenta de GitHub.
2. Elige el repositorio de la web → **Noticias** → **Agregar**.
3. Completa:
   - el título
   - la bajada (resumen)
   - la sección
   - la fecha
   - la foto
   - el texto

   Si quieres que sea la nota principal de la portada, marca **Destacar en portada** (dura una semana). Si todavía no debe publicarse, marca **Borrador**.
4. Presiona **Guardar**. La nota aparece en la web en 1 o 2 minutos.

Para dar acceso a otra persona del equipo: necesita una cuenta de GitHub (gratis) y tú la invitas en Pages CMS → Collaborators.

Las secciones de noticias son las mismas de la web: Comunidad, Deportes, Cultura, Pueblo Mapuche y Opinión. Para agregar o cambiar una sección, edita `categorias` en `config.json` y la lista de `categoria` en `.pages.yml`.

## El panel (Pages CMS), por grupos
- **Publicaciones**
  - **Noticias y columnas:** para las columnas de opinión, elige la sección "Opinión" y completa autor/a, cargo y foto.
  - **Publicidad:** cada aviso lleva imagen, link, dónde se muestra, fechas y la opción de activarlo o pausarlo.
- **El canal**
  - **Programas:** nombre, sección, descripción y palabras que identifican sus videos.
  - **Secciones:** nombre, descripción y palabras para ubicar videos.
- **Textos del sitio:** imagen del lema, textos, "Cómo vernos", "Quiénes somos", contacto y pie de página.

Para agregar personas al equipo sin cuenta de GitHub: en Pages CMS → Settings → Collaborators, invítalas por correo. Pueden editar contenido, pero no la configuración.

## Editar los textos del sitio (administrador)
En Pages CMS → **Textos del sitio** se pueden cambiar sin tocar código:
- el lema y la descripción del canal
- el canal de TV abierta, el correo y el WhatsApp
- las tarjetas de "Cómo vernos"
- la banda "Envía tu nota" y la invitación a Instagram
- la página "Quiénes somos" (texto y datos)
- el pie de página

Se guardan en `content/textos.json`.

## Qué se actualiza solo
- **Videos de YouTube**: cada 2 horas GitHub revisa el canal y agrega los nuevos a `data/videos.json`. Cada video se ubica en su programa y su sección según su título.
- **Señal en vivo**: la portada muestra la señal HLS (`envivo.hls` en `config.json`). Si la señal se cae, aparece un aviso en vez de una pantalla negra.
- **Instagram**: crea una cuenta gratis en behold.so, conecta @abajoelalinea.tv y pega el "Feed ID" en `redes.beholdFeedId`.
- **Botón "Envía tu nota"**: abre un correo. Si pones un número en `sitio.whatsapp` (ej. `56912345678`), abre WhatsApp en su lugar.

## Otros cambios (en `config.json`)
- **Programa nuevo**: agrega un bloque en `programas`. Las `palabras` son textos que aparecen en el título de sus videos en YouTube (ej. `"caseta"`).
- **Video mal ubicado**: en `data/videos.json`, agrégale `"programa": "agora"` o `"categoria": "cultura"`. Para esconderlo: `"oculto": true`.

## Publicar (una sola vez) — solo se necesita una cuenta de GitHub
1. Crear la cuenta del canal en github.com (gratis), con el correo del canal.
2. Crear un repositorio **público** llamado exactamente `<usuario>.github.io` (con el nombre de usuario de la cuenta) y subir esta carpeta.
3. En el repositorio: Settings → Pages → Source: **GitHub Actions**. La web se publica sola con `.github/workflows/publicar.yml` y queda visible en `https://<usuario>.github.io` para revisarla.
4. Conectar el administrador: entrar a app.pagescms.org con la misma cuenta y elegir el repositorio. Probar subir una nota.
5. **Recién cuando todo se vea bien**, mudar el dominio:
   - En NIC Chile, cambiar los DNS de `abajoelalinea.cl` a los registros A de GitHub Pages: 185.199.108.153, 185.199.109.153, 185.199.110.153 y 185.199.111.153. Además, `www` como CNAME a `<usuario>.github.io`.
   - En Settings → Pages → Custom domain, escribir `abajoelalinea.cl`, esperar la verificación y activar "Enforce HTTPS".

## Ver en tu computador
```
npm install
npm run preview
```
Luego abre http://localhost:4321

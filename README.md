# FamilyChat — inicio nuevo

## Incluye
- Acceso Google OAuth con Supabase.
- Clave de invitación inicial: `amoalilli` (se almacena como hash).
- Perfil básico, crear grupos y mensajes de texto en tiempo real.
- Diseño gris claro, gris oscuro y morado.
- Archivos PWA para instalación.

## A. Sube todos los archivos a la raíz del repositorio
`index.html`, `styles.css`, `config.js`, `app.js`, `supabase.sql`, `manifest.webmanifest`, `sw.js`, `icon.svg`, `README.md`.

## B. Configura Supabase
Abre `config.js` y reemplaza los dos textos PEGA_AQUI por Project URL y Publishable key de Supabase → Project Settings → API. No uses la service_role key.

En Supabase → SQL Editor, copia y ejecuta una vez todo `supabase.sql`.

## C. Configura Google
Supabase → Authentication → Sign In / Providers → Google → Enable.
Crea un OAuth Client ID tipo Web en Google Cloud Console. Copia la Callback URL que muestra Supabase y pégala como Authorized redirect URI en Google Cloud.
En Supabase → Authentication → URL Configuration configura Site URL y Redirect URLs con la dirección de GitHub Pages.

## D. Activa GitHub Pages
Repositorio → Settings → Pages → Deploy from a branch → `main` → `/ (root)` → Save.

## Alcance de esta primera versión
Permite entrar con Google, validar invitación, crear un grupo (solo te agrega a ti) y enviar texto en tiempo real. Aún no permite añadir otros miembros, chats privados 1 a 1, fotos, videos ni llamadas. Las llamadas requieren WebRTC y señalización; no están implementadas. No es todavía una app lista para producción ni ofrece cifrado de extremo a extremo.

# INVENTARIO DE SEGURIDAD — BodegApp (Fase 0)

> Documento generado en la Fase 0 del plan (`docs/PLAN-CURSOR-BODEGAPP.md`).
> Objetivo: registrar **todos** los secretos y servidores/dominios externos detectados
> para rotarlos/quitarlos en Fases 1 y 2. **Este archivo NO contiene valores de secretos**,
> solo su ubicación y nombre. NO commitear nunca los valores reales.

Fecha: 2026-07-02
Rama: `fase-0-baseline`

---

## 1. Estado del repositorio git

- El repo **no tenía** `.git` previo: se inicializó en la Fase 0. Por lo tanto **no existe historial
  previo con secretos** que purgar (buena noticia; el objetivo de Fase 1.1 de "purgar historial"
  se reduce a: nunca meterlos y confirmar que el working tree quede limpio).
- Se creó `.gitignore` **antes** del primer commit, excluyendo secretos, `*.db`, `*.lic`, `*.key`,
  `.env` y los `*.json` de estado del license-server. Se verificó que el commit baseline **no**
  incluye ninguno de esos archivos.

## 2. Backup previo

- Copia completa del repo (sin `node_modules/.git/out/dist`) y de los datos locales de la app
  (`%APPDATA%\BodegApp_Data`, incluye `mi-tienda.db`) guardada FUERA del repo en:
  `D:\bodegapp-backups\fase0-<timestamp>\`.

---

## 3. Secretos hardcodeados (⚠️ CONSIDERAR TODOS FILTRADOS → rotar en Fase 1)

| # | Ubicación | Nombre / Tipo | Riesgo | Acción prevista |
|---|-----------|---------------|--------|-----------------|
| 1 | `license-server/private.key` | Clave privada RSA (firma licencias) | **CRÍTICO** — permite firmar licencias válidas | Generar par NUEVO. Privada solo en servidor, nunca en repo. Fase 1/2 |
| 2 | `license-server/server.js:12` | `SECRET_KEY` con fallback `'super-secret-key-change-this-in-env'` | **CRÍTICO** — firma JWT de admin | Env obligatorio, sin fallback (fail-fast). Fase 1 |
| 3 | `license-server/server.js:13` | `SHARED_API_KEY` con fallback `'bodegapp-master-key-2026'` | **CRÍTICO** — bypass de auth admin | Eliminar `authenticateApiKey`. Fase 1/2 |
| 4 | `license-server/server.js:62` | Usuario/clave por defecto `admin` / `admin123` (bcrypt al vuelo) | **ALTO** — credenciales conocidas | Forzar creación de admin en 1er arranque. Fase 1.3 |
| 5 | `src/utils/license.js:20` | `TRIAL_SECRET_KEY = 'bodegapp-secreto-hmac-2024-v1'` | MEDIO — HMAC del trial 72h | Mover a config/servidor; endurecer trial. Fase 1/2 |
| 6 | `src/utils/license.js:199` | `HIST_SECRET = 'bodegapp-secreto-historia-2026-v2'` | MEDIO — cifra historial activación | Rotar/parametrizar. Fase 1/2 |
| 7 | `src/utils/auth.js:4` | `HASH_SECRET = 'bodegapp-super-secreto-para-passwords-2024!'` | **ALTO** — HMAC de clave admin local | Migrar a bcrypt/argon2. Fase 1/2/4 |
| 8 | `src/utils/license.js:10-18` y `license-server/server.js:23-31` | Clave PÚBLICA RSA embebida | Info (no secreto), pero es el par de la privada filtrada | Reemplazar por la nueva pública al rotar. Fase 1/2 |
| 9 | `get-licenses.js` (todo el archivo) | Script que **incrusta** `SHARED_API_KEY`, `SECRET_KEY` y `admin/admin123` para extraer licencias del server de producción | **CRÍTICO** — es en sí mismo una fuga | Eliminar del repo en Fase 1 |

### Contraseñas / hashing a migrar
- `src/utils/auth.js`: usa `HMAC-SHA256` con secreto fijo para la clave admin de la app → migrar a **bcrypt/argon2** (Fase 4 / decisión del dueño).
- `license-server/server.js`: ya usa `bcryptjs` para usuarios del panel, pero con **factor 8** y admin por defecto.

---

## 4. Servidores / dominios externos detectados (quitar/parametrizar en Fase 1.2)

| # | Ubicación | URL / Dominio | Uso | Acción prevista |
|---|-----------|---------------|-----|-----------------|
| 1 | `controllers/license.controller.js:8` | `LICENSE_SERVER_URL` fallback `https://bodegapp.com.ve` | Servidor de licencias (`/admin-licencias/api/check-license`, `/redeem-token`) | Config sin fallback externo; default `http://localhost:PUERTO`. Fase 1/2 |
| 2 | `src/utils/cloudBackup.js:20` | `BACKUP_SERVER_URL` fallback `https://bodegapp.com.ve/respaldo` | Backup en la nube | Desactivar por defecto; opción configurable. Fase 6 |
| 3 | `routes/backup.routes.js:166` | `BACKUP_SERVER_URL` fallback `https://bodegapp.com.ve/respaldo` | Backup en la nube (ruta) | Igual que arriba. Fase 6 |
| 4 | `src/services/bcvUpdater.js:122` | `https://bodegapp.com.ve/tasas/` | Fallback de tasas | Parametrizar. Fase 1 |
| 5 | `src/services/bcvUpdater.js:6` | `https://www.bcv.org.ve/` con `rejectUnauthorized:false` | Scraping tasa BCV | Revisar TLS; parametrizar. Fase 1/3 |
| 6 | `get-licenses.js:9` | `https://bodegapp.com.ve` | Script de extracción de licencias | Eliminar archivo. Fase 1 |
| 7 | `public/config_cloud.html:189` | `https://bodegapp.com.ve/respaldo/api` | Config nube (frontend) | Parametrizar/desactivar. Fase 6 |
| 8 | `public/pos.html:1078`, `public/js/pos.js`, `public/js/reprint.js`, `controllers/sales.controller.js`, `routes/printSettings.routes.js`, `src/utils/settings.js:48` | `https://bodegapp.com.ve` como contenido por defecto del QR del ticket | Cosmético (QR impreso) | Cambiar default a valor neutro/configurable. Fase 1/8 |

---

## 5. Exposición de red / firewall

| Ubicación | Hallazgo | Acción prevista |
|-----------|----------|-----------------|
| `server.js:330` | Fastify escucha en `host: '0.0.0.0'` por defecto | Cambiar default a `127.0.0.1`; LAN opt-in. Fase 3 |
| `server.js:210` | CORS `origin: true` (refleja cualquier origen) | Restringir a orígenes conocidos. Fase 3 |
| `configurar-firewall.bat:14` | Abre rango de puertos TCP `53050-53060` inbound | No abrir por defecto; solo puerto necesario al activar LAN. Fase 3 |
| `license-server/server.js:37` | `cors()` abierto en el panel de licencias | Restringir. Fase 2/3 |

---

## 6. Archivos de estado sensibles del license-server (no versionar)

Contienen datos de clientes/licencias. Ya añadidos a `.gitignore`:
- `license-server/licenses.json` — licencias y HWIDs de clientes reales.
- `license-server/users.json` — usuarios del panel (hashes bcrypt).
- `license-server/invites.json` — invitaciones.
- `license-server/activation_tokens.json` — tokens de activación.
- `license-server/private.key` — clave privada RSA.

Datos locales del cliente (fuera del repo, en `%APPDATA%\BodegApp_Data`): `mi-tienda.db`, `device.id`,
`business-settings.json` (contiene `licenseKey` y `adminPasswordHash`), `uploads/.sys/*.dat` (trial/historial).

---

## 7. Confirmación de build (constancia Fase 0)

- ✅ `node_modules` presente (dependencias instaladas).
- ✅ Chequeo de sintaxis (`node --check`) OK en los **66** archivos `.js` del proyecto (excluyendo `node_modules` y `scratch`).
- ✅ `npm run build:css:prod` (Tailwind minify) termina correctamente → `public/css/output.css`.
- ⚠️ No se pudo verificar el arranque GUI completo de Electron en este entorno headless; se verificó la
  cadena de carga (sintaxis + build de assets). El arranque interactivo debe validarse en máquina con escritorio.

---

## 8. Conflictos con el plan detectados (para revisar en fases siguientes)

1. **El plan asume secretos en el historial de git**, pero el repo no tenía git; se inicializó ahora
   sin incluirlos. No hay historial que purgar con `filter-repo/BFG`.
2. **`check-license` "auto-migra" cualquier licencia firmada a cualquier HWID** (`license-server/server.js:272-339`)
   y el cliente tiene múltiples caminos de bypass offline (`checkActivationHistory`, tolerancia de HWID en
   `src/utils/license.js:408-426`). Esto **contradice** el modelo objetivo "1 licencia = 1 equipo" y
   "la verdad vive en el servidor". Se rediseña en Fase 2.
3. **`authenticateApiKey`** permite administrar el servidor solo con la API key compartida → a eliminar (Fase 2.1).
4. El plan menciona `.env` como algo a sacar del repo, pero **no existe** `.env` en el proyecto; se creará
   `.env.example` en Fase 1.

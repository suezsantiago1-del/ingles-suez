# AGENTS.md — Inglés Suez

Plataforma web para vender y dictar cursos de inglés: landing, registro/login con
verificación por email, compra de cursos vía MercadoPago, aula virtual (classroom)
con lecciones, entregas de alumnos, devoluciones y notas del profesor, certificado
en PDF, chat de clases particulares y panel del profesor.

---

## ⚠️ REGLAS DE EFICIENCIA — LEER PRIMERO

Este proyecto se trabaja con presupuesto de tokens MUY limitado. Estas reglas
tienen prioridad sobre cualquier instinto de explorar o mejorar el código.

1. **NO explores el repo.** El mapa completo está en este archivo. Si algo no
   figura acá, usá `grep -n "loQueBuscás" src/` antes de abrir cualquier archivo.
2. **NUNCA abras estos archivos completos:**
   - `src/config/seeds.js` (~1170 líneas, ~120 KB de HTML de las clases inline).
     Solo se toca para editar el contenido de una lección puntual, y aun así
     con `grep` + rango de líneas, nunca entero.
   - `src/config/database.js` no hace falta abrirlo: el schema completo está
     transcripto más abajo en este archivo.
   - `package-lock.json`
   - `public/img/*` y `public/certificados/*` (imágenes de hasta 5 MB)
3. **Leé por rangos de líneas, no archivos enteros.** Este archivo te da el número
   de línea de cada función. Usá `sed -n '464,533p' archivo` o el equivalente.
4. **Una tarea por sesión.** No agrupes "y de paso arreglá X".
5. **Diff mínimo.** Cambiá solo las líneas necesarias. Prohibido refactorizar,
   renombrar, reordenar imports, reformatear o "limpiar de paso" nada que no se
   haya pedido explícitamente.
6. **No escribas resúmenes largos** ni re-expliques el código en el chat. Reportá:
   qué archivo tocaste, qué líneas, y cómo verificarlo. Nada más.
7. **No levantes el servidor si no hace falta.** Para cambios de lógica alcanza con
   `node --check archivo.js`. Levantá el server solo si el cambio es de vistas o
   de rutas y hay que verlo funcionando.
8. **Si falta información, preguntá.** No adivines ni explores media hora.
   Una pregunta cuesta 100 tokens; explorar el repo cuesta 50.000.

---

## Setup

```bash
npm install
cp .env.example .env     # completar DATABASE_URL, MP_ACCESS_TOKEN, SESSION_SECRET
npm run dev              # node --watch server.js → http://localhost:3000
npm start                # producción
```

### 🛑 ANTES DE LEVANTAR EL SERVIDOR

**Verificá que `DATABASE_URL` apunte a la base de DESARROLLO, nunca a producción.**
Al arrancar, `database.js` crea tablas, corre `ALTER TABLE` y ejecuta los seeds.
Si la variable cargada es la de producción, no levantes el servidor y avisá.
Si no hay una `DATABASE_URL` de desarrollo, verificá el cambio con `node --check`
y lectura de código, sin arrancar la app.

Variables de entorno (`.env`):
- `DATABASE_URL` — PostgreSQL. **Obligatoria**, la app no arranca sin esto.
- `MP_ACCESS_TOKEN` — MercadoPago. Sin esto el checkout falla pero la app levanta.
- `SESSION_SECRET` — secreto de sesión.
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` — Brevo.
- `UPLOADS_DIR` (opcional) — carpeta de videos. Default: `public/videos`.
- `PORT` (opcional) — default 3000.

**No hay tests ni linter.** No inventes ni instales ninguno salvo que se pida.

---

## Stack

- Node.js + **Express 4**, ESM (`"type": "module"` — usar `import`, nunca `require`)
- **EJS** para vistas (server-side rendering, sin framework de frontend)
- **PostgreSQL** con `pg` directo. **Sin ORM, sin migraciones formales.**
- `express-session` (store en memoria — las sesiones se pierden en cada redeploy)
- `bcrypt`, `multer` (videos), `pdf-lib` (certificados), `mercadopago`, `sib-api-v3-sdk` (Brevo)
- CSS plano en `public/css/styles.css`. Sin Tailwind, sin build step, sin bundler.

---

## Mapa del repo

```
server.js                        (306)   Express, sesión, middleware global, multer,
                                 TODAS las rutas menos las de /auth
src/config/database.js           (192)   adapter pg + schema + seed de cursos
src/config/seeds.js              (1171)  ⚠️ NO ABRIR ENTERO. Solo el HTML de las
                                 lecciones iniciales. Se corre si la tabla está vacía.
src/routes/authRoutes.js         (67)    rutas montadas en /auth
src/controllers/authController.js    (540)   login, registro, perfil, verificación, reset
src/controllers/courseController.js  (1417)  cursos, pagos, classroom, entregas,
                                     mensajes, certificados, particulares
src/services/emailService.js     (175)   sendVerificationEmail, sendEmail (Brevo)
src/views/*.ejs                  17 vistas + partials/header.ejs, partials/footer.ejs
public/css/styles.css            (~16 KB) todo el CSS del sitio
```

### Índice de funciones — `src/controllers/courseController.js`

| Línea | Función | Qué hace |
|---|---|---|
| 19 | `renderCourseDetail` | detalle de curso |
| 48 | `processCheckout` | crea preferencia de MercadoPago |
| 122 | `handleMpWebhook` | webhook de pagos |
| 221 | `paymentSuccess` | registra la compra |
| 266 | `paymentFailure` | |
| 275 | `renderMyCourses` | mis cursos |
| 296 | `renderClassroom` | **aula virtual** (lecciones, entregas, anuncios) |
| 465 | `guardarEntrega` | alumno entrega una tarea |
| 535 | `renderPanelProfesor` | panel de entregas del profesor |
| 589 | `guardarDevolucion` | corrección + nota |
| 632 | `saveTeacherNote` | |
| 654 | `renderMensajesAlumno` | ⚠️ exportada e importada pero SIN ruta asignada |
| 727 | `descargarCertificado` | genera el PDF con pdf-lib |
| 853 | `renderPrivateClasses` | clases particulares (alumno) |
| 896 | `guardarConsultaParticulares` | |
| 948 | `enviarMensajeAlumnoChat` | |
| 978 | `renderPanelParticularesProfesor` | |
| 1031 | `guardarRespuestaParticular` | |
| 1077 | `uploadLessonVideo` | subida de video (multer, límite 2 GB) |
| 1206 | `createOrUpdateAnnouncement` | |
| 1229 | `deleteAnnouncement` | |
| 1247 | `updateLessonTeacherNote` | |
| 1264 | `renderMessagesList` | |
| 1285 | `renderMessagesCourse` | |

### Índice de funciones — `src/controllers/authController.js`

| Línea | Función |
|---|---|
| 6 / 13 | `renderLogin` / `processLogin` |
| 95 / 102 | `renderRegister` / `processRegister` |
| 160 | `logout` |
| 170 / 190 / 215 | `renderProfile` / `updateProfile` / `updatePassword` |
| 242 / 247 / 316 | `renderVerifyEmail` / `verifyEmail` / `resendVerification` |
| 378 / 382 | `renderForgotPassword` / `processForgotPassword` |
| 481 / 486 | `renderResetPassword` / `processResetPassword` |

> Los números de línea son de la última revisión. Si no coinciden, no leas el
> archivo entero: usá `grep -n "nombreDeLaFuncion" archivo.js`.

---

## Rutas

**En `server.js`:**

| Método | Ruta | Handler / vista |
|---|---|---|
| GET | `/` | index (lista cursos) |
| GET | `/about` | about |
| GET | `/cursos-todos` | courses |
| GET | `/course/:id` | `renderCourseDetail` |
| POST | `/checkout/:id` | `processCheckout` |
| GET | `/payment/success` \| `/payment/failure` | |
| POST | `/mercadopago/webhook` | `handleMpWebhook` |
| GET | `/mis-cursos` | `renderMyCourses` |
| GET | `/classroom/:cursoId` | `renderClassroom` |
| GET | `/classroom/:cursoId/certificado` | `descargarCertificado` |
| POST | `/entregas` | `guardarEntrega` |
| GET | `/profesor/entregas` | `renderPanelProfesor` |
| POST | `/profesor/devolucion` \| `/nota` \| `/anuncio` \| `/leccion/nota` \| `/leccion/video` | |
| DELETE | `/profesor/anuncio` | `deleteAnnouncement` |
| GET | `/messages` \| `/messages/:courseId` | lista y detalle |
| GET | `/clases-particulares` + POST `/enviar`, `/enviar-mensaje` | |
| GET | `/profesor/particulares` + POST `/responder` | |

**En `src/routes/authRoutes.js` (prefijo `/auth`):**
`/login`, `/register`, `/logout`, `/verify/:token`, `/verify-email`,
`/resend-verification`, `/forgot-password`, `/reset-password/:token`,
`/profile`, `/profile/update`, `/profile/password`.

⚠️ **Rutas duplicadas:** las de clases particulares están declaradas **dos veces**
— en `server.js` (nivel raíz) y en `authRoutes.js` (bajo `/auth`). Al tocar
cualquier cosa de particulares, revisá los dos lugares.

---

## Base de datos

PostgreSQL. Acceso siempre a través de `dbPromise` (`src/config/database.js`):

```js
import dbPromise from './src/config/database.js';
const db = await dbPromise;

await db.get('SELECT * FROM usuarios WHERE email = ?', [email]);  // 1 fila o null
await db.all('SELECT * FROM cursos');                             // array
await db.run('INSERT INTO compras (...) VALUES (?, ?)', [a, b]);  // { lastID, changes }
```

**Los `?` se convierten automáticamente a `$1, $2...` dentro del adapter.** Escribí
siempre `?`, nunca `$1` — salvo si usás `adapter.pgPool.query()` directo (solo
aparece dentro de `database.js`).

### Schema completo — no hace falta abrir `database.js` para esto

```sql
usuarios(id SERIAL PK, nombre, email UNIQUE, password, email_verificado BOOL,
         verification_token, verification_token_expires TIMESTAMP)

cursos(id SERIAL PK, titulo, descripcion, precio INT, imagen_url, instructor_email)

compras(id SERIAL PK, usuario_id, curso_id, fecha TIMESTAMP)

lecciones(id SERIAL PK, curso_id, titulo, modulo, orden INT, video_url,
          contenido_html TEXT, teacher_note TEXT)

entregas(id SERIAL PK, usuario_id, curso_id, leccion_id, contenido TEXT,
         teacher_notes TEXT, fecha TIMESTAMP)

devoluciones(id SERIAL PK, entrega_id UNIQUE, usuario_id, mensaje TEXT,
             nota INT NULL, leida BOOL, fecha TIMESTAMP)

mensajes_particulares(id SERIAL PK, usuario_id FK, modalidad, objetivo,
                      mensaje_alumno TEXT, respuesta_profesor TEXT,
                      fecha_consulta, fecha_respuesta)

chat_mensajes_particulares(id SERIAL PK, consulta_id FK, usuario_id FK,
                           emisor VARCHAR(20), mensaje TEXT, fecha)

curso_anuncios(id SERIAL PK, curso_id, mensaje TEXT, created_at, updated_at)
```

**No hay sistema de migraciones.** Para agregar una columna se usa
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` dentro de `database.js` (~línea 119-129).

---

## Autenticación y roles

- Usuario logueado: `req.session.user` → `{ id, nombre, email }`.
- No hay campo `rol` en la base. **El profesor se identifica comparando el email**
  contra la constante `EMAIL_PROFESOR`, definida **una sola vez** al principio de
  `src/controllers/courseController.js` (línea ~17) y configurable con la variable
  de entorno `EMAIL_PROFESOR`.
- Algunas vistas comparan además contra `curso.instructor_email`.

Si agregás un endpoint bajo `/profesor/*`, copiá el chequeo que ya usan las
funciones existentes. No redeclares `EMAIL_PROFESOR` dentro de la función: la
constante del módulo ya está en scope.

---

## Convenciones

- ESM en todo el proyecto: `import` / `export const`. Nunca `require`.
- Nombres de tablas, columnas, variables y funciones **en español**
  (`usuarios`, `guardarEntrega`, `cursoId`). Mantener ese criterio.
- Controllers = `export const nombre = async (req, res) => {}`.
- Errores: `try/catch` con `console.error(...)` y respuesta al usuario.
  Endpoints JSON devuelven `{ success: false, message: '...' }`.
- Vistas EJS en `src/views/`, parciales en `src/views/partials/`.
  `res.render('nombre', { datos })` — sin extensión.
- Variables disponibles en toda vista (middleware global de `server.js`):
  `user`, `comprasIds`, `mensajesNoLeidos`.
- CSS: agregar al final de `public/css/styles.css`. No crear archivos CSS nuevos.
- Commits en español, imperativo, una línea. Ej: `arregla validación de nota vacía`.

---

## Trampas conocidas (leer antes de tocar)

1. `database.js` corre `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN
   IF NOT EXISTS` y los seeds en **cada arranque**. Los seeds son condicionales
   (`IF COUNT = 0`): no rompas esa condición o vas a duplicar cursos y lecciones.
2. Los permisos de profesor se resuelven comparando emails, no con un campo `rol`.
   Ver la sección "Autenticación y roles".
3. Las rutas de clases particulares están declaradas dos veces: en `server.js` y
   en `authRoutes.js`. Al tocarlas, revisá los dos lugares.
4. Las sesiones viven en memoria: se cierran todas en cada reinicio. Es esperado.
5. Los uploads de video van al disco local (`public/videos`). El filesystem de
   Render es efímero: **los videos se borran en cada deploy**. Es un problema
   conocido y estructural, no lo "arregles" sin que te lo pidan (la solución real
   es mover los videos a un storage externo o a YouTube sin listar).
6. No abras ni proceses los archivos de `public/img/` y `public/certificados/`.
   `firma.jpg` se embebe en el PDF del certificado con `embedJpg`: **tiene que
   seguir siendo JPG**. Las rutas de los logos están guardadas en
   `cursos.imagen_url` en la base: si renombrás una imagen, rompés las tarjetas.

---

## Deploy

Producción corre en **Render** (plan free), con auto-deploy desde la rama `main`.
Los `.env` se cargan como variables de entorno en el dashboard de Render, no
desde archivo.

Comportamiento del plan free que **NO es un bug** — no lo investigues:

- El servicio se duerme tras 15 minutos sin tráfico. La primera visita después
  tarda entre 30 y 60 segundos en responder. Un timeout en la primera request no
  es un bug del código.
- La base Postgres free de Render expira 30 días después de creada.
- Los archivos subidos al disco desaparecen en cada deploy (ver punto 5 arriba).

Si algo falla solo en producción y no en desarrollo, pedí el **stack trace de los
logs de Render** antes de empezar a investigar. No intentes reproducirlo a ciegas.

---

## Cómo verificar un cambio (sin tests)

No hay tests. La verificación es manual y en este orden, parando en cuanto alcance:

1. `node --check <archivo modificado>` — sintaxis. Siempre.
2. Si tocaste SQL: comparar nombres de tabla y columna contra el schema de arriba.
   No hay tipado ni ORM: un typo pasa silencioso hasta runtime en producción.
3. Si tocaste una vista, una ruta o algo visual: `npm run dev` (**solo con la
   `DATABASE_URL` de desarrollo**) y probar únicamente la URL afectada. No navegar
   el sitio entero.
4. **Nunca deployees ni hagas merge a `main` para probar.** `main` tiene
   auto-deploy a producción. Dejá el cambio en un branch y en un PR; el deploy lo
   decide una persona.

Reportar en 3 líneas: archivo + líneas tocadas + cómo probarlo. Nada más.

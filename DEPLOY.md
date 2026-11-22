# Deploy

La app corre en un VPS propio (Ubuntu + Docker), detrás de un reverse proxy
Caddy que ya está andando y que termina TLS para todos los sitios del
servidor. Este repo se clona en `/opt/apps/inglesuez/` y se levanta con su
propio `docker-compose.prod.yml`.

Dos contenedores y nada más: `inglesuez-web` (Node) e `inglesuez-db`
(Postgres 18).

---

## Antes que nada: los videos van por YouTube

Se sube el video a YouTube como **"no listado"** (no aparece en búsquedas ni
en el canal, pero lo ve cualquiera con el link) y se pega el link en el campo
de URL del panel del profesor. La app lo normaliza a `/embed/` sola: sirven
tanto `youtube.com/watch?v=...` como `youtu.be/...`.

No es una limitación caprichosa. Servir los videos desde el VPS cuesta caro de
un modo poco obvio: el backup del servidor re-comprime todos los volúmenes de
la app cada noche y retiene 34 copias, así que 6 GB de clases se convierten en
~200 GB de backups —más que el disco entero— y encima cada alumno que mira el
curso se baja esos GB por el mismo caño que usan las otras apps del servidor.

La subida de archivos sigue en el código, apagada detrás de
`ALLOW_LOCAL_VIDEO_UPLOAD`. En el VPS **no hay que prenderla**: el contenedor
no monta volumen para videos, así que el archivo se escribiría en la capa
efímera y desaparecería en el próximo redeploy, dejando la lección en un 404.

---

## Primer deploy

**En el servidor**, con el usuario que administra `/opt/apps/`:

```bash
git clone git@github.com:suezsantiago1-del/ingles-suez.git /opt/apps/inglesuez
```

El directorio va en **750**, no 755: adentro está el `.env` con la contraseña
de Postgres, la key de Brevo y el token de MercadoPago.

```bash
chmod 750 /opt/apps/inglesuez
cp /opt/apps/inglesuez/.env.example /opt/apps/inglesuez/.env
```

Completar el `.env` con los valores reales. Los obligatorios son
`POSTGRES_PASSWORD`, `SESSION_SECRET`, `MP_ACCESS_TOKEN` y `BREVO_API_KEY`.
Para el secreto de sesión:

```bash
openssl rand -base64 48
```

Levantar:

```bash
cd /opt/apps/inglesuez && docker compose -f docker-compose.prod.yml up -d --build
```

El primer arranque crea las tablas, corre los `ALTER TABLE`, los índices y
siembra los dos cursos y las lecciones iniciales. Tarda; por eso el
healthcheck tiene `start_period: 60s`.

Verificar:

```bash
docker compose -f docker-compose.prod.yml ps
docker exec inglesuez-web wget -qO- http://127.0.0.1:3000/health
```

Tiene que responder `{"ok":true}`. Ese endpoint hace un `SELECT 1` contra la
base, así que un `healthy` significa que la app puede consultar, no solo que
el puerto está abierto.

Falta el bloque del dominio en el Caddyfile del servidor, que vive en el repo
de infraestructura y no acá. Apunta a `inglesuez-web:3000` por la red
`web` de Docker.

---

## Actualizar

**En el servidor:**

```bash
cd /opt/apps/inglesuez && git pull && docker compose -f docker-compose.prod.yml up -d --build
```

Las sesiones ya **no** se pierden en el redeploy: viven en la tabla `session`
de Postgres, no en la memoria del proceso.

---

## Cosas que conviene saber

**El schema se crea solo, en cada arranque.** No hay migraciones:
`database.js` corre `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN
IF NOT EXISTS` y `CREATE INDEX IF NOT EXISTS` cada vez que la app levanta. Es
idempotente, pero implica que **la app tiene permisos de DDL sobre su base**.

**Los seeds no pisan datos.** Las lecciones iniciales se insertan solo si la
tabla `lecciones` está vacía, y los cursos solo si `cursos` está vacía.

**`SEED_TEST_DATA` se ignora con `NODE_ENV=production`**, que el compose fija
siempre. No hay forma de que los usuarios de prueba entren a producción por
un `.env` mal copiado.

**Los mails salen por la API HTTP de Brevo**, no por SMTP: el contenedor no
necesita abrir el 587 hacia afuera.

**El remitente tiene que ser del dominio propio**, no un gmail. Sobre
`gmail.com` no se puede publicar la clave DKIM que Brevo necesita —el DNS es
de Google—, así que un mail que dice venir de ahí pero sale de Brevo falla la
alineación DMARC y cae en spam. Y el mail de verificación es lo que habilita
la cuenta del alumno.

Para que funcione hay que autenticar `inglesuez.com` en Brevo (*Senders,
Domains & Dedicated IPs* → *Domains*) y cargar en la zona DNS de DonWeb los
registros que Brevo devuelve, más estos dos:

| Tipo | Nombre | Valor |
|---|---|---|
| TXT | `@` | `v=spf1 include:spf.brevo.com ~all` |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:suezsantiago1@gmail.com` |

DMARC arranca en `p=none`: durante unas semanas solo reporta, no bloquea.
Recién cuando los reportes muestren que todo sale alineado se sube a
`quarantine`.

Después va `EMAIL_REMITENTE=no-responder@inglesuez.com` en el `.env`. Esa
dirección no necesita casilla: las respuestas se redirigen a `EMAIL_PROFESOR`
con un `Reply-To`.

**Nada de esto publica puertos al host.** Solo Caddy escucha en 80/443; la
base ni siquiera está en la red `web`, así que ninguna otra app del servidor
la ve.

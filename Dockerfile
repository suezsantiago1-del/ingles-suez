# syntax=docker/dockerfile:1
#
# Imagen de producción de Inglés Suez.
#
# No hay build step: EJS se renderiza en el servidor y el CSS es un archivo
# plano en public/. Lo único que hace falta armar son las dependencias, y por
# eso el multi-stage es corto: separa `npm ci` del resto para que la capa de
# node_modules salga de cache mientras package-lock.json no cambie.

# ===========================================================================
# 1. Dependencias
# ===========================================================================
FROM node:22-alpine AS deps

WORKDIR /app

# Solo los manifiestos: mientras no cambien, esta capa no se reconstruye
# aunque cambie todo el código.
COPY package.json package-lock.json ./

# `npm ci` y no `npm install`: instala exactamente lo que dice el lock y falla
# si quedó desincronizado con package.json, en vez de resolver por su cuenta y
# desplegar versiones que nadie probó.
#
# --omit=dev no saca nada hoy (el proyecto no tiene devDependencies), pero deja
# el build correcto si algún día se agrega una.
RUN npm ci --omit=dev


# ===========================================================================
# 2. Imagen final
# ===========================================================================
FROM node:22-alpine

# NODE_ENV=production no es decorativo acá: Express cachea las plantillas EJS
# compiladas solo en producción, y server.js lo usa para exigir SESSION_SECRET
# y para marcar la cookie de sesión como `secure`.
ENV NODE_ENV=production

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# bcrypt es un módulo nativo. Desde la v6 trae los binarios ya compilados para
# glibc y para musl dentro del propio paquete (prebuildify + node-gyp-build),
# así que alpine no necesita python ni build-base para instalarlo. Si alguna
# vez se vuelve a bcrypt 5, esto deja de ser cierto: esa versión compila con
# node-pre-gyp y el build se cae en esta imagen.

# server.js hace mkdir de esta carpeta al arrancar. Creada acá y con dueño
# `node`, porque el proceso no corre como root y /app es de root.
RUN mkdir -p /app/public/videos && chown -R node:node /app/public/videos

# Sin privilegios. La imagen de Node ya trae el usuario `node` (uid 1000).
USER node

EXPOSE 3000

CMD ["node", "server.js"]

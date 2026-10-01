# Multi-stage build: compile the Vite SPA to static files, then serve those files with nginx.
# This is a plain static site once built - no Node process needs to keep running in production.

FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Vite automatically picks up .env.production for a `vite build` (mode defaults to
# "production") - see .env.production's own comment for why that file is committed, not secret.
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template
# Cloud Run sets $PORT at container start (not build time) and expects the container to listen
# on it - nginx's own image already runs envsubst over everything in
# /etc/nginx/templates/*.template into /etc/nginx/conf.d/*.conf before starting, so this just
# relies on that built-in entrypoint behavior rather than writing a custom one.
EXPOSE 8080
ENV PORT=8080

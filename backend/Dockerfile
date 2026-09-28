# TalcTech Rooms backend - Cloud Run deployment image.
#
# Cloud Run injects PORT at runtime and expects the container to listen on it - src/config's
# `port: parseInt(process.env.PORT || '4000', 10)` already does this, so no code change was
# needed for that part.
#
# Database connectivity in production is a Cloud SQL Postgres instance, reached over the Unix
# socket Cloud Run mounts automatically when you attach a Cloud SQL instance to the service
# (`/cloudsql/<INSTANCE_CONNECTION_NAME>`) - no extra npm package needed, `pg` supports this via a
# connection string of the form `postgres://USER:PASSWORD@/DBNAME?host=/cloudsql/INSTANCE_CONNECTION_NAME`
# set as the deployed service's DATABASE_URL. See backend/DEPLOY.md for the full setup.

FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "src/server.js"]

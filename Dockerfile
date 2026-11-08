# Stages:
#   dev   - all workspace deps; source is bind-mounted by docker-compose (api / frontend, hot reload)
#   batch - production batch image (same image runs on ECS and via `docker compose run batch`)
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Only the manifests, so dependency layers stay cached across source edits.
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/

FROM base AS dev
RUN npm ci --workspace backend --workspace frontend
EXPOSE 3000 8080

FROM base AS build
RUN npm ci --workspace backend
COPY tsconfig.base.json ./
COPY backend/ backend/
RUN npm -w backend run build

FROM base AS batch
ENV NODE_ENV=production
RUN npm ci --workspace backend --omit=dev && npm cache clean --force
COPY --from=build /app/backend/dist backend/dist
WORKDIR /app/backend
USER node
ENTRYPOINT ["node", "dist/batch/main.js"]

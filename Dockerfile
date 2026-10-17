# syntax=docker/dockerfile:1.7
#
# DineDesk production image (multi-stage).
#   runner  – minimal Next.js standalone server, non-root (default target)
#   tools   – full toolchain for one-off jobs: migrations, admin bootstrap, demo seed
#
# No secrets are baked in: configuration comes from the environment at runtime
# (.env.production via docker-compose.yml). .dockerignore keeps .env files out
# of the build context entirely.

ARG NODE_VERSION=24.19.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# openssl/ca-certificates: required by the Prisma CLI (migrations) and TLS to external services.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ── Dependencies (cached unless package files change) ────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
# prisma.config.ts requires DATABASE_URL to be defined; generation does not
# connect, so a non-secret placeholder is enough at build time.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npm ci --no-audit --no-fund

# ── Build ────────────────────────────────────────────────────────────────────
FROM deps AS builder
COPY . .
ENV NODE_ENV=production NEXT_OUTPUT=standalone
RUN npm run build

# ── Tools: migrations, admin bootstrap, optional demo seed ──────────────────
FROM deps AS tools
COPY . .
# Defence in depth: .dockerignore already excludes env files.
RUN rm -f .env .env.production
ENV NODE_ENV=production
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# Exec form: node receives SIGTERM directly (compose adds an init process) and
# Next.js closes the HTTP server gracefully.
CMD ["node", "server.js"]

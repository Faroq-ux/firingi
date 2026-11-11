# FIRINGI production image — portable: any Docker host, VM or container platform.
#   docker build -t firingi .                    → the web app (target "app", the default)
#   docker build -t firingi-tools --target tools .  → migrations / seed / one-off scripts
#   docker build -t firingi-ops --target ops .      → scheduler + backups (pg_dump 16, curl, openssl)
# See docs/operations.md.

FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm prisma generate && NEXT_TELEMETRY_DISABLED=1 pnpm build

# Migrations, seed and maintenance scripts (has the full dependencies + Prisma CLI).
FROM deps AS tools
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma.config.ts tsconfig.json package.json ./
COPY prisma ./prisma
COPY src ./src
ENV NODE_ENV=production
CMD ["pnpm", "prisma", "migrate", "deploy"]

# Scheduler and backups: small, no Node — PostgreSQL 16 client tools to match the database.
FROM postgres:16-bookworm AS ops
RUN apt-get update && apt-get install -y --no-install-recommends curl openssl ca-certificates tzdata && rm -rf /var/lib/apt/lists/*
COPY scripts/ops/ /opt/firingi/
RUN chmod +x /opt/firingi/*.sh
USER postgres
WORKDIR /tmp
CMD ["/opt/firingi/scheduler.sh"]

# The web app: Next.js standalone server, non-root.
FROM node:22-bookworm-slim AS app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl && rm -rf /var/lib/apt/lists/* \
  && groupadd -g 1001 firingi && useradd -u 1001 -g firingi -m firingi
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 STORAGE_DIR=/app/storage
ARG GIT_COMMIT=dev
ENV GIT_COMMIT=$GIT_COMMIT
COPY --from=build --chown=firingi:firingi /app/.next/standalone ./
COPY --from=build --chown=firingi:firingi /app/.next/static ./.next/static
COPY --from=build --chown=firingi:firingi /app/public ./public
RUN mkdir -p /app/storage && chown firingi:firingi /app/storage
USER firingi
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]

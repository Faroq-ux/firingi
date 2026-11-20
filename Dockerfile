# FIRINGI production images — portable: any Docker host, VM or container platform.
#   docker build -t firingi .                          → the web app + scheduler (target "app", the default)
#   docker build -t firingi-tools --target tools .     → migrations / first admin / one-off scripts
#   docker build -t firingi-ops --target ops .         → backups (pg_dump 16, curl, openssl)
# Building behind a company proxy that inspects HTTPS: put its CA certificate (*.crt) in
# docker/certs/ and pass --build-arg https_proxy=… (docs/operations.md › Building).

# Build stages use the full Node image: OpenSSL (for Prisma) and CA certificates are already there,
# so the build never needs a Linux package mirror.
FROM node:22-bookworm AS base
COPY docker/certs/ /tmp/certs/
RUN cat /tmp/certs/*.crt > /usr/local/share/extra-ca.pem 2>/dev/null; true
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/extra-ca.pem NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
# The few system libraries the slim runtime image needs (Prisma's engine links OpenSSL 3).
RUN mkdir -p /runtime-libs && cp /usr/lib/*-linux-gnu/libssl.so.3 /usr/lib/*-linux-gnu/libcrypto.so.3 /runtime-libs/
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
# The build needs a large JS heap (about 11 GB at the moment); give the build machine ≥ 16 GB of memory.
# FIRINGI_LOW_MEMORY_BUILD=1 turns off webpack's persistent cache, which a one-off image build never reuses.
ARG BUILD_HEAP_MB=11264
ENV NODE_OPTIONS=--max-old-space-size=${BUILD_HEAP_MB} FIRINGI_LOW_MEMORY_BUILD=1
COPY . .
RUN pnpm prisma generate && pnpm build

# Migrations, first super admin, maintenance scripts (full dependencies + Prisma CLI).
FROM deps AS tools
COPY prisma.config.ts tsconfig.json package.json ./
COPY prisma ./prisma
COPY src ./src
RUN pnpm prisma generate
ENV NODE_ENV=production
CMD ["pnpm", "prisma", "migrate", "deploy"]

# Backups: PostgreSQL 16 client tools to match the database, plus curl for reports / S3.
FROM postgres:16-bookworm AS ops
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY scripts/ops/*.sh /opt/firingi/
RUN chmod +x /opt/firingi/*.sh
USER postgres
WORKDIR /tmp
CMD ["/opt/firingi/backup-loop.sh"]

# The web app: Next.js standalone server on the slim Node image, non-root. Also runs the scheduler
# (node ops/scheduler.mjs) so that needs no other image.
FROM node:22-bookworm-slim AS app
COPY --from=base /runtime-libs/ /usr/local/lib/
COPY --from=base /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN ldconfig && groupadd -g 1001 firingi && useradd -u 1001 -g firingi -m firingi
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 STORAGE_DIR=/app/storage
ARG GIT_COMMIT=dev
ENV GIT_COMMIT=$GIT_COMMIT
COPY --from=build --chown=firingi:firingi /app/.next/standalone ./
COPY --from=build --chown=firingi:firingi /app/.next/static ./.next/static
COPY --from=build --chown=firingi:firingi /app/public ./public
COPY --chown=firingi:firingi scripts/ops/scheduler.mjs ./ops/scheduler.mjs
RUN rm -rf /app/storage && mkdir -p /app/storage && chown firingi:firingi /app/storage
USER firingi
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

# One image for the whole self-hosted stack: web app, ingest server and migrations.
# Built by ./hostpog up (deploy/selfhost.compose.yml). The browser-facing ingest URL is baked into the web build.
FROM node:26-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
ARG NEXT_PUBLIC_HOSTPOG_INGEST_URL=http://localhost:3001
# Placeholders so modules that set up clients at import time load during `next build`. Nothing connects at build
# time, and none of these reach the runtime image (real values come from deploy/.env via compose).
RUN NEXT_PUBLIC_HOSTPOG_INGEST_URL=$NEXT_PUBLIC_HOSTPOG_INGEST_URL NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=postgres://build:build@127.0.0.1:1/build BETTER_AUTH_SECRET=build-only-placeholder \
    HOSTPOG_MASTER_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
    pnpm --filter @hostpog/web build

FROM node:26-slim
RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates && rm -rf /var/lib/apt/lists/*
# pnpm is fetched once here, at build time. Containers then start without network access to npm (offline hosts work),
# and COREPACK_ENABLE_NETWORK=0 makes that a guarantee rather than a hope.
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate
ENV COREPACK_ENABLE_NETWORK=0 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000 3001
CMD ["pnpm", "--filter", "@hostpog/web", "start"]

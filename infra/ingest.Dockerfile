# HostPog ingest server for Railway. Runs Postgres migrations on start (inside Railway's private network), then serves /v1/capture.
FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@hostpog/ingest..." --filter "@hostpog/db..."
ENV NODE_ENV=production INGEST_HOST=0.0.0.0 INGEST_PORT=8080 HOSTPOG_TRUST_PROXY=1
EXPOSE 8080
CMD ["sh", "-c", "pnpm --filter @hostpog/db run migrate && pnpm --filter @hostpog/ingest start"]

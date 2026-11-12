# The Veyra server. It needs Node 22 (node:sqlite) and a writable /data volume.
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @veyra/server...
COPY apps/server apps/server
RUN pnpm --filter @veyra/server build

FROM node:22-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATABASE_PATH=/data/veyra.db EVIDENCE_DIR=/data/evidence
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/server/node_modules apps/server/node_modules
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/package.json apps/server/
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "apps/server/dist/index.js"]

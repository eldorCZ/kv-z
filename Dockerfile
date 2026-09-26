# syntax=docker/dockerfile:1
# ---------- build ----------
FROM node:22-bookworm AS build
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /src
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/export/package.json packages/export/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @kvizhub/web build && pnpm --filter @kvizhub/server build
# production node_modules for the server only (workspace packages are bundled into dist/index.js)
RUN pnpm --filter @kvizhub/server --prod deploy --legacy /out \
 && rm -rf /out/src /out/test /out/build.mjs /out/tsconfig.json /out/node_modules/@kvizhub \
 && cp -r apps/server/dist /out/dist \
 && mkdir -p /out/web /out/fixtures \
 && cp -r apps/web/dist/. /out/web/ \
 && cp fixtures/kahoot-template.xlsx /out/fixtures/

# ---------- runtime ----------
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    DB_PATH=/data/kvizhub.db \
    WEB_DIST=/app/web \
    KAHOOT_TEMPLATE_PATH=/app/fixtures/kahoot-template.xlsx \
    BIND_ADDR=0.0.0.0 \
    APP_PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /out /app
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.APP_PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/index.js"]

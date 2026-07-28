FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS dependencies

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build

COPY tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts index.html ./
COPY src ./src
COPY server ./server
RUN bun run build \
    && NODE_ENV=production bun build server/index.ts --target=bun --outfile /tmp/gbrain-server/index.js

FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS runtime

ENV NODE_ENV=production
WORKDIR /app

USER root
RUN apk upgrade --no-cache

COPY --from=build /app/dist ./dist
COPY --from=build /tmp/gbrain-server/index.js ./server/index.js

USER bun
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=6 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:'+(process.env.APP_PORT||'3000')+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["bun", "server/index.js"]

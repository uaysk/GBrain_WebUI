FROM oven/bun:1.3.14 AS dependencies

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build

COPY tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts index.html ./
COPY src ./src
COPY server ./server
RUN bun run build

FROM oven/bun:1.3.14 AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=dependencies --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/dist ./dist
COPY --from=build --chown=bun:bun /app/server ./server
COPY --from=build --chown=bun:bun /app/src/types.ts ./src/types.ts
COPY --chown=bun:bun package.json ./package.json

USER bun
EXPOSE 3000

CMD ["bun", "server/index.ts"]

FROM node:24.17.0-bookworm-slim AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY infra ./infra

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @three-zero-four/contracts build
RUN pnpm --filter @three-zero-four/game-service build
RUN pnpm --filter @three-zero-four/game-service --prod deploy --legacy /opt/game-service

FROM node:24.17.0-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build --chown=node:node /opt/game-service ./
COPY --from=build --chown=node:node /app/infra/postgres/migrations ./infra/postgres/migrations

USER node
EXPOSE 4100
CMD ["node", "dist/src/server.js"]

FROM node:24.18.0-bookworm-slim@sha256:cb4e8f7c443347358b7875e717c29e27bf9befc8f5a26cf18af3c3dec80e58c5 AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY infra ./infra

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @three-zero-four/gameplay build
RUN pnpm --filter @three-zero-four/room-domain build
RUN pnpm --filter @three-zero-four/contracts build
RUN pnpm --filter @three-zero-four/game-service build

FROM build AS test

FROM build AS production-deps
RUN pnpm --filter @three-zero-four/game-service --prod deploy --legacy /opt/game-service

FROM debian:12.14-slim@sha256:60eac759739651111db372c07be67863818726f754804b8707c90979bda511df AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build --chown=65532:65532 /usr/local/bin/node /usr/local/bin/node
COPY --from=production-deps --chown=65532:65532 /opt/game-service ./
COPY --from=build --chown=65532:65532 /app/infra/postgres/migrations /infra/postgres/migrations

USER 65532:65532
EXPOSE 4100
CMD ["/usr/local/bin/node", "dist/src/server.js"]

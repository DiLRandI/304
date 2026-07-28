FROM node:24.18.0-bookworm-slim@sha256:cb4e8f7c443347358b7875e717c29e27bf9befc8f5a26cf18af3c3dec80e58c5 AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

ARG NEXT_PUBLIC_GAME_SERVICE_URL
ENV NEXT_PUBLIC_GAME_SERVICE_URL=$NEXT_PUBLIC_GAME_SERVICE_URL

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @three-zero-four/contracts build
RUN pnpm --filter @three-zero-four/web build

FROM debian:12.14-slim@sha256:60eac759739651111db372c07be67863818726f754804b8707c90979bda511df AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=build --chown=65532:65532 /usr/local/bin/node /usr/local/bin/node
COPY --from=build --chown=65532:65532 /app/apps/web/.next/standalone ./
COPY --from=build --chown=65532:65532 /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=65532:65532 /app/apps/web/public ./apps/web/public

USER 65532:65532
EXPOSE 3000
CMD ["/usr/local/bin/node", "apps/web/server.js"]

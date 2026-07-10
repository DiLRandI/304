FROM node:24.17.0-bookworm-slim AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

ARG NEXT_PUBLIC_GAME_SERVICE_URL
ENV NEXT_PUBLIC_GAME_SERVICE_URL=$NEXT_PUBLIC_GAME_SERVICE_URL

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @three-zero-four/web build

FROM node:24.17.0-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public

USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

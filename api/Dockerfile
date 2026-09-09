# Build stage: full dev dependencies, generate the Prisma client, compile to JS.
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Runtime stage: production dependencies plus the compiled output.
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# dumb-init reaps zombies and forwards signals, so SIGTERM actually reaches Node
# and the graceful shutdown path runs instead of the container being killed.
RUN apk add --no-cache dumb-init

COPY package*.json ./
RUN npm ci --omit=dev

# The Prisma CLI is needed at start for `migrate deploy`, and generate needs the
# schema. The seed runs as compiled JS, so tsx is deliberately not installed.
RUN npm install --no-save prisma@6.19.3
COPY prisma ./prisma
RUN npx prisma generate

COPY --from=build /app/dist ./dist

# Never run as root: a container escape should not start with uid 0. The node
# image already ships an unprivileged `node` user.
RUN chown -R node:node /app
USER node

EXPOSE 4000

# Reports unhealthy when the process cannot serve traffic, so an orchestrator
# can replace the instance rather than keep routing to it.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:4000/health/live',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/src/server.js"]

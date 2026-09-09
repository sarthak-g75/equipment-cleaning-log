# Build stage: full dev dependencies, compile TypeScript, generate Prisma client.
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime stage: production deps only, plus the generated client and compiled JS.
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

# `prisma migrate deploy` and `db seed` run at container start, so the CLI,
# the schema and the (TypeScript) seed script all have to be present at runtime.
RUN npm install --no-save prisma@6.19.3 tsx@4.23.13
COPY prisma ./prisma
RUN npx prisma generate

COPY --from=build /app/dist ./dist

EXPOSE 4000
CMD ["node", "dist/server.js"]

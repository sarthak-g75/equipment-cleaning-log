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

COPY package*.json ./
RUN npm ci --omit=dev

# The Prisma CLI is needed at start for `migrate deploy`, and generate needs the
# schema. The seed runs as compiled JS, so tsx is deliberately not installed here.
RUN npm install --no-save prisma@6.19.3
COPY prisma ./prisma
RUN npx prisma generate

COPY --from=build /app/dist ./dist

EXPOSE 4000
CMD ["node", "dist/src/server.js"]

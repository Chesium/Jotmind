# Build
FROM node:20-alpine AS build
WORKDIR /repo
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm nx build api

# Runtime
# FROM node:20-alpine
# WORKDIR /app
# ENV NODE_ENV=production
# COPY --from=build /repo/dist/apps/api ./dist
# COPY --from=build /repo/apps/api/package.json .
# COPY --from=build /repo/node_modules ./node_modules
# CMD ["node", "dist/main.js"]

# Runtime
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/dist/api ./dist
# COPY --from=build /repo/api/package.json .
COPY --from=build /repo/node_modules ./node_modules
CMD ["node", "dist/main.js"]
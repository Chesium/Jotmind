# --- Build stage ---
FROM node:20-alpine AS build
WORKDIR /repo
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile
# 先构建 libs，再构建 api（Nx 根据依赖图执行）
RUN pnpm nx build api

# --- Runtime stage ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# 复制产物与最小依赖
COPY --from=build /repo/dist/api ./api
COPY --from=build /repo/package.json .
COPY --from=build /repo/pnpm-lock.yaml .
COPY --from=build /repo/sqlite.db .
RUN corepack enable && pnpm install --prod --frozen-lockfile --dangerously-allow-all-builds

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=2s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "api/main.js"]
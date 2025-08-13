# --- Build stage ---
FROM node:20-alpine AS build
WORKDIR /repo
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile
# Nx：只构建 web（会自动利用缓存）
RUN pnpm nx build web

# # --- Serve stage ---
# FROM nginx:alpine
# # 可选：开启 gzip（用默认 conf；Brotli 需扩展镜像）
# # RUN sed -i 's/# gzip/gzip/' /etc/nginx/nginx.conf || true

# # 将 Vite 产物复制到 Nginx 根目录
# COPY --from=build /repo/web/build/client /usr/share/nginx/html

# # 提供一个最小的站点配置（也可以走网关 Nginx 的 / 反代模式，见下文）
# # 这里仍保留 Nginx，以便单独访问 web 容器或被网关反代
# EXPOSE 80


FROM nginx:alpine
COPY --from=build /repo/web/build/client /usr/share/nginx/html
COPY infra/docker/nginx.web.conf /etc/nginx/conf.d/default.conf
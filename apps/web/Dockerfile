FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/web/package*.json ./apps/web/
# Web previews reuse desktop components and their workspace dependencies.
COPY apps/desktop/package.json ./apps/desktop/
COPY packages/i18n/package.json ./packages/i18n/
RUN npm ci

FROM deps AS build
ARG VITE_WEB_BASE_PATH=/web/
ARG VITE_API_BASE_URL=
ENV VITE_WEB_BASE_PATH=${VITE_WEB_BASE_PATH}
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
COPY apps/web ./apps/web
COPY shared ./shared
COPY packages/i18n ./packages/i18n
# Shared chat logic imports model selection and turn timing from the desktop sources.
COPY apps/desktop/src ./apps/desktop/src
RUN npm run build -w @codex-switch/web

FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

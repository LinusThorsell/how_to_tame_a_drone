FROM node:24-alpine AS development

WORKDIR /app
RUN chown node:node /app

USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci

COPY --chown=node:node index.html styles.css vite.config.js ./
COPY --chown=node:node public ./public
COPY --chown=node:node src ./src

EXPOSE 8080

CMD ["npm", "run", "dev", "--", "--port", "8080"]

FROM development AS build

RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx:nginx /app/dist/ /usr/share/nginx/html/

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

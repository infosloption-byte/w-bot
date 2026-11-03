FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json tsconfig.json vite.config.ts index.html platform.html ./
COPY marketing ./marketing
COPY public ./public
# Contract tests inspect these files from the build workspace.
COPY nginx.conf Dockerfile ./
RUN npm install --no-audit --no-fund
COPY src ./src
COPY tests ./tests
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html/portal
EXPOSE 8080

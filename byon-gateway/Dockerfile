FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git openssh-client && rm -rf /var/lib/apt/lists/*
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" && git config --global --add url."https://github.com/".insteadOf "git@github.com:"
COPY byon-gateway/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund
COPY byon-gateway/index.mjs ./index.mjs
COPY web-gateway/validation.mjs ./validation.mjs
COPY byon-gateway/tests ./tests
RUN node --test tests/*.test.mjs
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN mkdir -p /data/auth && chown -R node:node /data
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/index.mjs /app/validation.mjs ./
USER node
EXPOSE 9039
CMD ["node","index.mjs"]

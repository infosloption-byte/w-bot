FROM node:22-bookworm-slim AS build
WORKDIR /app
# Baileys v6 pulls libsignal from GitHub; git is required only during installation.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git openssh-client \
    && rm -rf /var/lib/apt/lists/*
# Public GitHub git dependencies must not require SSH keys.
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
    && git config --global --add url."https://github.com/".insteadOf "git@github.com:"
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY index.mjs validation.mjs ./
COPY tests ./tests
RUN npm test

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data/auth \
    && chown -R node:node /data
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/index.mjs /app/validation.mjs ./
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 9029
CMD ["node", "index.mjs"]

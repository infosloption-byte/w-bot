FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY index.mjs validation.mjs ./
COPY tests ./tests
RUN npm test && mkdir -p /data/auth && chown -R node:node /data
USER node
ENV NODE_ENV=production
EXPOSE 9029
CMD ["node", "index.mjs"]

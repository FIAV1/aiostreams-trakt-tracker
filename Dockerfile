FROM node:22-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json addon-sdk.tgz ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM build AS test
COPY tests ./tests
RUN npm test

FROM build AS production-deps
RUN npm prune --omit=dev

FROM node:22-slim AS runtime
LABEL org.opencontainers.image.source="https://github.com/FIAV1/aiostreams-trakt-tracker"
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATABASE_URL=/data/trakt-sync.db
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]

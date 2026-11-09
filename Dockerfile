FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY src ./src
COPY test ./test
COPY web ./web
COPY reference-web ./reference-web
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV POA_DOMAINS_HOST=0.0.0.0
ENV POA_DOMAINS_PORT=8787
ENV POA_DOMAINS_DATA=/data/registry
ENV POA_DOMAINS_PUBLIC_URL=https://poadomains.grok.me
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/reference-web ./reference-web
COPY --from=build /app/web ./web
RUN mkdir -p /data/registry && chown -R node:node /data /app
USER node
VOLUME ["/data/registry"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/src/app.js"]

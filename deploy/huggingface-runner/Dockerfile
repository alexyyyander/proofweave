FROM node@sha256:de636e50060a9908cf40a20a50d027ed74a99b2e31d2635f3b13e9e4e5e97e74 AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM cgr.dev/chainguard/wolfi-base@sha256:1460aa3f8ef8e968f128eb304437d04469ef85d30ceb77dabc12cc731a1566d5
RUN apk upgrade --no-cache \
 && apk add --no-cache libstdc++ libatomic \
 && addgroup -S -g 1000 node \
 && adduser -S -D -H -u 1000 -G node -h /home/node -s /sbin/nologin node
COPY --from=dependencies /usr/local/bin/node /usr/local/bin/node
COPY --from=dependencies --chown=node:node /app/node_modules /app/node_modules

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7860 \
    NODE_VERSION=22.23.4

WORKDIR /app

COPY package.json package-lock.json ./

COPY packages ./packages
COPY services/artifacts ./services/artifacts
COPY services/database ./services/database
COPY services/lean-runner ./services/lean-runner
COPY services/verification ./services/verification

RUN chown -R node:node /app
USER node

EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:7860/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "services/lean-runner/hosted-trusted-runner-main.mjs"]

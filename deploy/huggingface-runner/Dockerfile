FROM node:22.13.1-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7860

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force

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

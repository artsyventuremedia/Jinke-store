FROM node:24-alpine
WORKDIR /app
# Everything the store saves lives under /app/data, so hosts with a single persistent disk
# (Render, Railway, Fly.io) only need one disk mounted at /app/data.
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/store.db \
    UPLOADS_DIR=/app/data/uploads \
    BACKUP_DIR=/app/data/backups
RUN apk add --no-cache su-exec
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
# Make sure every app file is readable by the unprivileged user, whatever permissions it had locally.
RUN chmod -R a+rX /app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "--no-warnings", "server.js"]

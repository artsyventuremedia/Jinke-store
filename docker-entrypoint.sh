#!/bin/sh
# Hosted disks (Render, Railway, Fly.io) are mounted owned by root. Hand the store's folders to the
# unprivileged "node" user, then drop root before starting the app.
set -e
if [ "$(id -u)" = "0" ]; then
  for dir in "$(dirname "$DB_PATH")" "$UPLOADS_DIR" "$BACKUP_DIR"; do
    [ -n "$dir" ] && mkdir -p "$dir" && chown -R node:node "$dir"
  done
  exec su-exec node "$@"
fi
exec "$@"

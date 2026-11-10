#!/bin/sh
set -e

# If running the main web server, apply database migrations first
if [ "${AUTO_MIGRATE:-true}" = "true" ] && [ "$1" = "node" ] && [ "$2" = ".output/server/index.mjs" ]; then
  echo "[docker-entrypoint] Applying database migrations..."
  max_retries=10
  count=0
  until node .output/migrate.mjs; do
    count=$((count + 1))
    if [ "$count" -ge "$max_retries" ]; then
      echo "[docker-entrypoint] Database migration failed after $count attempts. Aborting startup." >&2
      exit 1
    fi
    echo "[docker-entrypoint] Database not ready yet or migration failed. Retrying in 2s ($count/$max_retries)..."
    sleep 2
  done
  echo "[docker-entrypoint] Database migrations applied successfully."
fi

exec "$@"

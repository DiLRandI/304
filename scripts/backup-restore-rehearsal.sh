#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${G304_COMPOSE_ENV_FILE:-$root_dir/infra/compose/.env}"
compose_file="${G304_COMPOSE_FILE:-$root_dir/infra/compose/compose.yaml}"
extra_compose_file="${G304_COMPOSE_EXTRA_FILE:-}"

if [[ "${G304_RESTORE_REHEARSAL:-}" != "1" ]]; then
  echo "Set G304_RESTORE_REHEARSAL=1 to acknowledge the disposable restore rehearsal." >&2
  exit 1
fi

if [[ ! -f "$env_file" ]]; then
  echo "Missing Compose environment file: $env_file" >&2
  exit 1
fi

compose=(docker compose)
if [[ -n "${G304_COMPOSE_PROJECT:-}" ]]; then
  compose+=(-p "$G304_COMPOSE_PROJECT")
fi
compose+=(--env-file "$env_file" -f "$compose_file")
if [[ -n "$extra_compose_file" ]]; then
  if [[ ! -f "$extra_compose_file" ]]; then
    echo "Missing extra Compose file: $extra_compose_file" >&2
    exit 1
  fi
  compose+=(-f "$extra_compose_file")
fi

read_env_value() {
  local key="$1"
  local value
  value="$(awk -F= -v key="$key" '$0 !~ /^#/ && $1 == key {sub(/^[^=]*=/, ""); print; exit}' "$env_file")"
  if [[ -z "$value" ]]; then
    echo "Missing $key in $env_file" >&2
    exit 1
  fi
  printf '%s' "$value"
}

postgres_database="$(read_env_value POSTGRES_DB)"
postgres_user="$(read_env_value POSTGRES_USER)"
source_database_url="$(read_env_value DATABASE_URL)"

if ! [[ "$postgres_database" =~ ^[A-Za-z0-9_]+$ ]] || ! [[ "$postgres_user" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "The rehearsal supports only simple local Compose PostgreSQL names." >&2
  exit 1
fi

if ! "${compose[@]}" ps --status running --services | grep -qx "postgres"; then
  echo "The disposable Compose PostgreSQL service must be running first." >&2
  exit 1
fi

restore_database="g304_restore_${RANDOM}_$$"
dump_file="$(mktemp "${TMPDIR:-/tmp}/g304-restore-XXXXXX.dump")"

cleanup() {
  local status=$?
  trap - EXIT
  "${compose[@]}" exec -T postgres dropdb --if-exists --username "$postgres_user" "$restore_database" >/dev/null 2>&1 || true
  rm -f "$dump_file"
  exit "$status"
}
trap cleanup EXIT

restore_database_url="$(node -e '
const [source, database] = process.argv.slice(1);
const url = new URL(source);
url.pathname = `/${database}`;
process.stdout.write(url.toString());
' "$source_database_url" "$restore_database")"

echo "Creating a disposable PostgreSQL backup."
"${compose[@]}" exec -T postgres pg_dump \
  --format=custom \
  --no-owner \
  --username "$postgres_user" \
  "$postgres_database" > "$dump_file"
test -s "$dump_file"

echo "Restoring into a disposable database and replaying migrations."
"${compose[@]}" exec -T postgres createdb --username "$postgres_user" "$restore_database"
"${compose[@]}" exec -T postgres pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --exit-on-error \
  --username "$postgres_user" \
  --dbname "$restore_database" < "$dump_file"
"${compose[@]}" run --rm --no-deps -T \
  -e "DATABASE_URL=$restore_database_url" \
  migrate

"${compose[@]}" exec -T postgres pg_isready \
  --username "$postgres_user" \
  --dbname "$restore_database" >/dev/null
migration_count="$("${compose[@]}" exec -T postgres psql \
  --tuples-only \
  --no-align \
  --username "$postgres_user" \
  --dbname "$restore_database" \
  --command 'SELECT count(*) FROM schema_migrations')"

if ! [[ "$migration_count" =~ ^[1-9][0-9]*$ ]]; then
  echo "The restored database does not contain applied migrations." >&2
  exit 1
fi

echo "Backup/restore rehearsal passed with $migration_count applied migrations."

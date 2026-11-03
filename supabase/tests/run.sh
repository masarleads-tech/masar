#!/usr/bin/env bash
# Tests supabase/schema.sql on a scratch PostgreSQL database, never the live one.
#   DATABASE_URL=postgres://postgres@localhost:5432/postgres supabase/tests/run.sh
# It creates a database called masar_schema_test, installs the schema twice (it must be safe to re-run),
# runs checks.sql, then deletes the test database.
set -euo pipefail
export PGOPTIONS='--client-min-messages=notice'
cd "$(dirname "$0")"
URL="${DATABASE_URL:?Set DATABASE_URL to a scratch PostgreSQL server}"
psql "$URL" -q -c "drop database if exists masar_schema_test" -c "create database masar_schema_test"
TEST="${URL%/*}/masar_schema_test"
trap 'psql "$URL" -q -c "drop database if exists masar_schema_test"' EXIT
psql "$TEST" -q -v ON_ERROR_STOP=1 -f supabase-stub.sql
psql "$TEST" -q -v ON_ERROR_STOP=1 -f ../schema.sql
psql "$TEST" -q -v ON_ERROR_STOP=1 -f ../schema.sql
psql "$TEST" -q -v ON_ERROR_STOP=1 -f checks.sql

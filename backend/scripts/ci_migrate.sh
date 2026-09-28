#!/bin/sh
# Baked into the backend image (backend/Dockerfile's `COPY . .` already picks
# this up under scripts/) and invoked remotely by the deploy pipeline's
# "Run database migrations" step via a PLAIN, unquoted, space-only path:
#   az containerapp exec --command "sh /app/scripts/ci_migrate.sh"
#
# All compound logic lives in this file rather than in that --command string
# on purpose: az containerapp exec's --command does not appear to honor shell
# quoting when it forwards the string into the container (a compound
# `sh -c '... && ... || ...'` value sent directly over --command came back
# mangled — "Syntax error: Unterminated quoted string" — see
# .github/workflows/backend-deploy.yml history). A bare `sh <path>` with no
# spaces-in-arguments, quotes, or `&&`/`||` has nothing left for a naive
# whitespace split to break.
set -e
alembic upgrade head
echo MIGRATION_OK

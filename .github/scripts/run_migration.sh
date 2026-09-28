#!/bin/sh
# Runs `alembic upgrade head` inside the live careers-backend container app.
# Invoked from backend-deploy.yml's "Run database migrations" step, wrapped
# in `script` there to fake a TTY — az containerapp exec unconditionally
# tries to set the local terminal to raw mode and hard-crashes without one.
# Expects RG (the Azure resource group) to already be set in the environment.
#
# The --command value below is deliberately a plain two-word path with no
# spaces-in-arguments, quotes, or shell operators — az containerapp exec's
# --command does not appear to preserve quoting when it forwards the string
# into the container, so a compound `sh -c '... && ...'` value sent directly
# here gets shredded ("Syntax error: Unterminated quoted string"). All the
# actual upgrade/echo logic lives in backend/scripts/ci_migrate.sh instead,
# baked into the image, so there's nothing left here for that to mis-split.
set -eu

az containerapp exec \
  --name careers-backend \
  --resource-group "$RG" \
  --command "sh /app/scripts/ci_migrate.sh"

#!/bin/sh
# Runs `alembic upgrade head` inside the live careers-backend container app.
# Invoked from backend-deploy.yml's "Run database migrations" step, wrapped
# in `script` there to fake a TTY — az containerapp exec unconditionally
# tries to set the local terminal to raw mode and hard-crashes without one.
# Expects RG (the Azure resource group) to already be set in the environment.
set -eu

az containerapp exec \
  --name careers-backend \
  --resource-group "$RG" \
  --command "sh -c 'alembic upgrade head && echo MIGRATION_OK || echo MIGRATION_FAILED'"

#!/bin/bash
set -e

MODE="${1:-local}"
SCRIPT_DIR="$(dirname "$0")"
HEROKU_APP="email-manager"

if [ "$MODE" = "production" ]; then
  echo "Reading config from Heroku ($HEROKU_APP)..."
  TELEGRAM_BOT_TOKEN=$(heroku config:get TELEGRAM_BOT_TOKEN --app "$HEROKU_APP")
  TELEGRAM_WEBHOOK_SECRET=$(heroku config:get TELEGRAM_WEBHOOK_SECRET --app "$HEROKU_APP")
  APP_URL=$(heroku config:get APP_URL --app "$HEROKU_APP")

elif [ "$MODE" = "local" ]; then
  echo "Reading config from .env..."
  set -a
  source "$SCRIPT_DIR/../.env"
  set +a
else
  echo "Usage: $0 [local|production]"
  echo "  local      — read from .env (default)"
  echo "  production — read from Heroku config"
  exit 1
fi

if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$APP_URL" ] || [ -z "$TELEGRAM_WEBHOOK_SECRET" ]; then
  echo "Error: missing required config values"
  echo "  TELEGRAM_BOT_TOKEN = ${TELEGRAM_BOT_TOKEN:-(empty)}"
  echo "  APP_URL            = ${APP_URL:-(empty)}"
  echo "  WEBHOOK_SECRET     = ${TELEGRAM_WEBHOOK_SECRET:-(empty)}"
  exit 1
fi

URL="${APP_URL}/api/webhook"

echo "Deleting existing webhook..."
RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/deleteWebhook")
echo "Deletion Result: $RESPONSE"
echo "Sleeping for 10s to ensure webhook is deleted..."
sleep 10

echo "Checking webhook info..."
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo" | jq .

echo "Setting webhook to: $URL"
RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=$URL" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET")

echo "$RESPONSE" | head -c 200

echo "Final webhook info..."
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo" | jq .

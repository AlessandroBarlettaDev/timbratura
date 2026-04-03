#!/bin/bash
# Script di deploy completo o solo frontend.
#
# Uso:
#   ./deploy.sh          → deploy completo (infrastruttura + frontend)
#   ./deploy.sh frontend → solo frontend (build Angular + sync S3 + invalida CloudFront, ~30s)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
ENV_FILE="$FRONTEND_DIR/src/app/environments/environment.ts"

# Valori fissi — non cambiano a meno di non ricreare lo stack
S3_BUCKET="backendstack-hostingfrontendbucket74d527b5-0akstckllozf"
CLOUDFRONT_ID="$(aws cloudfront list-distributions 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
for dist in d.get('DistributionList', {}).get('Items', []):
    for origin in dist.get('Origins', {}).get('Items', []):
        if 'backendstack' in origin.get('DomainName', '').lower():
            print(dist['Id'])
            break
" 2>/dev/null || echo '')"
APP_URL="https://d2csjqqicya19l.cloudfront.net"

# --- Solo frontend (veloce) ---
if [ "${1}" = "frontend" ]; then
  echo "▶ Build Angular..."
  cd "$FRONTEND_DIR" && ng build
  echo "▶ Sync S3..."
  aws s3 sync dist/frontend/browser "s3://$S3_BUCKET" --delete
  if [ -n "$CLOUDFRONT_ID" ]; then
    echo "▶ Invalida cache CloudFront ($CLOUDFRONT_ID)..."
    aws cloudfront create-invalidation --distribution-id "$CLOUDFRONT_ID" --paths "/*" > /dev/null
  fi
  echo "✅ Frontend aggiornato su $APP_URL"
  exit 0
fi

# --- Deploy completo ---
echo "▶ Step 1/4 — Deploy infrastruttura AWS..."
cd "$BACKEND_DIR"
npx cdk deploy --require-approval never --outputs-file /tmp/cdk-outputs.json 2>&1 | tail -5

APP_URL=$(python3 -c "
import json
with open('/tmp/cdk-outputs.json') as f:
    outputs = json.load(f)
stack = list(outputs.values())[0]
for key, val in stack.items():
    if 'AppUrl' in key:
        print(val); break
")

API_URL=$(python3 -c "
import json
with open('/tmp/cdk-outputs.json') as f:
    outputs = json.load(f)
stack = list(outputs.values())[0]
for key, val in stack.items():
    if 'ApiTimbraturaApiEndpoint' in key:
        print(val.rstrip('/')); break
")

USER_POOL_ID=$(python3 -c "
import json
with open('/tmp/cdk-outputs.json') as f:
    outputs = json.load(f)
stack = list(outputs.values())[0]
for key, val in stack.items():
    if 'UserPoolId' in key:
        print(val); break
")

CLIENT_ID=$(python3 -c "
import json
with open('/tmp/cdk-outputs.json') as f:
    outputs = json.load(f)
stack = list(outputs.values())[0]
for key, val in stack.items():
    if 'ClientId' in key:
        print(val); break
")

echo ""
echo "▶ Step 2/4 — Aggiornamento environment.ts..."
cat > "$ENV_FILE" <<EOF
export const environment = {
  region:           'eu-west-1',
  UserPoolId:       '${USER_POOL_ID}',
  UserPoolClientId: '${CLIENT_ID}',
  ApiUrl:           '${API_URL}',
};
EOF

echo "▶ Step 3/4 — Build Angular..."
cd "$FRONTEND_DIR" && ng build

echo "▶ Step 4/4 — Upload S3 + deploy CDK finale..."
cd "$BACKEND_DIR" && npx cdk deploy --require-approval never 2>&1 | tail -5

echo ""
echo "✅ Deploy completato!"
echo "🌐 $APP_URL"

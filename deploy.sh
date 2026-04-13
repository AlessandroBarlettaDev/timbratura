#!/bin/bash
# Uso:
#   ./deploy.sh                 → deploy completo produzione
#   ./deploy.sh frontend        → solo frontend produzione (~30s)
#   ./deploy.sh --dev           → deploy completo dev
#   ./deploy.sh --dev frontend  → solo frontend dev (~30s)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
ENV_FILE="$FRONTEND_DIR/src/app/environments/environment.ts"
CDK_OUTPUTS="/tmp/cdk-outputs.json"

# Fallback hardcodati per prod (usati finché non viene fatto un deploy completo con i nuovi output CDK)
PROD_BUCKET="backendstack-hostingfrontendbucket74d527b5-0akstckllozf"
PROD_URL="https://d2csjqqicya19l.cloudfront.net"

# ---------- Argomenti ----------
DEV_MODE=false
FRONTEND_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --dev)    DEV_MODE=true ;;
    frontend) FRONTEND_ONLY=true ;;
  esac
done

if $DEV_MODE; then
  export DEPLOY_ENV="dev"
  STACK_NAME="BackendStack-dev"
else
  export DEPLOY_ENV=""
  STACK_NAME="BackendStack"
fi

# ---------- Funzioni ----------

# Estrae gli output da un file JSON prodotto da `cdk deploy --outputs-file`
_parse_cdk_outputs() {
  python3 - "$CDK_OUTPUTS" <<'EOF'
import json, sys
with open(sys.argv[1]) as f:
    stack = list(json.load(f).values())[0]
def get(k): return next((v for key, v in stack.items() if k in key), '')
print(get('FrontendBucketName'))
print(get('CloudFrontDistributionId'))
print(get('AppUrl'))
print(get('ApiTimbraturaApiEndpoint').rstrip('/'))
print(get('UserPoolId'))
print(get('ClientId'))
EOF
}

# Legge gli output dallo stack CloudFormation già deployato
_read_cf_outputs() {
  python3 - "$STACK_NAME" <<'EOF'
import subprocess, json, sys
r = subprocess.run(
  ['aws', 'cloudformation', 'describe-stacks', '--stack-name', sys.argv[1]],
  capture_output=True, text=True
)
if r.returncode != 0:
  sys.exit(1)
outputs = {o['OutputKey']: o['OutputValue']
           for o in json.loads(r.stdout)['Stacks'][0].get('Outputs', [])}
def get(k): return next((v for key, v in outputs.items() if k in key), '')
print(get('FrontendBucketName'))
print(get('CloudFrontDistributionId'))
print(get('AppUrl'))
print(get('ApiTimbraturaApiEndpoint').rstrip('/'))
print(get('UserPoolId'))
print(get('ClientId'))
EOF
}

# Scrive environment.ts — fallisce se i valori critici sono vuoti
_write_env() {
  local user_pool_id="$1" client_id="$2" api_url="$3"
  if [ -z "$user_pool_id" ] || [ -z "$client_id" ] || [ -z "$api_url" ]; then
    echo "❌ Valori mancanti: UserPoolId='$user_pool_id' ClientId='$client_id' ApiUrl='$api_url'"
    exit 1
  fi
  cat > "$ENV_FILE" <<ENVEOF
export const environment = {
  region:           'eu-west-1',
  UserPoolId:       '${user_pool_id}',
  UserPoolClientId: '${client_id}',
  ApiUrl:           '${api_url}',
};
ENVEOF
}

# Build Angular + sync S3 + invalida CloudFront
_deploy_frontend() {
  local bucket="$1" cf_id="$2" app_url="$3"
  echo "▶ Build Angular..."
  cd "$FRONTEND_DIR" && ng build
  echo "▶ Sync S3..."
  aws s3 sync dist/frontend/browser "s3://$bucket" --delete
  if [ -n "$cf_id" ]; then
    echo "▶ Invalida cache CloudFront ($cf_id)..."
    aws cloudfront create-invalidation --distribution-id "$cf_id" --paths "/*" > /dev/null
  fi
  echo "✅ Frontend aggiornato su $app_url"
}

# ---------- Solo frontend ----------
if $FRONTEND_ONLY; then

  echo "▶ Lettura outputs stack $STACK_NAME..."

  if ! VALS=$(_read_cf_outputs 2>/dev/null); then
    if $DEV_MODE; then
      echo "❌ Stack $STACK_NAME non trovato. Esegui prima './deploy.sh --dev'."
    else
      echo "❌ Stack $STACK_NAME non trovato. Esegui prima './deploy.sh'."
    fi
    exit 1
  fi

  S3_BUCKET=$(echo    "$VALS" | sed -n '1p')
  CF_ID=$(echo        "$VALS" | sed -n '2p')
  APP_URL=$(echo      "$VALS" | sed -n '3p')
  API_URL=$(echo      "$VALS" | sed -n '4p')
  USER_POOL_ID=$(echo "$VALS" | sed -n '5p')
  CLIENT_ID=$(echo    "$VALS" | sed -n '6p')

  # Fallback prod: i nuovi output (Bucket, CF ID) non esistono finché non si fa un deploy completo
  if ! $DEV_MODE; then
    S3_BUCKET="${S3_BUCKET:-$PROD_BUCKET}"
    APP_URL="${APP_URL:-$PROD_URL}"
    if [ -z "$CF_ID" ]; then
      CF_ID="$(aws cloudfront list-distributions 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
for dist in d.get('DistributionList', {}).get('Items', []):
    for o in dist.get('Origins', {}).get('Items', []):
        if 'backendstack' in o.get('DomainName', '').lower():
            print(dist['Id']); sys.exit(0)
" 2>/dev/null || true)"
    fi
  fi

  _write_env "$USER_POOL_ID" "$CLIENT_ID" "$API_URL"
  _deploy_frontend "$S3_BUCKET" "$CF_ID" "$APP_URL"
  exit 0
fi

# ---------- Deploy completo ----------

echo "▶ Step 1/4 — Deploy infrastruttura AWS ($STACK_NAME)..."
cd "$BACKEND_DIR"
npx cdk deploy "$STACK_NAME" --require-approval never --outputs-file "$CDK_OUTPUTS" 2>&1

VALS=$(_parse_cdk_outputs)
S3_BUCKET=$(echo    "$VALS" | sed -n '1p')
CF_ID=$(echo        "$VALS" | sed -n '2p')
APP_URL=$(echo      "$VALS" | sed -n '3p')
API_URL=$(echo      "$VALS" | sed -n '4p')
USER_POOL_ID=$(echo "$VALS" | sed -n '5p')
CLIENT_ID=$(echo    "$VALS" | sed -n '6p')

echo ""
echo "▶ Step 2/4 — Aggiornamento environment.ts..."
_write_env "$USER_POOL_ID" "$CLIENT_ID" "$API_URL"

echo "▶ Step 3/4 — Build Angular..."
cd "$FRONTEND_DIR" && ng build

echo "▶ Step 4/4 — Upload S3 + deploy CDK finale..."
cd "$BACKEND_DIR" && npx cdk deploy "$STACK_NAME" --require-approval never 2>&1

echo ""
echo "✅ Deploy completato!"
echo "🌐 $APP_URL"

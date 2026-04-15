#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — Deploy dell'applicazione Timbratura su AWS
#
# USO:
#   ./deploy.sh                 → deploy completo produzione (infra + frontend)
#   ./deploy.sh frontend        → solo frontend produzione (~30s, bypassa CDK)
#   ./deploy.sh backend         → solo infrastruttura produzione (CDK, no build Angular)
#   ./deploy.sh --dev           → deploy completo dev
#   ./deploy.sh --dev frontend  → solo frontend dev (~30s)
#   ./deploy.sh --dev backend   → solo infrastruttura dev
#
# PREREQUISITI:
#   - AWS CLI configurato con le credenziali corrette
#   - Node.js e Angular CLI installati
#   - JWT_SECRET esportato nell'ambiente (obbligatorio per CDK)
#
# FLUSSO — deploy completo:
#   1. Controlla JWT_SECRET e installa node_modules se mancante
#   2. Legge gli outputs dello stack esistente da CloudFormation
#   3. Scrive environment.ts con i valori correnti (Cognito, API URL)
#   4. Builda Angular → crea dist/ (necessario per CDK BucketDeployment)
#   5. CDK deploy → aggiorna infra e carica il frontend su S3
#   6. Se gli outputs sono cambiati (es. primo deploy): ribuild + re-sync S3
#
# FLUSSO — solo frontend:
#   1. Legge outputs da CloudFormation
#   2. Scrive environment.ts
#   3. Builda Angular
#   4. Sync S3 + invalidazione cache CloudFront
#
# PERCHÉ IL BUILD ANGULAR VIENE PRIMA DI CDK:
#   CDK include un BucketDeployment che referenzia frontend/dist/ già durante
#   la sintesi dello stack (cdk synth). Se dist/ non esiste, CDK fallisce con
#   «CannotFindAsset» prima ancora di contattare AWS.
#   Buildare Angular prima risolve questo problema senza dover modificare il CDK.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# Tutte le operazioni AWS usano eu-west-1 — CDK, CLI e SDK lo ereditano da questa variabile
export AWS_DEFAULT_REGION="eu-west-1"

# Profilo AWS: usa quello già impostato dall'utente; se assente prova timbrature-app
if [ -z "${AWS_PROFILE:-}" ]; then
  if aws configure list-profiles 2>/dev/null | grep -qx "timbrature-app"; then
    export AWS_PROFILE="timbrature-app"
  fi
fi
if [ -n "${AWS_PROFILE:-}" ]; then
  export AWS_DEFAULT_PROFILE="$AWS_PROFILE"
fi

# CDK ha bisogno di account/regione risolti esplicitamente per deployare asset
_STS_ARGS=()
if [ -n "${AWS_PROFILE:-}" ]; then
  _STS_ARGS+=(--profile "$AWS_PROFILE")
fi
if ! AWS_ACCOUNT_ID=$(aws sts get-caller-identity "${_STS_ARGS[@]}" --query Account --output text 2>/dev/null); then
  echo "❌ Credenziali AWS non valide o mancanti per CDK deploy."
  if [ -n "${AWS_PROFILE:-}" ]; then
    echo "   Profilo in uso: $AWS_PROFILE"
    echo "   Verifica con: aws sts get-caller-identity --profile $AWS_PROFILE"
  else
    echo "   Imposta un profilo prima del deploy, ad esempio:"
    echo "   export AWS_PROFILE=timbrature-app"
  fi
  exit 1
fi
export CDK_DEFAULT_ACCOUNT="$AWS_ACCOUNT_ID"
export CDK_DEFAULT_REGION="$AWS_DEFAULT_REGION"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
ENV_FILE="$FRONTEND_DIR/src/app/environments/environment.ts"
CDK_OUTPUTS="/tmp/cdk-outputs.json"

# ─── Argomenti ────────────────────────────────────────────────────────────────
DEV_MODE=false
FRONTEND_ONLY=false
BACKEND_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --dev)    DEV_MODE=true ;;
    frontend) FRONTEND_ONLY=true ;;
    backend)  BACKEND_ONLY=true ;;
  esac
done

if $DEV_MODE; then
  export DEPLOY_ENV="dev"
  STACK_NAME="BackendStack-dev"
else
  export DEPLOY_ENV=""
  STACK_NAME="BackendStack"
fi

# ─── Legge gli outputs da uno stack CloudFormation già deployato ───────────────
# Stampa 6 righe: BucketName, CloudFrontId, AppUrl, ApiUrl, UserPoolId, ClientId
# Ritorna exit code 1 se lo stack non esiste o non ha outputs.
_read_cf_outputs() {
  python3 - "$STACK_NAME" <<'EOF'
import subprocess, json, sys
r = subprocess.run(
  ['aws', 'cloudformation', 'describe-stacks', '--stack-name', sys.argv[1], '--region', 'eu-west-1'],
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

# ─── Legge gli outputs dal file JSON prodotto da cdk deploy --outputs-file ─────
# Usato dopo il CDK deploy per leggere i valori appena creati/aggiornati.
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

# ─── Scrive environment.ts ─────────────────────────────────────────────────────
# I tre parametri (UserPoolId, ClientId, ApiUrl) sono obbligatori —
# se uno è vuoto il deploy si ferma per evitare di buildare un frontend rotto.
_write_env() {
  local user_pool_id="$1" client_id="$2" api_url="$3"
  if [ -z "$user_pool_id" ] || [ -z "$client_id" ] || [ -z "$api_url" ]; then
    echo "❌ Valori mancanti nell'environment: UserPoolId='$user_pool_id' ClientId='$client_id' ApiUrl='$api_url'"
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

# ─── Build Angular + sync S3 + invalidazione CloudFront ───────────────────────
_deploy_frontend() {
  local bucket="$1" cf_id="$2" app_url="$3"
  echo "  → Build Angular..."
  cd "$FRONTEND_DIR" && node_modules/.bin/ng build
  echo "  → Sync S3 (s3://$bucket)..."
  aws s3 sync dist/frontend/browser "s3://$bucket" --delete
  if [ -n "$cf_id" ]; then
    echo "  → Invalida cache CloudFront ($cf_id)..."
    aws cloudfront create-invalidation --distribution-id "$cf_id" --paths "/*" > /dev/null
  fi
  echo "✅ Frontend aggiornato → $app_url"
}

# ─────────────────────────────────────────────────────────────────────────────
# MODALITÀ: solo frontend
# Bypassa CDK — ideale quando l'infrastruttura non è cambiata.
# ─────────────────────────────────────────────────────────────────────────────
if $FRONTEND_ONLY; then
  echo "▶ Lettura outputs stack $STACK_NAME..."

  if ! VALS=$(_read_cf_outputs 2>/dev/null); then
    echo "❌ Stack $STACK_NAME non trovato. Esegui prima './deploy.sh${DEV_MODE:+ --dev}'."
    exit 1
  fi

  S3_BUCKET=$(echo    "$VALS" | sed -n '1p')
  CF_ID=$(echo        "$VALS" | sed -n '2p')
  APP_URL=$(echo      "$VALS" | sed -n '3p')
  API_URL=$(echo      "$VALS" | sed -n '4p')
  USER_POOL_ID=$(echo "$VALS" | sed -n '5p')
  CLIENT_ID=$(echo    "$VALS" | sed -n '6p')

  _write_env "$USER_POOL_ID" "$CLIENT_ID" "$API_URL"
  _deploy_frontend "$S3_BUCKET" "$CF_ID" "$APP_URL"
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# MODALITÀ: solo backend
# Deploya solo l'infrastruttura CDK (Lambda, DynamoDB, API Gateway, Cognito).
# Non tocca il frontend — utile quando si aggiungono tabelle, handler o rotte API.
# Richiede che dist/ esista già (altrimenti CDK fallisce per BucketDeployment).
# ─────────────────────────────────────────────────────────────────────────────
if $BACKEND_ONLY; then
  if [ -z "${JWT_SECRET:-}" ]; then
    echo "❌ JWT_SECRET non impostato. Esportalo prima del deploy:"
    echo "   export JWT_SECRET=<valore>"
    exit 1
  fi

  echo "▶ Dipendenze backend..."
  if [ ! -d "$BACKEND_DIR/node_modules" ]; then
    echo "  → node_modules mancante, eseguo npm install..."
    cd "$BACKEND_DIR" && npm install
  else
    echo "  → node_modules presente, skip."
  fi

  # BucketDeployment referenzia dist/ anche in modalità backend-only.
  # Se dist/ non esiste creiamo una cartella vuota come placeholder —
  # il frontend esistente su S3 non viene toccato.
  if [ ! -d "$FRONTEND_DIR/dist/frontend/browser" ]; then
    echo "  → dist/ non trovato, creo placeholder per CDK BucketDeployment..."
    mkdir -p "$FRONTEND_DIR/dist/frontend/browser"
  fi

  echo ""
  echo "▶ CDK deploy ($STACK_NAME) — solo infrastruttura..."
  cd "$BACKEND_DIR"
  ./node_modules/.bin/cdk deploy "$STACK_NAME" --require-approval never --outputs-file "$CDK_OUTPUTS" 2>&1

  echo ""
  echo "✅ Backend aggiornato. Il frontend su S3 non è stato modificato."
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# MODALITÀ: deploy completo (infrastruttura + frontend)
# ─────────────────────────────────────────────────────────────────────────────

# JWT_SECRET è letto dal CDK durante la sintesi dello stack per configurare le Lambda.
if [ -z "${JWT_SECRET:-}" ]; then
  echo "❌ JWT_SECRET non impostato. Esportalo prima del deploy:"
  echo "   export JWT_SECRET=<valore>"
  exit 1
fi

# ─── Step 1/4 — Dipendenze backend ────────────────────────────────────────────
echo "▶ Step 1/4 — Dipendenze backend..."
if [ ! -d "$BACKEND_DIR/node_modules" ]; then
  echo "  → node_modules mancante, eseguo npm install..."
  cd "$BACKEND_DIR" && npm install
else
  echo "  → node_modules presente, skip."
fi

# ─── Step 2/4 — Build Angular ─────────────────────────────────────────────────
# DEVE precedere il CDK deploy: BucketDeployment referenzia dist/ già in fase
# di sintesi. Usiamo gli outputs dello stack attuale (se esiste) per scrivere
# environment.ts con i valori corretti prima di buildare.
echo ""
echo "▶ Step 2/4 — Build Angular..."

if VALS=$(_read_cf_outputs 2>/dev/null); then
  # Stack esistente — scrivi environment.ts con i valori attuali
  echo "  → Stack esistente trovato, scrivo environment.ts con i valori correnti..."
  _write_env \
    "$(echo "$VALS" | sed -n '5p')" \
    "$(echo "$VALS" | sed -n '6p')" \
    "$(echo "$VALS" | sed -n '4p')"
else
  # Primo deploy — lo stack non esiste ancora, usiamo l'environment.ts attuale.
  # environment.ts sarà aggiornato allo Step 4 con i valori reali.
  echo "  → Nessuno stack esistente (primo deploy), uso environment.ts attuale."
fi

cd "$FRONTEND_DIR" && node_modules/.bin/ng build

# ─── Step 3/4 — CDK deploy ────────────────────────────────────────────────────
# Deploya (o aggiorna) l'infrastruttura e carica il frontend buildato su S3
# tramite BucketDeployment. Gli outputs vengono salvati in CDK_OUTPUTS.
echo ""
echo "▶ Step 3/4 — CDK deploy ($STACK_NAME)..."
cd "$BACKEND_DIR"
./node_modules/.bin/cdk deploy "$STACK_NAME" --require-approval never --outputs-file "$CDK_OUTPUTS" 2>&1

# ─── Step 4/4 — Ribuild se gli outputs sono cambiati ─────────────────────────
# Dopo un primo deploy gli outputs (Cognito ID, API URL) sono nuovi e diversi
# da quelli usati per il build. In quel caso riscriviamo environment.ts,
# ribuildiamo Angular e risincronizziamo S3 manualmente.
# Nei deploy successivi (infrastruttura invariata) gli outputs coincidono
# con quelli dello Step 2 → nessun ribuild necessario.
echo ""
echo "▶ Step 4/4 — Verifica outputs post-deploy..."
VALS=$(_parse_cdk_outputs)
S3_BUCKET=$(echo    "$VALS" | sed -n '1p')
CF_ID=$(echo        "$VALS" | sed -n '2p')
APP_URL=$(echo      "$VALS" | sed -n '3p')
API_URL=$(echo      "$VALS" | sed -n '4p')
USER_POOL_ID=$(echo "$VALS" | sed -n '5p')
CLIENT_ID=$(echo    "$VALS" | sed -n '6p')

CURRENT_ENV=$(cat "$ENV_FILE")
_write_env "$USER_POOL_ID" "$CLIENT_ID" "$API_URL"
NEW_ENV=$(cat "$ENV_FILE")

if [ "$CURRENT_ENV" != "$NEW_ENV" ]; then
  # Gli outputs sono cambiati (tipicamente al primo deploy) — ribuild con i valori definitivi
  echo "  → Outputs cambiati, ribuild Angular con i valori definitivi..."
  cd "$FRONTEND_DIR" && node_modules/.bin/ng build
  echo "  → Re-sync S3 con il frontend aggiornato..."
  aws s3 sync dist/frontend/browser "s3://$S3_BUCKET" --delete
  if [ -n "$CF_ID" ]; then
    echo "  → Invalida cache CloudFront ($CF_ID)..."
    aws cloudfront create-invalidation --distribution-id "$CF_ID" --paths "/*" > /dev/null
  fi
else
  echo "  → Outputs invariati, frontend già aggiornato da CDK."
fi

echo ""
echo "✅ Deploy completato!"
echo "   $APP_URL"

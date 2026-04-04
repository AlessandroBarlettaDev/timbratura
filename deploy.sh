#!/bin/bash
# Script di deploy completo o solo frontend.
#
# Uso:
#   ./deploy.sh          → deploy completo (infrastruttura + frontend)
#   ./deploy.sh frontend → solo frontend (build Angular + sync S3 + invalida CloudFront, ~30s)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"                                         # Directory dello script, usata come base per i path relativi
BACKEND_DIR="$SCRIPT_DIR/backend"                                                   # Directory del backend (CDK + Lambda), usata per il deploy CDK e per leggere gli outputs
FRONTEND_DIR="$SCRIPT_DIR/frontend"                                                 # Directory del frontend (Angular), usata per build e per aggiornare environment.ts                 
ENV_FILE="$FRONTEND_DIR/src/app/environments/environment.ts"                        # File di environment.ts del frontend, usato per aggiornare dinamicamente le variabili di ambiente (API URL, Cognito User Pool, ecc.) dopo il deploy CDK

# Valori fissi — non cambiano a meno di non ricreare lo stack
S3_BUCKET="backendstack-hostingfrontendbucket74d527b5-0akstckllozf"                 # Bucket S3 usato per hostare il frontend, creato dallo stack CDK (si può hardcodare perché è sempre lo stesso, a meno di ricreare lo stack)
CLOUDFRONT_ID="$(aws cloudfront list-distributions 2>/dev/null | python3 -c "       # Trova l'ID della distribuzione CloudFront che ha "backendstack" nel DomainName (ovvero quella creata dallo stack CDK per servire il frontend da S3)
import sys, json                                                                    # Reindirizza l'output JSON di `aws cloudfront list-distributions` a questo script Python, che lo analizza per trovare la distribuzione corretta e stampare il suo ID
d = json.load(sys.stdin)                                                            # Analizza la lista delle distribuzioni CloudFront
for dist in d.get('DistributionList', {}).get('Items', []):                         # Itera sulle distribuzioni per trovare quella che ha "backendstack" nel DomainName di una delle sue origini (origins)
    for origin in dist.get('Origins', {}).get('Items', []):                         # Itera sulle origini di ogni distribuzione per controllare il DomainName
        if 'backendstack' in origin.get('DomainName', '').lower():                  # Se trovi una distribuzione con un'origine che contiene "backendstack" nel DomainName, stampa il suo ID e interrompi
            print(dist['Id'])                                                       # Stampa l'ID della distribuzione CloudFront trovata
            break                                                                   # Se trovi la distribuzione, esci dal loop esterno
" 2>/dev/null || echo '')"                                                          # Se il comando `aws cloudfront list-distributions` fallisce (ad esempio se non ci sono distribuzioni o se AWS CLI non è configurato), stampa una stringa vuota come fallback
APP_URL="https://d2csjqqicya19l.cloudfront.net"                                     # URL dell'applicazione, che è il dominio della distribuzione CloudFront (si può hardcodare perché è sempre lo stesso, a meno di ricreare lo stack)

# --- Solo frontend (veloce) ---
if [ "${1}" = "frontend" ]; then                                                    # Se il primo argomento è "frontend", esegui solo il deploy del frontend (build Angular + sync S3 + invalida CloudFront)
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

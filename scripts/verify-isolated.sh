#!/usr/bin/env bash
# Recette Linux isolée. Aucun accès fournisseur ni base existante.
set -euo pipefail

fail() { printf '%s\n' "$1" >&2; exit 2; }

[[ "${TRADIKOM_VERIFY_ISOLATED:-}" == "1" ]] ||
  fail "Confirmer l'environnement jetable avec TRADIKOM_VERIFY_ISOLATED=1."
[[ "$(uname -s)" == "Linux" ]] ||
  fail "Cette recette est réservée à un environnement Linux distant et jetable."
[[ -z "${DATABASE_URL:-}" ]] ||
  fail "Retirer DATABASE_URL : la recette crée exclusivement sa propre base jetable."
[[ "${TRADIKOM_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] ||
  fail "Fournir le SHA Git complet à vérifier dans TRADIKOM_EXPECTED_SHA."
[[ "$(git rev-parse HEAD)" == "$TRADIKOM_EXPECTED_SHA" ]] ||
  fail "Le checkout ne correspond pas au SHA demandé."
[[ "$(node -p 'process.versions.node.split(".")[0]')" == "22" ]] ||
  fail "Node.js 22 est requis pour reproduire le runtime de référence."
[[ "$(pnpm --version)" == "11.7.0" ]] ||
  fail "pnpm 11.7.0 est requis pour le lockfile."
[[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] ||
  fail "La recette refuse un moteur Docker distant ou un contexte imposé."
[[ "$(docker context show)" == "default" ]] ||
  fail "La recette exige le moteur Docker local du runner."
docker info >/dev/null 2>&1 || fail "Docker doit être disponible dans le runner."

unset OPENAI_API_KEY OPENAI_MODEL RESEND_API_KEY RESEND_WEBHOOK_SECRET
unset EMAIL_PROVIDER EMAIL_FROM TWILIO_AUTH_TOKEN SLACK_BOT_TOKEN
unset SLACK_SIGNING_SECRET WHATSAPP_META_ACCESS_TOKEN META_VERIFY_TOKEN
unset MICROSOFT_APP_PASSWORD

export CI=true
export APP_URL=http://127.0.0.1:3000
export DATABASE_POOL_MAX=10
export BUSINESS_TIME_ZONE=America/Martinique
export FEATURE_PUBLIC_DEMO=false
export E2E_ALLOW_PUBLIC_DEMO=false
export FEATURE_AUTH_LINK_PREVIEW=false
export FEATURE_AI_GENERATION=false
export FEATURE_LIVE_INTEGRATIONS=false
export FEATURE_CHANNEL_WHATSAPP=false
export FEATURE_CHANNEL_TEAMS=false
export FEATURE_CHANNEL_SLACK=false
export FEATURE_CHANNEL_EMAIL=false
export CONNECTOR_ENCRYPTION_KEY
CONNECTOR_ENCRYPTION_KEY="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"

container_id=""
cleanup() {
  if [[ -n "$container_id" ]]; then
    docker rm --force --volumes "$container_id" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

container_id="$(docker run --detach --rm \
  -e POSTGRES_USER=tradikom_verification \
  -e POSTGRES_PASSWORD=ephemeral_verification_only \
  -e POSTGRES_DB=tradikom_one_verification \
  -p 127.0.0.1::5432 \
  postgres:17-alpine)"
postgres_port="$(docker port "$container_id" 5432/tcp)"
postgres_port="${postgres_port##*:}"
[[ "$postgres_port" =~ ^[0-9]+$ ]] || fail "Port PostgreSQL invalide."

export DATABASE_URL="postgres://tradikom_verification:ephemeral_verification_only@127.0.0.1:${postgres_port}/tradikom_one_verification"

ready=false
for ((attempt=0; attempt<60; attempt++)); do
  if docker exec "$container_id" pg_isready \
    -U tradikom_verification -d tradikom_one_verification >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
[[ "$ready" == true ]] || fail "PostgreSQL n'est pas prêt."

printf 'SHA vérifié : %s\n' "$TRADIKOM_EXPECTED_SHA"
pnpm install --frozen-lockfile
pnpm audit --prod --audit-level high
pnpm exec playwright install --with-deps chromium
pnpm db:migrate
pnpm db:verify
bash scripts/verify-backup-restore.sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
FEATURE_PUBLIC_DEMO=true E2E_ALLOW_PUBLIC_DEMO=true COOKIE_SECURE=false \
  pnpm test:e2e
pnpm agent:continuity-check
git diff --exit-code
printf '%s\n' "Recette isolée terminée pour le SHA demandé."

#!/usr/bin/env bash
# Batch 1 vault migration — run in Google Cloud Shell (has gcloud + auth).
# Usage: PROJECT_ID=loyl-df23d bash scripts/vault-migrate.sh
# Creates the 7 app secrets (names only, never values).
# Terraform twin: infra/secrets/main.tf (same 7 names + audit logging).
set -euo pipefail
PROJECT_ID="${PROJECT_ID:?export PROJECT_ID=loyl-df23d}"
gcloud services enable secretmanager.googleapis.com cloudaudit.googleapis.com --project="$PROJECT_ID"
for S in DATABASE_URL JWT_SECRET ADMIN_PASSWORD OPENAI_API_KEY CLOUDINARY_API_SECRET AWS_SECRET_ACCESS_KEY FIREBASE_PRIVATE_KEY; do
  gcloud secrets describe "$S" --project="$PROJECT_ID" >/dev/null 2>&1 \
    || gcloud secrets create "$S" --replication-policy=automatic --project="$PROJECT_ID"
  echo "OK $S"
done
gcloud secrets list --project="$PROJECT_ID"
echo "Push values via stdin, e.g.: printf '%s' \"VALUE\" | gcloud secrets versions add JWT_SECRET --data-file=- --project=$PROJECT_ID"

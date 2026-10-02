# ADMIN_RUNBOOK.md — operating the Loyl super-admin (SEC-08)

Audience: whoever holds the admin password. Keep this out of the app repo's
public surface — it documents controls, it contains no secrets.

## 1. What the admin is

- Single **super-admin** identity, password sign-in at `/admin/login`
  (`POST /api/admin/login`). Role is derived server-side only — a client can
  never ask for `role: 'admin'`.
- Powers: review/approve/reject payment screenshots, grant subscription tiers,
  activate/expire/revoke/suspend/restore merchants.
- Every state-changing action is written to the append-only **audit feed**:
  `GET /api/admin/actions` (RT-02). Newest first; filter with
  `?action=APPROVE_PAYMENT`, `?targetType=MERCHANT`, `page`, `pageSize`.

## 2. Where the password lives

| Environment | Source |
| --- | --- |
| Local dev | `frontend/.env.local` → `ADMIN_PASSWORD` |
| CI / cloud deploys | Secret Manager → `ADMIN_PASSWORD` (`infra/secrets/main.tf`, created by `scripts/vault-migrate.sh`) |
| Vercel | Project → Settings → Environment Variables → `ADMIN_PASSWORD` |

Never put the password in code, logs, screenshots or the repo.

## 3. Rotate the password

1. Generate a long random value (password manager or `openssl rand -base64 32`).
2. Update the store above (Secret Manager / Vercel env), then **redeploy** —
   env changes only take effect on a restart.
3. Verify: `/admin/login` accepts the new password and rejects the old one.
4. In-flight admin sessions keep working until their 12h expiry; if the old
   password may be compromised, also consider step 4 in §5.

Cadence: on any suspicion, and otherwise roughly quarterly.

## 4. Emergency: revoke admin access deployment-wide

Unsetting `ADMIN_PASSWORD` immediately turns admin endpoints into
`503 ADMIN_NOT_CONFIGURED` — **even for tokens already issued**. This is the
kill switch: remove the env var, deploy, access is gone. Restore by setting it
again.

## 5. If the password leaks

1. Rotate it (§3) — new logins only.
2. Revoke live sessions: there is no admin-session list yet, so also rotate
   `JWT_SECRET` (invalidates every session app-wide, merchant + customer too —
   everyone signs in again). Both values live in the same env stores.
3. Read the audit feed (§1) for actions taken while exposed; cross-check the
   payment rows (`/admin/billing`) and merchant subscription fields.
4. File the incident in `brain.md`.

## 6. Standing gaps (accepted, tracked in `audit/FIX_PLAN.md`)

- **No MFA** — single factor (password). Recommended before real money flows:
  an SSO/2FA layer in front of `/admin`.
- **Shared identity** — one `actorId` (`admin`) in the audit feed; per-operator
  accounts are a later control.
- Failed logins are throttled (5 fails / 60s per IP → `429 ADMIN_LOCKED_OUT`),
  password compared timing-safe.

## 7. Related incident signals (merchant side, RT-03)

Merchants see their own alerts at `GET /api/merchant/alerts`:
`APPROVAL_BURST` (stamp approvals flooding in), `DEVICE_REGISTERED`,
`DEVICE_REVOKED`. If a merchant reports a stolen phone: have them revoke the
device from the app/dashboard (rows stay for attribution), then check the
approval feed for stamps granted while the phone was gone.

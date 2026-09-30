# DATABASE.md

## DATABASE — Structure the data

### 1. Database Overview
The application uses **Supabase (PostgreSQL)** for its relational database management. The schema is designed to be lightweight, supporting multi-tenant merchants, multi-branch GPS tracking, and manual payment verification.

> **Local dev (since 2026-09-23):** PostgreSQL 16.15 runs locally as the Windows service `postgresql-x64-16` (port 5432, superuser `postgres`). Dev DB = `loyl_db`. Connection string: root `.env` (Prisma CLI) + `frontend/.env.local` (app runtime) — keep in sync. Schema changes: `npm run db:push`. GUI inspection: `npm run db:studio`. **Production** still needs a provisioned Supabase (or similar) instance — set `DATABASE_URL` in Vercel; do not point prod at localhost.

### 2. Core Tables & Schema

#### 2.1 `merchants` (Stores merchant profiles and subscription status)
- `id` (UUID, Primary Key)
- `cognito_sub` (String, Unique) — AWS Cognito User ID for authentication mapping.
- `business_name` (String, Required)
- `category` (String)
- `phone_number` (String, Unique, Required)
- `logo_url` (String) — URL from Cloudinary.
- `subscription_status` (Enum/String) — Default: `'pending'`. Options: `'pending'`, `'active'`, `'expired'`.
- `subscription_expires_at` (Timestamp)
- `created_at` (Timestamp)

#### 2.2 `branches` (Stores multi-branch location data for GPS auto-detection)
- `id` (UUID, Primary Key)
- `merchant_id` (UUID, Foreign Key -> `merchants.id`, Cascade Delete)
- `branch_name` (String, Required)
- `address` (Text)
- `latitude` (Decimal 10,8) — Used for GPS proximity checks.
- `longitude` (Decimal 11,8) — Used for GPS proximity checks.
- `created_at` (Timestamp)

#### 2.3 `offers` (Stores campaign rules and generated QR posters)
- `id` (UUID, Primary Key)
- `merchant_id` (UUID, Foreign Key -> `merchants.id`, Cascade Delete)
- `title` (String, Required)
- `reward_type` (String) — e.g., `'discount'`, `'free_item'`, `'custom'`.
- `required_stamps` (Integer, Required) — e.g., 5, 10.
- `duration_days` (Integer, Required)
- `poster_template_url` (String) — Original uploaded background image.
- `final_poster_url` (String) — Final ready-to-print image with the merged QR code.
- `is_active` (Boolean) — Default: `true`.
- `created_at` (Timestamp)

#### 2.4 `customer_stamps` (Tracks customer loyalty progress)
- `id` (UUID, Primary Key)
- `merchant_id` (UUID, Foreign Key -> `merchants.id`, Cascade Delete)
- `customer_phone` (String, Required) — Collected via WebOTP.
- `stamps_collected` (Integer) — Default: `0`.
- `total_redeemed` (Integer) — Default: `0`. Tracks how many times a reward was claimed.
- `last_scanned_at` (Timestamp) — Used to calculate cooldown periods (e.g., max 1 scan per 24 hours).
- **Constraint:** Unique composite key on (`merchant_id`, `customer_phone`).

#### 2.5 `payment_requests` (Tracks manual bKash/Nagad subscription payments)
- `id` (UUID, Primary Key)
- `merchant_id` (UUID, Foreign Key -> `merchants.id`, Cascade Delete)
- `payment_method` (String, Required) — e.g., `'bKash'`, `'Nagad'`.
- `sender_number` (String, Required)
- `trx_id` (String, Unique, Required)
- `amount` (Decimal, Required)
- `status` (Enum/String) — Default: `'pending'`. Options: `'pending'`, `'approved'`, `'rejected'`.
- `created_at` (Timestamp)

### 3. Relationships & Keys
- A **Merchant** can have multiple **Branches** (1:N).
- A **Merchant** can have multiple **Offers** (1:N).
- A **Merchant** can have multiple **Customer Stamps** records (1:N).
- A **Merchant** can submit multiple **Payment Requests** over time (1:N).
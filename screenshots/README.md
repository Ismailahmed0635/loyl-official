# Loyl — Page Screenshots

Captured 2026-09-24 from `http://localhost:3000` (Next.js dev server) with Playwright.

- **Desktop:** 1280×860 — `desktop/` (30 files)
- **Mobile:** 390×844 — `mobile/` (28 files)
- **Non-destructive:** dialogs were opened and cancelled; no approvals, rejections, claims, or form submissions were performed.

## Test accounts

| Role | Identity |
|---|---|
| Merchant | `01741995455` — Stamp & Scratch Café (stamp + scratch offers, 0 branches) |
| Customer | `01674372768` (holds the seeded 99-stamp café card) |
| Admin | dev password `Loyl-Admin-2026!Dev` |
| OTP code | `123456` |

## Pages

| File | Route | Session | Shows |
|---|---|---|---|
| 01-root | `/` | guest | server redirect landing on `/welcome` |
| 02-welcome | `/welcome` | guest | merchant OTP signup entry |
| 03-otp | `/otp` | guest | phone / verification-code entry |
| 04-business-setup | `/business-setup` | guest | merchant profile setup form |
| 05-scan | `/scan` | guest | customer sign-in prompt |
| 05-scan-authed | `/scan` | customer | camera collect view |
| 06-admin-login | `/admin/login` | guest | admin password sign-in |
| 07-404 | unknown path | merchant | Next.js 404 (guests get redirected instead) |
| 08-dashboard | `/dashboard` | merchant | stats + Your Offers |
| 09-analytics | `/analytics` | merchant | range filters + charts |
| 10-customers | `/customers` | merchant | card holders + phone search |
| 11-branches | `/branches` | merchant | branch list (empty state: 0 branches) |
| 12-billing | `/billing` | merchant | plans + payment request history |
| 13-billing-checkout | `/billing/checkout` | merchant | checkout page |
| 14-offers-new | `/offers/new` | merchant | offer builder + live preview |
| 15-offers-edit | `/offers/{id}` | merchant | edit existing stamp offer |
| 16-offers-qr | `/offers/{id}/qr` | merchant | generated QR poster |
| 17-settings | `/settings` | merchant | profile, social links, account |
| 18-scan-offer | `/scan/{offerId}` | customer | collect view, 99-of-5 unlocked card |
| 19-stamp-card | `/stamp-card` | customer | stamp card list |
| 20-reward | `/reward` | customer | ready-to-claim reward (seeded) |
| 21-profile | `/profile` | customer | customer shops + stats |
| 22-admin-dashboard | `/admin` | admin | Platform Overview |
| 23-admin-merchants | `/admin/merchants` | admin | merchant directory + actions |
| 24-admin-billing | `/admin/billing` | admin | payment verification table |

Mobile admin pages (22–24) show the "Desktop only for now" notice below 1024px by design.

## Modals & dialogs

| File | Opened from | State captured | Closed via |
|---|---|---|---|
| m01-checkout-modal | merchant `/billing` → Upgrade | "Upgrade your subscription" checkout | Escape |
| m02-approve-tier-select | admin billing → Approve | ConfirmDialog + Assign-tier select | Cancel |
| m03-screenshot-lightbox | admin billing → View | lightbox (image itself fails to load — see Notes) | Close |
| m04-reject-confirm | admin billing → Reject | "Reject payment from …?" | Cancel |
| m05-reward-modal | customer `/reward` → Claim | "Your reward is ready!" scratch card | backdrop (never scratched/claimed) |
| m01-checkout-modal (mobile) | mobile `/billing` → Upgrade | checkout, mobile layout | Escape |
| m05-reward-modal (mobile) | mobile `/reward` → Claim | reward, mobile layout | backdrop |
| m07-quick-menu (mobile) | mobile dashboard → FAB | MerchantNav quick menu overlay | FAB toggle |

## Notes

- Each capture was gated on page-specific markers (headings, unique labels, and absence of loading strings) plus a settle delay; files were then spot-verified by reading the PNGs.
- The reward flow uses a café card seeded to 99 stamps so `/reward` shows "Ready to claim".
- Admin billing/merchants contain seeded dev rows (`P7 *`, `Phase7 *`).
- Capture tooling finding: `mobile/06-admin-login` had to be captured **without** reduced-motion emulation — under `prefers-reduced-motion: reduce` the login card stays at `opacity: 0` (animation never resolves). Likely a real app bug worth fixing.
- App finding: in `m03-screenshot-lightbox` the lightbox dialog renders correctly, but the seeded payment's screenshot image never loads (broken-image state, still broken after a 10s wait) — likely a missing seeded file or broken screenshot URL, worth a ticket.
- Desktop captures are viewport shots at exactly 1280×860 (mobile: 390×844); content below the fold is cropped by design for consistent file dimensions.

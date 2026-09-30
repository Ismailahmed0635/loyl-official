# loyl.io — App Requirements & Workflow

> Reference document for all future builds. Keep this file up to date as the product evolves.

**Purpose:** Loyalty platform for merchants — digital stamp cards and scratch-card offers, branch management, and AI-generated digital menus.

**Build status (see `phases.md` for detail):**

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Auth Flow (login/register, OTP, business setup) | ✅ Done — smoke 35/35 |
| 2 | Merchant Core (dashboard, offers, QR, branches) | ✅ Done — smoke 88/88 |
| 3 | Customer Experience (scan, stamps, reward) | ✅ Done — smoke 78/78 |
| 3.5 | Separated Offer Types (Stamp vs Scratch Card) | ✅ Done — smoke pass |
| 4 | Analytics & Settings | ✅ Done — smoke 53/53 |
| 5 | Admin Panel | ✅ Done — smoke 63/63 |
| 6 | Public Pages | 🔲 Pending |
| 7 | Payments & Billing | ✅ Done — smoke 54/54 |
| 8 | Polish & Launch Prep | 🔲 Pending |
| 9 | Merchant-Approved Stamps (ScanRequest) | 🟡 In Progress — code done, verification pending |

---

## 1. Auth Page

- Standard merchant **login** and **register** flows.

---

## 2. Dashboard

Main analytics hub. Tracks:

| Metric | Description |
| --- | --- |
| Today's Scans | QR scans recorded today |
| New Starts | New loyalty programs started |
| Returning Customers | Customers who came back |
| Active Offer Performance | Performance of offers currently live |

---

## 3. Offer Creation

The merchant **first picks the offer type** with a clear selector — **[ ] Stamp Offer** vs
**[ ] Scratch Card Offer** — and the form fields change dynamically after the choice.
The two types are fully separated end-to-end: separate DB columns, separate validation
schemas, separate API handling, separate customer UI.

**Shared fields & controls (both types):**

- **Title** — name of the offer.
- **Expiration** — days until the offer expires (chips 30/60/90/180 or a custom value).
- **Poster template URL** *(optional)* — background image for the QR poster.
- **Type toggle** — choose one of the two workflows below. The type is **locked after
  creation** (PATCH rejects changing it with `422 OFFER_TYPE_IMMUTABLE`).

**Workflow:**

1. Fill in title, expiration, and select Stamp or Scratch Card.
2. Click **"Create Offer"** → triggers a loading state.
3. On completion, the generated **QR code box** is displayed below the form.

### 3A. Stamp Offer workflow

Fields shown only for this type:

- **Reward type** — discount / free item / custom gift.
- **Required stamps** — exact number of stamps (e.g. 5 stamps = 1 free coffee).

Customer side: scans the QR → GPS check (if the shop has branch coordinates) →
the customer sees "Waiting for the shop to confirm" and the shop is notified on its
**Stamp Requests** page → the merchant **accepts** the check-in before the stamp lands
(accept or hold only — there is deliberately no reject, so a merchant can never deny a
customer a stamp; a repeat scan just returns the same waiting check-in, so the customer
is never blocked or shown an error) → 24-hour cooldown starts on approval, limiting a
customer to one stamp per shop per day →
an accumulating stamp card fills up → reward pop-up at the threshold →
optional Google Maps review bonus.

### 3B. Scratch Card Offer workflow

Fields shown only for this type:

- **Reward mode** (merchant-chosen):
  - **Fixed / Predetermined** — exactly one reward; every QR code reveals it.
  - **Randomized pool** — 2–20 rewards; the system cycles them in a shuffled
    rotation so every reward appears regularly and never twice in a row within a
    cycle.
- **Reward rows** — merchant-authored labels (e.g. Free Drink, 20% Off, Free
  Dessert); fixed mode has a single input, pool mode supports add/remove rows.

Customer side: scans the QR → digital scratch card UI → scratch the foil to
reveal the drawn reward → 24-hour per-offer cooldown shows the last reward and
the next-scratch countdown. No stamp card is involved.

### Separation guarantees

- **DB:** `Offer.offerType` (`STAMP`/`SCRATCH`) decides which columns are used —
  `rewardType`/`requiredStamps` for stamps, `scratchMode` + `ScratchItem` rows
  for scratch; `ScratchResult` records every reveal.
- **API:** `POST /api/offers` branches on `offerType` with a discriminated union
  (unknown types → `422`); `POST /api/customer/scratch` rejects stamp offers with
  `409 WRONG_OFFER_TYPE`, and the stamp endpoints (`scan`/`redeem`/`review`)
  reject scratch offers with `409 WRONG_OFFER_TYPE`; `/api/customer/cards` only
  pairs stamp cards with stamp offers.
- **UI:** `OfferForm` swaps its fields by type; the scan page renders
  `ScratchOfferView` (scratch foil → reveal → cooldown) or the stamp card +
  reward modal — never both.

---

## 4. Branch Page

- **Add** branches.
- **Delete** branches.
- **Location settings** — mandatory for every branch.
- **Branch-level analytics** — performance metrics scoped to each branch.

---

## 5. Digital Menu *(inside Branch Page — no side-menu link)*

- Entry point: a **camera icon** on the Branch Page.
- Tapping the camera icon opens the camera to **snap photos of the physical menu**.
- System **automatically generates a digital menu**, including:
  - Menu items
  - Prices
- Output: a **downloadable QR code** for the digital menu.

> Note: The Digital Menu is reached only through the Branch Page — it does **not** appear as a side-menu item.

---

## 6. Settings Page

- **Profile edits** — merchant profile information.
- **Social links** — manage social media links.
- **Map location connection** — link/verify the business location on a map.

---

## Screen Map

```
Auth (Login / Register)
└── Dashboard              — scans, starts, returning customers, offer performance
├── Offers                 — pick Stamp | Scratch type → fill its fields → loading → QR code box
├── Branches               — add/delete, location (required), branch analytics
│   └── Digital Menu       — camera capture → auto-generate menu + prices → downloadable QR
└── Settings               — profile, social links, map location
```

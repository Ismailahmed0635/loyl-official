# PRD.md

## PRD — Plan the product

### 1. Product Overview
Druto-Style BD is a web-based loyalty platform enabling local businesses to offer digital stamp cards. The system automates QR code generation embedded in promotional posters and manages merchant subscriptions via manual approval workflows.

### 2. User Roles
- **Customer:** Scans QR codes, authenticates via phone, collects stamps, leaves reviews, and redeems rewards.
- **Merchant:** Creates offers, generates QR posters, manages branches, tracks customer analytics, and submits subscription payments.
- **Super Admin:** Approves manual payments (bKash/Nagad), manages platform-wide settings, and oversees all merchants.

### 3. Functional Requirements

#### 3.1 Landing Page Module
- Display platform service brief, features, and pricing tiers.
- Call-to-Action (CTA) for merchant registration.

#### 3.2 Merchant Dashboard Module
- **Authentication:** Secure login/signup using AWS Cognito (Phone/Email OTP).
- **Profile Management:** Input business name, logo, category, and multi-branch details.
- **Analytics:** Real-time data on daily scans, new vs. returning customers, and total redeemed rewards.
- **Offer & QR Workflow:**
  - Define offer duration, required stamp count, and reward type (discount, free item).
  - Automatically generate a dynamic QR code and merge it onto an uploaded poster image to create a ready-to-print file.
- **Branch & GPS Setup:** Configure location coordinates to allow the system to auto-detect which branch a customer is scanning from.

#### 3.3 Customer Web App Module
- **Authentication:** Mandatory mobile number collection utilizing Autofill WebOTP for a frictionless experience.
- **Digital Stamp UI:** Display merchant header, logo, and an animated stamp/scratch card that visually fills up upon scanning.
- **Review Engine:** "Rate Us" button redirecting to Google Maps; verifies return focus to grant a bonus stamp and display a completion checkmark.
- **Reward Claim:** Trigger a 2x2 animated confirmation pop-up when all stamps are collected, displaying the reward and a redemption button to show the cashier.

#### 3.4 Super Admin Panel Module
- **Merchant Management:** View, edit, and monitor all registered merchants and their activity.
- **Subscription & Billing:** Manage monthly/yearly plans and track expiration dates.
- **Manual Payment Gateway:** Interface to review submitted bKash/Nagad TrxIDs and manually approve them to grant dashboard access.

### 4. Non-Functional Requirements
- **Performance:** Optimized for low-end mobile devices and slow mobile networks in Bangladesh.
- **Security:** Implement cooldown periods (e.g., 24-hour lock per shop) and JWT-based session management to prevent scan fraud.
- **Usability:** PWA-like mobile experience requiring no app downloads for the end customer.

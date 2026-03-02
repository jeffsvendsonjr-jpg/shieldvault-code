# ShieldVault Server — Deployment Guide

This is the licensing backend for ShieldVault Pro. It handles Stripe Checkout, webhook events (subscription created/cancelled), and license key verification. It is designed to be deployed to [Replit](https://replit.com) as a free-tier Node.js app.

---

## Prerequisites

- A [Stripe](https://stripe.com) account (free to create)
- A [Replit](https://replit.com) account (free tier works)

---

## Step 1 — Create a Stripe product and price

1. Go to **Stripe Dashboard → Products → Add product**
2. Name it "ShieldVault Pro"
3. Add a **recurring price**: `$3.99 / month`
4. Copy the **Price ID** (starts with `price_...`) — you'll need it below

---

## Step 2 — Deploy to Replit

1. Create a new Replit: **Import from GitHub** and select this repo, or create a blank **Node.js** Repl and upload the `server/` folder contents
2. In Replit, open the **Secrets** panel (lock icon in the sidebar) and add:

   | Key | Value |
   |-----|-------|
   | `STRIPE_SECRET_KEY` | Your Stripe secret key (`sk_live_...` or `sk_test_...`) |
   | `STRIPE_WEBHOOK_SECRET` | Your webhook signing secret (see Step 3) |
   | `STRIPE_PRICE_ID` | The price ID from Step 1 (`price_...`) |
   | `APP_URL` | Your Replit app URL, e.g. `https://extension-paywall.replit.app` (no trailing slash) |

3. In the Replit shell, run:
   ```bash
   npm install
   ```
4. Click **Run** — the server should start and log:
   ```
   ShieldVault server running on port 3000
   ```

---

## Step 3 — Configure the Stripe webhook

1. In **Stripe Dashboard → Developers → Webhooks**, click **Add endpoint**
2. Set the endpoint URL to: `https://your-replit-url.replit.app/api/webhook`
3. Under **Events to send**, select:
   - `checkout.session.completed`
   - `customer.subscription.deleted`
   - `customer.subscription.paused`
   - `invoice.payment_failed`
4. Click **Add endpoint**, then reveal and copy the **Signing secret** (`whsec_...`)
5. Add it to Replit Secrets as `STRIPE_WEBHOOK_SECRET`

---

## Step 4 — Update the extension

In `proofs.js`, update `API_BASE` to your Replit app URL:

```js
const API_BASE = "https://your-replit-url.replit.app";
```

Then rebuild the extension zip:

```bash
npm run zip   # run from the repo root
```

---

## How it works

```
User clicks "$3.99/month" in extension popup
  → opens /checkout page
  → POST /api/checkout  →  Stripe-hosted checkout
  → user pays  →  Stripe fires webhook to /api/webhook
  → server generates license key: SV-XXXX-XXXX-XXXX-XXXX
  → user lands on /success?session_id=...
  → page fetches GET /api/license/key  →  displays their key
  → user copies key, enters it in extension popup
  → extension POST /api/license/verify  →  { valid: true }
  → Pro status saved in chrome.storage.local
  → behavioral protection activates
```

---

## Local development

```bash
cd server
cp .env.example .env   # fill in your test keys
npm install
npm run dev            # uses node --watch
```

Use [Stripe CLI](https://stripe.com/docs/stripe-cli) to forward webhooks locally:

```bash
stripe listen --forward-to localhost:3000/api/webhook
```

---

## Files

| File | Purpose |
|------|---------|
| `index.js` | Express app entry point |
| `db.js` | JSON-file license store |
| `routes/checkout.js` | Creates Stripe Checkout sessions |
| `routes/license.js` | Verifies license keys; retrieves key by session |
| `routes/webhook.js` | Handles Stripe subscription events |
| `public/checkout.html` | Checkout landing page |
| `public/success.html` | Post-payment key display page |
| `.env.example` | Required environment variables (copy to `.env` for local dev) |
| `licenses.json` | Auto-generated at runtime; **not committed to git** |

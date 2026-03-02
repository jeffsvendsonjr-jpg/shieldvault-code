# ShieldVault — Backend Server

Express.js server that handles Stripe checkout, webhook events, and license key verification for the ShieldVault Pro subscription.

## Overview

```
User clicks "$3.99/month"
  → Extension opens /checkout page
  → POST /api/checkout → Stripe-hosted checkout
  → Payment succeeds → Stripe webhook fires
  → Server generates SV-XXXX-XXXX-XXXX-XXXX key, stores it
  → /success?session_id= → user copies key
  → Enters key in extension popup → POST /api/license/verify ✓
  → shieldvault_pro=true saved to chrome.storage → behavioral modal active
```

## Deploy to Replit

### Step 1 — Create a Stripe product and price

1. Go to **Stripe Dashboard → Products → Add product**
2. Name it "ShieldVault Pro", add a **recurring price**: `$3.99 / month`
3. Copy the **Price ID** (starts with `price_...`)

### Step 2 — Set up the Replit app

1. **Fork or import** this `server/` folder into a new [Replit](https://replit.com) Node.js Repl (or use the existing `extension-paywall` Repl).

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set Secrets** (Replit Secrets panel — never commit real keys):

   | Secret | Where to get it |
   |---|---|
   | `STRIPE_SECRET_KEY` | [Stripe Dashboard → API keys](https://dashboard.stripe.com/apikeys) — use `sk_live_...` for production |
   | `STRIPE_WEBHOOK_SECRET` | [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks) — after adding the endpoint (see Step 3) |
   | `STRIPE_PRICE_ID` | The `price_...` ID from Step 1 |
   | `APP_URL` | The public URL of your Replit app, e.g. `https://extension-paywall.replit.app` (no trailing slash) |
   | `ALLOWED_ORIGINS` | Optional. Comma-separated extra origins to allow CORS |

4. Click **Run** — the server should start and log: `ShieldVault server running on port 3000`

### Step 3 — Register the Stripe webhook

1. Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks) → **Add endpoint**
2. Endpoint URL: `https://<your-replit-url>/api/webhook`
3. Events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.deleted`
   - `customer.subscription.paused`
   - `invoice.payment_failed`
4. Copy the **Signing secret** (`whsec_...`) and save it as `STRIPE_WEBHOOK_SECRET` in Replit Secrets

### Step 4 — Update the extension

In `proofs.js`, update `API_BASE` to your Replit app URL:

```js
const API_BASE = "https://your-replit-url.replit.app";
```

Then rebuild: `npm run zip` (run from the repo root)

## API Endpoints

### `POST /api/checkout`
Creates a Stripe Checkout Session (subscription mode).

**Response:** `{ url: "https://checkout.stripe.com/..." }`

---

### `POST /api/webhook`
Stripe webhook receiver. Must receive the **raw** request body (handled automatically — do not move this route after `express.json()` middleware).

Handled events:
- `checkout.session.completed` — generates and stores a license key
- `customer.subscription.deleted` / `customer.subscription.paused` — revokes the key
- `invoice.payment_failed` — logged only; revocation happens via subscription status change

---

### `POST /api/license/verify`
Used by the extension popup to validate a license key.

**Request body:** `{ "licenseKey": "SV-XXXX-XXXX-XXXX-XXXX" }`

**Response:** `{ "valid": true }` or `{ "valid": false }`

---

### `GET /api/license/key?session_id=<id>`
Used by `success.html` after checkout to retrieve the user's license key.

**Response:** `{ "licenseKey": "SV-XXXX-XXXX-XXXX-XXXX" }`

---

### `GET /checkout`
Landing page with the "Subscribe for $3.99/month" button.

### `GET /success?session_id=<id>`
Post-payment page that fetches and displays the license key for the user to copy.

## License Storage

License keys are persisted in `licenses.json` in the server directory (auto-created on first use). Each entry stores:

```json
{
  "SV-XXXX-XXXX-XXXX-XXXX": {
    "customerId": "cus_...",
    "subscriptionId": "sub_...",
    "email": "user@example.com",
    "createdAt": 1740000000000
  }
}
```

> **Note:** The JSON file store is suitable for Replit. For production scale, swap `db.js` for an encrypted database (Postgres, Supabase, etc.).

## Security

- Stripe webhook signature is verified with `stripe.webhooks.constructEvent` on every request
- CORS is restricted to `chrome-extension://` origins and explicitly listed origins in `ALLOWED_ORIGINS`
- API routes are rate-limited to 30 requests per 15 minutes; page routes to 120 per 15 minutes

## Local Development

```bash
cp .env.example .env   # fill in test keys from https://dashboard.stripe.com/test/apikeys
npm install
npm run dev            # uses node --watch
```

Use the [Stripe CLI](https://stripe.com/docs/stripe-cli) to forward webhooks locally:
```bash
stripe listen --forward-to localhost:3000/api/webhook
```

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

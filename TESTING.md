# ShieldVault — Chrome Testing Guide

This guide covers every test scenario, from a two-minute smoke test to a full end-to-end Stripe Pro flow.  
All "Free tier" tests work with **zero server setup**.

---

## 1 — Sideload the Extension in Chrome

> Do this once; Chrome re-reads the files on every page reload.

1. Open **`chrome://extensions`**
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked**
4. Select the **root of this repo** (the folder that contains `manifest.json`)
5. ShieldVault appears in the extensions list — pin it to the toolbar for easy access

**Reload the extension** after any code change: click the ↺ button on its card in `chrome://extensions`.

---

## 2 — Free Tier: Secret Detection (no server needed)

Secret detection runs entirely in the browser — no Stripe account or server required.

### 2a — Paste trigger

1. Open any supported site (e.g. **https://chatgpt.com**)
2. Click inside the chat input box
3. Paste a string that matches the OpenAI key pattern — `sk-` followed by 20+ alphanumeric characters (construct one yourself, e.g. `sk-` + 40 random letters/digits)
4. ✅ The text should immediately be replaced with `••• SECRET BLOCKED •••`

### 2b — Keystroke trigger

1. On the same chat input, manually type (don't paste) a string matching the AWS Access Key ID pattern: `AKIA` followed by exactly 16 uppercase letters or digits (e.g. `AKIA` + `A1B2C3D4E5F6G7H8`)
2. ✅ The field should be wiped and replaced with `••• SECRET BLOCKED •••`

### 2c — Verify the popup proof log

1. Click the ShieldVault icon in the toolbar
2. ✅ The popup shows a log entry for the site and detector name (e.g. "OpenAI API Key")
3. Click **Clear** to reset the log

### 2d — Other supported patterns to try

| Pattern type | Trigger pattern (type this structure — use fake chars) |
|---|---|
| GitHub PAT | `ghp_` followed by 36 alphanumeric characters |
| Stripe key | `sk_live_` followed by 24+ alphanumeric characters |
| Generic Bearer / JWT | `Bearer ey` followed by base64-looking characters |

---

## 3 — Pro Tier: Behavioral Modal (no server needed)

The behavioral soft-block modal requires `shieldvault_pro = true` in `chrome.storage.local`.  
You can set this directly from the **service worker DevTools console** — no Stripe subscription required.

> **Important:** The extension popup re-verifies your license key against the server on every open. While testing behavioral modals, keep the popup **closed** to prevent it from clearing the mocked Pro flag.

### Step 1 — Enable mock Pro status

1. Go to **`chrome://extensions`** → find ShieldVault
2. Click **"Service Worker"** (blue link under the extension name) — this opens DevTools for the background worker
3. In the **Console** tab, run:
   ```js
   chrome.storage.local.set({ shieldvault_pro: true, shieldvault_license_key: "SV-A1B2-C3D4-E5F6-7890" });
   ```
4. You should see `undefined` — that's correct

### Step 2 — Trigger a behavioral warning

1. Open a supported site: **https://chatgpt.com**, **https://linkedin.com**, or **https://mail.google.com**
2. Click into the message/compose box
3. Type (or paste) one of the following:

   | Detector | What to type |
   |---|---|
   | Shouting | `PLEASE JUST ANSWER THE QUESTION` (15+ all-caps chars) |
   | Aggressive punctuation | `Are you serious?!!!` |
   | Passive aggressive | `Per my last email, this should have been done` |
   | Hostile opener | `You people never listen` |
   | Dismissive | `Clearly you don't understand the requirements` |

4. Press **Enter** (or another key to advance)
5. ✅ A soft-block modal should appear with a warning summary and two buttons:
   - **Edit message** — closes the modal, lets you revise
   - **Send anyway** — dismisses the warning and allows the send to proceed

### Step 3 — Clean up mock Pro status

When done testing, run this in the same service worker console:
```js
chrome.storage.local.remove(["shieldvault_pro", "shieldvault_license_key"]);
```

---

## 4 — Full End-to-End Pro Flow (requires local server + Stripe test mode)

This tests the complete purchase → license key → extension activation loop.

### Prerequisites

- Node.js installed
- [Stripe CLI](https://stripe.com/docs/stripe-cli) installed
- Stripe test-mode keys (from https://dashboard.stripe.com/test/apikeys)

### Step 1 — Start the server

```bash
cd server
cp .env.example .env
# Fill in .env with your Stripe TEST keys:
#   STRIPE_SECRET_KEY=sk_test_...
#   STRIPE_PRICE_ID=price_...   (a test recurring price you created)
#   APP_URL=http://localhost:3000
npm install
npm start
```

Server should print: `ShieldVault server running on port 3000`

### Step 2 — Forward Stripe webhooks to localhost

In a second terminal:
```bash
stripe listen --forward-to localhost:3000/api/webhook
```

Copy the **webhook signing secret** printed by the CLI (`whsec_...`) and add it to your `.env` as `STRIPE_WEBHOOK_SECRET`, then restart the server.

### Step 3 — Update extension to point at localhost

In `proofs.js`, temporarily change:
```js
const API_BASE = "https://extension-paywall.replit.app";
```
to:
```js
const API_BASE = "http://localhost:3000";
```

Then reload the extension in `chrome://extensions`.

> Revert this before committing. You may also need to add `"http://localhost:3000/*"` to `host_permissions` in `manifest.json` for Chrome to allow the extension to reach a plain `http://` server — remove it before shipping.

### Step 4 — Run a test purchase

1. Open the extension popup → click **"$3.99/month"**
2. You'll be taken to `http://localhost:3000/checkout`
3. Click the subscribe button → Stripe hosted checkout opens
4. Use Stripe test card: **`4242 4242 4242 4242`**, any future expiry, any CVC
5. Complete checkout — you'll be redirected to `/success?session_id=...`
6. ✅ A `SV-XXXX-XXXX-XXXX-XXXX` license key should appear on the success page

### Step 5 — Activate in the extension

1. Copy the `SV-...` key
2. Open the extension popup → **"I already purchased"** → paste the key → **Activate**
3. ✅ The popup should switch to the "Pro Active" view
4. ✅ `chrome.storage.local` now has `shieldvault_pro: true`
5. ✅ Behavioral modals now fire (test with steps from Section 3, Step 2)

### Step 6 — Test subscription cancellation

In the Stripe CLI terminal, simulate a cancellation webhook:
```bash
stripe trigger customer.subscription.deleted
```

Reopen the extension popup — ✅ it should show the upgrade screen again (license was revoked).

---

## Quick Reference: Supported Sites

The content script runs on all of these:

| Platform | URL |
|---|---|
| ChatGPT | `chatgpt.com` |
| Claude | `claude.ai` |
| Gemini | `gemini.google.com` |
| Perplexity | `perplexity.ai` |
| Microsoft Copilot | `copilot.microsoft.com` |
| LinkedIn | `linkedin.com` |
| Reddit | `reddit.com` |
| Twitter / X | `twitter.com`, `x.com` |
| Gmail | `mail.google.com` |
| Outlook | `outlook.live.com` |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Extension not appearing | Confirm `manifest.json` is in the folder you selected; reload in `chrome://extensions` |
| Secret not blocked | Check that you're on a supported site and the text matches a detector pattern; open DevTools on the page (not service worker) and check for `[ShieldVault]` console logs after setting `const DEV = true` in `content-script.js` |
| Behavioral modal not showing | Confirm `shieldvault_pro: true` is set (service worker console: `chrome.storage.local.get(null, console.log)`); confirm popup is closed while testing |
| Popup shows "upgrade" even after setting storage | The popup called `verifyStoredLicense` and the server returned an error — run the mock Pro steps again and keep the popup closed while testing content-script behavior |
| `fetch` blocked on localhost | Chrome blocks `http://` requests from extensions by default; temporarily add `"http://localhost:3000/*"` to `host_permissions` in `manifest.json` and reload the extension — **remove it before committing** |

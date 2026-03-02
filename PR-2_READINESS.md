# ShieldVault v1.2.0 — Release Checklist

> 👋 **Not sure where to start?** Open [`QUICKSTART.md`](QUICKSTART.md) — it walks through every step with no command line or coding required. Come back here to tick off items as you go.

Use this checklist to track progress from local testing to a live Chrome Web Store update.

## 1. Chrome Testing (local sideload)

Follow [`TESTING.md`](TESTING.md) sections 2–4:

- [ ] **Secret detection — paste trigger** works on ChatGPT (text wiped, replaced with `••• SECRET BLOCKED •••`)
- [ ] **Secret detection — keystroke trigger** works (AWS-style pattern blocked as typed)
- [ ] **Popup proof log** shows blocked events with correct domain and detector name
- [ ] **Behavioral modal** fires when Pro is mocked via service worker DevTools console
  - [ ] Shouting (15+ all-caps) triggers modal
  - [ ] Aggressive punctuation (`?!!!`) triggers modal
  - [ ] `Per my last email` triggers modal
  - [ ] "Edit message" button closes modal and restores focus
  - [ ] "Send anyway" button dismisses warning and allows text through
- [ ] **End-to-end Stripe flow** completes with test card
  - [ ] Checkout page loads from popup
  - [ ] Test card purchase succeeds
  - [ ] `SV-XXXX-XXXX-XXXX-XXXX` key appears on `/success` page
  - [ ] Key activates successfully in popup
  - [ ] `shieldvault_pro: true` confirmed in storage
  - [ ] Behavioral modals fire after activation
  - [ ] Simulated cancellation webhook resets popup to upgrade screen
- [ ] `const DEV = false` confirmed in `content-script.js` before packaging

## 2. PR & Code Review

- [ ] Current PR marked **Ready for review** (remove draft status)
- [ ] Diff reviewed (docs-only changes in this PR)
- [ ] Current PR **merged** into `main`

## 3. Package for Chrome Web Store

```bash
# Run from repo root after merging
zip -r shieldvault-v1.2.0.zip \
  manifest.json \
  background.js \
  content-script.js \
  proofs.html proofs.js proofs.css \
  icons/
```

- [ ] ZIP created and spot-checked (open it, confirm no `node_modules`, `server/`, or `.git/` inside)
- [ ] `manifest.json` version is `1.2.0`

## 4. Chrome Web Store Update

- [ ] Sign in to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
- [ ] Open the **ShieldVault** listing
- [ ] Upload new package ZIP (Package tab → Upload new package)
- [ ] Store description updated to mention behavioral modals and 10 supported platforms
- [ ] Screenshots updated if UI changed
- [ ] Click **Submit for review** (Google review: 1–3 business days)

## 5. Replit Server Health

- [ ] Server reachable: `curl -X POST https://extension-paywall.replit.app/api/license/verify -H "Content-Type: application/json" -d '{"licenseKey":"SV-0000-0000-0000-0000"}'` returns `{"valid":false}`
- [ ] **Always On** enabled in Replit settings (prevents cold-start delays for paying users)
- [ ] Stripe webhook is registered and active in [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)

## 6. Post-Launch Smoke Test

- [ ] Install the *published* extension from the Chrome Web Store (not the sideloaded version)
- [ ] Verify secret detection still works on ChatGPT
- [ ] Click `$3.99/month` → confirm it hits the live Replit server (not localhost)

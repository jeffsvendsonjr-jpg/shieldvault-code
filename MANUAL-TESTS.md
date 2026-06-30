# ShieldVault — Manual Verification

Load the unpacked extension and confirm the behaviors below. These complement
the automated `node --check` + detector harness run during the store-hardening
pass.

## Load unpacked in Chrome
1. Go to `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the extension folder (the one containing
   `manifest.json`).
4. Confirm it loads with **no errors** and requests only **storage** +
   **activeTab** (no broad "Read your browsing history" / all-tabs warning).

## Detection behavior

| # | Input typed/pasted into a supported site's field | Expected |
|---|---|---|
| A | A real-looking secret, e.g. `API_KEY=sk-ABCDEFGHIJKLMNOP1234567890` | **Hard block** — field redacted, blocked overlay shown |
| B | `email me at test@example.com` (no other secret) | **Soft review** — NOT blocked; you can submit normally |
| C | `call me at 555-123-4567` (no other secret) | **Soft review** — NOT blocked; you can submit normally |
| D | 1800+ chars of ordinary prose (no secret) | **Soft review** ("Large paste review") — NOT blocked |
| E | 1800+ chars that also contain a fake key/token | **Hard block** ("Large sensitive paste") |
| F | `AZURE_OPENAI_API_KEY=abcdef0123456789abcdef0123456789` | Detected as **Azure OpenAI Key** (hard block) |
| G | `API_KEY=abcdef0123456789abcdef0123456789` | Detected by the **generic** API-key detector, **not** mislabeled as Azure |

For B/C/D the message must remain sendable; ShieldVault records a quiet,
metadata-only review entry (the email/phone text itself is never stored) and the
toolbar badge does **not** increment.

## Permission check (`tabs` removed)
- Open the popup on any supported site → the **"Pause on this site"** control
  shows the correct hostname (this confirms the popup can read the active tab
  URL under `activeTab` after the user click — no `tabs` permission needed).
- Click **Pause on this site** → detection stops on that site; **Resume** → it
  returns.
- Open **Settings** and **How it works** links → they open in new tabs
  (`chrome.tabs.create` works without the `tabs` permission).

## First-run / MV3
- On install, `onboarding.html` opens and its buttons work (Set up protection →
  Continue → Done), confirming the external `onboarding.js` loads under the MV3
  `script-src 'self'` CSP. There should be **no CSP errors** in the page console.

## Privacy invariant
- Trigger a hard block, then open the popup → the history entry shows the
  **detector name, site, time** — never the secret content.
- DevTools → Network: nothing is sent anywhere except `shieldvault.site` (and
  only for license/checkout actions you initiate).

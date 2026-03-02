# ShieldVault

**Protect yourself from both leaked secrets and regrettable messages — before you hit send.**

ShieldVault is a dual-purpose browser extension that keeps you safe in two ways:

- **Hard Blocks (Secret Detection):** Instantly detects and wipes API keys, tokens, and credentials before they can be pasted or typed into any site.
- **Soft Blocks (Regret Prevention / Digital Well-being):** Catches regrettable behavior — angry rants, passive-aggressive phrasing, all-caps shouting — and gives you a moment to reconsider before posting.

ShieldVault now runs on AI chat platforms, social media (LinkedIn, Reddit, Twitter/X), and email (Gmail, Outlook) — anywhere an impulsive message can cause real damage.

## Privacy Policy

**ShieldVault collects no data. Period.**

### What we DON'T do:
- We don't collect your secrets or API keys
- We don't track your browsing
- We don't use analytics
- We don't transmit anything to any server
- We don't store your data anywhere except locally in your browser
- We don't send your message content to any external AI or server for analysis — behavioral text analysis uses simple regex patterns that run entirely in your browser

### What we DO:
- All detection — both secret scanning and behavioral analysis — happens 100% locally in your browser
- Session logs (which sites blocked secrets) stay in browser memory and disappear when you close the browser
- Pro status is stored locally using Chrome's storage API

## Pro Tier — Stripe Backend

ShieldVault Pro ($3.99/month) unlocks behavioral analysis (soft-block modals for angry rants, passive-aggressive phrasing, etc.).

The subscription flow is handled by a small Express.js server deployed to Replit:

1. User clicks **"$3.99/month"** in the extension popup
2. Server creates a Stripe Checkout Session → user pays on Stripe-hosted page
3. Stripe webhook fires → server generates a `SV-XXXX-XXXX-XXXX-XXXX` license key
4. User copies the key from the success page and enters it in the extension popup
5. Extension verifies the key with the server → saves `shieldvault_pro=true` locally
6. Behavioral modals are now active

See [`server/README.md`](server/README.md) for full deployment instructions (Replit setup, Stripe webhook registration, environment variables).

## Links

- [Chrome Web Store](https://chromewebstore.google.com/detail/shieldvault-ai-chat-secre/johfmefhjjmejjlopnndkbhmgdidkfao)
- [Report Issues](https://github.com/jeffsvendsonjr-jpg/shieldvault-code/issues)

Last updated: March 2026

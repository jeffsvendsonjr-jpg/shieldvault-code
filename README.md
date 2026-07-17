**[→ Install ShieldVault from the Chrome Web Store](https://chromewebstore.google.com/detail/shieldvault-ai-chat-secre/johfmefhjjmejjlopnndkbhmgdidkfao)**# ShieldVault

**Catches secrets and regrettable messages before you hit send.**

ShieldVault is a browser extension with two layers of protection:

- **Hard Blocks (Secret Detection):** Detects API keys, tokens, credentials, seed phrases, and payment card numbers in what you're about to send, and redacts them in the composer before the message goes anywhere.
- **Soft Blocks (Regret Prevention):** Optionally flags impulsive behavior — angry rants, passive-aggressive phrasing, all-caps shouting, late-night sends — and gives you a moment to reconsider.

It runs on major AI chat platforms (ChatGPT, Claude, Gemini, Perplexity, Copilot, and others), developer surfaces (GitHub, GitLab, Replit, StackBlitz), workplace tools (Slack, Discord, Linear, Jira, Notion, Google Docs), social media (LinkedIn, Reddit, X), and email (Gmail, Outlook). The exact site list is in <a>`manifest.json`</a> — if it's not in `content_scripts.matches`, ShieldVault doesn't run there.

## Privacy — the precise version

The honest claim isn't "we never talk to a server." It's this: **the content you type never leaves your device, and you can verify that in this repository.**

**What never leaves your device:**

- Your messages, prompts, and anything you type. All detection — secret scanning and behavioral analysis — runs locally in <a>`content-script.js`</a> using pattern matching. No text is sent to any server or external AI for analysis.
- The secrets themselves. When ShieldVault redacts something, the secret is never stored — not locally, not remotely. Only a record of the *event* is kept ("AWS key blocked on chatgpt.com"), never its content.

**What is stored locally on your device:**

- Your settings (which guards are on or off).
- A capped log of block events — the detector type and the site, never the content. This lives in Chrome's local extension storage so your protection history survives a browser restart. You can clear it anytime from the extension.
- If you purchase Pro: your license key and display metadata (plan, expiry).

**The one network call this extension makes, and exactly what it contains:**

If (and only if) you activate a Pro license, the extension sends your **license key** — nothing else — to `https://shieldvault.site` to confirm the license is valid. That's the only endpoint this extension can talk to (see `host_permissions` in the manifest), and the only data in the request is the key itself. Free-tier users with no license key stored trigger no network requests at all.

**What we don't do:** no analytics, no tracking, no accounts, no telemetry, no reading your browsing, no transmitting message content anywhere, ever.

Don't take this README's word for any of it — take the code's. The functions that touch the network are easy to find: search the repo for `fetch(`.

## Verify that this code is what's actually running

ShieldVault ships unminified with no build step, so the code in this repository is the code in the extension — and you can prove it:

1. Install ShieldVault from the <a href="https://chromewebstore.google.com/detail/shieldvault-ai-chat-secre/johfmefhjjmejjlopnndkbhmgdidkfao">Chrome Web Store</a>.
2. Find the installed extension folder (visit `chrome://version`, note your Profile Path, then look in `Extensions/johfmefhjjmejjlopnndkbhmgdidkfao/<version>/`).
3. Diff those files against the release tag in this repo matching your installed version. (The repo additionally contains `README.md` and `license`, which are not packaged in the extension — everything else must match.)

If they don't match, open an issue — that would be a serious problem and we want to know immediately.

## Found a false positive or a site where it breaks?

That's the most valuable thing you can give this project. <a href="https://github.com/jeffsvendsonjr-jpg/shieldvault-code/issues">Open an issue</a> with the site and a *fake* example of the text that triggered (never paste a real secret, even a revoked one). False-positive reports have directly driven past releases.

## License

<a>Business Source License 1.1</a> — free for personal, educational, research, and evaluation use. Commercial production use requires a license: jeffsvendsonjr@gmail.com. Converts to MIT on 2030-05-11.

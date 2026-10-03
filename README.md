**[→ Install ShieldVault from the Chrome Web Store](https://chromewebstore.google.com/detail/shieldvault-ai-chat-secre/johfmefhjjmejjlopnndkbhmgdidkfao)**# ShieldVault

**Catches secrets and regrettable messages before you hit send.**

ShieldVault is a browser extension with two layers of protection:

- **Hard Blocks (Secret Detection):** Detects API keys, tokens, credentials, seed phrases, and payment card numbers in what you're about to send, and redacts them in the composer before the message goes anywhere.
- **Soft Blocks (Regret Prevention):** Optionally flags impulsive behavior — angry rants, passive-aggressive phrasing, all-caps shouting, late-night sends — and gives you a moment to reconsider.

It runs on major AI chat platforms (ChatGPT, Claude, Gemini, Perplexity, Copilot, and others), developer surfaces (GitHub, GitLab, Replit, StackBlitz), workplace tools (Slack, Discord, Linear, Jira, Notion), social media (LinkedIn, Reddit, X), and email (Gmail, Outlook). The exact site list is in <a>`manifest.json`</a> — if it's not in `content_scripts.matches`, ShieldVault doesn't run there.

## Privacy — the precise version

ShieldVault checks supported text locally. It does not send protected text to ShieldVault for detection. License validation uses ShieldVault's server.

**What ShieldVault does not transmit for detection:**

- Detection runs locally in <a>`content-script.js`</a> using pattern matching. ShieldVault does not send composer text to its server or an external AI for analysis. Text you choose to submit still goes to the destination site.
- Detected secret values are not stored by ShieldVault. When it redacts a value, only metadata about the event (such as category and site) is kept locally, never the matched value.

**What is stored locally on your device:**

- Your settings (which guards are on or off).
- A capped log of block events — the detector type and the site, never the content. This lives in Chrome's local extension storage so your protection history survives a browser restart. You can clear it anytime from the extension.
- If you purchase Pro: your license key and display metadata (plan, expiry).

**License validation network request:**

When you activate or use a Pro license, the extension sends the stored license key to `https://shieldvault.site` for validation. The manifest grants network host access to that domain. Protected composer text is not included in the license request. A free installation with no license key does not need license validation.

**What the extension does not do:** no extension analytics or telemetry, no account requirement, and no transmission of composer text to ShieldVault for detection. It inspects text in supported fields locally so it can warn or redact before submission.

Don't take this README's word for any of it — take the code's. The functions that touch the network are easy to find: search the repo for `fetch(`.

## Verify that this code is what's actually running

The repository's `main` branch may be ahead of the Chrome Web Store version. To check a particular installed release against source:

1. Install ShieldVault from the <a href="https://chromewebstore.google.com/detail/shieldvault-ai-chat-secre/johfmefhjjmejjlopnndkbhmgdidkfao">Chrome Web Store</a>.
2. Find the installed extension folder (visit `chrome://version`, note your Profile Path, then look in `Extensions/johfmefhjjmejjlopnndkbhmgdidkfao/<version>/`).
3. Compare the installed files with source for that exact published version, when a matching source snapshot is available. Do not compare the installed Store version with the current `main` branch and assume they are the same.

If you cannot find a matching source snapshot, or the files differ unexpectedly, open an issue so the release can be reconciled.

## Found a false positive or a site where it breaks?

That's the most valuable thing you can give this project. <a href="https://github.com/jeffsvendsonjr-jpg/shieldvault-code/issues">Open an issue</a> with the site and a *fake* example of the text that triggered (never paste a real secret, even a revoked one). False-positive reports have directly driven past releases.

## License

<a>Business Source License 1.1</a> — free for personal, educational, research, and evaluation use. Commercial production use requires a license: jeffsvendsonjr@gmail.com. Converts to MIT on 2030-05-11.

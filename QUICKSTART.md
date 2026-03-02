# ShieldVault — Quick Start (Beginner Path)

> **Start here.** You don't need to know Node.js, Stripe, or the command line to ship this.  
> This guide covers the *minimum* steps to verify the extension works and get it live in the Chrome Web Store.

---

## What you need

- Google Chrome (already installed)
- This repository folder on your computer
- A Chrome Web Store developer account — if you've published the extension before, you already have one. If not, sign up free at [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole) (requires a one-time $5 registration fee to Google)

That's it. No terminal. No Stripe CLI. No server setup.

---

## Step 1 — Load the extension in Chrome (2 minutes)

1. Open Chrome and go to **`chrome://extensions`** in the address bar
2. Turn on **Developer mode** — the toggle is in the top-right corner  
   *(it might already be on from last time)*
3. Click the **"Load unpacked"** button that appears
4. A file picker opens — navigate to this repo folder (the one with `manifest.json` in it) and click **"Select Folder"**
5. ShieldVault appears in the list ✅

**Pin it:** Click the puzzle-piece icon in the Chrome toolbar → find ShieldVault → click the pin icon. This puts the ShieldVault icon in your toolbar so you can click it easily.

---

## Step 2 — Test that secret detection works (3 minutes)

This is the most important test. It runs entirely in the browser — no server, no account, nothing.

1. Open **https://chatgpt.com** in a new tab (you don't need to be logged in — just open the page)
2. Click inside the **"Message ChatGPT"** input box
3. Type (or paste) this fake API key — it's not real, it's just the right format:

   ```
   sk-abcdefghijklmnopqrstuvwxyz123456789012345678
   ```

4. Watch the input box — ✅ the text should disappear and be replaced with `••• SECRET BLOCKED •••`

5. Click the **ShieldVault icon** in the toolbar — ✅ you should see a log entry saying the key was blocked

> **If it worked:** you're done testing. Move to Step 3.  
> **If nothing happened:** reload the extension (go to `chrome://extensions`, click the ↺ reload button on the ShieldVault card) and try again.

---

## Step 3 — Merge the pull request on GitHub (1 minute)

1. Open your repository on GitHub and click the **"Pull requests"** tab
2. Click on the open pull request
3. Scroll to the bottom — click **"Ready for review"** if you see that button (removes draft status)
4. Then click **"Merge pull request"** → **"Confirm merge"**

Done. The code is now on `main`. ✅

---

## Step 4 — Create the ZIP file for the Chrome Web Store

You need to create a ZIP of just the extension files (not the whole repo).

### On Mac
1. Open **Finder** and navigate to this repo folder
2. Select these files/folders all at once (hold ⌘ and click each):
   - `manifest.json`
   - `background.js`
   - `content-script.js`
   - `proofs.html`
   - `proofs.js`
   - `proofs.css`
   - `icons` (the whole folder)
3. Right-click → **"Compress 7 Items"**
4. Rename the resulting file to `shieldvault-v1.2.0.zip`

### On Windows
1. Open **File Explorer** and navigate to this repo folder
2. Select the same files/folders listed above (hold Ctrl and click each)
3. Right-click → **"Compress to ZIP file"** (Windows 11) or **"Send to → Compressed (zipped) folder"**
4. Rename it to `shieldvault-v1.2.0.zip`

**Quick sanity check:** Open the ZIP — you should see `manifest.json` at the top level, not inside a subfolder. If it's inside a subfolder, Chrome Web Store will reject it.

---

## Step 5 — Upload to the Chrome Web Store (5 minutes)

1. Go to **https://chrome.google.com/webstore/devconsole** and sign in
2. Click on your **ShieldVault** listing
3. Click **"Package"** in the left sidebar
4. Click **"Upload new package"** → select your `shieldvault-v1.2.0.zip` file
5. Click **"Store listing"** in the left sidebar
6. In the description, add one line anywhere that says:
   > "Now includes behavioral analysis — soft-blocks angry messages, all-caps shouting, and passive-aggressive phrasing before you hit send."
7. Click **"Save draft"**
8. Click **"Submit for review"**

Google will review it within 1–3 business days and then publish it automatically. ✅

---

## That's it — you're done 🎉

| Step | Time | Skill needed |
|---|---|---|
| Load in Chrome | 2 min | Click a button |
| Test secret detection | 3 min | Type in a text box |
| Merge the PR | 1 min | Click a button on GitHub |
| Create ZIP | 3 min | Select files + right-click |
| Upload to Chrome Web Store | 5 min | Click through a web form |
| **Total** | **~15 min** | **No code required** |

---

## Frequently asked questions

**Do I need to test the Stripe payment flow?**  
No. The payment server is already live on Replit from your earlier setup. You don't need to test it again — it's the same code that was already working.

**Do I need to run `npm install` or any commands?**  
No. The files you're uploading to the Chrome Web Store are plain JavaScript — the browser runs them directly, no build step required.

**What if the Chrome Web Store rejects my submission?**  
They'll email you with a specific reason. The most common rejection for extension updates is "manifest version" or "permission" issues — but since you're not changing any permissions or the manifest version, this is unlikely. If it happens, reply here and we'll fix it together.

**What about the Replit server — do I need to do anything?**  
Only if you previously set up a Replit server for the Pro (paid) features. If so, check whether it's still running: open your Replit app URL in a browser. If you see any response (even an error page), it's awake. If it times out, log in to Replit and click Run. If you haven't set up Pro features yet, you can skip this entirely.

**What if I break something?**  
You can't break anything by following these steps. The extension files in this repo are not changed by loading them in Chrome or uploading them to the Web Store. The worst that can happen is the Web Store rejects the upload — which is easily fixed.

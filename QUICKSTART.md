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

## Step 3 — Merge the pull request on GitHub (2 minutes)

> **Important:** The PR is currently in **Draft** status. You must un-draft it before the merge button appears. Here's the full sequence:

1. **Go directly to the PR:**  
   👉 [https://github.com/jeffsvendsonjr-jpg/shieldvault-code/pull/8](https://github.com/jeffsvendsonjr-jpg/shieldvault-code/pull/8)

2. **Scroll to the very bottom** of the PR page.  
   You'll see a grey banner that says *"This pull request is still a work in progress"* and a button:

   > **[ Ready for review ]**

   Click that button. The PR status changes from "Draft" to "Open" and the merge button appears.

3. Now you'll see the merge section appear. Click:

   > **[ Merge pull request ]**

4. A confirmation prompt appears. Click:

   > **[ Confirm merge ]**

5. You'll see a purple banner: *"Pull request successfully merged and closed"* ✅

   The code is now on `main` — GitHub will automatically start building the ZIP (see Step 4).

> **If you don't see "Ready for review":** Make sure you're logged in as the repo owner (`jeffsvendsonjr-jpg`). The button only appears to the PR author and repo admins.

> **If you see "This branch has conflicts":** Reply here and we'll fix it — but this is unlikely given the current state of the repo.

---

## Step 4 — Get the ZIP file for the Chrome Web Store

> **Good news: you don't have to create the ZIP yourself.** GitHub builds it for you automatically every time code merges to `main`. After you complete Step 3 (merging the PR), the ZIP will be ready to download in about 30 seconds.

### Option A — Download the ZIP from GitHub (easiest, recommended)

1. On your repository page on GitHub, click the **"Actions"** tab (it's in the top nav, next to "Pull requests")
2. In the list on the left, click **"Package Extension"**
3. Click the most recent run (the top one, should show a green ✅ after the merge)
4. Scroll to the bottom of that page — you'll see an **"Artifacts"** section
5. Click **"shieldvault-v1.2.0"** to download the ZIP
6. Your browser will download a file called `shieldvault-v1.2.0.zip` ✅

> If you don't see a green ✅ yet, wait 30 seconds and refresh the page. The build takes about 20–30 seconds to finish.

---

### What's in the ZIP (for reference)

The ZIP contains only the extension files — nothing from `server/`, no docs, no `node_modules`:

```
shieldvault-v1.2.0.zip
├── manifest.json          ← tells Chrome what the extension is
├── background.js          ← service worker (license checks)
├── content-script.js      ← the code that actually blocks secrets/messages
├── proofs.html            ← the popup page you see when clicking the icon
├── proofs.js              ← popup logic
├── proofs.css             ← popup styles
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

Everything else in the repo (`server/`, `README.md`, `TESTING.md`, `scripts/`, etc.) is **not** included — the Chrome Web Store only gets the 10 files above.

---

### Option B — Create the ZIP manually (if GitHub Actions isn't available)

<details>
<summary>Click to expand manual ZIP instructions</summary>

**On Mac:**
1. Open **Finder** and navigate to this repo folder
2. Select these files/folders all at once (hold ⌘ and click each):
   `manifest.json`, `background.js`, `content-script.js`, `proofs.html`, `proofs.js`, `proofs.css`, and the `icons` folder
3. Right-click → **"Compress 7 Items"**
4. Rename the resulting file to `shieldvault-v1.2.0.zip`

**On Windows:**
1. Open **File Explorer** and navigate to this repo folder
2. Select the same files (hold Ctrl and click each)
3. Right-click → **"Compress to ZIP file"** (Windows 11) or **"Send to → Compressed (zipped) folder"**
4. Rename it to `shieldvault-v1.2.0.zip`

**Sanity check:** Open the ZIP — `manifest.json` should be at the top level, not inside a subfolder.

</details>

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
| Merge the PR | 2 min | Click 3 buttons on GitHub |
| Download the ZIP | 30 sec | Click a link on GitHub Actions |
| Upload to Chrome Web Store | 5 min | Click through a web form |
| **Total** | **~13 min** | **No code required** |

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

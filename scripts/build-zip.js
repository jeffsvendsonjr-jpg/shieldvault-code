#!/usr/bin/env node
// build-zip.js — packages the ShieldVault extension for the Chrome Web Store
"use strict";

const { execFileSync } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..");
const manifest = require(path.join(root, "manifest.json"));
const version = manifest.version;
const output = `shieldvault-v${version}.zip`;

const files = [
  "manifest.json",
  "background.js",
  "content-script.js",
  "proofs.html",
  "proofs.js",
  "proofs.css",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png",
];

try {
  execFileSync("zip", [output, ...files], { cwd: root, stdio: "inherit" });
  console.log(`Created ${output}`);
} catch (err) {
  if (err.code === "ENOENT") {
    console.error("Error: `zip` command not found. On Windows, use WSL or install a zip utility.");
  } else {
    console.error(`Error building zip: ${err.message}`);
  }
  process.exit(1);
}

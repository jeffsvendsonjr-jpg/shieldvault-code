// ======================================================
// ShieldVault — License DB
// Simple JSON file persistence for Replit hosting.
// Keys are stored as: { licenseKey -> { customerId, subscriptionId, email } }
//
// NOTE: This stores license metadata in plaintext. For higher-volume or
// higher-security deployments, replace with an encrypted database (e.g.
// Supabase, PlanetScale, or encrypt fields before writing).
// ======================================================
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DB_PATH = path.join(__dirname, "licenses.json");

function load() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    return {};
  }
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf8");
}

/**
 * Generate a new license key in the format SV-XXXX-XXXX-XXXX-XXXX
 */
function generateKey() {
  const seg = () => crypto.randomBytes(2).toString("hex").toUpperCase();
  return `SV-${seg()}-${seg()}-${seg()}-${seg()}`;
}

/**
 * Create and persist a new license key for a Stripe customer.
 * Returns the generated key.
 */
function createLicense({ customerId, subscriptionId, email }) {
  const db = load();
  // Revoke any previous key for this customer before issuing a new one
  for (const [key, val] of Object.entries(db)) {
    if (val.customerId === customerId) {
      delete db[key];
    }
  }
  const key = generateKey();
  db[key] = { customerId, subscriptionId, email, createdAt: Date.now() };
  save(db);
  return key;
}

/**
 * Mark a license as invalid (subscription cancelled/unpaid).
 * Accepts either a licenseKey or a customerId.
 */
function revokeLicense({ licenseKey, customerId }) {
  const db = load();
  if (licenseKey) {
    delete db[licenseKey];
  } else if (customerId) {
    for (const [key, val] of Object.entries(db)) {
      if (val.customerId === customerId) {
        delete db[key];
      }
    }
  }
  save(db);
}

/**
 * Returns true if the license key exists in the DB.
 */
function isValid(licenseKey) {
  const db = load();
  return Object.prototype.hasOwnProperty.call(db, licenseKey);
}

/**
 * Look up the license record for a Stripe customer ID.
 * Returns { licenseKey, ...record } or null.
 */
function getByCustomerId(customerId) {
  const db = load();
  for (const [key, val] of Object.entries(db)) {
    if (val.customerId === customerId) {
      return { licenseKey: key, ...val };
    }
  }
  return null;
}

module.exports = { generateKey, createLicense, revokeLicense, isValid, getByCustomerId };

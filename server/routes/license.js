// POST /api/license/verify — check whether a license key is active
// GET  /api/license/key   — retrieve the license key for a completed checkout session
"use strict";

const express = require("express");
const router = express.Router();
const Stripe = require("stripe");
const db = require("../db");

router.post("/verify", (req, res) => {
  const { licenseKey } = req.body || {};

  if (!licenseKey || typeof licenseKey !== "string") {
    return res.status(400).json({ valid: false, error: "licenseKey is required." });
  }

  const valid = db.isValid(licenseKey.trim().toUpperCase());
  res.json({ valid });
});

// Called by success.html to display the key after checkout
router.get("/key", async (req, res) => {
  const { session_id } = req.query;

  if (!session_id || typeof session_id !== "string") {
    return res.status(400).json({ error: "session_id is required." });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (!session || session.mode !== "subscription" || session.payment_status !== "paid") {
      return res.status(400).json({ error: "Session not found or payment incomplete." });
    }

    const customerId = session.customer;
    if (!customerId) {
      return res.status(400).json({ error: "No customer found on session." });
    }
    const record = db.getByCustomerId(customerId);
    if (!record) {
      return res.status(404).json({ error: "License not found. Please contact support." });
    }

    res.json({ licenseKey: record.licenseKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

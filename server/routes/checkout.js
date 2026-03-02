// POST /api/checkout — create a Stripe Checkout Session
"use strict";

const express = require("express");
const router = express.Router();
const Stripe = require("stripe");

router.post("/", async (req, res) => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const appUrl = process.env.APP_URL;
  const priceId = process.env.STRIPE_PRICE_ID;

  if (!appUrl || !priceId) {
    return res.status(500).json({ error: "Server misconfiguration: APP_URL or STRIPE_PRICE_ID not set." });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/checkout`,
      allow_promotion_codes: true,
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

// POST /api/webhook — Stripe webhook handler
// Generates license keys on successful subscription, revokes on cancellation.
"use strict";

const express = require("express");
const router = express.Router();
const Stripe = require("stripe");
const db = require("../db");

router.post("/", express.raw({ type: "application/json" }), async (req, res) => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], webhookSecret);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode !== "subscription" || session.payment_status !== "paid") break;

      const customerId = session.customer;
      const subscriptionId = session.subscription;
      const email = session.customer_details?.email || "";

      const licenseKey = db.createLicense({ customerId, subscriptionId, email });
      console.log(`License created for ${email}: ${licenseKey}`);
      break;
    }

    case "customer.subscription.deleted":
    case "customer.subscription.paused": {
      const subscription = event.data.object;
      db.revokeLicense({ customerId: subscription.customer });
      console.log(`License revoked for customer ${subscription.customer}`);
      break;
    }

    case "invoice.payment_failed": {
      // Grace period logic: only revoke after the subscription itself transitions
      // to "past_due" or "canceled". Stripe handles the dunning; we just log.
      const invoice = event.data.object;
      console.warn(`Payment failed for customer ${invoice.customer}`);
      break;
    }
  }

  res.json({ received: true });
});

module.exports = router;

// ======================================================
// ShieldVault — Backend Server
// Handles Stripe checkout, webhooks, and license verification.
// Deploy to Replit: set environment variables from .env.example
// ======================================================
"use strict";

// Load .env in local dev (Replit uses its own Secrets panel)
try { require("dotenv").config(); } catch {}

const express = require("express");
const rateLimit = require("express-rate-limit");
const path = require("path");

const checkoutRouter = require("./routes/checkout");
const licenseRouter = require("./routes/license");
const webhookRouter = require("./routes/webhook");

const app = express();
const PORT = process.env.PORT || 3000;

// --------------------------------
// Webhook route must use raw body — register BEFORE json middleware
// --------------------------------
app.use("/api/webhook", webhookRouter);

// --------------------------------
// Standard middleware
// --------------------------------
app.use(express.json());

// CORS: allow the extension popup and the server's own pages
// Set ALLOWED_ORIGINS in env as a comma-separated list if needed.
const rawOrigins = process.env.ALLOWED_ORIGINS || "";
const allowedOrigins = new Set(
  rawOrigins.split(",").map(o => o.trim()).filter(Boolean)
);

app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  // Always allow chrome-extension:// origins (extension popup)
  const allow = origin.startsWith("chrome-extension://") || allowedOrigins.has(origin);
  if (allow) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// --------------------------------
// Rate limiting
// --------------------------------
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

const pageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

// --------------------------------
// API routes
// --------------------------------
app.use("/api/checkout", apiLimiter, checkoutRouter);
app.use("/api/license", apiLimiter, licenseRouter);

// --------------------------------
// Static pages
// --------------------------------
app.use(express.static(path.join(__dirname, "public")));

app.get("/checkout", pageLimiter, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "checkout.html"));
});

app.get("/success", pageLimiter, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "success.html"));
});

// Root redirects to checkout
app.get("/", (req, res) => {
  res.redirect("/checkout");
});

// --------------------------------
// Start
// --------------------------------
app.listen(PORT, () => {
  console.log(`ShieldVault server running on port ${PORT}`);
});

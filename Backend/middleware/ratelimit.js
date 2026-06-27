// rateLimit.js — Rate Limiter
// Prevents API abuse and protects your free Google Translate quota.
// Each IP is limited per route type.

const rateLimit = require("express-rate-limit");

// Translation endpoint — more generous, it's the core feature
const translateLimiter = rateLimit({
  windowMs: 60 * 1000,    // 1 minute window
  max: 30,                // 30 translation requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many translation requests. Please slow down.",
  },
});

// Analytics endpoint — lightweight, allow more
const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many requests.",
  },
});

module.exports = { translateLimiter, analyticsLimiter };
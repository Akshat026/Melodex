// cors.js — CORS Configuration
// Only allows requests from the Chrome extension and localhost.
// Blocks all other origins so random websites can't call your backend.

const cors = require("cors");

const ALLOWED_ORIGINS = [
  // Chrome extensions have this origin format
  "chrome-extension://",
  "https://open.spotify.com",
  // Local dev
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. Postman, curl during dev)
    if (!origin) return callback(null, true);

    // Allow if origin starts with any allowed prefix
    const isAllowed = ALLOWED_ORIGINS.some(allowed =>
      origin.startsWith(allowed)
    );

    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked request from: ${origin}`);
      callback(new Error(`Origin ${origin} not allowed`));
    }
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
};

module.exports = cors(corsOptions);
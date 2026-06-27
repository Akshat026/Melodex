// server.js — Entry Point
// Starts the Express server, wires up middleware and routes.

require("dotenv").config();

const express    = require("express");
const corsMiddleware  = require("./middleware/cors.js");
const translateRoutes = require("./routes/translate.js");
const analyticsRoutes = require("./routes/analytics.js");

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(corsMiddleware);           // restrict origins
app.use(express.json());           // parse JSON request bodies

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/translate", translateRoutes);
app.use("/analytics", analyticsRoutes);
const authRoutes = require("./routes/auth.js");  
app.use("/auth", authRoutes);                      

// ─── Health Check ─────────────────────────────────────────────────────────────
// Visit http://localhost:3000/health to confirm server is running
app.get("/health", (req, res) => {
  res.json({
    status:  "ok",
    service: "Melodex Backend",
    time:    new Date().toISOString(),
  });
});

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: "Route not found." });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ success: false, error: "Internal server error." });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\nMelodex backend running on http://localhost:${PORT}`);
  console.log(`Health check → http://localhost:${PORT}/health\n`);
});
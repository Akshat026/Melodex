// analyticsController.js — Analytics & Feedback Logic

const db = require("../db/database.js");

// POST /analytics/feedback — save thumbs up/down vote
function handleFeedback(req, res) {
  const { songId, targetLanguage, vote } = req.body;

  if (!songId || !vote || !["up", "down"].includes(vote)) {
    return res.status(400).json({
      success: false,
      error: "Missing or invalid fields: songId, vote (up/down)",
    });
  }

  try {
    db.prepare(`
      INSERT INTO feedback (song_id, target_language, vote)
      VALUES (?, ?, ?)
    `).run(songId, targetLanguage || "unknown", vote);

    return res.json({ success: true });

  } catch (error) {
    console.error("Feedback error:", error.message);
    return res.status(500).json({ success: false, error: "Failed to save feedback." });
  }
}

// GET /analytics/stats — summary stats for admin/debugging
function handleStats(req, res) {
  try {
    const totalTranslations = db
      .prepare("SELECT COUNT(*) as count FROM translations")
      .get().count;

    const cacheHits = db
      .prepare("SELECT COUNT(*) as count FROM analytics WHERE from_cache = 1")
      .get().count;

    const totalRequests = db
      .prepare("SELECT COUNT(*) as count FROM analytics")
      .get().count;

    const topLanguages = db
      .prepare(`
        SELECT target_language, COUNT(*) as count
        FROM analytics
        GROUP BY target_language
        ORDER BY count DESC
        LIMIT 5
      `)
      .all();

    const feedbackSummary = db
      .prepare(`
        SELECT vote, COUNT(*) as count
        FROM feedback
        GROUP BY vote
      `)
      .all();

    return res.json({
      success: true,
      stats: {
        totalTranslations,
        totalRequests,
        cacheHits,
        cacheRate: totalRequests
          ? `${Math.round((cacheHits / totalRequests) * 100)}%`
          : "0%",
        topLanguages,
        feedbackSummary,
      },
    });

  } catch (error) {
    console.error("Stats error:", error.message);
    return res.status(500).json({ success: false, error: "Failed to fetch stats." });
  }
}

module.exports = { handleFeedback, handleStats };
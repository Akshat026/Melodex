const express                           = require("express");
const { handleFeedback, handleStats }   = require("../controllers/analyticsController.js");
const { analyticsLimiter }              = require("../middleware/rateLimit.js");

const router = express.Router();

router.post("/feedback", analyticsLimiter, handleFeedback);
router.get("/stats",     analyticsLimiter, handleStats);

module.exports = router;
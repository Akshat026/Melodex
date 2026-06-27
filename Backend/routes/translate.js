const express               = require("express");
const { handleTranslate }   = require("../controllers/translateController.js");
const { translateLimiter }  = require("../middleware/rateLimit.js");

const router = express.Router();

router.post("/", translateLimiter, handleTranslate);

module.exports = router;
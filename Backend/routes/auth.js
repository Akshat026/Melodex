const express = require("express");
const fetch   = require("node-fetch");
const router  = express.Router();

router.post("/callback", async (req, res) => {
  const { code, redirectUrl } = req.body;

  if (!code || !redirectUrl) {
    return res.status(400).json({ error: "Missing code or redirectUrl" });
  }

  try {
    const credentials = Buffer.from(
      `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
    ).toString("base64");

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method:  "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type":  "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type:   "authorization_code",
        code:         code,
        redirect_uri: redirectUrl,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error_description || "Token exchange failed");
    }

    const data = await response.json();

    return res.json({
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_in:    data.expires_in,
    });

  } catch (error) {
    console.error("Auth error:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

router.post("/refresh", async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: "Missing refreshToken" });
  }

  try {
    const credentials = Buffer.from(
      `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
    ).toString("base64");

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method:  "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type":  "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type:    "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) throw new Error("Refresh failed");

    const data = await response.json();

    return res.json({
      access_token: data.access_token,
      expires_in:   data.expires_in,
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
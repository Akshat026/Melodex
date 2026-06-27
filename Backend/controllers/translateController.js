// translateController.js — Translation Logic
// Key improvement: translates LRC lines directly so timestamps map 1:1 to translated lines

const db           = require("../db/database.js");
const fetch        = require("node-fetch");
const Genius       = require("genius-lyrics");
const geniusClient = new Genius.Client(process.env.GENIUS_ACCESS_TOKEN);

// ─── Main Handler ─────────────────────────────────────────────────────────────
async function handleTranslate(req, res) {
  const {
    songId,
    title,
    artist,
    targetLanguage,
    lyrics:    providedLyrics,
    durationMs,
  } = req.body;

  if (!songId || !title || !targetLanguage) {
    return res.status(400).json({
      success: false,
      error:   "Missing required fields: songId, title, targetLanguage",
    });
  }

  try {
    // Step 1: Check DB cache
    const cached = getCachedTranslation(songId, targetLanguage);
    if (cached) {
      console.log(`Cache hit: "${title}" → ${targetLanguage}`);

      // Fetch fresh synced lyrics — already translated and timestamped
      const syncedLyrics = await fetchAndTranslateSyncedLyrics(
        title, artist, durationMs || 240000, targetLanguage
      );

      return res.json({
        success:         true,
        fromCache:       true,
        lyrics:          cached.lyrics,
        syncedLyrics:    syncedLyrics,
        translatedTitle: cached.translated_title,
        language:        targetLanguage,
      });
    }

    console.log(`Cache miss: translating "${title}" by ${artist} → ${targetLanguage}`);

    // Step 2: Translate title
    const translatedTitle = await translateText(title, targetLanguage);

    // Step 3: Try to get synced lyrics with timestamps and translate them directly
    const syncedLyrics = await fetchAndTranslateSyncedLyrics(
      title, artist, durationMs || 240000, targetLanguage
    );

    // Step 4: Get plain lyrics for the panel display
    // Use LRC plain text if available, otherwise Genius, otherwise provided
    let lyrics;
    if (syncedLyrics) {
      // Extract plain text from the translated LRC
      lyrics = extractPlainTextFromLRC(syncedLyrics);
    } else {
      lyrics = providedLyrics || await fetchLyrics(title, artist);
    }

    // Step 5: Translate plain lyrics if not already from LRC
    let translatedLyrics;
    if (syncedLyrics) {
      // Already translated via LRC path — extract plain text
      translatedLyrics = extractPlainTextFromLRC(syncedLyrics);
    } else if (lyrics) {
      translatedLyrics = await translateText(lyrics, targetLanguage);
    } else {
      translatedLyrics =
        `♪ Lyrics not available for "${title}" ♪\n\nTranslated title: ${translatedTitle}`;
    }

    // Step 6: Save to DB
    saveTranslation({
      songId,
      targetLanguage,
      translatedTitle,
      lyrics: translatedLyrics,
    });

    logAnalytics(songId, targetLanguage, false);

    console.log(`Translation sample: "${translatedLyrics.slice(0, 100)}"`);

    return res.json({
      success:         true,
      fromCache:       false,
      lyrics:          translatedLyrics,
      syncedLyrics:    syncedLyrics,      // translated LRC with timestamps
      translatedTitle: translatedTitle,
      language:        targetLanguage,
    });

  } catch (error) {
    console.error("Translation error:", error.message);
    return res.status(500).json({
      success: false,
      error:   "Translation failed. Please try again.",
    });
  }
}

// ─── Fetch + Translate Synced Lyrics ─────────────────────────────────────────
// Gets LRC from lrclib, translates each line, returns translated LRC string
// Result: "[00:30.50] गैसोलीना" — timestamp maps 1:1 to translated text

async function fetchAndTranslateSyncedLyrics(title, artist, durationMs, targetLanguage) {
  try {
    const duration = Math.floor((durationMs || 240000) / 1000);

    const url =
      `https://lrclib.net/api/get` +
      `?artist_name=${encodeURIComponent(artist)}` +
      `&track_name=${encodeURIComponent(title)}` +
      `&duration=${duration}`;

    console.log(`lrclib: fetching for "${title}" duration=${duration}s`);

    const response = await fetch(url, {
      headers: { "User-Agent": "Melodex Chrome Extension v1.0.0" }
    });

    if (!response.ok) {
      console.log(`lrclib: not found (${response.status})`);
      return null;
    }

    const data = await response.json();

    if (!data.syncedLyrics) {
      console.log(`lrclib: no synced lyrics in response`);
      return null;
    }

    console.log(`lrclib: found synced lyrics ✅ — translating lines...`);

    // Parse LRC into lines with timestamps
    const parsedLines = parseLRC(data.syncedLyrics);

    if (!parsedLines.length) return null;

    // Translate all lines in one batch (join → translate → split)
    // This is faster than one API call per line
    const plainTexts     = parsedLines.map(l => l.text);
    const batchText      = plainTexts.join("\n");
    const translatedBatch = await translateText(batchText, targetLanguage);
    const translatedLines = translatedBatch.split("\n");

    // Rebuild LRC string with translated text and original timestamps
    const translatedLRC = parsedLines.map((line, i) => {
      const mm   = String(Math.floor(line.timeMs / 60000)).padStart(2, "0");
      const ss   = String(Math.floor((line.timeMs % 60000) / 1000)).padStart(2, "0");
      const ms   = String(line.timeMs % 1000).padStart(3, "0").slice(0, 2);
      const text = translatedLines[i]?.trim() || line.text;
      return `[${mm}:${ss}.${ms}] ${text}`;
    }).join("\n");

    console.log(`lrclib: translated ${parsedLines.length} lines ✅`);
    return translatedLRC;

  } catch (err) {
    console.error("lrclib error:", err.message);
    return null;
  }
}

// Parses "[mm:ss.xx] text" into [{ timeMs, text }]
function parseLRC(lrcText) {
  const result = [];

  for (const line of lrcText.split("\n")) {
    const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/);
    if (!match) continue;

    const minutes = parseInt(match[1]);
    const seconds = parseInt(match[2]);
    const ms      = parseInt(match[3].padEnd(3, "0"));
    const text    = match[4].trim();

    if (!text || text === "♪") continue;

    result.push({
      timeMs: (minutes * 60 + seconds) * 1000 + ms,
      text,
    });
  }

  return result.sort((a, b) => a.timeMs - b.timeMs);
}

// Extracts plain text from LRC string for panel display
function extractPlainTextFromLRC(lrcText) {
  return lrcText
    .split("\n")
    .map(line => line.replace(/\[\d{2}:\d{2}\.\d{2,3}\]\s?/, "").trim())
    .filter(Boolean)
    .join("\n");
}

// ─── DB Cache ─────────────────────────────────────────────────────────────────
function getCachedTranslation(songId, targetLanguage) {
  return db
    .prepare(`
      SELECT lyrics, translated_title
      FROM translations
      WHERE song_id = ? AND target_language = ?
    `)
    .get(songId, targetLanguage);
}

function saveTranslation({ songId, targetLanguage, translatedTitle, lyrics }) {
  db.prepare(`
    INSERT OR REPLACE INTO translations
      (song_id, target_language, translated_title, lyrics)
    VALUES (?, ?, ?, ?)
  `).run(songId, targetLanguage, translatedTitle, lyrics);
}

// ─── Genius Lyrics Fetcher ────────────────────────────────────────────────────
async function fetchLyrics(title, artist) {
  try {
    console.log(`Genius: searching for "${title}" by "${artist}"...`);

    const searches = await geniusClient.songs.search(`${title} ${artist}`);
    console.log(`Genius: found ${searches?.length} results`);

    if (!searches?.length) return null;

    const song = searches.find(s =>
      s.artist.name.toLowerCase()
        .includes(artist.toLowerCase().split(" ")[0])
    ) || searches[0];

    console.log(`Genius: matched → "${song?.title}" by "${song?.artist?.name}"`);

    if (!song) return null;

    const lyrics = await song.lyrics();
    console.log(`Genius: lyrics length → ${lyrics?.length || 0} chars`);

    return lyrics || null;

  } catch (err) {
    console.error("Genius lyrics error:", err.message);
    return null;
  }
}

// ─── Google Translate (Unofficial, Free) ──────────────────────────────────────
async function translateText(text, targetLanguage) {
  const chunks     = splitIntoChunks(text, 400);
  const translated = [];

  for (const chunk of chunks) {
    if (!chunk.trim()) {
      translated.push("");
      continue;
    }

    try {
      const url =
        `https://translate.googleapis.com/translate_a/single` +
        `?client=gtx&sl=auto&tl=${targetLanguage}&dt=t` +
        `&q=${encodeURIComponent(chunk)}`;

      const response = await fetch(url);

      if (!response.ok) {
        translated.push(chunk);
        continue;
      }

      const data   = await response.json();
      const result = data[0]
        .map(c => c[0])
        .filter(Boolean)
        .join("");

      translated.push(result);

    } catch {
      translated.push(chunk);
    }

    await new Promise(r => setTimeout(r, 200));
  }

  return translated.join("\n");
}

function splitIntoChunks(text, maxLength) {
  const lines  = text.split("\n");
  const chunks = [];
  let current  = "";

  for (const line of lines) {
    if ((current + "\n" + line).length > maxLength) {
      if (current) chunks.push(current.trim());
      current = line;
    } else {
      current = current ? current + "\n" + line : line;
    }
  }

  if (current) chunks.push(current.trim());
  return chunks;
}

// ─── Analytics ────────────────────────────────────────────────────────────────
function logAnalytics(songId, targetLanguage, fromCache) {
  try {
    db.prepare(`
      INSERT INTO analytics (song_id, target_language, from_cache)
      VALUES (?, ?, ?)
    `).run(songId, targetLanguage, fromCache ? 1 : 0);
  } catch {
    // Never let analytics break the main response
  }
}

module.exports = { handleTranslate };
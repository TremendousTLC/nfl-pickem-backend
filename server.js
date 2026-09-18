const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

const PICKS_DIR = path.join(__dirname, "picks");

if (!fs.existsSync(PICKS_DIR)) {
  fs.mkdirSync(PICKS_DIR);
}

app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// GET picks for a season
app.get("/picks/:season", (req, res) => {
  const season = req.params.season;
  const file = path.join(PICKS_DIR, `${season}.json`);

  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      JSON.stringify({ season, players: {} }, null, 2)
    );
  }

  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  res.json(data);
});

// POST picks for a player/week
app.post("/picks/:season/:player/:week", (req, res) => {
  const { season, player, week } = req.params;
  const file = path.join(PICKS_DIR, `${season}.json`);

  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      JSON.stringify({ season, players: {} }, null, 2)
    );
  }

  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!data.players[player]) data.players[player] = {};
  data.players[player][week] = req.body;

  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
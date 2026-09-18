// --- CONFIG / STATE ---

const SCHEDULE_URL = "2026_NFL_schedule.json";
const TEAMINFO_URL = "teamInfo.json";

let scheduleData = null;
let teamInfo = null;
let currentWeek = null;

let currentPlayer = null;

// localStorage keys
const LS_PLAYERS = "pickem_players";
const LS_PICKS = "pickem_picks";

// in-memory caches
let players = {};
let picks = {};

// --- API FETCH (TheSportsDB) ---

async function loadNFLScores() {
  const url = "https://www.thesportsdb.com/api/v1/json/3/eventsseason.php?id=4391&s=2026";

  try {
    const response = await fetch(url);
    const data = await response.json();
    return data.events || [];
  } catch (err) {
    console.error("Error fetching NFL scores:", err);
    return [];
  }
}


// --- MAP API SCORES TO WEEK/GAME INDEX ---

function mapScoresToSchedule(apiGames) {
  const scoreMap = {};

  // initialize empty score map for all weeks
  Object.keys(scheduleData.weeks).forEach(weekKey => {
    scoreMap[weekKey] = {};
  });

  apiGames.forEach(apiGame => {
    const round = Number(apiGame.intRound);

    // Ignore preseason (round 500)
    if (round < 1 || round > 18) return;

    const weekKey = String(round);

    const awayName = apiGame.strAwayTeam;
    const homeName = apiGame.strHomeTeam;

    const awayScore = apiGame.intAwayScore;
    const homeScore = apiGame.intHomeScore;

    // If API has no score yet, skip
    if (awayScore === null || homeScore === null) return;

    const scoreString = `${awayScore}-${homeScore}`;

    const games = scheduleData.weeks[weekKey].games;

    games.forEach((g, idx) => {
      if (
        teamInfo[g.away].fullName === awayName ||
        teamInfo[g.home].fullName === homeName
      ) {
        scoreMap[weekKey][idx] = scoreString;
      }
    });
  });

  return scoreMap;
}


// --- FIX #1: MERGE scoreMap INTO scheduleData ---

function mergeScoresIntoSchedule(scoreMap) {
  Object.keys(scoreMap).forEach(weekKey => {
    const weekScores = scoreMap[weekKey];
    const games = scheduleData.weeks[weekKey].games;

    Object.keys(weekScores).forEach(idx => {
      const scoreString = weekScores[idx];

      // FIX #2: Inject score into each game object
      games[idx].score = scoreString;

      // Optional: split into numeric values
      const [awayScore, homeScore] = scoreString.split("-").map(Number);
      games[idx].awayScore = awayScore;
      games[idx].homeScore = homeScore;
    });
  });
}

// ===============================
//  PICKS MODULE (picks.js)
// ===============================

// In-memory picks object
// Structure:
// picks[player][week][gameIndex] = "TeamName"
let currentSeason = 2026;


// ===============================
//  LOAD PICKS FROM BACKEND
// ===============================

const API_BASE = "https://nfl-pickem-backend.onrender.com";

async function loadPicks(season = currentSeason) {
  try {
    const res = await fetch(`${API_BASE}/picks/${season}`);
    const data = await res.json();
    picks = data.players || {};
    return picks;
  } catch (err) {
    console.error("Error loading picks:", err);
    return {};
  }
}

// ===============================
//  SAVE PICKS TO BACKEND
// ===============================

async function savePicks(season, player, week, picksObj) {
  try {
    await fetch(`${API_BASE}/picks/${season}/${player}/${week}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(picksObj)
    });
  } catch (err) {
    console.error("Error saving picks:", err);
  }
}

// ===============================
//  ENSURE PLAYER EXISTS
// ===============================

function ensurePlayer(player) {
  if (!picks[player]) {
    picks[player] = {};
  }
}


// ===============================
//  ENSURE WEEK EXISTS
// ===============================

function ensureWeek(player, weekKey) {
  if (!picks[player][weekKey]) {
    picks[player][weekKey] = {};
  }
}


// ===============================
//  SET A PICK
// ===============================

function setPickBackend(player, weekKey, gameIndex, team) {
  ensurePlayer(player);
  ensureWeek(player, weekKey);

  picks[player][weekKey][gameIndex] = team;

  // Save to backend
  savePicks(currentSeason, player, weekKey, picks[player][weekKey]);
}


// ===============================
//  GET A PICK
// ===============================

function getPickBackend(player, weekKey, gameIndex) {
  if (!picks[player]) return null;
  if (!picks[player][weekKey]) return null;

  return picks[player][weekKey][gameIndex] || null;
}


// ===============================
//  WEEK LOCKING LOGIC
// ===============================

function isWeekLockedBackend(player, weekKey) {
  const weekObj = picks[player]?.[weekKey];
  if (!weekObj) return false;

  return weekObj.locked === true;
}

function lockWeekBackend(player, weekKey) {
  ensurePlayer(player);
  ensureWeek(player, weekKey);

  picks[player][weekKey].locked = true;

  savePicks(currentSeason, player, weekKey, picks[player][weekKey]);
}


// ===============================
//  INITIALIZE PICKS SYSTEM
// ===============================

async function initPicksSystem() {
  await loadPicks(currentSeason);

  console.log("Picks system initialized.");
}

// ===============================
//  UI WRAPPERS FOR BACKEND PICKS
// ===============================

// UI wrapper for setting a pick
function setPick(weekKey, gameIndex, team) {
  const player = currentPlayer;
  setPickBackend(player, weekKey, gameIndex, team);
  renderPicksForWeek(weekKey);
}

// UI wrapper for getting a pick
function getPick(weekKey, gameIndex) {
  const player = currentPlayer;
  return getPickBackend(player, weekKey, gameIndex);
}

// UI wrapper for checking lock state
function isWeekLocked(weekKey) {
  const player = currentPlayer;
  return isWeekLockedBackend(player, weekKey);
}

// UI wrapper for locking a week
function lockWeek(weekKey) {
  const player = currentPlayer;
  lockWeekBackend(player, weekKey);
  renderPicksForWeek(weekKey);
}


// ---RENDER PICKS FOR THE WEEK

function renderPicksForWeek(week) {
  const container = document.getElementById("picks-table");
  container.innerHTML = "";

  const weekKey = String(week);
  const games = scheduleData.weeks[weekKey].games;

  // Determine if week is locked (submitted OR cutoff passed)
  const locked =
    isWeekLockedBackend(currentPlayer, weekKey) ||
    (picks[currentPlayer] &&
     picks[currentPlayer][weekKey] &&
     picks[currentPlayer][weekKey].locked);

  games.forEach((g, idx) => {
    const row = document.createElement("div");
    row.className = "pick-row";

    // --- SCOREBOARD CELLS ---
    const awayScoreCell = document.createElement("div");
    const homeScoreCell = document.createElement("div");

    // Pull score from scheduleData (after mergeScoresIntoSchedule)
    const score = g.score || null;

    if (score) {
      const [awayScore, homeScore] = score.split("-").map(Number);
      awayScoreCell.textContent = awayScore;
      homeScoreCell.textContent = homeScore;

      // highlight winner
      if (awayScore > homeScore) {
        awayScoreCell.classList.add("winner-score");
      } else if (homeScore > awayScore) {
        homeScoreCell.classList.add("winner-score");
      }
    } else {
      awayScoreCell.textContent = "-";
      homeScoreCell.textContent = "-";
    }

    // --- MATCHUP ---
    const matchup = document.createElement("div");
    matchup.textContent = `${g.away} @ ${g.home}`;

    // --- PICK BUTTONS ---
    const actions = document.createElement("div");
    actions.className = "pick-actions";

    const awayBtn = document.createElement("button");
    awayBtn.textContent = g.away;

    const homeBtn = document.createElement("button");
    homeBtn.textContent = g.home;

    // Highlight saved pick
    const savedPick = getPickBackend(currentPlayer, weekKey, idx);

    if (savedPick === g.away) {
      awayBtn.classList.add("selected");
    }
    if (savedPick === g.home) {
      homeBtn.classList.add("selected");
    }

    // Locking logic
    if (locked) {
      awayBtn.disabled = true;
      homeBtn.disabled = true;
    } else {
      awayBtn.addEventListener("click", () => setPickBackend(currentPlayer, weekKey, idx, g.away));
      homeBtn.addEventListener("click", () => setPickBackend(currentPlayer, weekKey, idx, g.home));
    }

    actions.appendChild(awayBtn);
    actions.appendChild(homeBtn);

    // --- CURRENT PICK CELL ---
    const currentPickCell = document.createElement("div");
    currentPickCell.id = `pick-${weekKey}-${idx}`;
    currentPickCell.textContent = savedPick || "";

    // --- BUILD ROW IN SCOREBOARD ORDER ---
    row.appendChild(awayScoreCell);   // LEFT SCORE
    row.appendChild(matchup);         // AWAY @ HOME
    row.appendChild(homeScoreCell);   // RIGHT SCORE
    row.appendChild(actions);         // PICK BUTTONS
    row.appendChild(currentPickCell); // YOUR PICK

    container.appendChild(row);
  });

  updateEditLockState();
}

// --- FINAL INIT BLOCK (CALL EVERYTHING CLEANLY) ---

async function initApp() {
  await initScores();      // your score system
  await initPicksSystem(); // new picks.js module

  renderCurrentWeek();
  renderPicksForWeek(currentWeek);
}

async function initScores() {
  const apiGames = await loadNFLScores();
  const scoreMap = mapScoresToSchedule(apiGames);
  mergeScoresIntoSchedule(scoreMap);

  console.log("Scores merged:", scoreMap);

  // Re-render UI now that scores exist
  renderCurrentWeek();
  renderPicksForWeek(currentWeek);
  renderStandings();
}

// --- TEAM LOGOS ---

const teamLogos = {
  ARI: "LOGOS/ARI.PNG",
  ATL: "LOGOS/ATL.PNG",
  BAL: "LOGOS/BAL.PNG",
  BUF: "LOGOS/BUF.PNG",
  CAR: "LOGOS/CAR.PNG",
  CHI: "LOGOS/CHI.PNG",
  CIN: "LOGOS/CIN.PNG",
  CLE: "LOGOS/CLE.PNG",
  DAL: "LOGOS/DAL.PNG",
  DEN: "LOGOS/DEN.PNG",
  DET: "LOGOS/DET.PNG",
  GB:  "LOGOS/GB.PNG",
  HOU: "LOGOS/HOU.PNG",
  IND: "LOGOS/IND.PNG",
  JAX: "LOGOS/JAX.PNG",
  KC:  "LOGOS/KC.PNG",
  LV:  "LOGOS/LV.PNG",
  LAC: "LOGOS/LAC.PNG",
  LAR: "LOGOS/LAR.PNG",
  MIA: "LOGOS/MIA.PNG",
  MIN: "LOGOS/MIN.PNG",
  NE:  "LOGOS/NE.PNG",
  NO:  "LOGOS/NO.PNG",
  NYG: "LOGOS/NYG.PNG",
  NYJ: "LOGOS/NYJ.PNG",
  PHI: "LOGOS/PHI.PNG",
  PIT: "LOGOS/PIT.PNG",
  SEA: "LOGOS/SEA.PNG",
  SF:  "LOGOS/SF.PNG",
  TB:  "LOGOS/TB.PNG",
  TEN: "LOGOS/TEN.PNG",
  WAS: "LOGOS/WAS.PNG"
};

// --- INIT ---
loadLogoBanner();
loadLocalStorage();
setupUIHandlers();

Promise.all([
  fetch(SCHEDULE_URL).then(r => r.json()),
  fetch(TEAMINFO_URL).then(r => r.json())
]).then(async ([schedule, teams]) => {
  scheduleData = schedule;
  teamInfo = teams;
  currentWeek = detectCurrentNFLWeek(scheduleData);

  const apiGames = await loadNFLScores();

  if (!Array.isArray(apiGames)) {
    console.warn("Scores unavailable — API returned nothing.");
    scores = {};
  } else {
    scores = mapScoresToSchedule(apiGames);
    mergeScoresIntoSchedule(scores);
  }

  // NEW: load picks from backend
  await initPicksSystem();

  renderCurrentWeek();
  renderStandings();
  renderTeamsList();
  renderNFLWeekScheduleSelector();
  renderPicksForWeek(currentWeek);
  updateLeagueStats();
});


// --- LOCAL STORAGE ---

function loadLocalStorage() {
  try {
    const p = localStorage.getItem(LS_PLAYERS);
    const pk = localStorage.getItem(LS_PICKS);
    players = p ? JSON.parse(p) : {};
    picks = pk ? JSON.parse(pk) : {};
  } catch (e) {
    players = {};
    picks = {};
  }
}

function saveLocalStorage() {
  localStorage.setItem(LS_PLAYERS, JSON.stringify(players));
  localStorage.setItem(LS_PICKS, JSON.stringify(picks));
}



// --- UI HANDLERS ---

function setupUIHandlers() {
  const setPlayerBtn = document.getElementById("set-player-btn");
  const leaderboardBtn = document.getElementById("leaderboard-btn");
  const teamsBtn = document.getElementById("teams-btn");
  const scheduleBtn = document.getElementById("schedule-btn");
  const submitPicksBtn = document.getElementById("submit-picks-btn");
  const editPicksBtn = document.getElementById("edit-picks-btn");
  const scheduleWeekSelect = document.getElementById("schedule-week-select");

  setPlayerBtn.addEventListener("click", () => {
    const nameInput = document.getElementById("player-name");
    const name = nameInput.value.trim();
    if (!name) return;
    currentPlayer = name;
    if (!players[currentPlayer]) {
      players[currentPlayer] = { displayName: currentPlayer, createdAt: new Date().toISOString() };
      saveLocalStorage();
      updateLeagueStats();
    }
    showNotification(`Current player set to ${currentPlayer}`);
  });

  leaderboardBtn.addEventListener("click", () => {
    togglePanel("leaderboard-panel");
    renderLeaderboard();
  });

  teamsBtn.addEventListener("click", () => {
    togglePanel("teams-panel");
  });

  scheduleBtn.addEventListener("click", () => {
    togglePanel("nfl-schedule-panel");
    renderNFLWeekSchedule();
  });

  submitPicksBtn.addEventListener("click", () => {
    submitCurrentWeekPicks();
  });

  editPicksBtn.addEventListener("click", () => {
    editCurrentWeekPicks();
  });

  scheduleWeekSelect.addEventListener("change", () => {
    renderNFLWeekSchedule();
  });
}

function togglePanel(id) {
  const panels = ["leaderboard-panel", "teams-panel", "team-detail-panel", "nfl-schedule-panel"];
  panels.forEach(pid => {
    const el = document.getElementById(pid);
    if (!el) return;
    el.classList.toggle("hidden", pid !== id);
  });
}

// --- CURRENT WEEK DETECTION ---

function detectCurrentNFLWeek(schedule) {
  const today = new Date();
  for (let w = 1; w <= 18; w++) {
    const weekKey = String(w);
    const games = schedule.weeks[weekKey].games;
    const dates = games.map(g => new Date(`${g.date} 2026`)); // assumes g.date like "Sep 15"
    const lastGame = dates.reduce((a, b) => a > b ? a : b);
    if (today <= lastGame) {
      return w;
    }
  }
  return 18;
}

// --- CURRENT WEEK DISPLAY ---

function renderCurrentWeek() {
  document.getElementById("current-week").textContent = `Week ${currentWeek}`; // NFL panel
  document.getElementById("picks-current-week").textContent = `Week ${currentWeek}`; // Picks panel
}

// --- WEEK NAVIGATION ---

document.getElementById("prev-week").onclick = () => changeWeek(-1);
document.getElementById("next-week").onclick = () => changeWeek(1);

function changeWeek(delta) {
  currentWeek += delta;
  if (currentWeek < 1) currentWeek = 1;
  if (currentWeek > 18) currentWeek = 18;

  renderCurrentWeek();
  renderPicksForWeek(currentWeek);
}

// --- STANDINGS ENGINE (simplified: based on results you’ll add later) ---

function computeTeamRecords() {
  // For now, stub: all 0-0. Later, you’ll compute from real results.
  const records = {};
  Object.keys(teamInfo).forEach(team => {
    records[team] = {
      wins: 0,
      losses: 0,
      homeWins: 0,
      homeLosses: 0,
      awayWins: 0,
      awayLosses: 0,
      confWins: 0,
      confLosses: 0,
      divWins: 0,
      divLosses: 0
    };
  });
  // TODO: when you have results, update records here.
  return records;
}

function renderStandings() {
  const records = computeTeamRecords();

  const afcDivs = ["East", "North", "South", "West"];
  const nfcDivs = ["East", "North", "South", "West"];

  renderConferenceStandings("AFC", afcDivs, records, "afc-standings", "afc-best");
  renderConferenceStandings("NFC", nfcDivs, records, "nfc-standings", "nfc-best");
}

function renderConferenceStandings(conf, divisions, records, standingsId, bestId) {
  const container = document.getElementById(standingsId);
  container.innerHTML = "";

  const teamsInConf = [];

  // --- Division Standings ---
  divisions.forEach(div => {
    const divBlock = document.createElement("div");
    divBlock.className = "standings-division";

    const h = document.createElement("h5");
    h.textContent = `${conf} ${div}`;
    divBlock.appendChild(h);

    // Teams in this division
    const divTeams = Object.keys(teamInfo).filter(t => {
      const info = teamInfo[t];
      return info.conference === conf && info.division === div;
    });

    // Sort division teams alphabetically by fullName
    divTeams.sort((a, b) => teamInfo[a].fullName.localeCompare(teamInfo[b].fullName));

    divTeams.forEach(team => {
      teamsInConf.push(team);
      const row = createStandingsRow(team, records[team]);
      divBlock.appendChild(row);
    });

    container.appendChild(divBlock);
  });

  // --- Conference Best Teams ---
  const bestContainer = document.getElementById(bestId);
  bestContainer.innerHTML = "";
  bestContainer.classList.add("best-list");

  // Sort by record, ties alphabetical
  const sorted = teamsInConf.sort((a, b) => {
    const ra = records[a];
    const rb = records[b];

    if (ra.wins !== rb.wins) return rb.wins - ra.wins;
    if (ra.losses !== rb.losses) return ra.losses - rb.losses;

    // Alphabetical tiebreaker
    return teamInfo[a].fullName.localeCompare(teamInfo[b].fullName);
  });

  sorted.forEach(team => {
    const row = document.createElement("div");
    row.className = "team-row";

    // Team name + logo
    const nameCell = document.createElement("div");
    nameCell.className = "team-name";

    const logo = document.createElement("img");
    logo.className = "team-logo";
    logo.src = getTeamLogo(team);

    const nameText = document.createElement("span");
    nameText.textContent = team;

    nameCell.appendChild(logo);
    nameCell.appendChild(nameText);

    // W/L column
    const wlCell = document.createElement("div");
    wlCell.textContent = `${records[team].wins}-${records[team].losses}`;

    row.appendChild(nameCell);
    row.appendChild(wlCell);

    row.addEventListener("click", () => showTeamDetail(team));

    bestContainer.appendChild(row);
  });
}

function getTeamHelmet(team) {
  return getTeamLogo(team); // reuse logos for now
}

function loadLogoBanner() {
  const banner = document.getElementById("logo-banner");
  banner.innerHTML = "";

  Object.keys(teamLogos).forEach(team => {
    const img = document.createElement("img");
    img.src = teamLogos[team];
    img.className = "teamLogo"; // optional CSS class
    banner.appendChild(img);
  });
}


function createStandingsRow(team, rec) {
  const row = document.createElement("div");
  row.className = "team-row";

  const nameCell = document.createElement("div");
  nameCell.className = "team-name";

  const logo = document.createElement("img");
  logo.className = "team-logo";
  logo.src = getTeamLogo(team);

  const nameText = document.createElement("span");
  nameText.textContent = team;

  nameCell.appendChild(logo);
  nameCell.appendChild(nameText);

  const wlCell = document.createElement("div");
  wlCell.textContent = `${rec.wins}-${rec.losses}`;

  const homeCell = document.createElement("div");
  homeCell.textContent = `${rec.homeWins}-${rec.homeLosses}`;

  const awayCell = document.createElement("div");
  awayCell.textContent = `${rec.awayWins}-${rec.awayLosses}`;

  const confCell = document.createElement("div");
  confCell.textContent = `${rec.confWins}-${rec.confLosses}`;

  const divCell = document.createElement("div");
  divCell.textContent = `${rec.divWins}-${rec.divLosses}`;

  row.appendChild(nameCell);
  row.appendChild(wlCell);
  row.appendChild(homeCell);
  row.appendChild(awayCell);
  row.appendChild(confCell);
  row.appendChild(divCell);

  row.addEventListener("click", () => showTeamDetail(team));

  return row;
}

function getTeamLogo(team) {
  return teamLogos[team] || "";
}

// --- TEAMS LIST / TEAM DETAIL ---

function renderTeamsList() {
  const container = document.getElementById("teams-list");
  container.innerHTML = "";

  // Sort by fullName alphabetically
  Object.keys(teamInfo)
    .sort((a, b) => teamInfo[a].fullName.localeCompare(teamInfo[b].fullName))
    .forEach(team => {

      // --- render row ---
      const row = document.createElement("div");
      row.className = "team-row";

      // Team name + logo
      const nameCell = document.createElement("div");
      nameCell.className = "team-name";

      const logo = document.createElement("img");
      logo.className = "team-logo";
      logo.src = getTeamLogo(team);

      const nameText = document.createElement("span");
      nameText.textContent = teamInfo[team].fullName;

      nameCell.appendChild(logo);
      nameCell.appendChild(nameText);

      // Conference + Division
      const divCell = document.createElement("div");
      divCell.textContent = `${teamInfo[team].conference} ${teamInfo[team].division}`;

      // Build row
      row.appendChild(nameCell);
      row.appendChild(divCell);

      // Click → open Team Info + Team Schedule
      row.addEventListener("click", () => showTeamDetail(team));

      container.appendChild(row);
    });
}

function showTeamDetail(team) {
  togglePanel("team-detail-panel");

  const info = teamInfo[team];
  const infoContainer = document.getElementById("team-info");
  infoContainer.innerHTML = "";

  const logo = document.createElement("img");
  logo.src = getTeamLogo(team);

  const name = document.createElement("h4");
  name.textContent = info.fullName;

  const stadium = document.createElement("p");
  stadium.textContent = `Stadium: ${info.stadium} (${info.city})`;

  const coach = document.createElement("p");
  coach.textContent = `Head Coach: ${info.coach}`;

  const divConf = document.createElement("p");
  divConf.textContent = `${info.conference} ${info.division}`;

  infoContainer.appendChild(logo);
  infoContainer.appendChild(name);
  infoContainer.appendChild(stadium);
  infoContainer.appendChild(coach);
  infoContainer.appendChild(divConf);

  renderTeamSchedule(team);
}

function renderTeamSchedule(team) {
  const container = document.getElementById("team-schedule");
  container.innerHTML = "";

  const records = computeTeamRecords(); // for opponent record snapshot
  const today = new Date();

  const scheduleLines = [];

  Object.keys(scheduleData.weeks).forEach(weekKey => {
    const games = scheduleData.weeks[weekKey].games;
    games.forEach((g, idx) => {
      if (g.home === team || g.away === team) {
        const isHome = g.home === team;
        const opponent = isHome ? g.away : g.home;
        const dateObj = new Date(`${g.date} 2026`);
        const past = dateObj < today;

        const line = document.createElement("div");
        line.textContent = `Week ${weekKey} ${isHome ? "vs" : "@"} ${opponent}`;

        if (past) {
          // TODO: when you have results, show W/L here
          line.textContent += " (final)";
        } else {
          const oppRec = records[opponent];
          line.textContent += ` (${oppRec.wins}-${oppRec.losses})`;
        }

        scheduleLines.push(line);
      }
    });
  });

  scheduleLines.forEach(l => container.appendChild(l));
}

// --- NFL SCHEDULE VIEW ---

function renderNFLWeekScheduleSelector() {
  const select = document.getElementById("schedule-week-select");
  select.innerHTML = "";
  Object.keys(scheduleData.weeks).forEach(weekKey => {
    const opt = document.createElement("option");
    opt.value = weekKey;
    opt.textContent = `Week ${weekKey}`;
    if (Number(weekKey) === currentWeek) opt.selected = true;
    select.appendChild(opt);
  });
}

function renderNFLWeekSchedule() {
  const select = document.getElementById("schedule-week-select");
  const weekKey = select.value;
  const container = document.getElementById("nfl-schedule-week");
  container.innerHTML = "";

  const games = scheduleData.weeks[weekKey].games;
  games.forEach(g => {
    const row = document.createElement("div");
    row.className = "pick-row";

    const matchup = document.createElement("div");
    matchup.textContent = `${g.away} @ ${g.home}`;

    const dateCell = document.createElement("div");
    dateCell.textContent = g.date;

    const tvCell = document.createElement("div");
    tvCell.textContent = g.network || "";

    row.appendChild(matchup);
    row.appendChild(dateCell);
    row.appendChild(tvCell);

    container.appendChild(row);
  });
}

// --- GAME DATA ---

function parseGameDate(game) {
  return new Date(`${game.date} ${game.time} 2026`);
}

  // EARLIEST GAME cutoff
function getWeekCutoff(week) {
  const games = scheduleData.weeks[String(week)].games;
  const times = games.map(g => parseGameDate(g));
  return new Date(Math.min(...times));
}
function isWeekLocked(weekKey) {
  const player = currentPlayer;
  return isWeekLockedBackend(player, weekKey);
}

function lockWeek(weekKey) {
  const player = currentPlayer;
  lockWeekBackend(player, weekKey);

  renderPicksForWeek(weekKey);
}

// --- RENDER NFL SCORES

function renderNFLScores(week) {
  const container = document.getElementById("nfl-scores-list");
  container.innerHTML = "";

  const weekKey = String(week);
  const games = scheduleData.weeks[weekKey].games;

  games.forEach(g => {
    const row = document.createElement("div");
    row.className = "score-row";

    const matchup = document.createElement("div");
    matchup.textContent = `${g.away} @ ${g.home}`;

    const scoreCell = document.createElement("div");
    scoreCell.textContent = g.score ? g.score : "TBD";

    const winnerCell = document.createElement("div");

    if (g.score) {
      const [a, b] = g.score.split("-").map(Number);
      const winner = a > b ? g.away : g.home;
      winnerCell.textContent = winner;
      winnerCell.className = "winner";
    } else {
      winnerCell.textContent = "";
    }

    row.appendChild(matchup);
    row.appendChild(scoreCell);
    row.appendChild(winnerCell);

    container.appendChild(row);
  });
}

// --- PICKS SYSTEM ---

  // --- RENDER PICKS WITH LOCKING ---

function getPick(weekKey, gameIndex) {
  const player = currentPlayer;
  return getPickBackend(player, weekKey, gameIndex);
}

function setPick(weekKey, gameIndex, team) {
  const player = currentPlayer; // however you track the active user

  // Save to backend + memory
  setPickBackend(player, weekKey, gameIndex, team);

  // Re-render UI
  renderPicksForWeek(weekKey);
}

function submitCurrentWeekPicks() {
  const player = currentPlayer;
  const weekKey = currentWeek;

  lockWeekBackend(player, weekKey);

  renderPicksForWeek(weekKey);
}

function editCurrentWeekPicks() {
  const player = currentPlayer;
  const weekKey = currentWeek;

  // Unlock week
  picks[player][weekKey].locked = false;

  savePicks(currentSeason, player, weekKey, picks[player][weekKey]);

  renderPicksForWeek(weekKey);
}

function isPastEditDeadline(week) {
  // Simple version: Wednesday 23:59 of that week's "start"
  // You can refine this later.
  const weekKey = String(week);
  const games = scheduleData.weeks[weekKey].games;
  const dates = games.map(g => new Date(`${g.date} 2026`));
  const firstGame = dates.reduce((a, b) => a < b ? a : b);

  const deadline = new Date(firstGame);
  // Set to Wednesday of that week at 23:59
  deadline.setDate(deadline.getDate() + (3 - deadline.getDay())); // 3 = Wednesday
  deadline.setHours(23, 59, 0, 0);

  const now = new Date();
  return now > deadline;
}

function updateEditLockState() {
  const weekKey = String(currentWeek);
  const editBtn = document.getElementById("edit-picks-btn");
  const submitBtn = document.getElementById("submit-picks-btn");

  if (!currentPlayer || !picks[currentPlayer] || !picks[currentPlayer][weekKey]) {
    editBtn.disabled = true;
    submitBtn.disabled = false;
    return;
  }

  const weekObj = picks[currentPlayer][weekKey];
  const pastDeadline = isPastEditDeadline(currentWeek);

  if (pastDeadline) {
    weekObj.locked = true;
    saveLocalStorage();
  }

  editBtn.disabled = weekObj.locked || !weekObj.submittedAt;
  submitBtn.disabled = weekObj.locked;
}

// --- LEAGUE STATS / LEADERBOARD ---

function updateLeagueStats() {
  const total = Object.keys(players).length;
  document.getElementById("total-participants").textContent = total;

  const weekKey = String(currentWeek);
  let weekCount = 0;
  Object.keys(picks).forEach(player => {
    const p = picks[player];
    if (p[weekKey] && p[weekKey].submittedAt) weekCount++;
  });
  document.getElementById("week-participants").textContent = weekCount;
}

function renderLeaderboard() {
  const container = document.getElementById("leaderboard-list");
  container.innerHTML = "";

  // For now, simple: count total submitted weeks per player.
  const rows = Object.keys(players).map(player => {
    let totalWeeks = 0;
    let totalPicks = 0;
    const p = picks[player] || {};
    Object.keys(p).forEach(weekKey => {
      if (p[weekKey].submittedAt) {
        totalWeeks++;
        totalPicks += Object.keys(p[weekKey].picks || {}).length;
      }
    });
    return { player, totalWeeks, totalPicks };
  });

  rows.sort((a, b) => b.totalWeeks - a.totalWeeks || b.totalPicks - a.totalPicks || a.player.localeCompare(b.player));

  rows.forEach(row => {
    const div = document.createElement("div");
    div.textContent = `${row.player}: Weeks played ${row.totalWeeks}, Picks made ${row.totalPicks}`;
    div.addEventListener("click", () => showPlayerPicks(row.player));
    container.appendChild(div);
  });
}

function showPlayerPicks(player) {
  togglePanel("player-picks-panel");
  const container = document.getElementById("player-picks-content");
  container.innerHTML = "";

  const p = picks[player] || {};
  Object.keys(p).sort((a, b) => Number(a) - Number(b)).forEach(weekKey => {
    const weekObj = p[weekKey];
    const header = document.createElement("h4");
    header.textContent = `Week ${weekKey}`;
    container.appendChild(header);

    const games = scheduleData.weeks[weekKey].games;
    games.forEach((g, idx) => {
      const line = document.createElement("div");
      const pick = weekObj.games ? weekObj.games[idx] : null;
      line.textContent = `${g.away} @ ${g.home} → ${pick || "No pick"}`;
      container.appendChild(line);
    });
  });
}

// --- NOTIFICATIONS ---

function showNotification(msg) {
  const el = document.getElementById("picks-notification");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3000);
}
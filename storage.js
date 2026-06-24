const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "dialectic.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    username_normalized TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    elo INTEGER NOT NULL DEFAULT 1200,
    matches INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS debates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    stance TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    language TEXT NOT NULL,
    result TEXT NOT NULL,
    score INTEGER NOT NULL,
    logic INTEGER NOT NULL,
    evidence INTEGER NOT NULL,
    clarity INTEGER NOT NULL,
    relevance INTEGER NOT NULL,
    strongest_point TEXT NOT NULL,
    improvement TEXT NOT NULL,
    elo_before INTEGER NOT NULL,
    elo_after INTEGER NOT NULL,
    elo_change INTEGER NOT NULL,
    played_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS matchmaking_queue (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    stance TEXT NOT NULL,
    language TEXT NOT NULL,
    rounds INTEGER NOT NULL,
    elo INTEGER NOT NULL,
    joined_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS human_matches (
    id TEXT PRIMARY KEY,
    player_one_id INTEGER NOT NULL REFERENCES users(id),
    player_two_id INTEGER NOT NULL REFERENCES users(id),
    player_one_stance TEXT NOT NULL,
    player_two_stance TEXT NOT NULL,
    topic TEXT NOT NULL,
    language TEXT NOT NULL,
    rounds INTEGER NOT NULL,
    current_round INTEGER NOT NULL DEFAULT 1,
    current_turn_user_id INTEGER REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'active',
    player_one_score INTEGER,
    player_two_score INTEGER,
    player_one_evaluation TEXT,
    player_two_evaluation TEXT,
    winner_user_id INTEGER REFERENCES users(id),
    player_one_elo_change INTEGER,
    player_two_elo_change INTEGER,
    created_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS human_match_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT NOT NULL REFERENCES human_matches(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    round INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS human_matches_players
    ON human_matches(player_one_id, player_two_id, status);
  CREATE INDEX IF NOT EXISTS human_match_messages_match
    ON human_match_messages(match_id, id);
`);
const debateColumns = db.prepare("PRAGMA table_info(debates)").all();
if (!debateColumns.some((column) => column.name === "client_debate_id")) {
  db.exec("ALTER TABLE debates ADD COLUMN client_debate_id TEXT");
}
if (!debateColumns.some((column) => column.name === "rounds")) {
  db.exec("ALTER TABLE debates ADD COLUMN rounds INTEGER NOT NULL DEFAULT 3");
}
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS debates_user_client_id ON debates(user_id, client_debate_id)"
);

function createUser(username, password) {
  const normalized = normalizeUsername(username);
  const salt = crypto.randomBytes(16).toString("base64");
  const passwordHash = hashPassword(password, salt);
  const createdAt = new Date().toISOString();

  try {
    const result = db
      .prepare(`
        INSERT INTO users (username, username_normalized, password_hash, password_salt, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(username, normalized, passwordHash, salt, createdAt);
    return getUserById(Number(result.lastInsertRowid));
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      const conflict = new Error("USERNAME_TAKEN");
      conflict.code = "USERNAME_TAKEN";
      throw conflict;
    }
    throw error;
  }
}

function authenticate(username, password) {
  const user = db
    .prepare("SELECT * FROM users WHERE username_normalized = ?")
    .get(normalizeUsername(username));
  if (!user) return null;

  const candidate = hashPassword(password, user.password_salt);
  const actualBuffer = Buffer.from(user.password_hash, "base64");
  const candidateBuffer = Buffer.from(candidate, "base64");
  if (
    actualBuffer.length !== candidateBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, candidateBuffer)
  ) {
    return null;
  }
  return publicUser(user);
}

function createSession(userId, remember) {
  pruneSessions();
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const maxAge = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 12;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + maxAge * 1000).toISOString();
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
  ).run(tokenHash, userId, expiresAt, now.toISOString());
  return { token, maxAge: remember ? maxAge : null };
}

function getUserBySession(token) {
  if (!token) return null;
  const row = db
    .prepare(`
      SELECT u.*
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `)
    .get(hashToken(token), new Date().toISOString());
  return row ? publicUser(row) : null;
}

function deleteSession(token) {
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

function getRanking() {
  return db
    .prepare(`
      SELECT username, elo, matches, created_at AS createdAt
      FROM users
      ORDER BY elo DESC, matches DESC, username_normalized ASC
    `)
    .all();
}

function getHistory(userId) {
  return db
    .prepare(`
      SELECT
        id, topic, stance, difficulty, rounds, language, result, score, logic, evidence,
        clarity, relevance, strongest_point AS strongestPoint, improvement,
        elo_before AS eloBefore, elo_after AS eloAfter, elo_change AS eloChange,
        played_at AS playedAt
      FROM debates
      WHERE user_id = ?
      ORDER BY played_at DESC
    `)
    .all(userId);
}

function completeDebate(userId, debate, score) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    if (!user) throw new Error("USER_NOT_FOUND");

    const previous = Number(user.elo);
    const change = calculateEloChange(score.overall, debate.difficulty);
    const nextElo = Math.max(100, previous + change);
    const result = change > 0 ? "win" : change < 0 ? "loss" : "draw";
    const playedAt = new Date().toISOString();

    db.prepare("UPDATE users SET elo = ?, matches = matches + 1 WHERE id = ?").run(
      nextElo,
      userId
    );
    db.prepare(`
      INSERT INTO debates (
        user_id, client_debate_id, topic, stance, difficulty, rounds, language, result, score, logic,
        evidence, clarity, relevance, strongest_point, improvement, elo_before,
        elo_after, elo_change, played_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      debate.debateId,
      debate.topic,
      debate.stance,
      debate.difficulty,
      debate.rounds,
      debate.language,
      result,
      score.overall,
      score.logic,
      score.evidence,
      score.clarity,
      score.relevance,
      score.strongest_point,
      score.improvement,
      previous,
      nextElo,
      change,
      playedAt
    );
    db.exec("COMMIT");
    return { user: getUserById(userId), eloChange: change, result };
  } catch (error) {
    db.exec("ROLLBACK");
    if (String(error.message).includes("UNIQUE")) {
      const duplicate = new Error("DEBATE_ALREADY_SCORED");
      duplicate.code = "DEBATE_ALREADY_SCORED";
      throw duplicate;
    }
    throw error;
  }
}

function joinMatchmaking(userId, request) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 10 * 60_000).toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM matchmaking_queue WHERE joined_at < ?").run(cutoff);
    const active = findActiveMatch(userId);
    if (active) {
      db.exec("COMMIT");
      return { status: "matched", match: getHumanMatch(active.id, userId) };
    }

    const user = db.prepare("SELECT elo FROM users WHERE id = ?").get(userId);
    if (!user) throw new Error("USER_NOT_FOUND");

    db.prepare(`
      INSERT INTO matchmaking_queue (user_id, topic, stance, language, rounds, elo, joined_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        topic = excluded.topic,
        stance = excluded.stance,
        language = excluded.language,
        rounds = excluded.rounds,
        elo = excluded.elo,
        joined_at = excluded.joined_at
    `).run(
      userId,
      request.topic,
      request.stance,
      request.language,
      request.rounds,
      user.elo,
      now.toISOString()
    );

    const opponent = db.prepare(`
      SELECT *
      FROM matchmaking_queue
      WHERE user_id != ?
        AND language = ?
        AND rounds = ?
        AND stance != ?
        AND ABS(elo - ?) <= MIN(500, 125 + CAST((julianday(?) - julianday(joined_at)) * 1440 AS INTEGER) * 45)
      ORDER BY ABS(elo - ?) ASC, joined_at ASC
      LIMIT 1
    `).get(
      userId,
      request.language,
      request.rounds,
      request.stance,
      user.elo,
      now.toISOString(),
      user.elo
    );

    if (!opponent) {
      db.exec("COMMIT");
      return { status: "queued" };
    }

    const id = crypto.randomUUID();
    const playerOneId = Number(opponent.user_id);
    const playerTwoId = userId;
    db.prepare(`
      INSERT INTO human_matches (
        id, player_one_id, player_two_id, player_one_stance, player_two_stance,
        topic, language, rounds, current_round, current_turn_user_id, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'active', ?)
    `).run(
      id,
      playerOneId,
      playerTwoId,
      opponent.stance,
      request.stance,
      opponent.topic,
      request.language,
      request.rounds,
      playerOneId,
      now.toISOString()
    );
    db.prepare("DELETE FROM matchmaking_queue WHERE user_id IN (?, ?)").run(
      playerOneId,
      playerTwoId
    );
    db.exec("COMMIT");
    return { status: "matched", match: getHumanMatch(id, userId) };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function getMatchmakingStatus(userId) {
  const active = findActiveMatch(userId);
  if (active) return { status: "matched", match: getHumanMatch(active.id, userId) };
  const queued = db
    .prepare("SELECT joined_at AS joinedAt FROM matchmaking_queue WHERE user_id = ?")
    .get(userId);
  return queued ? { status: "queued", joinedAt: queued.joinedAt } : { status: "idle" };
}

function leaveMatchmaking(userId) {
  db.prepare("DELETE FROM matchmaking_queue WHERE user_id = ?").run(userId);
}

function submitHumanTurn(matchId, userId, text) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const match = db.prepare("SELECT * FROM human_matches WHERE id = ?").get(matchId);
    if (!match || ![match.player_one_id, match.player_two_id].includes(userId)) {
      throw matchError("MATCH_NOT_FOUND");
    }
    if (match.status !== "active") throw matchError("MATCH_NOT_ACTIVE");
    if (Number(match.current_turn_user_id) !== userId) throw matchError("NOT_YOUR_TURN");

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO human_match_messages (match_id, user_id, round, text, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(matchId, userId, match.current_round, text, now);

    if (userId === Number(match.player_one_id)) {
      db.prepare("UPDATE human_matches SET current_turn_user_id = ? WHERE id = ?").run(
        match.player_two_id,
        matchId
      );
    } else if (match.current_round >= match.rounds) {
      db.prepare(`
        UPDATE human_matches
        SET status = 'judging', current_turn_user_id = NULL
        WHERE id = ?
      `).run(matchId);
    } else {
      db.prepare(`
        UPDATE human_matches
        SET current_round = current_round + 1, current_turn_user_id = player_one_id
        WHERE id = ?
      `).run(matchId);
    }
    db.exec("COMMIT");
    return getHumanMatch(matchId, userId);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function completeHumanMatch(matchId, playerOneEvaluation, playerTwoEvaluation) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const match = db.prepare("SELECT * FROM human_matches WHERE id = ?").get(matchId);
    if (!match) throw matchError("MATCH_NOT_FOUND");
    if (match.status === "complete") {
      db.exec("COMMIT");
      return;
    }
    if (match.status !== "judging") throw matchError("MATCH_NOT_READY");

    const one = db.prepare("SELECT * FROM users WHERE id = ?").get(match.player_one_id);
    const two = db.prepare("SELECT * FROM users WHERE id = ?").get(match.player_two_id);
    const oneScore = Number(playerOneEvaluation.overall);
    const twoScore = Number(playerTwoEvaluation.overall);
    const outcome = oneScore === twoScore ? 0.5 : oneScore > twoScore ? 1 : 0;
    const expectedOne = 1 / (1 + 10 ** ((two.elo - one.elo) / 400));
    const margin = Math.min(1.25, 1 + Math.abs(oneScore - twoScore) / 100);
    const oneChange = Math.max(-30, Math.min(30, Math.round(28 * margin * (outcome - expectedOne))));
    const twoChange = -oneChange;
    const winnerId =
      outcome === 0.5 ? null : outcome === 1 ? Number(one.id) : Number(two.id);
    const completedAt = new Date().toISOString();

    db.prepare("UPDATE users SET elo = MAX(100, elo + ?), matches = matches + 1 WHERE id = ?").run(
      oneChange,
      one.id
    );
    db.prepare("UPDATE users SET elo = MAX(100, elo + ?), matches = matches + 1 WHERE id = ?").run(
      twoChange,
      two.id
    );
    db.prepare(`
      UPDATE human_matches SET
        status = 'complete', player_one_score = ?, player_two_score = ?,
        player_one_evaluation = ?, player_two_evaluation = ?, winner_user_id = ?,
        player_one_elo_change = ?, player_two_elo_change = ?, completed_at = ?
      WHERE id = ?
    `).run(
      oneScore,
      twoScore,
      JSON.stringify(playerOneEvaluation),
      JSON.stringify(playerTwoEvaluation),
      winnerId,
      oneChange,
      twoChange,
      completedAt,
      matchId
    );

    insertHumanHistory(one, match, playerOneEvaluation, oneChange, winnerId, completedAt);
    insertHumanHistory(two, match, playerTwoEvaluation, twoChange, winnerId, completedAt);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function getHumanMatch(matchId, userId) {
  const row = db.prepare(`
    SELECT
      m.*, one_user.username AS player_one_username, one_user.elo AS player_one_elo,
      two_user.username AS player_two_username, two_user.elo AS player_two_elo
    FROM human_matches m
    JOIN users one_user ON one_user.id = m.player_one_id
    JOIN users two_user ON two_user.id = m.player_two_id
    WHERE m.id = ? AND (m.player_one_id = ? OR m.player_two_id = ?)
  `).get(matchId, userId, userId);
  if (!row) return null;

  const isOne = userId === Number(row.player_one_id);
  const messages = db.prepare(`
    SELECT id, user_id AS userId, round, text, created_at AS createdAt
    FROM human_match_messages WHERE match_id = ? ORDER BY id
  `).all(matchId);
  const ownEvaluation = safeJson(
    isOne ? row.player_one_evaluation : row.player_two_evaluation
  );
  const opponentEvaluation = safeJson(
    isOne ? row.player_two_evaluation : row.player_one_evaluation
  );
  return {
    id: row.id,
    topic: row.topic,
    language: row.language,
    rounds: Number(row.rounds),
    round: Number(row.current_round),
    status: row.status,
    yourTurn: Number(row.current_turn_user_id) === userId,
    stance: isOne ? row.player_one_stance : row.player_two_stance,
    opponent: {
      username: isOne ? row.player_two_username : row.player_one_username,
      elo: Number(isOne ? row.player_two_elo : row.player_one_elo)
    },
    messages,
    evaluation: ownEvaluation,
    opponentEvaluation,
    score: isOne ? row.player_one_score : row.player_two_score,
    opponentScore: isOne ? row.player_two_score : row.player_one_score,
    eloChange: isOne ? row.player_one_elo_change : row.player_two_elo_change,
    result:
      row.status !== "complete"
        ? null
        : row.winner_user_id == null
          ? "draw"
          : Number(row.winner_user_id) === userId
            ? "win"
            : "loss"
  };
}

function findActiveMatch(userId) {
  return db.prepare(`
    SELECT id FROM human_matches
    WHERE (player_one_id = ? OR player_two_id = ?) AND status IN ('active', 'judging')
    ORDER BY created_at DESC LIMIT 1
  `).get(userId, userId);
}

function insertHumanHistory(user, match, evaluation, change, winnerId, playedAt) {
  const isOne = Number(user.id) === Number(match.player_one_id);
  const result = winnerId == null ? "draw" : Number(winnerId) === Number(user.id) ? "win" : "loss";
  db.prepare(`
    INSERT INTO debates (
      user_id, client_debate_id, topic, stance, difficulty, rounds, language, result, score,
      logic, evidence, clarity, relevance, strongest_point, improvement, elo_before,
      elo_after, elo_change, played_at
    ) VALUES (?, ?, ?, ?, 'human', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user.id,
    `${match.id}:${user.id}`,
    match.topic,
    isOne ? match.player_one_stance : match.player_two_stance,
    match.rounds,
    match.language,
    result,
    evaluation.overall,
    evaluation.logic,
    evaluation.evidence,
    evaluation.clarity,
    evaluation.relevance,
    evaluation.strongest_point,
    evaluation.improvement,
    user.elo,
    Math.max(100, Number(user.elo) + change),
    change,
    playedAt
  );
}

function safeJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function matchError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function calculateEloChange(score, difficulty) {
  const threshold = { baby: 50, adult: 40, harvey: 30 }[difficulty] ?? 40;
  if (score === threshold) return 0;
  if (score > threshold) {
    return Math.min(30, Math.round(((score - threshold) / (100 - threshold)) * 30));
  }
  return Math.max(-20, -Math.max(1, Math.round(((threshold - score) / threshold) * 20)));
}

function getUserById(id) {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  return row ? publicUser(row) : null;
}

function publicUser(row) {
  return {
    id: Number(row.id),
    username: row.username,
    elo: Number(row.elo),
    matches: Number(row.matches),
    createdAt: row.created_at
  };
}

function normalizeUsername(username) {
  return String(username).trim().toLocaleLowerCase("en-US");
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, Buffer.from(salt, "base64"), 310_000, 32, "sha256").toString(
    "base64"
  );
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function pruneSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
}

module.exports = {
  createUser,
  authenticate,
  createSession,
  getUserBySession,
  deleteSession,
  getRanking,
  getHistory,
  completeDebate,
  calculateEloChange,
  joinMatchmaking,
  getMatchmakingStatus,
  leaveMatchmaking,
  submitHumanTurn,
  completeHumanMatch,
  getHumanMatch
};

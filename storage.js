const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createClient } = require("@libsql/client");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATABASE_URL = process.env.TURSO_DATABASE_URL || `file:${path.join(DATA_DIR, "dialectic.db")}`;
const DATABASE_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (DATABASE_URL.startsWith("file:")) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!/^(file:|libsql:\/\/|https:\/\/)/i.test(DATABASE_URL)) {
  throw new Error(
    "TURSO_DATABASE_URL is invalid. Paste the database URL beginning with libsql://, not the authentication token."
  );
}

const db = createClient({
  url: DATABASE_URL,
  authToken: DATABASE_AUTH_TOKEN || undefined
});

const ready = initialize();

async function initialize() {
  await db.executeMultiple(`
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
      client_debate_id TEXT,
      topic TEXT NOT NULL,
      stance TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      rounds INTEGER NOT NULL DEFAULT 3,
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

  const columns = await all("PRAGMA table_info(debates)");
  if (!columns.some((column) => column.name === "client_debate_id")) {
    await db.execute("ALTER TABLE debates ADD COLUMN client_debate_id TEXT");
  }
  if (!columns.some((column) => column.name === "rounds")) {
    await db.execute("ALTER TABLE debates ADD COLUMN rounds INTEGER NOT NULL DEFAULT 3");
  }
  await db.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS debates_user_client_id ON debates(user_id, client_debate_id)"
  );
}

async function createUser(username, password) {
  await ready;
  const normalized = normalizeUsername(username);
  const salt = crypto.randomBytes(16).toString("base64");
  const passwordHash = hashPassword(password, salt);
  try {
    const result = await execute(
      `INSERT INTO users (username, username_normalized, password_hash, password_salt, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [username, normalized, passwordHash, salt, new Date().toISOString()]
    );
    return getUserById(Number(result.lastInsertRowid));
  } catch (error) {
    if (isUniqueError(error)) {
      const conflict = new Error("USERNAME_TAKEN");
      conflict.code = "USERNAME_TAKEN";
      throw conflict;
    }
    throw error;
  }
}

async function authenticate(username, password) {
  await ready;
  const user = await one("SELECT * FROM users WHERE username_normalized = ?", [
    normalizeUsername(username)
  ]);
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

async function createSession(userId, remember) {
  await ready;
  await pruneSessions();
  const token = crypto.randomBytes(32).toString("base64url");
  const maxAge = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 12;
  const now = new Date();
  await execute(
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    [
      hashToken(token),
      userId,
      new Date(now.getTime() + maxAge * 1000).toISOString(),
      now.toISOString()
    ]
  );
  return { token, maxAge: remember ? maxAge : null };
}

async function getUserBySession(token) {
  await ready;
  if (!token) return null;
  const row = await one(
    `SELECT u.* FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
    [hashToken(token), new Date().toISOString()]
  );
  return row ? publicUser(row) : null;
}

async function deleteSession(token) {
  await ready;
  if (token) await execute("DELETE FROM sessions WHERE token_hash = ?", [hashToken(token)]);
}

async function getRanking() {
  await ready;
  return all(
    `SELECT username, elo, matches, created_at AS createdAt
     FROM users ORDER BY elo DESC, matches DESC, username_normalized ASC`
  );
}

async function getHistory(userId) {
  await ready;
  return all(
    `SELECT id, topic, stance, difficulty, rounds, language, result, score, logic,
       evidence, clarity, relevance, strongest_point AS strongestPoint, improvement,
       elo_before AS eloBefore, elo_after AS eloAfter, elo_change AS eloChange,
       played_at AS playedAt
     FROM debates WHERE user_id = ? ORDER BY played_at DESC`,
    [userId]
  );
}

async function completeDebate(userId, debate, score) {
  await ready;
  const tx = await db.transaction("write");
  try {
    const user = firstRow(await tx.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [userId] }));
    if (!user) throw new Error("USER_NOT_FOUND");
    const previous = Number(user.elo);
    const change = calculateEloChange(score.overall, debate.difficulty);
    const nextElo = Math.max(100, previous + change);
    const result = change > 0 ? "win" : change < 0 ? "loss" : "draw";
    const playedAt = new Date().toISOString();
    await tx.execute({
      sql: "UPDATE users SET elo = ?, matches = matches + 1 WHERE id = ?",
      args: [nextElo, userId]
    });
    await tx.execute({
      sql: `INSERT INTO debates (
        user_id, client_debate_id, topic, stance, difficulty, rounds, language, result,
        score, logic, evidence, clarity, relevance, strongest_point, improvement,
        elo_before, elo_after, elo_change, played_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        userId, debate.debateId, debate.topic, debate.stance, debate.difficulty,
        debate.rounds, debate.language, result, score.overall, score.logic,
        score.evidence, score.clarity, score.relevance, score.strongest_point,
        score.improvement, previous, nextElo, change, playedAt
      ]
    });
    await tx.commit();
    return { user: await getUserById(userId), eloChange: change, result };
  } catch (error) {
    await rollbackQuietly(tx);
    if (isUniqueError(error)) {
      const duplicate = new Error("DEBATE_ALREADY_SCORED");
      duplicate.code = "DEBATE_ALREADY_SCORED";
      throw duplicate;
    }
    throw error;
  } finally {
    tx.close();
  }
}

async function joinMatchmaking(userId, request) {
  await ready;
  const now = new Date();
  const tx = await db.transaction("write");
  try {
    await tx.execute({
      sql: "DELETE FROM matchmaking_queue WHERE joined_at < ?",
      args: [new Date(now.getTime() - 10 * 60_000).toISOString()]
    });
    const active = await findActiveMatch(userId, tx);
    if (active) {
      await tx.commit();
      return { status: "matched", match: await getHumanMatch(active.id, userId) };
    }
    const user = firstRow(await tx.execute({ sql: "SELECT elo FROM users WHERE id = ?", args: [userId] }));
    if (!user) throw new Error("USER_NOT_FOUND");
    await tx.execute({
      sql: `INSERT INTO matchmaking_queue (user_id, topic, stance, language, rounds, elo, joined_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET topic=excluded.topic, stance=excluded.stance,
        language=excluded.language, rounds=excluded.rounds, elo=excluded.elo,
        joined_at=excluded.joined_at`,
      args: [userId, request.topic, request.stance, request.language, request.rounds, user.elo, now.toISOString()]
    });
    const opponent = firstRow(await tx.execute({
      sql: `SELECT * FROM matchmaking_queue
        WHERE user_id != ? AND language = ? AND rounds = ? AND stance != ?
        AND ABS(elo - ?) <= MIN(500, 125 + CAST((julianday(?) - julianday(joined_at)) * 1440 AS INTEGER) * 45)
        ORDER BY ABS(elo - ?) ASC, joined_at ASC LIMIT 1`,
      args: [userId, request.language, request.rounds, request.stance, user.elo, now.toISOString(), user.elo]
    }));
    if (!opponent) {
      await tx.commit();
      return { status: "queued" };
    }
    const id = crypto.randomUUID();
    const playerOneId = Number(opponent.user_id);
    await tx.execute({
      sql: `INSERT INTO human_matches (
        id, player_one_id, player_two_id, player_one_stance, player_two_stance,
        topic, language, rounds, current_round, current_turn_user_id, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'active', ?)`,
      args: [
        id, playerOneId, userId, opponent.stance, request.stance, opponent.topic,
        request.language, request.rounds, playerOneId, now.toISOString()
      ]
    });
    await tx.execute({
      sql: "DELETE FROM matchmaking_queue WHERE user_id IN (?, ?)",
      args: [playerOneId, userId]
    });
    await tx.commit();
    return { status: "matched", match: await getHumanMatch(id, userId) };
  } catch (error) {
    await rollbackQuietly(tx);
    throw error;
  } finally {
    tx.close();
  }
}

async function getMatchmakingStatus(userId) {
  await ready;
  const active = await findActiveMatch(userId);
  if (active) return { status: "matched", match: await getHumanMatch(active.id, userId) };
  const queued = await one(
    "SELECT joined_at AS joinedAt FROM matchmaking_queue WHERE user_id = ?",
    [userId]
  );
  return queued ? { status: "queued", joinedAt: queued.joinedAt } : { status: "idle" };
}

async function leaveMatchmaking(userId) {
  await ready;
  await execute("DELETE FROM matchmaking_queue WHERE user_id = ?", [userId]);
}

async function submitHumanTurn(matchId, userId, text) {
  await ready;
  const tx = await db.transaction("write");
  try {
    const match = firstRow(await tx.execute({
      sql: "SELECT * FROM human_matches WHERE id = ?",
      args: [matchId]
    }));
    if (!match || ![Number(match.player_one_id), Number(match.player_two_id)].includes(userId)) {
      throw matchError("MATCH_NOT_FOUND");
    }
    if (match.status !== "active") throw matchError("MATCH_NOT_ACTIVE");
    if (Number(match.current_turn_user_id) !== userId) throw matchError("NOT_YOUR_TURN");
    await tx.execute({
      sql: `INSERT INTO human_match_messages (match_id, user_id, round, text, created_at)
        VALUES (?, ?, ?, ?, ?)`,
      args: [matchId, userId, match.current_round, text, new Date().toISOString()]
    });
    if (userId === Number(match.player_one_id)) {
      await tx.execute({
        sql: "UPDATE human_matches SET current_turn_user_id = ? WHERE id = ?",
        args: [match.player_two_id, matchId]
      });
    } else if (Number(match.current_round) >= Number(match.rounds)) {
      await tx.execute({
        sql: "UPDATE human_matches SET status = 'judging', current_turn_user_id = NULL WHERE id = ?",
        args: [matchId]
      });
    } else {
      await tx.execute({
        sql: "UPDATE human_matches SET current_round = current_round + 1, current_turn_user_id = player_one_id WHERE id = ?",
        args: [matchId]
      });
    }
    await tx.commit();
    return getHumanMatch(matchId, userId);
  } catch (error) {
    await rollbackQuietly(tx);
    throw error;
  } finally {
    tx.close();
  }
}

async function completeHumanMatch(matchId, playerOneEvaluation, playerTwoEvaluation) {
  await ready;
  const tx = await db.transaction("write");
  try {
    const match = firstRow(await tx.execute({ sql: "SELECT * FROM human_matches WHERE id = ?", args: [matchId] }));
    if (!match) throw matchError("MATCH_NOT_FOUND");
    if (match.status === "complete") {
      await tx.commit();
      return;
    }
    if (match.status !== "judging") throw matchError("MATCH_NOT_READY");
    const oneUser = firstRow(await tx.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [match.player_one_id] }));
    const twoUser = firstRow(await tx.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [match.player_two_id] }));
    const oneScore = Number(playerOneEvaluation.overall);
    const twoScore = Number(playerTwoEvaluation.overall);
    const outcome = oneScore === twoScore ? 0.5 : oneScore > twoScore ? 1 : 0;
    const expectedOne = 1 / (1 + 10 ** ((Number(twoUser.elo) - Number(oneUser.elo)) / 400));
    const margin = Math.min(1.25, 1 + Math.abs(oneScore - twoScore) / 100);
    const oneChange = Math.max(-30, Math.min(30, Math.round(28 * margin * (outcome - expectedOne))));
    const twoChange = -oneChange;
    const winnerId = outcome === 0.5 ? null : outcome === 1 ? Number(oneUser.id) : Number(twoUser.id);
    const completedAt = new Date().toISOString();
    await tx.execute({
      sql: "UPDATE users SET elo = MAX(100, elo + ?), matches = matches + 1 WHERE id = ?",
      args: [oneChange, oneUser.id]
    });
    await tx.execute({
      sql: "UPDATE users SET elo = MAX(100, elo + ?), matches = matches + 1 WHERE id = ?",
      args: [twoChange, twoUser.id]
    });
    await tx.execute({
      sql: `UPDATE human_matches SET status='complete', player_one_score=?,
        player_two_score=?, player_one_evaluation=?, player_two_evaluation=?,
        winner_user_id=?, player_one_elo_change=?, player_two_elo_change=?,
        completed_at=? WHERE id=?`,
      args: [
        oneScore, twoScore, JSON.stringify(playerOneEvaluation),
        JSON.stringify(playerTwoEvaluation), winnerId, oneChange, twoChange,
        completedAt, matchId
      ]
    });
    await insertHumanHistory(tx, oneUser, match, playerOneEvaluation, oneChange, winnerId, completedAt);
    await insertHumanHistory(tx, twoUser, match, playerTwoEvaluation, twoChange, winnerId, completedAt);
    await tx.commit();
  } catch (error) {
    await rollbackQuietly(tx);
    throw error;
  } finally {
    tx.close();
  }
}

async function getHumanMatch(matchId, userId) {
  await ready;
  const row = await one(
    `SELECT m.*, one_user.username AS player_one_username, one_user.elo AS player_one_elo,
       two_user.username AS player_two_username, two_user.elo AS player_two_elo
     FROM human_matches m
     JOIN users one_user ON one_user.id = m.player_one_id
     JOIN users two_user ON two_user.id = m.player_two_id
     WHERE m.id = ? AND (m.player_one_id = ? OR m.player_two_id = ?)`,
    [matchId, userId, userId]
  );
  if (!row) return null;
  const isOne = userId === Number(row.player_one_id);
  const messages = await all(
    `SELECT id, user_id AS userId, round, text, created_at AS createdAt
     FROM human_match_messages WHERE match_id = ? ORDER BY id`,
    [matchId]
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
    messages: messages.map(normalizeNumericRow),
    evaluation: safeJson(isOne ? row.player_one_evaluation : row.player_two_evaluation),
    opponentEvaluation: safeJson(isOne ? row.player_two_evaluation : row.player_one_evaluation),
    score: nullableNumber(isOne ? row.player_one_score : row.player_two_score),
    opponentScore: nullableNumber(isOne ? row.player_two_score : row.player_one_score),
    eloChange: nullableNumber(isOne ? row.player_one_elo_change : row.player_two_elo_change),
    result:
      row.status !== "complete"
        ? null
        : row.winner_user_id == null
          ? "draw"
          : Number(row.winner_user_id) === userId ? "win" : "loss"
  };
}

async function findActiveMatch(userId, executor = db) {
  const result = await executor.execute({
    sql: `SELECT id FROM human_matches
      WHERE (player_one_id = ? OR player_two_id = ?) AND status IN ('active', 'judging')
      ORDER BY created_at DESC LIMIT 1`,
    args: [userId, userId]
  });
  return firstRow(result);
}

async function insertHumanHistory(tx, user, match, evaluation, change, winnerId, playedAt) {
  const isOne = Number(user.id) === Number(match.player_one_id);
  const result = winnerId == null ? "draw" : Number(winnerId) === Number(user.id) ? "win" : "loss";
  await tx.execute({
    sql: `INSERT INTO debates (
      user_id, client_debate_id, topic, stance, difficulty, rounds, language, result,
      score, logic, evidence, clarity, relevance, strongest_point, improvement,
      elo_before, elo_after, elo_change, played_at
    ) VALUES (?, ?, ?, ?, 'human', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      user.id, `${match.id}:${user.id}`, match.topic,
      isOne ? match.player_one_stance : match.player_two_stance, match.rounds,
      match.language, result, evaluation.overall, evaluation.logic,
      evaluation.evidence, evaluation.clarity, evaluation.relevance,
      evaluation.strongest_point, evaluation.improvement, user.elo,
      Math.max(100, Number(user.elo) + change), change, playedAt
    ]
  });
}

function calculateEloChange(score, difficulty) {
  const threshold = { baby: 50, adult: 40, harvey: 30 }[difficulty] ?? 40;
  if (score === threshold) return 0;
  if (score > threshold) {
    return Math.min(30, Math.round(((score - threshold) / (100 - threshold)) * 30));
  }
  return Math.max(-20, -Math.max(1, Math.round(((threshold - score) / threshold) * 20)));
}

async function getUserById(id) {
  await ready;
  const row = await one("SELECT * FROM users WHERE id = ?", [id]);
  return row ? publicUser(row) : null;
}

async function pruneSessions() {
  await execute("DELETE FROM sessions WHERE expires_at <= ?", [new Date().toISOString()]);
}

async function execute(sql, args = []) {
  return db.execute({ sql, args });
}

async function one(sql, args = []) {
  return firstRow(await execute(sql, args));
}

async function all(sql, args = []) {
  const result = await execute(sql, args);
  return result.rows.map((row) => ({ ...row }));
}

function firstRow(result) {
  return result.rows[0] ? { ...result.rows[0] } : null;
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

function normalizeNumericRow(row) {
  return { ...row, id: Number(row.id), userId: Number(row.userId), round: Number(row.round) };
}

function nullableNumber(value) {
  return value == null ? null : Number(value);
}

function safeJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeUsername(username) {
  return String(username).trim().toLocaleLowerCase("en-US");
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, Buffer.from(salt, "base64"), 310_000, 32, "sha256").toString("base64");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function isUniqueError(error) {
  return /unique|constraint/i.test(String(error?.message));
}

function matchError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function rollbackQuietly(tx) {
  try {
    await tx.rollback();
  } catch {
    // The transaction may already have been closed by the remote server.
  }
}

module.exports = {
  ready,
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

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dialectic-matchmaking-"));
process.env.DATA_DIR = dataDir;

const {
  createUser,
  joinMatchmaking,
  submitHumanTurn,
  completeHumanMatch,
  getHumanMatch,
  getHistory
} = require("../storage");

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test("matches opposite stances by ELO and persists the judged result", async () => {
  const first = await createUser("match_alpha", "password123");
  const second = await createUser("match_beta", "password123");

  assert.equal(
    (await joinMatchmaking(first.id, {
      topic: "Public transport should be free",
      stance: "for",
      language: "en",
      rounds: 1
    })).status,
    "queued"
  );

  const joined = await joinMatchmaking(second.id, {
    topic: "A different suggestion",
    stance: "against",
    language: "en",
    rounds: 1
  });
  assert.equal(joined.status, "matched");
  assert.equal(joined.match.opponent.username, "match_alpha");

  await submitHumanTurn(
    joined.match.id,
    first.id,
    "Free transit improves access because lower-income workers can reach more jobs."
  );
  const judging = await submitHumanTurn(
    joined.match.id,
    second.id,
    "Universal subsidies also pay for riders who can afford fares and may crowd out targeted service."
  );
  assert.equal(judging.status, "judging");

  await completeHumanMatch(
    joined.match.id,
    evaluation(68, "Access"),
    evaluation(77, "Targeting")
  );
  const result = await getHumanMatch(joined.match.id, first.id);
  assert.equal(result.status, "complete");
  assert.equal(result.result, "loss");
  assert.ok(result.eloChange < 0);
  assert.equal((await getHistory(first.id)).length, 1);
  assert.equal((await getHistory(second.id)).length, 1);
});

function evaluation(overall, strongestPoint) {
  return {
    logic: overall,
    evidence: overall,
    clarity: overall,
    relevance: overall,
    overall,
    strongest_point: strongestPoint,
    improvement: "Add more support.",
    verdict: "user_leads"
  };
}

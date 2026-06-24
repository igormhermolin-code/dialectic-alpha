const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateEloChange } = require("../storage");

test("difficulty thresholds produce a loss only below their floor", () => {
  assert.ok(calculateEloChange(49, "baby") < 0);
  assert.equal(calculateEloChange(50, "baby"), 0);
  assert.ok(calculateEloChange(39, "adult") < 0);
  assert.equal(calculateEloChange(40, "adult"), 0);
  assert.ok(calculateEloChange(29, "harvey") < 0);
  assert.equal(calculateEloChange(30, "harvey"), 0);
});

test("higher scores gain more ELO and cap at thirty", () => {
  assert.ok(calculateEloChange(80, "adult") > calculateEloChange(60, "adult"));
  assert.equal(calculateEloChange(100, "baby"), 30);
  assert.equal(calculateEloChange(100, "adult"), 30);
  assert.equal(calculateEloChange(100, "harvey"), 30);
});

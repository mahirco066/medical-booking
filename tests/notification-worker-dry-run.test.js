"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workerSource = fs.readFileSync(
  path.join(__dirname, "..", "notification-worker.js"),
  "utf8"
);

function dryRunSection() {
  const start = workerSource.indexOf("async function dryRunTick()");
  const end = workerSource.indexOf("const timer = setInterval", start);
  assert.notEqual(start, -1, "dryRunTick must exist");
  assert.notEqual(end, -1, "dry-run scheduler must exist");
  return workerSource.slice(start, end);
}

test("dry-run mode requires only DATABASE_URL and disables delivery channels", () => {
  assert.match(workerSource, /const required = DRY_RUN\s*\?\s*\["DATABASE_URL"\]/);
  assert.match(workerSource, /const ENABLED_CHANNELS = DRY_RUN \? \[\] :/);
  assert.match(workerSource, /if \(!DRY_RUN && String\(process\.env\.NOTIFICATION_SEND_ENABLED\)/);
});

test("dry-run performs only an aggregate SELECT against the outbox", () => {
  const section = dryRunSection();
  assert.match(section, /SELECT status, channel, COUNT\(\*\)::int AS count FROM notification_outbox GROUP BY status, channel ORDER BY status, channel/i);
  assert.doesNotMatch(section, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
  assert.doesNotMatch(section, /sendTwilioMessage|claim|fetch\s*\(/i);
});

test("dry-run database failure stops the timer, closes the pool, and marks failure", () => {
  const section = dryRunSection();
  assert.match(section, /stopping = true/);
  assert.match(section, /clearInterval\(timer\)/);
  assert.match(section, /await pool\.end\(\)\.catch/);
  assert.match(section, /process\.exitCode = 1/);
});

test("scheduler routes dry-run ticks away from the delivery worker", () => {
  const start = workerSource.indexOf("const timer = setInterval");
  const end = workerSource.indexOf("async function shutdown", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const section = workerSource.slice(start, end);
  assert.match(section, /if \(DRY_RUN\) dryRunTick\(\);\s*else tick\(\);/);
  assert.match(section, /if \(DRY_RUN\) dryRunTick\(\);\s*else tick\(\);/);
});

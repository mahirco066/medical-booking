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
  assert.doesNotMatch(section, /sendTwilioMessage|\bclaimOne\b|\bfetch\s*\(/i);
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
  assert.match(section, /if \(DRY_RUN\) dryRunTick\(\);\s*else tick\(\);\s*$/);
});


test("ambiguous delivery outcomes and stale leases are not automatically retried", () => {
  assert.match(workerSource, /uncertain\.deliveryOutcomeUnknown = true/);
  assert.match(workerSource, /response\.status >= 500/);
  assert.match(workerSource, /Provider returned success without a message SID/);
  assert.match(workerSource, /if \(!data\.sid\)/);
  assert.match(workerSource, /Provider accepted the request, but persistence failed/);
  assert.match(workerSource, /attempts=" \+ MAX_ATTEMPTS/);
  assert.match(workerSource, /if \(error && error\.deliveryOutcomeUnknown\)/);
  assert.match(workerSource, /automatic retry suppressed to avoid a duplicate message/);
});

test("successful provider send is treated as unknown if the guarded status update affects no row", () => {
  assert.match(
    workerSource,
    /if \(result\.rowCount !== 1\)\s*\{\s*const error = new Error\("Notification status update affected no row; delivery outcome must be treated as unknown\."\);\s*if \(status === "sent"\) error\.deliveryOutcomeUnknown = true;\s*throw error;\s*\}/
  );
  assert.match(
    workerSource,
    /WHERE id=\$1 AND status='processing' AND locked_at=\$8::timestamptz/
  );
});

const serverSource = fs.readFileSync(
  path.join(__dirname, "..", "server.js"),
  "utf8"
);

test("cancellation invalidates unsent appointment notifications but preserves sent audit rows", () => {
  assert.match(
    serverSource,
    /if \(eventType === "cancelled"\)\s*\{\s*await client\.query\([\s\S]*?SET status='cancelled',locked_at=NULL,updated_at=NOW\(\)[\s\S]*?WHERE appointment_id=\$1 AND event_type <> 'cancelled'[\s\S]*?status IN \('pending','failed'\)/
  );
  assert.match(serverSource, /if \(\["booked", "confirmed", "rescheduled"\]\.includes\(eventType\)/);
});

test("rescheduling cancels stale unsent events and reminders before enqueueing the new slot", () => {
  assert.match(
    serverSource,
    /else if \(eventType === "rescheduled"\)\s*\{\s*await client\.query\([\s\S]*?event_type IN \('booked','confirmed','rescheduled','reminder_24h'\)[\s\S]*?status IN \('pending','failed'\)/
  );
  assert.match(serverSource, /const eventVersion = eventType === "rescheduled"/);
  assert.match(serverSource, /reminderVersion = eventType === "rescheduled" \? eventVersion : ""/);
  assert.match(serverSource, /appointment:\$\{a\.id\}:reminder_24h:[\s\S]*?\$\{reminderVersion\}/);
});

test("notification enqueue remains idempotent and leaves sent rows as history", () => {
  assert.match(serverSource, /ON CONFLICT \(idempotency_key\) DO NOTHING/);
  assert.match(serverSource, /Keep already-sent rows as an audit trail/);
  assert.match(serverSource, /status IN \('pending','failed'\)/);
});

test("worker checks current patient consent and phone before delivery", () => {
  const start = workerSource.indexOf("async function isNotificationStillRelevant");
  const end = workerSource.indexOf("async function processOne", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const section = workerSource.slice(start, end);
  assert.match(section, /isPatientChannelConsented\(/);
  assert.match(section, /current_patient_sms_phone/);
  assert.match(section, /current_patient_whatsapp_phone/);
  assert.match(section, /String\(currentPhone\)\.trim\(\) !== String\(row\.recipient_phone \|\| ""\)\.trim\(\)/);
  assert.match(section, /return isNotificationRelevant\(/);
});

test("worker skips a queued notification that is no longer relevant before provider delivery", () => {
  const start = workerSource.indexOf("async function processOne");
  const end = workerSource.indexOf("async function tick", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const section = workerSource.slice(start, end);
  assert.match(section, /if\s*\(\s*!\s*\(\s*await isNotificationStillRelevant\(row\)\s*\)\s*\)/);
  assert.match(section, /await finish\(row, "cancelled"/);
  assert.ok(
    section.indexOf("if (!await isNotificationStillRelevant(row))") <
      section.indexOf("await sendTwilioMessage(row)"),
    "relevance check must run before calling the provider"
  );
});

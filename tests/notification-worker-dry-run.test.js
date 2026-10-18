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
  const end = workerSource.indexOf('if (process.env.NOTIFICATION_WORKER_TEST_MODE === "true")', start);
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
  const start = workerSource.indexOf("timer = setInterval");
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
    /if \(eventType === "cancelled"\)\s*\{\s*await client\.query\([\s\S]*?SET status='cancelled',locked_at=NULL,updated_at=NOW\(\)[\s\S]*?WHERE appointment_id=\$1 AND event_type <> 'cancelled'[\s\S]*?status='pending' OR \(status='failed' AND attempts < 5\)/
  );
  assert.match(serverSource, /if \(\["booked", "confirmed", "rescheduled"\]\.includes\(eventType\)/);
});

test("rescheduling cancels stale unsent events and reminders before enqueueing the new slot", () => {
  assert.match(
    serverSource,
    /else if \(eventType === "rescheduled" \|\| eventType === "reschedule_requested"\)\s*\{\s*await client\.query\([\s\S]*?event_type IN \('booked','confirmed','rescheduled','reschedule_requested','reminder_24h'\)[\s\S]*?status='pending' OR \(status='failed' AND attempts < 5\)/
  );
  assert.match(serverSource, /const eventVersion = \["rescheduled", "reschedule_requested"\]\.includes\(eventType\)/);
  assert.match(serverSource, /reminderVersion = eventType === "rescheduled" \? eventVersion : ""/);
  assert.match(serverSource, /appointment:\$\{a\.id\}:reminder_24h:[\s\S]*?\$\{reminderVersion\}/);
});
test("notification enqueue remains idempotent and leaves sent rows as history", () => {
  assert.match(serverSource, /ON CONFLICT \(idempotency_key\) DO NOTHING/);
  assert.match(serverSource, /Keep already-sent rows as an audit trail/);
  assert.match(serverSource, /status='pending' OR \(status='failed' AND attempts < 5\)/);
});

test("doctor WhatsApp contact falls back to the linked user when staff phone is blank", () => {
  assert.match(
    serverSource,
    /SELECT NULLIF\(BTRIM\(su\.whatsapp_phone\),'\s*'\) FROM staff_users su/
  );
  assert.match(
    serverSource,
    /NULLIF\(BTRIM\(du\.whatsapp_phone\),'\s*'\)\s*\) AS doctor_whatsapp/
  );
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


test("notification enqueue never uses a historical appointment phone as the recipient", () => {
  const enqueueStart = serverSource.indexOf("async function enqueueAppointmentNotifications");
  const enqueueEnd = serverSource.indexOf("\nasync function ", enqueueStart + 1);
  assert.notEqual(enqueueStart, -1);
  assert.notEqual(enqueueEnd, -1);
  const enqueueSection = serverSource.slice(enqueueStart, enqueueEnd);
  assert.ok(
    enqueueSection.includes("COALESCE(NULLIF(BTRIM(p.phone),''),NULLIF(BTRIM(pu.phone),'')) AS patient_phone"),
    "notification recipients should use current patient or linked user phone"
  );
  assert.doesNotMatch(
    enqueueSection,
    /NULLIF\(BTRIM\(a\.patient_phone\),''\)/,
    "a historical appointment phone must not be used as a new notification destination"
  );
});

test("worker does not fall back to a historical appointment phone after the patient clears their current number", () => {
  assert.match(
    workerSource,
    /COALESCE\(NULLIF\(BTRIM\(p\.phone\),''\),NULLIF\(BTRIM\(pu\.phone\),''\)\) AS current_patient_sms_phone/
  );
  assert.doesNotMatch(
    workerSource,
    /NULLIF\(BTRIM\(a\.patient_phone\),''\)\s*,?\s*NULLIF\(BTRIM\(pu\.phone\),''\)/
  );
});

test("worker rejects stale doctor and secretary contact numbers before delivery", () => {
  const start = workerSource.indexOf("async function isNotificationStillRelevant");
  const end = workerSource.indexOf("async function processOne", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const section = workerSource.slice(start, end);
  assert.match(section, /current_doctor_sms_phone/);
  assert.match(section, /current_doctor_whatsapp_phone/);
  assert.match(section, /row\.recipient_role === "doctor"/);
  assert.match(section, /row\.recipient_role === "secretary"/);
  assert.match(section, /role='secretary' AND active=TRUE/);
  assert.match(section, /current_contact/);
  assert.match(section, /else \{\s*return false;\s*\}/);
});

test("worker skips a queued notification that is no longer relevant before provider delivery", () => {
  const start = workerSource.indexOf("async function processOne");
  const end = workerSource.indexOf("async function tick", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const section = workerSource.slice(start, end);
  assert.match(section, /if\s*\(\s*!\s*\(\s*await isNotificationStillRelevant\(row\)\s*\)\s*\)/);
  assert.match(section, /await finish\(row, "cancelled"/);
  const relevanceCheckIndex = section.indexOf("if (!(await isNotificationStillRelevant(row)))");
  const providerCallIndex = section.indexOf("await sendTwilioMessage(row)");
  assert.notEqual(relevanceCheckIndex, -1, "pre-send relevance guard must exist");
  assert.notEqual(providerCallIndex, -1, "provider call must exist");
  assert.ok(
    relevanceCheckIndex < providerCallIndex,
    "relevance check must run before calling the provider"
  );
});

test("cancellation and rescheduling invalidate only retryable unsent rows, not in-flight or sent audit rows", () => {
  const invalidations = [
    ...serverSource.matchAll(
      /UPDATE notification_outbox\s+SET status='cancelled',locked_at=NULL,updated_at=NOW\(\)\s+WHERE appointment_id=\$1[\s\S]*?status='pending' OR \(status='failed' AND attempts < 5\)/g
    )
  ].map((match) => match[0]);

  assert.equal(
    invalidations.length,
    3,
    "booking confirmation, cancellation, and rescheduling invalidations must all be covered"
  );

  for (const statement of invalidations) {
    assert.match(statement, /status='pending' OR \(status='failed' AND attempts < 5\)/);
    assert.doesNotMatch(
      statement,
      /status\s*=\s*'processing'|status IN \([^)]*processing/i,
      "an in-flight delivery must not be force-cancelled while provider outcome may be unknown"
    );
  }
});

test("admin and doctor status routes enforce valid appointment transitions", () => {
  const adminRouteStart = serverSource.indexOf('app.patch("/api/admin/appointments/:id/status"');
  const adminRouteEnd = serverSource.indexOf('app.patch("/api/admin/appointments/:id"', adminRouteStart + 1);
  assert.notEqual(adminRouteStart, -1, "admin appointment status route must exist");
  assert.notEqual(adminRouteEnd, -1, "admin appointment edit route must follow status route");
  const adminRouteSource = serverSource.slice(adminRouteStart, adminRouteEnd);
  assert.ok(
    adminRouteSource.includes("status='pending' AND $1 IN ('pending','confirmed','cancelled')"),
    "pending appointments must not jump directly to completed or no-show"
  );
  assert.ok(
    adminRouteSource.includes("status='confirmed' AND $1 IN ('confirmed','cancelled','completed','no_show')"),
    "confirmed appointments must not be reverted to pending"
  );
  assert.match(adminRouteSource, /409, "تعذر تحديث حالة الموعد؛ ربما تغيرت حالته أو انتهى\\."/);

  const doctorRouteStart = serverSource.indexOf('app.patch("/api/doctor/appointments/:id/status"');
  const doctorRouteEnd = serverSource.indexOf('app.patch("/api/doctor/appointments/:id"', doctorRouteStart + 1);
  assert.notEqual(doctorRouteStart, -1, "doctor appointment status route must exist");
  assert.notEqual(doctorRouteEnd, -1, "doctor appointment edit route must follow status route");
  const doctorRouteSource = serverSource.slice(doctorRouteStart, doctorRouteEnd);
  assert.ok(
    doctorRouteSource.includes("status='pending' AND $1 IN ('pending','confirmed','cancelled')"),
    "pending appointments must not jump directly to completed or no-show"
  );
  assert.ok(
    doctorRouteSource.includes("status='confirmed' AND $1 IN ('confirmed','cancelled','completed','no_show')"),
    "confirmed appointments must not be reverted to pending"
  );
});

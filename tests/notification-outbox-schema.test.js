"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const serverSource = fs.readFileSync(
  path.join(__dirname, "..", "server.js"),
  "utf8"
);
const workerSource = fs.readFileSync(
  path.join(__dirname, "..", "notification-worker.js"),
  "utf8"
);

function outboxTableDefinition() {
  const start = serverSource.indexOf("CREATE TABLE IF NOT EXISTS notification_outbox");
  assert.notEqual(start, -1, "server.js must define notification_outbox");
  const end = serverSource.indexOf("\n  `);", start);
  assert.notEqual(end, -1, "notification_outbox definition must terminate");
  return serverSource.slice(start, end);
}

test("notification_outbox schema contains the fields used by the worker", () => {
  const schema = outboxTableDefinition();
  const requiredColumns = [
    "id", "appointment_id", "event_type", "channel", "recipient_role",
    "recipient_phone", "provider_message_id", "locked_at", "scheduled_at",
    "status", "attempts", "idempotency_key", "payload", "last_error",
    "sent_at", "created_at", "updated_at"
  ];

  for (const column of requiredColumns) {
    assert.match(
      schema,
      new RegExp("\\b" + column + "\\b", "i"),
      "schema should define column " + column
    );
  }
});

test("notification_outbox schema constrains event, channel, and status values", () => {
  const schema = outboxTableDefinition();
  assert.match(schema, /event_type TEXT NOT NULL CHECK\s*\(event_type IN\s*\('booked','confirmed','cancelled','rescheduled','reminder_24h'\)\)/i);
  assert.match(schema, /channel TEXT NOT NULL CHECK\s*\(channel IN\s*\('sms','whatsapp'\)\)/i);
  assert.match(schema, /status TEXT NOT NULL DEFAULT 'pending' CHECK\s*\(status IN\s*\('pending','processing','sent','failed','cancelled'\)\)/i);
  assert.match(schema, /idempotency_key TEXT NOT NULL UNIQUE/i);
});

test("worker's dry-run aggregate query uses columns defined by the schema", () => {
  const schema = outboxTableDefinition();
  const query = workerSource.match(
    /SELECT status, channel, COUNT\(\*\)::int AS count FROM notification_outbox GROUP BY status, channel ORDER BY status, channel/i
  );
  assert.ok(query, "worker should use the documented aggregate-only query");
  assert.match(schema, /status TEXT NOT NULL/i);
  assert.match(schema, /channel TEXT NOT NULL/i);
});

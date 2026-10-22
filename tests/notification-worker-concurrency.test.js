"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { Pool } = require("pg");
const crypto = require("node:crypto");
const enabled = process.env.NOTIFICATION_WORKER_CONCURRENCY_TEST === "true";
const baseUrl = process.env.DATABASE_URL;
function runClaim(connectionString) {
  const script = "const worker = require(\"./notification-worker.js\");\n" +
    "worker.claimOne().then(row => process.stdout.write(JSON.stringify({id: row && row.id}) + \"\\n\")).catch(error => { console.error(error); process.exitCode=1; }).finally(() => worker.pool.end().catch(() => {}));";
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script], { cwd: require("node:path").join(__dirname, ".."), env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "test", NOTIFICATION_DRY_RUN: "false", NOTIFICATION_WORKER_TEST_MODE: "true", NOTIFICATION_SEND_ENABLED: "true", TWILIO_ACCOUNT_SID: "AC_TEST", TWILIO_AUTH_TOKEN: "test-token", TWILIO_SMS_FROM: "+15555550100" }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = ""; child.stdout.setEncoding("utf8").on("data", x => out += x); child.stderr.setEncoding("utf8").on("data", x => err += x);
    child.once("error", reject); child.once("close", code => { if (code !== 0) return reject(new Error("worker exit " + code + ": " + err + out)); try { resolve(JSON.parse(out.trim().split("\n").at(-1))); } catch { reject(new Error("bad worker output: " + out + err)); } });
  });
}
test("two independent worker processes cannot claim the same notification", { skip: !enabled || !baseUrl }, async () => {
  const admin = new Pool({ connectionString: baseUrl, ssl: false });
  const schema = "notify_concurrency_" + crypto.randomBytes(6).toString("hex"); let made = false;
  try {
    await admin.query('CREATE SCHEMA "' + schema + '" '); made = true;
    await admin.query('CREATE TABLE "' + schema + '".appointments (id uuid PRIMARY KEY, status text NOT NULL, appointment_date date NOT NULL, appointment_time time NOT NULL)'.replace('".', '".'));
    await admin.query('CREATE TABLE "' + schema + '".notification_outbox (id uuid PRIMARY KEY, appointment_id uuid NOT NULL REFERENCES "' + schema + '".appointments(id), event_type text NOT NULL, channel text NOT NULL, recipient_role text NOT NULL, recipient_phone text NOT NULL, payload jsonb NOT NULL DEFAULT \'{}\'::jsonb, attempts integer NOT NULL DEFAULT 0, scheduled_at timestamptz NOT NULL DEFAULT NOW(), status text NOT NULL DEFAULT \'pending\', created_at timestamptz NOT NULL DEFAULT NOW(), locked_at timestamptz, last_error text, updated_at timestamptz NOT NULL DEFAULT NOW(), sent_at timestamptz, provider_message_id text)'.replaceAll('".', '".'));
    const aid = crypto.randomUUID(), nid = crypto.randomUUID();
    await admin.query('INSERT INTO "' + schema + '".appointments (id,status,appointment_date,appointment_time) VALUES ($1,\'pending\',CURRENT_DATE + 2,\'10:00\')'.replace('".', '".'), [aid]);
    await admin.query('INSERT INTO "' + schema + '".notification_outbox (id,appointment_id,event_type,channel,recipient_role,recipient_phone,payload) VALUES ($1,$2,\'booked\',\'sms\',\'patient\',\'+15555550123\',\'{}\'::jsonb)'.replace('".', '".'), [nid, aid]);
    const scoped = new URL(baseUrl); scoped.searchParams.set("options", "-c search_path=" + schema);
    const results = await Promise.all([runClaim(scoped.toString()), runClaim(scoped.toString())]);
    assert.equal(results.filter(x => x.id === nid).length, 1, "exactly one worker should claim the row: " + JSON.stringify(results));
    const state = await admin.query('SELECT status,attempts FROM "' + schema + '".notification_outbox WHERE id=$1'.replace('".', '".'), [nid]);
    assert.equal(state.rows[0].status, "processing"); assert.equal(state.rows[0].attempts, 1);
  } finally { if (made) await admin.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE'); await admin.end(); }
});

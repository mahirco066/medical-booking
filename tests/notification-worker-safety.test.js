"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const workerPath = path.join(__dirname, "..", "notification-worker.js");

function runScenario(scenario) {
  const script = String.raw`
    const assert = require("node:assert/strict");
    const Module = require("node:module");
    const originalLoad = Module._load;
    let providerCalls = 0;
    const scenario = process.env.SCENARIO;
    const appointment = {
      status: scenario === "cancelled" ? "cancelled" : scenario === "proposal" ? "confirmed" : "pending",
      doctor_id: "00000000-0000-4000-8000-000000000003",
      reschedule_approval_required: scenario === "proposal",
      appointment_date: "2026-10-20", appointment_time: "14:30",
      patient_sms_consent: true, patient_whatsapp_consent: false,
      current_patient_sms_phone: "+249912345678", current_patient_whatsapp_phone: null,
      current_doctor_sms_phone: "+249911111111", current_doctor_whatsapp_phone: null
    };
    const row = {
      id: "00000000-0000-4000-8000-000000000002",
      appointment_id: "00000000-0000-4000-8000-000000000001",
      event_type: scenario === "proposal" ? "reminder_24h" : "booked",
      channel: "sms", recipient_role: "patient", recipient_phone: "+249912345678",
      payload: { appointment_date: "2026-10-20", appointment_time: "14:30", doctor_name: "Test" },
      attempts: 0, lease_token: "2026-10-19 10:00:00.123456+00"
    };
    class FakePool {
      async connect() {
        return { async query(sql) {
          sql = String(sql);
          if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql.trim())) return { rowCount: 0, rows: [] };
          if (/UPDATE notification_outbox SET status='failed',attempts=/.test(sql)) return { rowCount: 0, rows: [] };
          if (sql.includes("SELECT n.id,n.appointment_id")) return { rowCount: 1, rows: [row] };
          if (sql.includes("SET status='processing',attempts=attempts+1")) return { rowCount: 1, rows: [{ lease_token: row.lease_token }] };
          throw new Error("Unexpected transaction query: " + sql);
        }, release() {} };
      }
      async query(sql, params) {
        sql = String(sql);
        if (sql.includes("SELECT a.status,a.doctor_id")) return { rowCount: 1, rows: [appointment] };
        if (sql.includes("UPDATE notification_outbox SET status=$2")) {
          return { rowCount: scenario === "unknown-outcome" ? 0 : 1, rows: [] };
        }
        if (sql.includes("UPDATE notification_outbox SET status='failed',attempts=$2")) {
          assert.equal(params[1], 5);
          assert.match(params[2], /unknown|unclear/i);
          return { rowCount: 1, rows: [] };
        }
        throw new Error("Unexpected pool query: " + sql);
      }
      async end() {}
    }
    Module._load = function(request, parent, isMain) {
      if (request === "pg") return { Pool: FakePool };
      return originalLoad.call(this, request, parent, isMain);
    };
    Object.assign(process.env, {
      DATABASE_URL: "postgres://mock.invalid/test", NOTIFICATION_DRY_RUN: "false",
      NOTIFICATION_SEND_ENABLED: "true", TWILIO_ACCOUNT_SID: "AC_TEST",
      TWILIO_AUTH_TOKEN: "test-token", TWILIO_SMS_FROM: "+15555550100",
      NOTIFICATION_WORKER_TEST_MODE: "true"
    });
    global.fetch = async () => {
      providerCalls++;
      return { ok: true, status: 201, json: async () => ({ sid: "SM_ACCEPTED" }) };
    };
    const worker = require(workerPath);
    Module._load = originalLoad;
    (async () => {
      try {
        await worker.processOne();
        if (scenario === "cancelled" || scenario === "proposal") assert.equal(providerCalls, 0);
        else assert.equal(providerCalls, 1);
        await worker.pool.end();
        console.log("SCENARIO_PASS:" + scenario);
      } catch (error) { console.error(error); process.exitCode = 1; }
    })();
  `;
  return spawnSync(process.execPath, ["-e", script], {
    cwd: path.join(__dirname, ".."), encoding: "utf8",
    env: { ...process.env, SCENARIO: scenario }, timeout: 5000
  });
}
for (const scenario of ["cancelled", "proposal", "unknown-outcome"]) {
  test("processOne safety scenario: " + scenario, () => {
    const result = runScenario(scenario);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, new RegExp("SCENARIO_PASS:" + scenario));
  });
}

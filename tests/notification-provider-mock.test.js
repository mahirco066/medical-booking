"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const originalLoad = Module._load;

process.env.DATABASE_URL = "postgres://mock.invalid/test";
process.env.NOTIFICATION_DRY_RUN = "false";
process.env.NOTIFICATION_SEND_ENABLED = "true";
process.env.TWILIO_ACCOUNT_SID = "AC_TEST";
process.env.TWILIO_AUTH_TOKEN = "test-token";
process.env.TWILIO_SMS_FROM = "+15555550100";
process.env.NOTIFICATION_WORKER_TEST_MODE = "true";

Module._load = function(request, parent, isMain) {
  if (request === "pg") {
    return { Pool: class FakePool {
      query() { throw new Error("Provider unit tests must not query the database"); }
      end() { return Promise.resolve(); }
    } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { sendTwilioMessage, messageFor } = require("../notification-worker.js");
Module._load = originalLoad;

function row(phone) {
  return {
    id: "notification-test",
    channel: "sms",
    recipient_role: "patient",
    recipient_phone: phone || "+249912345678",
    event_type: "reminder_24h",
    payload: {
      appointment_date: "2026-10-20",
      appointment_time: "14:30",
      doctor_name: "طبيب الاختبار"
    }
  };
}

function mockResponse(scenario) {
  if (scenario === "http400") {
    return { ok: false, status: 400, json: async () => ({ message: "Invalid destination" }) };
  }
  if (scenario === "http500") {
    return { ok: false, status: 500, json: async () => ({ message: "provider failure" }) };
  }
  if (scenario === "no-sid") {
    return { ok: true, status: 201, json: async () => ({ status: "queued" }) };
  }
  return { ok: true, status: 201, json: async () => ({ sid: "SM_TEST_123" }) };
}

test("provider success returns the provider message SID", async () => {
  let calls = 0;
  global.fetch = async (url, options) => {
    calls++;
    assert.match(String(url), /api\.twilio\.com\/2010-04-01\/Accounts\/AC_TEST\/Messages\.json$/);
    assert.equal(options.method, "POST");
    assert.match(options.headers.Authorization, /^Basic /);
    const form = new URLSearchParams(options.body);
    assert.equal(form.get("To"), "+249912345678");
    assert.equal(form.get("From"), "+15555550100");
    assert.match(form.get("Body"), /موعد/);
    return mockResponse("success");
  };
  assert.equal(await sendTwilioMessage(row()), "SM_TEST_123");
  assert.equal(calls, 1);
});

test("explicit provider rejection is surfaced as a normal rejection", async () => {
  global.fetch = async () => mockResponse("http400");
  await assert.rejects(sendTwilioMessage(row()), (error) => {
    assert.match(error.message, /Invalid destination/);
    assert.equal(error.deliveryOutcomeUnknown, undefined);
    return true;
  });
});

for (const scenario of ["http500", "no-sid"]) {
  test(scenario + " is marked as an uncertain delivery outcome", async () => {
    global.fetch = async () => mockResponse(scenario);
    await assert.rejects(sendTwilioMessage(row()), (error) => {
      assert.equal(error.deliveryOutcomeUnknown, true);
      assert.match(error.message, /unknown|unclear|suppressed/i);
      return true;
    });
  });
}

test("network failure is marked uncertain to suppress automatic retries", async () => {
  global.fetch = async () => { throw new Error("simulated timeout"); };
  await assert.rejects(sendTwilioMessage(row()), (error) => {
    assert.equal(error.deliveryOutcomeUnknown, true);
    assert.match(error.message, /outcome unknown/i);
    return true;
  });
});

test("invalid recipient phone is rejected before contacting the provider", async () => {
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error("must not be called"); };
  await assert.rejects(sendTwilioMessage(row("not-a-phone")), /E\.164/);
  assert.equal(calls, 0);
});

test("messageFor formats patient and staff booking notifications in Arabic", () => {
  assert.equal(
    messageFor({ ...row(), event_type: "booked" }),
    "تم استلام طلب حجزك لدى طبيب الاختبار يوم 20/10/2026 الساعة 14:30، وهو بانتظار التأكيد."
  );
  assert.equal(
    messageFor({ ...row(), event_type: "booked", recipient_role: "doctor", payload: { ...row().payload, patient_name: "مريض الاختبار" } }),
    "طلب حجز جديد: مريض الاختبار لدى طبيب الاختبار يوم 20/10/2026 الساعة 14:30. يرجى مراجعة الطلب."
  );
});

test("messageFor covers confirmed, cancelled, rescheduled, and reminder events", () => {
  const cases = [
    ["confirmed", "تم تأكيد موعدك لدى طبيب الاختبار يوم 20/10/2026 الساعة 14:30."],
    ["cancelled", "تم إلغاء موعدك لدى طبيب الاختبار بتاريخ 20/10/2026 الساعة 14:30."],
    ["rescheduled", "تم تعديل موعدك لدى طبيب الاختبار ليكون يوم 20/10/2026 الساعة 14:30."],
    ["reminder_24h", "تذكير: لديك موعد لدى طبيب الاختبار يوم 20/10/2026 الساعة 14:30."]
  ];
  for (const [event_type, expected] of cases) {
    assert.equal(messageFor({ ...row(), event_type }), expected, event_type);
  }
});

test("messageFor rejects unsupported event types", () => {
  assert.throws(() => messageFor({ ...row(), event_type: "unsupported" }), /Unsupported notification event type/);
});


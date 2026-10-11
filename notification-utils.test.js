"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateReminderAt, isNotificationRelevant } = require("./notification-utils");

test("reminder is exactly 24 hours before a Khartoum-local appointment (UTC+2)", () => {
  const reminder = calculateReminderAt("2026-10-20", "15:30");
  assert.equal(reminder.toISOString(), "2026-10-19T13:30:00.000Z");
});

test("reminder calculation handles midnight crossing in Sudan local time", () => {
  const reminder = calculateReminderAt("2026-10-20", "00:15");
  assert.equal(reminder.toISOString(), "2026-10-18T22:15:00.000Z");
});

test("reminder rejects malformed and impossible dates", () => {
  assert.throws(() => calculateReminderAt("20-10-2026", "15:30"), TypeError);
  assert.throws(() => calculateReminderAt("2026-02-30", "15:30"), TypeError);
  assert.throws(() => calculateReminderAt("2026-10-20", "24:00"), TypeError);
});

test("booked notice is relevant only while appointment remains pending at same slot", () => {
  assert.equal(isNotificationRelevant("booked", "pending", "2026-10-20", "15:30", "2026-10-20", "15:30"), true);
  assert.equal(isNotificationRelevant("booked", "confirmed", "2026-10-20", "15:30", "2026-10-20", "15:30"), false);
  assert.equal(isNotificationRelevant("booked", "pending", "2026-10-20", "15:30", "2026-10-20", "16:00"), false);
});

test("confirmation and cancellation notices require matching current state", () => {
  assert.equal(isNotificationRelevant("confirmed", "confirmed", "2026-10-20", "15:30", "2026-10-20", "15:30"), true);
  assert.equal(isNotificationRelevant("confirmed", "cancelled", "2026-10-20", "15:30", "2026-10-20", "15:30"), false);
  assert.equal(isNotificationRelevant("cancelled", "cancelled", "2026-10-20", "15:30", "2026-10-20", "15:30"), true);
  assert.equal(isNotificationRelevant("cancelled", "confirmed", "2026-10-20", "15:30", "2026-10-20", "15:30"), false);
});

test("reschedule and reminder notices require a current active status and same slot", () => {
  for (const event of ["rescheduled", "reminder_24h"]) {
    assert.equal(isNotificationRelevant(event, "pending", "2026-10-20", "15:30", "2026-10-20", "15:30"), true);
    assert.equal(isNotificationRelevant(event, "confirmed", "2026-10-20", "15:30", "2026-10-20", "15:30"), true);
    assert.equal(isNotificationRelevant(event, "cancelled", "2026-10-20", "15:30", "2026-10-20", "15:30"), false);
    assert.equal(isNotificationRelevant(event, "pending", "2026-10-20", "15:30", "2026-10-20", "16:00"), false);
  }
});

test("unknown event types are not relevant", () => {
  assert.equal(isNotificationRelevant("unknown", "pending", "2026-10-20", "15:30", "2026-10-20", "15:30"), false);
});

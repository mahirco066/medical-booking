"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateReminderAt,
  isNotificationRelevant,
  isPatientChannelConsented
} = require("../notification-utils");

test("reminder time is scheduled 24 hours before the appointment", () => {
  assert.equal(
    calculateReminderAt("2026-10-20", "14:30").toISOString(),
    "2026-10-19T12:30:00.000Z"
  );
});

test("reminder time accepts a date object-like string with a time suffix", () => {
  assert.equal(
    calculateReminderAt("2026-10-20T00:00:00.000Z", "14:30:00").toISOString(),
    "2026-10-19T12:30:00.000Z"
  );
});

test("invalid calendar dates and times are rejected", () => {
  for (const [date, time] of [
    ["2026-02-30", "10:00"],
    ["2026-10-20", "24:00"],
    ["2026-10-20", "10:60"],
    ["not-a-date", "10:00"],
    ["2026-10-20", "no-time"]
  ]) {
    assert.throws(() => calculateReminderAt(date, time), TypeError);
  }
});

test("patient notification requires explicit consent for the selected channel", () => {
  assert.equal(isPatientChannelConsented("patient", "sms", true, false), true);
  assert.equal(isPatientChannelConsented("patient", "sms", false, true), false);
  assert.equal(isPatientChannelConsented("patient", "whatsapp", false, true), true);
  assert.equal(isPatientChannelConsented("patient", "whatsapp", true, false), false);
  assert.equal(isPatientChannelConsented("patient", "email", true, true), false);
});

test("staff notification does not depend on patient channel consent", () => {
  assert.equal(isPatientChannelConsented("staff", "sms", false, false), true);
});

test("booked notification is relevant only while appointment is pending at the same time", () => {
  assert.equal(isNotificationRelevant("booked", "pending", "2026-10-20", "10:00", "2026-10-20", "10:00"), true);
  assert.equal(isNotificationRelevant("booked", "confirmed", "2026-10-20", "10:00", "2026-10-20", "10:00"), false);
  assert.equal(isNotificationRelevant("booked", "pending", "2026-10-20", "10:00", "2026-10-20", "10:30"), false);
});

test("confirmed notification is relevant only for a confirmed appointment at the same time", () => {
  assert.equal(isNotificationRelevant("confirmed", "confirmed", "2026-10-20", "10:00", "2026-10-20", "10:00"), true);
  assert.equal(isNotificationRelevant("confirmed", "pending", "2026-10-20", "10:00", "2026-10-20", "10:00"), false);
});

test("cancelled notification is relevant only after cancellation", () => {
  assert.equal(isNotificationRelevant("cancelled", "cancelled", "2026-10-20", "10:00", "2026-10-20", "10:00"), true);
  assert.equal(isNotificationRelevant("cancelled", "confirmed", "2026-10-20", "10:00", "2026-10-20", "10:00"), false);
});

test("rescheduled and reminder notifications require an active appointment and matching slot", () => {
  for (const event of ["rescheduled", "reminder_24h"]) {
    assert.equal(isNotificationRelevant(event, "pending", "2026-10-20", "10:00", "2026-10-20", "10:00"), true);
    assert.equal(isNotificationRelevant(event, "confirmed", "2026-10-20", "10:00", "2026-10-20", "10:00"), true);
    assert.equal(isNotificationRelevant(event, "cancelled", "2026-10-20", "10:00", "2026-10-20", "10:00"), false);
    assert.equal(isNotificationRelevant(event, "confirmed", "2026-10-20", "10:00", "2026-10-20", "11:00"), false);
  }
});

test("unknown notification events are never considered relevant", () => {
  assert.equal(isNotificationRelevant("unknown", "confirmed", "2026-10-20", "10:00", "2026-10-20", "10:00"), false);
});

test("reminder calculation handles appointments just after local midnight", () => {
  assert.equal(
    calculateReminderAt("2026-10-20", "00:30").toISOString(),
    "2026-10-18T22:30:00.000Z"
  );
});

test("patient consent requires the literal boolean true", () => {
  for (const consent of [undefined, null, false, 0, 1, "true", "yes"]) {
    assert.equal(isPatientChannelConsented("patient", "sms", consent, false), false);
    assert.equal(isPatientChannelConsented("patient", "whatsapp", false, consent), false);
  }
});

test("unsupported channels and unknown appointment statuses are rejected", () => {
  assert.equal(isPatientChannelConsented("patient", "push", true, true), false);
  assert.equal(isNotificationRelevant("reminder_24h", "completed", "2026-10-20", "10:00", "2026-10-20", "10:00"), false);
  assert.equal(isNotificationRelevant("booked", "cancelled", "2026-10-20", "10:00", "2026-10-20", "10:00"), false);
});

test("unsupported notification channels are rejected for staff as well as patients", () => {
  assert.equal(isPatientChannelConsented("staff", "push", false, false), false);
  assert.equal(isPatientChannelConsented("doctor", "email", false, false), false);
  assert.equal(isPatientChannelConsented("staff", "sms", false, false), true);
});

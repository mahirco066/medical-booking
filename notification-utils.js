"use strict";

function calculateReminderAt(dateText, timeText) {
  const date = String(dateText || "").slice(0, 10);
  const time = String(timeText || "").slice(0, 5);
  const dateMatch = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(date);
  const timeMatch = /^(\\d{2}):(\\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) throw new TypeError("Invalid appointment date or time");

  const [, yearText, monthText, dayText] = dateMatch;
  const [, hourText, minuteText] = timeMatch;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const hour = Number(hourText), minute = Number(minuteText);
  const localAsUtc = Date.UTC(year, month - 1, day, hour - 2, minute);
  const normalized = new Date(localAsUtc);
  if (normalized.getUTCFullYear() !== year || normalized.getUTCMonth() !== month - 1 ||
      normalized.getUTCDate() !== day || hour > 23 || minute > 59) {
    throw new TypeError("Invalid appointment date or time");
  }
  return new Date(localAsUtc - 24 * 60 * 60 * 1000);
}

function isNotificationRelevant(eventType, currentStatus, payloadDate, payloadTime, currentDate, currentTime) {
  const sameSlot =
    String(payloadDate || "").slice(0, 10) === String(currentDate || "").slice(0, 10) &&
    String(payloadTime || "").slice(0, 5) === String(currentTime || "").slice(0, 5);
  if (eventType === "cancelled") return currentStatus === "cancelled";
  if (eventType === "booked") return currentStatus === "pending" && sameSlot;
  if (eventType === "confirmed") return currentStatus === "confirmed" && sameSlot;
  if (eventType === "rescheduled" || eventType === "reminder_24h") {
    return ["pending", "confirmed"].includes(currentStatus) && sameSlot;
  }
  return false;
}

module.exports = { calculateReminderAt, isNotificationRelevant };

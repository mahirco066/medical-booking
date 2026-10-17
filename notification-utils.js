"use strict";

function calculateReminderAt(dateText, timeText) {
  const date = String(dateText || "").slice(0, 10);
  const time = String(timeText || "").slice(0, 5);
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) throw new TypeError("Invalid appointment date or time");

  const [, yearText, monthText, dayText] = dateMatch;
  const [, hourText, minuteText] = timeMatch;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const hour = Number(hourText), minute = Number(minuteText);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 ||
      calendarDate.getUTCDate() !== day || hour > 23 || minute > 59) {
    throw new TypeError("Invalid appointment date or time");
  }
  const localAsUtc = Date.UTC(year, month - 1, day, hour - 2, minute);
  return new Date(localAsUtc - 24 * 60 * 60 * 1000);
}

function isPatientChannelConsented(recipientRole, channel, smsConsent, whatsappConsent) {
  // Reject unsupported channels for every recipient role, not only patients.
  if (channel !== "sms" && channel !== "whatsapp") return false;
  if (recipientRole !== "patient") return true;
  if (channel === "sms") return smsConsent === true;
  return whatsappConsent === true;
}

function isNotificationRelevant(eventType, currentStatus, payloadDate, payloadTime, currentDate, currentTime, rescheduleApprovalRequired = false) {
  const sameSlot =
    String(payloadDate || "").slice(0, 10) === String(currentDate || "").slice(0, 10) &&
    String(payloadTime || "").slice(0, 5) === String(currentTime || "").slice(0, 5);
  if (eventType === "cancelled") return currentStatus === "cancelled";
  if (eventType === "booked") return currentStatus === "pending" && sameSlot;
  if (eventType === "confirmed") return currentStatus === "confirmed" && sameSlot;
  if (eventType === "reschedule_requested") {
    return currentStatus === "confirmed" && rescheduleApprovalRequired === true && sameSlot;
  }
  if (eventType === "rescheduled") {
    return ["pending", "confirmed"].includes(currentStatus) && rescheduleApprovalRequired !== true && sameSlot;
  }
  if (eventType === "reminder_24h") {
    return ["pending", "confirmed"].includes(currentStatus) && rescheduleApprovalRequired !== true && sameSlot;
  }
  return false;
}

module.exports = { calculateReminderAt, isNotificationRelevant, isPatientChannelConsented };

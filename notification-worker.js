"use strict";

const { Pool } = require("pg");
const { isNotificationRelevant, isPatientChannelConsented } = require("./notification-utils");
const DRY_RUN = String(process.env.NOTIFICATION_DRY_RUN || "").toLowerCase() === "true";
const required = DRY_RUN
  ? ["DATABASE_URL"]
  : ["DATABASE_URL", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "NOTIFICATION_SEND_ENABLED"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error("Notification worker not started. Missing environment variables: " + missing.join(", "));
  process.exit(1);
}
const SMS_FROM = process.env.TWILIO_SMS_FROM || "";
const WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || "";
// WhatsApp rows are queued by the app, but delivery stays disabled until the
// worker supports approved template messages and an explicit consent check.
const ENABLED_CHANNELS = DRY_RUN ? [] : SMS_FROM ? ["sms"] : [];
if (!DRY_RUN && !ENABLED_CHANNELS.length) {
  console.error("Notification worker not started. Configure TWILIO_SMS_FROM. WhatsApp delivery is not enabled yet.");
  process.exit(1);
}
if (!DRY_RUN && String(process.env.NOTIFICATION_SEND_ENABLED).toLowerCase() !== "true") {
  console.error("Notification worker not started. Set NOTIFICATION_SEND_ENABLED=true only after completing a controlled test.");
  process.exit(1);
}
if (DRY_RUN) {
  console.log("Notification worker started in DRY RUN mode. No messages will be claimed or sent.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "test" ? false : { rejectUnauthorized: false },
  max: 3
});
const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
const INTERVAL_MS = 5000;
const MAX_ATTEMPTS = 5;
let stopping = false;
let running = false;

function formatAppointmentDate(value) {
  const date = String(value || "").slice(0, 10);
  const parts = date.split("-");
  return parts.length === 3 ? parts[2] + "/" + parts[1] + "/" + parts[0] : date;
}

function messageFor(row) {
  const p = row.payload || {};
  const date = formatAppointmentDate(p.appointment_date);
  const time = String(p.appointment_time || "").slice(0, 5);
  const doctor = p.doctor_name || "الطبيب";
  const patient = p.patient_name || "المريض";
  const isPatient = row.recipient_role === "patient";
  switch (row.event_type) {
    case "booked":
      return isPatient
        ? "تم استلام طلب حجزك لدى " + doctor + " يوم " + date + " الساعة " + time + "، وهو بانتظار التأكيد."
        : "طلب حجز جديد: " + patient + " لدى " + doctor + " يوم " + date + " الساعة " + time + ". يرجى مراجعة الطلب.";
    case "confirmed":
      return isPatient
        ? "تم تأكيد موعدك لدى " + doctor + " يوم " + date + " الساعة " + time + "."
        : "تم تأكيد موعد " + patient + " لدى " + doctor + " يوم " + date + " الساعة " + time + ".";
    case "cancelled":
      return isPatient
        ? "تم إلغاء موعدك لدى " + doctor + " بتاريخ " + date + " الساعة " + time + "."
        : "تم إلغاء موعد " + patient + " لدى " + doctor + " بتاريخ " + date + " الساعة " + time + ".";
    case "rescheduled":
      return isPatient
        ? "تم تعديل موعدك لدى " + doctor + " ليكون يوم " + date + " الساعة " + time + "."
        : "تم تعديل موعد " + patient + " لدى " + doctor + " ليكون يوم " + date + " الساعة " + time + ".";
    case "reminder_24h":
      return isPatient
        ? "تذكير: لديك موعد لدى " + doctor + " يوم " + date + " الساعة " + time + "."
        : "تذكير بموعد " + patient + " لدى " + doctor + " يوم " + date + " الساعة " + time + ".";
    default:
      throw new Error("Unsupported notification event type");
  }
}

async function sendTwilioMessage(row) {
  const channel = row.channel;
  const rawTo = String(row.recipient_phone || "").trim();
  if (!/^\+[1-9]\d{7,14}$/.test(rawTo)) {
    throw new Error("Recipient phone must be in international E.164 format");
  }
  const configuredFrom = channel === "sms" ? SMS_FROM : channel === "whatsapp" ? WHATSAPP_FROM : "";
  if (!configuredFrom) throw new Error("Twilio sender is not configured for channel: " + channel);
  const to = channel === "whatsapp" ? "whatsapp:" + rawTo : rawTo;
  const from = channel === "whatsapp"
    ? (configuredFrom.startsWith("whatsapp:") ? configuredFrom : "whatsapp:" + configuredFrom)
    : configuredFrom;
  const endpoint = "https://api.twilio.com/2010-04-01/Accounts/" + SID + "/Messages.json";
  const form = new URLSearchParams({ To: to, From: from, Body: messageFor(row) });
  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(20000),
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(SID + ":" + TOKEN).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data.message || ("Twilio HTTP " + response.status)).slice(0, 500));
  return data.sid || null;
}

async function claimOne() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Recover claims left behind by a worker that crashed or was restarted.
    // Older rows with no lease timestamp are recovered too.
    await client.query(
      "UPDATE notification_outbox SET status='failed',locked_at=NULL," +
      " scheduled_at=NOW(),last_error='Recovered stale processing lease.',updated_at=NOW()" +
      " WHERE status='processing' AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '5 minutes')"
    );

    const result = await client.query(
      "SELECT n.id,n.appointment_id,n.event_type,n.channel,n.recipient_role,n.recipient_phone,n.payload,n.attempts," +
      " a.status AS current_status,a.appointment_date::text AS current_date,to_char(a.appointment_time,'HH24:MI') AS current_time" +
      " FROM notification_outbox n JOIN appointments a ON a.id=n.appointment_id" +
      " WHERE n.channel = ANY($1::text[]) AND n.status IN ('pending','failed') AND n.scheduled_at <= NOW() AND n.attempts < $2" +
      " ORDER BY n.scheduled_at,n.created_at LIMIT 1 FOR UPDATE OF n SKIP LOCKED",
      [ENABLED_CHANNELS, MAX_ATTEMPTS]
    );
    if (!result.rowCount) { await client.query("COMMIT"); return null; }
    const row = result.rows[0];
    const lease = await client.query("UPDATE notification_outbox SET status='processing',attempts=attempts+1,locked_at=NOW(),updated_at=NOW(),last_error=NULL WHERE id=$1 RETURNING to_char(locked_at, 'YYYY-MM-DD HH24:MI:SS.USOF') AS lease_token", [row.id]);
    // Keep PostgreSQL microseconds intact; JavaScript Date would truncate them.
    row.lease_token = lease.rows[0]?.lease_token || null;
    await client.query("COMMIT");
    return row;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function finish(row, status, errorText, sentAt, providerMessageId) {
  const attempts = Number(row.attempts || 0) + 1;
  const delaySeconds = Math.min(3600, 30 * Math.pow(2, Math.max(0, attempts - 1)));
  await pool.query(
    "UPDATE notification_outbox SET status=$2,last_error=$3,sent_at=$4,provider_message_id=$5,locked_at=NULL," +
    " scheduled_at=CASE WHEN $2='failed' AND attempts < $6 THEN NOW() + ($7 * INTERVAL '1 second') ELSE scheduled_at END," +
    " updated_at=NOW() WHERE id=$1 AND status='processing' AND locked_at=$8::timestamptz",
    [row.id, status, errorText || null, sentAt || null, providerMessageId || null, MAX_ATTEMPTS, delaySeconds, row.lease_token]
  );
}

async function isNotificationStillRelevant(row) {
  const result = await pool.query(
    "SELECT a.status,a.appointment_date::text AS appointment_date,to_char(a.appointment_time,'HH24:MI') AS appointment_time," +
    " COALESCE(p.sms_notifications_consent,FALSE) AS patient_sms_consent," +
    " COALESCE(p.whatsapp_notifications_consent,FALSE) AS patient_whatsapp_consent," +
    " COALESCE(NULLIF(BTRIM(p.phone),''),NULLIF(BTRIM(a.patient_phone),''),NULLIF(BTRIM(pu.phone),'')) AS current_patient_sms_phone," +
    " COALESCE(NULLIF(BTRIM(p.whatsapp_phone),''),NULLIF(BTRIM(pu.whatsapp_phone),'')) AS current_patient_whatsapp_phone" +
    " FROM appointments a LEFT JOIN patients p ON p.id=a.patient_id LEFT JOIN users pu ON pu.id=p.user_id WHERE a.id=$1 LIMIT 1",
    [row.appointment_id]
  );
  if (!result.rowCount) return false;
  const appointment = result.rows[0];
  if (!isPatientChannelConsented(
    row.recipient_role,
    row.channel,
    appointment.patient_sms_consent,
    appointment.patient_whatsapp_consent
  )) return false;
  // A patient may change contact numbers after an event was queued. Never send
  // a stale queued notification to the previous number, even if consent remains on.
  if (row.recipient_role === "patient") {
    const currentPhone = row.channel === "sms"
      ? appointment.current_patient_sms_phone
      : row.channel === "whatsapp"
        ? appointment.current_patient_whatsapp_phone
        : null;
    if (!currentPhone || String(currentPhone).trim() !== String(row.recipient_phone || "").trim()) return false;
  }
  return isNotificationRelevant(
    row.event_type,
    appointment.status,
    row.payload.appointment_date,
    row.payload.appointment_time,
    appointment.appointment_date,
    appointment.appointment_time
  );
}

async function processOne() {
  const row = await claimOne();
  if (!row) return false;
  try {
    // Re-read the appointment immediately before delivery so queued events do not
    // announce a booking state or time that has already changed.
    if (!(await isNotificationStillRelevant(row))) {
      await finish(row, "cancelled", "Notification skipped because appointment state or time changed.", null, null);
      return true;
    }
    const sid = await sendTwilioMessage(row);
    await finish(row, "sent", null, new Date(), sid);
    return true;
  } catch (error) {
    const message = String(error && error.message ? error.message : error).slice(0, 500);
    console.error("Notification delivery failed: " + row.id + " " + message);
    await finish(row, "failed", message, null, null);
    return true;
  }
}

async function tick() {
  if (running || stopping) return;
  running = true;
  try {
    for (let i = 0; i < 20 && !stopping; i++) {
      if (!(await processOne())) break;
    }
  } catch (error) {
    console.error("Notification worker loop error:", error);
  } finally {
    running = false;
  }
}

async function dryRunTick() {
  if (running || stopping) return;
  running = true;
  try {
    // Read aggregate counts only: dry-run never claims, updates, or sends queue items.
    const result = await pool.query(
      "SELECT status, channel, COUNT(*)::int AS count FROM notification_outbox GROUP BY status, channel ORDER BY status, channel"
    );
    console.log("Notification worker DRY RUN queue summary:", JSON.stringify(result.rows));
  } catch (error) {
    console.error("Notification worker DRY RUN check failed:", String(error && error.message ? error.message : error).slice(0, 500));
    // Match the checklist: a failed database check stops dry-run instead of
    // silently retrying forever against a missing table or broken connection.
    stopping = true;
    clearInterval(timer);
    await pool.end().catch(() => {});
    process.exitCode = 1;
  } finally {
    running = false;
  }
}

const timer = setInterval(() => {
  if (DRY_RUN) dryRunTick();
  else tick();
}, DRY_RUN ? 60000 : INTERVAL_MS);
if (DRY_RUN) dryRunTick();
else tick();

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  console.log("Notification worker stopping (" + signal + ")...");
  const deadline = Date.now() + 10000;
  while (running && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

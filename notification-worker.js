"use strict";

const { Pool } = require("pg");
const required = ["DATABASE_URL", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_SMS_FROM", "NOTIFICATION_SEND_ENABLED"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error("Notification worker not started. Missing environment variables: " + missing.join(", "));
  process.exit(1);
}
if (String(process.env.NOTIFICATION_SEND_ENABLED).toLowerCase() !== "true") {
  console.error("Notification worker not started. Set NOTIFICATION_SEND_ENABLED=true only after completing a controlled test.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
const FROM = process.env.TWILIO_SMS_FROM;
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

async function sendTwilioSms(to, body) {
  if (!/^\+[1-9]\d{7,14}$/.test(String(to || "").trim())) {
    throw new Error("Recipient phone must be in international E.164 format");
  }
  const endpoint = "https://api.twilio.com/2010-04-01/Accounts/" + SID + "/Messages.json";
  const form = new URLSearchParams({ To: String(to).trim(), From: FROM, Body: body });
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
      " WHERE n.channel='sms' AND n.status IN ('pending','failed') AND n.scheduled_at <= NOW() AND n.attempts < $1" +
      " ORDER BY n.scheduled_at,n.created_at LIMIT 1 FOR UPDATE OF n SKIP LOCKED",
      [MAX_ATTEMPTS]
    );
    if (!result.rowCount) { await client.query("COMMIT"); return null; }
    const row = result.rows[0];
    await client.query("UPDATE notification_outbox SET status='processing',attempts=attempts+1,locked_at=NOW(),updated_at=NOW(),last_error=NULL WHERE id=$1", [row.id]);
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
    " updated_at=NOW() WHERE id=$1",
    [row.id, status, errorText || null, sentAt || null, providerMessageId || null, MAX_ATTEMPTS, delaySeconds]
  );
}

async function isNotificationStillRelevant(row) {
  const result = await pool.query(
    "SELECT status,appointment_date::text AS appointment_date,to_char(appointment_time,'HH24:MI') AS appointment_time " +
    "FROM appointments WHERE id=$1 LIMIT 1",
    [row.appointment_id]
  );
  if (!result.rowCount) return false;
  const appointment = result.rows[0];
  const status = appointment.status;
  const sameSlot =
    String(row.payload.appointment_date || "").slice(0, 10) === String(appointment.appointment_date || "").slice(0, 10) &&
    String(row.payload.appointment_time || "").slice(0, 5) === String(appointment.appointment_time || "").slice(0, 5);

  if (row.event_type === "cancelled") return status === "cancelled";
  if (row.event_type === "booked") return status === "pending" && sameSlot;
  if (row.event_type === "confirmed") return status === "confirmed" && sameSlot;
  if (row.event_type === "rescheduled") return ["pending", "confirmed"].includes(status) && sameSlot;
  if (row.event_type === "reminder_24h") return ["pending", "confirmed"].includes(status) && sameSlot;
  return false;
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
    const sid = await sendTwilioSms(row.recipient_phone, messageFor(row));
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

const timer = setInterval(tick, INTERVAL_MS);
tick();

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

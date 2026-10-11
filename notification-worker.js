"use strict";

const { Pool } = require("pg");
const required = ["DATABASE_URL", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_SMS_FROM"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error("Notification worker not started. Missing environment variables: " + missing.join(", "));
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
  switch (row.event_type) {
    case "booked": return "طلب حجزك لدى " + doctor + " يوم " + date + " الساعة " + time + " بانتظار التأكيد.";
    case "confirmed": return "تم تأكيد موعدك لدى " + doctor + " يوم " + date + " الساعة " + time + ".";
    case "cancelled": return "تم إلغاء الموعد لدى " + doctor + " بتاريخ " + date + " الساعة " + time + ".";
    case "rescheduled": return "تم تعديل الموعد لدى " + doctor + " ليكون يوم " + date + " الساعة " + time + ".";
    case "reminder_24h": return "تذكير: لديك موعد لدى " + doctor + " يوم " + date + " الساعة " + time + ".";
    default: throw new Error("Unsupported notification event type");
  }
}

async function sendTwilioSms(to, body) {
  if (!/^\\+[1-9]\\d{7,14}$/.test(String(to || "").trim())) {
    throw new Error("Recipient phone must be in international E.164 format");
  }
  const endpoint = "https://api.twilio.com/2010-04-01/Accounts/" + SID + "/Messages.json";
  const form = new URLSearchParams({ To: String(to).trim(), From: FROM, Body: body });
  const response = await fetch(endpoint, {
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
    const result = await client.query(
      "SELECT n.id,n.appointment_id,n.event_type,n.channel,n.recipient_role,n.recipient_phone,n.payload,n.attempts," +
      " a.status AS current_status,a.appointment_date::text AS current_date,to_char(a.appointment_time,'HH24:MI') AS current_time" +
      " FROM notification_outbox n JOIN appointments a ON a.id=n.appointment_id" +
      " WHERE n.channel='sms' AND n.status IN ('pending','failed') AND n.scheduled_at <= NOW() AND n.attempts < $1" +
      " ORDER BY n.scheduled_at,n.created_at FOR UPDATE OF n SKIP LOCKED LIMIT 1",
      [MAX_ATTEMPTS]
    );
    if (!result.rowCount) { await client.query("COMMIT"); return null; }
    const row = result.rows[0];
    await client.query("UPDATE notification_outbox SET status='processing',attempts=attempts+1,updated_at=NOW(),last_error=NULL WHERE id=$1", [row.id]);
    await client.query("COMMIT");
    return row;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function finish(row, status, errorText, sentAt) {
  const attempts = Number(row.attempts || 0) + 1;
  const delaySeconds = Math.min(3600, 30 * Math.pow(2, Math.max(0, attempts - 1)));
  await pool.query(
    "UPDATE notification_outbox SET status=$2,last_error=$3,sent_at=$4," +
    " scheduled_at=CASE WHEN $2='failed' AND attempts < $5 THEN NOW() + ($6 * INTERVAL '1 second') ELSE scheduled_at END," +
    " updated_at=NOW() WHERE id=$1",
    [row.id, status, errorText || null, sentAt || null, MAX_ATTEMPTS, delaySeconds]
  );
}

async function processOne() {
  const row = await claimOne();
  if (!row) return false;
  try {
    if (row.event_type === "reminder_24h") {
      const active = ["pending", "confirmed"].includes(row.current_status);
      const sameSlot =
        String(row.payload.appointment_date).slice(0, 10) === String(row.current_date).slice(0, 10) &&
        String(row.payload.appointment_time).slice(0, 5) === String(row.current_time).slice(0, 5);
      if (!active || !sameSlot) {
        await finish(row, "cancelled", "Reminder skipped because appointment is inactive or its time changed.", null);
        return true;
      }
    }
    const sid = await sendTwilioSms(row.recipient_phone, messageFor(row));
    await finish(row, "sent", sid ? "Twilio SID: " + sid : null, new Date());
    return true;
  } catch (error) {
    const message = String(error && error.message ? error.message : error).slice(0, 500);
    console.error("Notification delivery failed: " + row.id + " " + message);
    await finish(row, "failed", message, null);
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

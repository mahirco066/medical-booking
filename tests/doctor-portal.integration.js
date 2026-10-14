const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Pool } = require("pg");

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:18080";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function request(route, { token, method = "GET", body } = {}) {
  const response = await fetch(new URL(route, baseUrl), {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  let data = {};
  try { data = await response.json(); } catch {}
  return { status: response.status, data };
}

function expectStatus(result, status, message) {
  assert.equal(result.status, status, `${message}; got ${result.status}: ${JSON.stringify(result.data)}`);
}

async function login(username, password) {
  const result = await request("/api/staff/login", {
    method: "POST",
    body: { username, password }
  });
  expectStatus(result, 200, `Login for ${username}`);
  assert.ok(result.data.token, `No access token returned for ${username}`);
  return { token: result.data.token, user: result.data.user };
}

async function main() {
  const suffix = crypto.randomUUID().slice(0, 8);
  const admin = await login(process.env.ADMIN_USERNAME || "admin", process.env.ADMIN_PASSWORD || "admin123");

  const doctorAResult = await request("/api/admin/doctors", {
    token: admin.token, method: "POST",
    body: { full_name: "Test Doctor A", specialty: "General", area: "Test Area" }
  });
  expectStatus(doctorAResult, 200, "Create doctor A");
  const doctorA = doctorAResult.data.doctor;

  const doctorBResult = await request("/api/admin/doctors", {
    token: admin.token, method: "POST",
    body: { full_name: "Test Doctor B", specialty: "Pediatrics", area: "Test Area" }
  });
  expectStatus(doctorBResult, 200, "Create doctor B");
  const doctorB = doctorBResult.data.doctor;

  for (const [doctor, username] of [[doctorA, `doc_a_${suffix}`], [doctorB, `doc_b_${suffix}`]]) {
    const account = await request(`/api/admin/doctors/${doctor.id}/account`, {
      token: admin.token, method: "POST",
      body: { username, password: "TestDoctorPass123", full_name: doctor.full_name }
    });
    expectStatus(account, 200, `Create account for ${username}`);
  }

  const doctorAUser = await login(`doc_a_${suffix}`, "TestDoctorPass123");
  const doctorBUser = await login(`doc_b_${suffix}`, "TestDoctorPass123");

  const secretaryCreated = await request("/api/doctor/secretaries", {
    token: doctorAUser.token, method: "POST",
    body: { full_name: "Test Secretary A", username: `sec_a_${suffix}`, password: "TestSecretaryPass123" }
  });
  expectStatus(secretaryCreated, 200, "Doctor A creates secretary");

  const secretary = await login(`sec_a_${suffix}`, "TestSecretaryPass123");
  assert.equal(secretary.user.role, "secretary");
  assert.equal(secretary.user.doctor_id, doctorA.id);

  const secretaryList = await request("/api/doctor/secretaries", { token: doctorAUser.token });
  expectStatus(secretaryList, 200, "Doctor can list own secretaries");
  assert.ok(secretaryList.data.secretaries.some(s => s.id === secretaryCreated.data.secretary.id), "Doctor should see the secretary account they created");

  const secondSecretaryCreated = await request("/api/doctor/secretaries", {
    token: doctorAUser.token, method: "POST",
    body: { full_name: "Test Secretary To Disable", username: `sec_disable_${suffix}`, password: "TestSecretaryPass123" }
  });
  expectStatus(secondSecretaryCreated, 200, "Doctor can create a second secretary");

  const secondSecretaryDisabled = await request(`/api/doctor/secretaries/${secondSecretaryCreated.data.secretary.id}/status`, {
    token: doctorAUser.token, method: "PATCH", body: { active: false }
  });
  expectStatus(secondSecretaryDisabled, 200, "Doctor can disable a secretary");
  assert.equal(secondSecretaryDisabled.data.secretary.active, false, "Disabled secretary should be inactive");

  const disabledSecretaryLogin = await request("/api/staff/login", {
    method: "POST", body: { username: `sec_disable_${suffix}`, password: "TestSecretaryPass123" }
  });
  expectStatus(disabledSecretaryLogin, 403, "Disabled secretary cannot log in");

  // Use distinct contact numbers to verify that notification routing stays within the booked doctor's team.
  await pool.query("UPDATE doctors SET phone=$2 WHERE id=$1", [doctorA.id, "+249900000101"]);
  await pool.query("UPDATE doctors SET phone=$2 WHERE id=$1", [doctorB.id, "+249900000102"]);
  await pool.query(
    "UPDATE staff_users SET phone=$2,whatsapp_phone=$3 WHERE id=$1",
    [secretaryCreated.data.secretary.id, "+249900000201", "+249900000202"]
  );
  await pool.query(
    "UPDATE staff_users SET phone=$2,whatsapp_phone=$3 WHERE id=$1",
    [secondSecretaryCreated.data.secretary.id, "+249900000301", "+249900000302"]
  );

  const serviceResult = await pool.query("SELECT id FROM services WHERE active=TRUE ORDER BY name LIMIT 1");
  const serviceId = serviceResult.rows[0]?.id || null;
  const appointmentAId = crypto.randomUUID();
  const appointmentBId = crypto.randomUUID();
  const appointmentConflictId = crypto.randomUUID();
  const date = "2099-01-15";

  await pool.query(
    "INSERT INTO appointments (id,doctor_id,service_id,patient_name,patient_phone,appointment_date,appointment_time,status) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending'),($8,$9,$3,$10,$11,$6,$12,'pending'),($13,$2,$3,$14,$15,$6,$16,'pending')",
    [appointmentAId, doctorA.id, serviceId, "Patient A", "000000001", date, "09:00",
     appointmentBId, doctorB.id, "Patient B", "000000002", "10:00",
     appointmentConflictId, "Patient C", "000000003", "10:00"]
  );

  const invalidCalendarDate = await request(`/api/doctor/appointments/${appointmentAId}`, {
    token: doctorAUser.token, method: "PATCH",
    body: { appointment_date: "2099-02-30", appointment_time: "09:00" }
  });
  expectStatus(invalidCalendarDate, 400, "Reject impossible calendar dates instead of returning a database error");

  const listA = await request("/api/doctor/appointments", { token: doctorAUser.token });
  expectStatus(listA, 200, "Doctor A appointments list");
  assert.deepEqual(listA.data.appointments.map(a => a.id).sort(), [appointmentAId, appointmentConflictId].sort(), "Doctor A must only see their own appointments");

  const listB = await request("/api/doctor/appointments", { token: doctorBUser.token });
  expectStatus(listB, 200, "Doctor B appointments list");
  assert.deepEqual(listB.data.appointments.map(a => a.id), [appointmentBId], "Doctor B must only see their own appointment");

  const listSecretary = await request("/api/doctor/appointments", { token: secretary.token });
  expectStatus(listSecretary, 200, "Secretary appointments list");
  assert.deepEqual(listSecretary.data.appointments.map(a => a.id).sort(), [appointmentAId, appointmentConflictId].sort(), "Secretary must only see their doctor's appointments");

  const secretaryConfirmsOwnDoctorAppointment = await request(`/api/doctor/appointments/${appointmentAId}/status`, {
    token: secretary.token, method: "PATCH", body: { status: "confirmed" }
  });
  expectStatus(secretaryConfirmsOwnDoctorAppointment, 200, "Secretary can update appointment status for their own doctor");
  assert.equal(secretaryConfirmsOwnDoctorAppointment.data.appointment.status, "confirmed");

  const confirmedOutbox = await pool.query(
    "SELECT event_type,status FROM notification_outbox WHERE appointment_id=$1",
    [appointmentAId]
  );
  assert.ok(
    confirmedOutbox.rows.some(row => row.event_type === "confirmed" && row.status === "pending"),
    "Confirming an appointment should queue a confirmation notice"
  );

  const secretaryCannotMarkCompleted = await request(`/api/doctor/appointments/${appointmentAId}/status`, {
    token: secretary.token, method: "PATCH", body: { status: "completed" }
  });
  expectStatus(secretaryCannotMarkCompleted, 403, "Secretary cannot mark an appointment completed");

  const crossDoctorEdit = await request(`/api/doctor/appointments/${appointmentBId}/status`, {
    token: doctorAUser.token, method: "PATCH", body: { status: "confirmed" }
  });
  expectStatus(crossDoctorEdit, 404, "Doctor A cannot change Doctor B appointment");

  const crossDoctorEditBySecretary = await request(`/api/doctor/appointments/${appointmentBId}`, {
    token: secretary.token, method: "PATCH", body: { appointment_date: "2099-01-16", appointment_time: "11:00" }
  });
  expectStatus(crossDoctorEditBySecretary, 404, "Secretary cannot edit another doctor's appointment");

  const secretarySchedules = await request("/api/doctor/schedules", { token: secretary.token });
  expectStatus(secretarySchedules, 403, "Secretary cannot manage doctor's schedule");

  const fakeScheduleId = crypto.randomUUID();
  const secretaryCreatesSchedule = await request("/api/doctor/schedules", {
    token: secretary.token, method: "POST",
    body: { day_of_week: 3, start_time: "13:00", end_time: "15:00", slot_duration_minutes: 30 }
  });
  expectStatus(secretaryCreatesSchedule, 403, "Secretary cannot create doctor's schedule");

  const secretaryUpdatesSchedule = await request(`/api/doctor/schedules/${fakeScheduleId}`, {
    token: secretary.token, method: "PUT",
    body: { day_of_week: 3, start_time: "13:00", end_time: "15:00", slot_duration_minutes: 30 }
  });
  expectStatus(secretaryUpdatesSchedule, 403, "Secretary cannot update doctor's schedule");

  const secretaryTogglesSchedule = await request(`/api/doctor/schedules/${fakeScheduleId}/status`, {
    token: secretary.token, method: "PATCH", body: { active: false }
  });
  expectStatus(secretaryTogglesSchedule, 403, "Secretary cannot enable or disable doctor's schedule");

  const secretaryListsSecretaries = await request("/api/doctor/secretaries", { token: secretary.token });
  expectStatus(secretaryListsSecretaries, 403, "Secretary cannot manage secretary accounts");

  const secretaryCreatesSecretary = await request("/api/doctor/secretaries", {
    token: secretary.token, method: "POST",
    body: { full_name: "Forbidden Secretary", username: `forbidden_${suffix}`, password: "ForbiddenPass123" }
  });
  expectStatus(secretaryCreatesSecretary, 403, "Secretary cannot create another secretary");

  const secretaryDisablesSecretary = await request(`/api/doctor/secretaries/${fakeScheduleId}/status`, {
    token: secretary.token, method: "PATCH", body: { active: false }
  });
  expectStatus(secretaryDisablesSecretary, 403, "Secretary cannot enable or disable secretary accounts");

  const scheduleCreated = await request("/api/doctor/schedules", {
    token: doctorAUser.token, method: "POST",
    body: { day_of_week: 2, start_time: "09:00", end_time: "12:00", slot_duration_minutes: 30 }
  });
  expectStatus(scheduleCreated, 200, "Doctor can create own schedule");

  const dateDay = new Date(date + "T00:00:00Z").getUTCDay();
  const scheduleForDate = await request("/api/doctor/schedules", {
    token: doctorAUser.token, method: "POST",
    body: { day_of_week: dateDay, start_time: "09:00", end_time: "12:00", slot_duration_minutes: 30 }
  });
  expectStatus(scheduleForDate, 200, "Doctor can create schedule for appointment date");

  const outsideHours = await request(`/api/doctor/appointments/${appointmentAId}`, {
    token: doctorAUser.token, method: "PATCH",
    body: { appointment_date: date, appointment_time: "12:30" }
  });
  expectStatus(outsideHours, 409, "Appointment cannot be moved outside active schedule");

  const occupiedSlot = await request(`/api/doctor/appointments/${appointmentAId}`, {
    token: doctorAUser.token, method: "PATCH",
    body: { appointment_date: date, appointment_time: "10:00" }
  });
  expectStatus(occupiedSlot, 409, "Appointment cannot be moved to another booked slot");

  const secretaryCancelsOwnAppointment = await request(`/api/doctor/appointments/${appointmentConflictId}/status`, {
    token: secretary.token, method: "PATCH", body: { status: "cancelled", cancellation_reason: "Test cancellation" }
  });
  expectStatus(secretaryCancelsOwnAppointment, 200, "Secretary can cancel an appointment for their own doctor");

  const cancelledOutbox = await pool.query(
    "SELECT event_type,status FROM notification_outbox WHERE appointment_id=$1",
    [appointmentConflictId]
  );
  assert.ok(
    cancelledOutbox.rows.some(row => row.event_type === "cancelled" && row.status === "pending"),
    "Cancelling an appointment should queue a cancellation notice"
  );
  assert.ok(
    cancelledOutbox.rows.filter(row => row.event_type !== "cancelled").every(row => row.status === "cancelled" || row.status === "sent"),
    "Cancellation should invalidate unsent booking/reminder notifications while preserving sent audit rows"
  );

  const cannotReopenCancelledAppointment = await request(`/api/doctor/appointments/${appointmentConflictId}/status`, {
    token: doctorAUser.token, method: "PATCH", body: { status: "confirmed" }
  });
  expectStatus(cannotReopenCancelledAppointment, 409, "Cancelled appointments cannot be reopened through status update");

  const validReschedule = await request(`/api/doctor/appointments/${appointmentAId}`, {
    token: doctorAUser.token, method: "PATCH",
    body: { appointment_date: date, appointment_time: "09:30" }
  });
  expectStatus(validReschedule, 200, "Appointment can be moved to a free slot within active schedule");
  assert.equal(String(validReschedule.data.appointment.appointment_time).slice(0, 5), "09:30");

  const rescheduledOutbox = await pool.query(
    "SELECT event_type,status,payload FROM notification_outbox WHERE appointment_id=$1",
    [appointmentAId]
  );
  assert.ok(
    rescheduledOutbox.rows.some(row => row.event_type === "rescheduled" && row.status === "pending" &&
      row.payload && String(row.payload.appointment_time).slice(0, 5) === "09:30"),
    "Rescheduling should queue a notice for the new appointment time"
  );
  assert.ok(
    rescheduledOutbox.rows.filter(row => ["booked","confirmed","rescheduled","reminder_24h"].includes(row.event_type) &&
      String(row.payload && row.payload.appointment_time).slice(0, 5) !== "09:30")
      .every(row => row.status === "cancelled" || row.status === "sent"),
    "Rescheduling should invalidate unsent notifications for the old time"
  );

  // Preserve login compatibility for legacy patient hashes stored as "salt:hash".
  const legacyPatientUsername = `legacy_patient_${suffix}`;
  const legacyPatientId = crypto.randomUUID();
  const legacyUserId = crypto.randomUUID();
  const legacyPassword = "LegacyPatientPass123";
  const legacySalt = crypto.randomBytes(16).toString("hex");
  const legacyHash = await new Promise((resolve, reject) => {
    crypto.scrypt(legacyPassword, legacySalt, 64, (error, derivedKey) => {
      if (error) return reject(error);
      resolve(derivedKey.toString("hex"));
    });
  });
  await pool.query(
    "INSERT INTO users (id,username,password_hash,password_salt,full_name,phone,role,active) VALUES ($1,$2,$3,NULL,$4,$5,'patient',TRUE)",
    [legacyUserId, legacyPatientUsername, `${legacySalt}:${legacyHash}`, "Legacy Test Patient", "000000099"]
  );
  await pool.query(
    "INSERT INTO patients (id,user_id,username,full_name,phone,active) VALUES ($1,$2,$3,$4,$5,TRUE)",
    [legacyPatientId, legacyUserId, legacyPatientUsername, "Legacy Test Patient", "000000099"]
  );
  const legacyLogin = await request("/api/login", {
    method: "POST",
    body: { username: legacyPatientUsername, password: legacyPassword }
  });
  expectStatus(legacyLogin, 200, "Legacy patient with combined salt/hash can still log in");
  assert.ok(legacyLogin.data.token, "Legacy patient login should return an access token");
  // Also handle legacy combined hashes when password_salt was already populated.
  const mixedLegacyUsername = `mixed_legacy_patient_${suffix}`;
  const mixedLegacyPatientId = crypto.randomUUID();
  const mixedLegacyUserId = crypto.randomUUID();
  await pool.query(
    "INSERT INTO users (id,username,password_hash,password_salt,full_name,phone,role,active) VALUES ($1,$2,$3,$4,$5,$6,'patient',TRUE)",
    [mixedLegacyUserId, mixedLegacyUsername, `${legacySalt}:${legacyHash}`, legacySalt, "Mixed Legacy Test Patient", "000000098"]
  );
  await pool.query(
    "INSERT INTO patients (id,user_id,username,full_name,phone,active) VALUES ($1,$2,$3,$4,$5,TRUE)",
    [mixedLegacyPatientId, mixedLegacyUserId, mixedLegacyUsername, "Mixed Legacy Test Patient", "000000098"]
  );
  const mixedLegacyLogin = await request("/api/login", {
    method: "POST",
    body: { username: mixedLegacyUsername, password: legacyPassword }
  });
  expectStatus(mixedLegacyLogin, 200, "Legacy combined password hash remains valid when password_salt is also populated");
  assert.ok(mixedLegacyLogin.data.token, "Mixed legacy login should return an access token");


  // Inject a patient-profile insert failure and verify registration rolls back the users row.
  const rollbackUsername = `rollback_patient_${suffix}`;
  await pool.query(`
    CREATE OR REPLACE FUNCTION test_fail_selected_patient_insert() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.username LIKE 'rollback_patient_%' THEN
        RAISE EXCEPTION 'injected patient insert failure';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await pool.query(`
    CREATE TRIGGER test_fail_selected_patient_insert_trigger
    BEFORE INSERT ON patients
    FOR EACH ROW EXECUTE FUNCTION test_fail_selected_patient_insert()
  `);
  try {
    const failedRegistration = await request("/api/patient/register", {
      method: "POST",
      body: {
        username: rollbackUsername,
        full_name: "Rollback Test Patient",
        phone: "000000097",
        whatsapp_phone: "000000096",
        password: "RollbackPass123"
      }
    });
    expectStatus(failedRegistration, 500, "Injected patient-profile failure should fail registration");
    const orphanUsers = await pool.query("SELECT id FROM users WHERE username=$1", [rollbackUsername]);
    const orphanPatients = await pool.query("SELECT id FROM patients WHERE username=$1", [rollbackUsername]);
    assert.equal(orphanUsers.rowCount, 0, "Failed registration must not leave an orphaned users row");
    assert.equal(orphanPatients.rowCount, 0, "Failed registration must not leave a patient profile");
  } finally {
    await pool.query("DROP TRIGGER IF EXISTS test_fail_selected_patient_insert_trigger ON patients");
    await pool.query("DROP FUNCTION IF EXISTS test_fail_selected_patient_insert()");
  }

  // Exercise the public booking endpoint with two different patients racing for the same doctor slot.
  const patientAUsername = `race_patient_a_${suffix}`;
  const patientBUsername = `race_patient_b_${suffix}`;
  const patientAResult = await request("/api/patient/register", {
    method: "POST",
    body: {
      username: patientAUsername,
      full_name: "Concurrency Test Patient A",
      phone: `0000001${suffix.slice(0, 2)}`,
      whatsapp_phone: `0000002${suffix.slice(0, 2)}`,
      sms_notifications_consent: true,
      whatsapp_notifications_consent: true,
      password: "RacePatientPass123"
    }
  });
  expectStatus(patientAResult, 200, "Register patient A for concurrency test");
  const patientALogin = await request("/api/login", {
    method: "POST",
    body: { username: patientAUsername, password: "RacePatientPass123" }
  });
  expectStatus(patientALogin, 200, "Newly registered patient can log in using the stored password salt");
  assert.ok(patientALogin.data.token, "Patient login should return an access token");

  const patientBResult = await request("/api/patient/register", {
    method: "POST",
    body: {
      username: patientBUsername,
      full_name: "Concurrency Test Patient B",
      phone: `0000003${suffix.slice(0, 2)}`,
      whatsapp_phone: `0000004${suffix.slice(0, 2)}`,
      sms_notifications_consent: true,
      whatsapp_notifications_consent: true,
      password: "RacePatientPass123"
    }
  });
  expectStatus(patientBResult, 200, "Register patient B for concurrency test");

  const concurrentBookings = await Promise.all([
    request("/api/appointments", {
      token: patientALogin.data.token,
      method: "POST",
      body: { service_id: serviceId, doctor_id: doctorA.id, appointment_date: date, appointment_time: "11:00" }
    }),
    request("/api/appointments", {
      token: patientBResult.data.token,
      method: "POST",
      body: { service_id: serviceId, doctor_id: doctorA.id, appointment_date: date, appointment_time: "11:00" }
    })
  ]);
  assert.equal(
    concurrentBookings.filter(result => result.status === 200).length,
    1,
    `Exactly one concurrent booking should win: ${JSON.stringify(concurrentBookings)}`
  );
  assert.equal(
    concurrentBookings.filter(result => result.status === 409).length,
    1,
    `The competing booking should receive HTTP 409: ${JSON.stringify(concurrentBookings)}`
  );
  const raceSlotRows = await pool.query(
    "SELECT COUNT(*)::int AS count FROM appointments WHERE doctor_id=$1 AND appointment_date=$2::date AND appointment_time=$3::time AND status IN ('pending','confirmed')",
    [doctorA.id, date, "11:00"]
  );
  assert.equal(raceSlotRows.rows[0].count, 1, "Concurrent requests must not create duplicate active appointments for the same doctor slot");
  const winningAppointment = await pool.query(
    "SELECT id,patient_id FROM appointments WHERE doctor_id=$1 AND appointment_date=$2::date AND appointment_time=$3::time AND status='pending' LIMIT 1",
    [doctorA.id, date, "11:00"]
  );
  assert.equal(winningAppointment.rowCount, 1, "The winning booking should be persisted for notification checks");
  const queuedNotifications = await pool.query(
    "SELECT event_type,channel,recipient_role,recipient_phone,status,scheduled_at,payload FROM notification_outbox WHERE appointment_id=$1",
    [winningAppointment.rows[0].id]
  );
  const patientBookedSms = queuedNotifications.rows.find(row =>
    row.event_type === "booked" && row.channel === "sms" && row.recipient_role === "patient"
  );
  const patientBookedWhatsApp = queuedNotifications.rows.find(row =>
    row.event_type === "booked" && row.channel === "whatsapp" && row.recipient_role === "patient"
  );
  assert.ok(patientBookedSms, "Booking should queue an SMS notification for the patient");
  assert.ok(patientBookedWhatsApp, "Booking should queue a WhatsApp notification for the patient");
  assert.equal(patientBookedSms.status, "pending", "New booking SMS should remain queued until a worker sends it");

  const doctorBookedSms = queuedNotifications.rows.find(row =>
    row.event_type === "booked" && row.channel === "sms" && row.recipient_role === "doctor"
  );
  const secretaryBookedSms = queuedNotifications.rows.find(row =>
    row.event_type === "booked" && row.channel === "sms" && row.recipient_role === "secretary" &&
    row.payload && row.payload.doctor_name === "Test Doctor A"
  );
  assert.ok(doctorBookedSms, "Booking should queue an SMS notification for the booked doctor");
  assert.equal(doctorBookedSms.payload.doctor_name, "Test Doctor A", "Doctor notification should identify the booked doctor");
  assert.ok(secretaryBookedSms, "Booking should queue an SMS notification for the active secretary assigned to the booked doctor");
  assert.equal(secretaryBookedSms.recipient_phone, "+249900000201", "Secretary notification should use the active secretary's contact number");
  assert.equal(
    queuedNotifications.rows.some(row => row.recipient_phone === "+249900000301"),
    false,
    "Disabled secretaries must not receive queued notifications"
  );
  assert.equal(
    queuedNotifications.rows.some(row => row.recipient_phone === "+249900000102"),
    false,
    "A different doctor's contact number must not receive this appointment's notification"
  );
  const patientReminderSms = queuedNotifications.rows.find(row =>
    row.event_type === "reminder_24h" && row.channel === "sms" && row.recipient_role === "patient"
  );
  const patientReminderWhatsApp = queuedNotifications.rows.find(row =>
    row.event_type === "reminder_24h" && row.channel === "whatsapp" && row.recipient_role === "patient"
  );
  assert.ok(patientReminderSms, "Future booking should queue a 24-hour SMS reminder");
  assert.ok(patientReminderWhatsApp, "Future booking should queue a 24-hour WhatsApp reminder");
  assert.ok(new Date(patientReminderSms.scheduled_at).getTime() > Date.now(), "24-hour reminder should be scheduled in the future");
  assert.equal(patientReminderSms.payload.appointment_date, date, "Reminder payload should preserve the appointment date");

  // Patients who leave both notification consent boxes unchecked must not get
  // patient-directed messages queued, while booking itself remains available.
  const optOutUsername = `optout_patient_${suffix}`;
  const optOutRegistration = await request("/api/patient/register", {
    method: "POST",
    body: {
      username: optOutUsername,
      full_name: "Opt-out Test Patient",
      phone: `0000005${suffix.slice(0, 2)}`,
      whatsapp_phone: `0000006${suffix.slice(0, 2)}`,
      password: "OptOutPatientPass123"
    }
  });
  expectStatus(optOutRegistration, 200, "Register patient without notification consent");
  const optOutBooking = await request("/api/appointments", {
    token: optOutRegistration.data.token,
    method: "POST",
    body: { service_id: serviceId, doctor_id: doctorA.id, appointment_date: date, appointment_time: "11:30" }
  });
  expectStatus(optOutBooking, 200, "Patient can book without opting into notifications");
  const optOutAppointment = await pool.query(
    "SELECT id FROM appointments WHERE patient_id=(SELECT id FROM patients WHERE username=$1) AND doctor_id=$2 AND appointment_date=$3::date AND appointment_time=$4::time LIMIT 1",
    [optOutUsername, doctorA.id, date, "11:30"]
  );
  assert.equal(optOutAppointment.rowCount, 1, "Opt-out patient's appointment should be saved");
  const optOutQueued = await pool.query(
    "SELECT channel,recipient_role FROM notification_outbox WHERE appointment_id=$1",
    [optOutAppointment.rows[0].id]
  );
  assert.equal(
    optOutQueued.rows.some(row => row.recipient_role === "patient" && ["sms", "whatsapp"].includes(row.channel)),
    false,
    "An opt-out patient must not receive SMS or WhatsApp notifications queued"
  );
  assert.ok(
    optOutQueued.rows.some(row => row.recipient_role === "doctor"),
    "Opting out of patient notifications must not suppress the doctor's booking alert"
  );

  const disableSchedule = await request(`/api/doctor/schedules/${scheduleForDate.data.schedule.id}/status`, {
    token: doctorAUser.token, method: "PATCH", body: { active: false }
  });
  expectStatus(disableSchedule, 200, "Doctor can disable a schedule");

  const disabledScheduleReschedule = await request(`/api/doctor/appointments/${appointmentAId}`, {
    token: doctorAUser.token, method: "PATCH",
    body: { appointment_date: date, appointment_time: "11:00" }
  });
  expectStatus(disabledScheduleReschedule, 409, "Appointment cannot be moved into disabled schedule");

  const disableDoctor = await request(`/api/admin/doctors/${doctorA.id}/status`, {
    token: admin.token, method: "PATCH", body: { active: false }
  });
  expectStatus(disableDoctor, 200, "Admin can disable doctor A");

  const disabledDoctorLogin = await request("/api/staff/login", {
    method: "POST", body: { username: `doc_a_${suffix}`, password: "TestDoctorPass123" }
  });
  expectStatus(disabledDoctorLogin, 403, "Disabled doctor cannot log in");

  const disabledSecretaryLoginAfterDoctorDisable = await request("/api/staff/login", {
    method: "POST", body: { username: `sec_a_${suffix}`, password: "TestSecretaryPass123" }
  });
  expectStatus(disabledSecretaryLoginAfterDoctorDisable, 403, "Secretary cannot log in when linked doctor is disabled");

  const disabledDoctorExistingSession = await request("/api/doctor/appointments", { token: doctorAUser.token });
  expectStatus(disabledDoctorExistingSession, 403, "Existing doctor session loses access when doctor is disabled");

  const disabledSecretaryExistingSession = await request("/api/doctor/appointments", { token: secretary.token });
  expectStatus(disabledSecretaryExistingSession, 403, "Existing secretary session loses access when linked doctor is disabled");

  const doctorBStillActive = await request("/api/doctor/appointments", { token: doctorBUser.token });
  expectStatus(doctorBStillActive, 200, "Disabling doctor A does not affect doctor B");

  const adminCannotUseDoctorAppointments = await request("/api/doctor/appointments", { token: admin.token });
  expectStatus(adminCannotUseDoctorAppointments, 403, "Admin token is not accepted as doctor portal token");

  const unauthenticated = await request("/api/doctor/appointments");
  expectStatus(unauthenticated, 403, "Unauthenticated request is rejected by doctor portal guard");

  const statusAfterDeniedEdit = await pool.query("SELECT status FROM appointments WHERE id=$1", [appointmentBId]);
  assert.equal(statusAfterDeniedEdit.rows[0].status, "pending", "Denied cross-doctor update must not change database row");

  console.log("Integration checks passed: role boundaries, doctor-scoped appointments, schedule permissions, secretary permissions.");
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

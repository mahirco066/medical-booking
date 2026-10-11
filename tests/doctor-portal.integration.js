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

  const serviceResult = await pool.query("SELECT id FROM services WHERE active=TRUE ORDER BY name LIMIT 1");
  const serviceId = serviceResult.rows[0]?.id || null;
  const appointmentAId = crypto.randomUUID();
  const appointmentBId = crypto.randomUUID();
  const date = "2099-01-15";

  await pool.query(
    "INSERT INTO appointments (id,doctor_id,service_id,patient_name,patient_phone,appointment_date,appointment_time,status) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending'),($8,$9,$3,$10,$11,$6,$12,'pending')",
    [appointmentAId, doctorA.id, serviceId, "Patient A", "000000001", date, "09:00",
     appointmentBId, doctorB.id, "Patient B", "000000002", "10:00"]
  );

  const listA = await request("/api/doctor/appointments", { token: doctorAUser.token });
  expectStatus(listA, 200, "Doctor A appointments list");
  assert.deepEqual(listA.data.appointments.map(a => a.id), [appointmentAId], "Doctor A must only see their own appointment");

  const listB = await request("/api/doctor/appointments", { token: doctorBUser.token });
  expectStatus(listB, 200, "Doctor B appointments list");
  assert.deepEqual(listB.data.appointments.map(a => a.id), [appointmentBId], "Doctor B must only see their own appointment");

  const listSecretary = await request("/api/doctor/appointments", { token: secretary.token });
  expectStatus(listSecretary, 200, "Secretary appointments list");
  assert.deepEqual(listSecretary.data.appointments.map(a => a.id), [appointmentAId], "Secretary must only see their doctor's appointments");

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

  const secretaryCreatesSecretary = await request("/api/doctor/secretaries", {
    token: secretary.token, method: "POST",
    body: { full_name: "Forbidden Secretary", username: `forbidden_${suffix}`, password: "ForbiddenPass123" }
  });
  expectStatus(secretaryCreatesSecretary, 403, "Secretary cannot create another secretary");

  const scheduleCreated = await request("/api/doctor/schedules", {
    token: doctorAUser.token, method: "POST",
    body: { day_of_week: 2, start_time: "09:00", end_time: "12:00", slot_duration_minutes: 30 }
  });
  expectStatus(scheduleCreated, 200, "Doctor can create own schedule");

  const disableDoctor = await request(`/api/admin/doctors/${doctorA.id}/status`, {
    token: admin.token, method: "PATCH", body: { active: false }
  });
  expectStatus(disableDoctor, 200, "Admin can disable doctor A");

  const disabledDoctorLogin = await request("/api/staff/login", {
    method: "POST", body: { username: `doc_a_${suffix}`, password: "TestDoctorPass123" }
  });
  expectStatus(disabledDoctorLogin, 403, "Disabled doctor cannot log in");

  const disabledSecretaryLogin = await request("/api/staff/login", {
    method: "POST", body: { username: `sec_a_${suffix}`, password: "TestSecretaryPass123" }
  });
  expectStatus(disabledSecretaryLogin, 403, "Secretary cannot log in when linked doctor is disabled");

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

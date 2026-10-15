const { test, expect } = require("@playwright/test");
const crypto = require("node:crypto");

const baseURL = process.env.TEST_BASE_URL || "http://127.0.0.1:18080";
const adminUsername = process.env.ADMIN_USERNAME || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "admin123";

async function apiRequest(request, route, { token, method = "GET", body } = {}) {
  const response = await request.fetch(new URL(route, baseURL).toString(), {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { data: body } : {})
  });
  const data = await response.json().catch(() => ({}));
  expect(response.ok(), `${method} ${route}: ${response.status()} ${JSON.stringify(data)}`).toBeTruthy();
  return data;
}

test("doctor and secretary see only the UI features allowed for their role", async ({ page, request }) => {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
  const admin = await apiRequest(request, "/api/staff/login", {
    method: "POST",
    body: { username: adminUsername, password: adminPassword }
  });
  expect(admin.token).toBeTruthy();

  const doctorResult = await apiRequest(request, "/api/admin/doctors", {
    token: admin.token,
    method: "POST",
    body: {
      full_name: `Browser Test Doctor ${suffix}`,
      specialty: "General",
      area: "Browser Test"
    }
  });
  const doctor = doctorResult.doctor;
  expect(doctor && doctor.id).toBeTruthy();

  const doctorUsername = `browser_doc_${suffix}`;
  const doctorPassword = "BrowserDoctorPass123";
  await apiRequest(request, `/api/admin/doctors/${doctor.id}/account`, {
    token: admin.token,
    method: "POST",
    body: { username: doctorUsername, password: doctorPassword, full_name: doctor.full_name }
  });

  await page.goto(new URL("/doctor.html", baseURL).toString());
  await expect(page.locator("#loginScreen")).toBeVisible();
  await page.locator("#username").fill(doctorUsername);
  await page.locator("#password").fill(doctorPassword);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await expect(page.locator("#appScreen")).toBeVisible();
  await expect(page.locator("#welcomeTitle")).toContainText(doctor.full_name);
  await expect(page.locator("#schedulesTab")).toBeVisible();
  await expect(page.locator("#secretariesTab")).toBeVisible();
  await expect(page.locator("#appointmentsBody")).toBeVisible();

  await page.locator("#schedulesTab").click();
  await page.locator("#scheduleDay").selectOption("2");
  await page.locator("#scheduleStart").fill("09:00");
  await page.locator("#scheduleEnd").fill("12:00");
  await page.locator("#scheduleDuration").selectOption("30");
  await page.getByRole("button", { name: "حفظ الدوام" }).click();
  await expect(page.locator("#schedulesList")).toContainText("09:00", { timeout: 10000 });

  await page.locator("#secretariesTab").click();
  const secretaryUsername = `browser_sec_${suffix}`;
  await page.locator("#secretaryName").fill("Browser Test Secretary");
  await page.locator("#secretaryPhone").fill("0000000099");
  await page.locator("#secretaryWhatsappPhone").fill("0000000098");
  await page.locator("#secretaryUsername").fill(secretaryUsername);
  await page.locator("#secretaryPassword").fill("BrowserSecretaryPass123");
  await page.getByRole("button", { name: "إنشاء حساب السكرتير" }).click();
  // Fail with the actual form/API feedback rather than only timing out on the refreshed list.
  await expect(page.locator("#toast")).toContainText("تم إنشاء حساب السكرتير.", { timeout: 10000 });
  await expect(page.locator("#secretariesList")).toContainText(secretaryUsername, { timeout: 10000 });

  await page.locator("#logoutBtn").click();
  await expect(page.locator("#loginScreen")).toBeVisible();

  await page.locator("#username").fill(secretaryUsername);
  await page.locator("#password").fill("BrowserSecretaryPass123");
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await expect(page.locator("#appScreen")).toBeVisible();
  await expect(page.locator("#roleBadge")).toContainText("حساب السكرتير");
  await expect(page.locator("#schedulesTab")).toBeHidden();
  await expect(page.locator("#secretariesTab")).toBeHidden();
  await expect(page.locator("#appointmentsBody")).toBeVisible();
});


test("patient can review and approve a rescheduled confirmed appointment in the browser", async ({ page, request }) => {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: /127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL || "") ? false : { rejectUnauthorized: false } });
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
  const username = `approval_patient_${suffix}`;
  const password = "ApprovalPatientPass123";
  let appointmentId;

  try {
    const admin = await apiRequest(request, "/api/staff/login", {
      method: "POST",
      body: { username: adminUsername, password: adminPassword }
    });

    const doctorResult = await apiRequest(request, "/api/admin/doctors", {
      token: admin.token,
      method: "POST",
      body: { full_name: `Approval Browser Doctor ${suffix}`, specialty: "General", area: "Browser Test" }
    });
    const doctor = doctorResult.doctor;
    expect(doctor && doctor.id).toBeTruthy();

    const registration = await apiRequest(request, "/api/patient/register", {
      method: "POST",
      body: {
        username,
        full_name: "Approval Browser Patient",
        phone: "0000000101",
        whatsapp_phone: "0000000102",
        password
      }
    });
    expect(registration.patient && registration.patient.id).toBeTruthy();

    const servicesResult = await apiRequest(request, "/api/services");
    const services = Array.isArray(servicesResult) ? servicesResult : servicesResult.services;
    expect(services && services.length, "at least one service should be seeded").toBeTruthy();
    const service = services[0];

    appointmentId = crypto.randomUUID();
    const appointmentDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await pool.query(
      `INSERT INTO appointments
        (id, patient_id, doctor_id, service_id, patient_name, patient_phone, appointment_date, appointment_time, status, reschedule_approval_required)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'confirmed', TRUE)`,
      [appointmentId, registration.patient.id, doctor.id, service.id, registration.patient.full_name, registration.patient.phone, appointmentDate, "10:30"]
    );

    await page.goto(new URL("/", baseURL).toString());
    await page.getByRole("button", { name: "تسجيل الدخول" }).click();
    await page.locator("#loginUsername").fill(username);
    await page.locator("#loginPassword").fill(password);
    await page.getByRole("button", { name: "تسجيل الدخول" }).last().click();

    await expect(page.getByRole("button", { name: "مواعيدي" })).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "مواعيدي" }).click();
    const appointmentsModal = page.locator("#appointmentsModal");
    await expect(appointmentsModal).toContainText("بانتظار موافقتك على الوقت الجديد");
    await expect(appointmentsModal.getByRole("button", { name: "أوافق على الوقت الجديد" })).toBeVisible();
    await expect(appointmentsModal.getByRole("button", { name: "الوقت لا يناسبني — أراجع العيادة" })).toBeVisible();

    await appointmentsModal.getByRole("button", { name: "أوافق على الوقت الجديد" }).click();
    await expect(page.locator("#appointmentsModal")).not.toContainText("بانتظار موافقتك على الوقت الجديد", { timeout: 10000 });
    await expect(page.locator("#appointmentsModal")).toContainText("مؤكد");
    const saved = await pool.query("SELECT status, reschedule_approval_required FROM appointments WHERE id=$1", [appointmentId]);
    expect(saved.rows[0]).toMatchObject({ status: "confirmed", reschedule_approval_required: false });
  } finally {
    if (appointmentId) {
      await pool.query("DELETE FROM appointments WHERE id=$1", [appointmentId]).catch(() => {});
    }
    await pool.query("DELETE FROM users WHERE username=$1", [username]).catch(() => {});
    await pool.end();
  }
});

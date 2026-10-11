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
  await page.locator("#secretaryUsername").fill(secretaryUsername);
  await page.locator("#secretaryPassword").fill("BrowserSecretaryPass123");
  await page.getByRole("button", { name: "إنشاء حساب السكرتير" }).click();
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

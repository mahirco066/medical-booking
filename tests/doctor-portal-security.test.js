const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const dashboard = fs.readFileSync(path.join(root, "public/dashboard.html"), "utf8");
const portal = fs.readFileSync(path.join(root, "public/doctor.html"), "utf8");

function sectionBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing section marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing section end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("auth lookup returns staff role and linked doctor id, and rejects inactive staff", () => {
  const auth = sectionBetween(server, "async function getAuthUser(req)", "async function requireAuth");
  assert.match(auth, /su\.doctor_id AS staff_doctor_id/);
  assert.match(auth, /if \(!row\.staff_active\) return null/);
  assert.match(auth, /role: row\.staff_role/);
  assert.match(auth, /doctor_id: row\.staff_doctor_id \|\| null/);
});

test("admin and doctor portal middleware enforce separate roles", () => {
  const adminGuard = sectionBetween(server, "async function requireAdmin", "async function requireDoctorOrSecretary");
  const staffGuard = sectionBetween(server, "async function requireDoctorOrSecretary", "/* =========================================================\n   HEALTH");
  assert.match(adminGuard, /user\.role !== "admin"/);
  assert.match(staffGuard, /\["doctor", "secretary"\]\.includes\(user\.role\)/);
  assert.match(staffGuard, /!user\.doctor_id/);
  assert.match(staffGuard, /user\.role !== "doctor"/);
});

test("appointment list and updates are scoped to the authenticated doctor's id", () => {
  const routes = sectionBetween(server, 'app.get("/api/doctor/appointments"', "app.get(\"/api/doctor/schedules\"");
  assert.match(routes, /a\.doctor_id=\$1/);
  assert.match(routes, /WHERE id=\$3 AND doctor_id=\$4/);
  assert.match(routes, /req\.authUser\.doctor_id/);
});

test("schedule management and secretary account routes require doctor-only middleware", () => {
  const schedules = sectionBetween(server, 'app.get("/api/doctor/schedules"', 'app.get("/api/doctor/secretaries"');
  const secretaries = sectionBetween(server, 'app.get("/api/doctor/secretaries"', "/* ADMIN APPOINTMENTS */");
  assert.match(schedules, /requireDoctor/);
  assert.match(schedules, /doctor_id=\$1/);
  assert.match(secretaries, /requireDoctor/);
  assert.match(secretaries, /doctor_id=\$1/);
  assert.match(secretaries, /role='secretary'/);
  assert.match(secretaries, /doctor_id=\$3 AND role='secretary'/);
});

test("duplicate usernames for doctor and secretary account creation return conflict responses", () => {
  const doctorAccount = sectionBetween(server, 'app.post("/api/admin/doctors/:id/account"', 'app.put("/api/admin/doctors/:id"');
  const secretaryRoutes = sectionBetween(server, 'app.post("/api/doctor/secretaries"', "/* ADMIN APPOINTMENTS */");
  assert.match(doctorAccount, /error\.code === "23505"/);
  assert.match(doctorAccount, /409/);
  assert.match(secretaryRoutes, /e\.code==="23505"/);
  assert.match(secretaryRoutes, /409/);
});

test("frontend routes doctor and secretary logins to the portal and admin to dashboard", () => {
  assert.match(dashboard, /user\.role==="doctor" \|\| user\.role==="secretary"/);
  assert.match(dashboard, /window\.location\.href="\/doctor\.html"/);
  assert.match(portal, /api\("\/staff\/login"/);
  assert.match(portal, /if\(d\.user\?\.role==="admin"\)\{location\.href="\/dashboard\.html"/);
});

test("secretary interface hides doctor-only tabs", () => {
  assert.match(portal, /const isDoctor=profile\.role==="doctor"/);
  assert.match(portal, /classList\.toggle\("hidden",!isDoctor\)/);
  assert.match(portal, /name==="schedules"\|\|name==="secretaries"/);
});

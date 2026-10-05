const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = Number(process.env.PORT || 10000);
const DATABASE_URL = process.env.DATABASE_URL;
const PUBLIC_DIR = path.join(__dirname, "public");

if (!DATABASE_URL) {
  console.error("DATABASE_URL is missing.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static(PUBLIC_DIR));

/* =========================================================
   HELPERS
========================================================= */

function makeId() {
  return crypto.randomUUID();
}

function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function clean(value) {
  return typeof value === "string" ? value.trim() : value;
}

function normalizeUsername(value) {
  return clean(value || "").toLowerCase();
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function validTime(value) {
  return /^\d{2}:\d{2}$/.test(String(value || ""));
}

function jsonOk(res, data = {}) {
  return res.json({ ok: true, ...data });
}

function jsonError(res, status, message) {
  return res.status(status).json({ ok: false, error: message });
}

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(String(password), salt, 64, (error, derivedKey) => {
      if (error) return reject(error);
      resolve(salt + ":" + derivedKey.toString("hex"));
    });
  });
}

function verifyPassword(password, stored) {
  return new Promise((resolve, reject) => {
    try {
      const parts = String(stored || "").split(":");
      if (parts.length !== 2) return resolve(false);

      const salt = parts[0];
      const expected = Buffer.from(parts[1], "hex");

      crypto.scrypt(String(password), salt, 64, (error, derivedKey) => {
        if (error) return reject(error);
        if (expected.length !== derivedKey.length) return resolve(false);
        resolve(crypto.timingSafeEqual(expected, derivedKey));
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function columnExists(table, column) {
  const result = await pool.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = $1
          AND column_name = $2
      ) AS exists
    `,
    [table, column]
  );
  return Boolean(result.rows[0] && result.rows[0].exists);
}

async function addColumnIfMissing(table, column, definition) {
  const exists = await columnExists(table, column);
  if (exists) return;

  const sql =
    'ALTER TABLE "' +
    table +
    '" ADD COLUMN "' +
    column +
    '" ' +
    definition;

  await pool.query(sql);
}

/* =========================================================
   DATABASE INITIALIZATION
========================================================= */

async function initDatabase() {
  console.log("Initializing Neon database...");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'patient',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS patients (
      id UUID PRIMARY KEY,
      user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      full_name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      date_of_birth DATE,
      gender TEXT,
      address TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_users (
      id UUID PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL DEFAULT 'موظف',
      role TEXT NOT NULL DEFAULT 'staff',
      phone TEXT,
      email TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS services (
      id UUID PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      duration_minutes INTEGER NOT NULL DEFAULT 30,
      price NUMERIC(12,2) NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS doctors (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      full_name TEXT NOT NULL,
      specialty TEXT NOT NULL,
      area TEXT,
      phone TEXT,
      email TEXT,
      bio TEXT,
      image_url TEXT,
      rating NUMERIC(3,1) NOT NULL DEFAULT 5.0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id UUID PRIMARY KEY,
      patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
      doctor_id UUID REFERENCES doctors(id) ON DELETE SET NULL,
      service_id UUID REFERENCES services(id) ON DELETE SET NULL,
      patient_name TEXT,
      patient_phone TEXT,
      appointment_date DATE NOT NULL,
      appointment_time TIME NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      notes TEXT,
      cancellation_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS doctor_schedules (
      id UUID PRIMARY KEY,
      doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
      day_of_week INTEGER NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      slot_duration_minutes INTEGER NOT NULL DEFAULT 30,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT doctor_schedule_day_check CHECK (day_of_week >= 0 AND day_of_week <= 6),
      CONSTRAINT doctor_schedule_time_check CHECK (start_time < end_time),
      CONSTRAINT doctor_schedule_duration_check CHECK (slot_duration_minutes > 0)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS medical_records (
      id UUID PRIMARY KEY,
      patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
      doctor_id UUID REFERENCES doctors(id) ON DELETE SET NULL,
      appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
      diagnosis TEXT,
      treatment TEXT,
      prescription TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ads (
      id UUID PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      image_url TEXT,
      target_url TEXT,
      advertiser_name TEXT,
      category TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_impressions (
      id UUID PRIMARY KEY,
      ad_id UUID REFERENCES ads(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_clicks (
      id UUID PRIMARY KEY,
      ad_id UUID REFERENCES ads(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY,
      access_token_hash TEXT,
      refresh_token_hash TEXT,
      token_hash TEXT,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      staff_user_id UUID REFERENCES staff_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const compatibilityColumns = [
    ["users", "password_hash", "TEXT"],
    ["users", "username", "TEXT"],
    ["users", "password_hash", "TEXT"],
    ["users", "full_name", "TEXT"],
    ["users", "role", "TEXT NOT NULL DEFAULT 'patient'"],
    ["users", "active", "BOOLEAN NOT NULL DEFAULT TRUE"],
    ["users", "phone", "TEXT"],
    ["users", "email", "TEXT"],
    ["users", "created_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()"],
    ["users", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()"],

    ["patients", "user_id", "UUID"],
    ["patients", "phone", "TEXT"],
    ["patients", "email", "TEXT"],
    ["patients", "date_of_birth", "DATE"],
    ["patients", "gender", "TEXT"],
    ["patients", "address", "TEXT"],
    ["patients", "active", "BOOLEAN NOT NULL DEFAULT TRUE"],
    ["patients", "created_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()"],
    ["patients", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()"],

    ["staff_users", "password_hash", "TEXT"],
    ["staff_users", "full_name", "TEXT NOT NULL DEFAULT 'موظف'"],
    ["staff_users", "role", "TEXT NOT NULL DEFAULT 'staff'"],
    ["staff_users", "phone", "TEXT"],
    ["staff_users", "email", "TEXT"],
    ["staff_users", "active", "BOOLEAN NOT NULL DEFAULT TRUE"],
    ["staff_users", "created_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()"],
    ["staff_users", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()"],

    ["services", "description", "TEXT"],
    ["services", "duration_minutes", "INTEGER NOT NULL DEFAULT 30"],
    ["services", "price", "NUMERIC(12,2) NOT NULL DEFAULT 0"],
    ["services", "active", "BOOLEAN NOT NULL DEFAULT TRUE"],
    ["services", "created_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()"],
    ["services", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()"],

    ["doctors", "user_id", "UUID"],
    ["doctors", "full_name", "TEXT"],
    ["doctors", "specialty", "TEXT"],
    ["doctors", "area", "TEXT"],
    ["doctors", "phone", "TEXT"],
    ["doctors", "email", "TEXT"],
    ["doctors", "bio", "TEXT"],
    ["doctors", "image_url", "TEXT"],
    ["doctors", "rating", "NUMERIC(3,1) NOT NULL DEFAULT 5.0"],
    ["doctors", "active", "BOOLEAN NOT NULL DEFAULT TRUE"],
    ["doctors", "created_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()"],
    ["doctors", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()"],

    ["appointments", "patient_id", "UUID"],
    ["appointments", "doctor_id", "UUID"],
    ["appointments", "service_id", "UUID"],
    ["appointments", "patient_name", "TEXT"],
    ["appointments", "patient_phone", "TEXT"],
    ["appointments", "appointment_date", "DATE"],
    ["appointments", "appointment_time", "TIME"],
    ["appointments", "status", "TEXT NOT NULL DEFAULT 'pending'"],
    ["appointments", "notes", "TEXT"],
    ["appointments", "cancellation_reason", "TEXT"],
    ["appointments", "created_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()"],
    ["appointments", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()"],

    ["doctor_schedules", "doctor_id", "UUID"],
    ["doctor_schedules", "day_of_week", "INTEGER"],
    ["doctor_schedules", "start_time", "TIME"],
    ["doctor_schedules", "end_time", "TIME"],
    ["doctor_schedules", "slot_duration_minutes", "INTEGER NOT NULL DEFAULT 30"],
    ["doctor_schedules", "active", "BOOLEAN NOT NULL DEFAULT TRUE"],
    ["doctor_schedules", "created_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()"],
    ["doctor_schedules", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()"],

    ["medical_records", "patient_id", "UUID"],
    ["medical_records", "doctor_id", "UUID"],
    ["medical_records", "appointment_id", "UUID"],
    ["medical_records", "diagnosis", "TEXT"],
    ["medical_records", "treatment", "TEXT"],
    ["medical_records", "prescription", "TEXT"],
    ["medical_records", "notes", "TEXT"],
    ["medical_records", "created_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()"],
    ["medical_records", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()"],

    ["ads", "title", "TEXT"],
    ["ads", "description", "TEXT"],
    ["ads", "image_url", "TEXT"],
    ["ads", "target_url", "TEXT"],
    ["ads", "advertiser_name", "TEXT"],
    ["ads", "category", "TEXT"],
    ["ads", "active", "BOOLEAN NOT NULL DEFAULT TRUE"],
    ["ads", "starts_at", "TIMESTAMPTZ"],
    ["ads", "ends_at", "TIMESTAMPTZ"],
    ["ads", "created_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()"],
    ["ads", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()"],

    ["sessions", "access_token_hash", "TEXT"],
    ["sessions", "refresh_token_hash", "TEXT"],
    ["sessions", "token_hash", "TEXT"],
    ["sessions", "user_id", "UUID"],
    ["sessions", "staff_user_id", "UUID"],
    ["sessions", "expires_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()"],
    ["sessions", "created_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()"]
  ];

  for (const item of compatibilityColumns) {
    await addColumnIfMissing(item[0], item[1], item[2]);
  }

  /* Legacy sessions compatibility.
     Old project schemas may have required user_id or token_hash.
     Current sessions may belong to a patient OR a staff user. */
  await pool.query(
    "ALTER TABLE sessions ALTER COLUMN user_id DROP NOT NULL"
  );

  await pool.query(
    "ALTER TABLE sessions ALTER COLUMN staff_user_id DROP NOT NULL"
  );

  await pool.query(
    "ALTER TABLE sessions ALTER COLUMN token_hash DROP NOT NULL"
  );

  console.log("Database tables and compatibility columns are ready.");
}

async function createIndexes() {
  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)",
    "CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)",
    "CREATE INDEX IF NOT EXISTS idx_patients_user_id ON patients(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone)",
    "CREATE INDEX IF NOT EXISTS idx_staff_users_username ON staff_users(username)",
    "CREATE INDEX IF NOT EXISTS idx_staff_users_role ON staff_users(role)",
    "CREATE INDEX IF NOT EXISTS idx_services_active ON services(active)",
    "CREATE INDEX IF NOT EXISTS idx_doctors_active ON doctors(active)",
    "CREATE INDEX IF NOT EXISTS idx_doctors_specialty ON doctors(specialty)",
    "CREATE INDEX IF NOT EXISTS idx_doctors_area ON doctors(area)",
    "CREATE INDEX IF NOT EXISTS idx_appointments_patient_id ON appointments(patient_id)",
    "CREATE INDEX IF NOT EXISTS idx_appointments_doctor_id ON appointments(doctor_id)",
    "CREATE INDEX IF NOT EXISTS idx_appointments_service_id ON appointments(service_id)",
    "CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date)",
    "CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status)",
    "CREATE INDEX IF NOT EXISTS idx_medical_records_patient_id ON medical_records(patient_id)",
    "CREATE INDEX IF NOT EXISTS idx_medical_records_doctor_id ON medical_records(doctor_id)",
    "CREATE INDEX IF NOT EXISTS idx_ads_active ON ads(active)",
    "CREATE INDEX IF NOT EXISTS idx_ad_impressions_ad_id ON ad_impressions(ad_id)",
    "CREATE INDEX IF NOT EXISTS idx_ad_clicks_ad_id ON ad_clicks(ad_id)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_access_token_hash ON sessions(access_token_hash)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_refresh_token_hash ON sessions(refresh_token_hash)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_staff_user_id ON sessions(staff_user_id)"
  ];

  for (const sql of indexes) {
    await pool.query(sql);
  }

  console.log("Database indexes ready.");
}

async function seedServices() {
  const services = [
    ["كشف عام", "كشف واستشارة طبية عامة", 30, 0],
    ["متابعة الحمل", "متابعة الحمل والفحوصات الدورية", 30, 0],
    ["سونار", "فحص بالموجات فوق الصوتية", 30, 0],
    ["كشف نساء", "فحص واستشارة في أمراض النساء", 30, 0],
    ["طب الأطفال", "كشف واستشارة للأطفال", 30, 0],
    ["الباطنية", "كشف واستشارة في الأمراض الباطنية", 30, 0],
    ["طب القلب", "كشف واستشارة أمراض القلب", 30, 0]
  ];

  for (const service of services) {
    const exists = await pool.query(
      "SELECT id FROM services WHERE name=$1 LIMIT 1",
      [service[0]]
    );

    if (!exists.rowCount) {
      await pool.query(
        "INSERT INTO services (id,name,description,duration_minutes,price,active) VALUES ($1,$2,$3,$4,$5,TRUE)",
        [makeId(), service[0], service[1], service[2], service[3]]
      );
    }
  }

  console.log("Default services ready.");
}

async function seedAdmin() {
  const username = normalizeUsername(
    process.env.ADMIN_USERNAME || "admin"
  );
  const password = process.env.ADMIN_PASSWORD || "admin123";
  const fullName = process.env.ADMIN_NAME || "مدير منصة موعدي";
  const passwordHash = await hashPassword(password);

  const existing = await pool.query(
    "SELECT id FROM staff_users WHERE username=$1 LIMIT 1",
    [username]
  );

  if (existing.rowCount) {
    await pool.query(
      "UPDATE staff_users SET password_hash=$1,full_name=$2,role='admin',active=TRUE,updated_at=NOW() WHERE username=$3",
      [passwordHash, fullName, username]
    );
  } else {
    await pool.query(
      "INSERT INTO staff_users (id,username,password_hash,full_name,role,active) VALUES ($1,$2,$3,$4,'admin',TRUE)",
      [makeId(), username, passwordHash, fullName]
    );
  }

  console.log("Admin account ready.");
}

async function createSession(staffUserId, userId, days) {
  const accessToken = randomToken();
  const refreshToken = randomToken();
  const accessHash = hashToken(accessToken);
  const refreshHash = hashToken(refreshToken);

  await pool.query(
    "INSERT INTO sessions (id,access_token_hash,refresh_token_hash,token_hash,user_id,staff_user_id,expires_at) VALUES ($1,$2,$3,$4,$5,$6,NOW() + ($7 * INTERVAL '1 day'))",
    [
      makeId(),
      accessHash,
      refreshHash,
      accessHash,
      userId || null,
      staffUserId || null,
      days
    ]
  );

  return {
    accessToken,
    refreshToken
  };
}

async function getAuthUser(req) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  const token = header.substring(7).trim();
  if (!token) return null;

  const result = await pool.query(
    "SELECT s.id AS session_id,s.expires_at,s.staff_user_id,s.user_id,su.username AS staff_username,su.full_name AS staff_full_name,su.role AS staff_role,su.active AS staff_active,u.username AS user_username,u.full_name AS user_full_name,u.phone AS user_phone,u.email AS user_email,u.role AS user_role,u.active AS user_active FROM sessions s LEFT JOIN staff_users su ON su.id=s.staff_user_id LEFT JOIN users u ON u.id=s.user_id WHERE s.access_token_hash=$1 AND s.expires_at>NOW() LIMIT 1",
    [hashToken(token)]
  );

  if (!result.rowCount) return null;

  const row = result.rows[0];

  if (row.staff_user_id) {
    if (!row.staff_active) return null;

    return {
      type: "staff",
      session_id: row.session_id,
      id: row.staff_user_id,
      username: row.staff_username,
      full_name: row.staff_full_name,
      role: row.staff_role
    };
  }

  if (row.user_id) {
    if (!row.user_active) return null;

    return {
      type: "patient",
      session_id: row.session_id,
      id: row.user_id,
      username: row.user_username,
      full_name: row.user_full_name,
      phone: row.user_phone,
      email: row.user_email,
      role: row.user_role
    };
  }

  return null;
}

async function requireAuth(req, res, next) {
  try {
    const user = await getAuthUser(req);

    if (!user) {
      return jsonError(res, 401, "يجب تسجيل الدخول أولاً.");
    }

    req.authUser = user;
    next();
  } catch (error) {
    console.error("Authentication error:", error);
    return jsonError(res, 500, "حدث خطأ أثناء التحقق من تسجيل الدخول.");
  }
}

async function requireAdmin(req, res, next) {
  try {
    const user = await getAuthUser(req);

    if (!user || user.type !== "staff" || user.role !== "admin") {
      return jsonError(res, 403, "صلاحية المدير مطلوبة.");
    }

    req.authUser = user;
    next();
  } catch (error) {
    console.error("Admin authentication error:", error);
    return jsonError(res, 500, "حدث خطأ أثناء التحقق من صلاحيات المدير.");
  }
}

/* =========================================================
   HEALTH
========================================================= */

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT NOW()");

    return jsonOk(res, {
      database: "neon",
      postgres: true,
      supabase: false,
      cms: true,
      features: {
        homepage: true,
        services: true,
        appointments: true,
        patients: true,
        doctors: true,
        dashboard: true,
        medicalRecords: true,
        ads: true,
        uploads: true
      }
    });
  } catch (error) {
    console.error("Health error:", error);
    return jsonError(res, 500, "قاعدة البيانات غير متاحة.");
  }
});

/* =========================================================
   PATIENT AUTH
========================================================= */

app.post("/api/register", async (req, res) => {
  try {
    const username = normalizeUsername(req.body.username);
    const fullName = clean(req.body.full_name);
    const phone = clean(req.body.phone);
    const email = clean(req.body.email) || null;
    const password = String(req.body.password || "");

    if (!username) return jsonError(res, 400, "اسم المستخدم مطلوب.");
    if (!fullName) return jsonError(res, 400, "الاسم الكامل مطلوب.");
    if (!phone) return jsonError(res, 400, "رقم الهاتف مطلوب.");
    if (password.length < 6) return jsonError(res, 400, "كلمة المرور يجب ألا تقل عن 6 أحرف.");

    const existing = await pool.query(
      "SELECT id FROM users WHERE username=$1 LIMIT 1",
      [username]
    );

    if (existing.rowCount) {
      return jsonError(res, 409, "اسم المستخدم مستخدم بالفعل.");
    }

    const userId = makeId();
    const patientId = makeId();
    const passwordHash = await hashPassword(password);

    await pool.query(
      "INSERT INTO users (id,username,password_hash,full_name,phone,email,role,active) VALUES ($1,$2,$3,$4,$5,$6,'patient',TRUE)",
      [userId, username, passwordHash, fullName, phone, email]
    );

    await pool.query(
      "INSERT INTO patients (id,user_id,full_name,phone,email,active) VALUES ($1,$2,$3,$4,$5,TRUE)",
      [patientId, userId, fullName, phone, email]
    );

    const tokens = await createSession(null, userId, 30);

    return jsonOk(res, {
      message: "تم إنشاء حساب المريض بنجاح.",
      token: tokens.accessToken,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      user: {
        id: userId,
        username,
        full_name: fullName,
        phone,
        email,
        role: "patient"
      },
      patient: {
        id: patientId,
        user_id: userId,
        full_name: fullName,
        phone,
        email
      }
    });
  } catch (error) {
    console.error("Registration error:", error);
    if (error.code === "23505") {
      return jsonError(res, 409, "اسم المستخدم مستخدم بالفعل.");
    }
    return jsonError(res, 500, "تعذر إنشاء الحساب.");
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || "");

    if (!username || !password) {
      return jsonError(res, 400, "اسم المستخدم وكلمة المرور مطلوبان.");
    }

    const result = await pool.query(
      "SELECT id,username,password_hash,full_name,phone,email,role,active FROM users WHERE username=$1 LIMIT 1",
      [username]
    );

    if (!result.rowCount) {
      return jsonError(res, 401, "اسم المستخدم أو كلمة المرور غير صحيحة.");
    }

    const user = result.rows[0];

    if (!user.active) {
      return jsonError(res, 403, "هذا الحساب غير مفعل.");
    }

    const passwordValid = await verifyPassword(password, user.password_hash);

    if (!passwordValid) {
      return jsonError(res, 401, "اسم المستخدم أو كلمة المرور غير صحيحة.");
    }

    const patient = await pool.query(
      "SELECT id,full_name,phone,email,date_of_birth,gender,address,active FROM patients WHERE user_id=$1 LIMIT 1",
      [user.id]
    );

    const tokens = await createSession(null, user.id, 30);

    return jsonOk(res, {
      message: "تم تسجيل الدخول بنجاح.",
      token: tokens.accessToken,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        phone: user.phone,
        email: user.email,
        role: user.role
      },
      patient: patient.rowCount ? patient.rows[0] : null
    });
  } catch (error) {
    console.error("Patient login error:", error);
    return jsonError(res, 500, "تعذر تسجيل الدخول.");
  }
});

app.post("/api/staff/login", async (req, res) => {
  try {
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || "");

    if (!username || !password) {
      return jsonError(res, 400, "اسم المستخدم وكلمة المرور مطلوبان.");
    }

    const result = await pool.query(
      "SELECT id,username,password_hash,full_name,role,phone,email,active FROM staff_users WHERE username=$1 LIMIT 1",
      [username]
    );

    if (!result.rowCount) {
      return jsonError(res, 401, "بيانات الدخول غير صحيحة.");
    }

    const staff = result.rows[0];

    if (!staff.active) {
      return jsonError(res, 403, "هذا الحساب غير مفعل.");
    }

    const passwordValid = await verifyPassword(password, staff.password_hash);

    if (!passwordValid) {
      return jsonError(res, 401, "بيانات الدخول غير صحيحة.");
    }

    const tokens = await createSession(staff.id, null, 7);

    return jsonOk(res, {
      message: "تم تسجيل الدخول إلى لوحة الإدارة.",
      token: tokens.accessToken,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      user: {
        id: staff.id,
        username: staff.username,
        full_name: staff.full_name,
        role: staff.role,
        phone: staff.phone,
        email: staff.email
      }
    });
  } catch (error) {
    console.error("Staff login error:", error);
    return jsonError(res, 500, "تعذر تسجيل الدخول إلى لوحة الإدارة.");
  }
});

app.post("/api/logout", requireAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM sessions WHERE id=$1", [req.authUser.session_id]);
    return jsonOk(res, { message: "تم تسجيل الخروج." });
  } catch (error) {
    return jsonError(res, 500, "تعذر تسجيل الخروج.");
  }
});

/* =========================================================
   PUBLIC SERVICES AND DOCTORS
========================================================= */

app.get("/api/services", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id,name,description,duration_minutes,price,active FROM services WHERE active=TRUE ORDER BY name ASC"
    );
    return jsonOk(res, { services: result.rows });
  } catch (error) {
    console.error("Services error:", error);
    return jsonError(res, 500, "تعذر تحميل الخدمات.");
  }
});

app.get("/api/doctors", async (req, res) => {
  try {
    const specialty = clean(req.query.specialty || "");
    const area = clean(req.query.area || "");
    const search = clean(req.query.search || "");
    const conditions = ["d.active=TRUE"];
    const values = [];
    let n = 1;

    if (specialty) {
      conditions.push("d.specialty ILIKE $" + n);
      values.push("%" + specialty + "%");
      n++;
    }

    if (area) {
      conditions.push("COALESCE(d.area,'') ILIKE $" + n);
      values.push("%" + area + "%");
      n++;
    }

    if (search) {
      conditions.push(
        "(d.full_name ILIKE $" + n + " OR d.specialty ILIKE $" + n + " OR COALESCE(d.area,'') ILIKE $" + n + ")"
      );
      values.push("%" + search + "%");
      n++;
    }

    const result = await pool.query(
      "SELECT id,full_name,specialty,area,phone,email,bio,image_url,rating,active FROM doctors d WHERE " +
      conditions.join(" AND ") +
      " ORDER BY rating DESC,full_name ASC",
      values
    );

    return jsonOk(res, { doctors: result.rows });
  } catch (error) {
    console.error("Doctors error:", error);
    return jsonError(res, 500, "تعذر تحميل قائمة الأطباء.");
  }
});

app.get("/api/doctors/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id,full_name,specialty,area,phone,email,bio,image_url,rating,active FROM doctors WHERE id=$1 AND active=TRUE LIMIT 1",
      [req.params.id]
    );

    if (!result.rowCount) {
      return jsonError(res, 404, "الطبيب غير موجود.");
    }

    return jsonOk(res, { doctor: result.rows[0] });
  } catch (error) {
    return jsonError(res, 500, "تعذر تحميل بيانات الطبيب.");
  }
});


/* =========================================================
   DOCTOR SCHEDULE HELPERS
========================================================= */

function getDayOfWeek(dateString) {
  const [y, m, d] = String(dateString).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCDay();
}

function timeToMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

async function getDoctorSchedules(doctorId, dayOfWeek) {
  const params = [doctorId];
  let sql = "SELECT id,doctor_id,day_of_week,start_time,end_time,slot_duration_minutes,active,created_at,updated_at FROM doctor_schedules WHERE doctor_id=$1";
  if (dayOfWeek !== undefined && dayOfWeek !== null) { sql += " AND day_of_week=$2"; params.push(dayOfWeek); }
  sql += " ORDER BY day_of_week,start_time";
  const result = await pool.query(sql, params);
  return result.rows;
}

async function getBookedTimes(doctorId, dateString) {
  const result = await pool.query(
    "SELECT appointment_time FROM appointments WHERE doctor_id=$1 AND appointment_date=$2 AND status IN ('pending','confirmed')",
    [doctorId, dateString]
  );
  return result.rows.map(r => String(r.appointment_time).slice(0,5));
}

function generateAvailableSlots(schedules, bookedTimes) {
  const booked = new Set(bookedTimes || []);
  const slots = [];
  for (const schedule of schedules || []) {
    const start = timeToMinutes(schedule.start_time);
    const end = timeToMinutes(schedule.end_time);
    const duration = Number(schedule.slot_duration_minutes || 30);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(duration) || duration <= 0 || start >= end) continue;
    for (let t = start; t + duration <= end; t += duration) {
      const time = minutesToTime(t);
      slots.push({ time, available: !booked.has(time), schedule_id: schedule.id });
    }
  }
  return slots;
}

async function isAppointmentTimeAvailable(doctorId, dateString, timeString) {
  const day = getDayOfWeek(dateString);
  const schedules = await getDoctorSchedules(doctorId, day);
  if (!schedules.length) return { available: false, reason: "الطبيب لا يعمل في هذا اليوم." };
  const target = timeToMinutes(timeString);
  const matching = schedules.some(s => {
    const start = timeToMinutes(s.start_time); const end = timeToMinutes(s.end_time);
    const duration = Number(s.slot_duration_minutes || 30);
    return target >= start && target + duration <= end && (target - start) % duration === 0;
  });
  if (!matching) return { available: false, reason: "الوقت المختار خارج مواعيد دوام الطبيب." };
  const booked = await getBookedTimes(doctorId, dateString);
  if (booked.includes(String(timeString).slice(0,5))) return { available: false, reason: "هذا الموعد محجوز بالفعل للطبيب." };
  return { available: true };
}

/* =========================================================
   APPOINTMENTS
========================================================= */

app.post("/api/appointments", requireAuth, async (req, res) => {
  try {
    if (req.authUser.type !== "patient") {
      return jsonError(res, 403, "هذا المسار مخصص للمرضى.");
    }

    const patientResult = await pool.query(
      "SELECT id,full_name,phone FROM patients WHERE user_id=$1 AND active=TRUE LIMIT 1",
      [req.authUser.id]
    );

    if (!patientResult.rowCount) {
      return jsonError(res, 404, "لم يتم العثور على ملف المريض.");
    }

    const patient = patientResult.rows[0];
    const serviceId = clean(req.body.service_id);
    const doctorId = clean(req.body.doctor_id);
    const appointmentDate = clean(req.body.appointment_date);
    const appointmentTime = clean(req.body.appointment_time);
    const notes = clean(req.body.notes) || null;

    if (!serviceId) return jsonError(res, 400, "يجب اختيار الخدمة.");
    if (!doctorId) return jsonError(res, 400, "يجب اختيار الطبيب.");
    if (!validDate(appointmentDate)) return jsonError(res, 400, "تاريخ الموعد غير صحيح.");
    if (!validTime(appointmentTime)) return jsonError(res, 400, "وقت الموعد غير صحيح.");

    const service = await pool.query(
      "SELECT id,name,duration_minutes,price FROM services WHERE id=$1 AND active=TRUE LIMIT 1",
      [serviceId]
    );

    if (!service.rowCount) {
      return jsonError(res, 404, "الخدمة غير موجودة أو غير متاحة.");
    }

    const doctor = await pool.query(
      "SELECT id,full_name,specialty FROM doctors WHERE id=$1 AND active=TRUE LIMIT 1",
      [doctorId]
    );

    if (!doctor.rowCount) {
      return jsonError(res, 404, "الطبيب غير موجود أو غير متاح.");
    }

    const doctorConflict = await pool.query(
      "SELECT id FROM appointments WHERE doctor_id=$1 AND appointment_date=$2 AND appointment_time=$3 AND status IN ('pending','confirmed') LIMIT 1",
      [doctorId, appointmentDate, appointmentTime]
    );

    if (doctorConflict.rowCount) {
      return jsonError(res, 409, "هذا الموعد محجوز بالفعل للطبيب.");
    }

    const patientConflict = await pool.query(
      "SELECT id FROM appointments WHERE patient_id=$1 AND appointment_date=$2 AND appointment_time=$3 AND status IN ('pending','confirmed') LIMIT 1",
      [patient.id, appointmentDate, appointmentTime]
    );

    if (patientConflict.rowCount) {
      return jsonError(res, 409, "لديك موعد آخر في نفس التاريخ والوقت.");
    }

    const result = await pool.query(
      "INSERT INTO appointments (id,patient_id,doctor_id,service_id,patient_name,patient_phone,appointment_date,appointment_time,status,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9) RETURNING *",
      [
        makeId(),
        patient.id,
        doctorId,
        serviceId,
        patient.full_name,
        patient.phone,
        appointmentDate,
        appointmentTime,
        notes
      ]
    );

    return jsonOk(res, {
      message: "تم إرسال طلب الحجز بنجاح.",
      appointment: result.rows[0]
    });
  } catch (error) {
    console.error("Create appointment error:", error);
    return jsonError(res, 500, "تعذر إنشاء الموعد.");
  }
});

app.get("/api/my-appointments", requireAuth, async (req, res) => {
  try {
    if (req.authUser.type !== "patient") {
      return jsonError(res, 403, "هذا المسار مخصص للمرضى.");
    }

    const result = await pool.query(
      "SELECT a.id,a.patient_id,a.doctor_id,a.service_id,a.patient_name,a.patient_phone,a.appointment_date,a.appointment_time,a.status,a.notes,a.cancellation_reason,a.created_at,a.updated_at,d.full_name AS doctor_name,d.specialty,s.name AS service_name,s.price FROM appointments a LEFT JOIN doctors d ON d.id=a.doctor_id LEFT JOIN services s ON s.id=a.service_id JOIN patients p ON p.id=a.patient_id WHERE p.user_id=$1 ORDER BY a.appointment_date DESC,a.appointment_time DESC",
      [req.authUser.id]
    );

    return jsonOk(res, { appointments: result.rows });
  } catch (error) {
    console.error("My appointments error:", error);
    return jsonError(res, 500, "تعذر تحميل مواعيدك.");
  }
});

app.patch("/api/my-appointments/:id/cancel", requireAuth, async (req, res) => {
  try {
    if (req.authUser.type !== "patient") {
      return jsonError(res, 403, "هذا المسار مخصص للمرضى.");
    }

    const reason = clean(req.body.reason || req.body.cancellation_reason) || null;
    const result = await pool.query(
      "UPDATE appointments a SET status='cancelled',cancellation_reason=$1,updated_at=NOW() FROM patients p WHERE a.id=$2 AND a.patient_id=p.id AND p.user_id=$3 AND a.status IN ('pending','confirmed') RETURNING a.*",
      [reason, req.params.id, req.authUser.id]
    );

    if (!result.rowCount) {
      return jsonError(res, 404, "الموعد غير موجود أو لا يمكن إلغاؤه.");
    }

    return jsonOk(res, {
      message: "تم إلغاء الموعد.",
      appointment: result.rows[0]
    });
  } catch (error) {
    return jsonError(res, 500, "تعذر إلغاء الموعد.");
  }
});

/* =========================================================
   PATIENT PROFILE
========================================================= */

app.get("/api/my-profile", requireAuth, async (req, res) => {
  try {
    if (req.authUser.type !== "patient") {
      return jsonError(res, 403, "هذا المسار مخصص للمرضى.");
    }

    const result = await pool.query(
      "SELECT u.id,u.username,u.full_name,u.phone,u.email,u.role,u.active,p.id AS patient_id,p.date_of_birth,p.gender,p.address FROM users u LEFT JOIN patients p ON p.user_id=u.id WHERE u.id=$1 LIMIT 1",
      [req.authUser.id]
    );

    return jsonOk(res, { profile: result.rows[0] || null });
  } catch (error) {
    return jsonError(res, 500, "تعذر تحميل الملف الشخصي.");
  }
});

app.put("/api/my-profile", requireAuth, async (req, res) => {
  try {
    if (req.authUser.type !== "patient") {
      return jsonError(res, 403, "هذا المسار مخصص للمرضى.");
    }

    const fullName = clean(req.body.full_name);
    const phone = clean(req.body.phone);
    const email = clean(req.body.email) || null;
    const dob = clean(req.body.date_of_birth) || null;
    const gender = clean(req.body.gender) || null;
    const address = clean(req.body.address) || null;

    if (!fullName) {
      return jsonError(res, 400, "الاسم الكامل مطلوب.");
    }

    await pool.query(
      "UPDATE users SET full_name=$1,phone=$2,email=$3,updated_at=NOW() WHERE id=$4",
      [fullName, phone, email, req.authUser.id]
    );

    await pool.query(
      "UPDATE patients SET full_name=$1,phone=$2,email=$3,date_of_birth=$4,gender=$5,address=$6,updated_at=NOW() WHERE user_id=$7",
      [fullName, phone, email, dob, gender, address, req.authUser.id]
    );

    return jsonOk(res, { message: "تم تحديث الملف الشخصي." });
  } catch (error) {
    console.error("Profile update error:", error);
    return jsonError(res, 500, "تعذر تحديث الملف الشخصي.");
  }
});

/* =========================================================
   ADS
========================================================= */

app.get("/api/ads", async (req, res) => {
  try {
    const category = clean(req.query.category || "");
    const values = [];
    let where =
      "active=TRUE AND (starts_at IS NULL OR starts_at<=NOW()) AND (ends_at IS NULL OR ends_at>=NOW())";

    if (category) {
      values.push(category);
      where += " AND category=$1";
    }

    const result = await pool.query(
      "SELECT id,title,description,image_url,target_url,advertiser_name,category,starts_at,ends_at FROM ads WHERE " +
      where +
      " ORDER BY created_at DESC",
      values
    );

    return jsonOk(res, { ads: result.rows });
  } catch (error) {
    return jsonError(res, 500, "تعذر تحميل الإعلانات.");
  }
});

app.post("/api/ads/:id/impression", async (req, res) => {
  try {
    const ad = await pool.query(
      "SELECT id FROM ads WHERE id=$1 AND active=TRUE LIMIT 1",
      [req.params.id]
    );

    if (!ad.rowCount) return jsonError(res, 404, "الإعلان غير موجود.");

    await pool.query(
      "INSERT INTO ad_impressions (id,ad_id) VALUES ($1,$2)",
      [makeId(), req.params.id]
    );

    return jsonOk(res, { message: "تم تسجيل مشاهدة الإعلان." });
  } catch (error) {
    return jsonError(res, 500, "تعذر تسجيل مشاهدة الإعلان.");
  }
});

app.post("/api/ads/:id/click", async (req, res) => {
  try {
    const ad = await pool.query(
      "SELECT id,target_url FROM ads WHERE id=$1 AND active=TRUE LIMIT 1",
      [req.params.id]
    );

    if (!ad.rowCount) return jsonError(res, 404, "الإعلان غير موجود.");

    await pool.query(
      "INSERT INTO ad_clicks (id,ad_id) VALUES ($1,$2)",
      [makeId(), req.params.id]
    );

    return jsonOk(res, { target_url: ad.rows[0].target_url || null });
  } catch (error) {
    return jsonError(res, 500, "تعذر تسجيل النقر على الإعلان.");
  }
});

/* =========================================================
   ADMIN
========================================================= */

app.get("/api/admin/me", requireAdmin, async (req, res) => {
  return jsonOk(res, { user: req.authUser });
});

app.get("/api/staff/me", requireAdmin, async (req, res) => {
  return jsonOk(res, { user: req.authUser });
});

/* ADMIN DOCTORS */

app.get("/api/admin/doctors", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id,full_name,specialty,area,phone,email,bio,image_url,rating,active,created_at,updated_at FROM doctors ORDER BY created_at DESC"
    );
    return jsonOk(res, { doctors: result.rows });
  } catch (error) {
    console.error("Admin doctors list error:", error);
    return jsonError(res, 500, "تعذر تحميل الأطباء.");
  }
});

app.post("/api/admin/doctors", requireAdmin, async (req, res) => {
  try {
    const fullName = clean(req.body.full_name);
    const specialty = clean(req.body.specialty);
    const area = clean(req.body.area) || null;
    const phone = clean(req.body.phone) || null;
    const email = clean(req.body.email) || null;
    const bio = clean(req.body.bio) || null;
    const imageUrl = clean(req.body.image_url) || null;
    const rating = Number(req.body.rating || 5);
    const active = req.body.active === false ? false : true;

    if (!fullName) return jsonError(res, 400, "اسم الطبيب مطلوب.");
    if (!specialty) return jsonError(res, 400, "التخصص مطلوب.");

    const result = await pool.query(
      "INSERT INTO doctors (id,full_name,specialty,area,phone,email,bio,image_url,rating,active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
      [makeId(), fullName, specialty, area, phone, email, bio, imageUrl, Number.isFinite(rating) ? rating : 5, active]
    );

    return jsonOk(res, { message: "تمت إضافة الطبيب بنجاح.", doctor: result.rows[0] });
  } catch (error) {
    console.error("Admin create doctor error:", error);
    return jsonError(res, 500, "تعذر إضافة الطبيب.");
  }
});

app.put("/api/admin/doctors/:id", requireAdmin, async (req, res) => {
  try {
    const fullName = clean(req.body.full_name);
    const specialty = clean(req.body.specialty);
    const area = clean(req.body.area) || null;
    const phone = clean(req.body.phone) || null;
    const email = clean(req.body.email) || null;
    const bio = clean(req.body.bio) || null;
    const imageUrl = clean(req.body.image_url) || null;
    const rating = Number(req.body.rating || 5);
    const active = req.body.active === false ? false : true;

    if (!fullName || !specialty) {
      return jsonError(res, 400, "اسم الطبيب والتخصص مطلوبان.");
    }

    const result = await pool.query(
      "UPDATE doctors SET full_name=$1,specialty=$2,area=$3,phone=$4,email=$5,bio=$6,image_url=$7,rating=$8,active=$9,updated_at=NOW() WHERE id=$10 RETURNING *",
      [fullName, specialty, area, phone, email, bio, imageUrl, Number.isFinite(rating) ? rating : 5, active, req.params.id]
    );

    if (!result.rowCount) return jsonError(res, 404, "الطبيب غير موجود.");
    return jsonOk(res, { message: "تم تحديث بيانات الطبيب.", doctor: result.rows[0] });
  } catch (error) {
    console.error("Admin update doctor error:", error);
    return jsonError(res, 500, "تعذر تحديث الطبيب.");
  }
});

app.patch("/api/admin/doctors/:id/status", requireAdmin, async (req, res) => {
  try {
    const active = req.body.active === true;
    const result = await pool.query(
      "UPDATE doctors SET active=$1,updated_at=NOW() WHERE id=$2 RETURNING *",
      [active, req.params.id]
    );

    if (!result.rowCount) return jsonError(res, 404, "الطبيب غير موجود.");
    return jsonOk(res, { message: active ? "تم تفعيل الطبيب." : "تم إيقاف الطبيب.", doctor: result.rows[0] });
  } catch (error) {
    return jsonError(res, 500, "تعذر تغيير حالة الطبيب.");
  }
});

app.delete("/api/admin/doctors/:id", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM doctors WHERE id=$1 RETURNING id",
      [req.params.id]
    );

    if (!result.rowCount) return jsonError(res, 404, "الطبيب غير موجود.");
    return jsonOk(res, { message: "تم حذف الطبيب." });
  } catch (error) {
    console.error("Admin delete doctor error:", error);
    return jsonError(res, 500, "تعذر حذف الطبيب.");
  }
});


/* ADMIN DOCTOR SCHEDULES */

app.get("/api/admin/doctors/:id/schedules", requireAdmin, async (req, res) => {
  try {
    const doctor = await pool.query(
      "SELECT id,full_name,specialty,active FROM doctors WHERE id=$1 LIMIT 1",
      [req.params.id]
    );

    if (!doctor.rowCount) {
      return jsonError(res, 404, "الطبيب غير موجود.");
    }

    const result = await pool.query(
      "SELECT id,doctor_id,day_of_week,start_time,end_time,slot_duration_minutes,active,created_at,updated_at FROM doctor_schedules WHERE doctor_id=$1 ORDER BY day_of_week,start_time",
      [req.params.id]
    );

    return jsonOk(res, {
      doctor: doctor.rows[0],
      schedules: result.rows
    });
  } catch (error) {
    console.error("Admin doctor schedules list error:", error);
    return jsonError(res, 500, "تعذر تحميل مواعيد الطبيب.");
  }
});

app.post("/api/admin/doctors/:id/schedules", requireAdmin, async (req, res) => {
  try {
    const doctorId = req.params.id;
    const dayOfWeek = Number(req.body.day_of_week);
    const startTime = clean(req.body.start_time);
    const endTime = clean(req.body.end_time);
    const duration = Number(req.body.slot_duration_minutes || 30);
    const active = req.body.active === false ? false : true;

    const doctor = await pool.query(
      "SELECT id,full_name,specialty FROM doctors WHERE id=$1 LIMIT 1",
      [doctorId]
    );

    if (!doctor.rowCount) {
      return jsonError(res, 404, "الطبيب غير موجود.");
    }

    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return jsonError(res, 400, "يوم الأسبوع غير صحيح.");
    }

    if (!validTime(startTime) || !validTime(endTime)) {
      return jsonError(res, 400, "وقت بداية أو نهاية الدوام غير صحيح.");
    }

    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);

    if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || startMinutes >= endMinutes) {
      return jsonError(res, 400, "يجب أن يكون وقت البداية قبل وقت النهاية.");
    }

    if (!Number.isInteger(duration) || duration <= 0) {
      return jsonError(res, 400, "مدة الموعد غير صحيحة.");
    }

    const duplicate = await pool.query(
      "SELECT id FROM doctor_schedules WHERE doctor_id=$1 AND day_of_week=$2 AND start_time=$3 AND end_time=$4 LIMIT 1",
      [doctorId, dayOfWeek, startTime, endTime]
    );

    if (duplicate.rowCount) {
      return jsonError(res, 409, "هذا الدوام موجود بالفعل للطبيب.");
    }

    const overlap = await pool.query(
      "SELECT id FROM doctor_schedules WHERE doctor_id=$1 AND day_of_week=$2 AND start_time < $4 AND end_time > $3 LIMIT 1",
      [doctorId, dayOfWeek, startTime, endTime]
    );

    if (overlap.rowCount) {
      return jsonError(res, 409, "يوجد دوام آخر متداخل مع هذا الوقت في نفس اليوم.");
    }

    const result = await pool.query(
      "INSERT INTO doctor_schedules (id,doctor_id,day_of_week,start_time,end_time,slot_duration_minutes,active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [makeId(), doctorId, dayOfWeek, startTime, endTime, duration, active]
    );

    return jsonOk(res, {
      message: "تم حفظ دوام الطبيب بنجاح.",
      schedule: result.rows[0]
    });
  } catch (error) {
    console.error("Admin create doctor schedule error:", error);

    if (error.code === "23505") {
      return jsonError(res, 409, "هذا الدوام موجود بالفعل.");
    }

    if (error.code === "23514") {
      return jsonError(res, 400, "بيانات الدوام غير صحيحة.");
    }

    return jsonError(res, 500, "تعذر حفظ دوام الطبيب.");
  }
});

app.put("/api/admin/doctor-schedules/:id", requireAdmin, async (req, res) => {
  try {
    const scheduleId = req.params.id;
    const dayOfWeek = Number(req.body.day_of_week);
    const startTime = clean(req.body.start_time);
    const endTime = clean(req.body.end_time);
    const duration = Number(req.body.slot_duration_minutes || 30);
    const active = req.body.active === false ? false : true;

    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return jsonError(res, 400, "يوم الأسبوع غير صحيح.");
    }

    if (!validTime(startTime) || !validTime(endTime)) {
      return jsonError(res, 400, "وقت بداية أو نهاية الدوام غير صحيح.");
    }

    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);

    if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || startMinutes >= endMinutes) {
      return jsonError(res, 400, "يجب أن يكون وقت البداية قبل وقت النهاية.");
    }

    if (!Number.isInteger(duration) || duration <= 0) {
      return jsonError(res, 400, "مدة الموعد غير صحيحة.");
    }

    const existing = await pool.query(
      "SELECT id,doctor_id FROM doctor_schedules WHERE id=$1 LIMIT 1",
      [scheduleId]
    );

    if (!existing.rowCount) {
      return jsonError(res, 404, "الدوام غير موجود.");
    }

    const doctorId = existing.rows[0].doctor_id;

    const overlap = await pool.query(
      "SELECT id FROM doctor_schedules WHERE doctor_id=$1 AND day_of_week=$2 AND id<>$3 AND start_time < $5 AND end_time > $4 LIMIT 1",
      [doctorId, dayOfWeek, scheduleId, startTime, endTime]
    );

    if (overlap.rowCount) {
      return jsonError(res, 409, "يوجد دوام آخر متداخل مع هذا الوقت في نفس اليوم.");
    }

    const result = await pool.query(
      "UPDATE doctor_schedules SET day_of_week=$1,start_time=$2,end_time=$3,slot_duration_minutes=$4,active=$5,updated_at=NOW() WHERE id=$6 RETURNING *",
      [dayOfWeek, startTime, endTime, duration, active, scheduleId]
    );

    return jsonOk(res, {
      message: "تم تحديث دوام الطبيب.",
      schedule: result.rows[0]
    });
  } catch (error) {
    console.error("Admin update doctor schedule error:", error);

    if (error.code === "23514") {
      return jsonError(res, 400, "بيانات الدوام غير صحيحة.");
    }

    return jsonError(res, 500, "تعذر تحديث دوام الطبيب.");
  }
});

app.patch("/api/admin/doctor-schedules/:id/status", requireAdmin, async (req, res) => {
  try {
    const active = req.body.active === true;

    const result = await pool.query(
      "UPDATE doctor_schedules SET active=$1,updated_at=NOW() WHERE id=$2 RETURNING *",
      [active, req.params.id]
    );

    if (!result.rowCount) {
      return jsonError(res, 404, "الدوام غير موجود.");
    }

    return jsonOk(res, {
      message: active ? "تم تفعيل الدوام." : "تم إيقاف الدوام.",
      schedule: result.rows[0]
    });
  } catch (error) {
    console.error("Admin doctor schedule status error:", error);
    return jsonError(res, 500, "تعذر تغيير حالة الدوام.");
  }
});

app.delete("/api/admin/doctor-schedules/:id", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM doctor_schedules WHERE id=$1 RETURNING id",
      [req.params.id]
    );

    if (!result.rowCount) {
      return jsonError(res, 404, "الدوام غير موجود.");
    }

    return jsonOk(res, {
      message: "تم حذف دوام الطبيب."
    });
  } catch (error) {
    console.error("Admin delete doctor schedule error:", error);
    return jsonError(res, 500, "تعذر حذف دوام الطبيب.");
  }
});

/* ADMIN SERVICES */

app.get("/api/admin/services", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id,name,description,duration_minutes,price,active,created_at,updated_at FROM services ORDER BY created_at DESC"
    );
    return jsonOk(res, { services: result.rows });
  } catch (error) {
    return jsonError(res, 500, "تعذر تحميل الخدمات.");
  }
});

app.post("/api/admin/services", requireAdmin, async (req, res) => {
  try {
    const name = clean(req.body.name);
    const description = clean(req.body.description) || null;
    const duration = Number(req.body.duration_minutes || 30);
    const price = Number(req.body.price || 0);
    const active = req.body.active === false ? false : true;

    if (!name) return jsonError(res, 400, "اسم الخدمة مطلوب.");

    const result = await pool.query(
      "INSERT INTO services (id,name,description,duration_minutes,price,active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [makeId(), name, description, Number.isFinite(duration) ? duration : 30, Number.isFinite(price) ? price : 0, active]
    );

    return jsonOk(res, { message: "تمت إضافة الخدمة.", service: result.rows[0] });
  } catch (error) {
    if (error.code === "23505") return jsonError(res, 409, "هذه الخدمة موجودة بالفعل.");
    return jsonError(res, 500, "تعذر إضافة الخدمة.");
  }
});

app.put("/api/admin/services/:id", requireAdmin, async (req, res) => {
  try {
    const name = clean(req.body.name);
    const description = clean(req.body.description) || null;
    const duration = Number(req.body.duration_minutes || 30);
    const price = Number(req.body.price || 0);
    const active = req.body.active === false ? false : true;

    if (!name) return jsonError(res, 400, "اسم الخدمة مطلوب.");

    const result = await pool.query(
      "UPDATE services SET name=$1,description=$2,duration_minutes=$3,price=$4,active=$5,updated_at=NOW() WHERE id=$6 RETURNING *",
      [name, description, Number.isFinite(duration) ? duration : 30, Number.isFinite(price) ? price : 0, active, req.params.id]
    );

    if (!result.rowCount) return jsonError(res, 404, "الخدمة غير موجودة.");
    return jsonOk(res, { message: "تم تحديث الخدمة.", service: result.rows[0] });
  } catch (error) {
    if (error.code === "23505") return jsonError(res, 409, "اسم الخدمة مستخدم بالفعل.");
    return jsonError(res, 500, "تعذر تحديث الخدمة.");
  }
});

app.patch("/api/admin/services/:id/status", requireAdmin, async (req, res) => {
  try {
    const active = req.body.active === true;
    const result = await pool.query(
      "UPDATE services SET active=$1,updated_at=NOW() WHERE id=$2 RETURNING *",
      [active, req.params.id]
    );

    if (!result.rowCount) return jsonError(res, 404, "الخدمة غير موجودة.");
    return jsonOk(res, { message: active ? "تم تفعيل الخدمة." : "تم إيقاف الخدمة.", service: result.rows[0] });
  } catch (error) {
    return jsonError(res, 500, "تعذر تغيير حالة الخدمة.");
  }
});

app.delete("/api/admin/services/:id", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM services WHERE id=$1 RETURNING id",
      [req.params.id]
    );

    if (!result.rowCount) return jsonError(res, 404, "الخدمة غير موجودة.");
    return jsonOk(res, { message: "تم حذف الخدمة." });
  } catch (error) {
    if (error.code === "23503") return jsonError(res, 409, "لا يمكن حذف الخدمة لأنها مرتبطة بمواعيد.");
    return jsonError(res, 500, "تعذر حذف الخدمة.");
  }
});

/* ADMIN APPOINTMENTS */

app.get("/api/admin/appointments", requireAdmin, async (req, res) => {
  try {
    const status = clean(req.query.status || "");
    const date = clean(req.query.date || "");
    const values = [];
    const conditions = [];
    let index = 1;

    if (status) {
      conditions.push("a.status=$" + index);
      values.push(status);
      index++;
    }

    if (date) {
      conditions.push("a.appointment_date=$" + index);
      values.push(date);
      index++;
    }

    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

    const result = await pool.query(
      "SELECT a.id,a.patient_id,a.doctor_id,a.service_id,a.patient_name,a.patient_phone,a.appointment_date,a.appointment_time,a.status,a.notes,a.cancellation_reason,a.created_at,a.updated_at,d.full_name AS doctor_name,d.specialty,s.name AS service_name,s.price,p.email AS patient_email FROM appointments a LEFT JOIN doctors d ON d.id=a.doctor_id LEFT JOIN services s ON s.id=a.service_id LEFT JOIN patients p ON p.id=a.patient_id " +
      where +
      " ORDER BY a.appointment_date DESC,a.appointment_time DESC",
      values
    );

    return jsonOk(res, { appointments: result.rows });
  } catch (error) {
    console.error("Admin appointments error:", error);
    return jsonError(res, 500, "تعذر تحميل المواعيد.");
  }
});

app.patch("/api/admin/appointments/:id/status", requireAdmin, async (req, res) => {
  try {
    const status = clean(req.body.status);
    const allowed = ["pending", "confirmed", "completed", "cancelled", "no_show"];

    if (!allowed.includes(status)) {
      return jsonError(res, 400, "حالة الموعد غير صحيحة.");
    }

    const cancellationReason = clean(req.body.cancellation_reason) || null;

    const result = await pool.query(
      "UPDATE appointments SET status=$1,cancellation_reason=$2,updated_at=NOW() WHERE id=$3 RETURNING *",
      [status, status === "cancelled" ? cancellationReason : null, req.params.id]
    );

    if (!result.rowCount) return jsonError(res, 404, "الموعد غير موجود.");
    return jsonOk(res, { message: "تم تحديث حالة الموعد.", appointment: result.rows[0] });
  } catch (error) {
    return jsonError(res, 500, "تعذر تحديث حالة الموعد.");
  }
});

app.delete("/api/admin/appointments/:id", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM appointments WHERE id=$1 RETURNING id",
      [req.params.id]
    );

    if (!result.rowCount) return jsonError(res, 404, "الموعد غير موجود.");
    return jsonOk(res, { message: "تم حذف الموعد." });
  } catch (error) {
    return jsonError(res, 500, "تعذر حذف الموعد.");
  }
});

/* ADMIN PATIENTS */

app.get("/api/admin/patients", requireAdmin, async (req, res) => {
  try {
    const search = clean(req.query.search || "");
    const values = [];
    let where = "";

    if (search) {
      values.push("%" + search + "%");
      where =
        "WHERE p.full_name ILIKE $1 OR COALESCE(p.phone,'') ILIKE $1 OR COALESCE(p.email,'') ILIKE $1 OR COALESCE(u.username,'') ILIKE $1";
    }

    const result = await pool.query(
      "SELECT p.id,p.user_id,p.full_name,p.phone,p.email,p.date_of_birth,p.gender,p.address,p.active,p.created_at,p.updated_at,u.username,u.role AS user_role FROM patients p LEFT JOIN users u ON u.id=p.user_id " +
      where +
      " ORDER BY p.created_at DESC",
      values
    );

    return jsonOk(res, { patients: result.rows });
  } catch (error) {
    console.error("Admin patients error:", error);
    return jsonError(res, 500, "تعذر تحميل المرضى.");
  }
});

app.get("/api/admin/patients/:id", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT p.*,u.username,u.role AS user_role FROM patients p LEFT JOIN users u ON u.id=p.user_id WHERE p.id=$1 LIMIT 1",
      [req.params.id]
    );

    if (!result.rowCount) return jsonError(res, 404, "المريض غير موجود.");
    return jsonOk(res, { patient: result.rows[0] });
  } catch (error) {
    return jsonError(res, 500, "تعذر تحميل بيانات المريض.");
  }
});

app.put("/api/admin/patients/:id", requireAdmin, async (req, res) => {
  try {
    const fullName = clean(req.body.full_name);
    const phone = clean(req.body.phone) || null;
    const email = clean(req.body.email) || null;
    const dateOfBirth = clean(req.body.date_of_birth) || null;
    const gender = clean(req.body.gender) || null;
    const address = clean(req.body.address) || null;
    const active = !(req.body.active === false || req.body.active === "false");

    if (!fullName) return jsonError(res, 400, "اسم المريض مطلوب.");

    const result = await pool.query(
      "UPDATE patients SET full_name=$1,phone=$2,email=$3,date_of_birth=$4,gender=$5,address=$6,active=$7,updated_at=NOW() WHERE id=$8 RETURNING *",
      [fullName, phone, email, dateOfBirth, gender, address, active, req.params.id]
    );

    if (!result.rowCount) return jsonError(res, 404, "المريض غير موجود.");

    const patient = result.rows[0];
    if (patient.user_id) {
      await pool.query(
        "UPDATE users SET full_name=$1,phone=$2,email=$3,active=$4,updated_at=NOW() WHERE id=$5",
        [fullName, phone, email, active, patient.user_id]
      );
    }

    return jsonOk(res, { message: "تم تحديث بيانات المريض.", patient });
  } catch (error) {
    console.error("Admin update patient error:", error);
    return jsonError(res, 500, "تعذر تحديث بيانات المريض.");
  }
});

app.patch("/api/admin/patients/:id/status", requireAdmin, async (req, res) => {
  try {
    const active = !(req.body.active === false || req.body.active === "false");
    const result = await pool.query(
      "UPDATE patients SET active=$1,updated_at=NOW() WHERE id=$2 RETURNING *",
      [active, req.params.id]
    );

    if (!result.rowCount) return jsonError(res, 404, "المريض غير موجود.");

    const patient = result.rows[0];
    if (patient.user_id) {
      await pool.query(
        "UPDATE users SET active=$1,updated_at=NOW() WHERE id=$2",
        [active, patient.user_id]
      );
    }

    return jsonOk(res, { message: active ? "تم تفعيل المريض." : "تم إيقاف المريض.", patient });
  } catch (error) {
    return jsonError(res, 500, "تعذر تغيير حالة المريض.");
  }
});

/* MEDICAL RECORDS */

app.get("/api/my-medical-records", requireAuth, async (req, res) => {
  try {
    if (req.authUser.type !== "patient") {
      return jsonError(res, 403, "هذا المسار مخصص للمرضى.");
    }

    const result = await pool.query(
      "SELECT m.*,d.full_name AS doctor_name,d.specialty FROM medical_records m JOIN patients p ON p.id=m.patient_id LEFT JOIN doctors d ON d.id=m.doctor_id WHERE p.user_id=$1 ORDER BY m.created_at DESC",
      [req.authUser.id]
    );

    return jsonOk(res, { medical_records: result.rows });
  } catch (error) {
    return jsonError(res, 500, "تعذر تحميل السجلات الطبية.");
  }
});

app.get("/api/admin/medical-records", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT m.*,p.full_name AS patient_name,d.full_name AS doctor_name,a.appointment_date,a.appointment_time FROM medical_records m LEFT JOIN patients p ON p.id=m.patient_id LEFT JOIN doctors d ON d.id=m.doctor_id LEFT JOIN appointments a ON a.id=m.appointment_id ORDER BY m.created_at DESC"
    );

    return jsonOk(res, { medical_records: result.rows });
  } catch (error) {
    return jsonError(res, 500, "تعذر تحميل السجلات الطبية.");
  }
});

app.post("/api/admin/medical-records", requireAdmin, async (req, res) => {
  try {
    const patientId = clean(req.body.patient_id);
    if (!patientId) return jsonError(res, 400, "المريض مطلوب.");

    const result = await pool.query(
      "INSERT INTO medical_records (id,patient_id,doctor_id,appointment_id,diagnosis,treatment,prescription,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [
        makeId(),
        patientId,
        clean(req.body.doctor_id) || null,
        clean(req.body.appointment_id) || null,
        clean(req.body.diagnosis) || null,
        clean(req.body.treatment) || null,
        clean(req.body.prescription) || null,
        clean(req.body.notes) || null
      ]
    );

    return jsonOk(res, { message: "تمت إضافة السجل الطبي.", medical_record: result.rows[0] });
  } catch (error) {
    console.error("Create medical record error:", error);
    return jsonError(res, 500, "تعذر إضافة السجل الطبي.");
  }
});

app.put("/api/admin/medical-records/:id", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE medical_records SET patient_id=$1,doctor_id=$2,appointment_id=$3,diagnosis=$4,treatment=$5,prescription=$6,notes=$7,updated_at=NOW() WHERE id=$8 RETURNING *",
      [
        clean(req.body.patient_id),
        clean(req.body.doctor_id) || null,
        clean(req.body.appointment_id) || null,
        clean(req.body.diagnosis) || null,
        clean(req.body.treatment) || null,
        clean(req.body.prescription) || null,
        clean(req.body.notes) || null,
        req.params.id
      ]
    );

    if (!result.rowCount) return jsonError(res, 404, "السجل الطبي غير موجود.");
    return jsonOk(res, { message: "تم تحديث السجل الطبي.", medical_record: result.rows[0] });
  } catch (error) {
    return jsonError(res, 500, "تعذر تحديث السجل الطبي.");
  }
});

app.delete("/api/admin/medical-records/:id", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM medical_records WHERE id=$1 RETURNING id",
      [req.params.id]
    );

    if (!result.rowCount) return jsonError(res, 404, "السجل الطبي غير موجود.");
    return jsonOk(res, { message: "تم حذف السجل الطبي." });
  } catch (error) {
    return jsonError(res, 500, "تعذر حذف السجل الطبي.");
  }
});

/* ADMIN ADS */

app.get("/api/admin/ads", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT a.*,COALESCE((SELECT COUNT(*) FROM ad_impressions i WHERE i.ad_id=a.id),0)::int AS impressions,COALESCE((SELECT COUNT(*) FROM ad_clicks c WHERE c.ad_id=a.id),0)::int AS clicks FROM ads a ORDER BY a.created_at DESC"
    );

    return jsonOk(res, { ads: result.rows });
  } catch (error) {
    return jsonError(res, 500, "تعذر تحميل الإعلانات.");
  }
});

app.post("/api/admin/ads", requireAdmin, async (req, res) => {
  try {
    const title = clean(req.body.title);
    if (!title) return jsonError(res, 400, "عنوان الإعلان مطلوب.");

    const result = await pool.query(
      "INSERT INTO ads (id,title,description,image_url,target_url,advertiser_name,category,active,starts_at,ends_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
      [
        makeId(),
        title,
        clean(req.body.description) || null,
        clean(req.body.image_url) || null,
        clean(req.body.target_url) || null,
        clean(req.body.advertiser_name) || null,
        clean(req.body.category) || null,
        !(req.body.active === false || req.body.active === "false"),
        clean(req.body.starts_at) || null,
        clean(req.body.ends_at) || null
      ]
    );

    return jsonOk(res, { message: "تمت إضافة الإعلان.", ad: result.rows[0] });
  } catch (error) {
    return jsonError(res, 500, "تعذر إضافة الإعلان.");
  }
});

app.put("/api/admin/ads/:id", requireAdmin, async (req, res) => {
  try {
    const title = clean(req.body.title);
    if (!title) return jsonError(res, 400, "عنوان الإعلان مطلوب.");

    const active = !(req.body.active === false || req.body.active === "false");

    const result = await pool.query(
      "UPDATE ads SET title=$1,description=$2,image_url=$3,target_url=$4,advertiser_name=$5,category=$6,active=$7,starts_at=$8,ends_at=$9,updated_at=NOW() WHERE id=$10 RETURNING *",
      [
        title,
        clean(req.body.description) || null,
        clean(req.body.image_url) || null,
        clean(req.body.target_url) || null,
        clean(req.body.advertiser_name) || null,
        clean(req.body.category) || null,
        active,
        clean(req.body.starts_at) || null,
        clean(req.body.ends_at) || null,
        req.params.id
      ]
    );

    if (!result.rowCount) return jsonError(res, 404, "الإعلان غير موجود.");
    return jsonOk(res, { message: "تم تحديث الإعلان.", ad: result.rows[0] });
  } catch (error) {
    return jsonError(res, 500, "تعذر تحديث الإعلان.");
  }
});

app.patch("/api/admin/ads/:id/status", requireAdmin, async (req, res) => {
  try {
    const active = !(req.body.active === false || req.body.active === "false");
    const result = await pool.query(
      "UPDATE ads SET active=$1,updated_at=NOW() WHERE id=$2 RETURNING *",
      [active, req.params.id]
    );

    if (!result.rowCount) return jsonError(res, 404, "الإعلان غير موجود.");
    return jsonOk(res, { message: active ? "تم تفعيل الإعلان." : "تم إيقاف الإعلان.", ad: result.rows[0] });
  } catch (error) {
    return jsonError(res, 500, "تعذر تغيير حالة الإعلان.");
  }
});

app.delete("/api/admin/ads/:id", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM ads WHERE id=$1 RETURNING id",
      [req.params.id]
    );

    if (!result.rowCount) return jsonError(res, 404, "الإعلان غير موجود.");
    return jsonOk(res, { message: "تم حذف الإعلان." });
  } catch (error) {
    return jsonError(res, 500, "تعذر حذف الإعلان.");
  }
});

/* ADMIN STATS */

app.get("/api/admin/stats", requireAdmin, async (req, res) => {
  try {
    const [patients, doctors, services, appointments, records, ads] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM patients"),
      pool.query("SELECT COUNT(*)::int AS count FROM doctors WHERE active=TRUE"),
      pool.query("SELECT COUNT(*)::int AS count FROM services WHERE active=TRUE"),
      pool.query("SELECT status,COUNT(*)::int AS count FROM appointments GROUP BY status"),
      pool.query("SELECT COUNT(*)::int AS count FROM medical_records"),
      pool.query("SELECT COUNT(*)::int AS count FROM ads WHERE active=TRUE")
    ]);

    const appointmentStats = {
      pending: 0,
      confirmed: 0,
      cancelled: 0,
      completed: 0,
      rejected: 0,
      no_show: 0
    };

    for (const row of appointments.rows) {
      appointmentStats[row.status] = row.count;
    }

    const totalAppointments = Object.values(appointmentStats).reduce(
      (sum, value) => sum + Number(value || 0),
      0
    );

    return jsonOk(res, {
      total_patients: patients.rows[0].count,
      active_doctors: doctors.rows[0].count,
      active_services: services.rows[0].count,
      total_appointments: totalAppointments,
      appointments: appointmentStats,
      total_medical_records: records.rows[0].count,
      active_ads: ads.rows[0].count
    });
  } catch (error) {
    console.error("Admin stats error:", error);
    return jsonError(res, 500, "تعذر تحميل الإحصائيات.");
  }
});

/* =========================================================
   API 404 AND FRONTEND
========================================================= */

app.use("/api", (req, res) => {
  return jsonError(res, 404, "مسار API غير موجود.");
});

app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api/")) {
    return next();
  }

  res.sendFile(path.join(PUBLIC_DIR, "index.html"), (error) => {
    if (error) next(error);
  });
});

app.use((error, req, res, next) => {
  console.error("Unhandled server error:", error);

  if (res.headersSent) return next(error);

  return jsonError(res, 500, "حدث خطأ داخلي في الخادم.");
});

/* =========================================================
   START SERVER
========================================================= */

async function startServer() {
  try {
    console.log("Starting Medical Booking...");

    await pool.query("SELECT NOW()");
    console.log("Neon database connection successful.");

    await initDatabase();
    await createIndexes();
    await seedServices();
    await seedAdmin();

    console.log("Database initialization completed.");

    app.listen(PORT, "0.0.0.0", () => {
      console.log("Medical Booking running on port " + PORT);
    });
  } catch (error) {
    console.error("Database initialization failed:", error);
    process.exit(1);
  }
}

startServer();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 10000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is missing.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ============================================================
// Helpers
// ============================================================

function makeId() {
  return crypto.randomUUID();
}

function randomToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString("hex");
}

function hashToken(token) {
  return crypto
    .createHash("sha256")
    .update(String(token))
    .digest("hex");
}

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normalizeUsername(value) {
  return clean(value).toLowerCase();
}

function validDate(value) {
  const v = clean(value);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return false;
  }

  const d = new Date(`${v}T00:00:00Z`);

  return !Number.isNaN(d.getTime()) &&
    d.toISOString().slice(0, 10) === v;
}

function validTime(value) {
  return /^\d{2}:\d{2}$/.test(clean(value));
}

function timeToMinutes(time) {
  if (!validTime(time)) return null;

  const [h, m] = clean(time).split(":").map(Number);

  if (h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }

  return h * 60 + m;
}

function minutesToTime(totalMinutes) {
  let minutes = Number(totalMinutes);

  if (!Number.isFinite(minutes)) {
    return null;
  }

  minutes = Math.floor(minutes);

  const h = Math.floor(minutes / 60);
  const m = minutes % 60;

  if (h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function jsonOk(res, data = {}) {
  return res.json({
    ok: true,
    ...data,
  });
}

function jsonError(res, status, message, extra = {}) {
  return res.status(status).json({
    ok: false,
    error: message,
    ...extra,
  });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");

  const hash = crypto
    .pbkdf2Sync(
      String(password),
      salt,
      120000,
      64,
      "sha512"
    )
    .toString("hex");

  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, storedHash] = String(stored).split(":");

    if (!salt || !storedHash) {
      return false;
    }

    const hash = crypto
      .pbkdf2Sync(
        String(password),
        salt,
        120000,
        64,
        "sha512"
      )
      .toString("hex");

    return crypto.timingSafeEqual(
      Buffer.from(hash, "hex"),
      Buffer.from(storedHash, "hex")
    );
  } catch {
    return false;
  }
}

async function columnExists(tableName, columnName) {
  const result = await pool.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
      LIMIT 1
    `,
    [tableName, columnName]
  );

  return result.rowCount > 0;
}

async function addColumnIfMissing(tableName, columnName, definition) {
  const exists = await columnExists(tableName, columnName);

  if (!exists) {
    await pool.query(
      `ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${definition}`
    );
  }
}

// ============================================================
// Database initialization
// ============================================================

async function initDatabase() {
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
      user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      full_name TEXT,
      phone TEXT,
      email TEXT,
      gender TEXT,
      birth_date DATE,
      address TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_users (
      id UUID PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
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
      specialty TEXT,
      area TEXT,
      phone TEXT,
      email TEXT,
      bio TEXT,
      image_url TEXT,
      rating NUMERIC(3,2) NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id UUID PRIMARY KEY,
      patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
      service_id UUID REFERENCES services(id) ON DELETE SET NULL,
      patient_name TEXT NOT NULL,
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
    CREATE TABLE IF NOT EXISTS medical_records (
      id UUID PRIMARY KEY,
      patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
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
      ad_id UUID NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_clicks (
      id UUID PRIMARY KEY,
      ad_id UUID NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
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
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ==========================================================
  // NEW: Doctor schedules
  // ==========================================================

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

      CONSTRAINT doctor_schedule_day_check
        CHECK (day_of_week BETWEEN 0 AND 6),

      CONSTRAINT doctor_schedule_time_check
        CHECK (start_time < end_time),

      CONSTRAINT doctor_schedule_duration_check
        CHECK (slot_duration_minutes > 0)
    )
  `);

  // ==========================================================
  // Compatibility migrations
  // ==========================================================

  await addColumnIfMissing("users", "password_hash", "TEXT");
  await addColumnIfMissing("users", "full_name", "TEXT");
  await addColumnIfMissing("users", "phone", "TEXT");
  await addColumnIfMissing("users", "email", "TEXT");
  await addColumnIfMissing("users", "role", "TEXT DEFAULT 'patient'");
  await addColumnIfMissing("users", "active", "BOOLEAN DEFAULT TRUE");
  await addColumnIfMissing(
    "users",
    "created_at",
    "TIMESTAMPTZ DEFAULT NOW()"
  );
  await addColumnIfMissing(
    "users",
    "updated_at",
    "TIMESTAMPTZ DEFAULT NOW()"
  );

  await addColumnIfMissing("patients", "gender", "TEXT");
  await addColumnIfMissing("patients", "birth_date", "DATE");
  await addColumnIfMissing("patients", "address", "TEXT");
  await addColumnIfMissing("patients", "notes", "TEXT");

  await addColumnIfMissing("doctors", "user_id", "UUID");
  await addColumnIfMissing("doctors", "specialty", "TEXT");
  await addColumnIfMissing("doctors", "area", "TEXT");
  await addColumnIfMissing("doctors", "phone", "TEXT");
  await addColumnIfMissing("doctors", "email", "TEXT");
  await addColumnIfMissing("doctors", "bio", "TEXT");
  await addColumnIfMissing("doctors", "image_url", "TEXT");
  await addColumnIfMissing(
    "doctors",
    "rating",
    "NUMERIC(3,2) DEFAULT 0"
  );
  await addColumnIfMissing(
    "doctors",
    "active",
    "BOOLEAN DEFAULT TRUE"
  );

  await addColumnIfMissing(
    "services",
    "duration_minutes",
    "INTEGER DEFAULT 30"
  );
  await addColumnIfMissing(
    "services",
    "price",
    "NUMERIC(12,2) DEFAULT 0"
  );
  await addColumnIfMissing(
    "services",
    "active",
    "BOOLEAN DEFAULT TRUE"
  );

  await addColumnIfMissing(
    "appointments",
    "patient_name",
    "TEXT"
  );
  await addColumnIfMissing(
    "appointments",
    "patient_phone",
    "TEXT"
  );
  await addColumnIfMissing(
    "appointments",
    "appointment_date",
    "DATE"
  );
  await addColumnIfMissing(
    "appointments",
    "appointment_time",
    "TIME"
  );
  await addColumnIfMissing(
    "appointments",
    "status",
    "TEXT DEFAULT 'pending'"
  );
  await addColumnIfMissing(
    "appointments",
    "notes",
    "TEXT"
  );
  await addColumnIfMissing(
    "appointments",
    "cancellation_reason",
    "TEXT"
  );

  await addColumnIfMissing(
    "sessions",
    "access_token_hash",
    "TEXT"
  );
  await addColumnIfMissing(
    "sessions",
    "refresh_token_hash",
    "TEXT"
  );
  await addColumnIfMissing(
    "sessions",
    "token_hash",
    "TEXT"
  );
  await addColumnIfMissing(
    "sessions",
    "user_id",
    "UUID"
  );
  await addColumnIfMissing(
    "sessions",
    "staff_user_id",
    "UUID"
  );

  await pool.query(`
    ALTER TABLE sessions
      ALTER COLUMN user_id DROP NOT NULL
  `).catch(() => {});

  await pool.query(`
    ALTER TABLE sessions
      ALTER COLUMN staff_user_id DROP NOT NULL
  `).catch(() => {});

  await pool.query(`
    ALTER TABLE sessions
      ALTER COLUMN token_hash DROP NOT NULL
  `).catch(() => {});
}

// ============================================================
// Indexes
// ============================================================

async function createIndexes() {
  const indexes = [
    `
      CREATE INDEX IF NOT EXISTS idx_users_username
      ON users(username)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_users_role
      ON users(role)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_patients_user
      ON patients(user_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_doctors_specialty
      ON doctors(specialty)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_doctors_area
      ON doctors(area)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_doctors_active
      ON doctors(active)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_services_active
      ON services(active)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_appointments_date
      ON appointments(appointment_date)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_appointments_doctor_date
      ON appointments(doctor_id, appointment_date)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_appointments_patient
      ON appointments(patient_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_appointments_status
      ON appointments(status)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_medical_records_patient
      ON medical_records(patient_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_ads_active
      ON ads(active)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_sessions_access
      ON sessions(access_token_hash)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_sessions_refresh
      ON sessions(refresh_token_hash)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_doctor_schedules_doctor
      ON doctor_schedules(doctor_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_doctor_schedules_day
      ON doctor_schedules(doctor_id, day_of_week)
    `,
  ];

  for (const sql of indexes) {
    await pool.query(sql);
  }
}

// ============================================================
// Seed services
// ============================================================

async function seedServices() {
  const services = [
    ["كشف عام", "كشف طبي عام", 30, 0],
    ["متابعة الحمل", "متابعة الحمل", 30, 0],
    ["سونار", "فحص السونار", 30, 0],
    ["كشف نساء", "كشف أمراض النساء", 30, 0],
    ["طب الأطفال", "كشف ومتابعة الأطفال", 30, 0],
    ["الباطنية", "أمراض الباطنية", 30, 0],
    ["طب القلب", "فحص ومتابعة القلب", 30, 0],
  ];

  for (const service of services) {
    await pool.query(
      `
        INSERT INTO services
          (id, name, description, duration_minutes, price)
        VALUES
          ($1, $2, $3, $4, $5)
        ON CONFLICT (name) DO NOTHING
      `,
      [makeId(), ...service]
    );
  }
}

// ============================================================
// Seed admin
// ============================================================

async function seedAdmin() {
  const username = normalizeUsername(
    process.env.ADMIN_USERNAME || "admin"
  );

  const password =
    process.env.ADMIN_PASSWORD || "admin123";

  const fullName =
    process.env.ADMIN_NAME || "مدير منصة موعدي";

  const existing = await pool.query(
    `
      SELECT id
      FROM staff_users
      WHERE username = $1
      LIMIT 1
    `,
    [username]
  );

  const passwordHash = hashPassword(password);

  if (existing.rowCount === 0) {
    await pool.query(
      `
        INSERT INTO staff_users
          (id, username, password_hash, full_name, role)
        VALUES
          ($1, $2, $3, $4, 'admin')
      `,
      [
        makeId(),
        username,
        passwordHash,
        fullName,
      ]
    );
  } else {
    await pool.query(
      `
        UPDATE staff_users
        SET
          full_name = $2,
          active = TRUE,
          updated_at = NOW()
        WHERE username = $1
      `,
      [username, fullName]
    );
  }
}

// ============================================================
// Sessions
// ============================================================

async function createSession({
  userId = null,
  staffUserId = null,
  days = 30,
}) {
  const accessToken = randomToken(48);
  const refreshToken = randomToken(64);

  const accessHash = hashToken(accessToken);
  const refreshHash = hashToken(refreshToken);

  const expiresAt = new Date(
    Date.now() + days * 24 * 60 * 60 * 1000
  );

  await pool.query(
    `
      INSERT INTO sessions
        (
          id,
          access_token_hash,
          refresh_token_hash,
          token_hash,
          user_id,
          staff_user_id,
          expires_at
        )
      VALUES
        ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      makeId(),
      accessHash,
      refreshHash,
      accessHash,
      userId,
      staffUserId,
      expiresAt,
    ]
  );

  return {
    accessToken,
    refreshToken,
    expiresAt,
  };
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return header.slice(7).trim();
}

async function getAuth(req) {
  const token = getBearerToken(req);

  if (!token) {
    return null;
  }

  const tokenHash = hashToken(token);

  const result = await pool.query(
    `
      SELECT
        s.id AS session_id,
        s.user_id,
        s.staff_user_id,
        s.expires_at,

        u.username AS user_username,
        u.full_name AS user_full_name,
        u.phone AS user_phone,
        u.email AS user_email,
        u.role AS user_role,
        u.active AS user_active,

        su.username AS staff_username,
        su.full_name AS staff_full_name,
        su.phone AS staff_phone,
        su.email AS staff_email,
        su.role AS staff_role,
        su.active AS staff_active

      FROM sessions s

      LEFT JOIN users u
        ON u.id = s.user_id

      LEFT JOIN staff_users su
        ON su.id = s.staff_user_id

      WHERE
        (
          s.access_token_hash = $1
          OR s.token_hash = $1
        )
        AND s.expires_at > NOW()

      LIMIT 1
    `,
    [tokenHash]
  );

  if (result.rowCount === 0) {
    return null;
  }

  const row = result.rows[0];

  if (row.staff_user_id) {
    return {
      type: "staff",
      sessionId: row.session_id,
      staffUserId: row.staff_user_id,
      username: row.staff_username,
      fullName: row.staff_full_name,
      phone: row.staff_phone,
      email: row.staff_email,
      role: row.staff_role,
      active: row.staff_active,
    };
  }

  if (row.user_id) {
    return {
      type: "patient",
      sessionId: row.session_id,
      userId: row.user_id,
      username: row.user_username,
      fullName: row.user_full_name,
      phone: row.user_phone,
      email: row.user_email,
      role: row.user_role,
      active: row.user_active,
    };
  }

  return null;
}

async function requireAuth(req, res, next) {
  try {
    const auth = await getAuth(req);

    if (!auth) {
      return jsonError(res, 401, "يجب تسجيل الدخول أولاً");
    }

    if (auth.active === false) {
      return jsonError(res, 403, "الحساب غير نشط");
    }

    req.auth = auth;
    next();
  } catch (error) {
    console.error("Auth error:", error);
    return jsonError(res, 500, "حدث خطأ أثناء التحقق من الدخول");
  }
}

async function requireAdmin(req, res, next) {
  try {
    const auth = await getAuth(req);

    if (!auth) {
      return jsonError(res, 401, "يجب تسجيل الدخول أولاً");
    }

    if (
      auth.type !== "staff" ||
      !["admin", "doctor", "secretary"].includes(auth.role)
    ) {
      return jsonError(res, 403, "ليس لديك صلاحية");
    }

    if (auth.active === false) {
      return jsonError(res, 403, "الحساب غير نشط");
    }

    req.auth = auth;
    next();
  } catch (error) {
    console.error("Admin auth error:", error);
    return jsonError(res, 500, "حدث خطأ أثناء التحقق من الصلاحية");
  }
}

// ============================================================
// Day helpers
// ============================================================

/*
  PostgreSQL EXTRACT(DOW FROM date)
  0 = Sunday
  1 = Monday
  2 = Tuesday
  3 = Wednesday
  4 = Thursday
  5 = Friday
  6 = Saturday
*/

function getDayOfWeek(dateString) {
  if (!validDate(dateString)) {
    return null;
  }

  const [year, month, day] = dateString
    .split("-")
    .map(Number);

  const date = new Date(
    Date.UTC(year, month - 1, day)
  );

  return date.getUTCDay();
}

// ============================================================
// Schedule helpers
// ============================================================

async function getDoctorScheduleForDate(doctorId, date) {
  const dayOfWeek = getDayOfWeek(date);

  if (dayOfWeek === null) {
    return [];
  }

  const result = await pool.query(
    `
      SELECT
        id,
        doctor_id,
        day_of_week,
        TO_CHAR(start_time, 'HH24:MI') AS start_time,
        TO_CHAR(end_time, 'HH24:MI') AS end_time,
        slot_duration_minutes,
        active
      FROM doctor_schedules
      WHERE doctor_id = $1
        AND day_of_week = $2
        AND active = TRUE
      ORDER BY start_time
    `,
    [doctorId, dayOfWeek]
  );

  return result.rows;
}

async function getBookedTimes(doctorId, date) {
  const result = await pool.query(
    `
      SELECT
        TO_CHAR(appointment_time, 'HH24:MI') AS appointment_time
      FROM appointments
      WHERE doctor_id = $1
        AND appointment_date = $2
        AND status IN ('pending', 'confirmed')
    `,
    [doctorId, date]
  );

  return new Set(
    result.rows.map((row) => row.appointment_time)
  );
}

async function generateAvailableSlots(doctorId, date) {
  const schedules = await getDoctorScheduleForDate(
    doctorId,
    date
  );

  if (schedules.length === 0) {
    return [];
  }

  const bookedTimes = await getBookedTimes(
    doctorId,
    date
  );

  const slots = [];

  for (const schedule of schedules) {
    const start = timeToMinutes(schedule.start_time);
    const end = timeToMinutes(schedule.end_time);

    const duration =
      Number(schedule.slot_duration_minutes) || 30;

    if (
      start === null ||
      end === null ||
      duration <= 0 ||
      start >= end
    ) {
      continue;
    }

    for (
      let current = start;
      current + duration <= end;
      current += duration
    ) {
      const time = minutesToTime(current);

      if (!time) continue;

      slots.push({
        time,
        available: !bookedTimes.has(time),
        duration_minutes: duration,
        schedule_id: schedule.id,
      });
    }
  }

  const unique = new Map();

  for (const slot of slots) {
    if (!unique.has(slot.time)) {
      unique.set(slot.time, slot);
    } else if (
      unique.get(slot.time).available === false &&
      slot.available === true
    ) {
      unique.set(slot.time, slot);
    }
  }

  return Array.from(unique.values()).sort(
    (a, b) => a.time.localeCompare(b.time)
  );
}

async function isAppointmentTimeAvailable(
  doctorId,
  date,
  time
) {
  const normalizedTime = clean(time).slice(0, 5);

  if (!validDate(date) || !validTime(normalizedTime)) {
    return {
      available: false,
      reason: "التاريخ أو الوقت غير صحيح",
    };
  }

  const schedules = await getDoctorScheduleForDate(
    doctorId,
    date
  );

  if (schedules.length === 0) {
    return {
      available: false,
      reason: "الطبيب لا يعمل في هذا اليوم",
    };
  }

  const selectedMinutes = timeToMinutes(normalizedTime);

  let insideSchedule = false;
  let slotDuration = 30;

  for (const schedule of schedules) {
    const start = timeToMinutes(schedule.start_time);
    const end = timeToMinutes(schedule.end_time);

    const duration =
      Number(schedule.slot_duration_minutes) || 30;

    if (
      start === null ||
      end === null ||
      selectedMinutes === null
    ) {
      continue;
    }

    if (
      selectedMinutes >= start &&
      selectedMinutes + duration <= end
    ) {
      const offset = selectedMinutes - start;

      if (offset % duration === 0) {
        insideSchedule = true;
        slotDuration = duration;
        break;
      }
    }
  }

  if (!insideSchedule) {
    return {
      available: false,
      reason: "الوقت خارج مواعيد الطبيب أو ليس ضمن فترة الحجز",
    };
  }

  const existing = await pool.query(
    `
      SELECT id
      FROM appointments
      WHERE doctor_id = $1
        AND appointment_date = $2
        AND TO_CHAR(appointment_time, 'HH24:MI') = $3
        AND status IN ('pending', 'confirmed')
      LIMIT 1
    `,
    [doctorId, date, normalizedTime]
  );

  if (existing.rowCount > 0) {
    return {
      available: false,
      reason: "هذا الموعد محجوز مسبقًا",
    };
  }

  return {
    available: true,
    duration_minutes: slotDuration,
  };
}

// ============================================================
// Health
// ============================================================

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

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
        uploads: true,
        doctorSchedules: true,
        availableSlots: true,
      },
    });
  } catch (error) {
    console.error(error);

    return jsonError(
      res,
      500,
      "قاعدة البيانات غير متاحة"
    );
  }
});

// ============================================================
// Patient authentication
// ============================================================

app.post("/api/register", async (req, res) => {
  const client = await pool.connect();

  try {
    const username = normalizeUsername(req.body.username);
    const fullName = clean(req.body.full_name);
    const phone = clean(req.body.phone);
    const email = clean(req.body.email);
    const password = String(req.body.password || "");

    if (!username || !fullName || !password) {
      return jsonError(
        res,
        400,
        "اسم المستخدم والاسم وكلمة المرور مطلوبة"
      );
    }

    if (password.length < 6) {
      return jsonError(
        res,
        400,
        "كلمة المرور يجب ألا تقل عن 6 أحرف"
      );
    }

    const existing = await client.query(
      `
        SELECT id
        FROM users
        WHERE username = $1
        LIMIT 1
      `,
      [username]
    );

    if (existing.rowCount > 0) {
      return jsonError(
        res,
        409,
        "اسم المستخدم مستخدم بالفعل"
      );
    }

    await client.query("BEGIN");

    const userId = makeId();
    const patientId = makeId();

    await client.query(
      `
        INSERT INTO users
          (
            id,
            username,
            password_hash,
            full_name,
            phone,
            email,
            role,
            active
          )
        VALUES
          ($1, $2, $3, $4, $5, $6, 'patient', TRUE)
      `,
      [
        userId,
        username,
        hashPassword(password),
        fullName,
        phone,
        email,
      ]
    );

    await client.query(
      `
        INSERT INTO patients
          (
            id,
            user_id,
            full_name,
            phone,
            email
          )
        VALUES
          ($1, $2, $3, $4, $5)
      `,
      [
        patientId,
        userId,
        fullName,
        phone,
        email,
      ]
    );

    await client.query("COMMIT");

    const session = await createSession({
      userId,
      days: 30,
    });

    return jsonOk(res, {
      message: "تم إنشاء الحساب بنجاح",
      user: {
        id: userId,
        username,
        full_name: fullName,
        phone,
        email,
        role: "patient",
      },
      ...session,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});

    console.error("Register error:", error);

    return jsonError(
      res,
      500,
      "تعذر إنشاء الحساب"
    );
  } finally {
    client.release();
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || "");

    const result = await pool.query(
      `
        SELECT
          id,
          username,
          password_hash,
          full_name,
          phone,
          email,
          role,
          active
        FROM users
        WHERE username = $1
        LIMIT 1
      `,
      [username]
    );

    if (result.rowCount === 0) {
      return jsonError(
        res,
        401,
        "اسم المستخدم أو كلمة المرور غير صحيحة"
      );
    }

    const user = result.rows[0];

    if (!verifyPassword(password, user.password_hash)) {
      return jsonError(
        res,
        401,
        "اسم المستخدم أو كلمة المرور غير صحيحة"
      );
    }

    if (!user.active) {
      return jsonError(
        res,
        403,
        "الحساب غير نشط"
      );
    }

    const session = await createSession({
      userId: user.id,
      days: 30,
    });

    return jsonOk(res, {
      message: "تم تسجيل الدخول",
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        phone: user.phone,
        email: user.email,
        role: user.role,
      },
      ...session,
    });
  } catch (error) {
    console.error("Login error:", error);

    return jsonError(
      res,
      500,
      "حدث خطأ أثناء تسجيل الدخول"
    );
  }
});

app.post("/api/staff/login", async (req, res) => {
  try {
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || "");

    const result = await pool.query(
      `
        SELECT
          id,
          username,
          password_hash,
          full_name,
          phone,
          email,
          role,
          active
        FROM staff_users
        WHERE username = $1
        LIMIT 1
      `,
      [username]
    );

    if (result.rowCount === 0) {
      return jsonError(
        res,
        401,
        "بيانات الدخول غير صحيحة"
      );
    }

    const staff = result.rows[0];

    if (!verifyPassword(password, staff.password_hash)) {
      return jsonError(
        res,
        401,
        "بيانات الدخول غير صحيحة"
      );
    }

    if (!staff.active) {
      return jsonError(
        res,
        403,
        "الحساب غير نشط"
      );
    }

    const session = await createSession({
      staffUserId: staff.id,
      days: 7,
    });

    return jsonOk(res, {
      message: "تم تسجيل الدخول",
      user: {
        id: staff.id,
        username: staff.username,
        full_name: staff.full_name,
        phone: staff.phone,
        email: staff.email,
        role: staff.role,
      },
      ...session,
    });
  } catch (error) {
    console.error("Staff login error:", error);

    return jsonError(
      res,
      500,
      "حدث خطأ أثناء تسجيل الدخول"
    );
  }
});

app.post("/api/logout", requireAuth, async (req, res) => {
  try {
    await pool.query(
      `
        DELETE FROM sessions
        WHERE id = $1
      `,
      [req.auth.sessionId]
    );

    return jsonOk(res, {
      message: "تم تسجيل الخروج",
    });
  } catch (error) {
    console.error(error);

    return jsonError(
      res,
      500,
      "تعذر تسجيل الخروج"
    );
  }
});

// ============================================================
// Public services
// ============================================================

app.get("/api/services", async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT
          id,
          name,
          description,
          duration_minutes,
          price,
          active
        FROM services
        WHERE active = TRUE
        ORDER BY name
      `
    );

    return jsonOk(res, {
      services: result.rows,
    });
  } catch (error) {
    console.error(error);

    return jsonError(
      res,
      500,
      "تعذر تحميل الخدمات"
    );
  }
});

// ============================================================
// Public doctors
// ============================================================

app.get("/api/doctors", async (req, res) => {
  try {
    const specialty = clean(req.query.specialty);
    const area = clean(req.query.area);
    const search = clean(req.query.search);

    const params = [];
    const conditions = [
      "d.active = TRUE",
    ];

    if (specialty) {
      params.push(`%${specialty}%`);
      conditions.push(
        `d.specialty ILIKE $${params.length}`
      );
    }

    if (area) {
      params.push(`%${area}%`);
      conditions.push(
        `d.area ILIKE $${params.length}`
      );
    }

    if (search) {
      params.push(`%${search}%`);

      conditions.push(`
        (
          d.full_name ILIKE $${params.length}
          OR d.specialty ILIKE $${params.length}
          OR d.area ILIKE $${params.length}
        )
      `);
    }

    const result = await pool.query(
      `
        SELECT
          d.id,
          d.full_name,
          d.specialty,
          d.area,
          d.phone,
          d.email,
          d.bio,
          d.image_url,
          d.rating,
          d.active
        FROM doctors d
        WHERE ${conditions.join(" AND ")}
        ORDER BY d.full_name
      `,
      params
    );

    return jsonOk(res, {
      doctors: result.rows,
    });
  } catch (error) {
    console.error(error);

    return jsonError(
      res,
      500,
      "تعذر تحميل الأطباء"
    );
  }
});

app.get("/api/doctors/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT
          id,
          full_name,
          specialty,
          area,
          phone,
          email,
          bio,
          image_url,
          rating,
          active
        FROM doctors
        WHERE id = $1
          AND active = TRUE
        LIMIT 1
      `,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return jsonError(
        res,
        404,
        "الطبيب غير موجود"
      );
    }

    const doctor = result.rows[0];

    const schedules = await pool.query(
      `
        SELECT
          id,
          day_of_week,
          TO_CHAR(start_time, 'HH24:MI') AS start_time,
          TO_CHAR(end_time, 'HH24:MI') AS end_time,
          slot_duration_minutes,
          active
        FROM doctor_schedules
        WHERE doctor_id = $1
          AND active = TRUE
        ORDER BY day_of_week, start_time
      `,
      [req.params.id]
    );

    return jsonOk(res, {
      doctor,
      schedules: schedules.rows,
    });
  } catch (error) {
    console.error(error);

    return jsonError(
      res,
      500,
      "تعذر تحميل بيانات الطبيب"
    );
  }
});

// ============================================================
// NEW: Public doctor schedules
// ============================================================

app.get(
  "/api/doctors/:id/schedule",
  async (req, res) => {
    try {
      const doctorResult = await pool.query(
        `
          SELECT id, full_name, active
          FROM doctors
          WHERE id = $1
          LIMIT 1
        `,
        [req.params.id]
      );

      if (doctorResult.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الطبيب غير موجود"
        );
      }

      const result = await pool.query(
        `
          SELECT
            id,
            doctor_id,
            day_of_week,
            TO_CHAR(start_time, 'HH24:MI') AS start_time,
            TO_CHAR(end_time, 'HH24:MI') AS end_time,
            slot_duration_minutes,
            active
          FROM doctor_schedules
          WHERE doctor_id = $1
            AND active = TRUE
          ORDER BY day_of_week, start_time
        `,
        [req.params.id]
      );

      return jsonOk(res, {
        doctor: doctorResult.rows[0],
        schedules: result.rows,
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحميل دوام الطبيب"
      );
    }
  }
);

// ============================================================
// NEW: Available appointment slots
// ============================================================

app.get(
  "/api/doctors/:id/available-slots",
  async (req, res) => {
    try {
      const doctorId = req.params.id;
      const date = clean(req.query.date);

      if (!validDate(date)) {
        return jsonError(
          res,
          400,
          "يجب إرسال تاريخ صحيح بصيغة YYYY-MM-DD"
        );
      }

      const doctorResult = await pool.query(
        `
          SELECT
            id,
            full_name,
            specialty,
            area,
            active
          FROM doctors
          WHERE id = $1
          LIMIT 1
        `,
        [doctorId]
      );

      if (doctorResult.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الطبيب غير موجود"
        );
      }

      if (!doctorResult.rows[0].active) {
        return jsonError(
          res,
          400,
          "الطبيب غير نشط حاليًا"
        );
      }

      const schedules =
        await getDoctorScheduleForDate(
          doctorId,
          date
        );

      const slots =
        await generateAvailableSlots(
          doctorId,
          date
        );

      return jsonOk(res, {
        doctor: doctorResult.rows[0],
        date,
        day_of_week: getDayOfWeek(date),
        schedules,
        slots,
        available_slots: slots.filter(
          (slot) => slot.available
        ),
      });
    } catch (error) {
      console.error(
        "Available slots error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر تحميل المواعيد المتاحة"
      );
    }
  }
);

// ============================================================
// Appointments - Patient booking
// ============================================================

app.post(
  "/api/appointments",
  requireAuth,
  async (req, res) => {
    try {
      if (req.auth.type !== "patient") {
        return jsonError(
          res,
          403,
          "هذه العملية متاحة للمرضى فقط"
        );
      }

      const doctorId = clean(req.body.doctor_id);
      const serviceId = clean(req.body.service_id);
      const appointmentDate =
        clean(req.body.appointment_date);
      const appointmentTime =
        clean(req.body.appointment_time).slice(0, 5);
      const notes = clean(req.body.notes);

      if (
        !doctorId ||
        !appointmentDate ||
        !appointmentTime
      ) {
        return jsonError(
          res,
          400,
          "الطبيب والتاريخ والوقت مطلوبة"
        );
      }

      if (!validDate(appointmentDate)) {
        return jsonError(
          res,
          400,
          "التاريخ غير صحيح"
        );
      }

      if (!validTime(appointmentTime)) {
        return jsonError(
          res,
          400,
          "الوقت غير صحيح"
        );
      }

      // ----------------------------------------------
      // Check doctor
      // ----------------------------------------------

      const doctorResult = await pool.query(
        `
          SELECT
            id,
            full_name,
            specialty,
            active
          FROM doctors
          WHERE id = $1
          LIMIT 1
        `,
        [doctorId]
      );

      if (doctorResult.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الطبيب غير موجود"
        );
      }

      if (!doctorResult.rows[0].active) {
        return jsonError(
          res,
          400,
          "الطبيب غير متاح للحجز حاليًا"
        );
      }

      // ----------------------------------------------
      // Check service
      // ----------------------------------------------

      let service = null;

      if (serviceId) {
        const serviceResult = await pool.query(
          `
            SELECT
              id,
              name,
              duration_minutes,
              price,
              active
            FROM services
            WHERE id = $1
            LIMIT 1
          `,
          [serviceId]
        );

        if (serviceResult.rowCount === 0) {
          return jsonError(
            res,
            404,
            "الخدمة غير موجودة"
          );
        }

        service = serviceResult.rows[0];

        if (!service.active) {
          return jsonError(
            res,
            400,
            "الخدمة غير متاحة حاليًا"
          );
        }
      }

      // ----------------------------------------------
      // NEW: Check doctor schedule
      // ----------------------------------------------

      const availability =
        await isAppointmentTimeAvailable(
          doctorId,
          appointmentDate,
          appointmentTime
        );

      if (!availability.available) {
        return jsonError(
          res,
          409,
          availability.reason,
          {
            code: "SLOT_NOT_AVAILABLE",
          }
        );
      }

      // ----------------------------------------------
      // Patient
      // ----------------------------------------------

      const patientResult = await pool.query(
        `
          SELECT
            p.id,
            p.full_name,
            p.phone,
            p.email
          FROM patients p
          WHERE p.user_id = $1
          LIMIT 1
        `,
        [req.auth.userId]
      );

      if (patientResult.rowCount === 0) {
        return jsonError(
          res,
          404,
          "ملف المريض غير موجود"
        );
      }

      const patient = patientResult.rows[0];

      // ----------------------------------------------
      // Patient conflict
      // ----------------------------------------------

      const patientConflict =
        await pool.query(
          `
            SELECT id
            FROM appointments
            WHERE patient_id = $1
              AND appointment_date = $2
              AND TO_CHAR(
                appointment_time,
                'HH24:MI'
              ) = $3
              AND status IN ('pending', 'confirmed')
            LIMIT 1
          `,
          [
            patient.id,
            appointmentDate,
            appointmentTime,
          ]
        );

      if (patientConflict.rowCount > 0) {
        return jsonError(
          res,
          409,
          "لديك موعد آخر في نفس التاريخ والوقت"
        );
      }

      // ----------------------------------------------
      // Doctor conflict - second protection
      // ----------------------------------------------

      const doctorConflict =
        await pool.query(
          `
            SELECT id
            FROM appointments
            WHERE doctor_id = $1
              AND appointment_date = $2
              AND TO_CHAR(
                appointment_time,
                'HH24:MI'
              ) = $3
              AND status IN ('pending', 'confirmed')
            LIMIT 1
          `,
          [
            doctorId,
            appointmentDate,
            appointmentTime,
          ]
        );

      if (doctorConflict.rowCount > 0) {
        return jsonError(
          res,
          409,
          "هذا الموعد تم حجزه للتو من مريض آخر"
        );
      }

      // ----------------------------------------------
      // Create appointment
      // ----------------------------------------------

      const appointmentId = makeId();

      const result = await pool.query(
        `
          INSERT INTO appointments
            (
              id,
              patient_id,
              doctor_id,
              service_id,
              patient_name,
              patient_phone,
              appointment_date,
              appointment_time,
              status,
              notes
            )
          VALUES
            (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8,
              'pending',
              $9
            )
          RETURNING
            id,
            patient_id,
            doctor_id,
            service_id,
            patient_name,
            patient_phone,
            appointment_date,
            TO_CHAR(
              appointment_time,
              'HH24:MI'
            ) AS appointment_time,
            status,
            notes,
            created_at
        `,
        [
          appointmentId,
          patient.id,
          doctorId,
          serviceId || null,
          patient.full_name ||
            req.auth.fullName,
          patient.phone ||
            req.auth.phone ||
            null,
          appointmentDate,
          appointmentTime,
          notes || null,
        ]
      );

      return jsonOk(res, {
        message:
          "تم إرسال طلب الحجز بنجاح",
        appointment: result.rows[0],
        doctor: doctorResult.rows[0],
        service,
      });
    } catch (error) {
      console.error(
        "Create appointment error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر إنشاء الحجز"
      );
    }
  }
);

// ============================================================
// Patient appointments
// ============================================================

app.get(
  "/api/my-appointments",
  requireAuth,
  async (req, res) => {
    try {
      if (req.auth.type !== "patient") {
        return jsonError(
          res,
          403,
          "هذه الصفحة للمرضى فقط"
        );
      }

      const result = await pool.query(
        `
          SELECT
            a.id,
            a.patient_name,
            a.patient_phone,
            a.appointment_date,
            TO_CHAR(
              a.appointment_time,
              'HH24:MI'
            ) AS appointment_time,
            a.status,
            a.notes,
            a.cancellation_reason,
            a.created_at,

            d.id AS doctor_id,
            d.full_name AS doctor_name,
            d.specialty AS doctor_specialty,
            d.area AS doctor_area,
            d.image_url AS doctor_image,

            s.id AS service_id,
            s.name AS service_name,
            s.price AS service_price,
            s.duration_minutes
          FROM appointments a

          JOIN doctors d
            ON d.id = a.doctor_id

          LEFT JOIN services s
            ON s.id = a.service_id

          JOIN patients p
            ON p.id = a.patient_id

          WHERE p.user_id = $1

          ORDER BY
            a.appointment_date DESC,
            a.appointment_time DESC
        `,
        [req.auth.userId]
      );

      return jsonOk(res, {
        appointments: result.rows,
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحميل المواعيد"
      );
    }
  }
);

app.patch(
  "/api/my-appointments/:id/cancel",
  requireAuth,
  async (req, res) => {
    try {
      if (req.auth.type !== "patient") {
        return jsonError(
          res,
          403,
          "هذه العملية للمرضى فقط"
        );
      }

      const reason =
        clean(req.body.reason) ||
        "تم الإلغاء بواسطة المريض";

      const result = await pool.query(
        `
          UPDATE appointments a
          SET
            status = 'cancelled',
            cancellation_reason = $1,
            updated_at = NOW()
          FROM patients p
          WHERE
            a.id = $2
            AND a.patient_id = p.id
            AND p.user_id = $3
            AND a.status IN ('pending', 'confirmed')
          RETURNING
            a.id,
            a.status,
            a.cancellation_reason
        `,
        [
          reason,
          req.params.id,
          req.auth.userId,
        ]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الموعد غير موجود أو لا يمكن إلغاؤه"
        );
      }

      return jsonOk(res, {
        message: "تم إلغاء الموعد",
        appointment: result.rows[0],
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر إلغاء الموعد"
      );
    }
  }
);

// ============================================================
// Patient profile
// ============================================================

app.get(
  "/api/my-profile",
  requireAuth,
  async (req, res) => {
    try {
      if (req.auth.type !== "patient") {
        return jsonError(
          res,
          403,
          "هذه الصفحة للمرضى فقط"
        );
      }

      const result = await pool.query(
        `
          SELECT
            u.id AS user_id,
            u.username,
            u.full_name AS user_full_name,
            u.phone AS user_phone,
            u.email AS user_email,
            p.id AS patient_id,
            p.full_name,
            p.phone,
            p.email,
            p.gender,
            p.birth_date,
            p.address,
            p.notes
          FROM users u
          LEFT JOIN patients p
            ON p.user_id = u.id
          WHERE u.id = $1
          LIMIT 1
        `,
        [req.auth.userId]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الملف غير موجود"
        );
      }

      return jsonOk(res, {
        profile: result.rows[0],
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحميل الملف الشخصي"
      );
    }
  }
);

app.put(
  "/api/my-profile",
  requireAuth,
  async (req, res) => {
    try {
      if (req.auth.type !== "patient") {
        return jsonError(
          res,
          403,
          "هذه العملية للمرضى فقط"
        );
      }

      const fullName =
        clean(req.body.full_name);
      const phone =
        clean(req.body.phone);
      const email =
        clean(req.body.email);
      const gender =
        clean(req.body.gender);
      const birthDate =
        clean(req.body.birth_date);
      const address =
        clean(req.body.address);
      const notes =
        clean(req.body.notes);

      if (birthDate && !validDate(birthDate)) {
        return jsonError(
          res,
          400,
          "تاريخ الميلاد غير صحيح"
        );
      }

      await pool.query(
        `
          UPDATE users
          SET
            full_name = COALESCE(NULLIF($2, ''), full_name),
            phone = $3,
            email = $4,
            updated_at = NOW()
          WHERE id = $1
        `,
        [
          req.auth.userId,
          fullName,
          phone,
          email,
        ]
      );

      await pool.query(
        `
          UPDATE patients
          SET
            full_name = COALESCE(NULLIF($2, ''), full_name),
            phone = $3,
            email = $4,
            gender = $5,
            birth_date = $6,
            address = $7,
            notes = $8,
            updated_at = NOW()
          WHERE user_id = $1
        `,
        [
          req.auth.userId,
          fullName,
          phone,
          email,
          gender,
          birthDate || null,
          address,
          notes,
        ]
      );

      return jsonOk(res, {
        message: "تم تحديث الملف الشخصي",
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحديث الملف الشخصي"
      );
    }
  }
);

// ============================================================
// Ads - Public
// ============================================================

app.get("/api/ads", async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT
          id,
          title,
          description,
          image_url,
          target_url,
          advertiser_name,
          category,
          starts_at,
          ends_at
        FROM ads
        WHERE active = TRUE
          AND (
            starts_at IS NULL
            OR starts_at <= NOW()
          )
          AND (
            ends_at IS NULL
            OR ends_at >= NOW()
          )
        ORDER BY created_at DESC
      `
    );

    return jsonOk(res, {
      ads: result.rows,
    });
  } catch (error) {
    console.error(error);

    return jsonError(
      res,
      500,
      "تعذر تحميل الإعلانات"
    );
  }
});

app.post(
  "/api/ads/:id/impression",
  async (req, res) => {
    try {
      await pool.query(
        `
          INSERT INTO ad_impressions
            (id, ad_id)
          VALUES
            ($1, $2)
        `,
        [
          makeId(),
          req.params.id,
        ]
      );

      return jsonOk(res);
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تسجيل المشاهدة"
      );
    }
  }
);

app.post(
  "/api/ads/:id/click",
  async (req, res) => {
    try {
      await pool.query(
        `
          INSERT INTO ad_clicks
            (id, ad_id)
          VALUES
            ($1, $2)
        `,
        [
          makeId(),
          req.params.id,
        ]
      );

      return jsonOk(res);
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تسجيل النقرة"
      );
    }
  }
);

// ============================================================
// Admin identity
// ============================================================

app.get(
  "/api/admin/me",
  requireAdmin,
  async (req, res) => {
    return jsonOk(res, {
      user: req.auth,
    });
  }
);

app.get(
  "/api/staff/me",
  requireAdmin,
  async (req, res) => {
    return jsonOk(res, {
      user: req.auth,
    });
  }
);

// ============================================================
// Admin doctors
// ============================================================

app.get(
  "/api/admin/doctors",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          SELECT
            d.*,
            COUNT(DISTINCT ds.id)::INTEGER
              AS schedule_count
          FROM doctors d
          LEFT JOIN doctor_schedules ds
            ON ds.doctor_id = d.id
          GROUP BY d.id
          ORDER BY d.created_at DESC
        `
      );

      return jsonOk(res, {
        doctors: result.rows,
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحميل الأطباء"
      );
    }
  }
);

app.post(
  "/api/admin/doctors",
  requireAdmin,
  async (req, res) => {
    try {
      const fullName =
        clean(req.body.full_name);

      if (!fullName) {
        return jsonError(
          res,
          400,
          "اسم الطبيب مطلوب"
        );
      }

      const result = await pool.query(
        `
          INSERT INTO doctors
            (
              id,
              user_id,
              full_name,
              specialty,
              area,
              phone,
              email,
              bio,
              image_url,
              rating,
              active
            )
          VALUES
            (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8,
              $9,
              $10,
              $11
            )
          RETURNING *
        `,
        [
          makeId(),
          clean(req.body.user_id) || null,
          fullName,
          clean(req.body.specialty),
          clean(req.body.area),
          clean(req.body.phone),
          clean(req.body.email),
          clean(req.body.bio),
          clean(req.body.image_url),
          Number(req.body.rating) || 0,
          req.body.active !== false,
        ]
      );

      return jsonOk(res, {
        message: "تم إضافة الطبيب",
        doctor: result.rows[0],
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر إضافة الطبيب"
      );
    }
  }
);

app.put(
  "/api/admin/doctors/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          UPDATE doctors
          SET
            full_name = COALESCE(NULLIF($2, ''), full_name),
            specialty = $3,
            area = $4,
            phone = $5,
            email = $6,
            bio = $7,
            image_url = $8,
            rating = $9,
            updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [
          req.params.id,
          clean(req.body.full_name),
          clean(req.body.specialty),
          clean(req.body.area),
          clean(req.body.phone),
          clean(req.body.email),
          clean(req.body.bio),
          clean(req.body.image_url),
          Number(req.body.rating) || 0,
        ]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الطبيب غير موجود"
        );
      }

      return jsonOk(res, {
        message: "تم تحديث الطبيب",
        doctor: result.rows[0],
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحديث الطبيب"
      );
    }
  }
);

app.patch(
  "/api/admin/doctors/:id/status",
  requireAdmin,
  async (req, res) => {
    try {
      const active =
        req.body.active === true ||
        req.body.active === "true";

      const result = await pool.query(
        `
          UPDATE doctors
          SET
            active = $2,
            updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [
          req.params.id,
          active,
        ]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الطبيب غير موجود"
        );
      }

      return jsonOk(res, {
        message: "تم تحديث حالة الطبيب",
        doctor: result.rows[0],
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحديث حالة الطبيب"
      );
    }
  }
);

app.delete(
  "/api/admin/doctors/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          DELETE FROM doctors
          WHERE id = $1
          RETURNING id
        `,
        [req.params.id]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الطبيب غير موجود"
        );
      }

      return jsonOk(res, {
        message: "تم حذف الطبيب",
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر حذف الطبيب"
      );
    }
  }
);

// ============================================================
// NEW: Admin doctor schedules
// ============================================================

app.get(
  "/api/admin/doctors/:id/schedules",
  requireAdmin,
  async (req, res) => {
    try {
      const doctorResult = await pool.query(
        `
          SELECT
            id,
            full_name,
            specialty,
            active
          FROM doctors
          WHERE id = $1
          LIMIT 1
        `,
        [req.params.id]
      );

      if (doctorResult.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الطبيب غير موجود"
        );
      }

      const result = await pool.query(
        `
          SELECT
            id,
            doctor_id,
            day_of_week,
            TO_CHAR(start_time, 'HH24:MI')
              AS start_time,
            TO_CHAR(end_time, 'HH24:MI')
              AS end_time,
            slot_duration_minutes,
            active
          FROM doctor_schedules
          WHERE doctor_id = $1
          ORDER BY day_of_week, start_time
        `,
        [req.params.id]
      );

      return jsonOk(res, {
        doctor: doctorResult.rows[0],
        schedules: result.rows,
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحميل دوام الطبيب"
      );
    }
  }
);

app.post(
  "/api/admin/doctors/:id/schedules",
  requireAdmin,
  async (req, res) => {
    try {
      const doctorId = req.params.id;

      const dayOfWeek =
        Number(req.body.day_of_week);

      const startTime =
        clean(req.body.start_time);

      const endTime =
        clean(req.body.end_time);

      const slotDuration =
        Number(
          req.body.slot_duration_minutes
        ) || 30;

      if (
        !Number.isInteger(dayOfWeek) ||
        dayOfWeek < 0 ||
        dayOfWeek > 6
      ) {
        return jsonError(
          res,
          400,
          "يوم الأسبوع غير صحيح"
        );
      }

      if (
        !validTime(startTime) ||
        !validTime(endTime)
      ) {
        return jsonError(
          res,
          400,
          "وقت البداية أو النهاية غير صحيح"
        );
      }

      const startMinutes =
        timeToMinutes(startTime);

      const endMinutes =
        timeToMinutes(endTime);

      if (
        startMinutes === null ||
        endMinutes === null ||
        startMinutes >= endMinutes
      ) {
        return jsonError(
          res,
          400,
          "وقت بداية الدوام يجب أن يكون قبل وقت النهاية"
        );
      }

      if (
        !Number.isInteger(slotDuration) ||
        slotDuration < 5 ||
        slotDuration > 240
      ) {
        return jsonError(
          res,
          400,
          "مدة الموعد يجب أن تكون بين 5 و240 دقيقة"
        );
      }

      const doctorResult = await pool.query(
        `
          SELECT id
          FROM doctors
          WHERE id = $1
          LIMIT 1
        `,
        [doctorId]
      );

      if (doctorResult.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الطبيب غير موجود"
        );
      }

      // Prevent overlapping schedules
      const overlap = await pool.query(
        `
          SELECT id
          FROM doctor_schedules
          WHERE doctor_id = $1
            AND day_of_week = $2
            AND active = TRUE
            AND start_time < $4::time
            AND end_time > $3::time
          LIMIT 1
        `,
        [
          doctorId,
          dayOfWeek,
          startTime,
          endTime,
        ]
      );

      if (overlap.rowCount > 0) {
        return jsonError(
          res,
          409,
          "هناك فترة دوام متداخلة لهذا الطبيب في نفس اليوم"
        );
      }

      const result = await pool.query(
        `
          INSERT INTO doctor_schedules
            (
              id,
              doctor_id,
              day_of_week,
              start_time,
              end_time,
              slot_duration_minutes,
              active
            )
          VALUES
            ($1, $2, $3, $4, $5, $6, TRUE)
          RETURNING
            id,
            doctor_id,
            day_of_week,
            TO_CHAR(start_time, 'HH24:MI')
              AS start_time,
            TO_CHAR(end_time, 'HH24:MI')
              AS end_time,
            slot_duration_minutes,
            active
        `,
        [
          makeId(),
          doctorId,
          dayOfWeek,
          startTime,
          endTime,
          slotDuration,
        ]
      );

      return jsonOk(res, {
        message: "تم إضافة فترة الدوام",
        schedule: result.rows[0],
      });
    } catch (error) {
      console.error(
        "Add schedule error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر إضافة فترة الدوام"
      );
    }
  }
);

app.put(
  "/api/admin/doctor-schedules/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const scheduleId = req.params.id;

      const dayOfWeek =
        Number(req.body.day_of_week);

      const startTime =
        clean(req.body.start_time);

      const endTime =
        clean(req.body.end_time);

      const slotDuration =
        Number(
          req.body.slot_duration_minutes
        ) || 30;

      if (
        !Number.isInteger(dayOfWeek) ||
        dayOfWeek < 0 ||
        dayOfWeek > 6
      ) {
        return jsonError(
          res,
          400,
          "يوم الأسبوع غير صحيح"
        );
      }

      if (
        !validTime(startTime) ||
        !validTime(endTime)
      ) {
        return jsonError(
          res,
          400,
          "وقت البداية أو النهاية غير صحيح"
        );
      }

      const startMinutes =
        timeToMinutes(startTime);

      const endMinutes =
        timeToMinutes(endTime);

      if (
        startMinutes === null ||
        endMinutes === null ||
        startMinutes >= endMinutes
      ) {
        return jsonError(
          res,
          400,
          "وقت البداية يجب أن يكون قبل وقت النهاية"
        );
      }

      if (
        !Number.isInteger(slotDuration) ||
        slotDuration < 5 ||
        slotDuration > 240
      ) {
        return jsonError(
          res,
          400,
          "مدة الموعد يجب أن تكون بين 5 و240 دقيقة"
        );
      }

      const existing = await pool.query(
        `
          SELECT doctor_id
          FROM doctor_schedules
          WHERE id = $1
          LIMIT 1
        `,
        [scheduleId]
      );

      if (existing.rowCount === 0) {
        return jsonError(
          res,
          404,
          "فترة الدوام غير موجودة"
        );
      }

      const doctorId =
        existing.rows[0].doctor_id;

      const overlap = await pool.query(
        `
          SELECT id
          FROM doctor_schedules
          WHERE doctor_id = $1
            AND day_of_week = $2
            AND active = TRUE
            AND id <> $5
            AND start_time < $4::time
            AND end_time > $3::time
          LIMIT 1
        `,
        [
          doctorId,
          dayOfWeek,
          startTime,
          endTime,
          scheduleId,
        ]
      );

      if (overlap.rowCount > 0) {
        return jsonError(
          res,
          409,
          "فترة الدوام الجديدة تتداخل مع فترة أخرى"
        );
      }

      const result = await pool.query(
        `
          UPDATE doctor_schedules
          SET
            day_of_week = $2,
            start_time = $3,
            end_time = $4,
            slot_duration_minutes = $5,
            updated_at = NOW()
          WHERE id = $1
          RETURNING
            id,
            doctor_id,
            day_of_week,
            TO_CHAR(start_time, 'HH24:MI')
              AS start_time,
            TO_CHAR(end_time, 'HH24:MI')
              AS end_time,
            slot_duration_minutes,
            active
        `,
        [
          scheduleId,
          dayOfWeek,
          startTime,
          endTime,
          slotDuration,
        ]
      );

      return jsonOk(res, {
        message: "تم تعديل فترة الدوام",
        schedule: result.rows[0],
      });
    } catch (error) {
      console.error(
        "Update schedule error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر تعديل فترة الدوام"
      );
    }
  }
);

app.patch(
  "/api/admin/doctor-schedules/:id/status",
  requireAdmin,
  async (req, res) => {
    try {
      const active =
        req.body.active === true ||
        req.body.active === "true";

      const result = await pool.query(
        `
          UPDATE doctor_schedules
          SET
            active = $2,
            updated_at = NOW()
          WHERE id = $1
          RETURNING
            id,
            doctor_id,
            day_of_week,
            TO_CHAR(start_time, 'HH24:MI')
              AS start_time,
            TO_CHAR(end_time, 'HH24:MI')
              AS end_time,
            slot_duration_minutes,
            active
        `,
        [
          req.params.id,
          active,
        ]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          404,
          "فترة الدوام غير موجودة"
        );
      }

      return jsonOk(res, {
        message: "تم تحديث حالة فترة الدوام",
        schedule: result.rows[0],
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحديث حالة الدوام"
      );
    }
  }
);

app.delete(
  "/api/admin/doctor-schedules/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          DELETE FROM doctor_schedules
          WHERE id = $1
          RETURNING id
        `,
        [req.params.id]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          404,
          "فترة الدوام غير موجودة"
        );
      }

      return jsonOk(res, {
        message: "تم حذف فترة الدوام",
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر حذف فترة الدوام"
      );
    }
  }
);

// ============================================================
// Admin services
// ============================================================

app.get(
  "/api/admin/services",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          SELECT *
          FROM services
          ORDER BY created_at DESC
        `
      );

      return jsonOk(res, {
        services: result.rows,
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحميل الخدمات"
      );
    }
  }
);

app.post(
  "/api/admin/services",
  requireAdmin,
  async (req, res) => {
    try {
      const name = clean(req.body.name);

      if (!name) {
        return jsonError(
          res,
          400,
          "اسم الخدمة مطلوب"
        );
      }

      const duration =
        Number(req.body.duration_minutes) || 30;

      const price =
        Number(req.body.price) || 0;

      const result = await pool.query(
        `
          INSERT INTO services
            (
              id,
              name,
              description,
              duration_minutes,
              price,
              active
            )
          VALUES
            ($1, $2, $3, $4, $5, $6)
          RETURNING *
        `,
        [
          makeId(),
          name,
          clean(req.body.description),
          duration,
          price,
          req.body.active !== false,
        ]
      );

      return jsonOk(res, {
        message: "تم إضافة الخدمة",
        service: result.rows[0],
      });
    } catch (error) {
      console.error(error);

      if (error.code === "23505") {
        return jsonError(
          res,
          409,
          "الخدمة موجودة بالفعل"
        );
      }

      return jsonError(
        res,
        500,
        "تعذر إضافة الخدمة"
      );
    }
  }
);

app.put(
  "/api/admin/services/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          UPDATE services
          SET
            name = COALESCE(NULLIF($2, ''), name),
            description = $3,
            duration_minutes = $4,
            price = $5,
            updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [
          req.params.id,
          clean(req.body.name),
          clean(req.body.description),
          Number(
            req.body.duration_minutes
          ) || 30,
          Number(req.body.price) || 0,
        ]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الخدمة غير موجودة"
        );
      }

      return jsonOk(res, {
        message: "تم تحديث الخدمة",
        service: result.rows[0],
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحديث الخدمة"
      );
    }
  }
);

app.patch(
  "/api/admin/services/:id/status",
  requireAdmin,
  async (req, res) => {
    try {
      const active =
        req.body.active === true ||
        req.body.active === "true";

      const result = await pool.query(
        `
          UPDATE services
          SET
            active = $2,
            updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [
          req.params.id,
          active,
        ]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الخدمة غير موجودة"
        );
      }

      return jsonOk(res, {
        message: "تم تحديث حالة الخدمة",
        service: result.rows[0],
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحديث حالة الخدمة"
      );
    }
  }
);

app.delete(
  "/api/admin/services/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          DELETE FROM services
          WHERE id = $1
          RETURNING id
        `,
        [req.params.id]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الخدمة غير موجودة"
        );
      }

      return jsonOk(res, {
        message: "تم حذف الخدمة",
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر حذف الخدمة"
      );
    }
  }
);

// ============================================================
// Admin appointments
// ============================================================

app.get(
  "/api/admin/appointments",
  requireAdmin,
  async (req, res) => {
    try {
      const status = clean(req.query.status);
      const date = clean(req.query.date);

      const params = [];
      const conditions = ["1=1"];

      if (status) {
        params.push(status);
        conditions.push(
          `a.status = $${params.length}`
        );
      }

      if (date) {
        if (!validDate(date)) {
          return jsonError(
            res,
            400,
            "التاريخ غير صحيح"
          );
        }

        params.push(date);

        conditions.push(
          `a.appointment_date = $${params.length}`
        );
      }

      const result = await pool.query(
        `
          SELECT
            a.id,
            a.patient_id,
            a.doctor_id,
            a.service_id,
            a.patient_name,
            a.patient_phone,
            a.appointment_date,
            TO_CHAR(
              a.appointment_time,
              'HH24:MI'
            ) AS appointment_time,
            a.status,
            a.notes,
            a.cancellation_reason,
            a.created_at,
            a.updated_at,

            d.full_name AS doctor_name,
            d.specialty AS doctor_specialty,

            s.name AS service_name,
            s.price AS service_price,

            p.phone AS registered_patient_phone,
            p.email AS patient_email

          FROM appointments a

          JOIN doctors d
            ON d.id = a.doctor_id

          LEFT JOIN services s
            ON s.id = a.service_id

          JOIN patients p
            ON p.id = a.patient_id

          WHERE ${conditions.join(" AND ")}

          ORDER BY
            a.appointment_date DESC,
            a.appointment_time DESC
        `,
        params
      );

      return jsonOk(res, {
        appointments: result.rows,
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحميل المواعيد"
      );
    }
  }
);

app.patch(
  "/api/admin/appointments/:id/status",
  requireAdmin,
  async (req, res) => {
    try {
      const status = clean(req.body.status);

      const allowed = [
        "pending",
        "confirmed",
        "completed",
        "cancelled",
        "no_show",
      ];

      if (!allowed.includes(status)) {
        return jsonError(
          res,
          400,
          "حالة الموعد غير صحيحة"
        );
      }

      const cancellationReason =
        clean(req.body.cancellation_reason);

      const result = await pool.query(
        `
          UPDATE appointments
          SET
            status = $2,
            cancellation_reason =
              CASE
                WHEN $2 = 'cancelled'
                  THEN NULLIF($3, '')
                ELSE cancellation_reason
              END,
            updated_at = NOW()
          WHERE id = $1
          RETURNING
            id,
            status,
            cancellation_reason,
            updated_at
        `,
        [
          req.params.id,
          status,
          cancellationReason,
        ]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الموعد غير موجود"
        );
      }

      return jsonOk(res, {
        message: "تم تحديث حالة الموعد",
        appointment: result.rows[0],
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحديث حالة الموعد"
      );
    }
  }
);

app.delete(
  "/api/admin/appointments/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          DELETE FROM appointments
          WHERE id = $1
          RETURNING id
        `,
        [req.params.id]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الموعد غير موجود"
        );
      }

      return jsonOk(res, {
        message: "تم حذف الموعد",
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر حذف الموعد"
      );
    }
  }
);

// ============================================================
// Admin patients
// ============================================================

app.get(
  "/api/admin/patients",
  requireAdmin,
  async (req, res) => {
    try {
      const search = clean(req.query.search);

      const params = [];
      let condition = "";

      if (search) {
        params.push(`%${search}%`);

        condition = `
          WHERE
            p.full_name ILIKE $1
            OR p.phone ILIKE $1
            OR p.email ILIKE $1
            OR u.username ILIKE $1
        `;
      }

      const result = await pool.query(
        `
          SELECT
            p.id,
            p.user_id,
            p.full_name,
            p.phone,
            p.email,
            p.gender,
            p.birth_date,
            p.address,
            p.notes,
            p.created_at,
            u.username,
            u.active
          FROM patients p
          JOIN users u
            ON u.id = p.user_id
          ${condition}
          ORDER BY p.created_at DESC
        `,
        params
      );

      return jsonOk(res, {
        patients: result.rows,
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحميل المرضى"
      );
    }
  }
);

app.get(
  "/api/admin/patients/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          SELECT
            p.*,
            u.username,
            u.active
          FROM patients p
          JOIN users u
            ON u.id = p.user_id
          WHERE p.id = $1
          LIMIT 1
        `,
        [req.params.id]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          404,
          "المريض غير موجود"
        );
      }

      return jsonOk(res, {
        patient: result.rows[0],
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحميل بيانات المريض"
      );
    }
  }
);

app.put(
  "/api/admin/patients/:id",
  requireAdmin,
  async (req, res) => {
    const client = await pool.connect();

    try {
      const patientId = req.params.id;

      const patientResult = await client.query(
        `
          SELECT user_id
          FROM patients
          WHERE id = $1
          LIMIT 1
        `,
        [patientId]
      );

      if (patientResult.rowCount === 0) {
        return jsonError(
          res,
          404,
          "المريض غير موجود"
        );
      }

      const userId =
        patientResult.rows[0].user_id;

      const fullName =
        clean(req.body.full_name);
      const phone =
        clean(req.body.phone);
      const email =
        clean(req.body.email);
      const gender =
        clean(req.body.gender);
      const birthDate =
        clean(req.body.birth_date);
      const address =
        clean(req.body.address);
      const notes =
        clean(req.body.notes);

      if (
        birthDate &&
        !validDate(birthDate)
      ) {
        return jsonError(
          res,
          400,
          "تاريخ الميلاد غير صحيح"
        );
      }

      await client.query("BEGIN");

      await client.query(
        `
          UPDATE users
          SET
            full_name = COALESCE(
              NULLIF($2, ''),
              full_name
            ),
            phone = $3,
            email = $4,
            updated_at = NOW()
          WHERE id = $1
        `,
        [
          userId,
          fullName,
          phone,
          email,
        ]
      );

      await client.query(
        `
          UPDATE patients
          SET
            full_name = COALESCE(
              NULLIF($2, ''),
              full_name
            ),
            phone = $3,
            email = $4,
            gender = $5,
            birth_date = $6,
            address = $7,
            notes = $8,
            updated_at = NOW()
          WHERE id = $1
        `,
        [
          patientId,
          fullName,
          phone,
          email,
          gender,
          birthDate || null,
          address,
          notes,
        ]
      );

      await client.query("COMMIT");

      return jsonOk(res, {
        message: "تم تحديث بيانات المريض",
      });
    } catch (error) {
      await client.query(
        "ROLLBACK"
      ).catch(() => {});

      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحديث بيانات المريض"
      );
    } finally {
      client.release();
    }
  }
);

app.patch(
  "/api/admin/patients/:id/status",
  requireAdmin,
  async (req, res) => {
    try {
      const active =
        req.body.active === true ||
        req.body.active === "true";

      const result = await pool.query(
        `
          UPDATE users u
          SET
            active = $2,
            updated_at = NOW()
          FROM patients p
          WHERE
            p.id = $1
            AND p.user_id = u.id
          RETURNING
            p.id,
            u.active
        `,
        [
          req.params.id,
          active,
        ]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          404,
          "المريض غير موجود"
        );
      }

      return jsonOk(res, {
        message: "تم تحديث حالة المريض",
        patient: result.rows[0],
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحديث حالة المريض"
      );
    }
  }
);

// ============================================================
// Medical records
// ============================================================

app.get(
  "/api/my-medical-records",
  requireAuth,
  async (req, res) => {
    try {
      if (req.auth.type !== "patient") {
        return jsonError(
          res,
          403,
          "هذه الصفحة للمرضى فقط"
        );
      }

      const result = await pool.query(
        `
          SELECT
            mr.id,
            mr.diagnosis,
            mr.treatment,
            mr.prescription,
            mr.notes,
            mr.created_at,

            d.full_name AS doctor_name,
            d.specialty AS doctor_specialty,

            a.appointment_date,
            TO_CHAR(
              a.appointment_time,
              'HH24:MI'
            ) AS appointment_time

          FROM medical_records mr

          JOIN patients p
            ON p.id = mr.patient_id

          LEFT JOIN doctors d
            ON d.id = mr.doctor_id

          LEFT JOIN appointments a
            ON a.id = mr.appointment_id

          WHERE p.user_id = $1

          ORDER BY mr.created_at DESC
        `,
        [req.auth.userId]
      );

      return jsonOk(res, {
        records: result.rows,
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحميل السجل الطبي"
      );
    }
  }
);

app.get(
  "/api/admin/medical-records",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          SELECT
            mr.*,

            p.full_name AS patient_name,
            p.phone AS patient_phone,

            d.full_name AS doctor_name,
            d.specialty AS doctor_specialty

          FROM medical_records mr

          JOIN patients p
            ON p.id = mr.patient_id

          LEFT JOIN doctors d
            ON d.id = mr.doctor_id

          ORDER BY mr.created_at DESC
        `
      );

      return jsonOk(res, {
        records: result.rows,
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحميل السجلات الطبية"
      );
    }
  }
);

app.post(
  "/api/admin/medical-records",
  requireAdmin,
  async (req, res) => {
    try {
      const patientId =
        clean(req.body.patient_id);

      if (!patientId) {
        return jsonError(
          res,
          400,
          "المريض مطلوب"
        );
      }

      const result = await pool.query(
        `
          INSERT INTO medical_records
            (
              id,
              patient_id,
              doctor_id,
              appointment_id,
              diagnosis,
              treatment,
              prescription,
              notes
            )
          VALUES
            (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8
            )
          RETURNING *
        `,
        [
          makeId(),
          patientId,
          clean(req.body.doctor_id) || null,
          clean(req.body.appointment_id) || null,
          clean(req.body.diagnosis),
          clean(req.body.treatment),
          clean(req.body.prescription),
          clean(req.body.notes),
        ]
      );

      return jsonOk(res, {
        message: "تم إضافة السجل الطبي",
        record: result.rows[0],
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر إضافة السجل الطبي"
      );
    }
  }
);

app.put(
  "/api/admin/medical-records/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          UPDATE medical_records
          SET
            diagnosis = $2,
            treatment = $3,
            prescription = $4,
            notes = $5,
            updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [
          req.params.id,
          clean(req.body.diagnosis),
          clean(req.body.treatment),
          clean(req.body.prescription),
          clean(req.body.notes),
        ]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          404,
          "السجل الطبي غير موجود"
        );
      }

      return jsonOk(res, {
        message: "تم تحديث السجل الطبي",
        record: result.rows[0],
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحديث السجل الطبي"
      );
    }
  }
);

app.delete(
  "/api/admin/medical-records/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          DELETE FROM medical_records
          WHERE id = $1
          RETURNING id
        `,
        [req.params.id]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          404,
          "السجل الطبي غير موجود"
        );
      }

      return jsonOk(res, {
        message: "تم حذف السجل الطبي",
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر حذف السجل الطبي"
      );
    }
  }
);

// ============================================================
// Admin ads
// ============================================================

app.get(
  "/api/admin/ads",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          SELECT
            a.*,

            (
              SELECT COUNT(*)::INTEGER
              FROM ad_impressions ai
              WHERE ai.ad_id = a.id
            ) AS impressions,

            (
              SELECT COUNT(*)::INTEGER
              FROM ad_clicks ac
              WHERE ac.ad_id = a.id
            ) AS clicks

          FROM ads a
          ORDER BY a.created_at DESC
        `
      );

      return jsonOk(res, {
        ads: result.rows,
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحميل الإعلانات"
      );
    }
  }
);

app.post(
  "/api/admin/ads",
  requireAdmin,
  async (req, res) => {
    try {
      const title =
        clean(req.body.title);

      if (!title) {
        return jsonError(
          res,
          400,
          "عنوان الإعلان مطلوب"
        );
      }

      const result = await pool.query(
        `
          INSERT INTO ads
            (
              id,
              title,
              description,
              image_url,
              target_url,
              advertiser_name,
              category,
              active,
              starts_at,
              ends_at
            )
          VALUES
            (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8,
              $9,
              $10
            )
          RETURNING *
        `,
        [
          makeId(),
          title,
          clean(req.body.description),
          clean(req.body.image_url),
          clean(req.body.target_url),
          clean(req.body.advertiser_name),
          clean(req.body.category),
          req.body.active !== false,
          req.body.starts_at || null,
          req.body.ends_at || null,
        ]
      );

      return jsonOk(res, {
        message: "تم إضافة الإعلان",
        ad: result.rows[0],
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر إضافة الإعلان"
      );
    }
  }
);

app.put(
  "/api/admin/ads/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          UPDATE ads
          SET
            title = COALESCE(
              NULLIF($2, ''),
              title
            ),
            description = $3,
            image_url = $4,
            target_url = $5,
            advertiser_name = $6,
            category = $7,
            starts_at = $8,
            ends_at = $9,
            updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [
          req.params.id,
          clean(req.body.title),
          clean(req.body.description),
          clean(req.body.image_url),
          clean(req.body.target_url),
          clean(req.body.advertiser_name),
          clean(req.body.category),
          req.body.starts_at || null,
          req.body.ends_at || null,
        ]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الإعلان غير موجود"
        );
      }

      return jsonOk(res, {
        message: "تم تحديث الإعلان",
        ad: result.rows[0],
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحديث الإعلان"
      );
    }
  }
);

app.patch(
  "/api/admin/ads/:id/status",
  requireAdmin,
  async (req, res) => {
    try {
      const active =
        req.body.active === true ||
        req.body.active === "true";

      const result = await pool.query(
        `
          UPDATE ads
          SET
            active = $2,
            updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [
          req.params.id,
          active,
        ]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الإعلان غير موجود"
        );
      }

      return jsonOk(res, {
        message: "تم تحديث حالة الإعلان",
        ad: result.rows[0],
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحديث حالة الإعلان"
      );
    }
  }
);

app.delete(
  "/api/admin/ads/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          DELETE FROM ads
          WHERE id = $1
          RETURNING id
        `,
        [req.params.id]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الإعلان غير موجود"
        );
      }

      return jsonOk(res, {
        message: "تم حذف الإعلان",
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر حذف الإعلان"
      );
    }
  }
);

// ============================================================
// Admin stats
// ============================================================

app.get(
  "/api/admin/stats",
  requireAdmin,
  async (req, res) => {
    try {
      const [
        patients,
        doctors,
        services,
        appointments,
        pending,
        confirmed,
        completed,
        cancelled,
        noShow,
        records,
        ads,
        schedules,
      ] = await Promise.all([
        pool.query(`
          SELECT COUNT(*)::INTEGER AS count
          FROM patients
        `),

        pool.query(`
          SELECT COUNT(*)::INTEGER AS count
          FROM doctors
          WHERE active = TRUE
        `),

        pool.query(`
          SELECT COUNT(*)::INTEGER AS count
          FROM services
          WHERE active = TRUE
        `),

        pool.query(`
          SELECT COUNT(*)::INTEGER AS count
          FROM appointments
        `),

        pool.query(`
          SELECT COUNT(*)::INTEGER AS count
          FROM appointments
          WHERE status = 'pending'
        `),

        pool.query(`
          SELECT COUNT(*)::INTEGER AS count
          FROM appointments
          WHERE status = 'confirmed'
        `),

        pool.query(`
          SELECT COUNT(*)::INTEGER AS count
          FROM appointments
          WHERE status = 'completed'
        `),

        pool.query(`
          SELECT COUNT(*)::INTEGER AS count
          FROM appointments
          WHERE status = 'cancelled'
        `),

        pool.query(`
          SELECT COUNT(*)::INTEGER AS count
          FROM appointments
          WHERE status = 'no_show'
        `),

        pool.query(`
          SELECT COUNT(*)::INTEGER AS count
          FROM medical_records
        `),

        pool.query(`
          SELECT COUNT(*)::INTEGER AS count
          FROM ads
          WHERE active = TRUE
        `),

        pool.query(`
          SELECT COUNT(*)::INTEGER AS count
          FROM doctor_schedules
          WHERE active = TRUE
        `),
      ]);

      return jsonOk(res, {
        stats: {
          patients: patients.rows[0].count,
          active_doctors:
            doctors.rows[0].count,
          active_services:
            services.rows[0].count,

          appointments:
            appointments.rows[0].count,

          pending:
            pending.rows[0].count,

          confirmed:
            confirmed.rows[0].count,

          completed:
            completed.rows[0].count,

          cancelled:
            cancelled.rows[0].count,

          no_show:
            noShow.rows[0].count,

          medical_records:
            records.rows[0].count,

          active_ads:
            ads.rows[0].count,

          active_schedules:
            schedules.rows[0].count,
        },
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحميل الإحصاءات"
      );
    }
  }
);

// ============================================================
// API 404
// ============================================================

app.use("/api", (req, res) => {
  return jsonError(
    res,
    404,
    "API endpoint غير موجود"
  );
});

// ============================================================
// SPA fallback
// ============================================================

app.get("*", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

// ============================================================
// Start server
// ============================================================

async function startServer() {
  try {
    console.log("Checking database connection...");

    await pool.query("SELECT 1");

    console.log("Database connection successful.");

    console.log("Initializing database...");
    await initDatabase();

    console.log("Creating indexes...");
    await createIndexes();

    console.log("Seeding services...");
    await seedServices();

    console.log("Seeding admin...");
    await seedAdmin();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(
        `Medical Booking server running on port ${PORT}`
      );
    });
  } catch (error) {
    console.error(
      "Failed to start server:",
      error
    );

    process.exit(1);
  }
}

startServer();

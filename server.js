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
    rejectUnauthorized: false
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   Helpers
========================================================= */

function jsonError(res, message, status = 400) {
  return res.status(status).json({
    ok: false,
    error: message
  });
}

function jsonOk(res, data = {}) {
  return res.json({
    ok: true,
    ...data
  });
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function validTime(value) {
  return /^\d{2}:\d{2}$/.test(String(value || ""));
}

function randomToken() {
  return crypto.randomBytes(48).toString("hex");
}

function hashToken(token) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

function makeId() {
  return crypto.randomUUID();
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return header.substring(7).trim();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");

  const hash = crypto.scryptSync(
    String(password),
    salt,
    64
  ).toString("hex");

  return {
    salt,
    hash
  };
}

function verifyPassword(password, salt, storedHash) {
  try {
    const hash = crypto
      .scryptSync(String(password), salt, 64)
      .toString("hex");

    return crypto.timingSafeEqual(
      Buffer.from(hash, "hex"),
      Buffer.from(storedHash, "hex")
    );
  } catch {
    return false;
  }
}

function mapPatient(row) {
  if (!row) return null;

  return {
    id: row.id,
    auth_user_id: row.auth_user_id,
    full_name: row.full_name || "",
    phone: row.phone || "",
    username: row.username || "",
    email: row.email || "",
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapService(row) {
  if (!row) return null;

  return {
    id: row.id,
    name: row.name || "",
    description: row.description || "",
    duration_minutes: Number(row.duration_minutes || 30),
    price: row.price == null ? null : Number(row.price),
    active: row.active !== false,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapDoctor(row) {
  if (!row) return null;

  return {
    id: row.id,
    full_name: row.full_name || "",
    phone: row.phone || "",
    username: row.username || "",
    role: row.role || "doctor",
    specialty: row.specialty || "",
    area: row.area || "",
    email: row.email || "",
    image_url: row.image_url || "",
    bio: row.bio || "",
    active: row.active !== false,
    available: row.available !== false,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapAppointment(row) {
  if (!row) return null;

  return {
    id: row.id,
    patient_id: row.patient_id,
    patient_name: row.patient_name || "",
    patient_phone: row.patient_phone || "",
    service_id: row.service_id,
    service_name: row.service_name || "",
    doctor_id: row.doctor_id || null,
    doctor_name: row.doctor_name || "",
    doctor_specialty: row.doctor_specialty || "",
    appointment_date: row.appointment_date,
    appointment_time: row.appointment_time,
    status: row.status || "pending",
    notes: row.notes || "",
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

/* =========================================================
   Database initialization
========================================================= */

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'patient',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      email TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS patients (
      id UUID PRIMARY KEY,
      auth_user_id UUID UNIQUE,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      username TEXT NOT NULL,
      email TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_users (
      id UUID PRIMARY KEY,
      auth_user_id UUID UNIQUE,
      full_name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      username TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'doctor',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      specialty TEXT DEFAULT '',
      area TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      available BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS services (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      duration_minutes INTEGER NOT NULL DEFAULT 30,
      price NUMERIC DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id UUID PRIMARY KEY,
      patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      service_id UUID NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
      doctor_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
      appointment_date DATE NOT NULL,
      appointment_time TIME NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS medical_records (
      id UUID PRIMARY KEY,
      patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      doctor_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
      appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
      diagnosis TEXT DEFAULT '',
      treatment TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      record_date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ads (
      id UUID PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      target_url TEXT DEFAULT '',
      advertiser_name TEXT DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_impressions (
      id UUID PRIMARY KEY,
      ad_id UUID NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_clicks (
      id UUID PRIMARY KEY,
      ad_id UUID NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      refresh_token_hash TEXT UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      refresh_expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  /*
   * Compatibility with databases created by older versions
   */

  await pool.query(`
    ALTER TABLE staff_users
      ADD COLUMN IF NOT EXISTS specialty TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS area TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS available BOOLEAN NOT NULL DEFAULT TRUE;
  `);

  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS email TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  `);

  await pool.query(`
    ALTER TABLE patients
      ADD COLUMN IF NOT EXISTS auth_user_id UUID,
      ADD COLUMN IF NOT EXISTS email TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  `);

  await pool.query(`
    ALTER TABLE appointments
      ADD COLUMN IF NOT EXISTS doctor_id UUID,
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  `);

  /*
   * Indexes
   */

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_username
    ON users(username);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_patients_auth_user
    ON patients(auth_user_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_staff_auth_user
    ON staff_users(auth_user_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_staff_role_active
    ON staff_users(role, active, available);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_appointments_patient
    ON appointments(patient_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_appointments_doctor
    ON appointments(doctor_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_appointments_date_time
    ON appointments(appointment_date, appointment_time);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_medical_records_patient
    ON medical_records(patient_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ads_active
    ON ads(active);
  `);

  /*
   * Seed services
   */

  const serviceCount = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM services
  `);

  if (Number(serviceCount.rows[0].count) === 0) {
    const services = [
      ["كشف طبي", "كشف واستشارة طبية عامة", 30, 0],
      ["استشارة", "استشارة طبية", 30, 0],
      ["متابعة", "متابعة الحالة الصحية", 30, 0],
      ["فحص وتشخيص", "فحص وتشخيص أولي", 45, 0]
    ];

    for (const service of services) {
      await pool.query(
        `
        INSERT INTO services
          (id, name, description, duration_minutes, price, active)
        VALUES
          ($1, $2, $3, $4, $5, TRUE)
        `,
        [makeId(), ...service]
      );
    }
  }

  /*
   * Seed administrator
   *
   * FIX:
   * Explicitly generate UUIDs for users.id and staff_users.id.
   */

  const adminUsername = normalizeUsername(
    process.env.ADMIN_USERNAME
  );

  const adminPassword = String(
    process.env.ADMIN_PASSWORD || ""
  );

  const adminName =
    String(process.env.ADMIN_NAME || "مدير منصة موعدي").trim();

  if (adminUsername && adminPassword) {
    try {
      const existing = await pool.query(
        `
        SELECT *
        FROM users
        WHERE username = $1
        LIMIT 1
        `,
        [adminUsername]
      );

      let adminUser;

      if (existing.rows.length > 0) {
        adminUser = existing.rows[0];

        const passwordData = hashPassword(adminPassword);

        await pool.query(
          `
          UPDATE users
          SET
            password_hash = $1,
            password_salt = $2,
            role = 'admin',
            active = TRUE,
            email = COALESCE(email, ''),
            updated_at = NOW()
          WHERE id = $3
          `,
          [
            passwordData.hash,
            passwordData.salt,
            adminUser.id
          ]
        );
      } else {
        const passwordData = hashPassword(adminPassword);

        const userId = makeId();

        const result = await pool.query(
          `
          INSERT INTO users
            (
              id,
              username,
              password_hash,
              password_salt,
              role,
              active,
              email
            )
          VALUES
            ($1, $2, $3, $4, 'admin', TRUE, '')
          RETURNING *
          `,
          [
            userId,
            adminUsername,
            passwordData.hash,
            passwordData.salt
          ]
        );

        adminUser = result.rows[0];
      }

      /*
       * Make sure the administrator also exists in staff_users.
       */

      const staffExisting = await pool.query(
        `
        SELECT *
        FROM staff_users
        WHERE auth_user_id = $1
        LIMIT 1
        `,
        [adminUser.id]
      );

      if (staffExisting.rows.length > 0) {
        await pool.query(
          `
          UPDATE staff_users
          SET
            full_name = $1,
            username = $2,
            role = 'admin',
            active = TRUE,
            available = TRUE,
            updated_at = NOW()
          WHERE auth_user_id = $3
          `,
          [
            adminName,
            adminUsername,
            adminUser.id
          ]
        );
      } else {
        await pool.query(
          `
          INSERT INTO staff_users
            (
              id,
              auth_user_id,
              full_name,
              phone,
              username,
              role,
              active,
              available
            )
          VALUES
            ($1, $2, $3, '', $4, 'admin', TRUE, TRUE)
          `,
          [
            makeId(),
            adminUser.id,
            adminName,
            adminUsername
          ]
        );
      }

      console.log(
        `Admin seed successful for username: ${adminUsername}`
      );
    } catch (error) {
      console.error("Admin seed error:", error.message);
    }
  } else {
    console.log(
      "Admin seed skipped: ADMIN_USERNAME or ADMIN_PASSWORD is missing."
    );
  }
}

/* =========================================================
   Authentication
========================================================= */

async function createSession(userId) {
  const accessToken = randomToken();
  const refreshToken = randomToken();

  const tokenHash = hashToken(accessToken);
  const refreshTokenHash = hashToken(refreshToken);

  const sessionId = makeId();

  await pool.query(
    `
    INSERT INTO sessions
      (
        id,
        user_id,
        token_hash,
        refresh_token_hash,
        expires_at,
        refresh_expires_at
      )
    VALUES
      (
        $1,
        $2,
        $3,
        $4,
        NOW() + INTERVAL '30 days',
        NOW() + INTERVAL '90 days'
      )
    `,
    [
      sessionId,
      userId,
      tokenHash,
      refreshTokenHash
    ]
  );

  return {
    access_token: accessToken,
    refresh_token: refreshToken
  };
}

async function authenticate(req) {
  const token = getBearerToken(req);

  if (!token) {
    return null;
  }

  const tokenHash = hashToken(token);

  const result = await pool.query(
    `
    SELECT
      u.*,
      s.id AS session_id
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE
      s.token_hash = $1
      AND s.expires_at > NOW()
      AND u.active = TRUE
    LIMIT 1
    `,
    [tokenHash]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

async function requireAuth(req, res, next) {
  try {
    const user = await authenticate(req);

    if (!user) {
      return jsonError(
        res,
        "يجب تسجيل الدخول أولاً.",
        401
      );
    }

    req.user = user;
    next();
  } catch (error) {
    console.error(error);
    return jsonError(
      res,
      "حدث خطأ أثناء التحقق من الحساب.",
      500
    );
  }
}

async function requirePatient(req, res, next) {
  await requireAuth(req, res, async () => {
    if (req.user.role !== "patient") {
      return jsonError(
        res,
        "هذا الإجراء مخصص للمرضى.",
        403
      );
    }

    next();
  });
}

async function requireStaff(req, res, next) {
  await requireAuth(req, res, async () => {
    if (
      !["admin", "doctor", "secretary"].includes(
        req.user.role
      )
    ) {
      return jsonError(
        res,
        "ليس لديك صلاحية الوصول.",
        403
      );
    }

    next();
  });
}

async function requireAdmin(req, res, next) {
  await requireAuth(req, res, async () => {
    if (req.user.role !== "admin") {
      return jsonError(
        res,
        "هذه العملية مخصصة للمدير.",
        403
      );
    }

    next();
  });
}

/* =========================================================
   Health
========================================================= */

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    return res.json({
      ok: true,
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
    return res.status(500).json({
      ok: false,
      database: "neon",
      postgres: false,
      error: error.message
    });
  }
});

app.get("/api/config", (req, res) => {
  return res.json({
    ok: true,
    app: "medical-booking",
    name: "منصة موعدي",
    database: "neon"
  });
});

/* =========================================================
   Patient registration
========================================================= */

app.post("/api/patient/register", async (req, res) => {
  try {
    const {
      username,
      full_name,
      phone,
      email,
      password
    } = req.body || {};

    const normalizedUsername =
      normalizeUsername(username);

    if (!normalizedUsername) {
      return jsonError(
        res,
        "اسم المستخدم مطلوب."
      );
    }

    if (!full_name || !String(full_name).trim()) {
      return jsonError(
        res,
        "الاسم الكامل مطلوب."
      );
    }

    if (!phone || !String(phone).trim()) {
      return jsonError(
        res,
        "رقم الهاتف مطلوب."
      );
    }

    if (!password || String(password).length < 6) {
      return jsonError(
        res,
        "كلمة المرور يجب أن تكون 6 أحرف على الأقل."
      );
    }

    const existing = await pool.query(
      `
      SELECT id
      FROM users
      WHERE username = $1
      LIMIT 1
      `,
      [normalizedUsername]
    );

    if (existing.rows.length > 0) {
      return jsonError(
        res,
        "اسم المستخدم مستخدم بالفعل."
      );
    }

    const passwordData = hashPassword(password);

    const userId = makeId();
    const patientId = makeId();

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `
        INSERT INTO users
          (
            id,
            username,
            password_hash,
            password_salt,
            role,
            active,
            email
          )
        VALUES
          ($1, $2, $3, $4, 'patient', TRUE, $5)
        `,
        [
          userId,
          normalizedUsername,
          passwordData.hash,
          passwordData.salt,
          email || ""
        ]
      );

      await client.query(
        `
        INSERT INTO patients
          (
            id,
            auth_user_id,
            full_name,
            phone,
            username,
            email
          )
        VALUES
          ($1, $2, $3, $4, $5, $6)
        `,
        [
          patientId,
          userId,
          String(full_name).trim(),
          String(phone).trim(),
          normalizedUsername,
          email || ""
        ]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const tokens = await createSession(userId);

    return res.status(201).json({
      ok: true,
      user: {
        id: userId,
        username: normalizedUsername,
        full_name: String(full_name).trim(),
        phone: String(phone).trim(),
        email: email || "",
        role: "patient"
      },
      ...tokens
    });
  } catch (error) {
    console.error("Patient register:", error);

    if (error.code === "23505") {
      return jsonError(
        res,
        "اسم المستخدم مستخدم بالفعل."
      );
    }

    return jsonError(
      res,
      "تعذر إنشاء الحساب.",
      500
    );
  }
});

/* =========================================================
   Patient login
========================================================= */

app.post("/api/patient/login", async (req, res) => {
  try {
    const {
      username,
      password
    } = req.body || {};

    const normalizedUsername =
      normalizeUsername(username);

    if (!normalizedUsername || !password) {
      return jsonError(
        res,
        "اسم المستخدم وكلمة المرور مطلوبان."
      );
    }

    const result = await pool.query(
      `
      SELECT *
      FROM users
      WHERE username = $1
      LIMIT 1
      `,
      [normalizedUsername]
    );

    if (result.rows.length === 0) {
      return jsonError(
        res,
        "بيانات الدخول غير صحيحة.",
        401
      );
    }

    const user = result.rows[0];

    if (!user.active) {
      return jsonError(
        res,
        "الحساب غير مفعل.",
        403
      );
    }

    if (
      !verifyPassword(
        password,
        user.password_salt,
        user.password_hash
      )
    ) {
      return jsonError(
        res,
        "بيانات الدخول غير صحيحة.",
        401
      );
    }

    if (user.role !== "patient") {
      return jsonError(
        res,
        "هذا الحساب ليس حساب مريض.",
        403
      );
    }

    const patientResult = await pool.query(
      `
      SELECT *
      FROM patients
      WHERE auth_user_id = $1
      LIMIT 1
      `,
      [user.id]
    );

    const patient = patientResult.rows[0];

    const tokens = await createSession(user.id);

    return res.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email || "",
        full_name: patient?.full_name || "",
        phone: patient?.phone || ""
      },
      patient: mapPatient(patient),
      ...tokens
    });
  } catch (error) {
    console.error("Patient login:", error);

    return jsonError(
      res,
      "حدث خطأ أثناء تسجيل الدخول.",
      500
    );
  }
});

/* =========================================================
   Staff login
========================================================= */

app.post("/api/staff/login", async (req, res) => {
  try {
    const {
      username,
      password
    } = req.body || {};

    const normalizedUsername =
      normalizeUsername(username);

    if (!normalizedUsername || !password) {
      return jsonError(
        res,
        "اسم المستخدم وكلمة المرور مطلوبان."
      );
    }

    const result = await pool.query(
      `
      SELECT *
      FROM users
      WHERE username = $1
      LIMIT 1
      `,
      [normalizedUsername]
    );

    if (result.rows.length === 0) {
      return jsonError(
        res,
        "بيانات الدخول غير صحيحة.",
        401
      );
    }

    const user = result.rows[0];

    if (!user.active) {
      return jsonError(
        res,
        "الحساب غير مفعل.",
        403
      );
    }

    if (
      !verifyPassword(
        password,
        user.password_salt,
        user.password_hash
      )
    ) {
      return jsonError(
        res,
        "بيانات الدخول غير صحيحة.",
        401
      );
    }

    if (
      !["admin", "doctor", "secretary"].includes(
        user.role
      )
    ) {
      return jsonError(
        res,
        "ليس لديك صلاحية الدخول إلى لوحة الإدارة.",
        403
      );
    }

    const staffResult = await pool.query(
      `
      SELECT
        s.*,
        u.email
      FROM staff_users s
      LEFT JOIN users u
        ON u.id = s.auth_user_id
      WHERE s.auth_user_id = $1
      LIMIT 1
      `,
      [user.id]
    );

    const staff = staffResult.rows[0];

    const tokens = await createSession(user.id);

    return res.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email || "",
        full_name: staff?.full_name || ""
      },
      staff: mapDoctor(staff),
      ...tokens
    });
  } catch (error) {
    console.error("Staff login:", error);

    return jsonError(
      res,
      "حدث خطأ أثناء تسجيل الدخول.",
      500
    );
  }
});

/* =========================================================
   Login aliases
========================================================= */

app.post("/api/admin/login", async (req, res) => {
  req.url = "/api/staff/login";
  return app.handle(req, res);
});

app.post("/api/login", async (req, res) => {
  req.url = "/api/staff/login";
  return app.handle(req, res);
});

/* =========================================================
   Refresh token
========================================================= */

app.post("/api/refresh", async (req, res) => {
  try {
    const refreshToken =
      req.body?.refresh_token ||
      req.body?.refreshToken;

    if (!refreshToken) {
      return jsonError(
        res,
        "Refresh token مطلوب.",
        401
      );
    }

    const refreshHash =
      hashToken(refreshToken);

    const result = await pool.query(
      `
      SELECT u.*, s.id AS session_id
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE
        s.refresh_token_hash = $1
        AND s.refresh_expires_at > NOW()
        AND u.active = TRUE
      LIMIT 1
      `,
      [refreshHash]
    );

    if (result.rows.length === 0) {
      return jsonError(
        res,
        "جلسة الدخول منتهية.",
        401
      );
    }

    const user = result.rows[0];

    await pool.query(
      `
      DELETE FROM sessions
      WHERE id = $1
      `,
      [user.session_id]
    );

    const tokens =
      await createSession(user.id);

    return res.json({
      ok: true,
      ...tokens
    });
  } catch (error) {
    console.error(error);

    return jsonError(
      res,
      "تعذر تحديث الجلسة.",
      500
    );
  }
});

/* =========================================================
   Current user
========================================================= */

app.get("/api/patient/me", requireAuth, async (req, res) => {
  try {
    const patientResult = await pool.query(
      `
      SELECT *
      FROM patients
      WHERE auth_user_id = $1
      LIMIT 1
      `,
      [req.user.id]
    );

    return jsonOk(res, {
      user: {
        id: req.user.id,
        username: req.user.username,
        role: req.user.role,
        email: req.user.email || ""
      },
      patient: mapPatient(patientResult.rows[0])
    });
  } catch (error) {
    console.error(error);

    return jsonError(
      res,
      "تعذر جلب بيانات الحساب.",
      500
    );
  }
});

app.get("/api/staff/me", requireStaff, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        s.*,
        u.email
      FROM staff_users s
      LEFT JOIN users u
        ON u.id = s.auth_user_id
      WHERE s.auth_user_id = $1
      LIMIT 1
      `,
      [req.user.id]
    );

    return jsonOk(res, {
      user: {
        id: req.user.id,
        username: req.user.username,
        role: req.user.role,
        email: req.user.email || ""
      },
      staff: mapDoctor(result.rows[0])
    });
  } catch (error) {
    console.error(error);

    return jsonError(
      res,
      "تعذر جلب بيانات الموظف.",
      500
    );
  }
});

/* =========================================================
   Logout
========================================================= */

app.post("/api/logout", requireAuth, async (req, res) => {
  try {
    const token = getBearerToken(req);

    if (token) {
      await pool.query(
        `
        DELETE FROM sessions
        WHERE token_hash = $1
        `,
        [hashToken(token)]
      );
    }

    return jsonOk(res);
  } catch (error) {
    console.error(error);

    return jsonError(
      res,
      "تعذر تسجيل الخروج.",
      500
    );
  }
});

/* =========================================================
   Services - public
========================================================= */

app.get("/api/services", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT *
      FROM services
      WHERE active = TRUE
      ORDER BY created_at ASC
      `
    );

    return jsonOk(res, {
      services: result.rows.map(mapService)
    });
  } catch (error) {
    console.error(error);

    return jsonError(
      res,
      "تعذر جلب الخدمات.",
      500
    );
  }
});

/* =========================================================
   Doctors - public
========================================================= */

app.get("/api/doctors", async (req, res) => {
  try {
    const {
      search = "",
      specialty = "",
      area = ""
    } = req.query;

    const conditions = [
      "s.role = 'doctor'",
      "s.active = TRUE",
      "s.available = TRUE"
    ];

    const params = [];

    if (search) {
      params.push(`%${String(search).trim()}%`);

      conditions.push(`
        (
          s.full_name ILIKE $${params.length}
          OR s.specialty ILIKE $${params.length}
          OR s.area ILIKE $${params.length}
        )
      `);
    }

    if (specialty) {
      params.push(`%${String(specialty).trim()}%`);

      conditions.push(
        `s.specialty ILIKE $${params.length}`
      );
    }

    if (area) {
      params.push(`%${String(area).trim()}%`);

      conditions.push(
        `s.area ILIKE $${params.length}`
      );
    }

    const result = await pool.query(
      `
      SELECT
        s.*,
        u.email
      FROM staff_users s
      LEFT JOIN users u
        ON u.id = s.auth_user_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY s.created_at ASC
      `,
      params
    );

    return jsonOk(res, {
      doctors: result.rows.map(mapDoctor)
    });
  } catch (error) {
    console.error("Doctors:", error);

    return jsonError(
      res,
      "تعذر جلب الأطباء.",
      500
    );
  }
});

app.get("/api/doctors/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        s.*,
        u.email
      FROM staff_users s
      LEFT JOIN users u
        ON u.id = s.auth_user_id
      WHERE
        s.id = $1
        AND s.role = 'doctor'
        AND s.active = TRUE
        AND s.available = TRUE
      LIMIT 1
      `,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return jsonError(
        res,
        "الطبيب غير موجود.",
        404
      );
    }

    return jsonOk(res, {
      doctor: mapDoctor(result.rows[0])
    });
  } catch (error) {
    console.error(error);

    return jsonError(
      res,
      "تعذر جلب بيانات الطبيب.",
      500
    );
  }
});

/* =========================================================
   Create appointment
========================================================= */

app.post(
  "/api/appointments",
  requirePatient,
  async (req, res) => {
    try {
      const {
        service_id,
        doctor_id,
        appointment_date,
        appointment_time,
        notes
      } = req.body || {};

      if (!service_id) {
        return jsonError(
          res,
          "الخدمة مطلوبة."
        );
      }

      if (!validDate(appointment_date)) {
        return jsonError(
          res,
          "تاريخ الموعد غير صحيح."
        );
      }

      if (!validTime(appointment_time)) {
        return jsonError(
          res,
          "وقت الموعد غير صحيح."
        );
      }

      const patientResult = await pool.query(
        `
        SELECT *
        FROM patients
        WHERE auth_user_id = $1
        LIMIT 1
        `,
        [req.user.id]
      );

      if (patientResult.rows.length === 0) {
        return jsonError(
          res,
          "لم يتم العثور على ملف المريض.",
          404
        );
      }

      const patient = patientResult.rows[0];

      const serviceResult = await pool.query(
        `
        SELECT *
        FROM services
        WHERE id = $1
          AND active = TRUE
        LIMIT 1
        `,
        [service_id]
      );

      if (serviceResult.rows.length === 0) {
        return jsonError(
          res,
          "الخدمة غير موجودة.",
          404
        );
      }

      if (doctor_id) {
        const doctorResult = await pool.query(
          `
          SELECT *
          FROM staff_users
          WHERE
            id = $1
            AND role = 'doctor'
            AND active = TRUE
            AND available = TRUE
          LIMIT 1
          `,
          [doctor_id]
        );

        if (doctorResult.rows.length === 0) {
          return jsonError(
            res,
            "الطبيب غير متاح حالياً.",
            400
          );
        }

        const conflict = await pool.query(
          `
          SELECT id
          FROM appointments
          WHERE
            doctor_id = $1
            AND appointment_date = $2
            AND appointment_time = $3
            AND status NOT IN ('cancelled', 'rejected')
          LIMIT 1
          `,
          [
            doctor_id,
            appointment_date,
            appointment_time
          ]
        );

        if (conflict.rows.length > 0) {
          return jsonError(
            res,
            "هذا الموعد محجوز بالفعل للطبيب.",
            409
          );
        }
      } else {
        const conflict = await pool.query(
          `
          SELECT id
          FROM appointments
          WHERE
            doctor_id IS NULL
            AND appointment_date = $1
            AND appointment_time = $2
            AND status NOT IN ('cancelled', 'rejected')
          LIMIT 1
          `,
          [
            appointment_date,
            appointment_time
          ]
        );

        if (conflict.rows.length > 0) {
          return jsonError(
            res,
            "هذا الوقت محجوز بالفعل.",
            409
          );
        }
      }

      const appointmentId = makeId();

      const result = await pool.query(
        `
        INSERT INTO appointments
          (
            id,
            patient_id,
            service_id,
            doctor_id,
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
            'pending',
            $7
          )
        RETURNING *
        `,
        [
          appointmentId,
          patient.id,
          service_id,
          doctor_id || null,
          appointment_date,
          appointment_time,
          notes || ""
        ]
      );

      return res.status(201).json({
        ok: true,
        appointment: {
          id: result.rows[0].id,
          status: "pending"
        }
      });
    } catch (error) {
      console.error(
        "Create appointment:",
        error
      );

      if (error.code === "23505") {
        return jsonError(
          res,
          "هذا الموعد محجوز بالفعل.",
          409
        );
      }

      return jsonError(
        res,
        "تعذر إنشاء الموعد.",
        500
      );
    }
  }
);

/* =========================================================
   Patient appointments
========================================================= */

app.get(
  "/api/my-appointments",
  requirePatient,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          a.*,
          p.full_name AS patient_name,
          p.phone AS patient_phone,
          s.name AS service_name,
          d.full_name AS doctor_name,
          d.specialty AS doctor_specialty
        FROM appointments a
        JOIN patients p
          ON p.id = a.patient_id
        JOIN services s
          ON s.id = a.service_id
        LEFT JOIN staff_users d
          ON d.id = a.doctor_id
        WHERE p.auth_user_id = $1
        ORDER BY
          a.appointment_date DESC,
          a.appointment_time DESC
        `,
        [req.user.id]
      );

      return jsonOk(res, {
        appointments:
          result.rows.map(mapAppointment)
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "تعذر جلب المواعيد.",
        500
      );
    }
  }
);

app.get(
  "/api/patient/appointments",
  requirePatient,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          a.*,
          p.full_name AS patient_name,
          p.phone AS patient_phone,
          s.name AS service_name,
          d.full_name AS doctor_name,
          d.specialty AS doctor_specialty
        FROM appointments a
        JOIN patients p
          ON p.id = a.patient_id
        JOIN services s
          ON s.id = a.service_id
        LEFT JOIN staff_users d
          ON d.id = a.doctor_id
        WHERE p.auth_user_id = $1
        ORDER BY
          a.appointment_date DESC,
          a.appointment_time DESC
        `,
        [req.user.id]
      );

      return jsonOk(res, {
        appointments:
          result.rows.map(mapAppointment)
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "تعذر جلب المواعيد.",
        500
      );
    }
  }
);

/* =========================================================
   Ads - public
========================================================= */

app.get("/api/ads", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT *
      FROM ads
      WHERE
        active = TRUE
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
      ads: result.rows
    });
  } catch (error) {
    console.error(error);

    return jsonError(
      res,
      "تعذر جلب الإعلانات.",
      500
    );
  }
});

app.post("/api/ads/:id/impression", async (req, res) => {
  try {
    await pool.query(
      `
      INSERT INTO ad_impressions
        (id, ad_id)
      VALUES
        ($1, $2)
      `,
      [makeId(), req.params.id]
    );

    return jsonOk(res);
  } catch (error) {
    console.error(error);

    return jsonError(
      res,
      "تعذر تسجيل المشاهدة.",
      500
    );
  }
});

app.post("/api/ads/:id/click", async (req, res) => {
  try {
    await pool.query(
      `
      INSERT INTO ad_clicks
        (id, ad_id)
      VALUES
        ($1, $2)
      `,
      [makeId(), req.params.id]
    );

    return jsonOk(res);
  } catch (error) {
    console.error(error);

    return jsonError(
      res,
      "تعذر تسجيل النقرة.",
      500
    );
  }
});

/* =========================================================
   Dashboard statistics
========================================================= */

app.get(
  "/api/dashboard/stats",
  requireAdmin,
  async (req, res) => {
    try {
      const [
        patients,
        doctors,
        appointments,
        pending,
        confirmed,
        services,
        ads
      ] = await Promise.all([
        pool.query(
          `SELECT COUNT(*)::int AS count FROM patients`
        ),
        pool.query(
          `
          SELECT COUNT(*)::int AS count
          FROM staff_users
          WHERE role = 'doctor'
            AND active = TRUE
          `
        ),
        pool.query(
          `SELECT COUNT(*)::int AS count FROM appointments`
        ),
        pool.query(
          `
          SELECT COUNT(*)::int AS count
          FROM appointments
          WHERE status = 'pending'
          `
        ),
        pool.query(
          `
          SELECT COUNT(*)::int AS count
          FROM appointments
          WHERE status = 'confirmed'
          `
        ),
        pool.query(
          `
          SELECT COUNT(*)::int AS count
          FROM services
          WHERE active = TRUE
          `
        ),
        pool.query(
          `
          SELECT COUNT(*)::int AS count
          FROM ads
          WHERE active = TRUE
          `
        )
      ]);

      return jsonOk(res, {
        stats: {
          patients:
            Number(patients.rows[0].count),
          doctors:
            Number(doctors.rows[0].count),
          appointments:
            Number(appointments.rows[0].count),
          pending:
            Number(pending.rows[0].count),
          confirmed:
            Number(confirmed.rows[0].count),
          services:
            Number(services.rows[0].count),
          ads:
            Number(ads.rows[0].count)
        }
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "تعذر جلب إحصائيات لوحة الإدارة.",
        500
      );
    }
  }
);

/* =========================================================
   Dashboard appointments
========================================================= */

app.get(
  "/api/dashboard/appointments",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          a.*,
          p.full_name AS patient_name,
          p.phone AS patient_phone,
          s.name AS service_name,
          d.full_name AS doctor_name,
          d.specialty AS doctor_specialty
        FROM appointments a
        JOIN patients p
          ON p.id = a.patient_id
        JOIN services s
          ON s.id = a.service_id
        LEFT JOIN staff_users d
          ON d.id = a.doctor_id
        ORDER BY
          a.appointment_date DESC,
          a.appointment_time DESC,
          a.created_at DESC
        `
      );

      return jsonOk(res, {
        appointments:
          result.rows.map(mapAppointment)
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "تعذر جلب المواعيد.",
        500
      );
    }
  }
);

app.patch(
  "/api/dashboard/appointments/:id/confirm",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        UPDATE appointments
        SET
          status = 'confirmed',
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
        `,
        [req.params.id]
      );

      if (result.rows.length === 0) {
        return jsonError(
          res,
          "الموعد غير موجود.",
          404
        );
      }

      return jsonOk(res, {
        appointment: result.rows[0]
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "تعذر تأكيد الموعد.",
        500
      );
    }
  }
);

app.patch(
  "/api/dashboard/appointments/:id/cancel",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        UPDATE appointments
        SET
          status = 'cancelled',
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
        `,
        [req.params.id]
      );

      if (result.rows.length === 0) {
        return jsonError(
          res,
          "الموعد غير موجود.",
          404
        );
      }

      return jsonOk(res, {
        appointment: result.rows[0]
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "تعذر إلغاء الموعد.",
        500
      );
    }
  }
);

/* =========================================================
   Dashboard patients
========================================================= */

app.get(
  "/api/dashboard/patients",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          p.*,
          COUNT(a.id)::int AS appointments_count
        FROM patients p
        LEFT JOIN appointments a
          ON a.patient_id = p.id
        GROUP BY p.id
        ORDER BY p.created_at DESC
        `
      );

      return jsonOk(res, {
        patients: result.rows
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "تعذر جلب المرضى.",
        500
      );
    }
  }
);

/* =========================================================
   Medical records
========================================================= */

app.get(
  "/api/dashboard/patients/:patientId/medical-records",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          m.*,
          d.full_name AS doctor_name
        FROM medical_records m
        LEFT JOIN staff_users d
          ON d.id = m.doctor_id
        WHERE m.patient_id = $1
        ORDER BY
          m.record_date DESC,
          m.created_at DESC
        `,
        [req.params.patientId]
      );

      return jsonOk(res, {
        records: result.rows
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "تعذر جلب السجل الطبي.",
        500
      );
    }
  }
);

app.post(
  "/api/dashboard/patients/:patientId/medical-records",
  requireAdmin,
  async (req, res) => {
    try {
      const {
        doctor_id,
        appointment_id,
        diagnosis,
        treatment,
        notes,
        record_date
      } = req.body || {};

      const patient = await pool.query(
        `
        SELECT id
        FROM patients
        WHERE id = $1
        LIMIT 1
        `,
        [req.params.patientId]
      );

      if (patient.rows.length === 0) {
        return jsonError(
          res,
          "المريض غير موجود.",
          404
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
            notes,
            record_date
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
            COALESCE($8::date, CURRENT_DATE)
          )
        RETURNING *
        `,
        [
          makeId(),
          req.params.patientId,
          doctor_id || null,
          appointment_id || null,
          diagnosis || "",
          treatment || "",
          notes || "",
          record_date || null
        ]
      );

      return res.status(201).json({
        ok: true,
        record: result.rows[0]
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "تعذر إضافة السجل الطبي.",
        500
      );
    }
  }
);

/* =========================================================
   Dashboard services
========================================================= */

app.get(
  "/api/dashboard/services",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT *
        FROM services
        ORDER BY created_at ASC
        `
      );

      return jsonOk(res, {
        services:
          result.rows.map(mapService)
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "تعذر جلب الخدمات.",
        500
      );
    }
  }
);

app.post(
  "/api/dashboard/services",
  requireAdmin,
  async (req, res) => {
    try {
      const {
        name,
        description,
        duration_minutes,
        price,
        active
      } = req.body || {};

      if (!name || !String(name).trim()) {
        return jsonError(
          res,
          "اسم الخدمة مطلوب."
        );
      }

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
          String(name).trim(),
          description || "",
          Number(duration_minutes || 30),
          Number(price || 0),
          active !== false
        ]
      );

      return res.status(201).json({
        ok: true,
        service: mapService(result.rows[0])
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "تعذر إضافة الخدمة.",
        500
      );
    }
  }
);

app.patch(
  "/api/dashboard/services/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const {
        name,
        description,
        duration_minutes,
        price,
        active
      } = req.body || {};

      const result = await pool.query(
        `
        UPDATE services
        SET
          name = COALESCE($1, name),
          description = COALESCE($2, description),
          duration_minutes = COALESCE($3, duration_minutes),
          price = COALESCE($4, price),
          active = COALESCE($5, active),
          updated_at = NOW()
        WHERE id = $6
        RETURNING *
        `,
        [
          name == null ? null : String(name).trim(),
          description == null ? null : description,
          duration_minutes == null
            ? null
            : Number(duration_minutes),
          price == null ? null : Number(price),
          active == null ? null : Boolean(active),
          req.params.id
        ]
      );

      if (result.rows.length === 0) {
        return jsonError(
          res,
          "الخدمة غير موجودة.",
          404
        );
      }

      return jsonOk(res, {
        service: mapService(result.rows[0])
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "تعذر تعديل الخدمة.",
        500
      );
    }
  }
);

app.delete(
  "/api/dashboard/services/:id",
  requireAdmin,
  async (req, res) => {
    try {
      await pool.query(
        `
        UPDATE services
        SET
          active = FALSE,
          updated_at = NOW()
        WHERE id = $1
        `,
        [req.params.id]
      );

      return jsonOk(res);
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "تعذر حذف الخدمة.",
        500
      );
    }
  }
);

/* =========================================================
   Dashboard doctors
========================================================= */

app.get(
  "/api/dashboard/doctors",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          s.*,
          u.email
        FROM staff_users s
        LEFT JOIN users u
          ON u.id = s.auth_user_id
        WHERE s.role = 'doctor'
        ORDER BY s.created_at DESC
        `
      );

      return jsonOk(res, {
        doctors:
          result.rows.map(mapDoctor)
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "تعذر جلب الأطباء.",
        500
      );
    }
  }
);

app.post(
  "/api/dashboard/doctors",
  requireAdmin,
  async (req, res) => {
    try {
      const {
        username,
        password,
        full_name,
        phone,
        email,
        specialty,
        area,
        image_url,
        bio,
        active,
        available
      } = req.body || {};

      const normalizedUsername =
        normalizeUsername(username);

      if (!normalizedUsername) {
        return jsonError(
          res,
          "اسم مستخدم الطبيب مطلوب."
        );
      }

      if (!password || String(password).length < 6) {
        return jsonError(
          res,
          "كلمة مرور الطبيب يجب أن تكون 6 أحرف على الأقل."
        );
      }

      if (!full_name || !String(full_name).trim()) {
        return jsonError(
          res,
          "اسم الطبيب مطلوب."
        );
      }

      const existing = await pool.query(
        `
        SELECT id
        FROM users
        WHERE username = $1
        LIMIT 1
        `,
        [normalizedUsername]
      );

      if (existing.rows.length > 0) {
        return jsonError(
          res,
          "اسم المستخدم مستخدم بالفعل."
        );
      }

      const passwordData =
        hashPassword(password);

      const userId = makeId();
      const doctorId = makeId();

      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        await client.query(
          `
          INSERT INTO users
            (
              id,
              username,
              password_hash,
              password_salt,
              role,
              active,
              email
            )
          VALUES
            (
              $1,
              $2,
              $3,
              $4,
              'doctor',
              $5,
              $6
            )
          `,
          [
            userId,
            normalizedUsername,
            passwordData.hash,
            passwordData.salt,
            active !== false,
            email || ""
          ]
        );

        const staffResult =
          await client.query(
            `
            INSERT INTO staff_users
              (
                id,
                auth_user_id,
                full_name,
                phone,
                username,
                role,
                active,
                specialty,
                area,
                image_url,
                bio,
                available
              )
            VALUES
              (
                $1,
                $2,
                $3,
                $4,
                $5,
                'doctor',
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
              doctorId,
              userId,
              String(full_name).trim(),
              phone || "",
              normalizedUsername,
              active !== false,
              specialty || "",
              area || "",
              image_url || "",
              bio || "",
              available !== false
            ]
          );

        await client.query("COMMIT");

        const doctor = staffResult.rows[0];

        return res.status(201).json({
          ok: true,
          doctor: mapDoctor(doctor)
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error(
        "Create doctor:",
        error
      );

      if (error.code === "23505") {
        return jsonError(
          res,
          "اسم المستخدم مستخدم بالفعل."
        );
      }

      return jsonError(
        res,
        "تعذر إنشاء الطبيب.",
        500
      );
    }
  }
);

app.patch(
  "/api/dashboard/doctors/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const {
        full_name,
        phone,
        email,
        specialty,
        area,
        image_url,
        bio,
        active,
        available,
        password
      } = req.body || {};

      const doctorResult = await pool.query(
        `
        SELECT *
        FROM staff_users
        WHERE
          id = $1
          AND role = 'doctor'
        LIMIT 1
        `,
        [req.params.id]
      );

      if (doctorResult.rows.length === 0) {
        return jsonError(
          res,
          "الطبيب غير موجود.",
          404
        );
      }

      const doctor = doctorResult.rows[0];

      const userResult = await pool.query(
        `
        SELECT *
        FROM users
        WHERE id = $1
        LIMIT 1
        `,
        [doctor.auth_user_id]
      );

      if (userResult.rows.length === 0) {
        return jsonError(
          res,
          "حساب الطبيب غير موجود.",
          404
        );
      }

      const user = userResult.rows[0];

      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        await client.query(
          `
          UPDATE staff_users
          SET
            full_name = COALESCE($1, full_name),
            phone = COALESCE($2, phone),
            specialty = COALESCE($3, specialty),
            area = COALESCE($4, area),
            image_url = COALESCE($5, image_url),
            bio = COALESCE($6, bio),
            active = COALESCE($7, active),
            available = COALESCE($8, available),
            updated_at = NOW()
          WHERE id = $9
          `,
          [
            full_name == null
              ? null
              : String(full_name).trim(),
            phone == null ? null : phone,
            specialty == null ? null : specialty,
            area == null ? null : area,
            image_url == null ? null : image_url,
            bio == null ? null : bio,
            active == null ? null : Boolean(active),
            available == null
              ? null
              : Boolean(available),
            req.params.id
          ]
        );

        if (email != null) {
          await client.query(
            `
            UPDATE users
            SET
              email = $1,
              updated_at = NOW()
            WHERE id = $2
            `,
            [email, user.id]
          );
        }

        if (active != null) {
          await client.query(
            `
            UPDATE users
            SET
              active = $1,
              updated_at = NOW()
            WHERE id = $2
            `,
            [Boolean(active), user.id]
          );
        }

        if (
          active === false ||
          available === false
        ) {
          await client.query(
            `
            UPDATE users
            SET
              active = CASE
                WHEN $1 = FALSE THEN FALSE
                ELSE active
              END,
              updated_at = NOW()
            WHERE id = $2
            `,
            [
              active === false
                ? false
                : true,
              user.id
            ]
          );
        }

        if (password) {
          if (String(password).length < 6) {
            throw new Error(
              "كلمة مرور الطبيب يجب أن تكون 6 أحرف على الأقل."
            );
          }

          const passwordData =
            hashPassword(password);

          await client.query(
            `
            UPDATE users
            SET
              password_hash = $1,
              password_salt = $2,
              updated_at = NOW()
            WHERE id = $3
            `,
            [
              passwordData.hash,
              passwordData.salt,
              user.id
            ]
          );
        }

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      const updated = await pool.query(
        `
        SELECT
          s.*,
          u.email
        FROM staff_users s
        LEFT JOIN users u
          ON u.id = s.auth_user_id
        WHERE s.id = $1
        LIMIT 1
        `,
        [req.params.id]
      );

      return jsonOk(res, {
        doctor:
          mapDoctor(updated.rows[0])
      });
    } catch (error) {
      console.error(
        "Update doctor:",
        error
      );

      return jsonError(
        res,
        error.message ||
          "تعذر تعديل الطبيب.",
        500
      );
    }
  }
);

app.delete(
  "/api/dashboard/doctors/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT auth_user_id
        FROM staff_users
        WHERE
          id = $1
          AND role = 'doctor'
        LIMIT 1
        `,
        [req.params.id]
      );

      if (result.rows.length === 0) {
        return jsonError(
          res,
          "الطبيب غير موجود.",
          404
        );
      }

      const authUserId =
        result.rows[0].auth_user_id;

      await pool.query(
        `
        UPDATE staff_users
        SET
          active = FALSE,
          available = FALSE,
          updated_at = NOW()
        WHERE id = $1
        `,
        [req.params.id]
      );

      if (authUserId) {
        await pool.query(
          `
          UPDATE users
          SET
            active = FALSE,
            updated_at = NOW()
          WHERE id = $1
          `,
          [authUserId]
        );
      }

      return jsonOk(res);
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "تعذر إيقاف الطبيب.",
        500
      );
    }
  }
);

/* =========================================================
   Dashboard ads
========================================================= */

app.get(
  "/api/dashboard/ads",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT *
        FROM ads
        ORDER BY created_at DESC
        `
      );

      return jsonOk(res, {
        ads: result.rows
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "تعذر جلب الإعلانات.",
        500
      );
    }
  }
);

app.post(
  "/api/dashboard/ads",
  requireAdmin,
  async (req, res) => {
    try {
      const {
        title,
        description,
        image_url,
        target_url,
        advertiser_name,
        active,
        starts_at,
        ends_at
      } = req.body || {};

      if (!title || !String(title).trim()) {
        return jsonError(
          res,
          "عنوان الإعلان مطلوب."
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
            $9
          )
        RETURNING *
        `,
        [
          makeId(),
          String(title).trim(),
          description || "",
          image_url || "",
          target_url || "",
          advertiser_name || "",
          active !== false,
          starts_at || null,
          ends_at || null
        ]
      );

      return res.status(201).json({
        ok: true,
        ad: result.rows[0]
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "تعذر إضافة الإعلان.",
        500
      );
    }
  }
);

app.patch(
  "/api/dashboard/ads/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const {
        title,
        description,
        image_url,
        target_url,
        advertiser_name,
        active,
        starts_at,
        ends_at
      } = req.body || {};

      const result = await pool.query(
        `
        UPDATE ads
        SET
          title = COALESCE($1, title),
          description = COALESCE($2, description),
          image_url = COALESCE($3, image_url),
          target_url = COALESCE($4, target_url),
          advertiser_name = COALESCE($5, advertiser_name),
          active = COALESCE($6, active),
          starts_at = COALESCE($7, starts_at),
          ends_at = COALESCE($8, ends_at),
          updated_at = NOW()
        WHERE id = $9
        RETURNING *
        `,
        [
          title == null ? null : String(title).trim(),
          description == null ? null : description,
          image_url == null ? null : image_url,
          target_url == null ? null : target_url,
          advertiser_name == null
            ? null
            : advertiser_name,
          active == null ? null : Boolean(active),
          starts_at == null ? null : starts_at,
          ends_at == null ? null : ends_at,
          req.params.id
        ]
      );

      if (result.rows.length === 0) {
        return jsonError(
          res,
          "الإعلان غير موجود.",
          404
        );
      }

      return jsonOk(res, {
        ad: result.rows[0]
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "تعذر تعديل الإعلان.",
        500
      );
    }
  }
);

app.delete(
  "/api/dashboard/ads/:id",
  requireAdmin,
  async (req, res) => {
    try {
      await pool.query(
        `
        UPDATE ads
        SET
          active = FALSE,
          updated_at = NOW()
        WHERE id = $1
        `,
        [req.params.id]
      );

      return jsonOk(res);
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "تعذر حذف الإعلان.",
        500
      );
    }
  }
);

/* =========================================================
   API 404
========================================================= */

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return jsonError(
      res,
      "المسار غير موجود.",
      404
    );
  }

  next();
});

/* =========================================================
   Frontend fallback
========================================================= */

app.use((req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

/* =========================================================
   Start server
========================================================= */

async function startServer() {
  try {
    await initDatabase();

    app.listen(PORT, () => {
      console.log(
        `Medical Booking running on port ${PORT}`
      );
    });
  } catch (error) {
    console.error(
      "Database initialization failed:",
      error
    );

    process.exit(1);
  }
}

startServer();

/* =========================================================
   Graceful shutdown
========================================================= */

process.on("SIGTERM", async () => {
  try {
    await pool.end();
  } catch (error) {
    console.error(error);
  }

  process.exit(0);
});

process.on("SIGINT", async () => {
  try {
    await pool.end();
  } catch (error) {
    console.error(error);
  }

  process.exit(0);
});

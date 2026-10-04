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
  ssl: {
    rejectUnauthorized: false
  }
});

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(
  express.json({
    limit: "10mb"
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb"
  })
);

app.use(express.static(PUBLIC_DIR));

/* =========================================================
   BASIC HELPERS
========================================================= */

function makeId() {
  return crypto.randomUUID();
}

function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(value) {
  return crypto
    .createHash("sha256")
    .update(String(value))
    .digest("hex");
}

function clean(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim();
}

function normalizeUsername(value) {
  return clean(value || "").toLowerCase();
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(
    String(value || "")
  );
}

function validTime(value) {
  return /^\d{2}:\d{2}$/.test(
    String(value || "")
  );
}

function jsonOk(res, data = {}) {
  return res.json({
    ok: true,
    ...data
  });
}

function jsonError(res, status, message) {
  return res.status(status).json({
    ok: false,
    error: message
  });
}

/* =========================================================
   PASSWORD HASHING
========================================================= */

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto
      .randomBytes(16)
      .toString("hex");

    crypto.scrypt(
      String(password),
      salt,
      64,
      (error, derivedKey) => {
        if (error) {
          return reject(error);
        }

        const result =
          salt +
          ":" +
          derivedKey.toString("hex");

        resolve(result);
      }
    );
  });
}

function verifyPassword(password, stored) {
  return new Promise((resolve, reject) => {
    try {
      const parts = String(stored || "").split(":");

      if (parts.length !== 2) {
        return resolve(false);
      }

      const salt = parts[0];

      const expected = Buffer.from(
        parts[1],
        "hex"
      );

      crypto.scrypt(
        String(password),
        salt,
        64,
        (error, derivedKey) => {
          if (error) {
            return reject(error);
          }

          if (
            expected.length !==
            derivedKey.length
          ) {
            return resolve(false);
          }

          return resolve(
            crypto.timingSafeEqual(
              expected,
              derivedKey
            )
          );
        }
      );
    } catch (error) {
      reject(error);
    }
  });
}

/* =========================================================
   DATABASE HELPERS
========================================================= */

async function tableExists(table) {
  const result = await pool.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = $1
    ) AS exists
    `,
    [table]
  );

  return Boolean(
    result.rows[0] &&
    result.rows[0].exists
  );
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

  return Boolean(
    result.rows[0] &&
    result.rows[0].exists
  );
}

async function addColumnIfMissing(
  table,
  column,
  definition
) {
  const exists = await columnExists(
    table,
    column
  );

  if (exists) {
    return;
  }

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
  console.log(
    "Initializing Neon database..."
  );

  /* USERS */

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

  /* PATIENTS */

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

  /* STAFF USERS */

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

  /* SERVICES */

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

  /* DOCTORS */

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

  /* APPOINTMENTS */

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

  /* MEDICAL RECORDS */

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

  /* ADS */

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

  /* AD IMPRESSIONS */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_impressions (
      id UUID PRIMARY KEY,
      ad_id UUID REFERENCES ads(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  /* AD CLICKS */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_clicks (
      id UUID PRIMARY KEY,
      ad_id UUID REFERENCES ads(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  /* SESSIONS */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY,
      access_token_hash TEXT,
      refresh_token_hash TEXT,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      staff_user_id UUID REFERENCES staff_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  console.log(
    "Base database tables checked."
  );

  /* =======================================================
     COMPATIBILITY WITH OLD DATABASE
  ======================================================= */

  const compatibilityColumns = [
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
    ["sessions", "user_id", "UUID"],
    ["sessions", "staff_user_id", "UUID"],
    ["sessions", "expires_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()"],
    ["sessions", "created_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()"]
  ];

  for (const item of compatibilityColumns) {
    await addColumnIfMissing(
      item[0],
      item[1],
      item[2]
    );
  }

  console.log(
    "Database compatibility columns checked."
  );
}```javascript
/* =========================================================
   DATABASE INDEXES
========================================================= */

async function createIndexes() {
  console.log("Creating database indexes...");

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_username
    ON users(username)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_role
    ON users(role)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_patients_user_id
    ON patients(user_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_patients_phone
    ON patients(phone)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_staff_users_username
    ON staff_users(username)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_doctors_active
    ON doctors(active)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_doctors_specialty
    ON doctors(specialty)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_doctors_area
    ON doctors(area)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_services_active
    ON services(active)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_appointments_date
    ON appointments(appointment_date)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_appointments_doctor
    ON appointments(doctor_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_appointments_patient
    ON appointments(patient_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_appointments_status
    ON appointments(status)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_medical_records_patient
    ON medical_records(patient_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ads_active
    ON ads(active)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sessions_access_token
    ON sessions(access_token_hash)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sessions_refresh_token
    ON sessions(refresh_token_hash)
  `);

  console.log("Database indexes checked.");
}

/* =========================================================
   DEFAULT SERVICES
========================================================= */

async function seedServices() {
  const services = [
    {
      name: "كشف طبي",
      description: "استشارة وفحص طبي عام.",
      duration: 30
    },
    {
      name: "متابعة الحمل",
      description: "متابعة دورية للحمل.",
      duration: 30
    },
    {
      name: "سونار الحمل",
      description: "فحص ومتابعة الحمل بالموجات فوق الصوتية.",
      duration: 30
    },
    {
      name: "كشف نساء",
      description: "فحص واستشارة في أمراض النساء.",
      duration: 30
    },
    {
      name: "تأخر الإنجاب",
      description: "استشارة ومتابعة حالات تأخر الإنجاب.",
      duration: 45
    },
    {
      name: "متابعة ما بعد الولادة",
      description: "متابعة صحة الأم بعد الولادة.",
      duration: 30
    },
    {
      name: "استشارات طبية",
      description: "استشارات طبية متنوعة.",
      duration: 30
    }
  ];

  for (const service of services) {
    await pool.query(
      `
      INSERT INTO services (
        id,
        name,
        description,
        duration_minutes,
        price,
        active
      )
      VALUES ($1, $2, $3, $4, 0, TRUE)
      ON CONFLICT (name)
      DO UPDATE SET
        description = EXCLUDED.description,
        duration_minutes = EXCLUDED.duration_minutes,
        active = TRUE,
        updated_at = NOW()
      `,
      [
        makeId(),
        service.name,
        service.description,
        service.duration
      ]
    );
  }

  console.log("Default services checked.");
}

/* =========================================================
   ADMIN SEED
========================================================= */

async function seedAdmin() {
  const username = normalizeUsername(
    process.env.ADMIN_USERNAME || "admin"
  );

  const password =
    process.env.ADMIN_PASSWORD || "admin123";

  const fullName =
    process.env.ADMIN_NAME ||
    "مدير منصة موعدي";

  if (!username || !password) {
    console.log(
      "Admin seed skipped: credentials are missing."
    );
    return;
  }

  const existing = await pool.query(
    `
    SELECT id
    FROM staff_users
    WHERE username = $1
    LIMIT 1
    `,
    [username]
  );

  const passwordHash =
    await hashPassword(password);

  if (existing.rowCount > 0) {
    await pool.query(
      `
      UPDATE staff_users
      SET
        password_hash = $1,
        full_name = $2,
        role = 'admin',
        active = TRUE,
        updated_at = NOW()
      WHERE username = $3
      `,
      [
        passwordHash,
        fullName,
        username
      ]
    );

    console.log(
      "Admin account checked."
    );

    return;
  }

  await pool.query(
    `
    INSERT INTO staff_users (
      id,
      username,
      password_hash,
      full_name,
      role,
      active
    )
    VALUES ($1, $2, $3, $4, 'admin', TRUE)
    `,
    [
      makeId(),
      username,
      passwordHash,
      fullName
    ]
  );

  console.log(
    "Admin account created."
  );
}

/* =========================================================
   SESSION HELPERS
========================================================= */

async function createStaffSession(
  staffUserId
) {
  const accessToken = randomToken();
  const refreshToken = randomToken();

  const accessHash =
    hashToken(accessToken);

  const refreshHash =
    hashToken(refreshToken);

  await pool.query(
    `
    INSERT INTO sessions (
      id,
      access_token_hash,
      refresh_token_hash,
      staff_user_id,
      expires_at
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      NOW() + INTERVAL '7 days'
    )
    `,
    [
      makeId(),
      accessHash,
      refreshHash,
      staffUserId
    ]
  );

  return {
    accessToken,
    refreshToken
  };
}

async function createPatientSession(
  userId
) {
  const accessToken = randomToken();
  const refreshToken = randomToken();

  await pool.query(
    `
    INSERT INTO sessions (
      id,
      access_token_hash,
      refresh_token_hash,
      user_id,
      expires_at
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      NOW() + INTERVAL '30 days'
    )
    `,
    [
      makeId(),
      hashToken(accessToken),
      hashToken(refreshToken),
      userId
    ]
  );

  return {
    accessToken,
    refreshToken
  };
}

/* =========================================================
   AUTHENTICATION MIDDLEWARE
========================================================= */

async function getAuthUser(req) {
  const header =
    req.headers.authorization || "";

  if (
    typeof header !== "string" ||
    !header.startsWith("Bearer ")
  ) {
    return null;
  }

  const token =
    header.substring(7).trim();

  if (!token) {
    return null;
  }

  const tokenHash =
    hashToken(token);

  const result = await pool.query(
    `
    SELECT
      s.id AS session_id,
      s.expires_at,

      su.id AS staff_id,
      su.username AS staff_username,
      su.full_name AS staff_full_name,
      su.role AS staff_role,
      su.active AS staff_active,

      u.id AS user_id,
      u.username AS user_username,
      u.full_name AS user_full_name,
      u.phone AS user_phone,
      u.email AS user_email,
      u.role AS user_role,
      u.active AS user_active

    FROM sessions s

    LEFT JOIN staff_users su
      ON su.id = s.staff_user_id

    LEFT JOIN users u
      ON u.id = s.user_id

    WHERE s.access_token_hash = $1
      AND s.expires_at > NOW()
    LIMIT 1
    `,
    [tokenHash]
  );

  if (result.rowCount === 0) {
    return null;
  }

  const row = result.rows[0];

  if (row.staff_id) {
    if (!row.staff_active) {
      return null;
    }

    return {
      type: "staff",
      session_id: row.session_id,
      id: row.staff_id,
      username: row.staff_username,
      full_name: row.staff_full_name,
      role: row.staff_role
    };
  }

  if (row.user_id) {
    if (!row.user_active) {
      return null;
    }

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

async function requireAuth(
  req,
  res,
  next
) {
  try {
    const user =
      await getAuthUser(req);

    if (!user) {
      return jsonError(
        res,
        401,
        "يجب تسجيل الدخول أولاً."
      );
    }

    req.authUser = user;

    next();
  } catch (error) {
    console.error(
      "Authentication error:",
      error
    );

    return jsonError(
      res,
      500,
      "حدث خطأ أثناء التحقق من تسجيل الدخول."
    );
  }
}

async function requireStaff(
  req,
  res,
  next
) {
  try {
    const user =
      await getAuthUser(req);

    if (!user || user.type !== "staff") {
      return jsonError(
        res,
        401,
        "صلاحية الموظف مطلوبة."
      );
    }

    req.authUser = user;

    next();
  } catch (error) {
    console.error(
      "Staff authentication error:",
      error
    );

    return jsonError(
      res,
      500,
      "حدث خطأ أثناء التحقق من صلاحيات الموظف."
    );
  }
}

async function requireAdmin(
  req,
  res,
  next
) {
  try {
    const user =
      await getAuthUser(req);

    if (
      !user ||
      user.type !== "staff" ||
      user.role !== "admin"
    ) {
      return jsonError(
        res,
        403,
        "صلاحية المدير مطلوبة."
      );
    }

    req.authUser = user;

    next();
  } catch (error) {
    console.error(
      "Admin authentication error:",
      error
    );

    return jsonError(
      res,
      500,
      "حدث خطأ أثناء التحقق من صلاحيات المدير."
    );
  }
}
```
```javascript id="4zq2km"
/* =========================================================
   HEALTH CHECK
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
    console.error(
      "Health check error:",
      error
    );

    return jsonError(
      res,
      500,
      "قاعدة البيانات غير متاحة."
    );
  }
});

/* =========================================================
   PATIENT REGISTRATION
========================================================= */

app.post(
  "/api/register",
  async (req, res) => {
    try {
      const username =
        normalizeUsername(
          req.body.username
        );

      const fullName =
        clean(req.body.full_name);

      const phone =
        clean(req.body.phone);

      const email =
        clean(req.body.email) || null;

      const password =
        String(req.body.password || "");

      if (!username) {
        return jsonError(
          res,
          400,
          "اسم المستخدم مطلوب."
        );
      }

      if (!fullName) {
        return jsonError(
          res,
          400,
          "الاسم الكامل مطلوب."
        );
      }

      if (!phone) {
        return jsonError(
          res,
          400,
          "رقم الهاتف مطلوب."
        );
      }

      if (password.length < 6) {
        return jsonError(
          res,
          400,
          "كلمة المرور يجب ألا تقل عن 6 أحرف."
        );
      }

      const existing =
        await pool.query(
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
          "اسم المستخدم مستخدم بالفعل."
        );
      }

      const userId = makeId();

      const passwordHash =
        await hashPassword(password);

      await pool.query(
        `
        INSERT INTO users (
          id,
          username,
          password_hash,
          full_name,
          phone,
          email,
          role,
          active
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          'patient',
          TRUE
        )
        `,
        [
          userId,
          username,
          passwordHash,
          fullName,
          phone,
          email
        ]
      );

      const patientId = makeId();

      await pool.query(
        `
        INSERT INTO patients (
          id,
          user_id,
          full_name,
          phone,
          email,
          active
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          TRUE
        )
        `,
        [
          patientId,
          userId,
          fullName,
          phone,
          email
        ]
      );

      const tokens =
        await createPatientSession(
          userId
        );

      return jsonOk(res, {
        message:
          "تم إنشاء حساب المريض بنجاح.",
        token: tokens.accessToken,
        access_token:
          tokens.accessToken,
        refresh_token:
          tokens.refreshToken,
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
      console.error(
        "Registration error:",
        error
      );

      if (
        error.code === "23505"
      ) {
        return jsonError(
          res,
          409,
          "اسم المستخدم مستخدم بالفعل."
        );
      }

      return jsonError(
        res,
        500,
        "تعذر إنشاء الحساب."
      );
    }
  }
);

/* =========================================================
   PATIENT LOGIN
========================================================= */

app.post(
  "/api/login",
  async (req, res) => {
    try {
      const username =
        normalizeUsername(
          req.body.username
        );

      const password =
        String(req.body.password || "");

      if (!username || !password) {
        return jsonError(
          res,
          400,
          "اسم المستخدم وكلمة المرور مطلوبان."
        );
      }

      const result =
        await pool.query(
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
          "اسم المستخدم أو كلمة المرور غير صحيحة."
        );
      }

      const user =
        result.rows[0];

      if (!user.active) {
        return jsonError(
          res,
          403,
          "هذا الحساب غير مفعل."
        );
      }

      const valid =
        await verifyPassword(
          password,
          user.password_hash
        );

      if (!valid) {
        return jsonError(
          res,
          401,
          "اسم المستخدم أو كلمة المرور غير صحيحة."
        );
      }

      const tokens =
        await createPatientSession(
          user.id
        );

      const patientResult =
        await pool.query(
          `
          SELECT
            id,
            full_name,
            phone,
            email,
            date_of_birth,
            gender,
            address,
            active
          FROM patients
          WHERE user_id = $1
          LIMIT 1
          `,
          [user.id]
        );

      return jsonOk(res, {
        message:
          "تم تسجيل الدخول بنجاح.",
        token:
          tokens.accessToken,
        access_token:
          tokens.accessToken,
        refresh_token:
          tokens.refreshToken,
        user: {
          id: user.id,
          username: user.username,
          full_name: user.full_name,
          phone: user.phone,
          email: user.email,
          role: user.role
        },
        patient:
          patientResult.rowCount > 0
            ? patientResult.rows[0]
            : null
      });
    } catch (error) {
      console.error(
        "Patient login error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر تسجيل الدخول."
      );
    }
  }
);

/* =========================================================
   STAFF LOGIN
========================================================= */

app.post(
  "/api/staff/login",
  async (req, res) => {
    try {
      const username =
        normalizeUsername(
          req.body.username
        );

      const password =
        String(req.body.password || "");

      if (!username || !password) {
        return jsonError(
          res,
          400,
          "اسم المستخدم وكلمة المرور مطلوبان."
        );
      }

      const result =
        await pool.query(
          `
          SELECT
            id,
            username,
            password_hash,
            full_name,
            role,
            phone,
            email,
            active
          FROM staff_users
          WHERE username = $1
          LIMIT 1
```
```javascript id="7m4qpa"
/* =========================================================
   DOCTORS — PUBLIC
========================================================= */

app.get(
  "/api/doctors",
  async (req, res) => {
    try {
      const specialty =
        clean(req.query.specialty || "");

      const area =
        clean(req.query.area || "");

      const search =
        clean(req.query.search || "");

      const conditions = [
        "d.active = TRUE"
      ];

      const values = [];
      let index = 1;

      if (specialty) {
        conditions.push(
          `d.specialty ILIKE $${index}`
        );

        values.push(
          "%" + specialty + "%"
        );

        index += 1;
      }

      if (area) {
        conditions.push(
          `d.area ILIKE $${index}`
        );

        values.push(
          "%" + area + "%"
        );

        index += 1;
      }

      if (search) {
        conditions.push(`
          (
            d.full_name ILIKE $${index}
            OR d.specialty ILIKE $${index}
            OR COALESCE(d.area, '') ILIKE $${index}
          )
        `);

        values.push(
          "%" + search + "%"
        );

        index += 1;
      }

      const result =
        await pool.query(
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
          ORDER BY
            d.rating DESC,
            d.full_name ASC
          `,
          values
        );

      return jsonOk(res, {
        doctors:
          result.rows
      });
    } catch (error) {
      console.error(
        "Public doctors error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر تحميل قائمة الأطباء."
      );
    }
  }
);

/* =========================================================
   SINGLE DOCTOR — PUBLIC
========================================================= */

app.get(
  "/api/doctors/:id",
  async (req, res) => {
    try {
      const result =
        await pool.query(
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
          WHERE d.id = $1
            AND d.active = TRUE
          LIMIT 1
          `,
          [req.params.id]
        );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الطبيب غير موجود."
        );
      }

      return jsonOk(res, {
        doctor:
          result.rows[0]
      });
    } catch (error) {
      console.error(
        "Single doctor error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر تحميل بيانات الطبيب."
      );
    }
  }
);

/* =========================================================
   DOCTORS — ADMIN LIST
========================================================= */

app.get(
  "/api/admin/doctors",
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
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
            active,
            created_at,
            updated_at
          FROM doctors
          ORDER BY created_at DESC
          `
        );

      return jsonOk(res, {
        doctors:
          result.rows
      });
    } catch (error) {
      console.error(
        "Admin doctors error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر تحميل الأطباء."
      );
    }
  }
);

/* =========================================================
   ADD DOCTOR — ADMIN
========================================================= */

app.post(
  "/api/admin/doctors",
  requireAdmin,
  async (req, res) => {
    try {
      const fullName =
        clean(req.body.full_name);

      const specialty =
        clean(req.body.specialty);

      const area =
        clean(req.body.area) || null;

      const phone =
        clean(req.body.phone) || null;

      const email =
        clean(req.body.email) || null;

      const bio =
        clean(req.body.bio) || null;

      const imageUrl =
        clean(req.body.image_url) || null;

      const ratingValue =
        Number(req.body.rating);

      const rating =
        Number.isFinite(ratingValue)
          ? Math.min(
              5,
              Math.max(
                0,
                ratingValue
              )
            )
          : 5;

      if (!fullName) {
        return jsonError(
          res,
          400,
          "اسم الطبيب مطلوب."
        );
      }
```
```javascript
/* =========================================================
   CREATE APPOINTMENT — PATIENT
========================================================= */

app.post(
  "/api/appointments",
  requireAuth,
  async (req, res) => {
    try {
      if (
        req.authUser.type !== "patient"
      ) {
        return jsonError(
          res,
          403,
          "هذا المسار مخصص للمرضى."
        );
      }

      const patientResult =
        await pool.query(
          `
          SELECT
            id,
            full_name,
            phone
          FROM patients
          WHERE user_id = $1
            AND active = TRUE
          LIMIT 1
          `,
          [req.authUser.id]
        );

      if (patientResult.rowCount === 0) {
        return jsonError(
          res,
          404,
          "لم يتم العثور على ملف المريض."
        );
      }

      const patient =
        patientResult.rows[0];

      const serviceId =
        clean(req.body.service_id);

      const doctorId =
        clean(req.body.doctor_id);

      const appointmentDate =
        clean(req.body.appointment_date);

      const appointmentTime =
        clean(req.body.appointment_time);

      const notes =
        clean(req.body.notes) || null;

      if (!serviceId) {
        return jsonError(
          res,
          400,
          "يجب اختيار الخدمة."
        );
      }

      if (!doctorId) {
        return jsonError(
          res,
          400,
          "يجب اختيار الطبيب."
        );
      }

      if (
        !validDate(
          appointmentDate
        )
      ) {
        return jsonError(
          res,
          400,
          "تاريخ الموعد غير صحيح."
        );
      }

      if (
        !validTime(
          appointmentTime
        )
      ) {
        return jsonError(
          res,
          400,
          "وقت الموعد غير صحيح."
        );
      }

      const serviceResult =
        await pool.query(
          `
          SELECT
            id,
            name,
            duration_minutes,
            price
          FROM services
          WHERE id = $1
            AND active = TRUE
          LIMIT 1
          `,
          [serviceId]
        );

      if (serviceResult.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الخدمة غير موجودة أو غير متاحة."
        );
      }

      const doctorResult =
        await pool.query(
          `
          SELECT
            id,
            full_name,
            specialty
          FROM doctors
          WHERE id = $1
            AND active = TRUE
          LIMIT 1
          `,
          [doctorId]
        );

      if (doctorResult.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الطبيب غير موجود أو غير متاح."
        );
      }

      /* منع حجز الطبيب في نفس الموعد */

      const conflict =
        await pool.query(
          `
          SELECT id
          FROM appointments
          WHERE doctor_id = $1
            AND appointment_date = $2
            AND appointment_time = $3
            AND status IN (
              'pending',
              'confirmed'
            )
          LIMIT 1
          `,
          [
            doctorId,
            appointmentDate,
            appointmentTime
          ]
        );

      if (conflict.rowCount > 0) {
        return jsonError(
          res,
          409,
          "هذا الموعد محجوز بالفعل للطبيب."
        );
      }

      /* منع المريض من حجز موعد آخر في نفس الوقت */

      const patientConflict =
        await pool.query(
          `
          SELECT id
          FROM appointments
          WHERE patient_id = $1
            AND appointment_date = $2
            AND appointment_time = $3
            AND status IN (
              'pending',
              'confirmed'
            )
          LIMIT 1
          `,
          [
            patient.id,
            appointmentDate,
            appointmentTime
          ]
        );

      if (
        patientConflict.rowCount > 0
      ) {
        return jsonError(
          res,
          409,
          "لديك موعد آخر في نفس التاريخ والوقت."
        );
      }

      const appointmentId =
        makeId();

      const result =
        await pool.query(
          `
          INSERT INTO appointments (
            id,
            patient_id,
            doctor_id,
            service_id,
            patient_name,
            patient_phone,
```
```javascript id="q7k4ms"
/* =========================================================
   ADMIN — PATIENTS
========================================================= */

app.get(
  "/api/admin/patients",
  requireAdmin,
  async (req, res) => {
    try {
      const search =
        clean(req.query.search || "");

      const values = [];
      let where = "";

      if (search) {
        values.push(
          "%" + search + "%"
        );

        where = `
          WHERE
            p.full_name ILIKE $1
            OR COALESCE(p.phone, '') ILIKE $1
            OR COALESCE(p.email, '') ILIKE $1
            OR COALESCE(u.username, '') ILIKE $1
        `;
      }

      const result =
        await pool.query(
          `
          SELECT
            p.id,
            p.user_id,
            p.full_name,
            p.phone,
            p.email,
            p.date_of_birth,
            p.gender,
            p.address,
            p.active,
            p.created_at,
            p.updated_at,

            u.username,
            u.role AS user_role

          FROM patients p

          LEFT JOIN users u
            ON u.id = p.user_id

          ${where}

          ORDER BY
            p.created_at DESC
          `,
          values
        );

      return jsonOk(res, {
        patients:
          result.rows
      });
    } catch (error) {
      console.error(
        "Admin patients error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر تحميل المرضى."
      );
    }
  }
);

/* =========================================================
   ADMIN — SINGLE PATIENT
========================================================= */

app.get(
  "/api/admin/patients/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT
            p.id,
            p.user_id,
            p.full_name,
            p.phone,
            p.email,
            p.date_of_birth,
            p.gender,
            p.address,
            p.active,
            p.created_at,
            p.updated_at,

            u.username,
            u.role AS user_role

          FROM patients p

          LEFT JOIN users u
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
          "المريض غير موجود."
        );
      }

      return jsonOk(res, {
        patient:
          result.rows[0]
      });
    } catch (error) {
      console.error(
        "Single patient error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر تحميل بيانات المريض."
      );
    }
  }
);

/* =========================================================
   ADMIN — UPDATE PATIENT
========================================================= */

app.put(
  "/api/admin/patients/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const fullName =
        clean(req.body.full_name);

      const phone =
        clean(req.body.phone) || null;

      const email =
        clean(req.body.email) || null;

      const dateOfBirth =
        clean(
          req.body.date_of_birth
        ) || null;

      const gender =
        clean(req.body.gender) || null;

      const address =
        clean(req.body.address) || null;

      const active =
        req.body.active === false ||
        req.body.active === "false"
          ? false
          : true;

      if (!fullName) {
        return jsonError(
          res,
          400,
          "اسم المريض مطلوب."
        );
```
```javascript id="m4x8qz"
/* =========================================================
   ADS — PUBLIC
========================================================= */

app.get(
  "/api/ads",
  async (req, res) => {
    try {
      const category =
        clean(
          req.query.category || ""
        );

      const values = [];
      let where = `
        WHERE active = TRUE
        AND (
          starts_at IS NULL
          OR starts_at <= NOW()
        )
        AND (
          ends_at IS NULL
          OR ends_at >= NOW()
        )
      `;

      if (category) {
        values.push(category);

        where += `
          AND category = $1
        `;
      }

      const result =
        await pool.query(
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
          ${where}
          ORDER BY
            created_at DESC
          `,
          values
        );

      return jsonOk(res, {
        ads:
          result.rows
      });
    } catch (error) {
      console.error(
        "Public ads error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر تحميل الإعلانات."
      );
    }
  }
);

/* =========================================================
   RECORD AD IMPRESSION — PUBLIC
========================================================= */

app.post(
  "/api/ads/:id/impression",
  async (req, res) => {
    try {
      const adId =
        req.params.id;

      const ad =
        await pool.query(
          `
          SELECT id
          FROM ads
          WHERE id = $1
            AND active = TRUE
          LIMIT 1
          `,
          [adId]
        );

      if (ad.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الإعلان غير موجود."
        );
      }

      await pool.query(
        `
        INSERT INTO ad_impressions (
          id,
          ad_id
        )
        VALUES (
          $1,
          $2
        )
        `,
        [
          makeId(),
          adId
        ]
      );

      return jsonOk(res, {
        message:
          "تم تسجيل مشاهدة الإعلان."
      });
    } catch (error) {
      console.error(
        "Ad impression error:",
        error
      );

      return jsonError(
        res,
        500,
```
```javascript id="x2p7kd"
/* =========================================================
   SERVICES — ADD
========================================================= */

app.post(
  "/api/admin/services",
  requireAdmin,
  async (req, res) => {
    try {
      const name =
        clean(req.body.name);

      const description =
        clean(
          req.body.description
        ) || null;

      const durationValue =
        Number(
          req.body.duration_minutes
        );

      const duration =
        Number.isFinite(durationValue) &&
        durationValue > 0
          ? Math.round(durationValue)
          : 30;

      const priceValue =
        Number(req.body.price);

      const price =
        Number.isFinite(priceValue) &&
        priceValue >= 0
          ? priceValue
          : 0;

      if (!name) {
        return jsonError(
          res,
          400,
          "اسم الخدمة مطلوب."
        );
      }

      const result =
        await pool.query(
          `
          INSERT INTO services (
            id,
            name,
            description,
            duration_minutes,
            price,
            active
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            TRUE
          )
          RETURNING
            id,
            name,
            description,
            duration_minutes,
            price,
            active
          `,
          [
            makeId(),
            name,
            description,
            duration,
            price
          ]
        );

      return jsonOk(res, {
        message:
          "تمت إضافة الخدمة بنجاح.",
        service:
          result.rows[0]
      });
    } catch (error) {
      console.error(
        "Add service error:",
        error
      );

      if (
        error.code === "23505"
      ) {
        return jsonError(
          res,
          409,
          "هذه الخدمة موجودة بالفعل."
        );
      }

      return jsonError(
        res,
        500,
        "تعذر إضافة الخدمة."
      );
    }
  }
);

/* =========================================================
   SERVICES — UPDATE
========================================================= */

app.put(
  "/api/admin/services/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const name =
        clean(req.body.name);

      const description =
        clean(
          req.body.description
        ) || null;

      const durationValue =
        Number(
          req.body.duration_minutes
        );

      const duration =
        Number.isFinite(durationValue) &&
        durationValue > 0
          ? Math.round(durationValue)
          : 30;

      const priceValue =
        Number(req.body.price);

      const price =
        Number.isFinite(priceValue) &&
        priceValue >= 0
          ? priceValue
          : 0;

      const active =
        req.body.active === false ||
        req.body.active === "false"
          ? false
          : true;

      if (!name) {
        return jsonError(
          res,
          400,
          "اسم الخدمة مطلوب."
        );
      }

      const result =
        await pool.query(
          `
          UPDATE services
          SET
            name = $1,
            description = $2,
            duration_minutes = $3,
            price = $4,
            active = $5,
```

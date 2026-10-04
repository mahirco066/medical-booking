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
  }
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const PUBLIC_DIR = path.join(__dirname, "public");

app.use(express.static(PUBLIC_DIR));

/* =========================================================
   Helpers
========================================================= */

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

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function validDate(value) {
  if (!value) return false;

  const d = new Date(`${value}T00:00:00`);

  return !Number.isNaN(d.getTime());
}

function validTime(value) {
  return /^\d{2}:\d{2}$/.test(String(value || ""));
}

function jsonOk(res, data = {}) {
  return res.json({
    ok: true,
    ...data
  });
}

function jsonError(res, status, message, extra = {}) {
  return res.status(status).json({
    ok: false,
    error: message,
    ...extra
  });
}

/* =========================================================
   Password hashing
========================================================= */

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");

    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);

      resolve(
        `scrypt:${salt}:${derivedKey.toString("hex")}`
      );
    });
  });
}

function verifyPassword(password, stored) {
  return new Promise((resolve) => {
    try {
      const parts = String(stored || "").split(":");

      if (parts.length !== 3 || parts[0] !== "scrypt") {
        return resolve(false);
      }

      const salt = parts[1];
      const storedHash = Buffer.from(parts[2], "hex");

      crypto.scrypt(password, salt, 64, (err, derivedKey) => {
        if (err) return resolve(false);

        if (storedHash.length !== derivedKey.length) {
          return resolve(false);
        }

        resolve(
          crypto.timingSafeEqual(
            storedHash,
            derivedKey
          )
        );
      });
    } catch {
      resolve(false);
    }
  });
}

/* =========================================================
   Database helpers
========================================================= */

async function columnExists(table, column) {
  const result = await pool.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
    ) AS exists
    `,
    [table, column]
  );

  return result.rows[0].exists;
}

async function addColumnIfMissing(
  table,
  column,
  definition
) {
  const exists = await columnExists(table, column);

  if (!exists) {
    await pool.query(
      `ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`
    );

    console.log(
      `Added missing column ${table}.${column}`
    );
  }
}

/* =========================================================
   Database initialization
========================================================= */

async function initDatabase() {
  console.log("Initializing Neon database...");

  /*
   * IMPORTANT:
   * Existing installations may contain older versions of these
   * tables. We therefore create the tables first, then add missing
   * columns, and ONLY AFTER THAT create indexes.
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      username TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT,
      phone TEXT,
      email TEXT,
      role TEXT DEFAULT 'patient',
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS patients (
      id UUID PRIMARY KEY,
      user_id UUID,
      full_name TEXT,
      phone TEXT,
      email TEXT,
      gender TEXT,
      birth_date DATE,
      address TEXT,
      blood_type TEXT,
      emergency_contact TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_users (
      id UUID PRIMARY KEY,
      username TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT,
      phone TEXT,
      email TEXT,
      role TEXT DEFAULT 'doctor',
      specialty TEXT,
      clinic_name TEXT,
      area TEXT,
      bio TEXT,
      image_url TEXT,
      license_number TEXT,
      available BOOLEAN DEFAULT TRUE,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS services (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      price NUMERIC(12,2) DEFAULT 0,
      duration_minutes INTEGER DEFAULT 30,
      active BOOLEAN DEFAULT TRUE,
      image_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id UUID PRIMARY KEY,
      patient_id UUID,
      doctor_id UUID,
      service_id UUID,
      appointment_date DATE,
      appointment_time TIME,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      patient_name TEXT,
      patient_phone TEXT,
      doctor_name TEXT,
      service_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS medical_records (
      id UUID PRIMARY KEY,
      patient_id UUID,
      doctor_id UUID,
      appointment_id UUID,
      diagnosis TEXT,
      symptoms TEXT,
      treatment TEXT,
      prescription TEXT,
      notes TEXT,
      record_date DATE DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ads (
      id UUID PRIMARY KEY,
      title TEXT,
      description TEXT,
      image_url TEXT,
      target_url TEXT,
      advertiser_name TEXT,
      ad_type TEXT DEFAULT 'banner',
      active BOOLEAN DEFAULT TRUE,
      start_date DATE,
      end_date DATE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_impressions (
      id UUID PRIMARY KEY,
      ad_id UUID,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_clicks (
      id UUID PRIMARY KEY,
      ad_id UUID,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY,
      user_id UUID,
      staff_user_id UUID,
      access_token_hash TEXT,
      refresh_token_hash TEXT,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  /* =======================================================
     Compatibility columns
  ======================================================= */

  /* users */

  await addColumnIfMissing(
    "users",
    "username",
    "TEXT"
  );

  await addColumnIfMissing(
    "users",
    "password_hash",
    "TEXT"
  );

  await addColumnIfMissing(
    "users",
    "full_name",
    "TEXT"
  );

  await addColumnIfMissing(
    "users",
    "phone",
    "TEXT"
  );

  await addColumnIfMissing(
    "users",
    "email",
    "TEXT"
  );

  await addColumnIfMissing(
    "users",
    "role",
    "TEXT DEFAULT 'patient'"
  );

  await addColumnIfMissing(
    "users",
    "active",
    "BOOLEAN DEFAULT TRUE"
  );

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

  /* patients */

  await addColumnIfMissing(
    "patients",
    "user_id",
    "UUID"
  );

  await addColumnIfMissing(
    "patients",
    "full_name",
    "TEXT"
  );

  await addColumnIfMissing(
    "patients",
    "phone",
    "TEXT"
  );

  await addColumnIfMissing(
    "patients",
    "email",
    "TEXT"
  );

  await addColumnIfMissing(
    "patients",
    "gender",
    "TEXT"
  );

  await addColumnIfMissing(
    "patients",
    "birth_date",
    "DATE"
  );

  await addColumnIfMissing(
    "patients",
    "address",
    "TEXT"
  );

  await addColumnIfMissing(
    "patients",
    "blood_type",
    "TEXT"
  );

  await addColumnIfMissing(
    "patients",
    "emergency_contact",
    "TEXT"
  );

  await addColumnIfMissing(
    "patients",
    "notes",
    "TEXT"
  );

  await addColumnIfMissing(
    "patients",
    "created_at",
    "TIMESTAMPTZ DEFAULT NOW()"
  );

  await addColumnIfMissing(
    "patients",
    "updated_at",
    "TIMESTAMPTZ DEFAULT NOW()"
  );

  /* staff_users */

  await addColumnIfMissing(
    "staff_users",
    "username",
    "TEXT"
  );

  await addColumnIfMissing(
    "staff_users",
    "password_hash",
    "TEXT"
  );

  await addColumnIfMissing(
    "staff_users",
    "full_name",
    "TEXT"
  );

  await addColumnIfMissing(
    "staff_users",
    "phone",
    "TEXT"
  );

  await addColumnIfMissing(
    "staff_users",
    "email",
    "TEXT"
  );

  await addColumnIfMissing(
    "staff_users",
    "role",
    "TEXT DEFAULT 'doctor'"
  );

  await addColumnIfMissing(
    "staff_users",
    "specialty",
    "TEXT"
  );

  await addColumnIfMissing(
    "staff_users",
    "clinic_name",
    "TEXT"
  );

  await addColumnIfMissing(
    "staff_users",
    "area",
    "TEXT"
  );

  await addColumnIfMissing(
    "staff_users",
    "bio",
    "TEXT"
  );

  await addColumnIfMissing(
    "staff_users",
    "image_url",
    "TEXT"
  );

  await addColumnIfMissing(
    "staff_users",
    "license_number",
    "TEXT"
  );

  await addColumnIfMissing(
    "staff_users",
    "available",
    "BOOLEAN DEFAULT TRUE"
  );

  await addColumnIfMissing(
    "staff_users",
    "active",
    "BOOLEAN DEFAULT TRUE"
  );

  await addColumnIfMissing(
    "staff_users",
    "created_at",
    "TIMESTAMPTZ DEFAULT NOW()"
  );

  await addColumnIfMissing(
    "staff_users",
    "updated_at",
    "TIMESTAMPTZ DEFAULT NOW()"
  );

  /* services */

  await addColumnIfMissing(
    "services",
    "name",
    "TEXT"
  );

  await addColumnIfMissing(
    "services",
    "description",
    "TEXT"
  );

  await addColumnIfMissing(
    "services",
    "price",
    "NUMERIC(12,2) DEFAULT 0"
  );

  await addColumnIfMissing(
    "services",
    "duration_minutes",
    "INTEGER DEFAULT 30"
  );

  await addColumnIfMissing(
    "services",
    "active",
    "BOOLEAN DEFAULT TRUE"
  );

  await addColumnIfMissing(
    "services",
    "image_url",
    "TEXT"
  );

  await addColumnIfMissing(
    "services",
    "created_at",
    "TIMESTAMPTZ DEFAULT NOW()"
  );

  await addColumnIfMissing(
    "services",
    "updated_at",
    "TIMESTAMPTZ DEFAULT NOW()"
  );

  /* appointments */

  await addColumnIfMissing(
    "appointments",
    "patient_id",
    "UUID"
  );

  await addColumnIfMissing(
    "appointments",
    "doctor_id",
    "UUID"
  );

  await addColumnIfMissing(
    "appointments",
    "service_id",
    "UUID"
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
    "doctor_name",
    "TEXT"
  );

  await addColumnIfMissing(
    "appointments",
    "service_name",
    "TEXT"
  );

  await addColumnIfMissing(
    "appointments",
    "created_at",
    "TIMESTAMPTZ DEFAULT NOW()"
  );

  await addColumnIfMissing(
    "appointments",
    "updated_at",
    "TIMESTAMPTZ DEFAULT NOW()"
  );

  /* =======================================================
     MOST IMPORTANT FIX:
     sessions.access_token_hash
  ======================================================= */

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
    "expires_at",
    "TIMESTAMPTZ"
  );

  await addColumnIfMissing(
    "sessions",
    "created_at",
    "TIMESTAMPTZ DEFAULT NOW()"
  );

  /*
   * Only NOW do we create indexes.
   */

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_username
    ON users(username)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_patients_user
    ON patients(user_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_staff_username
    ON staff_users(username)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_staff_role
    ON staff_users(role)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_staff_active
    ON staff_users(active)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_staff_available
    ON staff_users(available)
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
    CREATE INDEX IF NOT EXISTS idx_sessions_access
    ON sessions(access_token_hash)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sessions_refresh
    ON sessions(refresh_token_hash)
  `);

  /* =======================================================
     Default services
  ======================================================= */

  const serviceCount = await pool.query(
    `SELECT COUNT(*)::int AS count FROM services`
  );

  if (serviceCount.rows[0].count === 0) {
    const defaultServices = [
      [
        "كشف طبي عام",
        "استشارة وفحص طبي عام",
        0,
        30
      ],
      [
        "الباطنية",
        "فحص واستشارة أمراض الباطنية",
        0,
        30
      ],
      [
        "النساء والتوليد",
        "متابعة وفحوصات النساء والتوليد",
        0,
        30
      ],
      [
        "طب الأطفال",
        "فحص ومتابعة صحة الأطفال",
        0,
        30
      ],
      [
        "طب القلب",
        "استشارة وفحص أمراض القلب",
        0,
        30
      ],
      [
        "تحاليل طبية",
        "خدمات الفحوصات والتحاليل الطبية",
        0,
        30
      ],
      [
        "الأشعة",
        "خدمات التصوير والفحوصات بالأشعة",
        0,
        30
      ]
    ];

    for (const service of defaultServices) {
      await pool.query(
        `
        INSERT INTO services
        (
          id,
          name,
          description,
          price,
          duration_minutes,
          active
        )
        VALUES ($1,$2,$3,$4,$5,TRUE)
        `,
        [
          makeId(),
          service[0],
          service[1],
          service[2],
          service[3]
        ]
      );
    }

    console.log("Default services created.");
  }

  await seedAdmin();

  console.log("Database initialization completed.");
}

/* =========================================================
   Admin seed
========================================================= */

async function seedAdmin() {
  const username = normalizeUsername(
    process.env.ADMIN_USERNAME || "admin"
  );

  const password =
    process.env.ADMIN_PASSWORD || "admin123";

  const adminName =
    process.env.ADMIN_NAME ||
    "مدير منصة موعدي";

  const existing = await pool.query(
    `
    SELECT *
    FROM staff_users
    WHERE LOWER(username) = $1
    LIMIT 1
    `,
    [username]
  );

  const passwordHash =
    await hashPassword(password);

  if (existing.rows.length === 0) {
    const id = makeId();

    await pool.query(
      `
      INSERT INTO staff_users
      (
        id,
        username,
        password_hash,
        full_name,
        role,
        active,
        available,
        created_at,
        updated_at
      )
      VALUES
      ($1,$2,$3,$4,'admin',TRUE,FALSE,NOW(),NOW())
      `,
      [
        id,
        username,
        passwordHash,
        adminName
      ]
    );

    console.log(
      `Admin user created: ${username}`
    );
  } else {
    const admin = existing.rows[0];

    await pool.query(
      `
      UPDATE staff_users
      SET
        password_hash = $1,
        full_name = COALESCE(NULLIF(full_name,''),$2),
        role = 'admin',
        active = TRUE,
        updated_at = NOW()
      WHERE id = $3
      `,
      [
        passwordHash,
        adminName,
        admin.id
      ]
    );

    console.log(
      `Admin user verified: ${username}`
    );
  }
}

/* =========================================================
   Authentication
========================================================= */

async function createSession({
  userId = null,
  staffUserId = null
}) {
  const accessToken = randomToken();
  const refreshToken = randomToken();

  const accessHash =
    hashToken(accessToken);

  const refreshHash =
    hashToken(refreshToken);

  const id = makeId();

  await pool.query(
    `
    INSERT INTO sessions
    (
      id,
      user_id,
      staff_user_id,
      access_token_hash,
      refresh_token_hash,
      expires_at,
      created_at
    )
    VALUES
    ($1,$2,$3,$4,$5,NOW() + INTERVAL '30 days',NOW())
    `,
    [
      id,
      userId,
      staffUserId,
      accessHash,
      refreshHash
    ]
  );

  return {
    token: accessToken,
    access_token: accessToken,
    refresh_token: refreshToken
  };
}

async function getAuth(req) {
  const header =
    req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  const token =
    header.substring(7).trim();

  if (!token) return null;

  const tokenHash =
    hashToken(token);

  const result = await pool.query(
    `
    SELECT
      s.*,
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
      su.specialty AS staff_specialty,
      su.clinic_name AS staff_clinic_name,
      su.area AS staff_area,
      su.bio AS staff_bio,
      su.image_url AS staff_image_url,
      su.available AS staff_available,
      su.active AS staff_active
    FROM sessions s
    LEFT JOIN users u
      ON u.id = s.user_id
    LEFT JOIN staff_users su
      ON su.id = s.staff_user_id
    WHERE s.access_token_hash = $1
      AND
      (
        s.expires_at IS NULL
        OR s.expires_at > NOW()
      )
    LIMIT 1
    `,
    [tokenHash]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  if (row.staff_user_id) {
    if (row.staff_active === false) {
      return null;
    }

    return {
      type: "staff",
      id: row.staff_user_id,
      username: row.staff_username,
      full_name: row.staff_full_name,
      phone: row.staff_phone,
      email: row.staff_email,
      role: row.staff_role,
      specialty: row.staff_specialty,
      clinic_name: row.staff_clinic_name,
      area: row.staff_area,
      bio: row.staff_bio,
      image_url: row.staff_image_url,
      available: row.staff_available
    };
  }

  if (row.user_id) {
    if (row.user_active === false) {
      return null;
    }

    return {
      type: "patient",
      id: row.user_id,
      username: row.user_username,
      full_name: row.user_full_name,
      phone: row.user_phone,
      email: row.user_email,
      role: row.user_role || "patient"
    };
  }

  return null;
}

async function requireAuth(req, res, next) {
  try {
    const auth = await getAuth(req);

    if (!auth) {
      return jsonError(
        res,
        401,
        "غير مصرح. يرجى تسجيل الدخول."
      );
    }

    req.auth = auth;
    next();
  } catch (error) {
    console.error(error);
    return jsonError(
      res,
      500,
      "حدث خطأ أثناء التحقق من الحساب."
    );
  }
}

async function requireStaff(req, res, next) {
  try {
    const auth = await getAuth(req);

    if (!auth || auth.type !== "staff") {
      return jsonError(
        res,
        401,
        "يجب تسجيل الدخول بحساب موظف."
      );
    }

    req.auth = auth;
    next();
  } catch (error) {
    console.error(error);
    return jsonError(
      res,
      500,
      "حدث خطأ أثناء التحقق من الحساب."
    );
  }
}

async function requireAdmin(req, res, next) {
  try {
    const auth = await getAuth(req);

    if (
      !auth ||
      auth.type !== "staff" ||
      auth.role !== "admin"
    ) {
      return jsonError(
        res,
        403,
        "صلاحيات المدير مطلوبة."
      );
    }

    req.auth = auth;
    next();
  } catch (error) {
    console.error(error);
    return jsonError(
      res,
      500,
      "حدث خطأ أثناء التحقق من الصلاحيات."
    );
  }
}

/* =========================================================
   Health
========================================================= */

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
        uploads: true
      }
    });
  } catch (error) {
    console.error(error);

    return jsonError(
      res,
      500,
      "قاعدة البيانات غير متاحة."
    );
  }
});

/* =========================================================
   Config
========================================================= */

app.get("/api/config", (req, res) => {
  return jsonOk(res, {
    app_name: "موعدي",
    tagline: "صحتك أولاً",
    database: "neon"
  });
});

/* =========================================================
   Patient registration
========================================================= */

app.post("/api/register", async (req, res) => {
  try {
    const username =
      normalizeUsername(req.body.username);

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
        "كلمة المرور يجب أن تكون 6 أحرف على الأقل."
      );
    }

    const exists = await pool.query(
      `
      SELECT id
      FROM users
      WHERE LOWER(username) = $1
      LIMIT 1
      `,
      [username]
    );

    if (exists.rows.length) {
      return jsonError(
        res,
        409,
        "اسم المستخدم مستخدم بالفعل."
      );
    }

    const passwordHash =
      await hashPassword(password);

    const userId = makeId();

    await pool.query(
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
        active,
        created_at,
        updated_at
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,'patient',TRUE,NOW(),NOW())
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
      INSERT INTO patients
      (
        id,
        user_id,
        full_name,
        phone,
        email,
        created_at,
        updated_at
      )
      VALUES
      ($1,$2,$3,$4,$5,NOW(),NOW())
      `,
      [
        patientId,
        userId,
        fullName,
        phone,
        email
      ]
    );

    const session =
      await createSession({
        userId
      });

    return jsonOk(res, {
      message: "تم إنشاء الحساب بنجاح.",
      ...session,
      user: {
        id: userId,
        username,
        full_name: fullName,
        phone,
        email,
        role: "patient"
      }
    });
  } catch (error) {
    console.error(
      "Registration error:",
      error
    );

    return jsonError(
      res,
      500,
      "تعذر إنشاء الحساب."
    );
  }
});

/* =========================================================
   Patient login
========================================================= */

app.post("/api/login", async (req, res) => {
  try {
    const username =
      normalizeUsername(req.body.username);

    const password =
      String(req.body.password || "");

    if (!username || !password) {
      return jsonError(
        res,
        400,
        "اسم المستخدم وكلمة المرور مطلوبان."
      );
    }

    const result = await pool.query(
      `
      SELECT *
      FROM users
      WHERE LOWER(username) = $1
      LIMIT 1
      `,
      [username]
    );

    if (result.rows.length === 0) {
      return jsonError(
        res,
        401,
        "اسم المستخدم أو كلمة المرور غير صحيحة."
      );
    }

    const user = result.rows[0];

    if (user.active === false) {
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

    const session =
      await createSession({
        userId: user.id
      });

    return jsonOk(res, {
      ...session,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        phone: user.phone,
        email: user.email,
        role: user.role || "patient"
      }
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
});

/* =========================================================
   Patient me
========================================================= */

app.get(
  "/api/me",
  requireAuth,
  async (req, res) => {
    try {
      if (req.auth.type !== "patient") {
        return jsonOk(res, {
          user: req.auth
        });
      }

      const result = await pool.query(
        `
        SELECT
          u.id,
          u.username,
          u.full_name,
          u.phone,
          u.email,
          u.role,
          p.id AS patient_id,
          p.gender,
          p.birth_date,
          p.address,
          p.blood_type,
          p.emergency_contact,
          p.notes
        FROM users u
        LEFT JOIN patients p
          ON p.user_id = u.id
        WHERE u.id = $1
        LIMIT 1
        `,
        [req.auth.id]
      );

      if (!result.rows.length) {
        return jsonError(
          res,
          404,
          "المستخدم غير موجود."
        );
      }

      return jsonOk(res, {
        user: result.rows[0]
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحميل بيانات الحساب."
      );
    }
  }
);

/* =========================================================
   Staff login
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

      const result = await pool.query(
        `
        SELECT *
        FROM staff_users
        WHERE LOWER(username) = $1
        LIMIT 1
        `,
        [username]
      );

      if (result.rows.length === 0) {
        return jsonError(
          res,
          401,
          "اسم المستخدم أو كلمة المرور غير صحيحة."
        );
      }

      const staff = result.rows[0];

      if (staff.active === false) {
        return jsonError(
          res,
          403,
          "هذا الحساب غير مفعل."
        );
      }

      const valid =
        await verifyPassword(
          password,
          staff.password_hash
        );

      if (!valid) {
        return jsonError(
          res,
          401,
          "اسم المستخدم أو كلمة المرور غير صحيحة."
        );
      }

      const session =
        await createSession({
          staffUserId: staff.id
        });

      /*
       * Return both token names because older/newer dashboard
       * versions may use either one.
       */

      return jsonOk(res, {
        ...session,
        token: session.token,
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        user: {
          id: staff.id,
          username: staff.username,
          full_name: staff.full_name,
          phone: staff.phone,
          email: staff.email,
          role: staff.role,
          specialty: staff.specialty,
          clinic_name: staff.clinic_name,
          area: staff.area,
          bio: staff.bio,
          image_url: staff.image_url,
          available: staff.available
        }
      });
    } catch (error) {
      console.error(
        "Staff login error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر تسجيل دخول الموظف."
      );
    }
  }
);

/* =========================================================
   Staff me
========================================================= */

app.get(
  "/api/staff/me",
  requireStaff,
  async (req, res) => {
    return jsonOk(res, {
      user: req.auth
    });
  }
);

/* =========================================================
   Logout
========================================================= */

app.post(
  "/api/logout",
  requireAuth,
  async (req, res) => {
    try {
      const header =
        req.headers.authorization || "";

      const token =
        header.startsWith("Bearer ")
          ? header.substring(7).trim()
          : "";

      if (token) {
        await pool.query(
          `
          DELETE FROM sessions
          WHERE access_token_hash = $1
          `,
          [hashToken(token)]
        );
      }

      return jsonOk(res, {
        message: "تم تسجيل الخروج."
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تسجيل الخروج."
      );
    }
  }
);

/* =========================================================
   Services - public
========================================================= */

app.get(
  "/api/services",
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT *
        FROM services
        WHERE active = TRUE
        ORDER BY name ASC
        `
      );

      return jsonOk(res, {
        services: result.rows
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحميل الخدمات."
      );
    }
  }
);

/* =========================================================
   Doctors - public
========================================================= */

app.get(
  "/api/doctors",
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          id,
          username,
          full_name,
          phone,
          email,
          role,
          specialty,
          clinic_name,
          area,
          bio,
          image_url,
          available,
          active
        FROM staff_users
        WHERE active = TRUE
          AND role = 'doctor'
        ORDER BY full_name ASC
        `
      );

      return jsonOk(res, {
        doctors: result.rows
      });
    } catch (error) {
      console.error(
        "Doctors error:",
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
   Ads - public
========================================================= */

app.get(
  "/api/ads",
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT *
        FROM ads
        WHERE active = TRUE
          AND
          (
            start_date IS NULL
            OR start_date <= CURRENT_DATE
          )
          AND
          (
            end_date IS NULL
            OR end_date >= CURRENT_DATE
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
        500,
        "تعذر تحميل الإعلانات."
      );
    }
  }
);

/* =========================================================
   Ad impression
========================================================= */

app.post(
  "/api/ads/:id/impression",
  async (req, res) => {
    try {
      await pool.query(
        `
        INSERT INTO ad_impressions
        (
          id,
          ad_id
        )
        VALUES ($1,$2)
        `,
        [
          makeId(),
          req.params.id
        ]
      );

      return jsonOk(res);
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تسجيل المشاهدة."
      );
    }
  }
);

/* =========================================================
   Ad click
========================================================= */

app.post(
  "/api/ads/:id/click",
  async (req, res) => {
    try {
      await pool.query(
        `
        INSERT INTO ad_clicks
        (
          id,
          ad_id
        )
        VALUES ($1,$2)
        `,
        [
          makeId(),
          req.params.id
        ]
      );

      return jsonOk(res);
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تسجيل النقرة."
      );
    }
  }
);

/* =========================================================
   Create appointment
========================================================= */

app.post(
  "/api/appointments",
  requireAuth,
  async (req, res) => {
    try {
      if (req.auth.type !== "patient") {
        return jsonError(
          res,
          403,
          "الحجز متاح لحسابات المرضى فقط."
        );
      }

      const serviceId =
        clean(req.body.service_id) || null;

      const doctorId =
        clean(req.body.doctor_id) || null;

      const appointmentDate =
        clean(req.body.appointment_date);

      const appointmentTime =
        clean(req.body.appointment_time);

      const notes =
        clean(req.body.notes);

      if (!appointmentDate) {
        return jsonError(
          res,
          400,
          "تاريخ الموعد مطلوب."
        );
      }

      if (!validDate(appointmentDate)) {
        return jsonError(
          res,
          400,
          "تاريخ الموعد غير صحيح."
        );
      }

      if (!appointmentTime) {
        return jsonError(
          res,
          400,
          "وقت الموعد مطلوب."
        );
      }

      if (!validTime(appointmentTime)) {
        return jsonError(
          res,
          400,
          "وقت الموعد غير صحيح."
        );
      }

      const patientResult =
        await pool.query(
          `
          SELECT
            p.id AS patient_id,
            p.full_name,
            p.phone
          FROM patients p
          WHERE p.user_id = $1
          LIMIT 1
          `,
          [req.auth.id]
        );

      if (!patientResult.rows.length) {
        return jsonError(
          res,
          404,
          "ملف المريض غير موجود."
        );
      }

      const patient =
        patientResult.rows[0];

      let service = null;

      if (serviceId) {
        const serviceResult =
          await pool.query(
            `
            SELECT *
            FROM services
            WHERE id = $1
              AND active = TRUE
            LIMIT 1
            `,
            [serviceId]
          );

        if (!serviceResult.rows.length) {
          return jsonError(
            res,
            404,
            "الخدمة غير موجودة."
          );
        }

        service =
          serviceResult.rows[0];
      }

      let doctor = null;

      if (doctorId) {
        const doctorResult =
          await pool.query(
            `
            SELECT *
            FROM staff_users
            WHERE id = $1
              AND role = 'doctor'
              AND active = TRUE
            LIMIT 1
            `,
            [doctorId]
          );

        if (!doctorResult.rows.length) {
          return jsonError(
            res,
            404,
            "الطبيب غير موجود."
          );
        }

        doctor =
          doctorResult.rows[0];
      }

      /*
       * Prevent duplicate booking for the same doctor/date/time.
       */

      if (doctorId) {
        const duplicate =
          await pool.query(
            `
            SELECT id
            FROM appointments
            WHERE doctor_id = $1
              AND appointment_date = $2
              AND appointment_time = $3
              AND status NOT IN
              (
                'cancelled',
                'rejected'
              )
            LIMIT 1
            `,
            [
              doctorId,
              appointmentDate,
              appointmentTime
            ]
          );

        if (duplicate.rows.length) {
          return jsonError(
            res,
            409,
            "هذا الموعد محجوز بالفعل."
          );
        }
      }

      const appointmentId =
        makeId();

      await pool.query(
        `
        INSERT INTO appointments
        (
          id,
          patient_id,
          doctor_id,
          service_id,
          appointment_date,
          appointment_time,
          status,
          notes,
          patient_name,
          patient_phone,
          doctor_name,
          service_name,
          created_at,
          updated_at
        )
        VALUES
        (
          $1,$2,$3,$4,$5,$6,
          'pending',
          $7,$8,$9,$10,$11,
          NOW(),NOW()
        )
        `,
        [
          appointmentId,
          patient.patient_id,
          doctorId,
          serviceId,
          appointmentDate,
          appointmentTime,
          notes,
          patient.full_name,
          patient.phone,
          doctor
            ? doctor.full_name
            : null,
          service
            ? service.name
            : null
        ]
      );

      return jsonOk(res, {
        message:
          "تم إرسال طلب الحجز بنجاح.",
        appointment: {
          id: appointmentId,
          status: "pending",
          appointment_date:
            appointmentDate,
          appointment_time:
            appointmentTime,
          doctor_name:
            doctor
              ? doctor.full_name
              : null,
          service_name:
            service
              ? service.name
              : null
        }
      });
    } catch (error) {
      console.error(
        "Create appointment error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر إنشاء الحجز."
      );
    }
  }
);

/* =========================================================
   Patient appointments
========================================================= */

app.get(
  "/api/my-appointments",
  requireAuth,
  async (req, res) => {
    try {
      if (req.auth.type !== "patient") {
        return jsonError(
          res,
          403,
          "هذا المسار مخصص للمرضى."
        );
      }

      const result =
        await pool.query(
          `
          SELECT
            a.*,
            COALESCE(
              a.doctor_name,
              su.full_name
            ) AS resolved_doctor_name,
            COALESCE(
              a.service_name,
              s.name
            ) AS resolved_service_name
          FROM appointments a
          LEFT JOIN staff_users su
            ON su.id = a.doctor_id
          LEFT JOIN services s
            ON s.id = a.service_id
          WHERE a.patient_id IN
          (
            SELECT id
            FROM patients
            WHERE user_id = $1
          )
          ORDER BY
            a.appointment_date DESC,
            a.appointment_time DESC,
            a.created_at DESC
          `,
          [req.auth.id]
        );

      const appointments =
        result.rows.map((row) => ({
          ...row,
          doctor_name:
            row.resolved_doctor_name,
          service_name:
            row.resolved_service_name
        }));

      return jsonOk(res, {
        appointments
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحميل المواعيد."
      );
    }
  }
);

/* =========================================================
   Cancel patient appointment
========================================================= */

app.patch(
  "/api/my-appointments/:id/cancel",
  requireAuth,
  async (req, res) => {
    try {
      if (req.auth.type !== "patient") {
        return jsonError(
          res,
          403,
          "غير مصرح."
        );
      }

      const result =
        await pool.query(
          `
          UPDATE appointments
          SET
            status = 'cancelled',
            updated_at = NOW()
          WHERE id = $1
            AND patient_id IN
            (
              SELECT id
              FROM patients
              WHERE user_id = $2
            )
            AND status NOT IN
            (
              'completed',
              'cancelled'
            )
          RETURNING *
          `,
          [
            req.params.id,
            req.auth.id
          ]
        );

      if (!result.rows.length) {
        return jsonError(
          res,
          404,
          "الموعد غير موجود أو لا يمكن إلغاؤه."
        );
      }

      return jsonOk(res, {
        message: "تم إلغاء الموعد.",
        appointment:
          result.rows[0]
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر إلغاء الموعد."
      );
    }
  }
);

/* =========================================================
   Dashboard stats
========================================================= */

app.get(
  "/api/dashboard/stats",
  requireStaff,
  async (req, res) => {
    try {
      const [
        patients,
        appointments,
        pending,
        confirmed,
        doctors,
        services
      ] = await Promise.all([
        pool.query(
          `SELECT COUNT(*)::int AS count FROM patients`
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
          FROM staff_users
          WHERE role = 'doctor'
            AND active = TRUE
          `
        ),
        pool.query(
          `
          SELECT COUNT(*)::int AS count
          FROM services
          WHERE active = TRUE
          `
        )
      ]);

      return jsonOk(res, {
        stats: {
          patients:
            patients.rows[0].count,
          appointments:
            appointments.rows[0].count,
          pending:
            pending.rows[0].count,
          confirmed:
            confirmed.rows[0].count,
          doctors:
            doctors.rows[0].count,
          services:
            services.rows[0].count
        }
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحميل إحصائيات لوحة الإدارة."
      );
    }
  }
);

/* =========================================================
   Dashboard appointments
========================================================= */

app.get(
  "/api/dashboard/appointments",
  requireStaff,
  async (req, res) => {
    try {
      const status =
        clean(req.query.status);

      const search =
        clean(req.query.search);

      const values = [];
      const conditions = [];

      if (status && status !== "all") {
        values.push(status);
        conditions.push(
          `a.status = $${values.length}`
        );
      }

      if (search) {
        values.push(
          `%${search}%`
        );

        conditions.push(`
          (
            a.patient_name ILIKE $${values.length}
            OR a.patient_phone ILIKE $${values.length}
            OR a.doctor_name ILIKE $${values.length}
            OR a.service_name ILIKE $${values.length}
          )
        `);
      }

      const where =
        conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";

      const result =
        await pool.query(
          `
          SELECT
            a.*,
            COALESCE(
              a.patient_name,
              p.full_name,
              u.full_name
            ) AS resolved_patient_name,
            COALESCE(
              a.patient_phone,
              p.phone,
              u.phone
            ) AS resolved_patient_phone,
            COALESCE(
              a.doctor_name,
              d.full_name
            ) AS resolved_doctor_name,
            COALESCE(
              a.service_name,
              s.name
            ) AS resolved_service_name
          FROM appointments a
          LEFT JOIN patients p
            ON p.id = a.patient_id
          LEFT JOIN users u
            ON u.id = p.user_id
          LEFT JOIN staff_users d
            ON d.id = a.doctor_id
          LEFT JOIN services s
            ON s.id = a.service_id
          ${where}
          ORDER BY
            a.appointment_date DESC,
            a.appointment_time DESC,
            a.created_at DESC
          LIMIT 500
          `,
          values
        );

      const appointments =
        result.rows.map((row) => ({
          ...row,
          patient_name:
            row.resolved_patient_name,
          patient_phone:
            row.resolved_patient_phone,
          doctor_name:
            row.resolved_doctor_name,
          service_name:
            row.resolved_service_name
        }));

      return jsonOk(res, {
        appointments
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحميل المواعيد."
      );
    }
  }
);

/* =========================================================
   Dashboard update appointment
========================================================= */

app.patch(
  "/api/dashboard/appointments/:id",
  requireStaff,
  async (req, res) => {
    try {
      const allowedStatuses = [
        "pending",
        "confirmed",
        "completed",
        "cancelled",
        "rejected",
        "no_show"
      ];

      const status =
        clean(req.body.status);

      if (
        status &&
        !allowedStatuses.includes(status)
      ) {
        return jsonError(
          res,
          400,
          "حالة الموعد غير صحيحة."
        );
      }

      const fields = [];
      const values = [];

      if (status) {
        values.push(status);
        fields.push(
          `status = $${values.length}`
        );
      }

      if (
        req.body.notes !== undefined
      ) {
        values.push(
          clean(req.body.notes)
        );

        fields.push(
          `notes = $${values.length}`
        );
      }

      if (!fields.length) {
        return jsonError(
          res,
          400,
          "لا توجد بيانات للتعديل."
        );
      }

      values.push(req.params.id);

      const result =
        await pool.query(
          `
          UPDATE appointments
          SET
            ${fields.join(", ")},
            updated_at = NOW()
          WHERE id = $${values.length}
          RETURNING *
          `,
          values
        );

      if (!result.rows.length) {
        return jsonError(
          res,
          404,
          "الموعد غير موجود."
        );
      }

      return jsonOk(res, {
        message:
          "تم تحديث الموعد.",
        appointment:
          result.rows[0]
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحديث الموعد."
      );
    }
  }
);

/* =========================================================
   Dashboard patients
========================================================= */

app.get(
  "/api/dashboard/patients",
  requireStaff,
  async (req, res) => {
    try {
      const search =
        clean(req.query.search);

      const values = [];
      let where = "";

      if (search) {
        values.push(
          `%${search}%`
        );

        where = `
          WHERE
            p.full_name ILIKE $1
            OR p.phone ILIKE $1
            OR p.email ILIKE $1
        `;
      }

      const result =
        await pool.query(
          `
          SELECT
            p.*,
            u.username,
            u.role
          FROM patients p
          LEFT JOIN users u
            ON u.id = p.user_id
          ${where}
          ORDER BY p.created_at DESC
          LIMIT 500
          `,
          values
        );

      return jsonOk(res, {
        patients: result.rows
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحميل المرضى."
      );
    }
  }
);

/* =========================================================
   Dashboard medical records
========================================================= */

app.get(
  "/api/dashboard/medical-records",
  requireStaff,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT
            mr.*,
            p.full_name AS patient_name,
            p.phone AS patient_phone,
            d.full_name AS doctor_name
          FROM medical_records mr
          LEFT JOIN patients p
            ON p.id = mr.patient_id
          LEFT JOIN staff_users d
            ON d.id = mr.doctor_id
          ORDER BY
            mr.record_date DESC,
            mr.created_at DESC
          LIMIT 500
          `
        );

      return jsonOk(res, {
        medical_records:
          result.rows,
        records:
          result.rows
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحميل السجلات الطبية."
      );
    }
  }
);

/* =========================================================
   Create medical record
========================================================= */

app.post(
  "/api/dashboard/medical-records",
  requireStaff,
  async (req, res) => {
    try {
      const patientId =
        clean(req.body.patient_id);

      if (!patientId) {
        return jsonError(
          res,
          400,
          "المريض مطلوب."
        );
      }

      const doctorId =
        clean(req.body.doctor_id) ||
        (
          req.auth.role === "doctor"
            ? req.auth.id
            : null
        );

      const appointmentId =
        clean(req.body.appointment_id) ||
        null;

      const diagnosis =
        clean(req.body.diagnosis);

      const symptoms =
        clean(req.body.symptoms);

      const treatment =
        clean(req.body.treatment);

      const prescription =
        clean(req.body.prescription);

      const notes =
        clean(req.body.notes);

      const recordDate =
        clean(req.body.record_date) ||
        null;

      const id = makeId();

      await pool.query(
        `
        INSERT INTO medical_records
        (
          id,
          patient_id,
          doctor_id,
          appointment_id,
          diagnosis,
          symptoms,
          treatment,
          prescription,
          notes,
          record_date,
          created_at,
          updated_at
        )
        VALUES
        (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,
          COALESCE($10::date,CURRENT_DATE),
          NOW(),NOW()
        )
        `,
        [
          id,
          patientId,
          doctorId,
          appointmentId,
          diagnosis,
          symptoms,
          treatment,
          prescription,
          notes,
          recordDate
        ]
      );

      return jsonOk(res, {
        message:
          "تم حفظ السجل الطبي.",
        record_id: id
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر حفظ السجل الطبي."
      );
    }
  }
);

/* =========================================================
   Dashboard doctors
========================================================= */

app.get(
  "/api/dashboard/doctors",
  requireStaff,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT *
          FROM staff_users
          WHERE role = 'doctor'
          ORDER BY created_at DESC
          `
        );

      return jsonOk(res, {
        doctors: result.rows
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحميل الأطباء."
      );
    }
  }
);

/* =========================================================
   Dashboard create doctor
========================================================= */

app.post(
  "/api/dashboard/doctors",
  requireAdmin,
  async (req, res) => {
    try {
      const username =
        normalizeUsername(
          req.body.username
        );

      const password =
        String(req.body.password || "");

      const fullName =
        clean(req.body.full_name);

      const phone =
        clean(req.body.phone);

      const email =
        clean(req.body.email) || null;

      const specialty =
        clean(req.body.specialty);

      const clinicName =
        clean(req.body.clinic_name);

      const area =
        clean(req.body.area);

      const bio =
        clean(req.body.bio);

      const imageUrl =
        clean(req.body.image_url) ||
        null;

      if (!username) {
        return jsonError(
          res,
          400,
          "اسم المستخدم مطلوب."
        );
      }

      if (password.length < 6) {
        return jsonError(
          res,
          400,
          "كلمة المرور يجب أن تكون 6 أحرف على الأقل."
        );
      }

      if (!fullName) {
        return jsonError(
          res,
          400,
          "اسم الطبيب مطلوب."
        );
      }

      const exists =
        await pool.query(
          `
          SELECT id
          FROM staff_users
          WHERE LOWER(username) = $1
          LIMIT 1
          `,
          [username]
        );

      if (exists.rows.length) {
        return jsonError(
          res,
          409,
          "اسم المستخدم مستخدم بالفعل."
        );
      }

      const passwordHash =
        await hashPassword(password);

      const id = makeId();

      await pool.query(
        `
        INSERT INTO staff_users
        (
          id,
          username,
          password_hash,
          full_name,
          phone,
          email,
          role,
          specialty,
          clinic_name,
          area,
          bio,
          image_url,
          available,
          active,
          created_at,
          updated_at
        )
        VALUES
        (
          $1,$2,$3,$4,$5,$6,'doctor',
          $7,$8,$9,$10,$11,
          TRUE,TRUE,NOW(),NOW()
        )
        `,
        [
          id,
          username,
          passwordHash,
          fullName,
          phone,
          email,
          specialty,
          clinicName,
          area,
          bio,
          imageUrl
        ]
      );

      return jsonOk(res, {
        message:
          "تم إنشاء حساب الطبيب.",
        doctor_id: id
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر إنشاء حساب الطبيب."
      );
    }
  }
);

/* =========================================================
   Dashboard update doctor
========================================================= */

app.patch(
  "/api/dashboard/doctors/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const allowed = [
        "full_name",
        "phone",
        "email",
        "specialty",
        "clinic_name",
        "area",
        "bio",
        "image_url",
        "available",
        "active"
      ];

      const fields = [];
      const values = [];

      for (const field of allowed) {
        if (
          req.body[field] !== undefined
        ) {
          values.push(
            req.body[field]
          );

          fields.push(
            `"${field}" = $${values.length}`
          );
        }
      }

      if (
        req.body.password !== undefined &&
        String(req.body.password).length >= 6
      ) {
        values.push(
          await hashPassword(
            String(req.body.password)
          )
        );

        fields.push(
          `password_hash = $${values.length}`
        );
      }

      if (!fields.length) {
        return jsonError(
          res,
          400,
          "لا توجد بيانات للتعديل."
        );
      }

      values.push(req.params.id);

      const result =
        await pool.query(
          `
          UPDATE staff_users
          SET
            ${fields.join(", ")},
            updated_at = NOW()
          WHERE id = $${values.length}
            AND role = 'doctor'
          RETURNING *
          `,
          values
        );

      if (!result.rows.length) {
        return jsonError(
          res,
          404,
          "الطبيب غير موجود."
        );
      }

      return jsonOk(res, {
        message:
          "تم تحديث بيانات الطبيب.",
        doctor:
          result.rows[0]
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحديث الطبيب."
      );
    }
  }
);

/* =========================================================
   Dashboard delete/deactivate doctor
========================================================= */

app.delete(
  "/api/dashboard/doctors/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          UPDATE staff_users
          SET
            active = FALSE,
            available = FALSE,
            updated_at = NOW()
          WHERE id = $1
            AND role = 'doctor'
          RETURNING id
          `,
          [req.params.id]
        );

      if (!result.rows.length) {
        return jsonError(
          res,
          404,
          "الطبيب غير موجود."
        );
      }

      return jsonOk(res, {
        message:
          "تم إيقاف حساب الطبيب."
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر إيقاف الطبيب."
      );
    }
  }
);

/* =========================================================
   Dashboard services
========================================================= */

app.get(
  "/api/dashboard/services",
  requireStaff,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT *
          FROM services
          ORDER BY created_at DESC
          `
        );

      return jsonOk(res, {
        services: result.rows
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحميل الخدمات."
      );
    }
  }
);

/* =========================================================
   Create service
========================================================= */

app.post(
  "/api/dashboard/services",
  requireAdmin,
  async (req, res) => {
    try {
      const name =
        clean(req.body.name);

      const description =
        clean(req.body.description);

      const price =
        Number(req.body.price || 0);

      const duration =
        Number(
          req.body.duration_minutes || 30
        );

      const imageUrl =
        clean(req.body.image_url) ||
        null;

      if (!name) {
        return jsonError(
          res,
          400,
          "اسم الخدمة مطلوب."
        );
      }

      const id = makeId();

      await pool.query(
        `
        INSERT INTO services
        (
          id,
          name,
          description,
          price,
          duration_minutes,
          active,
          image_url,
          created_at,
          updated_at
        )
        VALUES
        (
          $1,$2,$3,$4,$5,TRUE,$6,NOW(),NOW()
        )
        `,
        [
          id,
          name,
          description,
          Number.isFinite(price)
            ? price
            : 0,
          Number.isFinite(duration)
            ? duration
            : 30,
          imageUrl
        ]
      );

      return jsonOk(res, {
        message:
          "تمت إضافة الخدمة.",
        service_id: id
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر إضافة الخدمة."
      );
    }
  }
);

/* =========================================================
   Update service
========================================================= */

app.patch(
  "/api/dashboard/services/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const allowed = [
        "name",
        "description",
        "price",
        "duration_minutes",
        "active",
        "image_url"
      ];

      const fields = [];
      const values = [];

      for (const field of allowed) {
        if (
          req.body[field] !== undefined
        ) {
          values.push(
            req.body[field]
          );

          fields.push(
            `"${field}" = $${values.length}`
          );
        }
      }

      if (!fields.length) {
        return jsonError(
          res,
          400,
          "لا توجد بيانات للتعديل."
        );
      }

      values.push(req.params.id);

      const result =
        await pool.query(
          `
          UPDATE services
          SET
            ${fields.join(", ")},
            updated_at = NOW()
          WHERE id = $${values.length}
          RETURNING *
          `,
          values
        );

      if (!result.rows.length) {
        return jsonError(
          res,
          404,
          "الخدمة غير موجودة."
        );
      }

      return jsonOk(res, {
        message:
          "تم تحديث الخدمة.",
        service:
          result.rows[0]
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحديث الخدمة."
      );
    }
  }
);

/* =========================================================
   Delete service
========================================================= */

app.delete(
  "/api/dashboard/services/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          UPDATE services
          SET
            active = FALSE,
            updated_at = NOW()
          WHERE id = $1
          RETURNING id
          `,
          [req.params.id]
        );

      if (!result.rows.length) {
        return jsonError(
          res,
          404,
          "الخدمة غير موجودة."
        );
      }

      return jsonOk(res, {
        message:
          "تم إيقاف الخدمة."
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر إيقاف الخدمة."
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
      const result =
        await pool.query(
          `
          SELECT
            a.*,
            (
              SELECT COUNT(*)
              FROM ad_impressions ai
              WHERE ai.ad_id = a.id
            )::int AS impressions,
            (
              SELECT COUNT(*)
              FROM ad_clicks ac
              WHERE ac.ad_id = a.id
            )::int AS clicks
          FROM ads a
          ORDER BY a.created_at DESC
          `
        );

      return jsonOk(res, {
        ads: result.rows
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحميل الإعلانات."
      );
    }
  }
);

/* =========================================================
   Create ad
========================================================= */

app.post(
  "/api/dashboard/ads",
  requireAdmin,
  async (req, res) => {
    try {
      const title =
        clean(req.body.title);

      const description =
        clean(req.body.description);

      const imageUrl =
        clean(req.body.image_url) ||
        null;

      const targetUrl =
        clean(req.body.target_url) ||
        null;

      const advertiserName =
        clean(req.body.advertiser_name) ||
        null;

      const adType =
        clean(req.body.ad_type) ||
        "banner";

      const startDate =
        clean(req.body.start_date) ||
        null;

      const endDate =
        clean(req.body.end_date) ||
        null;

      if (!title) {
        return jsonError(
          res,
          400,
          "عنوان الإعلان مطلوب."
        );
      }

      const id = makeId();

      await pool.query(
        `
        INSERT INTO ads
        (
          id,
          title,
          description,
          image_url,
          target_url,
          advertiser_name,
          ad_type,
          active,
          start_date,
          end_date,
          created_at,
          updated_at
        )
        VALUES
        (
          $1,$2,$3,$4,$5,$6,$7,TRUE,$8,$9,NOW(),NOW()
        )
        `,
        [
          id,
          title,
          description,
          imageUrl,
          targetUrl,
          advertiserName,
          adType,
          startDate,
          endDate
        ]
      );

      return jsonOk(res, {
        message:
          "تمت إضافة الإعلان.",
        ad_id: id
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر إضافة الإعلان."
      );
    }
  }
);

/* =========================================================
   Update ad
========================================================= */

app.patch(
  "/api/dashboard/ads/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const allowed = [
        "title",
        "description",
        "image_url",
        "target_url",
        "advertiser_name",
        "ad_type",
        "active",
        "start_date",
        "end_date"
      ];

      const fields = [];
      const values = [];

      for (const field of allowed) {
        if (
          req.body[field] !== undefined
        ) {
          values.push(
            req.body[field]
          );

          fields.push(
            `"${field}" = $${values.length}`
          );
        }
      }

      if (!fields.length) {
        return jsonError(
          res,
          400,
          "لا توجد بيانات للتعديل."
        );
      }

      values.push(req.params.id);

      const result =
        await pool.query(
          `
          UPDATE ads
          SET
            ${fields.join(", ")},
            updated_at = NOW()
          WHERE id = $${values.length}
          RETURNING *
          `,
          values
        );

      if (!result.rows.length) {
        return jsonError(
          res,
          404,
          "الإعلان غير موجود."
        );
      }

      return jsonOk(res, {
        message:
          "تم تحديث الإعلان.",
        ad:
          result.rows[0]
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر تحديث الإعلان."
      );
    }
  }
);

/* =========================================================
   Delete ad
========================================================= */

app.delete(
  "/api/dashboard/ads/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          UPDATE ads
          SET
            active = FALSE,
            updated_at = NOW()
          WHERE id = $1
          RETURNING id
          `,
          [req.params.id]
        );

      if (!result.rows.length) {
        return jsonError(
          res,
          404,
          "الإعلان غير موجود."
        );
      }

      return jsonOk(res, {
        message:
          "تم إيقاف الإعلان."
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        500,
        "تعذر إيقاف الإعلان."
      );
    }
  }
);

/* =========================================================
   Generic dashboard aliases
========================================================= */

app.get(
  "/api/dashboard",
  requireStaff,
  async (req, res) => {
    return jsonOk(res, {
      message:
        "لوحة إدارة موعدي تعمل.",
      user:
        req.auth
    });
  }
);

/* =========================================================
   API 404
========================================================= */

app.use(
  "/api",
  (req, res) => {
    return jsonError(
      res,
      404,
      "المسار غير موجود."
    );
  }
);

/* =========================================================
   Frontend fallback
========================================================= */

app.get(
  "*",
  (req, res) => {
    res.sendFile(
      path.join(
        PUBLIC_DIR,
        "index.html"
      )
    );
  }
);

/* =========================================================
   Error handler
========================================================= */

app.use(
  (error, req, res, next) => {
    console.error(
      "Unhandled error:",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    return jsonError(
      res,
      500,
      "حدث خطأ داخلي في الخادم."
    );
  }
);

/* =========================================================
   Start server
========================================================= */

async function startServer() {
  try {
    await initDatabase();

    app.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `Medical Booking running on port ${PORT}`
        );
      }
    );
  } catch (error) {
    console.error(
      "Database initialization failed:",
      error
    );

    process.exit(1);
  }
}

startServer();

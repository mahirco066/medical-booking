const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 10000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is missing");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

/* =========================================================
   HELPERS
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

function getBearerToken(req) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return "";
  }

  return header.slice(7).trim();
}

function randomToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString("hex");
}

function hashToken(token) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");

  const hash = crypto
    .scryptSync(String(password), salt, 64)
    .toString("hex");

  return {
    salt,
    hash
  };
}

function verifyPassword(password, salt, storedHash) {
  try {
    const calculated = crypto.scryptSync(
      String(password),
      salt,
      64
    );

    const stored = Buffer.from(
      storedHash,
      "hex"
    );

    return (
      stored.length === calculated.length &&
      crypto.timingSafeEqual(
        stored,
        calculated
      )
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
    created_at: row.created_at
  };
}

function mapService(row) {
  if (!row) return null;

  return {
    id: row.id,
    name: row.name || "",
    description: row.description || "",
    duration_minutes:
      row.duration_minutes ?? 30,
    price: row.price ?? null,
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
    doctor_id: row.doctor_id,
    doctor_name: row.doctor_name || "",
    service_id: row.service_id,
    service_name: row.service_name || "",
    appointment_date: row.appointment_date,
    appointment_time: row.appointment_time,
    status: row.status,
    notes: row.notes || "",
    confirmed: row.confirmed === true,
    cancelled: row.cancelled === true,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

/* =========================================================
   DATABASE
========================================================= */

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'patient',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      email TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS patients (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      auth_user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      username TEXT,
      email TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS staff_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      auth_user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      full_name TEXT NOT NULL,
      phone TEXT,
      username TEXT,
      role TEXT NOT NULL DEFAULT 'doctor',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS services (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      duration_minutes INTEGER NOT NULL DEFAULT 30,
      price NUMERIC(12,2),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      doctor_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
      service_id UUID REFERENCES services(id) ON DELETE SET NULL,
      appointment_date DATE NOT NULL,
      appointment_time TIME NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      notes TEXT DEFAULT '',
      confirmed BOOLEAN NOT NULL DEFAULT FALSE,
      cancelled BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS medical_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      doctor_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
      diagnosis TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      prescription TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      target_url TEXT DEFAULT '',
      advertiser_name TEXT DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ad_impressions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ad_id UUID NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ad_clicks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ad_id UUID NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      refresh_token_hash TEXT UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      refresh_expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  /* Doctor fields */
  await pool.query(`
    ALTER TABLE staff_users
      ADD COLUMN IF NOT EXISTS specialty TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS area TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS available BOOLEAN NOT NULL DEFAULT TRUE;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS appointments_date_idx
      ON appointments(appointment_date);

    CREATE INDEX IF NOT EXISTS appointments_patient_idx
      ON appointments(patient_id);

    CREATE INDEX IF NOT EXISTS appointments_status_idx
      ON appointments(status);

    CREATE INDEX IF NOT EXISTS sessions_token_idx
      ON sessions(token_hash);

    CREATE INDEX IF NOT EXISTS ads_active_idx
      ON ads(active);

    CREATE UNIQUE INDEX IF NOT EXISTS appointments_doctor_slot_unique
      ON appointments(doctor_id, appointment_date, appointment_time)
      WHERE doctor_id IS NOT NULL
        AND status IN ('pending','confirmed');

    CREATE UNIQUE INDEX IF NOT EXISTS appointments_general_slot_unique
      ON appointments(appointment_date, appointment_time)
      WHERE doctor_id IS NULL
        AND status IN ('pending','confirmed');
  `);

  const serviceCount = await pool.query(
    `SELECT COUNT(*)::int AS count FROM services`
  );

  if (serviceCount.rows[0].count === 0) {
    await pool.query(`
      INSERT INTO services
        (name, description, duration_minutes, price)
      VALUES
        ('كشف طبي', 'كشف طبي عام', 30, NULL),
        ('استشارة', 'استشارة طبية', 30, NULL),
        ('متابعة', 'متابعة حالة المريض', 30, NULL),
        ('فحص وتشخيص', 'فحص وتشخيص طبي', 45, NULL)
      ON CONFLICT (name) DO NOTHING
    `);
  }

  await seedAdmin();
}

async function seedAdmin() {
  const username =
    process.env.ADMIN_USERNAME
      ? normalizeUsername(process.env.ADMIN_USERNAME)
      : "";

  const password =
    process.env.ADMIN_PASSWORD || "";

  if (!username || !password) {
    return;
  }

  const existing = await pool.query(
    `SELECT id FROM users WHERE username=$1`,
    [username]
  );

  if (existing.rowCount) {
    await pool.query(
      `UPDATE users
       SET role='admin', active=TRUE, updated_at=NOW()
       WHERE username=$1`,
      [username]
    );

    return;
  }

  const { salt, hash } =
    hashPassword(password);

  const client =
    await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult =
      await client.query(
        `INSERT INTO users
          (username,password_hash,password_salt,role,active,email)
         VALUES ($1,$2,$3,'admin',TRUE,NULL)
         RETURNING id`,
        [username, hash, salt]
      );

    await client.query(
      `INSERT INTO staff_users
        (auth_user_id,full_name,phone,username,role,active)
       VALUES ($1,$2,'',$3,'admin',TRUE)`,
      [
        userResult.rows[0].id,
        process.env.ADMIN_NAME || "مدير النظام",
        username
      ]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Admin seed error:", error.message);
  } finally {
    client.release();
  }
}

/* =========================================================
   AUTH
========================================================= */

async function createSession(userId) {
  const token = randomToken();
  const refreshToken = randomToken();

  const tokenHash = hashToken(token);
  const refreshHash = hashToken(refreshToken);

  await pool.query(
    `INSERT INTO sessions
      (user_id,token_hash,refresh_token_hash,
       expires_at,refresh_expires_at)
     VALUES
      ($1,$2,$3,NOW()+INTERVAL '30 days',
       NOW()+INTERVAL '90 days')`,
    [
      userId,
      tokenHash,
      refreshHash
    ]
  );

  return {
    token,
    refreshToken
  };
}

async function getUserFromToken(token) {
  if (!token) return null;

  const result =
    await pool.query(`
      SELECT
        u.*,
        s.id AS staff_id,
        s.full_name AS staff_full_name,
        s.role AS staff_role,
        s.active AS staff_active
      FROM sessions se
      JOIN users u
        ON u.id=se.user_id
      LEFT JOIN staff_users s
        ON s.auth_user_id=u.id
      WHERE se.token_hash=$1
        AND se.expires_at>NOW()
        AND u.active=TRUE
      LIMIT 1
    `, [hashToken(token)]);

  return result.rows[0] || null;
}

async function requireAuth(req, res, next) {
  try {
    const token =
      getBearerToken(req);

    const user =
      await getUserFromToken(token);

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
        "هذا القسم مخصص للمرضى.",
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
        "غير مصرح لك.",
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
        "صلاحية مدير النظام مطلوبة.",
        403
      );
    }

    next();
  });
}

/* =========================================================
   HEALTH
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
    return jsonError(
      res,
      "Database unavailable",
      500
    );
  }
});

app.get("/api/config", (req, res) => {
  return jsonOk(res, {
    appName: "موعدي",
    database: "neon"
  });
});

/* =========================================================
   PATIENT REGISTER
========================================================= */

app.post(
  "/api/patient/register",
  async (req, res) => {
    const username =
      normalizeUsername(req.body.username);

    const fullName =
      String(req.body.full_name || "").trim();

    const phone =
      String(req.body.phone || "").trim();

    const email =
      req.body.email
        ? String(req.body.email).trim()
        : null;

    const password =
      String(req.body.password || "");

    if (username.length < 3) {
      return jsonError(
        res,
        "اسم المستخدم يجب أن يكون 3 أحرف على الأقل."
      );
    }

    if (fullName.length < 2) {
      return jsonError(
        res,
        "يرجى إدخال الاسم الكامل."
      );
    }

    if (!phone) {
      return jsonError(
        res,
        "يرجى إدخال رقم الهاتف."
      );
    }

    if (password.length < 6) {
      return jsonError(
        res,
        "كلمة المرور يجب أن تكون 6 أحرف على الأقل."
      );
    }

    const existing =
      await pool.query(
        `SELECT id FROM users WHERE username=$1`,
        [username]
      );

    if (existing.rowCount) {
      return jsonError(
        res,
        "اسم المستخدم مستخدم بالفعل."
      );
    }

    const { salt, hash } =
      hashPassword(password);

    const client =
      await pool.connect();

    try {
      await client.query("BEGIN");

      const userResult =
        await client.query(
          `INSERT INTO users
            (username,password_hash,password_salt,
             role,active,email)
           VALUES ($1,$2,$3,'patient',TRUE,$4)
           RETURNING *`,
          [
            username,
            hash,
            salt,
            email
          ]
        );

      const user =
        userResult.rows[0];

      const patientResult =
        await client.query(
          `INSERT INTO patients
            (auth_user_id,full_name,phone,
             username,email)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING *`,
          [
            user.id,
            fullName,
            phone,
            username,
            email
          ]
        );

      const session =
        await createSessionWithClient(
          client,
          user.id
        );

      await client.query("COMMIT");

      return jsonOk(res, {
        token: session.token,
        refreshToken: session.refreshToken,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          email: user.email
        },
        patient:
          mapPatient(patientResult.rows[0])
      });
    } catch (error) {
      await client.query("ROLLBACK");

      if (error.code === "23505") {
        return jsonError(
          res,
          "اسم المستخدم مستخدم بالفعل."
        );
      }

      console.error(error);
      return jsonError(
        res,
        "تعذر إنشاء الحساب.",
        500
      );
    } finally {
      client.release();
    }
  }
);

async function createSessionWithClient(
  client,
  userId
) {
  const token = randomToken();
  const refreshToken = randomToken();

  await client.query(
    `INSERT INTO sessions
      (user_id,token_hash,refresh_token_hash,
       expires_at,refresh_expires_at)
     VALUES
      ($1,$2,$3,NOW()+INTERVAL '30 days',
       NOW()+INTERVAL '90 days')`,
    [
      userId,
      hashToken(token),
      hashToken(refreshToken)
    ]
  );

  return {
    token,
    refreshToken
  };
}

/* =========================================================
   PATIENT LOGIN
========================================================= */

app.post(
  "/api/patient/login",
  async (req, res) => {
    const username =
      normalizeUsername(req.body.username);

    const password =
      String(req.body.password || "");

    const result =
      await pool.query(
        `SELECT *
         FROM users
         WHERE username=$1
           AND role='patient'
         LIMIT 1`,
        [username]
      );

    const user =
      result.rows[0];

    if (
      !user ||
      !verifyPassword(
        password,
        user.password_salt,
        user.password_hash
      )
    ) {
      return jsonError(
        res,
        "اسم المستخدم أو كلمة المرور غير صحيحة.",
        401
      );
    }

    const patientResult =
      await pool.query(
        `SELECT *
         FROM patients
         WHERE auth_user_id=$1
         LIMIT 1`,
        [user.id]
      );

    const session =
      await createSession(user.id);

    return jsonOk(res, {
      token: session.token,
      refreshToken: session.refreshToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email
      },
      patient:
        mapPatient(patientResult.rows[0])
    });
  }
);

/* =========================================================
   STAFF LOGIN
========================================================= */

app.post(
  "/api/staff/login",
  async (req, res) => {
    const username =
      normalizeUsername(req.body.username);

    const password =
      String(req.body.password || "");

    const result =
      await pool.query(
        `SELECT *
         FROM users
         WHERE username=$1
           AND role IN ('admin','doctor','secretary')
           AND active=TRUE
         LIMIT 1`,
        [username]
      );

    const user =
      result.rows[0];

    if (
      !user ||
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

    const staffResult =
      await pool.query(
        `SELECT *
         FROM staff_users
         WHERE auth_user_id=$1
           AND active=TRUE
         LIMIT 1`,
        [user.id]
      );

    const staff =
      staffResult.rows[0];

    if (!staff) {
      return jsonError(
        res,
        "حساب الموظف غير مكتمل.",
        403
      );
    }

    const session =
      await createSession(user.id);

    return jsonOk(res, {
      token: session.token,
      refreshToken: session.refreshToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email
      },
      staff: {
        ...mapDoctor({
          ...staff,
          email: user.email
        })
      }
    });
  }
);

app.post(
  "/api/admin/login",
  async (req, res) => {
    req.url = "/api/staff/login";
    return app._router.handle(req, res);
  }
);

app.post(
  "/api/login",
  async (req, res) => {
    const username =
      normalizeUsername(req.body.username);

    const password =
      String(req.body.password || "");

    const result =
      await pool.query(
        `SELECT *
         FROM users
         WHERE username=$1
         LIMIT 1`,
        [username]
      );

    const user =
      result.rows[0];

    if (
      !user ||
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

    const session =
      await createSession(user.id);

    return jsonOk(res, {
      token: session.token,
      refreshToken: session.refreshToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email
      }
    });
  }
);

/* =========================================================
   REFRESH
========================================================= */

app.post(
  "/api/refresh",
  async (req, res) => {
    const refreshToken =
      String(
        req.body.refreshToken || ""
      ).trim();

    if (!refreshToken) {
      return jsonError(
        res,
        "Refresh token مطلوب.",
        401
      );
    }

    const result =
      await pool.query(
        `SELECT u.*
         FROM sessions s
         JOIN users u ON u.id=s.user_id
         WHERE s.refresh_token_hash=$1
           AND s.refresh_expires_at>NOW()
           AND u.active=TRUE
         LIMIT 1`,
        [hashToken(refreshToken)]
      );

    const user =
      result.rows[0];

    if (!user) {
      return jsonError(
        res,
        "جلسة الدخول منتهية.",
        401
      );
    }

    const session =
      await createSession(user.id);

    return jsonOk(res, {
      token: session.token,
      refreshToken: session.refreshToken
    });
  }
);

/* =========================================================
   PATIENT ME
========================================================= */

app.get(
  "/api/patient/me",
  requirePatient,
  async (req, res) => {
    const result =
      await pool.query(
        `SELECT *
         FROM patients
         WHERE auth_user_id=$1
         LIMIT 1`,
        [req.user.id]
      );

    return jsonOk(res, {
      user: {
        id: req.user.id,
        username: req.user.username,
        role: req.user.role,
        email: req.user.email
      },
      patient:
        mapPatient(result.rows[0])
    });
  }
);

/* =========================================================
   LOGOUT
========================================================= */

app.post(
  "/api/logout",
  requireAuth,
  async (req, res) => {
    const token =
      getBearerToken(req);

    await pool.query(
      `DELETE FROM sessions
       WHERE token_hash=$1`,
      [hashToken(token)]
    );

    return jsonOk(res);
  }
);

/* =========================================================
   SERVICES PUBLIC
========================================================= */

app.get(
  "/api/services",
  async (req, res) => {
    const result =
      await pool.query(
        `SELECT *
         FROM services
         WHERE active=TRUE
         ORDER BY created_at ASC`
      );

    return jsonOk(res, {
      services:
        result.rows.map(mapService)
    });
  }
);

/* =========================================================
   DOCTORS PUBLIC
========================================================= */

app.get(
  "/api/doctors",
  async (req, res) => {
    const search =
      String(req.query.search || "")
        .trim()
        .toLowerCase();

    const specialty =
      String(req.query.specialty || "")
        .trim();

    const area =
      String(req.query.area || "")
        .trim();

    const params = [];
    const conditions = [
      `s.role='doctor'`,
      `s.active=TRUE`,
      `s.available=TRUE`
    ];

    if (search) {
      params.push(`%${search}%`);

      conditions.push(`
        (
          LOWER(s.full_name) LIKE $${params.length}
          OR LOWER(COALESCE(s.specialty,'')) LIKE $${params.length}
          OR LOWER(COALESCE(s.area,'')) LIKE $${params.length}
        )
      `);
    }

    if (specialty) {
      params.push(specialty);

      conditions.push(
        `s.specialty=$${params.length}`
      );
    }

    if (area) {
      params.push(area);

      conditions.push(
        `s.area=$${params.length}`
      );
    }

    const result =
      await pool.query(
        `
        SELECT
          s.*,
          u.email
        FROM staff_users s
        LEFT JOIN users u
          ON u.id=s.auth_user_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY s.created_at ASC
        `,
        params
      );

    return jsonOk(res, {
      doctors:
        result.rows.map(mapDoctor)
    });
  }
);

app.get(
  "/api/doctors/:id",
  async (req, res) => {
    const result =
      await pool.query(
        `
        SELECT
          s.*,
          u.email
        FROM staff_users s
        LEFT JOIN users u
          ON u.id=s.auth_user_id
        WHERE s.id=$1
          AND s.role='doctor'
          AND s.active=TRUE
        LIMIT 1
        `,
        [req.params.id]
      );

    if (!result.rowCount) {
      return jsonError(
        res,
        "الطبيب غير موجود.",
        404
      );
    }

    return jsonOk(res, {
      doctor:
        mapDoctor(result.rows[0])
    });
  }
);

/* =========================================================
   CREATE APPOINTMENT
========================================================= */

app.post(
  "/api/appointments",
  requirePatient,
  async (req, res) => {
    const serviceId =
      req.body.service_id || null;

    const doctorId =
      req.body.doctor_id || null;

    const appointmentDate =
      String(
        req.body.appointment_date || ""
      );

    const appointmentTime =
      String(
        req.body.appointment_time || ""
      );

    const notes =
      String(req.body.notes || "").trim();

    if (!validDate(appointmentDate)) {
      return jsonError(
        res,
        "تاريخ الموعد غير صحيح."
      );
    }

    if (!validTime(appointmentTime)) {
      return jsonError(
        res,
        "وقت الموعد غير صحيح."
      );
    }

    const patientResult =
      await pool.query(
        `SELECT id
         FROM patients
         WHERE auth_user_id=$1
         LIMIT 1`,
        [req.user.id]
      );

    if (!patientResult.rowCount) {
      return jsonError(
        res,
        "بيانات المريض غير موجودة.",
        404
      );
    }

    const patientId =
      patientResult.rows[0].id;

    let service = null;

    if (serviceId) {
      const serviceResult =
        await pool.query(
          `SELECT *
           FROM services
           WHERE id=$1
             AND active=TRUE
           LIMIT 1`,
          [serviceId]
        );

      service =
        serviceResult.rows[0];

      if (!service) {
        return jsonError(
          res,
          "الخدمة الطبية غير موجودة."
        );
      }
    }

    if (doctorId) {
      const doctorResult =
        await pool.query(
          `SELECT *
           FROM staff_users
           WHERE id=$1
             AND role='doctor'
             AND active=TRUE
             AND available=TRUE
           LIMIT 1`,
          [doctorId]
        );

      if (!doctorResult.rowCount) {
        return jsonError(
          res,
          "الطبيب غير متاح حالياً."
        );
      }

      const conflict =
        await pool.query(
          `SELECT id
           FROM appointments
           WHERE doctor_id=$1
             AND appointment_date=$2
             AND appointment_time=$3
             AND status IN ('pending','confirmed')
           LIMIT 1`,
          [
            doctorId,
            appointmentDate,
            appointmentTime
          ]
        );

      if (conflict.rowCount) {
        return jsonError(
          res,
          "هذا الموعد محجوز مسبقاً للطبيب. اختر وقتاً آخر."
        );
      }
    } else {
      const conflict =
        await pool.query(
          `SELECT id
           FROM appointments
           WHERE doctor_id IS NULL
             AND appointment_date=$1
             AND appointment_time=$2
             AND status IN ('pending','confirmed')
           LIMIT 1`,
          [
            appointmentDate,
            appointmentTime
          ]
        );

      if (conflict.rowCount) {
        return jsonError(
          res,
          "هذا الموعد محجوز مسبقاً. اختر وقتاً آخر."
        );
      }
    }

    try {
      const result =
        await pool.query(
          `INSERT INTO appointments
            (patient_id,doctor_id,service_id,
             appointment_date,appointment_time,
             status,notes,confirmed,cancelled)
           VALUES
            ($1,$2,$3,$4,$5,'pending',$6,FALSE,FALSE)
           RETURNING *`,
          [
            patientId,
            doctorId,
            service
              ? service.id
              : null,
            appointmentDate,
            appointmentTime,
            notes
          ]
        );

      return jsonOk(res, {
        appointment:
          mapAppointment(result.rows[0])
      });
    } catch (error) {
      if (error.code === "23505") {
        return jsonError(
          res,
          "هذا الموعد محجوز مسبقاً. اختر وقتاً آخر."
        );
      }

      console.error(error);

      return jsonError(
        res,
        "تعذر إنشاء الموعد.",
        500
      );
    }
  }
);

/* =========================================================
   MY APPOINTMENTS
========================================================= */

app.get(
  "/api/my-appointments",
  requirePatient,
  async (req, res) => {
    const patientResult =
      await pool.query(
        `SELECT id
         FROM patients
         WHERE auth_user_id=$1
         LIMIT 1`,
        [req.user.id]
      );

    if (!patientResult.rowCount) {
      return jsonOk(res, {
        appointments: []
      });
    }

    const result =
      await pool.query(
        `
        SELECT
          a.*,
          d.full_name AS doctor_name,
          s.name AS service_name
        FROM appointments a
        LEFT JOIN staff_users d
          ON d.id=a.doctor_id
        LEFT JOIN services s
          ON s.id=a.service_id
        WHERE a.patient_id=$1
        ORDER BY
          a.appointment_date DESC,
          a.appointment_time DESC
        `,
        [patientResult.rows[0].id]
      );

    return jsonOk(res, {
      appointments:
        result.rows.map(mapAppointment)
    });
  }
);

app.get(
  "/api/patient/appointments",
  requirePatient,
  async (req, res) => {
    const patientResult =
      await pool.query(
        `SELECT id
         FROM patients
         WHERE auth_user_id=$1
         LIMIT 1`,
        [req.user.id]
      );

    const result =
      await pool.query(
        `
        SELECT
          a.*,
          d.full_name AS doctor_name,
          s.name AS service_name
        FROM appointments a
        LEFT JOIN staff_users d
          ON d.id=a.doctor_id
        LEFT JOIN services s
          ON s.id=a.service_id
        WHERE a.patient_id=$1
        ORDER BY a.appointment_date DESC
        `,
        [
          patientResult.rows[0]?.id || null
        ]
      );

    return jsonOk(res, {
      appointments:
        result.rows.map(mapAppointment)
    });
  }
);

/* =========================================================
   ADS PUBLIC
========================================================= */

app.get(
  "/api/ads",
  async (req, res) => {
    const result =
      await pool.query(
        `SELECT *
         FROM ads
         WHERE active=TRUE
         ORDER BY created_at DESC`
      );

    return jsonOk(res, {
      ads: result.rows
    });
  }
);

app.post(
  "/api/ads/:id/impression",
  async (req, res) => {
    await pool.query(
      `INSERT INTO ad_impressions(ad_id)
       SELECT id
       FROM ads
       WHERE id=$1
         AND active=TRUE`,
      [req.params.id]
    );

    return jsonOk(res);
  }
);

app.post(
  "/api/ads/:id/click",
  async (req, res) => {
    await pool.query(
      `INSERT INTO ad_clicks(ad_id)
       SELECT id
       FROM ads
       WHERE id=$1
         AND active=TRUE`,
      [req.params.id]
    );

    return jsonOk(res);
  }
);

/* =========================================================
   STAFF ME
========================================================= */

app.get(
  "/api/staff/me",
  requireStaff,
  async (req, res) => {
    const result =
      await pool.query(
        `
        SELECT
          s.*,
          u.email
        FROM staff_users s
        LEFT JOIN users u
          ON u.id=s.auth_user_id
        WHERE s.auth_user_id=$1
        LIMIT 1
        `,
        [req.user.id]
      );

    return jsonOk(res, {
      user: {
        id: req.user.id,
        username: req.user.username,
        role: req.user.role,
        email: req.user.email
      },
      staff:
        mapDoctor(result.rows[0])
    });
  }
);

/* =========================================================
   DASHBOARD STATS
========================================================= */

app.get(
  "/api/dashboard/stats",
  requireStaff,
  async (req, res) => {
    const result =
      await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM patients)::int
            AS patients,
          (SELECT COUNT(*) FROM appointments)::int
            AS appointments,
          (SELECT COUNT(*)
           FROM appointments
           WHERE status='pending')::int
            AS pending,
          (SELECT COUNT(*)
           FROM appointments
           WHERE status='confirmed')::int
            AS confirmed,
          (SELECT COUNT(*)
           FROM staff_users
           WHERE role='doctor'
             AND active=TRUE)::int
            AS doctors,
          (SELECT COUNT(*)
           FROM services
           WHERE active=TRUE)::int
            AS services,
          (SELECT COUNT(*)
           FROM ads
           WHERE active=TRUE)::int
            AS ads
      `);

    return jsonOk(res, {
      stats: result.rows[0]
    });
  }
);

/* =========================================================
   DASHBOARD APPOINTMENTS
========================================================= */

app.get(
  "/api/dashboard/appointments",
  requireStaff,
  async (req, res) => {
    const status =
      String(req.query.status || "")
        .trim();

    const params = [];
    let where = "";

    if (status) {
      params.push(status);
      where = `WHERE a.status=$1`;
    }

    const result =
      await pool.query(
        `
        SELECT
          a.*,
          p.full_name AS patient_name,
          p.phone AS patient_phone,
          d.full_name AS doctor_name,
          s.name AS service_name
        FROM appointments a
        JOIN patients p
          ON p.id=a.patient_id
        LEFT JOIN staff_users d
          ON d.id=a.doctor_id
        LEFT JOIN services s
          ON s.id=a.service_id
        ${where}
        ORDER BY
          a.appointment_date DESC,
          a.appointment_time DESC
        `,
        params
      );

    return jsonOk(res, {
      appointments:
        result.rows.map(row => ({
          ...mapAppointment(row),
          patient_name:
            row.patient_name || "",
          patient_phone:
            row.patient_phone || ""
        }))
    });
  }
);

/* =========================================================
   CONFIRM / CANCEL
========================================================= */

app.patch(
  "/api/dashboard/appointments/:id/confirm",
  requireStaff,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `UPDATE appointments
           SET status='confirmed',
               confirmed=TRUE,
               cancelled=FALSE,
               updated_at=NOW()
           WHERE id=$1
           RETURNING *`,
          [req.params.id]
        );

      if (!result.rowCount) {
        return jsonError(
          res,
          "الموعد غير موجود.",
          404
        );
      }

      return jsonOk(res, {
        appointment:
          mapAppointment(result.rows[0])
      });
    } catch (error) {
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
  requireStaff,
  async (req, res) => {
    const result =
      await pool.query(
        `UPDATE appointments
         SET status='cancelled',
             confirmed=FALSE,
             cancelled=TRUE,
             updated_at=NOW()
         WHERE id=$1
         RETURNING *`,
        [req.params.id]
      );

    if (!result.rowCount) {
      return jsonError(
        res,
        "الموعد غير موجود.",
        404
      );
    }

    return jsonOk(res, {
      appointment:
        mapAppointment(result.rows[0])
    });
  }
);

/* =========================================================
   DASHBOARD PATIENTS
========================================================= */

app.get(
  "/api/dashboard/patients",
  requireStaff,
  async (req, res) => {
    const result =
      await pool.query(`
        SELECT
          p.*,
          COUNT(a.id)::int AS appointments_count
        FROM patients p
        LEFT JOIN appointments a
          ON a.patient_id=p.id
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `);

    return jsonOk(res, {
      patients: result.rows
    });
  }
);

/* =========================================================
   MEDICAL RECORDS
========================================================= */

app.get(
  "/api/dashboard/patients/:patientId/medical-records",
  requireStaff,
  async (req, res) => {
    const result =
      await pool.query(
        `
        SELECT
          m.*,
          d.full_name AS doctor_name
        FROM medical_records m
        LEFT JOIN staff_users d
          ON d.id=m.doctor_id
        WHERE m.patient_id=$1
        ORDER BY m.created_at DESC
        `,
        [req.params.patientId]
      );

    return jsonOk(res, {
      records: result.rows
    });
  }
);

app.post(
  "/api/dashboard/patients/:patientId/medical-records",
  requireStaff,
  async (req, res) => {
    const diagnosis =
      String(req.body.diagnosis || "");

    const notes =
      String(req.body.notes || "");

    const prescription =
      String(req.body.prescription || "");

    const result =
      await pool.query(
        `
        INSERT INTO medical_records
          (patient_id,doctor_id,
           diagnosis,notes,prescription)
        VALUES ($1,$2,$3,$4,$5)
        RETURNING *
        `,
        [
          req.params.patientId,
          req.user.staff_id || null,
          diagnosis,
          notes,
          prescription
        ]
      );

    return jsonOk(res, {
      record: result.rows[0]
    });
  }
);

/* =========================================================
   SERVICES DASHBOARD
========================================================= */

app.get(
  "/api/dashboard/services",
  requireStaff,
  async (req, res) => {
    const result =
      await pool.query(
        `SELECT *
         FROM services
         ORDER BY created_at DESC`
      );

    return jsonOk(res, {
      services:
        result.rows.map(mapService)
    });
  }
);

app.post(
  "/api/dashboard/services",
  requireStaff,
  async (req, res) => {
    const name =
      String(req.body.name || "").trim();

    if (!name) {
      return jsonError(
        res,
        "اسم الخدمة مطلوب."
      );
    }

    try {
      const result =
        await pool.query(
          `
          INSERT INTO services
            (name,description,
             duration_minutes,price,active)
          VALUES ($1,$2,$3,$4,$5)
          RETURNING *
          `,
          [
            name,
            String(req.body.description || ""),
            Number(
              req.body.duration_minutes || 30
            ),
            req.body.price === "" ||
            req.body.price == null
              ? null
              : Number(req.body.price),
            req.body.active !== false
          ]
        );

      return jsonOk(res, {
        service:
          mapService(result.rows[0])
      });
    } catch (error) {
      if (error.code === "23505") {
        return jsonError(
          res,
          "هذه الخدمة موجودة بالفعل."
        );
      }

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
  requireStaff,
  async (req, res) => {
    const result =
      await pool.query(
        `
        UPDATE services
        SET
          name=COALESCE($1,name),
          description=COALESCE($2,description),
          duration_minutes=COALESCE($3,duration_minutes),
          price=$4,
          active=COALESCE($5,active),
          updated_at=NOW()
        WHERE id=$6
        RETURNING *
        `,
        [
          req.body.name
            ? String(req.body.name).trim()
            : null,
          req.body.description != null
            ? String(req.body.description)
            : null,
          req.body.duration_minutes != null
            ? Number(req.body.duration_minutes)
            : null,
          req.body.price === ""
            ? null
            : req.body.price != null
              ? Number(req.body.price)
              : null,
          req.body.active != null
            ? Boolean(req.body.active)
            : null,
          req.params.id
        ]
      );

    if (!result.rowCount) {
      return jsonError(
        res,
        "الخدمة غير موجودة.",
        404
      );
    }

    return jsonOk(res, {
      service:
        mapService(result.rows[0])
    });
  }
);

app.delete(
  "/api/dashboard/services/:id",
  requireStaff,
  async (req, res) => {
    await pool.query(
      `DELETE FROM services WHERE id=$1`,
      [req.params.id]
    );

    return jsonOk(res);
  }
);

/* =========================================================
   DASHBOARD DOCTORS
========================================================= */

app.get(
  "/api/dashboard/doctors",
  requireAdmin,
  async (req, res) => {
    const result =
      await pool.query(
        `
        SELECT
          s.*,
          u.email
        FROM staff_users s
        LEFT JOIN users u
          ON u.id=s.auth_user_id
        WHERE s.role='doctor'
        ORDER BY s.created_at DESC
        `
      );

    return jsonOk(res, {
      doctors:
        result.rows.map(mapDoctor)
    });
  }
);

/* =========================================================
   CREATE DOCTOR
========================================================= */

app.post(
  "/api/dashboard/doctors",
  requireAdmin,
  async (req, res) => {
    const username =
      normalizeUsername(req.body.username);

    const password =
      String(req.body.password || "");

    const fullName =
      String(req.body.full_name || "").trim();

    const phone =
      String(req.body.phone || "").trim();

    const email =
      req.body.email
        ? String(req.body.email).trim()
        : null;

    const specialty =
      String(req.body.specialty || "").trim();

    const area =
      String(req.body.area || "").trim();

    const imageUrl =
      String(req.body.image_url || "").trim();

    const bio =
      String(req.body.bio || "").trim();

    if (!username || username.length < 3) {
      return jsonError(
        res,
        "اسم المستخدم مطلوب ويجب أن يكون 3 أحرف على الأقل."
      );
    }

    if (!password || password.length < 6) {
      return jsonError(
        res,
        "كلمة مرور الطبيب يجب أن تكون 6 أحرف على الأقل."
      );
    }

    if (!fullName) {
      return jsonError(
        res,
        "اسم الطبيب مطلوب."
      );
    }

    const existing =
      await pool.query(
        `SELECT id FROM users WHERE username=$1`,
        [username]
      );

    if (existing.rowCount) {
      return jsonError(
        res,
        "اسم المستخدم مستخدم بالفعل."
      );
    }

    const { salt, hash } =
      hashPassword(password);

    const client =
      await pool.connect();

    try {
      await client.query("BEGIN");

      const userResult =
        await client.query(
          `
          INSERT INTO users
            (username,password_hash,
             password_salt,role,
             active,email)
          VALUES
            ($1,$2,$3,'doctor',TRUE,$4)
          RETURNING id
          `,
          [
            username,
            hash,
            salt,
            email
          ]
        );

      const userId =
        userResult.rows[0].id;

      const staffResult =
        await client.query(
          `
          INSERT INTO staff_users
            (auth_user_id,full_name,
             phone,username,role,
             active,specialty,
             area,image_url,bio,
             available)
          VALUES
            ($1,$2,$3,$4,'doctor',
             $5,$6,$7,$8,$9,$10)
          RETURNING *
          `,
          [
            userId,
            fullName,
            phone,
            username,
            req.body.active !== false,
            specialty,
            area,
            imageUrl,
            bio,
            req.body.available !== false
          ]
        );

      await client.query("COMMIT");

      return jsonOk(res, {
        doctor:
          mapDoctor({
            ...staffResult.rows[0],
            email
          })
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(error);

      if (error.code === "23505") {
        return jsonError(
          res,
          "بيانات الطبيب موجودة مسبقاً."
        );
      }

      return jsonError(
        res,
        "تعذر إضافة الطبيب.",
        500
      );
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   UPDATE DOCTOR
========================================================= */

app.patch(
  "/api/dashboard/doctors/:id",
  requireAdmin,
  async (req, res) => {
    const doctorResult =
      await pool.query(
        `
        SELECT
          s.*,
          u.email
        FROM staff_users s
        LEFT JOIN users u
          ON u.id=s.auth_user_id
        WHERE s.id=$1
          AND s.role='doctor'
        LIMIT 1
        `,
        [req.params.id]
      );

    if (!doctorResult.rowCount) {
      return jsonError(
        res,
        "الطبيب غير موجود.",
        404
      );
    }

    const doctor =
      doctorResult.rows[0];

    const client =
      await pool.connect();

    try {
      await client.query("BEGIN");

      const staffResult =
        await client.query(
          `
          UPDATE staff_users
          SET
            full_name=COALESCE($1,full_name),
            phone=COALESCE($2,phone),
            specialty=COALESCE($3,specialty),
            area=COALESCE($4,area),
            image_url=COALESCE($5,image_url),
            bio=COALESCE($6,bio),
            active=COALESCE($7,active),
            available=COALESCE($8,available),
            updated_at=NOW()
          WHERE id=$9
          RETURNING *
          `,
          [
            req.body.full_name != null
              ? String(req.body.full_name).trim()
              : null,
            req.body.phone != null
              ? String(req.body.phone).trim()
              : null,
            req.body.specialty != null
              ? String(req.body.specialty).trim()
              : null,
            req.body.area != null
              ? String(req.body.area).trim()
              : null,
            req.body.image_url != null
              ? String(req.body.image_url).trim()
              : null,
            req.body.bio != null
              ? String(req.body.bio).trim()
              : null,
            req.body.active != null
              ? Boolean(req.body.active)
              : null,
            req.body.available != null
              ? Boolean(req.body.available)
              : null,
            req.params.id
          ]
        );

      if (
        req.body.email !== undefined
      ) {
        await client.query(
          `
          UPDATE users
          SET email=$1,
              updated_at=NOW()
          WHERE id=$2
          `,
          [
            req.body.email
              ? String(req.body.email).trim()
              : null,
            doctor.auth_user_id
          ]
        );
      }

      if (
        req.body.password &&
        String(req.body.password).length >= 6
      ) {
        const { salt, hash } =
          hashPassword(
            String(req.body.password)
          );

        await client.query(
          `
          UPDATE users
          SET password_hash=$1,
              password_salt=$2,
              updated_at=NOW()
          WHERE id=$3
          `,
          [
            hash,
            salt,
            doctor.auth_user_id
          ]
        );
      }

      const emailResult =
        await client.query(
          `SELECT email
           FROM users
           WHERE id=$1`,
          [doctor.auth_user_id]
        );

      await client.query("COMMIT");

      return jsonOk(res, {
        doctor:
          mapDoctor({
            ...staffResult.rows[0],
            email:
              emailResult.rows[0]?.email || ""
          })
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(error);

      return jsonError(
        res,
        "تعذر تحديث بيانات الطبيب.",
        500
      );
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   DELETE / DEACTIVATE DOCTOR
========================================================= */

app.delete(
  "/api/dashboard/doctors/:id",
  requireAdmin,
  async (req, res) => {
    const result =
      await pool.query(
        `
        UPDATE staff_users
        SET active=FALSE,
            available=FALSE,
            updated_at=NOW()
        WHERE id=$1
          AND role='doctor'
        RETURNING *
        `,
        [req.params.id]
      );

    if (!result.rowCount) {
      return jsonError(
        res,
        "الطبيب غير موجود.",
        404
      );
    }

    return jsonOk(res, {
      message:
        "تم إيقاف الطبيب بنجاح."
    });
  }
);

/* =========================================================
   DASHBOARD ADS
========================================================= */

app.get(
  "/api/dashboard/ads",
  requireStaff,
  async (req, res) => {
    const result =
      await pool.query(`
        SELECT *
        FROM ads
        ORDER BY created_at DESC
      `);

    return jsonOk(res, {
      ads: result.rows
    });
  }
);

app.post(
  "/api/dashboard/ads",
  requireStaff,
  async (req, res) => {
    const result =
      await pool.query(
        `
        INSERT INTO ads
          (title,description,
           image_url,target_url,
           advertiser_name,active)
        VALUES
          ($1,$2,$3,$4,$5,$6)
        RETURNING *
        `,
        [
          String(req.body.title || "").trim(),
          String(req.body.description || ""),
          String(req.body.image_url || ""),
          String(req.body.target_url || ""),
          String(req.body.advertiser_name || ""),
          req.body.active !== false
        ]
      );

    return jsonOk(res, {
      ad: result.rows[0]
    });
  }
);

app.patch(
  "/api/dashboard/ads/:id",
  requireStaff,
  async (req, res) => {
    const result =
      await pool.query(
        `
        UPDATE ads
        SET
          title=COALESCE($1,title),
          description=COALESCE($2,description),
          image_url=COALESCE($3,image_url),
          target_url=COALESCE($4,target_url),
          advertiser_name=COALESCE($5,advertiser_name),
          active=COALESCE($6,active),
          updated_at=NOW()
        WHERE id=$7
        RETURNING *
        `,
        [
          req.body.title != null
            ? String(req.body.title).trim()
            : null,
          req.body.description != null
            ? String(req.body.description)
            : null,
          req.body.image_url != null
            ? String(req.body.image_url)
            : null,
          req.body.target_url != null
            ? String(req.body.target_url)
            : null,
          req.body.advertiser_name != null
            ? String(req.body.advertiser_name)
            : null,
          req.body.active != null
            ? Boolean(req.body.active)
            : null,
          req.params.id
        ]
      );

    if (!result.rowCount) {
      return jsonError(
        res,
        "الإعلان غير موجود.",
        404
      );
    }

    return jsonOk(res, {
      ad: result.rows[0]
    });
  }
);

app.delete(
  "/api/dashboard/ads/:id",
  requireStaff,
  async (req, res) => {
    await pool.query(
      `DELETE FROM ads WHERE id=$1`,
      [req.params.id]
    );

    return jsonOk(res);
  }
);

/* =========================================================
   STATIC FILES
========================================================= */

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

app.get("*", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

/* =========================================================
   START
========================================================= */

async function start() {
  try {
    await initDatabase();

    await pool.query("SELECT 1");

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

start();

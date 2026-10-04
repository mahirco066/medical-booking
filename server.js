const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not configured.");
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

function jsonError(res, message, status = 400, extra = {}) {
  return res.status(status).json({
    ok: false,
    error: message,
    ...extra
  });
}

function jsonOk(res, data = {}, status = 200) {
  return res.status(status).json({
    ok: true,
    ...data
  });
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function validDate(value) {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value));
}

function validTime(value) {
  if (!value) return false;
  return /^([01]\d|2[0-3]):([0-5]\d)(:\d{2})?$/.test(String(value));
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return header.substring(7).trim() || null;
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

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.scryptSync(
    String(password),
    salt,
    64
  );

  return {
    salt,
    hash: derived.toString("hex")
  };
}

function verifyPassword(password, storedHash, salt) {
  try {
    const derived = crypto.scryptSync(
      String(password),
      salt,
      64
    ).toString("hex");

    return crypto.timingSafeEqual(
      Buffer.from(derived, "hex"),
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
    full_name: row.full_name,
    phone: row.phone,
    username: row.username,
    email: row.email || null,
    created_at: row.created_at
  };
}

function mapService(row) {
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    duration_minutes: row.duration_minutes || 30,
    price: row.price ?? null,
    active: row.active !== false,
    created_at: row.created_at
  };
}

function mapAppointment(row) {
  if (!row) return null;

  return {
    id: row.id,
    patient_id: row.patient_id,
    patient_name: row.patient_name || null,
    patient_phone: row.patient_phone || null,
    doctor_id: row.doctor_id || null,
    doctor_name: row.doctor_name || null,
    service_id: row.service_id || null,
    service_name: row.service_name || null,
    appointment_date: row.appointment_date,
    appointment_time: row.appointment_time,
    status: row.status,
    notes: row.notes || "",
    created_at: row.created_at,
    confirmed_at: row.confirmed_at || null,
    cancelled_at: row.cancelled_at || null
  };
}

function normalizeAppointmentInput(body = {}) {
  return {
    service_id: body.service_id || null,
    service: body.service || body.service_name || null,
    doctor_id: body.doctor_id || null,
    appointment_date: body.appointment_date || body.date || null,
    appointment_time: body.appointment_time || body.time || null,
    notes: body.notes || ""
  };
}

/* =========================================================
   DATABASE INITIALIZATION
========================================================= */

async function initDatabase() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'patient',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        email TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS patients (
        id UUID PRIMARY KEY,
        auth_user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        full_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        email TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS staff_users (
        id UUID PRIMARY KEY,
        auth_user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        full_name TEXT NOT NULL,
        phone TEXT,
        username TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL DEFAULT 'doctor',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS services (
        id UUID PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT DEFAULT '',
        duration_minutes INTEGER NOT NULL DEFAULT 30,
        price NUMERIC(12,2),
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id UUID PRIMARY KEY,
        patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        doctor_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
        service_id UUID REFERENCES services(id) ON DELETE SET NULL,
        appointment_date DATE NOT NULL,
        appointment_time TIME NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        notes TEXT DEFAULT '',
        confirmed_at TIMESTAMPTZ,
        cancelled_at TIMESTAMPTZ,
        confirmed_by UUID REFERENCES staff_users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS medical_records (
        id UUID PRIMARY KEY,
        patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        doctor_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
        diagnosis TEXT DEFAULT '',
        treatment TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        record_date DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ads (
        id UUID PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        image_url TEXT DEFAULT '',
        target_url TEXT DEFAULT '',
        business_name TEXT DEFAULT '',
        business_type TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        paid BOOLEAN NOT NULL DEFAULT FALSE,
        start_date DATE,
        end_date DATE,
        impressions_count INTEGER NOT NULL DEFAULT 0,
        clicks_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ad_impressions (
        id UUID PRIMARY KEY,
        ad_id UUID NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ad_clicks (
        id UUID PRIMARY KEY,
        ad_id UUID NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT UNIQUE NOT NULL,
        refresh_hash TEXT UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        refresh_expires_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_appointments_date
      ON appointments(appointment_date)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_appointments_patient
      ON appointments(patient_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_appointments_status
      ON appointments(status)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_token
      ON sessions(token_hash)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ads_active
      ON ads(active)
    `);

    /*
      Prevent double booking for appointments that are still active.
    */
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS appointments_doctor_slot_unique
      ON appointments(doctor_id, appointment_date, appointment_time)
      WHERE doctor_id IS NOT NULL
        AND status IN ('pending', 'confirmed')
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS appointments_general_slot_unique
      ON appointments(appointment_date, appointment_time)
      WHERE doctor_id IS NULL
        AND status IN ('pending', 'confirmed')
    `);

    /*
      Seed initial services only when the table is empty.
      They can later be edited from the dashboard.
    */
    const serviceCount = await client.query(
      `SELECT COUNT(*)::int AS count FROM services`
    );

    if (serviceCount.rows[0].count === 0) {
      const initialServices = [
        ["كشف طبي", "كشف واستشارة طبية", 30],
        ["استشارة", "استشارة طبية", 30],
        ["متابعة", "موعد متابعة", 30],
        ["فحص وتشخيص", "فحص وتشخيص طبي", 45]
      ];

      for (const [name, description, duration] of initialServices) {
        await client.query(
          `
          INSERT INTO services
          (id, name, description, duration_minutes)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (name) DO NOTHING
          `,
          [
            crypto.randomUUID(),
            name,
            description,
            duration
          ]
        );
      }
    }

    /*
      Optional initial administrator.
      Set ADMIN_USERNAME and ADMIN_PASSWORD in Render.
    */
    if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
      const adminUsername = normalizeUsername(
        process.env.ADMIN_USERNAME
      );

      const existingAdmin = await client.query(
        `SELECT id FROM users WHERE username = $1 LIMIT 1`,
        [adminUsername]
      );

      if (existingAdmin.rowCount === 0) {
        const password = hashPassword(
          process.env.ADMIN_PASSWORD
        );

        const userId = crypto.randomUUID();
        const staffId = crypto.randomUUID();

        await client.query(
          `
          INSERT INTO users
          (id, username, password_hash, password_salt, role)
          VALUES ($1, $2, $3, $4, 'admin')
          `,
          [
            userId,
            adminUsername,
            password.hash,
            password.salt
          ]
        );

        await client.query(
          `
          INSERT INTO staff_users
          (id, auth_user_id, full_name, username, role)
          VALUES ($1, $2, $3, $4, 'admin')
          `,
          [
            staffId,
            userId,
            process.env.ADMIN_NAME || "مدير النظام",
            adminUsername
          ]
        );

        console.log(
          `Initial admin account created: ${adminUsername}`
        );
      }
    }

    await client.query("COMMIT");

    console.log("Neon database initialized successfully.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Database initialization failed:", error);
    throw error;
  } finally {
    client.release();
  }
}

/* =========================================================
   AUTH
========================================================= */

async function createSession(userId) {
  const token = randomToken(48);
  const refreshToken = randomToken(48);

  const tokenHash = hashToken(token);
  const refreshHash = hashToken(refreshToken);

  await pool.query(
    `
    INSERT INTO sessions
    (
      id,
      user_id,
      token_hash,
      refresh_hash,
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
      crypto.randomUUID(),
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

async function getAuthenticatedUser(token) {
  if (!token) return null;

  const tokenHash = hashToken(token);

  const result = await pool.query(
    `
    SELECT
      u.id,
      u.username,
      u.role,
      u.active,
      u.email,
      s.id AS session_id
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1
      AND s.revoked_at IS NULL
      AND s.expires_at > NOW()
      AND u.active = TRUE
    LIMIT 1
    `,
    [tokenHash]
  );

  return result.rows[0] || null;
}

async function requireAuth(req, res, next) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return jsonError(
        res,
        "Authentication required",
        401
      );
    }

    const user = await getAuthenticatedUser(token);

    if (!user) {
      return jsonError(
        res,
        "Invalid or expired session",
        401
      );
    }

    req.authUser = user;
    req.authToken = token;

    next();
  } catch (error) {
    console.error("Authentication error:", error);
    return jsonError(res, "Authentication error", 500);
  }
}

async function getPatientByAuthUserId(userId) {
  const result = await pool.query(
    `
    SELECT *
    FROM patients
    WHERE auth_user_id = $1
    LIMIT 1
    `,
    [userId]
  );

  return result.rows[0] || null;
}

async function getStaffByAuthUserId(userId) {
  const result = await pool.query(
    `
    SELECT *
    FROM staff_users
    WHERE auth_user_id = $1
      AND active = TRUE
    LIMIT 1
    `,
    [userId]
  );

  return result.rows[0] || null;
}

async function requireStaff(req, res, next) {
  try {
    await requireAuth(req, res, async () => {
      const staff = await getStaffByAuthUserId(
        req.authUser.id
      );

      if (!staff) {
        return jsonError(
          res,
          "Staff access required",
          403
        );
      }

      req.staff = staff;
      next();
    });
  } catch (error) {
    console.error("Staff authentication error:", error);
    return jsonError(res, "Authentication error", 500);
  }
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
    console.error(error);

    return jsonError(
      res,
      "Database connection failed",
      500
    );
  }
});

/* =========================================================
   CONFIG
========================================================= */

app.get("/api/config", (req, res) => {
  return jsonOk(res, {
    clinic_name:
      process.env.APP_NAME ||
      "منصة الحجز الطبي",
    specialty:
      process.env.APP_SPECIALTY ||
      "منصة لحجز المواعيد والخدمات الطبية"
  });
});

/* =========================================================
   PATIENT REGISTRATION
========================================================= */

app.post("/api/patient/register", async (req, res) => {
  const fullName = String(
    req.body.full_name || req.body.name || ""
  ).trim();

  const phone = String(
    req.body.phone || ""
  ).trim();

  const username = normalizeUsername(
    req.body.username
  );

  const password = String(
    req.body.password || ""
  );

  const email = String(
    req.body.email || ""
  ).trim() || null;

  if (fullName.length < 2) {
    return jsonError(
      res,
      "الاسم الكامل مطلوب"
    );
  }

  if (phone.length < 5) {
    return jsonError(
      res,
      "رقم الهاتف مطلوب"
    );
  }

  if (username.length < 3) {
    return jsonError(
      res,
      "اسم المستخدم يجب أن يكون 3 أحرف على الأقل"
    );
  }

  if (password.length < 6) {
    return jsonError(
      res,
      "كلمة المرور يجب أن تكون 6 أحرف على الأقل"
    );
  }

  try {
    const existing = await pool.query(
      `SELECT id FROM users WHERE username = $1 LIMIT 1`,
      [username]
    );

    if (existing.rowCount > 0) {
      return jsonError(
        res,
        "اسم المستخدم مستخدم بالفعل"
      );
    }

    const passwordData = hashPassword(password);
    const userId = crypto.randomUUID();
    const patientId = crypto.randomUUID();

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
          email
        )
        VALUES ($1, $2, $3, $4, 'patient', $5)
        `,
        [
          userId,
          username,
          passwordData.hash,
          passwordData.salt,
          email
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
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          patientId,
          userId,
          fullName,
          phone,
          username,
          email
        ]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const session = await createSession(userId);

    return jsonOk(
      res,
      {
        user: {
          id: userId,
          username,
          role: "patient"
        },
        patient: {
          id: patientId,
          full_name: fullName,
          phone,
          username,
          email
        },
        ...session
      },
      201
    );
  } catch (error) {
    console.error("Patient registration error:", error);

    return jsonError(
      res,
      "تعذر إنشاء الحساب",
      500
    );
  }
});

/* =========================================================
   PATIENT LOGIN
========================================================= */

app.post("/api/patient/login", async (req, res) => {
  const username = normalizeUsername(
    req.body.username
  );

  const password = String(
    req.body.password || ""
  );

  if (!username || !password) {
    return jsonError(
      res,
      "اسم المستخدم وكلمة المرور مطلوبان"
    );
  }

  try {
    const result = await pool.query(
      `
      SELECT *
      FROM users
      WHERE username = $1
        AND active = TRUE
      LIMIT 1
      `,
      [username]
    );

    const user = result.rows[0];

    if (!user) {
      return jsonError(
        res,
        "بيانات الدخول غير صحيحة",
        401
      );
    }

    if (
      !verifyPassword(
        password,
        user.password_hash,
        user.password_salt
      )
    ) {
      return jsonError(
        res,
        "بيانات الدخول غير صحيحة",
        401
      );
    }

    if (user.role !== "patient") {
      return jsonError(
        res,
        "هذا الحساب ليس حساب مريض",
        403
      );
    }

    const patient =
      await getPatientByAuthUserId(user.id);

    if (!patient) {
      return jsonError(
        res,
        "حساب المريض غير مكتمل",
        500
      );
    }

    const session =
      await createSession(user.id);

    return jsonOk(res, {
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      },
      patient: mapPatient(patient),
      ...session
    });
  } catch (error) {
    console.error("Patient login error:", error);

    return jsonError(
      res,
      "تعذر تسجيل الدخول",
      500
    );
  }
});

/* =========================================================
   STAFF LOGIN
========================================================= */

app.post("/api/staff/login", async (req, res) => {
  const username = normalizeUsername(
    req.body.username
  );

  const password = String(
    req.body.password || ""
  );

  if (!username || !password) {
    return jsonError(
      res,
      "اسم المستخدم وكلمة المرور مطلوبان"
    );
  }

  try {
    const result = await pool.query(
      `
      SELECT
        u.*,
        s.id AS staff_id,
        s.full_name AS staff_name,
        s.phone AS staff_phone,
        s.role AS staff_role,
        s.active AS staff_active
      FROM users u
      JOIN staff_users s
        ON s.auth_user_id = u.id
      WHERE u.username = $1
        AND u.active = TRUE
        AND s.active = TRUE
      LIMIT 1
      `,
      [username]
    );

    const row = result.rows[0];

    if (!row) {
      return jsonError(
        res,
        "بيانات الدخول غير صحيحة",
        401
      );
    }

    if (
      !verifyPassword(
        password,
        row.password_hash,
        row.password_salt
      )
    ) {
      return jsonError(
        res,
        "بيانات الدخول غير صحيحة",
        401
      );
    }

    const session =
      await createSession(row.id);

    return jsonOk(res, {
      user: {
        id: row.id,
        username: row.username,
        role: row.role
      },
      staff: {
        id: row.staff_id,
        full_name: row.staff_name,
        phone: row.staff_phone,
        role: row.staff_role
      },
      ...session
    });
  } catch (error) {
    console.error("Staff login error:", error);

    return jsonError(
      res,
      "تعذر تسجيل الدخول",
      500
    );
  }
});

/* Aliases */
app.post("/api/admin/login", (req, res) => {
  req.url = "/api/staff/login";
  app.handle(req, res);
});

app.post("/api/login", (req, res) => {
  req.url = "/api/staff/login";
  app.handle(req, res);
});

/* =========================================================
   REFRESH SESSION
========================================================= */

app.post("/api/refresh", async (req, res) => {
  const refreshToken = String(
    req.body.refreshToken ||
    req.body.refresh_token ||
    ""
  ).trim();

  if (!refreshToken) {
    return jsonError(
      res,
      "Refresh token required",
      401
    );
  }

  try {
    const refreshHash =
      hashToken(refreshToken);

    const result = await pool.query(
      `
      SELECT user_id
      FROM sessions
      WHERE refresh_hash = $1
        AND revoked_at IS NULL
        AND refresh_expires_at > NOW()
      LIMIT 1
      `,
      [refreshHash]
    );

    if (result.rowCount === 0) {
      return jsonError(
        res,
        "Invalid refresh token",
        401
      );
    }

    const session =
      await createSession(
        result.rows[0].user_id
      );

    return jsonOk(res, session);
  } catch (error) {
    console.error(error);

    return jsonError(
      res,
      "Unable to refresh session",
      500
    );
  }
});

/* =========================================================
   PATIENT SESSION
========================================================= */

app.get(
  "/api/patient/me",
  requireAuth,
  async (req, res) => {
    try {
      const patient =
        await getPatientByAuthUserId(
          req.authUser.id
        );

      if (!patient) {
        return jsonError(
          res,
          "Patient not found",
          404
        );
      }

      return jsonOk(res, {
        user: {
          id: req.authUser.id,
          username: req.authUser.username,
          role: req.authUser.role
        },
        patient: mapPatient(patient)
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "Unable to load patient",
        500
      );
    }
  }
);

/* =========================================================
   LOGOUT
========================================================= */

app.post(
  "/api/logout",
  requireAuth,
  async (req, res) => {
    try {
      await pool.query(
        `
        UPDATE sessions
        SET revoked_at = NOW()
        WHERE token_hash = $1
        `,
        [hashToken(req.authToken)]
      );

      return jsonOk(res, {
        message: "Logged out successfully"
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "Unable to logout",
        500
      );
    }
  }
);

/* =========================================================
   SERVICES - PUBLIC
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
      "Unable to load services",
      500
    );
  }
});

/* =========================================================
   CREATE APPOINTMENT
========================================================= */

app.post(
  "/api/appointments",
  requireAuth,
  async (req, res) => {
    try {
      if (req.authUser.role !== "patient") {
        return jsonError(
          res,
          "Only patients can create appointments",
          403
        );
      }

      const patient =
        await getPatientByAuthUserId(
          req.authUser.id
        );

      if (!patient) {
        return jsonError(
          res,
          "Patient profile not found",
          404
        );
      }

      const input =
        normalizeAppointmentInput(req.body);

      if (
        !validDate(input.appointment_date)
      ) {
        return jsonError(
          res,
          "تاريخ الموعد غير صحيح"
        );
      }

      if (
        !validTime(input.appointment_time)
      ) {
        return jsonError(
          res,
          "وقت الموعد غير صحيح"
        );
      }

      let service = null;

      if (input.service_id) {
        const serviceResult =
          await pool.query(
            `
            SELECT *
            FROM services
            WHERE id = $1
              AND active = TRUE
            LIMIT 1
            `,
            [input.service_id]
          );

        service =
          serviceResult.rows[0] || null;
      }

      if (!service && input.service) {
        const serviceResult =
          await pool.query(
            `
            SELECT *
            FROM services
            WHERE LOWER(name) =
                  LOWER($1)
              AND active = TRUE
            LIMIT 1
            `,
            [input.service]
          );

        service =
          serviceResult.rows[0] || null;
      }

      if (!service) {
        return jsonError(
          res,
          "الخدمة المطلوبة غير موجودة"
        );
      }

      let doctor = null;

      if (input.doctor_id) {
        const doctorResult =
          await pool.query(
            `
            SELECT *
            FROM staff_users
            WHERE id = $1
              AND active = TRUE
            LIMIT 1
            `,
            [input.doctor_id]
          );

        doctor =
          doctorResult.rows[0] || null;

        if (!doctor) {
          return jsonError(
            res,
            "الطبيب غير موجود"
          );
        }
      }

      /*
        Check for an existing active appointment
        at the requested slot.
      */
      let duplicate;

      if (doctor) {
        duplicate =
          await pool.query(
            `
            SELECT id
            FROM appointments
            WHERE doctor_id = $1
              AND appointment_date = $2
              AND appointment_time = $3
              AND status IN ('pending', 'confirmed')
            LIMIT 1
            `,
            [
              doctor.id,
              input.appointment_date,
              input.appointment_time
            ]
          );
      } else {
        duplicate =
          await pool.query(
            `
            SELECT id
            FROM appointments
            WHERE doctor_id IS NULL
              AND appointment_date = $1
              AND appointment_time = $2
              AND status IN ('pending', 'confirmed')
            LIMIT 1
            `,
            [
              input.appointment_date,
              input.appointment_time
            ]
          );
      }

      if (duplicate.rowCount > 0) {
        return jsonError(
          res,
          "هذا الموعد محجوز بالفعل"
        );
      }

      const appointmentId =
        crypto.randomUUID();

      const result =
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
            notes
          )
          VALUES
          ($1, $2, $3, $4, $5, $6, 'pending', $7)
          RETURNING *
          `,
          [
            appointmentId,
            patient.id,
            doctor ? doctor.id : null,
            service.id,
            input.appointment_date,
            input.appointment_time,
            input.notes
          ]
        );

      return jsonOk(
        res,
        {
          appointment: result.rows[0],
          message:
            "تم إرسال طلب الحجز بنجاح"
        },
        201
      );
    } catch (error) {
      /*
        Handles PostgreSQL unique-index race conditions.
      */
      if (error.code === "23505") {
        return jsonError(
          res,
          "هذا الموعد تم حجزه بالفعل"
        );
      }

      console.error(
        "Appointment creation error:",
        error
      );

      return jsonError(
        res,
        "تعذر إنشاء الموعد",
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
  requireAuth,
  async (req, res) => {
    try {
      const patient =
        await getPatientByAuthUserId(
          req.authUser.id
        );

      if (!patient) {
        return jsonError(
          res,
          "Patient not found",
          404
        );
      }

      const result = await pool.query(
        `
        SELECT
          a.*,
          p.full_name AS patient_name,
          p.phone AS patient_phone,
          s.name AS service_name,
          d.full_name AS doctor_name
        FROM appointments a
        JOIN patients p
          ON p.id = a.patient_id
        LEFT JOIN services s
          ON s.id = a.service_id
        LEFT JOIN staff_users d
          ON d.id = a.doctor_id
        WHERE a.patient_id = $1
        ORDER BY
          a.appointment_date DESC,
          a.appointment_time DESC
        `,
        [patient.id]
      );

      return jsonOk(res, {
        appointments:
          result.rows.map(mapAppointment)
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "Unable to load appointments",
        500
      );
    }
  }
);

app.get(
  "/api/patient/appointments",
  (req, res) => {
    req.url = "/api/my-appointments";
    app.handle(req, res);
  }
);

/* =========================================================
   ADS - PUBLIC
========================================================= */

app.get("/api/ads", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT *
      FROM ads
      WHERE active = TRUE
        AND paid = TRUE
        AND (
          start_date IS NULL
          OR start_date <= CURRENT_DATE
        )
        AND (
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
      "Unable to load ads",
      500
    );
  }
});

app.post(
  "/api/ads/:id/impression",
  async (req, res) => {
    try {
      const adId = req.params.id;

      await pool.query(
        `
        INSERT INTO ad_impressions
        (id, ad_id)
        VALUES ($1, $2)
        `,
        [
          crypto.randomUUID(),
          adId
        ]
      );

      await pool.query(
        `
        UPDATE ads
        SET impressions_count =
            impressions_count + 1
        WHERE id = $1
        `,
        [adId]
      );

      return jsonOk(res);
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "Unable to record impression",
        500
      );
    }
  }
);

app.post(
  "/api/ads/:id/click",
  async (req, res) => {
    try {
      const adId = req.params.id;

      await pool.query(
        `
        INSERT INTO ad_clicks
        (id, ad_id)
        VALUES ($1, $2)
        `,
        [
          crypto.randomUUID(),
          adId
        ]
      );

      await pool.query(
        `
        UPDATE ads
        SET clicks_count =
            clicks_count + 1
        WHERE id = $1
        `,
        [adId]
      );

      return jsonOk(res);
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "Unable to record click",
        500
      );
    }
  }
);

/* =========================================================
   STAFF PROFILE
========================================================= */

app.get(
  "/api/staff/me",
  requireStaff,
  async (req, res) => {
    return jsonOk(res, {
      staff: {
        id: req.staff.id,
        full_name: req.staff.full_name,
        phone: req.staff.phone,
        username: req.staff.username,
        role: req.staff.role
      }
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
    try {
      const total =
        await pool.query(
          `SELECT COUNT(*)::int AS count FROM appointments`
        );

      const pending =
        await pool.query(
          `
          SELECT COUNT(*)::int AS count
          FROM appointments
          WHERE status = 'pending'
          `
        );

      const confirmed =
        await pool.query(
          `
          SELECT COUNT(*)::int AS count
          FROM appointments
          WHERE status = 'confirmed'
          `
        );

      const patients =
        await pool.query(
          `SELECT COUNT(*)::int AS count FROM patients`
        );

      const services =
        await pool.query(
          `
          SELECT COUNT(*)::int AS count
          FROM services
          WHERE active = TRUE
          `
        );

      const ads =
        await pool.query(
          `
          SELECT COUNT(*)::int AS count
          FROM ads
          WHERE active = TRUE
          `
        );

      return jsonOk(res, {
        stats: {
          total_appointments:
            total.rows[0].count,

          pending:
            pending.rows[0].count,

          confirmed:
            confirmed.rows[0].count,

          patients:
            patients.rows[0].count,

          services:
            services.rows[0].count,

          active_ads:
            ads.rows[0].count
        }
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "Unable to load dashboard stats",
        500
      );
    }
  }
);

/* =========================================================
   DASHBOARD APPOINTMENTS
========================================================= */

app.get(
  "/api/dashboard/appointments",
  requireStaff,
  async (req, res) => {
    try {
      const search =
        String(req.query.search || "").trim();

      const status =
        String(req.query.status || "").trim();

      const params = [];
      const conditions = [];

      if (status) {
        params.push(status);
        conditions.push(
          `a.status = $${params.length}`
        );
      }

      if (search) {
        params.push(`%${search}%`);

        conditions.push(`
          (
            p.full_name ILIKE $${params.length}
            OR p.phone ILIKE $${params.length}
          )
        `);
      }

      const where =
        conditions.length > 0
          ? `WHERE ${conditions.join(" AND ")}`
          : "";

      const result = await pool.query(
        `
        SELECT
          a.*,
          p.full_name AS patient_name,
          p.phone AS patient_phone,
          s.name AS service_name,
          d.full_name AS doctor_name
        FROM appointments a
        JOIN patients p
          ON p.id = a.patient_id
        LEFT JOIN services s
          ON s.id = a.service_id
        LEFT JOIN staff_users d
          ON d.id = a.doctor_id
        ${where}
        ORDER BY
          a.appointment_date ASC,
          a.appointment_time ASC
        `,
        params
      );

      return jsonOk(res, {
        appointments:
          result.rows.map(mapAppointment)
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "Unable to load dashboard appointments",
        500
      );
    }
  }
);

/* =========================================================
   CONFIRM APPOINTMENT
========================================================= */

app.patch(
  "/api/dashboard/appointments/:id/confirm",
  requireStaff,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        UPDATE appointments
        SET
          status = 'confirmed',
          confirmed_at = NOW(),
          confirmed_by = $1,
          updated_at = NOW()
        WHERE id = $2
          AND status = 'pending'
        RETURNING *
        `,
        [
          req.staff.id,
          req.params.id
        ]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          "Appointment not found or already processed",
          404
        );
      }

      return jsonOk(res, {
        appointment: result.rows[0],
        message: "تم تأكيد الحجز"
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "Unable to confirm appointment",
        500
      );
    }
  }
);

/* =========================================================
   CANCEL APPOINTMENT
========================================================= */

app.patch(
  "/api/dashboard/appointments/:id/cancel",
  requireStaff,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        UPDATE appointments
        SET
          status = 'cancelled',
          cancelled_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
          AND status IN ('pending', 'confirmed')
        RETURNING *
        `,
        [req.params.id]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          "Appointment not found or already cancelled",
          404
        );
      }

      return jsonOk(res, {
        appointment: result.rows[0],
        message: "تم إلغاء الحجز"
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "Unable to cancel appointment",
        500
      );
    }
  }
);

/* =========================================================
   DASHBOARD PATIENTS
========================================================= */

app.get(
  "/api/dashboard/patients",
  requireStaff,
  async (req, res) => {
    try {
      const search =
        String(req.query.search || "").trim();

      let result;

      if (search) {
        result = await pool.query(
          `
          SELECT *
          FROM patients
          WHERE full_name ILIKE $1
             OR phone ILIKE $1
             OR username ILIKE $1
          ORDER BY created_at DESC
          `,
          [`%${search}%`]
        );
      } else {
        result = await pool.query(
          `
          SELECT *
          FROM patients
          ORDER BY created_at DESC
          `
        );
      }

      return jsonOk(res, {
        patients:
          result.rows.map(mapPatient)
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "Unable to load patients",
        500
      );
    }
  }
);

/* =========================================================
   MEDICAL RECORDS
========================================================= */

app.get(
  "/api/dashboard/patients/:patientId/medical-records",
  requireStaff,
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
        "Unable to load medical records",
        500
      );
    }
  }
);

app.post(
  "/api/dashboard/patients/:patientId/medical-records",
  requireStaff,
  async (req, res) => {
    try {
      const patientCheck =
        await pool.query(
          `
          SELECT id
          FROM patients
          WHERE id = $1
          LIMIT 1
          `,
          [req.params.patientId]
        );

      if (patientCheck.rowCount === 0) {
        return jsonError(
          res,
          "Patient not found",
          404
        );
      }

      const record = {
        diagnosis:
          req.body.diagnosis || "",

        treatment:
          req.body.treatment || "",

        notes:
          req.body.notes || "",

        record_date:
          validDate(req.body.record_date)
            ? req.body.record_date
            : new Date()
                .toISOString()
                .slice(0, 10)
      };

      const result = await pool.query(
        `
        INSERT INTO medical_records
        (
          id,
          patient_id,
          doctor_id,
          diagnosis,
          treatment,
          notes,
          record_date
        )
        VALUES
        ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
        `,
        [
          crypto.randomUUID(),
          req.params.patientId,
          req.staff.id,
          record.diagnosis,
          record.treatment,
          record.notes,
          record.record_date
        ]
      );

      return jsonOk(
        res,
        {
          record: result.rows[0],
          message: "تم حفظ السجل الطبي"
        },
        201
      );
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "Unable to create medical record",
        500
      );
    }
  }
);

/* =========================================================
   DASHBOARD SERVICES
========================================================= */

app.get(
  "/api/dashboard/services",
  requireStaff,
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
        "Unable to load services",
        500
      );
    }
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
        "اسم الخدمة مطلوب"
      );
    }

    try {
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
          crypto.randomUUID(),
          name,
          req.body.description || "",
          Number(req.body.duration_minutes) || 30,
          req.body.price === "" ||
          req.body.price == null
            ? null
            : Number(req.body.price),
          req.body.active !== false
        ]
      );

      return jsonOk(
        res,
        {
          service:
            mapService(result.rows[0])
        },
        201
      );
    } catch (error) {
      if (error.code === "23505") {
        return jsonError(
          res,
          "الخدمة موجودة بالفعل"
        );
      }

      console.error(error);

      return jsonError(
        res,
        "Unable to create service",
        500
      );
    }
  }
);

app.patch(
  "/api/dashboard/services/:id",
  requireStaff,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        UPDATE services
        SET
          name =
            COALESCE($1, name),

          description =
            COALESCE($2, description),

          duration_minutes =
            COALESCE($3, duration_minutes),

          price =
            CASE
              WHEN $4::text IS NULL
              THEN price
              WHEN $4::text = ''
              THEN NULL
              ELSE $4::numeric
            END,

          active =
            COALESCE($5, active),

          updated_at = NOW()

        WHERE id = $6
        RETURNING *
        `,
        [
          req.body.name != null
            ? String(req.body.name).trim()
            : null,

          req.body.description != null
            ? req.body.description
            : null,

          req.body.duration_minutes != null
            ? Number(req.body.duration_minutes)
            : null,

          req.body.price != null
            ? String(req.body.price)
            : null,

          req.body.active != null
            ? Boolean(req.body.active)
            : null,

          req.params.id
        ]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          "Service not found",
          404
        );
      }

      return jsonOk(res, {
        service:
          mapService(result.rows[0])
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "Unable to update service",
        500
      );
    }
  }
);

app.delete(
  "/api/dashboard/services/:id",
  requireStaff,
  async (req, res) => {
    try {
      /*
        We deactivate services instead of deleting
        them to preserve appointment history.
      */
      const result = await pool.query(
        `
        UPDATE services
        SET
          active = FALSE,
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
        `,
        [req.params.id]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          "Service not found",
          404
        );
      }

      return jsonOk(res, {
        message: "تم إيقاف الخدمة"
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "Unable to delete service",
        500
      );
    }
  }
);

/* =========================================================
   DASHBOARD ADS
========================================================= */

app.get(
  "/api/dashboard/ads",
  requireStaff,
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
        "Unable to load ads",
        500
      );
    }
  }
);

app.post(
  "/api/dashboard/ads",
  requireStaff,
  async (req, res) => {
    const title =
      String(req.body.title || "").trim();

    if (!title) {
      return jsonError(
        res,
        "عنوان الإعلان مطلوب"
      );
    }

    try {
      const result = await pool.query(
        `
        INSERT INTO ads
        (
          id,
          title,
          description,
          image_url,
          target_url,
          business_name,
          business_type,
          phone,
          active,
          paid,
          start_date,
          end_date
        )
        VALUES
        (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12
        )
        RETURNING *
        `,
        [
          crypto.randomUUID(),
          title,
          req.body.description || "",
          req.body.image_url || "",
          req.body.target_url || "",
          req.body.business_name || "",
          req.body.business_type || "",
          req.body.phone || "",
          req.body.active !== false,
          Boolean(req.body.paid),
          validDate(req.body.start_date)
            ? req.body.start_date
            : null,
          validDate(req.body.end_date)
            ? req.body.end_date
            : null
        ]
      );

      return jsonOk(
        res,
        {
          ad: result.rows[0]
        },
        201
      );
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "Unable to create ad",
        500
      );
    }
  }
);

app.patch(
  "/api/dashboard/ads/:id",
  requireStaff,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        UPDATE ads
        SET
          title =
            COALESCE($1, title),

          description =
            COALESCE($2, description),

          image_url =
            COALESCE($3, image_url),

          target_url =
            COALESCE($4, target_url),

          business_name =
            COALESCE($5, business_name),

          business_type =
            COALESCE($6, business_type),

          phone =
            COALESCE($7, phone),

          active =
            COALESCE($8, active),

          paid =
            COALESCE($9, paid),

          start_date =
            CASE
              WHEN $10::text IS NULL
              THEN start_date
              WHEN $10::text = ''
              THEN NULL
              ELSE $10::date
            END,

          end_date =
            CASE
              WHEN $11::text IS NULL
              THEN end_date
              WHEN $11::text = ''
              THEN NULL
              ELSE $11::date
            END,

          updated_at = NOW()

        WHERE id = $12
        RETURNING *
        `,
        [
          req.body.title != null
            ? String(req.body.title).trim()
            : null,

          req.body.description != null
            ? req.body.description
            : null,

          req.body.image_url != null
            ? req.body.image_url
            : null,

          req.body.target_url != null
            ? req.body.target_url
            : null,

          req.body.business_name != null
            ? req.body.business_name
            : null,

          req.body.business_type != null
            ? req.body.business_type
            : null,

          req.body.phone != null
            ? req.body.phone
            : null,

          req.body.active != null
            ? Boolean(req.body.active)
            : null,

          req.body.paid != null
            ? Boolean(req.body.paid)
            : null,

          req.body.start_date != null
            ? String(req.body.start_date)
            : null,

          req.body.end_date != null
            ? String(req.body.end_date)
            : null,

          req.params.id
        ]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          "Ad not found",
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
        "Unable to update ad",
        500
      );
    }
  }
);

app.delete(
  "/api/dashboard/ads/:id",
  requireStaff,
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
          "Ad not found",
          404
        );
      }

      return jsonOk(res, {
        message: "تم حذف الإعلان"
      });
    } catch (error) {
      console.error(error);

      return jsonError(
        res,
        "Unable to delete ad",
        500
      );
    }
  }
);

/* =========================================================
   STATIC FRONTEND
========================================================= */

const publicPath =
  path.join(__dirname, "public");

app.use(
  express.static(publicPath)
);

app.get("*splat", (req, res) => {
  res.sendFile(
    path.join(publicPath, "index.html")
  );
});

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (err, req, res, next) => {
    console.error(
      "Unhandled server error:",
      err
    );

    if (res.headersSent) {
      return next(err);
    }

    return jsonError(
      res,
      "Internal server error",
      500
    );
  }
);

/* =========================================================
   START
========================================================= */

async function startServer() {
  try {
    await initDatabase();

    app.listen(PORT, () => {
      console.log(
        `Medical Booking server running on port ${PORT}`
      );

      console.log(
        "Database: Neon PostgreSQL"
      );

      console.log(
        "Supabase: disabled"
      );
    });
  } catch (error) {
    console.error(
      "Server startup failed:",
      error
    );

    process.exit(1);
  }
}

startServer();

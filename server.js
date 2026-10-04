```javascript
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

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static(PUBLIC_DIR));

/* =========================
   Helpers
========================= */

function makeId() {
  return crypto.randomUUID();
}

function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(value) {
  return crypto
    .createHash("sha256")
    .update(value)
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

/* =========================
   Password
========================= */

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto
      .randomBytes(16)
      .toString("hex");

    crypto.scrypt(
      password,
      salt,
      64,
      (error, derivedKey) => {
        if (error) {
          return reject(error);
        }

        resolve(
          salt +
            ":" +
            derivedKey.toString("hex")
        );
      }
    );
  });
}

function verifyPassword(password, stored) {
  return new Promise((resolve, reject) => {
    try {
      const parts = String(
        stored || ""
      ).split(":");

      if (parts.length !== 2) {
        return resolve(false);
      }

      const salt = parts[0];

      const expected = Buffer.from(
        parts[1],
        "hex"
      );

      crypto.scrypt(
        password,
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

          resolve(
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

/* =========================
   Database helpers
========================= */

async function columnExists(
  table,
  column
) {
  const result = await pool.query(
    "SELECT 1 FROM information_schema.columns " +
      "WHERE table_schema = current_schema() " +
      "AND table_name = $1 " +
      "AND column_name = $2 " +
      "LIMIT 1",
    [table, column]
  );

  return result.rowCount > 0;
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

  if (!exists) {
    await pool.query(
      "ALTER TABLE " +
        table +
        " ADD COLUMN " +
        column +
        " " +
        definition
    );
  }
}

/* =========================
   Database initialization
========================= */

async function initDatabase() {
  console.log(
    "Initializing Neon database..."
  );

  /*
    USERS
  */

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

  /*
    PATIENTS
  */

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

  /*
    STAFF USERS
  */

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

  /*
    SERVICES
  */

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

  /*
    DOCTORS
  */

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

  /*
    APPOINTMENTS
  */

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

  /*
    MEDICAL RECORDS
  */

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

  /*
    ADS
  */

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

  /*
    AD IMPRESSIONS
  */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_impressions (
      id UUID PRIMARY KEY,
      ad_id UUID REFERENCES ads(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  /*
    AD CLICKS
  */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_clicks (
      id UUID PRIMARY KEY,
      ad_id UUID REFERENCES ads(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  /*
    SESSIONS

    مهم:
    ننشئ الأعمدة هنا قبل إنشاء أي index
    عليها.
  */

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

  /*
    Compatibility columns
    للإصدارات القديمة من قاعدة البيانات
  */

  const compatibilityColumns = [
    [
      "users",
      "active",
      "BOOLEAN NOT NULL DEFAULT TRUE"
    ],
    [
      "users",
      "updated_at",
      "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    ],

    [
      "patients",
      "active",
      "BOOLEAN NOT NULL DEFAULT TRUE"
    ],
    [
      "patients",
      "updated_at",
      "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    ],

    [
      "staff_users",
      "full_name",
      "TEXT NOT NULL DEFAULT 'موظف'"
    ],
    [
      "staff_users",
      "role",
      "TEXT NOT NULL DEFAULT 'staff'"
    ],
    [
      "staff_users",
      "phone",
      "TEXT"
    ],
    [
      "staff_users",
      "email",
      "TEXT"
    ],
    [
      "staff_users",
      "active",
      "BOOLEAN NOT NULL DEFAULT TRUE"
    ],
    [
      "staff_users",
      "updated_at",
      "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    ],

    [
      "services",
      "description",
      "TEXT"
    ],
    [
      "services",
      "duration_minutes",
      "INTEGER NOT NULL DEFAULT 30"
    ],
    [
      "services",
      "price",
      "NUMERIC(12,2) NOT NULL DEFAULT 0"
    ],
    [
      "services",
      "active",
      "BOOLEAN NOT NULL DEFAULT TRUE"
    ],
    [
      "services",
      "updated_at",
      "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    ],

    [
      "appointments",
      "patient_id",
      "UUID"
    ],
    [
      "appointments",
      "doctor_id",
      "UUID"
    ],
    [
      "appointments",
      "service_id",
      "UUID"
    ],
    [
      "appointments",
      "patient_name",
      "TEXT"
    ],
    [
      "appointments",
      "patient_phone",
      "TEXT"
    ],
    [
      "appointments",
      "status",
      "TEXT NOT NULL DEFAULT 'pending'"
    ],
    [
      "appointments",
      "notes",
      "TEXT"
    ],
    [
      "appointments",
      "cancellation_reason",
      "TEXT"
    ],
    [
      "appointments",
      "updated_at",
      "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    ],

    [
      "medical_records",
      "patient_id",
      "UUID"
    ],
    [
      "medical_records",
      "doctor_id",
      "UUID"
    ],
    [
      "medical_records",
      "appointment_id",
      "UUID"
    ],
    [
      "medical_records",
      "diagnosis",
      "TEXT"
    ],
    [
      "medical_records",
      "treatment",
      "TEXT"
    ],
    [
      "medical_records",
      "prescription",
      "TEXT"
    ],
    [
      "medical_records",
      "notes",
      "TEXT"
    ],
    [
      "medical_records",
      "updated_at",
      "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    ],

    [
      "ads",
      "description",
      "TEXT"
    ],
    [
      "ads",
      "image_url",
      "TEXT"
    ],
    [
      "ads",
      "target_url",
      "TEXT"
    ],
    [
      "ads",
      "advertiser_name",
      "TEXT"
    ],
    [
      "ads",
      "category",
      "TEXT"
    ],
    [
      "ads",
      "active",
      "BOOLEAN NOT NULL DEFAULT TRUE"
    ],
    [
      "ads",
      "starts_at",
      "TIMESTAMPTZ"
    ],
    [
      "ads",
      "ends_at",
      "TIMESTAMPTZ"
    ],
    [
      "ads",
      "updated_at",
      "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    ],

    [
      "sessions",
      "access_token_hash",
      "TEXT"
    ],
    [
      "sessions",
      "refresh_token_hash",
      "TEXT"
    ],
    [
      "sessions",
      "user_id",
      "UUID"
    ],
    [
      "sessions",
      "staff_user_id",
      "UUID"
    ],
    [
      "sessions",
      "expires_at",
      "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    ],
    [
      "sessions",
      "created_at",
      "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    ]
  ];

  for (const item of compatibilityColumns) {
    await addColumnIfMissing(
      item[0],
      item[1],
      item[2]
    );
  }

  /*
    Indexes
  */

  await pool.query(
    "CREATE INDEX IF NOT EXISTS " +
      "idx_sessions_access_token_hash " +
      "ON sessions(access_token_hash)"
  );

  await pool.query(
    "CREATE INDEX IF NOT EXISTS " +
      "idx_sessions_refresh_token_hash " +
      "ON sessions(refresh_token_hash)"
  );

  await pool.query(
    "CREATE INDEX IF NOT EXISTS " +
      "idx_appointments_date " +
      "ON appointments(appointment_date)"
  );

  await pool.query(
    "CREATE INDEX IF NOT EXISTS " +
      "idx_appointments_patient " +
      "ON appointments(patient_id)"
  );

  await pool.query(
    "CREATE INDEX IF NOT EXISTS " +
      "idx_appointments_doctor " +
      "ON appointments(doctor_id)"
  );

  /*
    Default services
  */

  const serviceCount =
    await pool.query(
      "SELECT COUNT(*)::int AS count FROM services"
    );

  if (
    serviceCount.rows[0].count === 0
  ) {
    const services = [
      [
        "كشف عام",
        "استشارة وفحص طبي عام"
      ],
      [
        "متابعة الحمل",
        "متابعة دورية للحمل"
      ],
      [
        "سونار",
        "فحص بالموجات فوق الصوتية"
      ],
      [
        "كشف نساء",
        "استشارات وفحوصات النساء"
      ],
      [
        "طب الأطفال",
        "فحص واستشارة للأطفال"
      ],
      [
        "طب القلب",
        "استشارة وفحص القلب"
      ]
    ];

    for (const service of services) {
      await pool.query(
        "INSERT INTO services " +
          "(id,name,description,duration_minutes,price,active) " +
          "VALUES ($1,$2,$3,30,0,TRUE) " +
          "ON CONFLICT (name) DO NOTHING",
        [
          makeId(),
          service[0],
          service[1]
        ]
      );
    }
  }

  /*
    Admin account
  */

  const adminUsername =
    normalizeUsername(
      process.env.ADMIN_USERNAME ||
        "admin"
    );

  const adminPassword =
    process.env.ADMIN_PASSWORD ||
    "admin123";

  const adminName =
    process.env.ADMIN_NAME ||
    "مدير منصة موعدي";

  const adminResult =
    await pool.query(
      "SELECT id FROM staff_users " +
        "WHERE username = $1 " +
        "LIMIT 1",
      [adminUsername]
    );

  const adminPasswordHash =
    await hashPassword(
      adminPassword
    );

  if (adminResult.rowCount === 0) {
    await pool.query(
      "INSERT INTO staff_users " +
        "(id,username,password_hash,full_name,role,active) " +
        "VALUES ($1,$2,$3,$4,$5,TRUE)",
      [
        makeId(),
        adminUsername,
        adminPasswordHash,
        adminName,
        "admin"
      ]
    );
  } else {
    await pool.query(
      "UPDATE staff_users " +
        "SET password_hash=$1, " +
        "full_name=$2, " +
        "role=$3, " +
        "active=TRUE, " +
        "updated_at=NOW() " +
        "WHERE username=$4",
      [
        adminPasswordHash,
        adminName,
        "admin",
        adminUsername
      ]
    );
  }

  console.log(
    "Database initialization completed."
  );
}

/* =========================
   Sessions
========================= */

async function createSession({
  userId = null,
  staffUserId = null
}) {
  const accessToken =
    randomToken();

  const refreshToken =
    randomToken();

  const expiresAt = new Date(
    Date.now() +
      30 *
        24 *
        60 *
        60 *
        1000
  );

  await pool.query(
    "INSERT INTO sessions " +
      "(id,access_token_hash,refresh_token_hash,user_id,staff_user_id,expires_at) " +
      "VALUES ($1,$2,$3,$4,$5,$6)",
    [
      makeId(),
      hashToken(accessToken),
      hashToken(refreshToken),
      userId,
      staffUserId,
      expiresAt
    ]
  );

  return {
    token: accessToken,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at:
      expiresAt.toISOString()
  };
}

async function getAuth(req) {
  const authorization =
    req.get("authorization") || "";

  if (
    !authorization.startsWith(
      "Bearer "
    )
  ) {
    return null;
  }

  const rawToken =
    authorization
      .slice(7)
      .trim();

  if (!rawToken) {
    return null;
  }

  const result =
    await pool.query(
      `
      SELECT
        s.id AS session_id,
        s.user_id,
        s.staff_user_id,
        s.expires_at,

        u.username AS user_username,
        u.full_name AS user_full_name,
        u.role AS user_role,
        u.phone AS user_phone,
        u.email AS user_email,

        st.username AS staff_username,
        st.full_name AS staff_full_name,
        st.role AS staff_role,
        st.phone AS staff_phone,
        st.email AS staff_email

      FROM sessions s

      LEFT JOIN users u
        ON u.id = s.user_id

      LEFT JOIN staff_users st
        ON st.id = s.staff_user_id

      WHERE
        s.access_token_hash = $1
        AND s.expires_at > NOW()

      LIMIT 1
      `,
      [hashToken(rawToken)]
    );

  if (!result.rowCount) {
    return null;
  }

  const row = result.rows[0];

  if (row.staff_user_id) {
    return {
      type: "staff",
      sessionId: row.session_id,
      id: row.staff_user_id,
      username: row.staff_username,
      full_name:
        row.staff_full_name,
      role: row.staff_role,
      phone: row.staff_phone,
      email: row.staff_email
    };
  }

  return {
    type: "user",
    sessionId: row.session_id,
    id: row.user_id,
    username: row.user_username,
    full_name:
      row.user_full_name,
    role: row.user_role,
    phone: row.user_phone,
    email: row.user_email
  };
}

/* =========================
   Auth middleware
========================= */

async function requireAuth(
  req,
  res,
  next
) {
  try {
    const auth =
      await getAuth(req);

    if (!auth) {
      return jsonError(
        res,
        401,
        "يرجى تسجيل الدخول أولاً."
      );
    }

    req.auth = auth;
    next();
  } catch (error) {
    next(error);
  }
}

async function requireStaff(
  req,
  res,
  next
) {
  try {
    const auth =
      await getAuth(req);

    if (
      !auth ||
      auth.type !== "staff"
    ) {
      return jsonError(
        res,
        401,
        "يجب تسجيل الدخول بحساب الإدارة."
      );
    }

    req.auth = auth;
    next();
  } catch (error) {
    next(error);
  }
}

async function requireAdmin(
  req,
  res,
  next
) {
  try {
    const auth =
      await getAuth(req);

    if (
      !auth ||
      auth.type !== "staff" ||
      auth.role !== "admin"
    ) {
      return jsonError(
        res,
        403,
        "صلاحية المدير مطلوبة."
      );
    }

    req.auth = auth;
    next();
  } catch (error) {
    next(error);
  }
}

/* =========================
   Health
========================= */

app.get(
  "/api/health",
  async (req, res, next) => {
    try {
      await pool.query(
        "SELECT 1"
      );

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
      next(error);
    }
  }
);

app.get(
  "/api/config",
  (req, res) => {
    return jsonOk(res, {
      app: "medical-booking",
      name: "منصة موعدي"
    });
  }
);

/* =========================
   Patient registration
========================= */

app.post(
  "/api/register",
  async (req, res, next) => {
    try {
      const userName =
        normalizeUsername(
          req.body.username
        );

      const password = String(
        req.body.password || ""
      );

      const fullName =
        clean(req.body.full_name);

      const phone =
        clean(req.body.phone) ||
        null;

      const email =
        clean(req.body.email) ||
        null;

      if (
        !userName ||
        !fullName ||
        password.length < 6
      ) {
        return jsonError(
          res,
          400,
          "أدخل اسم المستخدم والاسم الكامل وكلمة مرور لا تقل عن 6 أحرف."
        );
      }

      const exists =
        await pool.query(
          "SELECT id FROM users " +
            "WHERE username=$1 " +
            "LIMIT 1",
          [userName]
        );

      if (exists.rowCount) {
        return jsonError(
          res,
          409,
          "اسم المستخدم مستخدم بالفعل."
        );
      }

      const userId =
        makeId();

      const passwordHash =
        await hashPassword(
          password
        );

      await pool.query(
        "INSERT INTO users " +
          "(id,username,password_hash,full_name,phone,email,role) " +
          "VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [
          userId,
          userName,
          passwordHash,
          fullName,
          phone,
          email,
          "patient"
        ]
      );

      await pool.query(
        "INSERT INTO patients " +
          "(id,user_id,full_name,phone,email) " +
          "VALUES ($1,$2,$3,$4,$5)",
        [
          makeId(),
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
        ...session,
        user: {
          id: userId,
          username: userName,
          full_name: fullName,
          phone,
          email,
          role: "patient"
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

/* =========================
   Patient login
========================= */

app.post(
  "/api/login",
  async (req, res, next) => {
    try {
      const userName =
        normalizeUsername(
          req.body.username
        );

      const password = String(
        req.body.password || ""
      );

      const result =
        await pool.query(
          "SELECT * FROM users " +
            "WHERE username=$1 " +
            "AND active=TRUE " +
            "LIMIT 1",
          [userName]
        );

      if (
        !result.rowCount ||
        !(await verifyPassword(
          password,
          result.rows[0]
            .password_hash
        ))
      ) {
        return jsonError(
          res,
          401,
          "اسم المستخدم أو كلمة المرور غير صحيحة."
        );
      }

      const user =
        result.rows[0];

      const session =
        await createSession({
          userId: user.id
        });

      return jsonOk(res, {
        ...session,
        user: {
          id: user.id,
          username:
            user.username,
          full_name:
            user.full_name,
          phone: user.phone,
          email: user.email,
          role: user.role
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

app.get(
  "/api/me",
  requireAuth,
  (req, res) => {
    return jsonOk(res, {
      user: req.auth
    });
  }
);

/* =========================
   Staff login
========================= */

app.post(
  "/api/staff/login",
  async (req, res, next) => {
    try {
      const userName =
        normalizeUsername(
          req.body.username
        );

      const password = String(
        req.body.password || ""
      );

      const result =
        await pool.query(
          "SELECT * FROM staff_users " +
            "WHERE username=$1 " +
            "AND active=TRUE " +
            "LIMIT 1",
          [userName]
        );

      if (
        !result.rowCount ||
        !(await verifyPassword(
          password,
          result.rows[0]
            .password_hash
        ))
      ) {
        return jsonError(
          res,
          401,
          "بيانات الدخول غير صحيحة."
        );
      }

      const staff =
        result.rows[0];

      const session =
        await createSession({
          staffUserId:
            staff.id
        });

      return jsonOk(res, {
        ...session,
        user: {
          id: staff.id,
          username:
            staff.username,
          full_name:
            staff.full_name,
          phone: staff.phone,
          email: staff.email,
          role: staff.role
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

app.get(
  "/api/staff/me",
  requireStaff,
  (req, res) => {
    return jsonOk(res, {
      user: req.auth
    });
  }
);

app.post(
  "/api/logout",
  requireAuth,
  async (req, res, next) => {
    try {
      await pool.query(
        "DELETE FROM sessions " +
          "WHERE id=$1",
        [req.auth.sessionId]
      );

      return jsonOk(res);
    } catch (error) {
      next(error);
    }
  }
);

/* =========================
   Services
========================= */

app.get(
  "/api/services",
  async (req, res, next) => {
    try {
      const result =
        await pool.query(
          "SELECT * FROM services " +
            "WHERE active=TRUE " +
            "ORDER BY name"
        );

      return jsonOk(res, {
        services:
          result.rows
      });
    } catch (error) {
      next(error);
    }
  }
);

/* =========================
   Doctors
========================= */

app.get(
  "/api/doctors",
  async (req, res, next) => {
    try {
      const q =
        clean(req.query.q) || "";

      const specialty =
        clean(
          req.query.specialty
        ) || "";

      const area =
        clean(req.query.area) ||
        "";

      const result =
        await pool.query(
          `
          SELECT *
          FROM doctors
          WHERE active=TRUE
            AND (
              $1=''
              OR full_name ILIKE '%' || $1 || '%'
              OR specialty ILIKE '%' || $1 || '%'
            )
            AND (
              $2=''
              OR specialty ILIKE '%' || $2 || '%'
            )
            AND (
              $3=''
              OR COALESCE(area,'') ILIKE '%' || $3 || '%'
            )
          ORDER BY full_name
          `,
          [
            q,
            specialty,
            area
          ]
        );

      return jsonOk(res, {
        doctors:
          result.rows
      });
    } catch (error) {
      next(error);
    }
  }
);

/* =========================
   Public ads
========================= */

app.get(
  "/api/ads",
  async (req, res, next) => {
    try {
      const result =
        await pool.query(`
          SELECT *
          FROM ads
          WHERE active=TRUE
            AND (
              starts_at IS NULL
              OR starts_at <= NOW()
            )
            AND (
              ends_at IS NULL
              OR ends_at >= NOW()
            )
          ORDER BY created_at DESC
        `);

      return jsonOk(res, {
        ads: result.rows
      });
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/api/ads/:id/impression",
  async (req, res, next) => {
    try {
      await pool.query(
        "INSERT INTO ad_impressions " +
          "(id,ad_id) " +
          "VALUES ($1,$2)",
        [
          makeId(),
          req.params.id
        ]
      );

      return jsonOk(res);
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/api/ads/:id/click",
  async (req, res, next) => {
    try {
      await pool.query(
        "INSERT INTO ad_clicks " +
          "(id,ad_id) " +
          "VALUES ($1,$2)",
        [
          makeId(),
          req.params.id
        ]
      );

      return jsonOk(res);
    } catch (error) {
      next(error);
    }
  }
);

/* =========================
   Booking
========================= */

app.post(
  "/api/appointments",
  requireAuth,
  async (req, res, next) => {
    try {
      if (
        req.auth.type !== "user"
      ) {
        return jsonError(
          res,
          403,
          "الحجز متاح لحسابات المرضى."
        );
      }

      const serviceId =
        clean(req.body.service_id);

      const doctorId =
        clean(req.body.doctor_id) ||
        null;

      const appointmentDate =
        clean(
          req.body.appointment_date
        );

      const appointmentTime =
        clean(
          req.body.appointment_time
        );

      const notes =
        clean(req.body.notes) ||
        null;

      if (
        !serviceId ||
        !validDate(
          appointmentDate
        ) ||
        !validTime(
          appointmentTime
        )
      ) {
        return jsonError(
          res,
          400,
          "بيانات الموعد غير مكتملة."
        );
      }

      const patientResult =
        await pool.query(
          "SELECT * FROM patients " +
            "WHERE user_id=$1 " +
            "LIMIT 1",
          [req.auth.id]
        );

      if (
        !patientResult.rowCount
      ) {
        return jsonError(
          res,
          400,
          "ملف المريض غير موجود."
        );
      }

      if (doctorId) {
        const doctorResult =
          await pool.query(
            "SELECT id FROM doctors " +
              "WHERE id=$1 " +
              "AND active=TRUE",
            [doctorId]
          );

        if (
          !doctorResult.rowCount
        ) {
          return jsonError(
            res,
            400,
            "الطبيب غير متاح."
          );
        }
      }

      const conflict =
        await pool.query(
          `
          SELECT id
          FROM appointments
          WHERE appointment_date=$1
            AND appointment_time=$2
            AND status NOT IN (
              'cancelled',
              'rejected'
            )
            AND (
              doctor_id=$3
              OR (
                $3 IS NULL
                AND doctor_id IS NULL
              )
            )
          LIMIT 1
          `,
          [
            appointmentDate,
            appointmentTime,
            doctorId
          ]
        );

      if (conflict.rowCount) {
        return jsonError(
          res,
          409,
          "هذا الموعد غير متاح حالياً."
        );
      }

      const patient =
        patientResult.rows[0];

      const appointmentResult =
        await pool.query(
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
            $1,$2,$3,$4,$5,
            $6,$7,$8,'pending',$9
          )
          RETURNING *
          `,
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
        appointment:
          appointmentResult
            .rows[0]
      });
    } catch (error) {
      next(error);
    }
  }
);

/* =========================
   My appointments
========================= */

app.get(
  "/api/my-appointments",
  requireAuth,
  async (req, res, next) => {
    try {
      if (
        req.auth.type !== "user"
      ) {
        return jsonError(
          res,
          403,
          "غير مسموح."
        );
      }

      const result =
        await pool.query(
          `
          SELECT
            a.*,
            s.name AS service_name,
            d.full_name AS doctor_name,
            d.specialty AS doctor_specialty

          FROM appointments a

          LEFT JOIN services s
            ON s.id=a.service_id

          LEFT JOIN doctors d
            ON d.id=a.doctor_id

          JOIN patients p
            ON p.id=a.patient_id

          WHERE p.user_id=$1

          ORDER BY
            a.appointment_date DESC,
            a.appointment_time DESC
          `,
          [req.auth.id]
        );

      return jsonOk(res, {
        appointments:
          result.rows
      });
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/api/my-appointments/:id/cancel",
  requireAuth,
  async (req, res, next) => {
    try {
      const reason =
        clean(req.body.reason) ||
        "إلغاء بواسطة المريض";

      const result =
        await pool.query(
          `
          UPDATE appointments a
          SET
            status='cancelled',
            cancellation_reason=$1,
            updated_at=NOW()

          FROM patients p

          WHERE
            a.id=$2
            AND a.patient_id=p.id
            AND p.user_id=$3

          RETURNING a.*
          `,
          [
            reason,
            req.params.id,
            req.auth.id
          ]
        );

      if (!result.rowCount) {
        return jsonError(
          res,
          404,
          "الموعد غير موجود."
        );
      }

      return jsonOk(res, {
        appointment:
          result.rows[0]
      });
    } catch (error) {
      next(error);
    }
  }
);

/* =========================
   Dashboard stats
========================= */

app.get(
  "/api/dashboard/stats",
  requireStaff,
  async (req, res, next) => {
    try {
      const [
        appointments,
        patients,
        doctors,
        services
      ] = await Promise.all([
        pool.query(
          "SELECT COUNT(*)::int AS count " +
            "FROM appointments"
        ),

        pool.query(
          "SELECT COUNT(*)::int AS count " +
            "FROM patients"
        ),

        pool.query(
          "SELECT COUNT(*)::int AS count " +
            "FROM doctors " +
            "WHERE active=TRUE"
        ),

        pool.query(
          "SELECT COUNT(*)::int AS count " +
            "FROM services " +
            "WHERE active=TRUE"
        )
      ]);

      return jsonOk(res, {
        stats: {
          appointments:
            appointments.rows[0]
              .count,

          patients:
            patients.rows[0]
              .count,

          doctors:
            doctors.rows[0]
              .count,

          services:
            services.rows[0]
              .count
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

/* =========================
   Dashboard appointments
========================= */

app.get(
  "/api/dashboard/appointments",
  requireStaff,
  async (req, res, next) => {
    try {
      const result =
        await pool.query(
          `
          SELECT
            a.*,
            p.full_name AS patient_full_name,
            p.phone AS patient_phone,
            s.name AS service_name,
            d.full_name AS doctor_name

          FROM appointments a

          LEFT JOIN patients p
            ON p.id=a.patient_id

          LEFT JOIN services s
            ON s.id=a.service_id

          LEFT JOIN doctors d
            ON d.id=a.doctor_id

          ORDER BY
            a.appointment_date DESC,
            a.appointment_time DESC
          `
        );

      return jsonOk(res, {
        appointments:
          result.rows
      });
    } catch (error) {
      next(error);
    }
  }
);

app.patch(
  "/api/dashboard/appointments/:id",
  requireStaff,
  async (req, res, next) => {
    try {
      const status =
        clean(req.body.status);

      const doctorId =
        clean(req.body.doctor_id) ||
        null;

      const notes =
        clean(req.body.notes);

      if (!status) {
        return jsonError(
          res,
          400,
          "الحالة مطلوبة."
        );
      }

      const result =
        await pool.query(
          `
          UPDATE appointments

          SET
            status=$1,
            doctor_id=
              COALESCE(
                $2,
                doctor_id
              ),
            notes=
              COALESCE(
                $3,
                notes
              ),
            updated_at=NOW()

          WHERE id=$4

          RETURNING *
          `,
          [
            status,
            doctorId,
            notes || null,
            req.params.id
          ]
        );

      if (!result.rowCount) {
        return jsonError(
          res,
          404,
          "الموعد غير موجود."
        );
      }

      return jsonOk(res, {
        appointment:
          result.rows[0]
      });
    } catch (error) {
      next(error);
    }
  }
);

/* =========================
   Dashboard patients
========================= */

app.get(
  "/api/dashboard/patients",
  requireStaff,
  async (req, res, next) => {
    try {
      const result =
        await pool.query(
          "SELECT * FROM patients " +
            "ORDER BY created_at DESC"
        );

      return jsonOk(res, {
        patients:
          result.rows
      });
    } catch (error) {
      next(error);
    }
  }
);

/* =========================
   Medical records
========================= */

app.get(
  "/api/dashboard/medical-records",
  requireStaff,
  async (req, res, next) => {
    try {
      const result =
        await pool.query(
          `
          SELECT
            m.*,
            p.full_name AS patient_name,
            d.full_name AS doctor_name

          FROM medical_records m

          LEFT JOIN patients p
            ON p.id=m.patient_id

          LEFT JOIN doctors d
            ON d.id=m.doctor_id

          ORDER BY
            m.created_at DESC
          `
        );

      return jsonOk(res, {
        records:
          result.rows
      });
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/api/dashboard/medical-records",
  requireStaff,
  async (req, res, next) => {
    try {
      const result =
        await pool.query(
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
            $1,$2,$3,$4,
            $5,$6,$7,$8
          )
          RETURNING *
          `,
          [
            makeId(),
            req.body.patient_id ||
              null,

            req.body.doctor_id ||
              null,

            req.body.appointment_id ||
              null,

            clean(
              req.body.diagnosis
            ) || null,

            clean(
              req.body.treatment
            ) || null,

            clean(
              req.body.prescription
            ) || null,

            clean(
              req.body.notes
            ) || null
          ]
        );

      return jsonOk(res, {
        record:
          result.rows[0]
      });
    } catch (error) {
      next(error);
    }
  }
);

/* =========================
   Dashboard doctors
========================= */

app.get(
  "/api/dashboard/doctors",
  requireStaff,
  async (req, res, next) => {
    try {
      const result =
        await pool.query(
          "SELECT * FROM doctors " +
            "ORDER BY created_at DESC"
        );

      return jsonOk(res, {
        doctors:
          result.rows
      });
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/api/dashboard/doctors",
  requireStaff,
  async (req, res, next) => {
    try {
      const result =
        await pool.query(
          `
          INSERT INTO doctors
          (
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
          )
          VALUES
          (
            $1,$2,$3,$4,$5,
            $6,$7,$8,$9,TRUE
          )
          RETURNING *
          `,
          [
            makeId(),

            clean(
              req.body.full_name
            ),

            clean(
              req.body.specialty
            ),

            clean(
              req.body.area
            ) || null,

            clean(
              req.body.phone
            ) || null,

            clean(
              req.body.email
            ) || null,

            clean(
              req.body.bio
            ) || null,

            clean(
              req.body.image_url
            ) || null,

            Number(
              req.body.rating || 5
            )
          ]
        );

      return jsonOk(res, {
        doctor:
          result.rows[0]
      });
    } catch (error) {
      next(error);
    }
  }
);

app.patch(
  "/api/dashboard/doctors/:id",
  requireStaff,
  async (req, res, next) => {
    try {
      const result =
        await pool.query(
          `
          UPDATE doctors

          SET
            full_name=
              COALESCE(
                $1,
                full_name
              ),

            specialty=
              COALESCE(
                $2,
                specialty
              ),

            area=
              COALESCE(
                $3,
                area
              ),

            phone=
              COALESCE(
                $4,
                phone
              ),

            email=
              COALESCE(
                $5,
                email
              ),

            bio=
              COALESCE(
                $6,
                bio
              ),

            image_url=
              COALESCE(
                $7,
                image_url
              ),

            rating=
              COALESCE(
                $8,
                rating
              ),

            active=
              COALESCE(
                $9,
                active
              ),

            updated_at=NOW()

          WHERE id=$10

          RETURNING *
          `,
          [
            clean(
              req.body.full_name
            ) || null,

            clean(
              req.body.specialty
            ) || null,

            clean(
              req.body.area
            ) || null,

            clean(
              req.body.phone
            ) || null,

            clean(
              req.body.email
            ) || null,

            clean(
              req.body.bio
            ) || null,

            clean(
              req.body.image_url
            ) || null,

            req.body.rating ===
            undefined
              ? null
              : Number(
                  req.body.rating
                ),

            req.body.active ===
            undefined
              ? null
              : Boolean(
                  req.body.active
                ),

            req.params.id
          ]
        );

      if (!result.rowCount) {
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
      next(error);
    }
  }
);

app.delete(
  "/api/dashboard/doctors/:id",
  requireAdmin,
  async (req, res, next) => {
    try {
      const result =
        await pool.query(
          "UPDATE doctors " +
            "SET active=FALSE, " +
            "updated_at=NOW() " +
            "WHERE id=$1 " +
            "RETURNING id",
          [req.params.id]
        );

      if (!result.rowCount) {
        return jsonError(
          res,
          404,
          "الطبيب غير موجود."
        );
      }

      return jsonOk(res);
    } catch (error) {
      next(error);
    }
  }
);

/* =========================
   Dashboard services
========================= */

app.get(
  "/api/dashboard/services",
  requireStaff,
  async (req, res, next) => {
    try {
      const result =
        await pool.query(
          "SELECT * FROM services " +
            "ORDER BY name"
        );

      return jsonOk(res, {
        services:
          result.rows
      });
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/api/dashboard/services",
  requireStaff,
  async (req, res, next) => {
    try {
      const result =
        await pool.query(
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
          (
            $1,$2,$3,$4,$5,$6
          )
          RETURNING *
          `,
          [
            makeId(),

            clean(
              req.body.name
            ),

            clean(
              req.body.description
            ) || null,

            Number(
              req.body.duration_minutes ||
                30
            ),

            Number(
              req.body.price || 0
            ),

            req.body.active ===
            undefined
              ? true
              : Boolean(
                  req.body.active
                )
          ]
        );

      return jsonOk(res, {
        service:
          result.rows[0]
      });
    } catch (error) {
      next(error);
    }
  }
);

app.patch(
  "/api/dashboard/services/:id",
  requireStaff,
  async (req, res, next) => {
    try {
      const result =
        await pool.query(
          `
          UPDATE services

          SET
            name=
              COALESCE(
                $1,
                name
              ),

            description=
              COALESCE(
                $2,
                description
              ),

            duration_minutes=
              COALESCE(
                $3,
                duration_minutes
              ),

            price=
              COALESCE(
                $4,
                price
              ),

            active=
              COALESCE(
                $5,
                active
              ),

            updated_at=NOW()

          WHERE id=$6

          RETURNING *
          `,
          [
            clean(
              req.body.name
            ) || null,

            clean(
              req.body.description
            ) || null,

            req.body.duration_minutes ===
            undefined
              ? null
              : Number(
                  req.body
                    .duration_minutes
                ),

            req.body.price ===
            undefined
              ? null
              : Number(
                  req.body.price
                ),

            req.body.active ===
            undefined
              ? null
              : Boolean(
                  req.body.active
                ),

            req.params.id
          ]
        );

      if (!result.rowCount) {
        return jsonError(
          res,
          404,
          "الخدمة غير موجودة."
        );
      }

      return jsonOk(res, {
        service:
          result.rows[0]
      });
    } catch (error) {
      next(error);
    }
  }
);

app.delete(
  "/api/dashboard/services/:id",
  requireAdmin,
  async (req, res, next) => {
    try {
      const result =
        await pool.query(
          "UPDATE services " +
            "SET active=FALSE, " +
            "updated_at=NOW() " +
            "WHERE id=$1 " +
            "RETURNING id",
          [req.params.id]
        );

      if (!result.rowCount) {
        return jsonError(
          res,
          404,
          "الخدمة غير موجودة."
        );
      }

      return jsonOk(res);
    } catch (error) {
      next(error);
    }
  }
);

/* =========================
   Dashboard ads
========================= */

app.get(
  "/api/dashboard/ads",
  requireStaff,
  async (req, res, next) => {
    try {
      const result =
        await pool.query(
          "SELECT * FROM ads " +
            "ORDER BY created_at DESC"
        );

      return jsonOk(res, {
        ads: result.rows
      });
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/api/dashboard/ads",
  requireStaff,
  async (req, res, next) => {
    try {
      const result =
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
            category,
            active,
            starts_at,
            ends_at
          )
          VALUES
          (
            $1,$2,$3,$4,$5,
            $6,$7,$8,$9,$10
          )
          RETURNING *
          `,
          [
            makeId(),

            clean(
              req.body.title
            ),

            clean(
              req.body.description
            ) || null,

            clean(
              req.body.image_url
            ) || null,

            clean(
              req.body.target_url
            ) || null,

            clean(
              req.body.advertiser_name
            ) || null,

            clean(
              req.body.category
            ) || null,

            req.body.active ===
            undefined
              ? true
              : Boolean(
                  req.body.active
                ),

            req.body.starts_at ||
              null,

            req.body.ends_at ||
              null
          ]
        );

      return jsonOk(res, {
        ad: result.rows[0]
      });
    } catch (error) {
      next(error);
    }
  }
);

app.patch(
  "/api/dashboard/ads/:id",
  requireStaff,
  async (req, res, next) => {
    try {
      const result =
        await pool.query(
          `
          UPDATE ads

          SET
            title=
              COALESCE(
                $1,
                title
              ),

            description=
              COALESCE(
                $2,
                description
              ),

            image_url=
              COALESCE(
                $3,
                image_url
              ),

            target_url=
              COALESCE(
                $4,
                target_url
              ),

            advertiser_name=
              COALESCE(
                $5,
                advertiser_name
              ),

            category=
              COALESCE(
                $6,
                category
              ),

            active=
              COALESCE(
                $7,
                active
              ),

            starts_at=
              COALESCE(
                $8,
                starts_at
              ),

            ends_at=
              COALESCE(
                $9,
                ends_at
              ),

            updated_at=NOW()

          WHERE id=$10

          RETURNING *
          `,
          [
            clean(
              req.body.title
            ) || null,

            clean(
              req.body.description
            ) || null,

            clean(
              req.body.image_url
            ) || null,

            clean(
              req.body.target_url
            ) || null,

            clean(
              req.body.advertiser_name
            ) || null,

            clean(
              req.body.category
            ) || null,

            req.body.active ===
            undefined
              ? null
              : Boolean(
                  req.body.active
                ),

            req.body.starts_at ||
              null,

            req.body.ends_at ||
              null,

            req.params.id
          ]
        );

      if (!result.rowCount) {
        return jsonError(
          res,
          404,
          "الإعلان غير موجود."
        );
      }

      return jsonOk(res, {
        ad: result.rows[0]
      });
    } catch (error) {
      next(error);
    }
  }
);

app.delete(
  "/api/dashboard/ads/:id",
  requireAdmin,
  async (req, res, next) => {
    try {
      const result =
        await pool.query(
          "DELETE FROM ads " +
            "WHERE id=$1 " +
            "RETURNING id",
          [req.params.id]
        );

      if (!result.rowCount) {
        return jsonError(
          res,
          404,
          "الإعلان غير موجود."
        );
      }

      return jsonOk(res);
    } catch (error) {
      next(error);
    }
  }
);

/* =========================
   Dashboard
========================= */

app.get(
  "/api/dashboard",
  requireStaff,
  (req, res) => {
    return jsonOk(res, {
      user: req.auth
    });
  }
);

/* =========================
   API 404
========================= */

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

/* =========================
   Frontend fallback
   Express 5 compatible
========================= */

app.use(
  (req, res, next) => {
    if (req.method !== "GET") {
      return next();
    }

    if (
      req.path.startsWith("/api")
    ) {
      return next();
    }

    return res.sendFile(
      path.join(
        PUBLIC_DIR,
        "index.html"
      )
    );
  }
);

/* =========================
   Error handler
========================= */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "Server error:",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    return res.status(500).json({
      ok: false,
      error:
        "حدث خطأ داخلي في الخادم."
    });
  }
);

/* =========================
   Start
========================= */

async function startServer() {
  try {
    await initDatabase();

    app.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          "Medical Booking running on port " +
            PORT
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
```

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const {
  Pool
} = require("pg");

const app = express();

const PORT = process.env.PORT || 10000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is missing.");
  process.exit(1);
}

/* =========================================================
   DATABASE
========================================================= */

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
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

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/* =========================================================
   HELPERS
========================================================= */

function jsonError(
  res,
  message,
  status = 400
) {
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

function makeId() {
  return crypto.randomUUID();
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

function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .toLowerCase();
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

/* =========================================================
   PASSWORD
========================================================= */

function hashPassword(password) {
  const salt = crypto.randomBytes(16);

  const hash = crypto.scryptSync(
    String(password),
    salt,
    64
  );

  return {
    salt: salt.toString("hex"),
    hash: hash.toString("hex")
  };
}

function verifyPassword(
  password,
  saltHex,
  hashHex
) {
  try {
    if (!password || !saltHex || !hashHex) {
      return false;
    }

    const salt = Buffer.from(
      saltHex,
      "hex"
    );

    const expected = Buffer.from(
      hashHex,
      "hex"
    );

    const actual = crypto.scryptSync(
      String(password),
      salt,
      expected.length
    );

    return crypto.timingSafeEqual(
      actual,
      expected
    );
  } catch {
    return false;
  }
}

/* =========================================================
   MAPPERS
========================================================= */

function mapPatient(row) {
  if (!row) return null;

  return {
    id: row.id,
    auth_user_id: row.auth_user_id || null,
    username: row.username || "",
    full_name: row.full_name || "",
    phone: row.phone || "",
    email: row.email || "",
    date_of_birth:
      row.date_of_birth || null,
    gender: row.gender || "",
    address: row.address || "",
    created_at: row.created_at || null
  };
}

function mapService(row) {
  if (!row) return null;

  return {
    id: row.id,
    name: row.name || "",
    description: row.description || "",
    duration_minutes:
      row.duration_minutes || 30,
    price:
      row.price !== null &&
      row.price !== undefined
        ? Number(row.price)
        : 0,
    active:
      row.active !== false,
    image_url:
      row.image_url || ""
  };
}

function mapDoctor(row) {
  if (!row) return null;

  return {
    id: row.id,
    auth_user_id:
      row.auth_user_id || null,
    username:
      row.username || "",
    full_name:
      row.full_name || "",
    phone:
      row.phone || "",
    email:
      row.email || "",
    specialty:
      row.specialty || "",
    area:
      row.area || "",
    image_url:
      row.image_url || "",
    bio:
      row.bio || "",
    active:
      row.active !== false,
    available:
      row.available !== false,
    role:
      row.role || "doctor",
    created_at:
      row.created_at || null
  };
}

function mapAppointment(row) {
  if (!row) return null;

  return {
    id: row.id,
    patient_id:
      row.patient_id || null,
    doctor_id:
      row.doctor_id || null,
    service_id:
      row.service_id || null,

    patient_name:
      row.patient_name || "",

    patient_phone:
      row.patient_phone || "",

    doctor_name:
      row.doctor_name || "",

    service_name:
      row.service_name || "",

    appointment_date:
      row.appointment_date || null,

    appointment_time:
      row.appointment_time || null,

    status:
      row.status || "pending",

    notes:
      row.notes || "",

    created_at:
      row.created_at || null,

    updated_at:
      row.updated_at || null
  };
}

/* =========================================================
   DATABASE INITIALIZATION
========================================================= */

async function initDatabase() {
  console.log("Initializing Neon database...");

  /*
   * USERS
   */

  await pool.query(`
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

  /*
   * PATIENTS
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS patients (
      id UUID PRIMARY KEY,
      auth_user_id UUID UNIQUE,
      username TEXT,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      date_of_birth DATE,
      gender TEXT,
      address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  /*
   * STAFF
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_users (
      id UUID PRIMARY KEY,
      auth_user_id UUID UNIQUE,
      username TEXT,
      full_name TEXT NOT NULL,
      phone TEXT,
      specialty TEXT,
      area TEXT,
      image_url TEXT,
      bio TEXT,
      role TEXT NOT NULL DEFAULT 'doctor',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      available BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  /*
   * IMPORTANT:
   * Existing installations may have an old staff_users
   * table without updated_at or other newer columns.
   */

  const staffColumns = [
    [
      "auth_user_id",
      "UUID"
    ],
    [
      "username",
      "TEXT"
    ],
    [
      "full_name",
      "TEXT"
    ],
    [
      "phone",
      "TEXT"
    ],
    [
      "specialty",
      "TEXT"
    ],
    [
      "area",
      "TEXT"
    ],
    [
      "image_url",
      "TEXT"
    ],
    [
      "bio",
      "TEXT"
    ],
    [
      "role",
      "TEXT DEFAULT 'doctor'"
    ],
    [
      "active",
      "BOOLEAN DEFAULT TRUE"
    ],
    [
      "available",
      "BOOLEAN DEFAULT TRUE"
    ],
    [
      "created_at",
      "TIMESTAMPTZ DEFAULT NOW()"
    ],
    [
      "updated_at",
      "TIMESTAMPTZ DEFAULT NOW()"
    ]
  ];

  for (const [
    column,
    definition
  ] of staffColumns) {
    await pool.query(`
      ALTER TABLE staff_users
      ADD COLUMN IF NOT EXISTS ${column}
      ${definition}
    `);
  }

  /*
   * USERS compatibility columns
   */

  const userColumns = [
    [
      "password_hash",
      "TEXT"
    ],
    [
      "password_salt",
      "TEXT"
    ],
    [
      "role",
      "TEXT DEFAULT 'patient'"
    ],
    [
      "active",
      "BOOLEAN DEFAULT TRUE"
    ],
    [
      "email",
      "TEXT"
    ],
    [
      "created_at",
      "TIMESTAMPTZ DEFAULT NOW()"
    ],
    [
      "updated_at",
      "TIMESTAMPTZ DEFAULT NOW()"
    ]
  ];

  for (const [
    column,
    definition
  ] of userColumns) {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS ${column}
      ${definition}
    `);
  }

  /*
   * PATIENT compatibility
   */

  const patientColumns = [
    [
      "auth_user_id",
      "UUID"
    ],
    [
      "username",
      "TEXT"
    ],
    [
      "full_name",
      "TEXT"
    ],
    [
      "phone",
      "TEXT"
    ],
    [
      "email",
      "TEXT"
    ],
    [
      "date_of_birth",
      "DATE"
    ],
    [
      "gender",
      "TEXT"
    ],
    [
      "address",
      "TEXT"
    ],
    [
      "created_at",
      "TIMESTAMPTZ DEFAULT NOW()"
    ],
    [
      "updated_at",
      "TIMESTAMPTZ DEFAULT NOW()"
    ]
  ];

  for (const [
    column,
    definition
  ] of patientColumns) {
    await pool.query(`
      ALTER TABLE patients
      ADD COLUMN IF NOT EXISTS ${column}
      ${definition}
    `);
  }

  /*
   * SERVICES
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS services (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      duration_minutes INTEGER DEFAULT 30,
      price NUMERIC DEFAULT 0,
      active BOOLEAN DEFAULT TRUE,
      image_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  /*
   * SERVICES compatibility
   */

  const serviceColumns = [
    [
      "description",
      "TEXT"
    ],
    [
      "duration_minutes",
      "INTEGER DEFAULT 30"
    ],
    [
      "price",
      "NUMERIC DEFAULT 0"
    ],
    [
      "active",
      "BOOLEAN DEFAULT TRUE"
    ],
    [
      "image_url",
      "TEXT"
    ],
    [
      "created_at",
      "TIMESTAMPTZ DEFAULT NOW()"
    ],
    [
      "updated_at",
      "TIMESTAMPTZ DEFAULT NOW()"
    ]
  ];

  for (const [
    column,
    definition
  ] of serviceColumns) {
    await pool.query(`
      ALTER TABLE services
      ADD COLUMN IF NOT EXISTS ${column}
      ${definition}
    `);
  }

  /*
   * APPOINTMENTS
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id UUID PRIMARY KEY,
      patient_id UUID NOT NULL,
      doctor_id UUID,
      service_id UUID,
      appointment_date DATE NOT NULL,
      appointment_time TIME NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const appointmentColumns = [
    [
      "patient_id",
      "UUID"
    ],
    [
      "doctor_id",
      "UUID"
    ],
    [
      "service_id",
      "UUID"
    ],
    [
      "appointment_date",
      "DATE"
    ],
    [
      "appointment_time",
      "TIME"
    ],
    [
      "status",
      "TEXT DEFAULT 'pending'"
    ],
    [
      "notes",
      "TEXT"
    ],
    [
      "created_at",
      "TIMESTAMPTZ DEFAULT NOW()"
    ],
    [
      "updated_at",
      "TIMESTAMPTZ DEFAULT NOW()"
    ]
  ];

  for (const [
    column,
    definition
  ] of appointmentColumns) {
    await pool.query(`
      ALTER TABLE appointments
      ADD COLUMN IF NOT EXISTS ${column}
      ${definition}
    `);
  }

  /*
   * MEDICAL RECORDS
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS medical_records (
      id UUID PRIMARY KEY,
      patient_id UUID NOT NULL,
      doctor_id UUID,
      appointment_id UUID,
      diagnosis TEXT,
      notes TEXT,
      treatment TEXT,
      attachments JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  /*
   * ADS
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
   * AD IMPRESSIONS
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_impressions (
      id UUID PRIMARY KEY,
      ad_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  /*
   * AD CLICKS
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_clicks (
      id UUID PRIMARY KEY,
      ad_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  /*
   * SESSIONS
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL,
      access_token_hash TEXT UNIQUE NOT NULL,
      refresh_token_hash TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      refresh_expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  /*
   * INDEXES
   */

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_username
    ON users(username)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_staff_auth_user
    ON staff_users(auth_user_id)
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

  /*
   * DEFAULT SERVICES
   */

  const serviceCount =
    await pool.query(
      `SELECT COUNT(*)::int AS count FROM services`
    );

  if (
    Number(serviceCount.rows[0].count) === 0
  ) {
    const defaultServices = [
      [
        "كشف طبي",
        "كشف ومتابعة الحالة الصحية",
        30
      ],
      [
        "استشارة",
        "استشارة طبية",
        30
      ],
      [
        "متابعة",
        "متابعة الحالة الصحية",
        30
      ],
      [
        "فحص وتشخيص",
        "فحص وتشخيص طبي",
        45
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
          duration_minutes,
          price,
          active
        )
        VALUES
        ($1,$2,$3,$4,$5,TRUE)
        `,
        [
          makeId(),
          service[0],
          service[1],
          service[2],
          0
        ]
      );
    }
  }

  /*
   * ADMIN SEED
   */

  await seedAdmin();

  console.log(
    "Database initialization completed."
  );
}

/* =========================================================
   ADMIN SEED
========================================================= */

async function seedAdmin() {
  const username =
    normalizeUsername(
      process.env.ADMIN_USERNAME
    );

  const password =
    process.env.ADMIN_PASSWORD;

  const name =
    process.env.ADMIN_NAME ||
    "مدير منصة موعدي";

  if (!username || !password) {
    console.log(
      "ADMIN_USERNAME / ADMIN_PASSWORD not configured. Admin seed skipped."
    );

    return;
  }

  try {
    const existing =
      await pool.query(
        `
        SELECT *
        FROM users
        WHERE username = $1
        LIMIT 1
        `,
        [username]
      );

    const credentials =
      hashPassword(password);

    let user;

    if (existing.rows.length > 0) {
      user = existing.rows[0];

      await pool.query(
        `
        UPDATE users
        SET
          password_hash = $1,
          password_salt = $2,
          role = 'admin',
          active = TRUE,
          updated_at = NOW()
        WHERE id = $3
        `,
        [
          credentials.hash,
          credentials.salt,
          user.id
        ]
      );

      console.log(
        "Existing admin account updated."
      );
    } else {
      const userId = makeId();

      const result =
        await pool.query(
          `
          INSERT INTO users
          (
            id,
            username,
            password_hash,
            password_salt,
            role,
            active
          )
          VALUES
          ($1,$2,$3,$4,'admin',TRUE)
          RETURNING *
          `,
          [
            userId,
            username,
            credentials.hash,
            credentials.salt
          ]
        );

      user = result.rows[0];

      console.log(
        "New admin account created."
      );
    }

    /*
     * Make sure staff_users row exists.
     */

    const staffResult =
      await pool.query(
        `
        SELECT *
        FROM staff_users
        WHERE auth_user_id = $1
        LIMIT 1
        `,
        [user.id]
      );

    if (staffResult.rows.length === 0) {
      await pool.query(
        `
        INSERT INTO staff_users
        (
          id,
          auth_user_id,
          username,
          full_name,
          role,
          active,
          available,
          created_at,
          updated_at
        )
        VALUES
        ($1,$2,$3,$4,'admin',TRUE,TRUE,NOW(),NOW())
        `,
        [
          makeId(),
          user.id,
          username,
          name
        ]
      );

      console.log(
        "Admin staff profile created."
      );
    } else {
      await pool.query(
        `
        UPDATE staff_users
        SET
          username = $1,
          full_name = $2,
          role = 'admin',
          active = TRUE,
          updated_at = NOW()
        WHERE auth_user_id = $3
        `,
        [
          username,
          name,
          user.id
        ]
      );

      console.log(
        "Admin staff profile updated."
      );
    }

    console.log(
      `Admin seed successful for username: ${username}`
    );
  } catch (error) {
    console.error(
      "Admin seed error:",
      error.message
    );
  }
}

/* =========================================================
   SESSIONS
========================================================= */

async function createSession(userId) {
  const accessToken =
    randomToken();

  const refreshToken =
    randomToken();

  const accessHash =
    hashToken(accessToken);

  const refreshHash =
    hashToken(refreshToken);

  const sessionId =
    makeId();

  await pool.query(
    `
    INSERT INTO sessions
    (
      id,
      user_id,
      access_token_hash,
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
      NOW() + INTERVAL '24 hours',
      NOW() + INTERVAL '30 days'
    )
    `,
    [
      sessionId,
      userId,
      accessHash,
      refreshHash
    ]
  );

  /*
   * Return both names for frontend compatibility.
   */

  return {
    token: accessToken,
    access_token: accessToken,
    refresh_token: refreshToken
  };
}

function getBearerToken(req) {
  const header =
    req.headers.authorization || "";

  if (
    !header.toLowerCase().startsWith(
      "bearer "
    )
  ) {
    return null;
  }

  return header.substring(7).trim();
}

async function authenticate(req) {
  const token =
    getBearerToken(req);

  if (!token) {
    return null;
  }

  const tokenHash =
    hashToken(token);

  const result =
    await pool.query(
      `
      SELECT
        s.*,
        u.username,
        u.role,
        u.email,
        u.active
      FROM sessions s
      JOIN users u
        ON u.id = s.user_id
      WHERE
        s.access_token_hash = $1
        AND s.expires_at > NOW()
      LIMIT 1
      `,
      [tokenHash]
    );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

async function requireAuth(
  req,
  res,
  next
) {
  try {
    const user =
      await authenticate(req);

    if (!user) {
      return jsonError(
        res,
        "يجب تسجيل الدخول أولاً.",
        401
      );
    }

    if (!user.active) {
      return jsonError(
        res,
        "الحساب غير مفعل.",
        403
      );
    }

    req.user = user;

    next();
  } catch (error) {
    console.error(
      "Authentication:",
      error
    );

    return jsonError(
      res,
      "تعذر التحقق من جلسة الدخول.",
      500
    );
  }
}

function requirePatient(
  req,
  res,
  next
) {
  if (
    !req.user ||
    req.user.role !== "patient"
  ) {
    return jsonError(
      res,
      "هذه العملية متاحة للمرضى فقط.",
      403
    );
  }

  next();
}

function requireStaff(
  req,
  res,
  next
) {
  if (
    !req.user ||
    ![
      "admin",
      "doctor",
      "secretary"
    ].includes(req.user.role)
  ) {
    return jsonError(
      res,
      "ليس لديك صلاحية الوصول.",
      403
    );
  }

  next();
}

function requireAdmin(
  req,
  res,
  next
) {
  if (
    !req.user ||
    req.user.role !== "admin"
  ) {
    return jsonError(
      res,
      "صلاحية المدير مطلوبة.",
      403
    );
  }

  next();
}

/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/api/health",
  async (req, res) => {
    try {
      await pool.query(
        "SELECT 1"
      );

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
      console.error(
        "Health:",
        error
      );

      return jsonError(
        res,
        "قاعدة البيانات غير متاحة.",
        500
      );
    }
  }
);

app.get(
  "/api/config",
  (req, res) => {
    return res.json({
      ok: true,
      database: "neon",
      features: {
        doctors: true,
        services: true,
        appointments: true,
        ads: true,
        medicalRecords: true
      }
    });
  }
);

/* =========================================================
   PATIENT REGISTER
========================================================= */

app.post(
  "/api/patient/register",
  async (req, res) => {
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

      if (
        !normalizedUsername ||
        !full_name ||
        !phone ||
        !password
      ) {
        return jsonError(
          res,
          "اسم المستخدم والاسم الكامل والهاتف وكلمة المرور مطلوبة."
        );
      }

      if (String(password).length < 6) {
        return jsonError(
          res,
          "كلمة المرور يجب أن تكون 6 أحرف على الأقل."
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
          [normalizedUsername]
        );

      if (existing.rows.length > 0) {
        return jsonError(
          res,
          "اسم المستخدم مستخدم بالفعل.",
          409
        );
      }

      const credentials =
        hashPassword(password);

      const userId =
        makeId();

      const patientId =
        makeId();

      const client =
        await pool.connect();

      try {
        await client.query(
          "BEGIN"
        );

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
          ($1,$2,$3,$4,'patient',TRUE,$5)
          `,
          [
            userId,
            normalizedUsername,
            credentials.hash,
            credentials.salt,
            email || null
          ]
        );

        await client.query(
          `
          INSERT INTO patients
          (
            id,
            auth_user_id,
            username,
            full_name,
            phone,
            email
          )
          VALUES
          ($1,$2,$3,$4,$5,$6)
          `,
          [
            patientId,
            userId,
            normalizedUsername,
            full_name,
            phone,
            email || null
          ]
        );

        await client.query(
          "COMMIT"
        );
      } catch (error) {
        await client.query(
          "ROLLBACK"
        );
        throw error;
      } finally {
        client.release();
      }

      const tokens =
        await createSession(userId);

      return res.status(201).json({
        ok: true,
        user: {
          id: userId,
          username:
            normalizedUsername,
          role: "patient",
          email:
            email || ""
        },
        patient: {
          id: patientId,
          full_name,
          phone,
          email:
            email || ""
        },
        ...tokens
      });
    } catch (error) {
      console.error(
        "Patient register:",
        error
      );

      return jsonError(
        res,
        "تعذر إنشاء حساب المريض.",
        500
      );
    }
  }
);

/* =========================================================
   PATIENT LOGIN
========================================================= */

app.post(
  "/api/patient/login",
  async (req, res) => {
    try {
      const {
        username,
        password
      } = req.body || {};

      const normalizedUsername =
        normalizeUsername(username);

      if (
        !normalizedUsername ||
        !password
      ) {
        return jsonError(
          res,
          "اسم المستخدم وكلمة المرور مطلوبان."
        );
      }

      const result =
        await pool.query(
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

      const user =
        result.rows[0];

      if (
        user.role !== "patient"
      ) {
        return jsonError(
          res,
          "هذا الحساب ليس حساب مريض.",
          403
        );
      }

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

      const patientResult =
        await pool.query(
          `
          SELECT *
          FROM patients
          WHERE auth_user_id = $1
          LIMIT 1
          `,
          [user.id]
        );

      const tokens =
        await createSession(user.id);

      return res.json({
        ok: true,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          email: user.email || ""
        },
        patient:
          mapPatient(
            patientResult.rows[0]
          ),
        ...tokens
      });
    } catch (error) {
      console.error(
        "Patient login:",
        error
      );

      return jsonError(
        res,
        "حدث خطأ أثناء تسجيل الدخول.",
        500
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
      const {
        username,
        password
      } = req.body || {};

      const normalizedUsername =
        normalizeUsername(username);

      if (
        !normalizedUsername ||
        !password
      ) {
        return jsonError(
          res,
          "اسم المستخدم وكلمة المرور مطلوبان."
        );
      }

      const result =
        await pool.query(
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

      const user =
        result.rows[0];

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
        ![
          "admin",
          "doctor",
          "secretary"
        ].includes(user.role)
      ) {
        return jsonError(
          res,
          "ليس لديك صلاحية الدخول إلى لوحة الإدارة.",
          403
        );
      }

      /*
       * Make sure the staff profile exists.
       */

      let staffResult =
        await pool.query(
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

      let staff =
        staffResult.rows[0];

      /*
       * If an admin user exists but its staff profile
       * was not created because of an old schema,
       * create it automatically here.
       */

      if (!staff) {
        const staffId =
          makeId();

        await pool.query(
          `
          INSERT INTO staff_users
          (
            id,
            auth_user_id,
            username,
            full_name,
            role,
            active,
            available,
            created_at,
            updated_at
          )
          VALUES
          ($1,$2,$3,$4,$5,TRUE,TRUE,NOW(),NOW())
          `,
          [
            staffId,
            user.id,
            user.username,
            process.env.ADMIN_NAME ||
              "مدير منصة موعدي",
            user.role
          ]
        );

        staffResult =
          await pool.query(
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

        staff =
          staffResult.rows[0];
      }

      const tokens =
        await createSession(
          user.id
        );

      return res.json({
        ok: true,

        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          email: user.email || "",
          full_name:
            staff?.full_name || ""
        },

        staff:
          mapDoctor(staff),

        /*
         * Includes:
         * token
         * access_token
         * refresh_token
         */

        ...tokens
      });
    } catch (error) {
      console.error(
        "Staff login:",
        error
      );

      return jsonError(
        res,
        "حدث خطأ أثناء تسجيل الدخول.",
        500
      );
    }
  }
);

/* =========================================================
   LOGIN ALIASES
========================================================= */

app.post(
  "/api/admin/login",
  async (req, res) => {
    req.url = "/api/staff/login";
    return app._router.handle(
      req,
      res
    );
  }
);

app.post(
  "/api/login",
  async (req, res) => {
    req.url = "/api/staff/login";
    return app._router.handle(
      req,
      res
    );
  }
);

/* =========================================================
   CURRENT USER
========================================================= */

app.get(
  "/api/staff/me",
  requireAuth,
  requireStaff,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT
            s.*,
            u.email,
            u.username,
            u.role
          FROM staff_users s
          LEFT JOIN users u
            ON u.id = s.auth_user_id
          WHERE s.auth_user_id = $1
          LIMIT 1
          `,
          [req.user.user_id]
        );

      return res.json({
        ok: true,
        user: {
          id: req.user.user_id,
          username:
            req.user.username,
          role:
            req.user.role,
          email:
            req.user.email || "",
          full_name:
            result.rows[0]?.full_name || ""
        },
        staff:
          mapDoctor(
            result.rows[0]
          )
      });
    } catch (error) {
      console.error(
        "Staff me:",
        error
      );

      return jsonError(
        res,
        "تعذر تحميل بيانات المستخدم.",
        500
      );
    }
  }
);

app.get(
  "/api/patient/me",
  requireAuth,
  requirePatient,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT *
          FROM patients
          WHERE auth_user_id = $1
          LIMIT 1
          `,
          [req.user.user_id]
        );

      return res.json({
        ok: true,
        user: {
          id: req.user.user_id,
          username:
            req.user.username,
          role:
            req.user.role,
          email:
            req.user.email || ""
        },
        patient:
          mapPatient(
            result.rows[0]
          )
      });
    } catch (error) {
      console.error(
        "Patient me:",
        error
      );

      return jsonError(
        res,
        "تعذر تحميل بيانات المريض.",
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
      const token =
        getBearerToken(req);

      if (token) {
        await pool.query(
          `
          DELETE FROM sessions
          WHERE access_token_hash = $1
          `,
          [hashToken(token)]
        );
      }

      return jsonOk(res);
    } catch (error) {
      console.error(
        "Logout:",
        error
      );

      return jsonError(
        res,
        "تعذر تسجيل الخروج.",
        500
      );
    }
  }
);

/* =========================================================
   PUBLIC SERVICES
========================================================= */

app.get(
  "/api/services",
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT *
          FROM services
          WHERE active = TRUE
          ORDER BY name ASC
          `
        );

      return res.json({
        ok: true,
        services:
          result.rows.map(
            mapService
          )
      });
    } catch (error) {
      console.error(
        "Public services:",
        error
      );

      return jsonError(
        res,
        "تعذر تحميل الخدمات.",
        500
      );
    }
  }
);

/* =========================================================
   PUBLIC DOCTORS
========================================================= */

app.get(
  "/api/doctors",
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT
            s.*,
            u.username,
            u.email,
            u.role
          FROM staff_users s
          LEFT JOIN users u
            ON u.id = s.auth_user_id
          WHERE
            s.role = 'doctor'
            AND s.active = TRUE
            AND s.available = TRUE
          ORDER BY s.full_name ASC
          `
        );

      return res.json({
        ok: true,
        doctors:
          result.rows.map(
            mapDoctor
          )
      });
    } catch (error) {
      console.error(
        "Public doctors:",
        error
      );

      return jsonError(
        res,
        "تعذر تحميل الأطباء.",
        500
      );
    }
  }
);

app.get(
  "/api/doctors/:id",
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT
            s.*,
            u.username,
            u.email,
            u.role
          FROM staff_users s
          LEFT JOIN users u
            ON u.id = s.auth_user_id
          WHERE
            s.id = $1
            AND s.role = 'doctor'
          LIMIT 1
          `,
          [req.params.id]
        );

      if (
        result.rows.length === 0
      ) {
        return jsonError(
          res,
          "الطبيب غير موجود.",
          404
        );
      }

      return res.json({
        ok: true,
        doctor:
          mapDoctor(
            result.rows[0]
          )
      });
    } catch (error) {
      console.error(
        "Doctor:",
        error
      );

      return jsonError(
        res,
        "تعذر تحميل بيانات الطبيب.",
        500
      );
    }
  }
);

/* =========================================================
   PUBLIC ADS
========================================================= */

app.get(
  "/api/ads",
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT *
          FROM ads
          WHERE
            active = TRUE
            AND
            (
              starts_at IS NULL
              OR starts_at <= NOW()
            )
            AND
            (
              ends_at IS NULL
              OR ends_at >= NOW()
            )
          ORDER BY created_at DESC
          `
        );

      return res.json({
        ok: true,
        ads: result.rows
      });
    } catch (error) {
      console.error(
        "Public ads:",
        error
      );

      return jsonError(
        res,
        "تعذر تحميل الإعلانات.",
        500
      );
    }
  }
);

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
        VALUES
        ($1,$2)
        `,
        [
          makeId(),
          req.params.id
        ]
      );

      return jsonOk(res);
    } catch (error) {
      console.error(
        "Ad impression:",
        error
      );

      return jsonError(
        res,
        "تعذر تسجيل المشاهدة.",
        500
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
        (
          id,
          ad_id
        )
        VALUES
        ($1,$2)
        `,
        [
          makeId(),
          req.params.id
        ]
      );

      return jsonOk(res);
    } catch (error) {
      console.error(
        "Ad click:",
        error
      );

      return jsonError(
        res,
        "تعذر تسجيل النقرة.",
        500
      );
    }
  }
);

/* =========================================================
   CREATE APPOINTMENT
========================================================= */

app.post(
  "/api/appointments",
  requireAuth,
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

      if (
        !service_id ||
        !appointment_date ||
        !appointment_time
      ) {
        return jsonError(
          res,
          "الخدمة والتاريخ والوقت مطلوبة."
        );
      }

      if (
        !validDate(
          appointment_date
        ) ||
        !validTime(
          appointment_time
        )
      ) {
        return jsonError(
          res,
          "التاريخ أو الوقت غير صحيح."
        );
      }

      const serviceResult =
        await pool.query(
          `
          SELECT *
          FROM services
          WHERE
            id = $1
            AND active = TRUE
          LIMIT 1
          `,
          [service_id]
        );

      if (
        serviceResult.rows.length === 0
      ) {
        return jsonError(
          res,
          "الخدمة غير موجودة أو غير متاحة.",
          404
        );
      }

      if (doctor_id) {
        const doctorResult =
          await pool.query(
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

        if (
          doctorResult.rows.length === 0
        ) {
          return jsonError(
            res,
            "الطبيب غير متاح حالياً.",
            404
          );
        }

        const conflict =
          await pool.query(
            `
            SELECT id
            FROM appointments
            WHERE
              doctor_id = $1
              AND appointment_date = $2
              AND appointment_time = $3
              AND status IN
              (
                'pending',
                'confirmed'
              )
            LIMIT 1
            `,
            [
              doctor_id,
              appointment_date,
              appointment_time
            ]
          );

        if (
          conflict.rows.length > 0
        ) {
          return jsonError(
            res,
            "هذا الموعد محجوز بالفعل.",
            409
          );
        }
      }

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
          SELECT
            $1,
            p.id,
            $2,
            $3,
            $4,
            $5,
            'pending',
            $6
          FROM patients p
          WHERE p.auth_user_id = $7
          RETURNING *
          `,
          [
            makeId(),
            doctor_id || null,
            service_id,
            appointment_date,
            appointment_time,
            notes || "",
            req.user.user_id
          ]
        );

      if (
        result.rows.length === 0
      ) {
        return jsonError(
          res,
          "حساب المريض غير موجود.",
          404
        );
      }

      return res.status(201).json({
        ok: true,
        appointment:
          mapAppointment(
            result.rows[0]
          )
      });
    } catch (error) {
      console.error(
        "Create appointment:",
        error
      );

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

async function getPatientAppointments(
  req,
  res
) {
  try {
    const result =
      await pool.query(
        `
        SELECT
          a.*,
          p.full_name AS patient_name,
          p.phone AS patient_phone,
          s.name AS service_name,
          d.full_name AS doctor_name
        FROM appointments a

        LEFT JOIN patients p
          ON p.id = a.patient_id

        LEFT JOIN services s
          ON s.id = a.service_id

        LEFT JOIN staff_users d
          ON d.id = a.doctor_id

        WHERE
          a.patient_id =
          (
            SELECT id
            FROM patients
            WHERE auth_user_id = $1
            LIMIT 1
          )

        ORDER BY
          a.appointment_date DESC,
          a.appointment_time DESC
        `,
        [req.user.user_id]
      );

    return res.json({
      ok: true,
      appointments:
        result.rows.map(
          mapAppointment
        )
    });
  } catch (error) {
    console.error(
      "Patient appointments:",
      error
    );

    return jsonError(
      res,
      "تعذر تحميل المواعيد.",
      500
    );
  }
}

app.get(
  "/api/my-appointments",
  requireAuth,
  requirePatient,
  getPatientAppointments
);

app.get(
  "/api/patient/appointments",
  requireAuth,
  requirePatient,
  getPatientAppointments
);

/* =========================================================
   DASHBOARD STATS
========================================================= */

app.get(
  "/api/dashboard/stats",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const [
        appointments,
        patients,
        doctors,
        services,
        ads
      ] =
        await Promise.all([
          pool.query(
            `
            SELECT COUNT(*)::int AS count
            FROM appointments
            `
          ),

          pool.query(
            `
            SELECT COUNT(*)::int AS count
            FROM patients
            `
          ),

          pool.query(
            `
            SELECT COUNT(*)::int AS count
            FROM staff_users
            WHERE role = 'doctor'
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

      return res.json({
        ok: true,
        stats: {
          appointments:
            Number(
              appointments.rows[0].count
            ),

          patients:
            Number(
              patients.rows[0].count
            ),

          doctors:
            Number(
              doctors.rows[0].count
            ),

          services:
            Number(
              services.rows[0].count
            ),

          ads:
            Number(
              ads.rows[0].count
            ),

          pending:
            Number(
              pending.rows[0].count
            ),

          confirmed:
            Number(
              confirmed.rows[0].count
            )
        }
      });
    } catch (error) {
      console.error(
        "Dashboard stats:",
        error
      );

      return jsonError(
        res,
        "تعذر تحميل إحصائيات لوحة الإدارة.",
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
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT
            a.*,
            p.full_name AS patient_name,
            p.phone AS patient_phone,
            s.name AS service_name,
            d.full_name AS doctor_name
          FROM appointments a

          LEFT JOIN patients p
            ON p.id = a.patient_id

          LEFT JOIN services s
            ON s.id = a.service_id

          LEFT JOIN staff_users d
            ON d.id = a.doctor_id

          ORDER BY
            a.appointment_date DESC,
            a.appointment_time DESC,
            a.created_at DESC
          `
        );

      return res.json({
        ok: true,
        appointments:
          result.rows.map(
            mapAppointment
          )
      });
    } catch (error) {
      console.error(
        "Dashboard appointments:",
        error
      );

      return jsonError(
        res,
        "تعذر تحميل المواعيد.",
        500
      );
    }
  }
);

/* =========================================================
   APPOINTMENT STATUS
========================================================= */

async function updateAppointmentStatus(
  req,
  res,
  status
) {
  try {
    const result =
      await pool.query(
        `
        UPDATE appointments
        SET
          status = $1,
          updated_at = NOW()
        WHERE id = $2
        RETURNING *
        `,
        [
          status,
          req.params.id
        ]
      );

    if (
      result.rows.length === 0
    ) {
      return jsonError(
        res,
        "الموعد غير موجود.",
        404
      );
    }

    return res.json({
      ok: true,
      appointment:
        mapAppointment(
          result.rows[0]
        )
    });
  } catch (error) {
    console.error(
      "Appointment status:",
      error
    );

    return jsonError(
      res,
      "تعذر تحديث حالة الموعد.",
      500
    );
  }
}

app.patch(
  "/api/dashboard/appointments/:id/confirm",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    return updateAppointmentStatus(
      req,
      res,
      "confirmed"
    );
  }
);

app.post(
  "/api/dashboard/appointments/:id/confirm",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    return updateAppointmentStatus(
      req,
      res,
      "confirmed"
    );
  }
);

app.patch(
  "/api/dashboard/appointments/:id/cancel",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    return updateAppointmentStatus(
      req,
      res,
      "cancelled"
    );
  }
);

app.post(
  "/api/dashboard/appointments/:id/cancel",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    return updateAppointmentStatus(
      req,
      res,
      "cancelled"
    );
  }
);

/* =========================================================
   DASHBOARD PATIENTS
========================================================= */

app.get(
  "/api/dashboard/patients",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT *
          FROM patients
          ORDER BY created_at DESC
          `
        );

      return res.json({
        ok: true,
        patients:
          result.rows.map(
            mapPatient
          )
      });
    } catch (error) {
      console.error(
        "Dashboard patients:",
        error
      );

      return jsonError(
        res,
        "تعذر تحميل المرضى.",
        500
      );
    }
  }
);

/* =========================================================
   MEDICAL RECORDS
========================================================= */

app.get(
  "/api/dashboard/medical-records",
  requireAuth,
  requireAdmin,
  async (req, res) => {
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
            ON p.id = m.patient_id

          LEFT JOIN staff_users d
            ON d.id = m.doctor_id

          ORDER BY
            m.created_at DESC
          `
        );

      return res.json({
        ok: true,
        records:
          result.rows
      });
    } catch (error) {
      console.error(
        "Medical records:",
        error
      );

      return jsonError(
        res,
        "تعذر تحميل السجلات الطبية.",
        500
      );
    }
  }
);

app.post(
  "/api/dashboard/medical-records",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const {
        patient_id,
        doctor_id,
        appointment_id,
        diagnosis,
        notes,
        treatment,
        attachments
      } = req.body || {};

      if (!patient_id) {
        return jsonError(
          res,
          "المريض مطلوب."
        );
      }

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
            notes,
            treatment,
            attachments
          )
          VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8)
          RETURNING *
          `,
          [
            makeId(),
            patient_id,
            doctor_id || null,
            appointment_id || null,
            diagnosis || "",
            notes || "",
            treatment || "",
            JSON.stringify(
              attachments || []
            )
          ]
        );

      return res.status(201).json({
        ok: true,
        record:
          result.rows[0]
      });
    } catch (error) {
      console.error(
        "Create medical record:",
        error
      );

      return jsonError(
        res,
        "تعذر حفظ السجل الطبي.",
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
  requireAuth,
  requireAdmin,
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

      return res.json({
        ok: true,
        services:
          result.rows.map(
            mapService
          )
      });
    } catch (error) {
      console.error(
        "Dashboard services:",
        error
      );

      return jsonError(
        res,
        "تعذر تحميل الخدمات.",
        500
      );
    }
  }
);

app.post(
  "/api/dashboard/services",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const {
        name,
        description,
        duration_minutes,
        price,
        active,
        image_url
      } = req.body || {};

      if (!name) {
        return jsonError(
          res,
          "اسم الخدمة مطلوب."
        );
      }

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
            active,
            image_url
          )
          VALUES
          ($1,$2,$3,$4,$5,$6,$7)
          RETURNING *
          `,
          [
            makeId(),
            name,
            description || "",
            Number(
              duration_minutes || 30
            ),
            Number(
              price || 0
            ),
            active !== false,
            image_url || ""
          ]
        );

      return res.status(201).json({
        ok: true,
        service:
          mapService(
            result.rows[0]
          )
      });
    } catch (error) {
      console.error(
        "Create service:",
        error
      );

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
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const {
        name,
        description,
        duration_minutes,
        price,
        active,
        image_url
      } = req.body || {};

      const result =
        await pool.query(
          `
          UPDATE services
          SET
            name =
              COALESCE($1,name),
            description =
              COALESCE($2,description),
            duration_minutes =
              COALESCE($3,duration_minutes),
            price =
              COALESCE($4,price),
            active =
              COALESCE($5,active),
            image_url =
              COALESCE($6,image_url),
            updated_at = NOW()
          WHERE id = $7
          RETURNING *
          `,
          [
            name ?? null,
            description ?? null,
            duration_minutes !==
            undefined
              ? Number(
                  duration_minutes
                )
              : null,
            price !== undefined
              ? Number(price)
              : null,
            active !== undefined
              ? Boolean(active)
              : null,
            image_url ?? null,
            req.params.id
          ]
        );

      if (
        result.rows.length === 0
      ) {
        return jsonError(
          res,
          "الخدمة غير موجودة.",
          404
        );
      }

      return res.json({
        ok: true,
        service:
          mapService(
            result.rows[0]
          )
      });
    } catch (error) {
      console.error(
        "Update service:",
        error
      );

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
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          DELETE FROM services
          WHERE id = $1
          RETURNING id
          `,
          [req.params.id]
        );

      if (
        result.rows.length === 0
      ) {
        return jsonError(
          res,
          "الخدمة غير موجودة.",
          404
        );
      }

      return jsonOk(res);
    } catch (error) {
      console.error(
        "Delete service:",
        error
      );

      return jsonError(
        res,
        "تعذر حذف الخدمة.",
        500
      );
    }
  }
);

/* =========================================================
   DASHBOARD DOCTORS
========================================================= */

app.get(
  "/api/dashboard/doctors",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT
            s.*,
            u.username,
            u.email,
            u.role
          FROM staff_users s
          LEFT JOIN users u
            ON u.id = s.auth_user_id
          WHERE s.role = 'doctor'
          ORDER BY s.created_at DESC
          `
        );

      return res.json({
        ok: true,
        doctors:
          result.rows.map(
            mapDoctor
          )
      });
    } catch (error) {
      console.error(
        "Dashboard doctors:",
        error
      );

      return jsonError(
        res,
        "تعذر تحميل الأطباء.",
        500
      );
    }
  }
);

app.post(
  "/api/dashboard/doctors",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const {
        full_name,
        username,
        password,
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
        normalizeUsername(
          username
        );

      if (
        !full_name ||
        !normalizedUsername ||
        !password ||
        !specialty
      ) {
        return jsonError(
          res,
          "الاسم واسم المستخدم وكلمة المرور والتخصص مطلوبة."
        );
      }

      const existing =
        await client.query(
          `
          SELECT id
          FROM users
          WHERE username = $1
          LIMIT 1
          `,
          [normalizedUsername]
        );

      if (
        existing.rows.length > 0
      ) {
        return jsonError(
          res,
          "اسم المستخدم مستخدم بالفعل.",
          409
        );
      }

      const credentials =
        hashPassword(password);

      const userId =
        makeId();

      const staffId =
        makeId();

      await client.query(
        "BEGIN"
      );

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
        ($1,$2,$3,$4,'doctor',$5,$6)
        `,
        [
          userId,
          normalizedUsername,
          credentials.hash,
          credentials.salt,
          active !== false,
          email || null
        ]
      );

      await client.query(
        `
        INSERT INTO staff_users
        (
          id,
          auth_user_id,
          username,
          full_name,
          phone,
          specialty,
          area,
          image_url,
          bio,
          role,
          active,
          available
        )
        VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,'doctor',$10,$11)
        `,
        [
          staffId,
          userId,
          normalizedUsername,
          full_name,
          phone || "",
          specialty,
          area || "",
          image_url || "",
          bio || "",
          active !== false,
          available !== false
        ]
      );

      await client.query(
        "COMMIT"
      );

      const result =
        await pool.query(
          `
          SELECT
            s.*,
            u.username,
            u.email,
            u.role
          FROM staff_users s
          LEFT JOIN users u
            ON u.id = s.auth_user_id
          WHERE s.id = $1
          `,
          [staffId]
        );

      return res.status(201).json({
        ok: true,
        doctor:
          mapDoctor(
            result.rows[0]
          )
      });
    } catch (error) {
      await client.query(
        "ROLLBACK"
      );

      console.error(
        "Create doctor:",
        error
      );

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

app.patch(
  "/api/dashboard/doctors/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const {
        full_name,
        username,
        password,
        phone,
        email,
        specialty,
        area,
        image_url,
        bio,
        active,
        available
      } = req.body || {};

      const doctorResult =
        await client.query(
          `
          SELECT
            s.*,
            u.username AS user_username,
            u.email AS user_email
          FROM staff_users s
          LEFT JOIN users u
            ON u.id = s.auth_user_id
          WHERE s.id = $1
            AND s.role = 'doctor'
          LIMIT 1
          `,
          [req.params.id]
        );

      if (
        doctorResult.rows.length === 0
      ) {
        return jsonError(
          res,
          "الطبيب غير موجود.",
          404
        );
      }

      const doctor =
        doctorResult.rows[0];

      const newUsername =
        username !== undefined
          ? normalizeUsername(
              username
            )
          : doctor.user_username;

      await client.query(
        "BEGIN"
      );

      if (
        username !== undefined &&
        newUsername !==
          doctor.user_username
      ) {
        const duplicate =
          await client.query(
            `
            SELECT id
            FROM users
            WHERE
              username = $1
              AND id <> $2
            LIMIT 1
            `,
            [
              newUsername,
              doctor.auth_user_id
            ]
          );

        if (
          duplicate.rows.length > 0
        ) {
          await client.query(
            "ROLLBACK"
          );

          return jsonError(
            res,
            "اسم المستخدم مستخدم بالفعل.",
            409
          );
        }
      }

      if (password) {
        const credentials =
          hashPassword(password);

        await client.query(
          `
          UPDATE users
          SET
            username = $1,
            password_hash = $2,
            password_salt = $3,
            email = $4,
            active = $5,
            updated_at = NOW()
          WHERE id = $6
          `,
          [
            newUsername,
            credentials.hash,
            credentials.salt,
            email !== undefined
              ? email
              : doctor.user_email,
            active !== undefined
              ? Boolean(active)
              : doctor.active,
            doctor.auth_user_id
          ]
        );
      } else {
        await client.query(
          `
          UPDATE users
          SET
            username = $1,
            email = $2,
            active = $3,
            updated_at = NOW()
          WHERE id = $4
          `,
          [
            newUsername,
            email !== undefined
              ? email
              : doctor.user_email,
            active !== undefined
              ? Boolean(active)
              : doctor.active,
            doctor.auth_user_id
          ]
        );
      }

      await client.query(
        `
        UPDATE staff_users
        SET
          username = $1,
          full_name = $2,
          phone = $3,
          specialty = $4,
          area = $5,
          image_url = $6,
          bio = $7,
          active = $8,
          available = $9,
          updated_at = NOW()
        WHERE id = $10
        `,
        [
          newUsername,
          full_name !== undefined
            ? full_name
            : doctor.full_name,
          phone !== undefined
            ? phone
            : doctor.phone,
          specialty !== undefined
            ? specialty
            : doctor.specialty,
          area !== undefined
            ? area
            : doctor.area,
          image_url !== undefined
            ? image_url
            : doctor.image_url,
          bio !== undefined
            ? bio
            : doctor.bio,
          active !== undefined
            ? Boolean(active)
            : doctor.active,
          available !== undefined
            ? Boolean(available)
            : doctor.available,
          req.params.id
        ]
      );

      await client.query(
        "COMMIT"
      );

      const result =
        await pool.query(
          `
          SELECT
            s.*,
            u.username,
            u.email,
            u.role
          FROM staff_users s
          LEFT JOIN users u
            ON u.id = s.auth_user_id
          WHERE s.id = $1
          `,
          [req.params.id]
        );

      return res.json({
        ok: true,
        doctor:
          mapDoctor(
            result.rows[0]
          )
      });
    } catch (error) {
      await client.query(
        "ROLLBACK"
      );

      console.error(
        "Update doctor:",
        error
      );

      return jsonError(
        res,
        "تعذر تعديل الطبيب.",
        500
      );
    } finally {
      client.release();
    }
  }
);

app.delete(
  "/api/dashboard/doctors/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const result =
        await client.query(
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

      if (
        result.rows.length === 0
      ) {
        return jsonError(
          res,
          "الطبيب غير موجود.",
          404
        );
      }

      const authUserId =
        result.rows[0]
          .auth_user_id;

      await client.query(
        "BEGIN"
      );

      /*
       * Keep appointments and medical records.
       * Remove the doctor profile and deactivate user.
       */

      await client.query(
        `
        UPDATE users
        SET
          active = FALSE,
          updated_at = NOW()
        WHERE id = $1
        `,
        [authUserId]
      );

      await client.query(
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

      await client.query(
        "COMMIT"
      );

      return jsonOk(res);
    } catch (error) {
      await client.query(
        "ROLLBACK"
      );

      console.error(
        "Delete doctor:",
        error
      );

      return jsonError(
        res,
        "تعذر إيقاف الطبيب.",
        500
      );
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   DASHBOARD ADS
========================================================= */

app.get(
  "/api/dashboard/ads",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT
            a.*,

            (
              SELECT COUNT(*)::int
              FROM ad_impressions i
              WHERE i.ad_id = a.id
            ) AS impressions,

            (
              SELECT COUNT(*)::int
              FROM ad_clicks c
              WHERE c.ad_id = a.id
            ) AS clicks

          FROM ads a
          ORDER BY
            a.created_at DESC
          `
        );

      return res.json({
        ok: true,
        ads:
          result.rows
      });
    } catch (error) {
      console.error(
        "Dashboard ads:",
        error
      );

      return jsonError(
        res,
        "تعذر تحميل الإعلانات.",
        500
      );
    }
  }
);

app.post(
  "/api/dashboard/ads",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const {
        title,
        description,
        image_url,
        target_url,
        advertiser_name,
        category,
        active,
        starts_at,
        ends_at
      } = req.body || {};

      if (!title) {
        return jsonError(
          res,
          "عنوان الإعلان مطلوب."
        );
      }

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
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          RETURNING *
          `,
          [
            makeId(),
            title,
            description || "",
            image_url || "",
            target_url || "",
            advertiser_name || "",
            category || "",
            active !== false,
            starts_at || null,
            ends_at || null
          ]
        );

      return res.status(201).json({
        ok: true,
        ad:
          result.rows[0]
      });
    } catch (error) {
      console.error(
        "Create ad:",
        error
      );

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
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const {
        title,
        description,
        image_url,
        target_url,
        advertiser_name,
        category,
        active,
        starts_at,
        ends_at
      } = req.body || {};

      const result =
        await pool.query(
          `
          UPDATE ads
          SET
            title =
              COALESCE($1,title),
            description =
              COALESCE($2,description),
            image_url =
              COALESCE($3,image_url),
            target_url =
              COALESCE($4,target_url),
            advertiser_name =
              COALESCE($5,advertiser_name),
            category =
              COALESCE($6,category),
            active =
              COALESCE($7,active),
            starts_at =
              COALESCE($8,starts_at),
            ends_at =
              COALESCE($9,ends_at),
            updated_at = NOW()
          WHERE id = $10
          RETURNING *
          `,
          [
            title ?? null,
            description ?? null,
            image_url ?? null,
            target_url ?? null,
            advertiser_name ?? null,
            category ?? null,
            active !== undefined
              ? Boolean(active)
              : null,
            starts_at ?? null,
            ends_at ?? null,
            req.params.id
          ]
        );

      if (
        result.rows.length === 0
      ) {
        return jsonError(
          res,
          "الإعلان غير موجود.",
          404
        );
      }

      return res.json({
        ok: true,
        ad:
          result.rows[0]
      });
    } catch (error) {
      console.error(
        "Update ad:",
        error
      );

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
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          DELETE FROM ads
          WHERE id = $1
          RETURNING id
          `,
          [req.params.id]
        );

      if (
        result.rows.length === 0
      ) {
        return jsonError(
          res,
          "الإعلان غير موجود.",
          404
        );
      }

      return jsonOk(res);
    } catch (error) {
      console.error(
        "Delete ad:",
        error
      );

      return jsonError(
        res,
        "تعذر حذف الإعلان.",
        500
      );
    }
  }
);

/* =========================================================
   404 API
========================================================= */

app.use(
  (req, res, next) => {
    if (
      req.path.startsWith("/api/")
    ) {
      return jsonError(
        res,
        "المسار غير موجود.",
        404
      );
    }

    next();
  }
);

/* =========================================================
   FRONTEND FALLBACK
========================================================= */

app.use(
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);

/* =========================================================
   START
========================================================= */

async function startServer() {
  try {
    await initDatabase();

    app.listen(
      PORT,
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

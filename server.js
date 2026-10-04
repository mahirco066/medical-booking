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
  express.static(PUBLIC_DIR)
);

/* =========================================================
   Helpers
========================================================= */

function makeId() {
  return crypto.randomUUID();
}

function randomToken() {
  return crypto
    .randomBytes(32)
    .toString("hex");
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

function jsonError(
  res,
  status,
  message
) {
  return res.status(status).json({
    ok: false,
    error: message
  });
}

/* =========================================================
   Password
========================================================= */

function hashPassword(password) {
  return new Promise(
    (resolve, reject) => {
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

          resolve(
            salt +
              ":" +
              derivedKey.toString("hex")
          );
        }
      );
    }
  );
}

function verifyPassword(
  password,
  stored
) {
  return new Promise(
    (resolve, reject) => {
      try {
        const parts = String(
          stored || ""
        ).split(":");

        if (parts.length !== 2) {
          return resolve(false);
        }

        const salt = parts[0];

        const expected =
          Buffer.from(
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
    }
  );
}

/* =========================================================
   Database helpers
========================================================= */

async function columnExists(
  table,
  column
) {
  const result =
    await pool.query(
      `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
        AND column_name = $2
      LIMIT 1
      `,
      [table, column]
    );

  return result.rowCount > 0;
}

async function tableExists(
  table
) {
  const result =
    await pool.query(
      `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = $1
      LIMIT 1
      `,
      [table]
    );

  return result.rowCount > 0;
}

async function addColumnIfMissing(
  table,
  column,
  definition
) {
  const exists =
    await columnExists(
      table,
      column
    );

  if (!exists) {
    await pool.query(
      "ALTER TABLE " +
        '"' +
        table +
        '"' +
        " ADD COLUMN " +
        '"' +
        column +
        '"' +
        " " +
        definition
    );
  }
}

/* =========================================================
   Database initialization
========================================================= */

async function initDatabase() {
  console.log(
    "Initializing Neon database..."
  );

  /* -------------------------------------------------------
     USERS
  ------------------------------------------------------- */

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

  /* -------------------------------------------------------
     PATIENTS
  ------------------------------------------------------- */

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

  /* -------------------------------------------------------
     STAFF USERS
  ------------------------------------------------------- */

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

  /* -------------------------------------------------------
     SERVICES
  ------------------------------------------------------- */

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

  /* -------------------------------------------------------
     DOCTORS
  ------------------------------------------------------- */

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

  /* -------------------------------------------------------
     APPOINTMENTS
  ------------------------------------------------------- */

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

  /* -------------------------------------------------------
     MEDICAL RECORDS
  ------------------------------------------------------- */

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

  /* -------------------------------------------------------
     ADS
  ------------------------------------------------------- */

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

  /* -------------------------------------------------------
     AD IMPRESSIONS
  ------------------------------------------------------- */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_impressions (
      id UUID PRIMARY KEY,
      ad_id UUID REFERENCES ads(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  /* -------------------------------------------------------
     AD CLICKS
  ------------------------------------------------------- */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_clicks (
      id UUID PRIMARY KEY,
      ad_id UUID REFERENCES ads(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  /* -------------------------------------------------------
     SESSIONS

     مهم جدًا:
     يتم إنشاء الأعمدة الأساسية هنا قبل الفهارس.
  ------------------------------------------------------- */

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

  /* =======================================================
     Compatibility / Migration
     للجداول القديمة الموجودة في Neon
  ======================================================= */

  const compatibilityColumns = [
    /* USERS */
    [
      "users",
      "role",
      "TEXT NOT NULL DEFAULT 'patient'"
    ],
    [
      "users",
      "active",
      "BOOLEAN NOT NULL DEFAULT TRUE"
    ],
    [
      "users",
      "phone",
      "TEXT"
    ],
    [
      "users",
      "email",
      "TEXT"
    ],
    [
      "users",
      "created_at",
      "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    ],
    [
      "users",
      "updated_at",
      "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    ],

    /* PATIENTS */
    [
      "patients",
      "user_id",
      "UUID"
    ],
    [
      "patients",
      "phone",
      "TEXT"
    ],
    [
      "patients",
      "email",
      "TEXT"
    ],
    [
      "patients",
      "date_of_birth",
      "DATE"
    ],
    [
      "patients",
      "gender",
      "TEXT"
    ],
    [
      "patients",
      "address",
      "TEXT"
    ],
    [
      "patients",
      "active",
      "BOOLEAN NOT NULL DEFAULT TRUE"
    ],
    [
      "patients",
      "created_at",
      "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    ],
    [
      "patients",
      "updated_at",
      "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    ],

    /* STAFF */
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
      "created_at",
      "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    ],
    [
      "staff_users",
      "updated_at",
      "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    ],

    /* SERVICES */
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
      "created_at",
      "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    ],
    [
      "services",
      "updated_at",
      "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    ],

    /* DOCTORS */
    [
      "doctors",
      "user_id",
      "UUID"
    ],
    [
      "doctors",
      "full_name",
      "TEXT"
    ],
    [
      "doctors",
      "specialty",
      "TEXT"
    ],
    [
      "doctors",
      "area",
      "TEXT"
    ],
    [
      "doctors",
      "phone",
      "TEXT"
    ],
    [
      "doctors",
      "email",
      "TEXT"
    ],
    [
      "doctors",
      "bio",
      "TEXT"
    ],
    [
      "doctors",
      "image_url",
      "TEXT"
    ],
    [
      "doctors",
      "rating",
      "NUMERIC(3,1) NOT NULL DEFAULT 5.0"
    ],
    [
      "doctors",
      "active",
      "BOOLEAN NOT NULL DEFAULT TRUE"
    ],
    [
      "doctors",
      "created_at",
      "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    ],
    [
      "doctors",
      "updated_at",
      "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    ],

    /* APPOINTMENTS */
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
      "appointment_date",
      "DATE"
    ],
    [
      "appointments",
      "appointment_time",
      "TIME"
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
      "created_at",
      "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    ],
    [
      "appointments",
      "updated_at",
      "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    ],

    /* MEDICAL RECORDS */
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
      "created_at",
      "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    ],
    [
      "medical_records",
      "updated_at",
      "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    ],

    /* ADS */
    [
      "ads",
      "title",
      "TEXT"
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
```

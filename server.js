```js
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

const PUBLIC_DIR = path.join(__dirname, "public");

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(express.static(PUBLIC_DIR));

/* =========================================================
   Helpers
========================================================= */

function makeId() {
  return crypto.randomUUID();
}

function randomToken() {
  return crypto.randomBytes(48).toString("hex");
}

function hashToken(token) {
  return crypto
    .createHash("sha256")
    .update(String(token))
    .digest("hex");
}

function clean(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const result = String(value).trim();

  return result === "" ? null : result;
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function validDate(value) {
  if (!value) return false;

  return /^\d{4}-\d{2}-\d{2}$/.test(String(value));
}

function validTime(value) {
  if (!value) return false;

  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(value));
}

function jsonOk(res, data = {}) {
  return res.json({
    ok: true,
    ...data
  });
}

function jsonError(res, message, status = 400) {
  return res.status(status).json({
    ok: false,
    error: message
  });
}

/* =========================================================
   Password hashing
========================================================= */

async function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");

    crypto.scrypt(
      String(password),
      salt,
      64,
      (err, derivedKey) => {
        if (err) {
          return reject(err);
        }

        resolve(
          `${salt}:${derivedKey.toString("hex")}`
        );
      }
    );
  });
}

async function verifyPassword(password, storedHash) {
  if (!storedHash) {
    return false;
  }

  const parts = String(storedHash).split(":");

  if (parts.length !== 2) {
    return false;
  }

  const salt = parts[0];
  const stored = Buffer.from(parts[1], "hex");

  return new Promise((resolve, reject) => {
    crypto.scrypt(
      String(password),
      salt,
      stored.length,
      (err, derivedKey) => {
        if (err) {
          return reject(err);
        }

        if (derivedKey.length !== stored.length) {
          return resolve(false);
        }

        resolve(
          crypto.timingSafeEqual(
            derivedKey,
            stored
          )
        );
      }
    );
  });
}

/* =========================================================
   Database helpers
========================================================= */

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

async function addColumnIfMissing(
  tableName,
  columnName,
  definition
) {
  const exists = await columnExists(
    tableName,
    columnName
  );

  if (!exists) {
    await pool.query(
      `ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${definition}`
    );

    console.log(
      `Added missing column ${tableName}.${columnName}`
    );
  }
}

/* =========================================================
   Database initialization
========================================================= */

async function initDatabase() {
  console.log("Initializing Neon database...");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'patient',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS patients (
      id UUID PRIMARY KEY,
      user_id UUID,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      gender TEXT,
      birth_date DATE,
      address TEXT,
      emergency_contact TEXT,
      notes TEXT,
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
      full_name TEXT,
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
      name TEXT NOT NULL,
      description TEXT,
      duration_minutes INTEGER DEFAULT 30,
      price NUMERIC(12,2) DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id UUID PRIMARY KEY,
      patient_id UUID,
      doctor_id UUID,
      service_id UUID,
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
      patient_id UUID,
      doctor_id UUID,
      appointment_id UUID,
      diagnosis TEXT,
      treatment TEXT,
      prescription TEXT,
      notes TEXT,
      record_date DATE NOT NULL DEFAULT CURRENT_DATE,
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
      ad_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_clicks (
      id UUID PRIMARY KEY,
      ad_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  /* =======================================================
     Compatibility with old database schemas
  ======================================================= */

  await addColumnIfMissing(
    "users",
    "updated_at",
    "TIMESTAMPTZ DEFAULT NOW()"
  );

  await addColumnIfMissing(
    "users",
    "active",
    "BOOLEAN DEFAULT TRUE"
  );

  await addColumnIfMissing(
    "patients",
    "updated_at",
    "TIMESTAMPTZ DEFAULT NOW()"
  );

  await addColumnIfMissing(
    "patients",
    "active",
    "BOOLEAN DEFAULT TRUE"
  );

  await addColumnIfMissing(
    "staff_users",
    "updated_at",
    "TIMESTAMPTZ DEFAULT NOW()"
  );

  await addColumnIfMissing(
    "staff_users",
    "full_name",
    "TEXT"
  );

  await addColumnIfMissing(
    "staff_users",
    "role",
    "TEXT DEFAULT 'staff'"
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
    "active",
    "BOOLEAN DEFAULT TRUE"
  );

  await addColumnIfMissing(
    "services",
    "description",
    "TEXT"
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
    "services",
    "updated_at",
    "TIMESTAMPTZ DEFAULT NOW()"
  );

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
    "appointments",
    "updated_at",
    "TIMESTAMPTZ DEFAULT NOW()"
  );

  await addColumnIfMissing(
    "medical_records",
    "patient_id",
    "UUID"
  );

  await addColumnIfMissing(
    "medical_records",
    "doctor_id",
    "UUID"
  );

  await addColumnIfMissing(
    "medical_records",
```

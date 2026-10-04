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

/* =========================================================
   EXPRESS
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
  express.static(PUBLIC_DIR)
);

/* =========================================================
   HELPERS
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
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const result = String(value).trim();

  return result === ""
    ? null
    : result;
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(
    String(value || "")
  );
}

function validTime(value) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(
    String(value || "")
  );
}

function jsonOk(res, data) {
  return res.json({
    ok: true,
    ...(data || {})
  });
}

function jsonError(
  res,
  message,
  status
) {
  return res.status(status || 400).json({
    ok: false,
    error: message
  });
}

/* =========================================================
   PASSWORD
========================================================= */

async function hashPassword(password) {
  return new Promise(
    (resolve, reject) => {
      const salt =
        crypto
          .randomBytes(16)
          .toString("hex");

      crypto.scrypt(
        String(password),
        salt,
        64,
        function (err, derivedKey) {
          if (err) {
            return reject(err);
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

async function verifyPassword(
  password,
  storedHash
) {
  if (!storedHash) {
    return false;
  }

  const parts =
    String(storedHash).split(":");

  if (parts.length !== 2) {
    return false;
  }

  const salt = parts[0];

  const stored =
    Buffer.from(parts[1], "hex");

  return new Promise(
    (resolve, reject) => {
      crypto.scrypt(
        String(password),
        salt,
        stored.length,
        function (err, derivedKey) {
          if (err) {
            return reject(err);
          }

          if (
            derivedKey.length !==
            stored.length
          ) {
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
    }
  );
}

/* =========================================================
   DATABASE HELPERS
========================================================= */

async function columnExists(
  tableName,
  columnName
) {
  const result =
    await pool.query(
      `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
      LIMIT 1
      `,
      [
        tableName,
        columnName
      ]
    );

  return result.rowCount > 0;
}

async function addColumnIfMissing(
  tableName,
  columnName,
  definition
) {
  const exists =
    await columnExists(
      tableName,
      columnName
    );

  if (!exists) {
    await pool.query(
      'ALTER TABLE "' +
        tableName +
        '" ADD COLUMN "' +
        columnName +
        '" ' +
        definition
    );

    console.log(
      "Added missing column " +
        tableName +
        "." +
        columnName
    );
  }
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

  /* PATIENTS */

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

  /* STAFF */

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
      updated_at TIMESTAMP_
```

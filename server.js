const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();

const PORT = Number(process.env.PORT || 10000);
const DATABASE_URL = process.env.DATABASE_URL;
const PUBLIC_DIR = path.join(__dirname, "public");

if (!DATABASE_URL) {
  console.error("DATABASE_URL is not configured.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(express.static(PUBLIC_DIR));

/* =========================================================
   Helpers
========================================================= */

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || "").trim();
}

function hashPassword(password) {
  return crypto
    .createHash("sha256")
    .update(String(password || ""))
    .digest("hex");
}

function generateId() {
  return crypto.randomUUID();
}

function jsonError(res, status, message) {
  return res.status(status).json({
    ok: false,
    message,
  });
}

function jsonSuccess(res, data = {}) {
  return res.json({
    ok: true,
    ...data,
  });
}

function isValidDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime());
}

function isValidTime(value) {
  return (
    typeof value === "string" &&
    /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/.test(value)
  );
}

function timeToMinutes(value) {
  if (!value) return null;

  const parts = String(value).split(":").map(Number);

  const hours = parts[0];
  const minutes = parts[1];

  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return hours * 60 + minutes;
}

function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(
    2,
    "0"
  )}`;
}

function getDayOfWeek(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  return date.getDay();
}

function getTodayString() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/* =========================================================
   Database initialization
========================================================= */

async function ensureDatabase() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /* Users */
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        full_name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'patient',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    /* Patients */
    await client.query(`
      CREATE TABLE IF NOT EXISTS patients (
        id UUID PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        full_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT,
        gender TEXT,
        date_of_birth DATE,
        address TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    /* Doctors */
    await client.query(`
      CREATE TABLE IF NOT EXISTS doctors (
        id UUID PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        full_name TEXT NOT NULL,
        specialty TEXT,
        area TEXT,
        experience_years INTEGER DEFAULT 0,
        clinic_name TEXT,
        clinic_address TEXT,
        phone TEXT,
        consultation_fee NUMERIC(12,2) DEFAULT 0,
        image_url TEXT,
        bio TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    /* Services */
    await client.query(`
      CREATE TABLE IF NOT EXISTS services (
        id UUID PRIMARY KEY,
        doctor_id UUID REFERENCES doctors(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        duration_minutes INTEGER DEFAULT 30,
        price NUMERIC(12,2) DEFAULT 0,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    /* Appointments */
    await client.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id UUID PRIMARY KEY,
        patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
        doctor_id UUID REFERENCES doctors(id) ON DELETE CASCADE,
        service_id UUID REFERENCES services(id) ON DELETE SET NULL,
        appointment_date DATE NOT NULL,
        appointment_time TIME NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        payment_method TEXT DEFAULT 'clinic',
        payment_status TEXT DEFAULT 'unpaid',
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    /* Medical records */
    await client.query(`
      CREATE TABLE IF NOT EXISTS medical_records (
        id UUID PRIMARY KEY,
        patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
        doctor_id UUID REFERENCES doctors(id) ON DELETE SET NULL,
        appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
        diagnosis TEXT,
        notes TEXT,
        prescription TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    /* Ads */
    await client.query(`
      CREATE TABLE IF NOT EXISTS ads (
        id UUID PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        image_url TEXT,
        link_url TEXT,
        advertiser_name TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        start_date DATE,
        end_date DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    /* Doctor schedules */
    await client.query(`
      CREATE TABLE IF NOT EXISTS doctor_schedules (
        id UUID PRIMARY KEY,
        doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
        day_of_week INTEGER NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        slot_duration_minutes INTEGER NOT NULL DEFAULT 30,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT doctor_schedule_day_check
          CHECK (day_of_week >= 0 AND day_of_week <= 6),

        CONSTRAINT doctor_schedule_time_check
          CHECK (start_time < end_time),

        CONSTRAINT doctor_schedule_duration_check
          CHECK (slot_duration_minutes > 0)
      )
    `);

    /* Indexes */
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_doctors_specialty
      ON doctors(specialty)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_doctors_area
      ON doctors(area)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_appointments_doctor_date
      ON appointments(doctor_id, appointment_date)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_appointments_patient
      ON appointments(patient_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_doctor_schedules_doctor
      ON doctor_schedules(doctor_id)
    `);

    /* Default admin */
    const adminUsername = process.env.ADMIN_USERNAME || "admin";
    const adminPassword = process.env.ADMIN_PASSWORD || "admin123";

    const existingAdmin = await client.query(
      `
      SELECT id
      FROM users
      WHERE role = 'admin'
      LIMIT 1
      `
    );

    if (existingAdmin.rowCount === 0) {
      await client.query(
        `
        INSERT INTO users (
          id,
          full_name,
          phone,
          email,
          password_hash,
          role,
          active
        )
        VALUES ($1,$2,$3,$4,$5,'admin',TRUE)
        `,
        [
          generateId(),
          "مدير النظام",
          "",
          adminUsername,
          hashPassword(adminPassword),
        ]
      );

      console.log(
        `Default admin created. Username: ${adminUsername}`
      );
    }

    await client.query("COMMIT");

    console.log("Database initialized successfully.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Database initialization error:", error);
    throw error;
  } finally {
    client.release();
  }
}

/* =========================================================
   Health
========================================================= */

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT NOW()");

    return res.json({
      ok: true,
      database: "postgresql",
      postgres: true,
      cms: true,
      features: {
        homepage: true,
        doctors: true,
        patients: true,
        services: true,
        appointments: true,
        doctorSchedules: true,
        availableSlots: true,
        medicalRecords: true,
        ads: true,
        payments: true,
        admin: true,
      },
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      ok: false,
      database: "error",
      message: "Database connection failed",
    });
  }
});

/* =========================================================
   Authentication
========================================================= */

app.post("/api/auth/register", async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      full_name,
      phone,
      email,
      password,
    } = req.body;

    if (!full_name || !phone || !password) {
      return jsonError(
        res,
        400,
        "الاسم ورقم الهاتف وكلمة المرور مطلوبة"
      );
    }

    if (String(password).length < 4) {
      return jsonError(
        res,
        400,
        "كلمة المرور يجب ألا تقل عن 4 أحرف"
      );
    }

    const existing = await client.query(
      `
      SELECT id
      FROM users
      WHERE phone = $1
         OR ($2 <> '' AND LOWER(COALESCE(email,'')) = LOWER($2))
      LIMIT 1
      `,
      [normalizePhone(phone), normalizeEmail(email)]
    );

    if (existing.rowCount > 0) {
      return jsonError(
        res,
        409,
        "رقم الهاتف أو البريد الإلكتروني مستخدم بالفعل"
      );
    }

    await client.query("BEGIN");

    const userId = generateId();
    const patientId = generateId();

    await client.query(
      `
      INSERT INTO users (
        id,
        full_name,
        phone,
        email,
        password_hash,
        role,
        active
      )
      VALUES ($1,$2,$3,$4,$5,'patient',TRUE)
      `,
      [
        userId,
        full_name,
        normalizePhone(phone),
        normalizeEmail(email),
        hashPassword(password),
      ]
    );

    await client.query(
      `
      INSERT INTO patients (
        id,
        user_id,
        full_name,
        phone,
        email
      )
      VALUES ($1,$2,$3,$4,$5)
      `,
      [
        patientId,
        userId,
        full_name,
        normalizePhone(phone),
        normalizeEmail(email),
      ]
    );

    await client.query("COMMIT");

    return jsonSuccess(res, {
      message: "تم إنشاء الحساب بنجاح",
      user: {
        id: userId,
        patient_id: patientId,
        full_name,
        phone,
        email: normalizeEmail(email),
        role: "patient",
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Register error:", error);

    return jsonError(
      res,
      500,
      "حدث خطأ أثناء إنشاء الحساب"
    );
  } finally {
    client.release();
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const {
      login,
      password,
    } = req.body;

    if (!login || !password) {
      return jsonError(
        res,
        400,
        "بيانات تسجيل الدخول مطلوبة"
      );
    }

    const result = await pool.query(
      `
      SELECT
        id,
        full_name,
        phone,
        email,
        role,
        active
      FROM users
      WHERE
        (LOWER(COALESCE(email,'')) = LOWER($1)
        OR phone = $1)
        AND password_hash = $2
      LIMIT 1
      `,
      [
        String(login).trim(),
        hashPassword(password),
      ]
    );

    if (result.rowCount === 0) {
      return jsonError(
        res,
        401,
        "بيانات تسجيل الدخول غير صحيحة"
      );
    }

    const user = result.rows[0];

    if (!user.active) {
      return jsonError(
        res,
        403,
        "هذا الحساب غير مفعل"
      );
    }

    let patient = null;
    let doctor = null;

    if (user.role === "patient") {
      const patientResult = await pool.query(
        `
        SELECT *
        FROM patients
        WHERE user_id = $1
        LIMIT 1
        `,
        [user.id]
      );

      patient = patientResult.rows[0] || null;
    }

    if (
      user.role === "doctor" ||
      user.role === "secretary"
    ) {
      const doctorResult = await pool.query(
        `
        SELECT *
        FROM doctors
        WHERE user_id = $1
        LIMIT 1
        `,
        [user.id]
      );

      doctor = doctorResult.rows[0] || null;
    }

    return jsonSuccess(res, {
      message: "تم تسجيل الدخول",
      user,
      patient,
      doctor,
    });
  } catch (error) {
    console.error("Login error:", error);

    return jsonError(
      res,
      500,
      "حدث خطأ أثناء تسجيل الدخول"
    );
  }
});

/* =========================================================
   Public doctors
========================================================= */

app.get("/api/doctors", async (req, res) => {
  try {
    const {
      specialty,
      area,
      name,
      search,
    } = req.query;

    const conditions = ["d.active = TRUE"];
    const values = [];

    if (specialty) {
      values.push(`%${specialty}%`);
      conditions.push(
        `d.specialty ILIKE $${values.length}`
      );
    }

    if (area) {
      values.push(`%${area}%`);
      conditions.push(
        `d.area ILIKE $${values.length}`
      );
    }

    if (name) {
      values.push(`%${name}%`);
      conditions.push(
        `d.full_name ILIKE $${values.length}`
      );
    }

    if (search) {
      values.push(`%${search}%`);
      const index = values.length;

      conditions.push(`
        (
          d.full_name ILIKE $${index}
          OR d.specialty ILIKE $${index}
          OR d.area ILIKE $${index}
          OR d.clinic_name ILIKE $${index}
        )
      `);
    }

    const result = await pool.query(
      `
      SELECT
        d.*,
        COUNT(DISTINCT s.id)::INTEGER AS services_count,
        COUNT(DISTINCT ds.id)::INTEGER AS schedule_count
      FROM doctors d
      LEFT JOIN services s
        ON s.doctor_id = d.id
        AND s.active = TRUE
      LEFT JOIN doctor_schedules ds
        ON ds.doctor_id = d.id
        AND ds.active = TRUE
      WHERE ${conditions.join(" AND ")}
      GROUP BY d.id
      ORDER BY d.full_name ASC
      `,
      values
    );

    return res.json({
      ok: true,
      doctors: result.rows,
    });
  } catch (error) {
    console.error("Doctors error:", error);

    return jsonError(
      res,
      500,
      "تعذر تحميل الأطباء"
    );
  }
});

/* =========================================================
   Doctor details
========================================================= */

app.get("/api/doctors/:id", async (req, res) => {
  try {
    const doctorResult = await pool.query(
      `
      SELECT *
      FROM doctors
      WHERE id = $1
      LIMIT 1
      `,
      [req.params.id]
    );

    if (doctorResult.rowCount === 0) {
      return jsonError(
        res,
        404,
        "الطبيب غير موجود"
      );
    }

    const servicesResult = await pool.query(
      `
      SELECT *
      FROM services
      WHERE doctor_id = $1
        AND active = TRUE
      ORDER BY name
      `,
      [req.params.id]
    );

    const schedulesResult = await pool.query(
      `
      SELECT *
      FROM doctor_schedules
      WHERE doctor_id = $1
        AND active = TRUE
      ORDER BY day_of_week, start_time
      `,
      [req.params.id]
    );

    return res.json({
      ok: true,
      doctor: doctorResult.rows[0],
      services: servicesResult.rows,
      schedules: schedulesResult.rows,
    });
  } catch (error) {
    console.error("Doctor details error:", error);

    return jsonError(
      res,
      500,
      "تعذر تحميل بيانات الطبيب"
    );
  }
});

/* =========================================================
   Doctor schedules
========================================================= */

async function getDoctorScheduleForDate(
  doctorId,
  dateString
) {
  const dayOfWeek = getDayOfWeek(dateString);

  const result = await pool.query(
    `
    SELECT *
    FROM doctor_schedules
    WHERE doctor_id = $1
      AND day_of_week = $2
      AND active = TRUE
    ORDER BY start_time
    `,
    [
      doctorId,
      dayOfWeek,
    ]
  );

  return result.rows;
}

async function getBookedTimes(
  doctorId,
  dateString
) {
  const result = await pool.query(
    `
    SELECT
      appointment_time,
      status
    FROM appointments
    WHERE doctor_id = $1
      AND appointment_date = $2
      AND status NOT IN ('cancelled', 'rejected')
    `,
    [
      doctorId,
      dateString,
    ]
  );

  return result.rows.map((row) => {
    const time = String(row.appointment_time);

    return time.substring(0, 5);
  });
}

function generateAvailableSlots(
  schedules,
  bookedTimes
) {
  const booked = new Set(bookedTimes);

  const slots = [];

  for (const schedule of schedules) {
    const start = timeToMinutes(
      String(schedule.start_time).substring(0, 5)
    );

    const end = timeToMinutes(
      String(schedule.end_time).substring(0, 5)
    );

    const duration =
      Number(schedule.slot_duration_minutes) || 30;

    if (
      start === null ||
      end === null ||
      end <= start ||
      duration <= 0
    ) {
      continue;
    }

    for (
      let current = start;
      current + duration <= end;
      current += duration
    ) {
      const time = minutesToTime(current);

      slots.push({
        time,
        available: !booked.has(time),
      });
    }
  }

  return slots;
}

function isAppointmentTimeAvailable(
  schedules,
  appointmentTime
) {
  const selectedMinutes =
    timeToMinutes(appointmentTime);

  if (selectedMinutes === null) {
    return false;
  }

  return schedules.some((schedule) => {
    const start = timeToMinutes(
      String(schedule.start_time).substring(0, 5)
    );

    const end = timeToMinutes(
      String(schedule.end_time).substring(0, 5)
    );

    const duration =
      Number(schedule.slot_duration_minutes) || 30;

    if (
      start === null ||
      end === null ||
      duration <= 0
    ) {
      return false;
    }

    if (
      selectedMinutes < start ||
      selectedMinutes + duration > end
    ) {
      return false;
    }

    const difference =
      selectedMinutes - start;

    return difference % duration === 0;
  });
}

/* =========================================================
   Public doctor schedule
========================================================= */

app.get(
  "/api/doctors/:id/schedule",
  async (req, res) => {
    try {
      const doctorResult = await pool.query(
        `
        SELECT id, full_name, specialty
        FROM doctors
        WHERE id = $1
          AND active = TRUE
        LIMIT 1
        `,
        [req.params.id]
      );

      if (doctorResult.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الطبيب غير موجود"
        );
      }

      const result = await pool.query(
        `
        SELECT *
        FROM doctor_schedules
        WHERE doctor_id = $1
          AND active = TRUE
        ORDER BY day_of_week, start_time
        `,
        [req.params.id]
      );

      return res.json({
        ok: true,
        doctor: doctorResult.rows[0],
        schedules: result.rows,
      });
    } catch (error) {
      console.error("Schedule error:", error);

      return jsonError(
        res,
        500,
        "تعذر تحميل دوام الطبيب"
      );
    }
  }
);

/* =========================================================
   Available appointment slots
========================================================= */

app.get(
  "/api/doctors/:id/available-slots",
  async (req, res) => {
    try {
      const {
        date,
      } = req.query;

      if (!isValidDate(date)) {
        return jsonError(
          res,
          400,
          "يرجى اختيار تاريخ صحيح"
        );
      }

      const doctorResult = await pool.query(
        `
        SELECT id, full_name, specialty
        FROM doctors
        WHERE id = $1
          AND active = TRUE
        LIMIT 1
        `,
        [req.params.id]
      );

      if (doctorResult.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الطبيب غير موجود"
        );
      }

      const schedules =
        await getDoctorScheduleForDate(
          req.params.id,
          date
        );

      const bookedTimes =
        await getBookedTimes(
          req.params.id,
          date
        );

      const slots =
        generateAvailableSlots(
          schedules,
          bookedTimes
        );

      return res.json({
        ok: true,
        date,
        doctor: doctorResult.rows[0],
        day_of_week: getDayOfWeek(date),
        working: schedules.length > 0,
        schedules,
        booked_times: bookedTimes,
        slots,
        available_slots: slots
          .filter((slot) => slot.available)
          .map((slot) => slot.time),
      });
    } catch (error) {
      console.error(
        "Available slots error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر تحميل المواعيد المتاحة"
      );
    }
  }
);

/* =========================================================
   Services
========================================================= */

app.get("/api/services", async (req, res) => {
  try {
    const {
      doctor_id,
    } = req.query;

    const values = [];
    let where = "s.active = TRUE";

    if (doctor_id) {
      values.push(doctor_id);
      where += ` AND s.doctor_id = $${values.length}`;
    }

    const result = await pool.query(
      `
      SELECT
        s.*,
        d.full_name AS doctor_name,
        d.specialty
      FROM services s
      JOIN doctors d
        ON d.id = s.doctor_id
      WHERE ${where}
      ORDER BY s.name
      `,
      values
    );

    return res.json({
      ok: true,
      services: result.rows,
    });
  } catch (error) {
    console.error("Services error:", error);

    return jsonError(
      res,
      500,
      "تعذر تحميل الخدمات"
    );
  }
});

/* =========================================================
   Create appointment
========================================================= */

app.post(
  "/api/appointments",
  async (req, res) => {
    const client = await pool.connect();

    try {
      const {
        patient_id,
        doctor_id,
        service_id,
        appointment_date,
        appointment_time,
        payment_method,
        notes,
      } = req.body;

      if (
        !patient_id ||
        !doctor_id ||
        !appointment_date ||
        !appointment_time
      ) {
        return jsonError(
          res,
          400,
          "بيانات الحجز الأساسية ناقصة"
        );
      }

      if (!isValidDate(appointment_date)) {
        return jsonError(
          res,
          400,
          "تاريخ الموعد غير صحيح"
        );
      }

      if (!isValidTime(appointment_time)) {
        return jsonError(
          res,
          400,
          "وقت الموعد غير صحيح"
        );
      }

      const doctorResult = await client.query(
        `
        SELECT *
        FROM doctors
        WHERE id = $1
          AND active = TRUE
        LIMIT 1
        `,
        [doctor_id]
      );

      if (doctorResult.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الطبيب غير موجود أو غير متاح"
        );
      }

      if (service_id) {
        const serviceResult =
          await client.query(
            `
            SELECT *
            FROM services
            WHERE id = $1
              AND doctor_id = $2
              AND active = TRUE
            LIMIT 1
            `,
            [
              service_id,
              doctor_id,
            ]
          );

        if (serviceResult.rowCount === 0) {
          return jsonError(
            res,
            400,
            "الخدمة المختارة غير متاحة لهذا الطبيب"
          );
        }
      }

      const patientResult = await client.query(
        `
        SELECT *
        FROM patients
        WHERE id = $1
        LIMIT 1
        `,
        [patient_id]
      );

      if (patientResult.rowCount === 0) {
        return jsonError(
          res,
          404,
          "المريض غير موجود"
        );
      }

      const schedules =
        await getDoctorScheduleForDate(
          doctor_id,
          appointment_date
        );

      if (schedules.length === 0) {
        return jsonError(
          res,
          400,
          "الطبيب لا يعمل في هذا اليوم"
        );
      }

      const timeAvailable =
        isAppointmentTimeAvailable(
          schedules,
          appointment_time
        );

      if (!timeAvailable) {
        return jsonError(
          res,
          409,
          "وقت الموعد خارج دوام الطبيب أو غير مطابق لفترات الحجز"
        );
      }

      await client.query("BEGIN");

      /*
       * Lock the doctor row while checking the appointment.
       * This reduces the possibility of two patients booking
       * the same slot simultaneously.
       */
      await client.query(
        `
        SELECT id
        FROM doctors
        WHERE id = $1
        FOR UPDATE
        `,
        [doctor_id]
      );

      const bookedResult = await client.query(
        `
        SELECT id
        FROM appointments
        WHERE doctor_id = $1
          AND appointment_date = $2
          AND appointment_time = $3
          AND status NOT IN ('cancelled', 'rejected')
        LIMIT 1
        `,
        [
          doctor_id,
          appointment_date,
          appointment_time,
        ]
      );

      if (bookedResult.rowCount > 0) {
        await client.query("ROLLBACK");

        return jsonError(
          res,
          409,
          "هذا الموعد تم حجزه بالفعل، يرجى اختيار موعد آخر"
        );
      }

      const patientConflict =
        await client.query(
          `
          SELECT id
          FROM appointments
          WHERE patient_id = $1
            AND appointment_date = $2
            AND appointment_time = $3
            AND status NOT IN ('cancelled', 'rejected')
          LIMIT 1
          `,
          [
            patient_id,
            appointment_date,
            appointment_time,
          ]
        );

      if (patientConflict.rowCount > 0) {
        await client.query("ROLLBACK");

        return jsonError(
          res,
          409,
          "لديك حجز آخر في نفس الوقت"
        );
      }

      const appointmentId = generateId();

      const result = await client.query(
        `
        INSERT INTO appointments (
          id,
          patient_id,
          doctor_id,
          service_id,
          appointment_date,
          appointment_time,
          status,
          payment_method,
          payment_status,
          notes
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,
          'pending',
          $7,
          'unpaid',
          $8
        )
        RETURNING *
        `,
        [
          appointmentId,
          patient_id,
          doctor_id,
          service_id || null,
          appointment_date,
          appointment_time,
          payment_method || "clinic",
          notes || "",
        ]
      );

      await client.query("COMMIT");

      return jsonSuccess(res, {
        message: "تم إرسال طلب الحجز بنجاح",
        appointment: result.rows[0],
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(
        "Create appointment error:",
        error
      );

      return jsonError(
        res,
        500,
        "حدث خطأ أثناء إنشاء الحجز"
      );
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   Patient appointments
========================================================= */

app.get(
  "/api/patients/:id/appointments",
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          a.*,
          d.full_name AS doctor_name,
          d.specialty,
          d.clinic_name,
          d.clinic_address,
          s.name AS service_name,
          s.price AS service_price
        FROM appointments a
        JOIN doctors d
          ON d.id = a.doctor_id
        LEFT JOIN services s
          ON s.id = a.service_id
        WHERE a.patient_id = $1
        ORDER BY
          a.appointment_date DESC,
          a.appointment_time DESC
        `,
        [req.params.id]
      );

      return res.json({
        ok: true,
        appointments: result.rows,
      });
    } catch (error) {
      console.error(
        "Patient appointments error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر تحميل حجوزات المريض"
      );
    }
  }
);

/* =========================================================
   Appointment details
========================================================= */

app.get(
  "/api/appointments/:id",
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          a.*,

          p.full_name AS patient_name,
          p.phone AS patient_phone,

          d.full_name AS doctor_name,
          d.specialty,
          d.clinic_name,
          d.clinic_address,
          d.phone AS doctor_phone,

          s.name AS service_name,
          s.description AS service_description,
          s.price AS service_price,
          s.duration_minutes
        FROM appointments a

        JOIN patients p
          ON p.id = a.patient_id

        JOIN doctors d
          ON d.id = a.doctor_id

        LEFT JOIN services s
          ON s.id = a.service_id

        WHERE a.id = $1
        LIMIT 1
        `,
        [req.params.id]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الحجز غير موجود"
        );
      }

      return jsonSuccess(res, {
        appointment: result.rows[0],
      });
    } catch (error) {
      console.error(
        "Appointment details error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر تحميل بيانات الحجز"
      );
    }
  }
);

/* =========================================================
   Cancel appointment
========================================================= */

app.patch(
  "/api/appointments/:id/cancel",
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        UPDATE appointments
        SET
          status = 'cancelled',
          updated_at = NOW()
        WHERE id = $1
          AND status NOT IN ('cancelled', 'completed')
        RETURNING *
        `,
        [req.params.id]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          404,
          "لا يمكن إلغاء هذا الحجز"
        );
      }

      return jsonSuccess(res, {
        message: "تم إلغاء الحجز",
        appointment: result.rows[0],
      });
    } catch (error) {
      console.error(
        "Cancel appointment error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر إلغاء الحجز"
      );
    }
  }
);

/* =========================================================
   Admin middleware
========================================================= */

async function requireStaff(req, res, next) {
  try {
    const userId =
      req.headers["x-user-id"];

    if (!userId) {
      return jsonError(
        res,
        401,
        "يجب تسجيل الدخول"
      );
    }

    const result = await pool.query(
      `
      SELECT id, full_name, role, active
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (result.rowCount === 0) {
      return jsonError(
        res,
        401,
        "المستخدم غير موجود"
      );
    }

    const user = result.rows[0];

    if (!user.active) {
      return jsonError(
        res,
        403,
        "الحساب غير مفعل"
      );
    }

    if (
      !["admin", "doctor", "secretary"].includes(
        user.role
      )
    ) {
      return jsonError(
        res,
        403,
        "ليس لديك صلاحية"
      );
    }

    req.staffUser = user;

    next();
  } catch (error) {
    console.error(
      "Staff middleware error:",
      error
    );

    return jsonError(
      res,
      500,
      "خطأ في التحقق من الصلاحيات"
    );
  }
}

/* =========================================================
   Admin doctors
========================================================= */

app.get(
  "/api/admin/doctors",
  requireStaff,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          d.*,
          u.email,
          u.role,
          COUNT(DISTINCT s.id)::INTEGER
            AS services_count,
          COUNT(DISTINCT ds.id)::INTEGER
            AS schedule_count
        FROM doctors d

        LEFT JOIN users u
          ON u.id = d.user_id

        LEFT JOIN services s
          ON s.doctor_id = d.id

        LEFT JOIN doctor_schedules ds
          ON ds.doctor_id = d.id
          AND ds.active = TRUE

        GROUP BY
          d.id,
          u.email,
          u.role

        ORDER BY d.created_at DESC
        `
      );

      return res.json({
        ok: true,
        doctors: result.rows,
      });
    } catch (error) {
      console.error(
        "Admin doctors error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر تحميل قائمة الأطباء"
      );
    }
  }
);

/* =========================================================
   Admin doctor schedules
========================================================= */

app.get(
  "/api/admin/doctors/:id/schedules",
  requireStaff,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT *
        FROM doctor_schedules
        WHERE doctor_id = $1
        ORDER BY day_of_week, start_time
        `,
        [req.params.id]
      );

      return res.json({
        ok: true,
        schedules: result.rows,
      });
    } catch (error) {
      console.error(
        "Admin schedules error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر تحميل دوام الطبيب"
      );
    }
  }
);

/* =========================================================
   Add doctor schedule
========================================================= */

app.post(
  "/api/admin/doctors/:id/schedules",
  requireStaff,
  async (req, res) => {
    try {
      const {
        day_of_week,
        start_time,
        end_time,
        slot_duration_minutes,
        active,
      } = req.body;

      const day =
        Number(day_of_week);

      const duration =
        Number(slot_duration_minutes || 30);

      if (
        !Number.isInteger(day) ||
        day < 0 ||
        day > 6
      ) {
        return jsonError(
          res,
          400,
          "يوم الأسبوع غير صحيح"
        );
      }

      if (
        !isValidTime(start_time) ||
        !isValidTime(end_time)
      ) {
        return jsonError(
          res,
          400,
          "وقت بداية أو نهاية الدوام غير صحيح"
        );
      }

      const start =
        timeToMinutes(start_time);

      const end =
        timeToMinutes(end_time);

      if (
        start === null ||
        end === null ||
        start >= end
      ) {
        return jsonError(
          res,
          400,
          "وقت بداية الدوام يجب أن يكون قبل وقت النهاية"
        );
      }

      if (
        !Number.isInteger(duration) ||
        duration <= 0
      ) {
        return jsonError(
          res,
          400,
          "مدة الموعد غير صحيحة"
        );
      }

      const doctorResult =
        await pool.query(
          `
          SELECT id
          FROM doctors
          WHERE id = $1
          LIMIT 1
          `,
          [req.params.id]
        );

      if (doctorResult.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الطبيب غير موجود"
        );
      }

      const result = await pool.query(
        `
        INSERT INTO doctor_schedules (
          id,
          doctor_id,
          day_of_week,
          start_time,
          end_time,
          slot_duration_minutes,
          active
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING *
        `,
        [
          generateId(),
          req.params.id,
          day,
          start_time,
          end_time,
          duration,
          active !== false,
        ]
      );

      return jsonSuccess(res, {
        message: "تم إضافة فترة الدوام",
        schedule: result.rows[0],
      });
    } catch (error) {
      console.error(
        "Add schedule error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر إضافة فترة الدوام"
      );
    }
  }
);

/* =========================================================
   Update doctor schedule
========================================================= */

app.put(
  "/api/admin/doctor-schedules/:id",
  requireStaff,
  async (req, res) => {
    try {
      const {
        day_of_week,
        start_time,
        end_time,
        slot_duration_minutes,
        active,
      } = req.body;

      const day =
        Number(day_of_week);

      const duration =
        Number(slot_duration_minutes || 30);

      if (
        !Number.isInteger(day) ||
        day < 0 ||
        day > 6
      ) {
        return jsonError(
          res,
          400,
          "يوم الأسبوع غير صحيح"
        );
      }

      if (
        !isValidTime(start_time) ||
        !isValidTime(end_time)
      ) {
        return jsonError(
          res,
          400,
          "وقت الدوام غير صحيح"
        );
      }

      const start =
        timeToMinutes(start_time);

      const end =
        timeToMinutes(end_time);

      if (start >= end) {
        return jsonError(
          res,
          400,
          "بداية الدوام يجب أن تكون قبل النهاية"
        );
      }

      if (
        !Number.isInteger(duration) ||
        duration <= 0
      ) {
        return jsonError(
          res,
          400,
          "مدة الموعد غير صحيحة"
        );
      }

      const result = await pool.query(
        `
        UPDATE doctor_schedules
        SET
          day_of_week = $1,
          start_time = $2,
          end_time = $3,
          slot_duration_minutes = $4,
          active = $5
        WHERE id = $6
        RETURNING *
        `,
        [
          day,
          start_time,
          end_time,
          duration,
          active !== false,
          req.params.id,
        ]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          404,
          "فترة الدوام غير موجودة"
        );
      }

      return jsonSuccess(res, {
        message: "تم تحديث فترة الدوام",
        schedule: result.rows[0],
      });
    } catch (error) {
      console.error(
        "Update schedule error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر تحديث فترة الدوام"
      );
    }
  }
);

/* =========================================================
   Change schedule status
========================================================= */

app.patch(
  "/api/admin/doctor-schedules/:id/status",
  requireStaff,
  async (req, res) => {
    try {
      const active =
        req.body.active !== false;

      const result = await pool.query(
        `
        UPDATE doctor_schedules
        SET active = $1
        WHERE id = $2
        RETURNING *
        `,
        [
          active,
          req.params.id,
        ]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          404,
          "فترة الدوام غير موجودة"
        );
      }

      return jsonSuccess(res, {
        message: active
          ? "تم تفعيل فترة الدوام"
          : "تم إيقاف فترة الدوام",
        schedule: result.rows[0],
      });
    } catch (error) {
      console.error(
        "Schedule status error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر تغيير حالة الدوام"
      );
    }
  }
);

/* =========================================================
   Delete doctor schedule
========================================================= */

app.delete(
  "/api/admin/doctor-schedules/:id",
  requireStaff,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        DELETE FROM doctor_schedules
        WHERE id = $1
        RETURNING id
        `,
        [req.params.id]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          404,
          "فترة الدوام غير موجودة"
        );
      }

      return jsonSuccess(res, {
        message: "تم حذف فترة الدوام",
      });
    } catch (error) {
      console.error(
        "Delete schedule error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر حذف فترة الدوام"
      );
    }
  }
);

/* =========================================================
   Admin appointments
========================================================= */

app.get(
  "/api/admin/appointments",
  requireStaff,
  async (req, res) => {
    try {
      const {
        date,
        status,
        doctor_id,
      } = req.query;

      const conditions = [];
      const values = [];

      if (date) {
        values.push(date);
        conditions.push(
          `a.appointment_date = $${values.length}`
        );
      }

      if (status) {
        values.push(status);
        conditions.push(
          `a.status = $${values.length}`
        );
      }

      if (doctor_id) {
        values.push(doctor_id);
        conditions.push(
          `a.doctor_id = $${values.length}`
        );
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

          d.full_name AS doctor_name,
          d.specialty,

          s.name AS service_name,
          s.price AS service_price

        FROM appointments a

        JOIN patients p
          ON p.id = a.patient_id

        JOIN doctors d
          ON d.id = a.doctor_id

        LEFT JOIN services s
          ON s.id = a.service_id

        ${where}

        ORDER BY
          a.appointment_date ASC,
          a.appointment_time ASC
        `,
        values
      );

      return res.json({
        ok: true,
        appointments: result.rows,
      });
    } catch (error) {
      console.error(
        "Admin appointments error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر تحميل الحجوزات"
      );
    }
  }
);

/* =========================================================
   Update appointment status
========================================================= */

app.patch(
  "/api/admin/appointments/:id/status",
  requireStaff,
  async (req, res) => {
    try {
      const {
        status,
      } = req.body;

      const allowed = [
        "pending",
        "confirmed",
        "cancelled",
        "rejected",
        "completed",
        "waiting",
      ];

      if (!allowed.includes(status)) {
        return jsonError(
          res,
          400,
          "حالة الحجز غير صحيحة"
        );
      }

      const result = await pool.query(
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
          req.params.id,
        ]
      );

      if (result.rowCount === 0) {
        return jsonError(
          res,
          404,
          "الحجز غير موجود"
        );
      }

      return jsonSuccess(res, {
        message: "تم تحديث حالة الحجز",
        appointment: result.rows[0],
      });
    } catch (error) {
      console.error(
        "Appointment status error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر تحديث حالة الحجز"
      );
    }
  }
);

/* =========================================================
   Medical records
========================================================= */

app.get(
  "/api/patients/:id/medical-records",
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          mr.*,
          d.full_name AS doctor_name,
          d.specialty
        FROM medical_records mr
        LEFT JOIN doctors d
          ON d.id = mr.doctor_id
        WHERE mr.patient_id = $1
        ORDER BY mr.created_at DESC
        `,
        [req.params.id]
      );

      return res.json({
        ok: true,
        records: result.rows,
      });
    } catch (error) {
      console.error(
        "Medical records error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر تحميل السجل الطبي"
      );
    }
  }
);

/* =========================================================
   Ads
========================================================= */

app.get("/api/ads", async (req, res) => {
  try {
    const today = getTodayString();

    const result = await pool.query(
      `
      SELECT *
      FROM ads
      WHERE active = TRUE
        AND (
          start_date IS NULL
          OR start_date <= $1
        )
        AND (
          end_date IS NULL
          OR end_date >= $1
        )
      ORDER BY created_at DESC
      `,
      [today]
    );

    return res.json({
      ok: true,
      ads: result.rows,
    });
  } catch (error) {
    console.error("Ads error:", error);

    return jsonError(
      res,
      500,
      "تعذر تحميل الإعلانات"
    );
  }
});

/* =========================================================
   Admin stats
========================================================= */

app.get(
  "/api/admin/stats",
  requireStaff,
  async (req, res) => {
    try {
      const [
        doctors,
        patients,
        appointments,
        pending,
        confirmed,
        schedules,
      ] = await Promise.all([
        pool.query(`
          SELECT COUNT(*)::INTEGER AS count
          FROM doctors
          WHERE active = TRUE
        `),

        pool.query(`
          SELECT COUNT(*)::INTEGER AS count
          FROM patients
        `),

        pool.query(`
          SELECT COUNT(*)::INTEGER AS count
          FROM appointments
        `),

        pool.query(`
          SELECT COUNT(*)::INTEGER AS count
          FROM appointments
          WHERE status = 'pending'
        `),

        pool.query(`
          SELECT COUNT(*)::INTEGER AS count
          FROM appointments
          WHERE status = 'confirmed'
        `),

        pool.query(`
          SELECT COUNT(*)::INTEGER AS count
          FROM doctor_schedules
          WHERE active = TRUE
        `),
      ]);

      return res.json({
        ok: true,
        stats: {
          doctors: doctors.rows[0].count,
          patients: patients.rows[0].count,
          appointments: appointments.rows[0].count,
          pending: pending.rows[0].count,
          confirmed: confirmed.rows[0].count,
          active_schedules:
            schedules.rows[0].count,
        },
      });
    } catch (error) {
      console.error(
        "Admin stats error:",
        error
      );

      return jsonError(
        res,
        500,
        "تعذر تحميل الإحصائيات"
      );
    }
  }
);

/* =========================================================
   404 for API routes
========================================================= */

app.use("/api", (req, res) => {
  return jsonError(
    res,
    404,
    "API endpoint غير موجود"
  );
});

/* =========================================================
   Frontend fallback - Express 5 SAFE
========================================================= */

/*
 * مهم جداً:
 *
 * لا نستخدم:
 *
 * app.get("*", ...)
 *
 * لأن Express 5 / path-to-regexp
 * يسبب:
 *
 * PathError: Missing parameter name
 *
 * لذلك نستخدم middleware عادي
 * لإرجاع index.html لأي مسار
 * ليس API.
 */

app.use((req, res) => {
  res.sendFile(
    path.join(
      PUBLIC_DIR,
      "index.html"
    )
  );
});

/* =========================================================
   Error handler
========================================================= */

app.use((error, req, res, next) => {
  console.error(
    "Unhandled server error:",
    error
  );

  if (res.headersSent) {
    return next(error);
  }

  return jsonError(
    res,
    500,
    "حدث خطأ داخلي في الخادم"
  );
});

/* =========================================================
   Start server
========================================================= */

async function startServer() {
  try {
    await ensureDatabase();

    app.listen(PORT, () => {
      console.log(
        `Medical Booking server running on port ${PORT}`
      );
    });
  } catch (error) {
    console.error(
      "Failed to start server:",
      error
    );

    process.exit(1);
  }
}

startServer();

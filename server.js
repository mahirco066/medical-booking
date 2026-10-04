const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 10000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      })
    : null;

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

/* =========================================================
   Helpers
========================================================= */

function jsonError(res, status, message, extra = {}) {
  return res.status(status).json({
    ok: false,
    message,
    ...extra,
  });
}

function jsonOk(res, data = {}) {
  return res.json({
    ok: true,
    ...data,
  });
}

function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9._-]/g, "");
}

function authEmailFromUsername(username) {
  const normalized = normalizeUsername(username);

  // Internal email used only by Supabase Auth.
  // The patient does not need to use this email.
  return `${normalized}@nawalclinic.local`;
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";

  if (!header.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return header.slice(7).trim();
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function validTime(value) {
  return /^\d{2}:\d{2}(:\d{2})?$/.test(String(value || ""));
}

function mapPatient(patient) {
  if (!patient) return null;

  return {
    id: patient.id,
    name: patient.full_name,
    full_name: patient.full_name,
    phone: patient.phone,
    email: patient.email,
    nationalId: patient.national_id,
    medicalNumber: patient.medical_number,
    dateOfBirth: patient.date_of_birth,
    bloodType: patient.blood_type,
    maritalStatus: patient.marital_status,
    address: patient.address,
    emergencyContactName: patient.emergency_contact_name,
    emergencyContactPhone: patient.emergency_contact_phone,
    notes: patient.notes,
    createdAt: patient.created_at,
    updatedAt: patient.updated_at,
  };
}

function mapService(service) {
  return {
    id: service.id,
    title: service.name,
    name: service.name,
    description: service.description || "",
    duration: service.duration_minutes,
    duration_minutes: service.duration_minutes,
    price: service.price,
    icon: service.icon || "🩺",
    active: service.active,
    sortOrder: service.sort_order,
  };
}

function mapAppointment(appointment, servicesMap = {}, doctorsMap = {}) {
  const service = appointment.service_id
    ? servicesMap[appointment.service_id]
    : null;

  const doctor = appointment.doctor_id
    ? doctorsMap[appointment.doctor_id]
    : null;

  return {
    id: appointment.id,
    patientId: appointment.patient_id,
    serviceId: appointment.service_id,
    service: service || null,
    doctorId: appointment.doctor_id,
    doctor: doctor || null,
    date: appointment.appointment_date,
    appointmentDate: appointment.appointment_date,
    time: appointment.appointment_time,
    appointmentTime: appointment.appointment_time,
    status: appointment.status,
    notes: appointment.notes,
    confirmedAt: appointment.confirmed_at,
    confirmedBy: appointment.confirmed_by,
    cancelledAt: appointment.cancelled_at,
    cancellationReason: appointment.cancellation_reason,
    createdAt: appointment.created_at,
    updatedAt: appointment.updated_at,
  };
}

async function requireAuth(req, res) {
  if (!supabaseAdmin) {
    jsonError(res, 503, "خدمة قاعدة البيانات غير متاحة حاليًا");
    return null;
  }

  const token = getBearerToken(req);

  if (!token) {
    jsonError(res, 401, "يجب تسجيل الدخول أولاً");
    return null;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data || !data.user) {
    jsonError(res, 401, "جلسة الدخول غير صالحة أو منتهية");
    return null;
  }

  return data.user;
}

async function getPatientByAuthUserId(authUserId) {
  const { data, error } = await supabaseAdmin
    .from("patients")
    .select("*")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function getStaffByAuthUserId(authUserId) {
  const { data, error } = await supabaseAdmin
    .from("staff_users")
    .select("*")
    .eq("auth_user_id", authUserId)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function requireStaff(req, res) {
  const user = await requireAuth(req, res);

  if (!user) return null;

  try {
    const staff = await getStaffByAuthUserId(user.id);

    if (!staff) {
      jsonError(res, 403, "ليس لديك صلاحية للوصول إلى لوحة الإدارة");
      return null;
    }

    return {
      authUser: user,
      staff,
    };
  } catch (error) {
    console.error("requireStaff:", error);
    jsonError(res, 500, "حدث خطأ أثناء التحقق من صلاحيات المستخدم");
    return null;
  }
}

function normalizeAppointmentInput(body) {
  return {
    name:
      body.name ||
      body.patient_name ||
      body.full_name ||
      body.patientName ||
      "",
    phone:
      body.phone ||
      body.patient_phone ||
      body.patientPhone ||
      "",
    service:
      body.type ||
      body.service ||
      body.service_name ||
      body.serviceName ||
      body.service_id ||
      body.serviceId ||
      "",
    date:
      body.date ||
      body.appointment_date ||
      body.appointmentDate ||
      "",
    time:
      body.time ||
      body.appointment_time ||
      body.appointmentTime ||
      "",
    notes: body.notes || "",
    doctorId: body.doctor_id || body.doctorId || null,
  };
}

/* =========================================================
   Health / Config
========================================================= */

app.get("/api/health", async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(503).json({
      ok: false,
      database: "not_configured",
      supabase: false,
      cms: false,
    });
  }

  try {
    const { error } = await supabaseAdmin
      .from("services")
      .select("id")
      .limit(1);

    if (error) {
      return res.status(503).json({
        ok: false,
        database: "supabase_error",
        supabase: true,
        cms: false,
        error: error.message,
      });
    }

    return res.json({
      ok: true,
      database: "supabase",
      supabase: true,
      cms: true,
      features: {
        homepage: true,
        services: true,
        appointments: true,
        patients: true,
        medicalRecords: true,
        ads: true,
        media: true,
        uploads: true,
      },
    });
  } catch (error) {
    console.error("Health error:", error);

    return res.status(503).json({
      ok: false,
      database: "supabase_error",
      supabase: true,
      cms: false,
    });
  }
});

app.get("/api/config", (req, res) => {
  return res.json({
    ok: true,
    clinic: {
      name: "عيادة د. نوال مكبي",
      specialty: "للنساء والتوليد",
    },
  });
});

/* =========================================================
   Patient Registration
========================================================= */

app.post("/api/patient/register", async (req, res) => {
  if (!supabaseAdmin) {
    return jsonError(res, 503, "قاعدة البيانات غير متاحة حاليًا");
  }

  const fullName = String(
    req.body.full_name || req.body.name || ""
  ).trim();

  const phone = String(req.body.phone || "").trim();

  const username = normalizeUsername(
    req.body.username || req.body.user_name
  );

  const password = String(req.body.password || "");

  const email = String(req.body.email || "").trim() || null;

  if (!fullName) {
    return jsonError(res, 400, "يرجى إدخال الاسم الكامل");
  }

  if (!phone) {
    return jsonError(res, 400, "يرجى إدخال رقم الهاتف");
  }

  if (!username || username.length < 3) {
    return jsonError(
      res,
      400,
      "اسم المستخدم يجب أن يحتوي على 3 أحرف أو أكثر"
    );
  }

  if (password.length < 6) {
    return jsonError(
      res,
      400,
      "كلمة المرور يجب أن تحتوي على 6 أحرف أو أكثر"
    );
  }

  const authEmail = authEmailFromUsername(username);

  try {
    // Prevent duplicate username/auth account.
    const { data: existingUsers, error: listError } =
      await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });

    if (!listError && existingUsers && existingUsers.users) {
      const duplicate = existingUsers.users.find(
        (u) =>
          String(u.email || "").toLowerCase() ===
          authEmail.toLowerCase()
      );

      if (duplicate) {
        return jsonError(
          res,
          409,
          "اسم المستخدم مستخدم بالفعل، اختر اسم مستخدم آخر"
        );
      }
    }

    const { data: authData, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email: authEmail,
        password,
        email_confirm: true,
        user_metadata: {
          username,
          full_name: fullName,
          phone,
        },
      });

    if (authError || !authData || !authData.user) {
      console.error("Create auth user:", authError);

      return jsonError(
        res,
        400,
        authError?.message || "تعذر إنشاء حساب المريضة"
      );
    }

    const authUser = authData.user;

    const { data: patient, error: patientError } =
      await supabaseAdmin
        .from("patients")
        .insert({
          auth_user_id: authUser.id,
          full_name: fullName,
          phone,
          email,
        })
        .select("*")
        .single();

    if (patientError) {
      console.error("Create patient:", patientError);

      // Roll back Auth account if patient row could not be created.
      await supabaseAdmin.auth.admin.deleteUser(authUser.id);

      return jsonError(
        res,
        400,
        "تعذر حفظ بيانات المريضة في قاعدة البيانات"
      );
    }

    // Sign in immediately so the frontend receives a usable token.
    const { data: sessionData, error: loginError } =
      await supabaseAdmin.auth.signInWithPassword({
        email: authEmail,
        password,
      });

    if (loginError || !sessionData?.session) {
      return res.status(201).json({
        ok: true,
        message: "تم إنشاء الحساب بنجاح. يرجى تسجيل الدخول.",
        patient: mapPatient(patient),
        token: null,
      });
    }

    return res.status(201).json({
      ok: true,
      message: "تم إنشاء الحساب وتسجيل الدخول بنجاح",
      token: sessionData.session.access_token,
      refreshToken: sessionData.session.refresh_token,
      patient: mapPatient(patient),
    });
  } catch (error) {
    console.error("Patient registration error:", error);

    return jsonError(
      res,
      500,
      "حدث خطأ غير متوقع أثناء إنشاء الحساب"
    );
  }
});

/* =========================================================
   Patient Login
========================================================= */

app.post("/api/patient/login", async (req, res) => {
  if (!supabaseAdmin) {
    return jsonError(res, 503, "قاعدة البيانات غير متاحة حاليًا");
  }

  const username = normalizeUsername(
    req.body.username || req.body.user_name
  );

  const password = String(req.body.password || "");

  if (!username || !password) {
    return jsonError(
      res,
      400,
      "يرجى إدخال اسم المستخدم وكلمة المرور"
    );
  }

  const authEmail = authEmailFromUsername(username);

  try {
    const { data, error } =
      await supabaseAdmin.auth.signInWithPassword({
        email: authEmail,
        password,
      });

    if (error || !data?.session || !data?.user) {
      return jsonError(
        res,
        401,
        "اسم المستخدم أو كلمة المرور غير صحيحة"
      );
    }

    const patient = await getPatientByAuthUserId(data.user.id);

    if (!patient) {
      return jsonError(
        res,
        403,
        "الحساب موجود ولكن ملف المريضة غير موجود"
      );
    }

    return res.json({
      ok: true,
      message: "تم تسجيل الدخول بنجاح",
      token: data.session.access_token,
      refreshToken: data.session.refresh_token,
      patient: mapPatient(patient),
    });
  } catch (error) {
    console.error("Patient login error:", error);

    return jsonError(
      res,
      500,
      "حدث خطأ أثناء تسجيل الدخول"
    );
  }
});

/* =========================================================
   Patient Session
========================================================= */

app.get("/api/patient/me", async (req, res) => {
  const user = await requireAuth(req, res);

  if (!user) return;

  try {
    const patient = await getPatientByAuthUserId(user.id);

    if (!patient) {
      return jsonError(res, 404, "ملف المريضة غير موجود");
    }

    return jsonOk(res, {
      patient: mapPatient(patient),
    });
  } catch (error) {
    console.error("Patient me error:", error);

    return jsonError(
      res,
      500,
      "تعذر تحميل بيانات المريضة"
    );
  }
});

/* =========================================================
   Logout
========================================================= */

app.post("/api/logout", async (req, res) => {
  // The frontend removes its local token.
  // We intentionally do not revoke the global Supabase session here.
  return jsonOk(res, {
    message: "تم تسجيل الخروج",
  });
});

/* =========================================================
   Services
========================================================= */

app.get("/api/services", async (req, res) => {
  if (!supabaseAdmin) {
    return jsonError(res, 503, "قاعدة البيانات غير متاحة");
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("services")
      .select(
        "id,name,description,duration_minutes,price,icon,active,sort_order"
      )
      .eq("active", true)
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("Services:", error);
      return jsonError(res, 500, "تعذر تحميل خدمات العيادة");
    }

    return res.json((data || []).map(mapService));
  } catch (error) {
    console.error("Services exception:", error);

    return jsonError(res, 500, "تعذر تحميل خدمات العيادة");
  }
});

/* =========================================================
   Create Appointment
========================================================= */

app.post("/api/appointments", async (req, res) => {
  if (!supabaseAdmin) {
    return jsonError(res, 503, "قاعدة البيانات غير متاحة");
  }

  const user = await requireAuth(req, res);

  if (!user) return;

  const input = normalizeAppointmentInput(req.body);

  if (!input.date || !validDate(input.date)) {
    return jsonError(res, 400, "تاريخ الموعد غير صحيح");
  }

  if (!input.time || !validTime(input.time)) {
    return jsonError(res, 400, "وقت الموعد غير صحيح");
  }

  if (!input.service) {
    return jsonError(res, 400, "يرجى اختيار الخدمة");
  }

  try {
    const patient = await getPatientByAuthUserId(user.id);

    if (!patient) {
      return jsonError(
        res,
        404,
        "ملف المريضة غير موجود. يرجى التسجيل من جديد."
      );
    }

    let service = null;

    // If service is a UUID, search by ID.
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        input.service
      )
    ) {
      const { data, error } = await supabaseAdmin
        .from("services")
        .select("*")
        .eq("id", input.service)
        .eq("active", true)
        .maybeSingle();

      if (error) throw error;

      service = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from("services")
        .select("*")
        .eq("name", input.service)
        .eq("active", true)
        .maybeSingle();

      if (error) throw error;

      service = data;
    }

    if (!service) {
      return jsonError(
        res,
        400,
        "الخدمة المختارة غير موجودة أو غير متاحة"
      );
    }

    /*
      Check for an existing active appointment at the same
      date/time. This gives a friendly response before insert.
    */
    let duplicateQuery = supabaseAdmin
      .from("appointments")
      .select("id")
      .eq("appointment_date", input.date)
      .eq("appointment_time", input.time)
      .in("status", ["pending", "confirmed"])
      .limit(1);

    if (input.doctorId) {
      duplicateQuery = duplicateQuery.eq(
        "doctor_id",
        input.doctorId
      );
    }

    const {
      data: existingAppointments,
      error: duplicateError,
    } = await duplicateQuery;

    if (duplicateError) {
      console.error("Duplicate check:", duplicateError);
    }

    if (
      Array.isArray(existingAppointments) &&
      existingAppointments.length > 0
    ) {
      return jsonError(
        res,
        409,
        "هذا الموعد محجوز بالفعل، يرجى اختيار وقت آخر"
      );
    }

    const appointmentPayload = {
      patient_id: patient.id,
      service_id: service.id,
      doctor_id: input.doctorId || null,
      appointment_date: input.date,
      appointment_time: input.time,
      status: "pending",
      notes: input.notes || null,
    };

    const { data: appointment, error: appointmentError } =
      await supabaseAdmin
        .from("appointments")
        .insert(appointmentPayload)
        .select("*")
        .single();

    if (appointmentError) {
      console.error("Create appointment:", appointmentError);

      if (appointmentError.code === "23505") {
        return jsonError(
          res,
          409,
          "هذا الموعد أصبح محجوزًا بالفعل، يرجى اختيار وقت آخر"
        );
      }

      return jsonError(
        res,
        400,
        "تعذر حفظ الموعد. يرجى المحاولة مرة أخرى."
      );
    }

    return res.status(201).json({
      ok: true,
      message:
        "تم إرسال طلب الحجز بنجاح، وسيتم تأكيد الموعد من العيادة.",
      appointment: {
        ...mapAppointment(appointment, {
          [service.id]: mapService(service),
        }),
        patient: mapPatient(patient),
      },
    });
  } catch (error) {
    console.error("Appointment error:", error);

    return jsonError(
      res,
      500,
      "حدث خطأ أثناء حجز الموعد"
    );
  }
});

/* =========================================================
   Patient Appointments
========================================================= */

app.get("/api/my-appointments", async (req, res) => {
  const user = await requireAuth(req, res);

  if (!user) return;

  try {
    const patient = await getPatientByAuthUserId(user.id);

    if (!patient) {
      return jsonError(res, 404, "ملف المريضة غير موجود");
    }

    const { data: appointments, error } =
      await supabaseAdmin
        .from("appointments")
        .select("*")
        .eq("patient_id", patient.id)
        .order("appointment_date", { ascending: false })
        .order("appointment_time", { ascending: false });

    if (error) throw error;

    const serviceIds = [
      ...new Set(
        (appointments || [])
          .map((a) => a.service_id)
          .filter(Boolean)
      ),
    ];

    const doctorIds = [
      ...new Set(
        (appointments || [])
          .map((a) => a.doctor_id)
          .filter(Boolean)
      ),
    ];

    const servicesMap = {};
    const doctorsMap = {};

    if (serviceIds.length) {
      const { data: services, error: serviceError } =
        await supabaseAdmin
          .from("services")
          .select("*")
          .in("id", serviceIds);

      if (serviceError) throw serviceError;

      (services || []).forEach((service) => {
        servicesMap[service.id] = mapService(service);
      });
    }

    if (doctorIds.length) {
      const { data: doctors, error: doctorError } =
        await supabaseAdmin
          .from("staff_users")
          .select("id,full_name,phone,role,active")
          .in("id", doctorIds);

      if (doctorError) throw doctorError;

      (doctors || []).forEach((doctor) => {
        doctorsMap[doctor.id] = {
          id: doctor.id,
          name: doctor.full_name,
          full_name: doctor.full_name,
          phone: doctor.phone,
          role: doctor.role,
          active: doctor.active,
        };
      });
    }

    return res.json(
      (appointments || []).map((appointment) =>
        mapAppointment(
          appointment,
          servicesMap,
          doctorsMap
        )
      )
    );
  } catch (error) {
    console.error("My appointments:", error);

    return jsonError(
      res,
      500,
      "تعذر تحميل مواعيدك"
    );
  }
});

// Alias useful for future patient dashboard.
app.get("/api/patient/appointments", async (req, res) => {
  req.url = "/api/my-appointments";
  return app._router.handle(req, res, () => {});
});

/* =========================================================
   Advertisements
========================================================= */

app.get("/api/ads", async (req, res) => {
  if (!supabaseAdmin) {
    return jsonError(res, 503, "قاعدة البيانات غير متاحة");
  }

  try {
    const today = new Date().toISOString().slice(0, 10);

    const { data, error } = await supabaseAdmin
      .from("ads")
      .select(
        "id,advertiser_name,business_type,title,description,image_url,target_url,phone,position,status,start_date,end_date,amount,currency,payment_status,impressions_count,clicks_count"
      )
      .eq("status", "active")
      .eq("payment_status", "paid")
      .lte("start_date", today)
      .gte("end_date", today)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Ads:", error);
      return jsonError(res, 500, "تعذر تحميل الإعلانات");
    }

    return res.json(
      (data || []).map((ad) => ({
        id: ad.id,
        advertiserName: ad.advertiser_name,
        businessType: ad.business_type,
        title: ad.title,
        description: ad.description,
        imageUrl: ad.image_url,
        targetUrl: ad.target_url,
        phone: ad.phone,
        position: ad.position,
        status: ad.status,
        startDate: ad.start_date,
        endDate: ad.end_date,
        amount: ad.amount,
        currency: ad.currency,
        impressionsCount: ad.impressions_count || 0,
        clicksCount: ad.clicks_count || 0,
      }))
    );
  } catch (error) {
    console.error("Ads exception:", error);

    return jsonError(res, 500, "تعذر تحميل الإعلانات");
  }
});

async function getOptionalPatientFromToken(req) {
  const token = getBearerToken(req);

  if (!token || !supabaseAdmin) {
    return null;
  }

  try {
    const { data } = await supabaseAdmin.auth.getUser(token);

    if (!data?.user) return null;

    return await getPatientByAuthUserId(data.user.id);
  } catch {
    return null;
  }
}

app.post("/api/ads/:id/impression", async (req, res) => {
  if (!supabaseAdmin) {
    return jsonError(res, 503, "قاعدة البيانات غير متاحة");
  }

  try {
    const adId = req.params.id;
    const patient = await getOptionalPatientFromToken(req);

    const sessionId =
      String(
        req.body?.session_id ||
          req.body?.sessionId ||
          req.headers["x-session-id"] ||
          ""
      ).slice(0, 200) || crypto.randomUUID();

    const { error } = await supabaseAdmin
      .from("ad_impressions")
      .insert({
        ad_id: adId,
        patient_id: patient?.id || null,
        session_id: sessionId,
      });

    if (error) {
      console.error("Ad impression:", error);
      return jsonError(res, 400, "تعذر تسجيل مشاهدة الإعلان");
    }

    const { data: ad } = await supabaseAdmin
      .from("ads")
      .select("impressions_count")
      .eq("id", adId)
      .maybeSingle();

    if (ad) {
      await supabaseAdmin
        .from("ads")
        .update({
          impressions_count:
            Number(ad.impressions_count || 0) + 1,
        })
        .eq("id", adId);
    }

    return jsonOk(res);
  } catch (error) {
    console.error("Ad impression exception:", error);
    return jsonError(res, 500, "تعذر تسجيل مشاهدة الإعلان");
  }
});

app.post("/api/ads/:id/click", async (req, res) => {
  if (!supabaseAdmin) {
    return jsonError(res, 503, "قاعدة البيانات غير متاحة");
  }

  try {
    const adId = req.params.id;
    const patient = await getOptionalPatientFromToken(req);

    const sessionId =
      String(
        req.body?.session_id ||
          req.body?.sessionId ||
          req.headers["x-session-id"] ||
          ""
      ).slice(0, 200) || crypto.randomUUID();

    const { error } = await supabaseAdmin
      .from("ad_clicks")
      .insert({
        ad_id: adId,
        patient_id: patient?.id || null,
        session_id: sessionId,
      });

    if (error) {
      console.error("Ad click:", error);
      return jsonError(res, 400, "تعذر تسجيل النقر على الإعلان");
    }

    const { data: ad } = await supabaseAdmin
      .from("ads")
      .select("clicks_count")
      .eq("id", adId)
      .maybeSingle();

    if (ad) {
      await supabaseAdmin
        .from("ads")
        .update({
          clicks_count:
            Number(ad.clicks_count || 0) + 1,
        })
        .eq("id", adId);
    }

    return jsonOk(res);
  } catch (error) {
    console.error("Ad click exception:", error);
    return jsonError(res, 500, "تعذر تسجيل النقر على الإعلان");
  }
});

/* =========================================================
   Staff / Dashboard
========================================================= */

app.get("/api/staff/me", async (req, res) => {
  const staffContext = await requireStaff(req, res);

  if (!staffContext) return;

  return jsonOk(res, {
    staff: {
      id: staffContext.staff.id,
      name: staffContext.staff.full_name,
      full_name: staffContext.staff.full_name,
      phone: staffContext.staff.phone,
      role: staffContext.staff.role,
      active: staffContext.staff.active,
    },
  });
});

/* Dashboard statistics */

app.get("/api/dashboard/stats", async (req, res) => {
  const staffContext = await requireStaff(req, res);

  if (!staffContext) return;

  try {
    const [
      appointmentsResult,
      patientsResult,
      pendingResult,
      confirmedResult,
      pregnancyResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("appointments")
        .select("id", { count: "exact", head: true }),

      supabaseAdmin
        .from("patients")
        .select("id", { count: "exact", head: true }),

      supabaseAdmin
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),

      supabaseAdmin
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("status", "confirmed"),

      supabaseAdmin
        .from("appointments")
        .select(
          "id,services!appointments_service_id_fkey(name)"
        )
        .in("status", ["pending", "confirmed"]),
    ]);

    let pregnancyCount = 0;

    if (!pregnancyResult.error && pregnancyResult.data) {
      pregnancyCount = pregnancyResult.data.filter((item) =>
        String(item.services?.name || "").includes("الحمل")
      ).length;
    }

    return jsonOk(res, {
      stats: {
        totalAppointments: appointmentsResult.count || 0,
        totalPatients: patientsResult.count || 0,
        pendingAppointments: pendingResult.count || 0,
        confirmedAppointments: confirmedResult.count || 0,
        pregnancyAppointments: pregnancyCount,
      },
    });
  } catch (error) {
    console.error("Dashboard stats:", error);

    return jsonError(
      res,
      500,
      "تعذر تحميل إحصائيات لوحة التحكم"
    );
  }
});

/* Dashboard appointments */

app.get("/api/dashboard/appointments", async (req, res) => {
  const staffContext = await requireStaff(req, res);

  if (!staffContext) return;

  try {
    const status = req.query.status;

    let query = supabaseAdmin
      .from("appointments")
      .select("*")
      .order("appointment_date", { ascending: false })
      .order("appointment_time", { ascending: false });

    if (
      status &&
      ["pending", "confirmed", "completed", "cancelled", "no_show"].includes(
        status
      )
    ) {
      query = query.eq("status", status);
    }

    const { data: appointments, error } = await query;

    if (error) throw error;

    const patientIds = [
      ...new Set(
        (appointments || [])
          .map((a) => a.patient_id)
          .filter(Boolean)
      ),
    ];

    const serviceIds = [
      ...new Set(
        (appointments || [])
          .map((a) => a.service_id)
          .filter(Boolean)
      ),
    ];

    const patientsMap = {};
    const servicesMap = {};

    if (patientIds.length) {
      const { data: patients, error: patientError } =
        await supabaseAdmin
          .from("patients")
          .select("*")
          .in("id", patientIds);

      if (patientError) throw patientError;

      (patients || []).forEach((patient) => {
        patientsMap[patient.id] = mapPatient(patient);
      });
    }

    if (serviceIds.length) {
      const { data: services, error: serviceError } =
        await supabaseAdmin
          .from("services")
          .select("*")
          .in("id", serviceIds);

      if (serviceError) throw serviceError;

      (services || []).forEach((service) => {
        servicesMap[service.id] = mapService(service);
      });
    }

    return res.json(
      (appointments || []).map((appointment) => ({
        ...mapAppointment(appointment, servicesMap),
        patient: patientsMap[appointment.patient_id] || null,
      }))
    );
  } catch (error) {
    console.error("Dashboard appointments:", error);

    return jsonError(
      res,
      500,
      "تعذر تحميل المواعيد"
    );
  }
});

/* Confirm appointment */

app.patch("/api/dashboard/appointments/:id/confirm", async (req, res) => {
  const staffContext = await requireStaff(req, res);

  if (!staffContext) return;

  try {
    const { data, error } = await supabaseAdmin
      .from("appointments")
      .update({
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
        confirmed_by: staffContext.staff.id,
      })
      .eq("id", req.params.id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return jsonError(
        res,
        404,
        "الموعد غير موجود أو تم التعامل معه مسبقًا"
      );
    }

    return jsonOk(res, {
      message: "تم تأكيد الموعد",
      appointment: data,
    });
  } catch (error) {
    console.error("Confirm appointment:", error);

    return jsonError(
      res,
      500,
      "تعذر تأكيد الموعد"
    );
  }
});

/* Cancel appointment */

app.patch("/api/dashboard/appointments/:id/cancel", async (req, res) => {
  const staffContext = await requireStaff(req, res);

  if (!staffContext) return;

  try {
    const reason = String(
      req.body?.reason ||
        req.body?.cancellation_reason ||
        ""
    ).trim();

    const { data, error } = await supabaseAdmin
      .from("appointments")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason || null,
      })
      .eq("id", req.params.id)
      .select("*")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return jsonError(res, 404, "الموعد غير موجود");
    }

    return jsonOk(res, {
      message: "تم إلغاء الموعد",
      appointment: data,
    });
  } catch (error) {
    console.error("Cancel appointment:", error);

    return jsonError(
      res,
      500,
      "تعذر إلغاء الموعد"
    );
  }
});

/* =========================================================
   Patients - Dashboard
========================================================= */

app.get("/api/dashboard/patients", async (req, res) => {
  const staffContext = await requireStaff(req, res);

  if (!staffContext) return;

  try {
    const search = String(req.query.search || "").trim();

    let query = supabaseAdmin
      .from("patients")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (search) {
      query = query.or(
        `full_name.ilike.%${search}%,phone.ilike.%${search}%,medical_number.ilike.%${search}%`
      );
    }

    const { data, error } = await query;

    if (error) throw error;

    return res.json(
      (data || []).map(mapPatient)
    );
  } catch (error) {
    console.error("Dashboard patients:", error);

    return jsonError(
      res,
      500,
      "تعذر تحميل قائمة المريضات"
    );
  }
});

/* =========================================================
   Medical Records
========================================================= */

app.get(
  "/api/dashboard/patients/:patientId/medical-records",
  async (req, res) => {
    const staffContext = await requireStaff(req, res);

    if (!staffContext) return;

    try {
      const { data, error } = await supabaseAdmin
        .from("medical_records")
        .select("*")
        .eq("patient_id", req.params.patientId)
        .order("record_date", { ascending: false });

      if (error) throw error;

      return res.json(data || []);
    } catch (error) {
      console.error("Medical records:", error);

      return jsonError(
        res,
        500,
        "تعذر تحميل الملف الطبي"
      );
    }
  }
);

app.post(
  "/api/dashboard/patients/:patientId/medical-records",
  async (req, res) => {
    const staffContext = await requireStaff(req, res);

    if (!staffContext) return;

    if (
      !["doctor", "admin"].includes(
        staffContext.staff.role
      )
    ) {
      return jsonError(
        res,
        403,
        "إضافة السجل الطبي متاحة للطبيب أو المدير فقط"
      );
    }

    try {
      const payload = {
        patient_id: req.params.patientId,
        appointment_id:
          req.body.appointment_id ||
          req.body.appointmentId ||
          null,
        doctor_id:
          req.body.doctor_id ||
          req.body.doctorId ||
          staffContext.staff.id,
        record_date:
          req.body.record_date ||
          req.body.recordDate ||
          new Date().toISOString().slice(0, 10),
        record_type:
          req.body.record_type ||
          req.body.recordType ||
          "زيارة",
        symptoms: req.body.symptoms || null,
        diagnosis: req.body.diagnosis || null,
        treatment: req.body.treatment || null,
        notes: req.body.notes || null,
      };

      const { data, error } = await supabaseAdmin
        .from("medical_records")
        .insert(payload)
        .select("*")
        .single();

      if (error) throw error;

      return res.status(201).json({
        ok: true,
        message: "تم حفظ السجل الطبي",
        record: data,
      });
    } catch (error) {
      console.error("Create medical record:", error);

      return jsonError(
        res,
        500,
        "تعذر حفظ السجل الطبي"
      );
    }
  }
);

/* =========================================================
   Services - Dashboard
========================================================= */

app.get("/api/dashboard/services", async (req, res) => {
  const staffContext = await requireStaff(req, res);

  if (!staffContext) return;

  try {
    const { data, error } = await supabaseAdmin
      .from("services")
      .select("*")
      .order("sort_order", { ascending: true });

    if (error) throw error;

    return res.json(
      (data || []).map(mapService)
    );
  } catch (error) {
    console.error("Dashboard services:", error);

    return jsonError(
      res,
      500,
      "تعذر تحميل الخدمات"
    );
  }
});

app.post("/api/dashboard/services", async (req, res) => {
  const staffContext = await requireStaff(req, res);

  if (!staffContext) return;

  try {
    const payload = {
      name: String(req.body.name || req.body.title || "").trim(),
      description: req.body.description || null,
      duration_minutes: Number(
        req.body.duration_minutes ||
          req.body.duration ||
          30
      ),
      price:
        req.body.price === "" ||
        req.body.price === undefined
          ? null
          : Number(req.body.price),
      icon: req.body.icon || "🩺",
      active:
        req.body.active === undefined
          ? true
          : Boolean(req.body.active),
      sort_order: Number(
        req.body.sort_order ||
          req.body.sortOrder ||
          0
      ),
    };

    if (!payload.name) {
      return jsonError(res, 400, "اسم الخدمة مطلوب");
    }

    const { data, error } = await supabaseAdmin
      .from("services")
      .insert(payload)
      .select("*")
      .single();

    if (error) throw error;

    return res.status(201).json({
      ok: true,
      message: "تمت إضافة الخدمة",
      service: mapService(data),
    });
  } catch (error) {
    console.error("Create service:", error);

    return jsonError(
      res,
      500,
      "تعذر إضافة الخدمة"
    );
  }
});

app.patch("/api/dashboard/services/:id", async (req, res) => {
  const staffContext = await requireStaff(req, res);

  if (!staffContext) return;

  try {
    const update = {};

    if (
      req.body.name !== undefined ||
      req.body.title !== undefined
    ) {
      update.name = String(
        req.body.name || req.body.title
      ).trim();
    }

    if (req.body.description !== undefined) {
      update.description = req.body.description;
    }

    if (
      req.body.duration !== undefined ||
      req.body.duration_minutes !== undefined
    ) {
      update.duration_minutes = Number(
        req.body.duration_minutes ||
          req.body.duration
      );
    }

    if (req.body.price !== undefined) {
      update.price =
        req.body.price === ""
          ? null
          : Number(req.body.price);
    }

    if (req.body.icon !== undefined) {
      update.icon = req.body.icon;
    }

    if (req.body.active !== undefined) {
      update.active = Boolean(req.body.active);
    }

    if (
      req.body.sort_order !== undefined ||
      req.body.sortOrder !== undefined
    ) {
      update.sort_order = Number(
        req.body.sort_order ||
          req.body.sortOrder
      );
    }

    const { data, error } = await supabaseAdmin
      .from("services")
      .update(update)
      .eq("id", req.params.id)
      .select("*")
      .single();

    if (error) throw error;

    return jsonOk(res, {
      message: "تم تحديث الخدمة",
      service: mapService(data),
    });
  } catch (error) {
    console.error("Update service:", error);

    return jsonError(
      res,
      500,
      "تعذر تحديث الخدمة"
    );
  }
});

app.delete("/api/dashboard/services/:id", async (req, res) => {
  const staffContext = await requireStaff(req, res);

  if (!staffContext) return;

  try {
    const { error } = await supabaseAdmin
      .from("services")
      .delete()
      .eq("id", req.params.id);

    if (error) throw error;

    return jsonOk(res, {
      message: "تم حذف الخدمة",
    });
  } catch (error) {
    console.error("Delete service:", error);

    return jsonError(
      res,
      500,
      "تعذر حذف الخدمة. قد تكون مرتبطة بمواعيد سابقة."
    );
  }
});

/* =========================================================
   Ads - Dashboard
========================================================= */

app.get("/api/dashboard/ads", async (req, res) => {
  const staffContext = await requireStaff(req, res);

  if (!staffContext) return;

  try {
    const { data, error } = await supabaseAdmin
      .from("ads")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    return res.json(data || []);
  } catch (error) {
    console.error("Dashboard ads:", error);

    return jsonError(
      res,
      500,
      "تعذر تحميل الإعلانات"
    );
  }
});

app.post("/api/dashboard/ads", async (req, res) => {
  const staffContext = await requireStaff(req, res);

  if (!staffContext) return;

  try {
    const payload = {
      advertiser_name:
        req.body.advertiser_name ||
        req.body.advertiserName ||
        "",
      business_type:
        req.body.business_type ||
        req.body.businessType ||
        "other",
      title: req.body.title || "",
      description: req.body.description || null,
      image_url:
        req.body.image_url ||
        req.body.imageUrl ||
        null,
      target_url:
        req.body.target_url ||
        req.body.targetUrl ||
        null,
      phone: req.body.phone || null,
      position: req.body.position || "home",
      status: req.body.status || "draft",
      start_date:
        req.body.start_date ||
        req.body.startDate ||
        null,
      end_date:
        req.body.end_date ||
        req.body.endDate ||
        null,
      amount:
        req.body.amount === "" ||
        req.body.amount === undefined
          ? null
          : Number(req.body.amount),
      currency: req.body.currency || "SDG",
      payment_status:
        req.body.payment_status ||
        req.body.paymentStatus ||
        "pending",
      approved_by:
        req.body.approved_by ||
        req.body.approvedBy ||
        null,
      approved_at:
        req.body.approved_at ||
        req.body.approvedAt ||
        null,
    };

    const { data, error } = await supabaseAdmin
      .from("ads")
      .insert(payload)
      .select("*")
      .single();

    if (error) throw error;

    return res.status(201).json({
      ok: true,
      message: "تم حفظ الإعلان",
      ad: data,
    });
  } catch (error) {
    console.error("Create ad:", error);

    return jsonError(
      res,
      500,
      "تعذر حفظ الإعلان"
    );
  }
});

app.patch("/api/dashboard/ads/:id", async (req, res) => {
  const staffContext = await requireStaff(req, res);

  if (!staffContext) return;

  try {
    const update = {};

    const fieldMap = {
      advertiser_name: "advertiser_name",
      advertiserName: "advertiser_name",
      business_type: "business_type",
      businessType: "business_type",
      title: "title",
      description: "description",
      image_url: "image_url",
      imageUrl: "image_url",
      target_url: "target_url",
      targetUrl: "target_url",
      phone: "phone",
      position: "position",
      status: "status",
      start_date: "start_date",
      startDate: "start_date",
      end_date: "end_date",
      endDate: "end_date",
      amount: "amount",
      currency: "currency",
      payment_status: "payment_status",
      paymentStatus: "payment_status",
    };

    for (const [inputName, dbName] of Object.entries(fieldMap)) {
      if (req.body[inputName] !== undefined) {
        update[dbName] = req.body[inputName];
      }
    }

    if (update.amount !== undefined) {
      update.amount =
        update.amount === ""
          ? null
          : Number(update.amount);
    }

    const { data, error } = await supabaseAdmin
      .from("ads")
      .update(update)
      .eq("id", req.params.id)
      .select("*")
      .single();

    if (error) throw error;

    return jsonOk(res, {
      message: "تم تحديث الإعلان",
      ad: data,
    });
  } catch (error) {
    console.error("Update ad:", error);

    return jsonError(
      res,
      500,
      "تعذر تحديث الإعلان"
    );
  }
});

app.delete("/api/dashboard/ads/:id", async (req, res) => {
  const staffContext = await requireStaff(req, res);

  if (!staffContext) return;

  try {
    const { error } = await supabaseAdmin
      .from("ads")
      .delete()
      .eq("id", req.params.id);

    if (error) throw error;

    return jsonOk(res, {
      message: "تم حذف الإعلان",
    });
  } catch (error) {
    console.error("Delete ad:", error);

    return jsonError(
      res,
      500,
      "تعذر حذف الإعلان"
    );
  }
});

/* =========================================================
   Static Website
========================================================= */

const publicPath = path.join(__dirname, "public");

app.use(express.static(publicPath));

app.get("*splat", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

/* =========================================================
   Error Handler
========================================================= */

app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err);

  if (res.headersSent) {
    return next(err);
  }

  return res.status(500).json({
    ok: false,
    message: "حدث خطأ غير متوقع في الخادم",
  });
});

/* =========================================================
   Start
========================================================= */

app.listen(PORT, () => {
  console.log(
    `Nawal Clinic server running on port ${PORT}`
  );

  console.log(
    `Supabase configured: ${Boolean(
      SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    )}`
  );
});

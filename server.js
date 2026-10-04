const express = require("express");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = (supabaseUrl && serviceRoleKey)
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  : null;

function requireSupabase(res) {
  if (!supabase) {
    res.status(503).json({
      ok: false,
      message: "قاعدة البيانات غير مهيأة. أضف SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY في Render."
    });
    return false;
  }
  return true;
}

async function getUserFromToken(req) {
  if (!supabase) return null;
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "medical-booking",
    database: supabase ? "supabase" : "not-configured"
  });
});

app.get("/api/config", (req, res) => {
  res.json({
    appName: "موعدي",
    currency: "جنيه سوداني",
    databaseConfigured: Boolean(supabase)
  });
});

app.get("/api/specialties", async (req, res) => {
  if (!requireSupabase(res)) return;
  const { data, error } = await supabase
    .from("specialties")
    .select("id,name,icon,color,sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) return res.status(500).json({ ok:false, message:error.message });
  res.json({ ok:true, specialties:data || [] });
});

app.get("/api/doctors", async (req, res) => {
  if (!requireSupabase(res)) return;
  const search = String(req.query.search || "").trim();
  const specialty = String(req.query.specialty || "").trim();
  const area = String(req.query.area || "").trim();

  let query = supabase
    .from("doctors")
    .select(`
      id,display_name,bio,experience_years,consultation_fee,area,clinic_name,
      rating,rating_count,is_active,
      specialties: specialty_id (id,name,icon,color)
    `)
    .eq("is_active", true)
    .order("rating", { ascending: false });

  if (search) {
    query = query.or(`display_name.ilike.%${search}%,clinic_name.ilike.%${search}%`);
  }
  if (specialty) {
    const { data: sp } = await supabase.from("specialties").select("id").eq("name", specialty).maybeSingle();
    if (sp?.id) query = query.eq("specialty_id", sp.id);
  }
  if (area) query = query.eq("area", area);

  const { data, error } = await query;
  if (error) return res.status(500).json({ ok:false, message:error.message });

  res.json({ ok:true, doctors:data || [] });
});

app.get("/api/doctors/:id", async (req, res) => {
  if (!requireSupabase(res)) return;
  const { data, error } = await supabase
    .from("doctors")
    .select(`
      *,
      specialties: specialty_id (id,name,icon,color),
      clinics: clinic_id (id,name,address,phone)
    `)
    .eq("id", req.params.id)
    .eq("is_active", true)
    .single();

  if (error) return res.status(404).json({ ok:false, message:"الطبيب غير موجود." });
  res.json({ ok:true, doctor:data });
});

app.get("/api/doctors/:id/availability", async (req, res) => {
  if (!requireSupabase(res)) return;
  const date = String(req.query.date || "");
  if (!date) return res.status(400).json({ ok:false, message:"التاريخ مطلوب." });

  const { data, error } = await supabase
    .from("appointment_slots")
    .select("id,slot_date,start_time,end_time,status")
    .eq("doctor_id", req.params.id)
    .eq("slot_date", date)
    .eq("status", "available")
    .order("start_time", { ascending:true });

  if (error) return res.status(500).json({ ok:false, message:error.message });
  res.json({ ok:true, slots:data || [] });
});

app.post("/api/appointments", async (req, res) => {
  if (!requireSupabase(res)) return;
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ ok:false, message:"يجب تسجيل الدخول قبل حجز الموعد." });

  const { doctor_id, slot_id, patient_name, patient_phone, notes } = req.body || {};
  if (!doctor_id || !slot_id || !patient_name || !patient_phone) {
    return res.status(400).json({ ok:false, message:"بيانات الحجز غير مكتملة." });
  }

  const { data: slot, error: slotError } = await supabase
    .from("appointment_slots")
    .select("id,doctor_id,slot_date,start_time,status")
    .eq("id", slot_id)
    .eq("doctor_id", doctor_id)
    .single();

  if (slotError || !slot) return res.status(404).json({ ok:false, message:"الموعد غير موجود." });
  if (slot.status !== "available") return res.status(409).json({ ok:false, message:"هذا الوقت لم يعد متاحاً." });

  const { data: appointment, error } = await supabase
    .from("appointments")
    .insert({
      patient_id: user.id,
      doctor_id,
      slot_id,
      patient_name,
      patient_phone,
      notes: notes || null,
      status: "pending",
      payment_status: "pay_at_clinic"
    })
    .select("*")
    .single();

  if (error) return res.status(409).json({ ok:false, message:"تعذر تأكيد الحجز. ربما تم حجز الموعد من مريض آخر." });

  const { error: slotUpdateError } = await supabase
    .from("appointment_slots")
    .update({ status:"booked" })
    .eq("id", slot_id)
    .eq("status", "available");

  if (slotUpdateError) {
    await supabase.from("appointments").delete().eq("id", appointment.id);
    return res.status(409).json({ ok:false, message:"تعذر تثبيت الموعد." });
  }

  res.status(201).json({ ok:true, appointment });
});

app.get("/api/my-appointments", async (req, res) => {
  if (!requireSupabase(res)) return;
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ ok:false, message:"يجب تسجيل الدخول." });

  const { data, error } = await supabase
    .from("appointments")
    .select(`
      id,patient_name,patient_phone,status,payment_status,notes,created_at,
      doctor:doctor_id(id,display_name,area,clinic_name),
      slot:slot_id(slot_date,start_time,end_time)
    `)
    .eq("patient_id", user.id)
    .order("created_at", { ascending:false });

  if (error) return res.status(500).json({ ok:false, message:error.message });
  res.json({ ok:true, appointments:data || [] });
});

app.use(express.static(path.join(__dirname, "public")));

app.get("*splat", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`Medical Booking server running on port ${PORT}`));

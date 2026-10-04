/* =========================================================
   موعدي - التطبيق الرئيسي
   ربط الواجهة بالـ API الحقيقي
   Database: Neon PostgreSQL
   ========================================================= */

const API = "/api";

let currentUser = null;
let authToken = localStorage.getItem("medical_booking_token") || null;

/* =========================================================
   أدوات عامة
   ========================================================= */

async function apiRequest(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API}${url}`, {
    ...options,
    headers
  });

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      data.message ||
      data.error ||
      "حدث خطأ أثناء تنفيذ العملية."
    );
  }

  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showMessage(message, type = "success") {
  const old = document.getElementById("appMessage");
  if (old) old.remove();

  const box = document.createElement("div");
  box.id = "appMessage";
  box.textContent = message;

  Object.assign(box.style, {
    position: "fixed",
    top: "85px",
    right: "20px",
    zIndex: "10000",
    maxWidth: "380px",
    padding: "14px 20px",
    borderRadius: "12px",
    fontFamily: "Cairo, sans-serif",
    fontSize: "14px",
    fontWeight: "700",
    color: "#fff",
    background: type === "error" ? "#c0392b" : "#16855b",
    boxShadow: "0 8px 25px rgba(0,0,0,.18)",
    direction: "rtl",
    animation: "fadeIn .25s ease"
  });

  document.body.appendChild(box);

  setTimeout(() => {
    box.style.opacity = "0";
    box.style.transition = "opacity .3s";
    setTimeout(() => box.remove(), 300);
  }, 3500);
}

/* =========================================================
   Mobile Menu
   ========================================================= */

const menu = document.getElementById("mobileMenu");
const nav = document.querySelector(".nav");

menu?.addEventListener("click", () => {
  nav.style.display = nav.style.display === "flex" ? "none" : "flex";
  nav.style.position = "absolute";
  nav.style.top = "66px";
  nav.style.right = "0";
  nav.style.left = "0";
  nav.style.background = "#07517b";
  nav.style.padding = "12px 20px";
  nav.style.flexDirection = "column";
  nav.style.gap = "5px";
});

/* =========================================================
   التخصصات
   ========================================================= */

document.querySelectorAll(".specialty-card").forEach(card => {
  card.addEventListener("click", () => {
    const specialty = document.getElementById("specialty");

    if (specialty) {
      specialty.value = card.dataset.specialty || "";
    }

    document
      .getElementById("searchForm")
      ?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
  });
});

/* =========================================================
   البحث
   ========================================================= */

document.getElementById("searchForm")?.addEventListener("submit", e => {
  e.preventDefault();

  const name =
    document.getElementById("searchName")?.value.trim() || "";

  const specialty =
    document.getElementById("specialty")?.value || "";

  const area =
    document.getElementById("area")?.value || "";

  const cards = [
    ...document.querySelectorAll(".doctor-card")
  ];

  let count = 0;

  cards.forEach(card => {
    const doctorName = card.dataset.name || "";
    const doctorSpecialty = card.dataset.specialty || "";

    const matchesName =
      !name ||
      doctorName.includes(name) ||
      doctorSpecialty.includes(name);

    const matchesSpecialty =
      !specialty ||
      doctorSpecialty === specialty;

    const visible =
      matchesName && matchesSpecialty;

    card.style.display = visible ? "flex" : "none";

    if (visible) count++;
  });

  document
    .getElementById("doctors")
    ?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

  const result =
    document.getElementById("searchResults");

  if (result) {
    result.hidden = false;

    result.textContent = count
      ? `تم العثور على ${count} طبيب مطابق للبحث${area ? ` في ${area}` : ""}.`
      : "لا توجد نتائج مطابقة حالياً.";

    setTimeout(() => {
      result.hidden = true;
    }, 3000);
  }
});

/* =========================================================
   Modal
   ========================================================= */

function createModal(title, content) {
  closeModal();

  const overlay = document.createElement("div");
  overlay.id = "appModal";

  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "9999",
    background: "rgba(0,0,0,.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
    direction: "rtl"
  });

  const modal = document.createElement("div");

  Object.assign(modal.style, {
    width: "100%",
    maxWidth: "470px",
    maxHeight: "90vh",
    overflowY: "auto",
    background: "#fff",
    borderRadius: "20px",
    padding: "28px",
    boxShadow: "0 20px 60px rgba(0,0,0,.25)",
    fontFamily: "Cairo, sans-serif",
    position: "relative"
  });

  modal.innerHTML = `
    <button
      type="button"
      id="modalClose"
      aria-label="إغلاق"
      style="
        position:absolute;
        top:12px;
        left:14px;
        width:34px;
        height:34px;
        border:0;
        border-radius:50%;
        background:#f1f4f6;
        cursor:pointer;
        font-size:20px;
      "
    >×</button>

    <h2 style="
      margin:0 0 22px;
      color:#07527c;
      font-size:22px;
      text-align:center;
    ">${escapeHtml(title)}</h2>

    <div id="modalContent">${content}</div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  document
    .getElementById("modalClose")
    ?.addEventListener("click", closeModal);

  overlay.addEventListener("click", event => {
    if (event.target === overlay) {
      closeModal();
    }
  });

  return modal;
}

function closeModal() {
  document.getElementById("appModal")?.remove();
}

/* =========================================================
   تنسيق حقول النماذج
   ========================================================= */

function formStyles() {
  return `
    <style>
      .mb-field {
        margin-bottom:15px;
      }

      .mb-field label {
        display:block;
        margin-bottom:7px;
        font-size:13px;
        font-weight:700;
        color:#34495e;
      }

      .mb-field input,
      .mb-field select {
        width:100%;
        box-sizing:border-box;
        padding:12px 14px;
        border:1px solid #d9e1e6;
        border-radius:10px;
        outline:none;
        font-family:Cairo,sans-serif;
        font-size:14px;
        background:#fff;
      }

      .mb-field input:focus,
      .mb-field select:focus {
        border-color:#07527c;
        box-shadow:0 0 0 3px rgba(7,82,124,.08);
      }

      .mb-submit {
        width:100%;
        border:0;
        border-radius:11px;
        padding:13px;
        background:#07527c;
        color:#fff;
        font-family:Cairo,sans-serif;
        font-size:15px;
        font-weight:700;
        cursor:pointer;
      }

      .mb-submit:hover {
        opacity:.92;
      }

      .mb-secondary {
        width:100%;
        margin-top:10px;
        border:0;
        background:none;
        color:#07527c;
        font-family:Cairo,sans-serif;
        font-size:13px;
        cursor:pointer;
      }

      .mb-error {
        color:#c0392b;
        font-size:13px;
        margin-bottom:12px;
        text-align:center;
      }

      .mb-note {
        color:#71808b;
        font-size:12px;
        text-align:center;
        margin:0 0 18px;
        line-height:1.8;
      }
    </style>
  `;
}

/* =========================================================
   إنشاء حساب مريض
   ========================================================= */

function showSignup() {
  const modal = createModal(
    "إنشاء حساب جديد",
    `
      ${formStyles()}

      <p class="mb-note">
        أنشئ حسابك في منصة موعدي لحجز مواعيدك الطبية ومتابعتها بسهولة.
      </p>

      <form id="signupForm">

        <div class="mb-field">
          <label>الاسم الكامل</label>
          <input
            id="signupName"
            type="text"
            placeholder="أدخل الاسم الكامل"
            required
            autocomplete="name"
          >
        </div>

        <div class="mb-field">
          <label>رقم الهاتف</label>
          <input
            id="signupPhone"
            type="tel"
            placeholder="أدخل رقم الهاتف"
            required
            autocomplete="tel"
          >
        </div>

        <div class="mb-field">
          <label>كلمة المرور</label>
          <input
            id="signupPassword"
            type="password"
            placeholder="أنشئ كلمة مرور"
            required
            minlength="6"
            autocomplete="new-password"
          >
        </div>

        <div class="mb-field">
          <label>تأكيد كلمة المرور</label>
          <input
            id="signupPassword2"
            type="password"
            placeholder="أعد كتابة كلمة المرور"
            required
            minlength="6"
            autocomplete="new-password"
          >
        </div>

        <div id="signupError"></div>

        <button class="mb-submit" type="submit">
          إنشاء الحساب
        </button>

        <button
          class="mb-secondary"
          type="button"
          id="goLogin"
        >
          لدي حساب بالفعل — تسجيل الدخول
        </button>

      </form>
    `
  );

  modal
    .querySelector("#signupForm")
    ?.addEventListener("submit", registerPatient);

  modal
    .querySelector("#goLogin")
    ?.addEventListener("click", showLogin);
}

async function registerPatient(event) {
  event.preventDefault();

  const name =
    document.getElementById("signupName").value.trim();

  const phone =
    document.getElementById("signupPhone").value.trim();

  const password =
    document.getElementById("signupPassword").value;

  const password2 =
    document.getElementById("signupPassword2").value;

  const errorBox =
    document.getElementById("signupError");

  errorBox.innerHTML = "";

  if (!name || !phone || !password) {
    errorBox.innerHTML =
      `<div class="mb-error">يرجى إكمال جميع البيانات.</div>`;
    return;
  }

  if (password.length < 6) {
    errorBox.innerHTML =
      `<div class="mb-error">كلمة المرور يجب أن تكون 6 أحرف على الأقل.</div>`;
    return;
  }

  if (password !== password2) {
    errorBox.innerHTML =
      `<div class="mb-error">كلمتا المرور غير متطابقتين.</div>`;
    return;
  }

  const button =
    event.target.querySelector("button[type='submit']");

  button.disabled = true;
  button.textContent = "جاري إنشاء الحساب...";

  try {
    const data = await apiRequest("/patient/register", {
      method: "POST",
      body: JSON.stringify({
        name,
        phone,
        password
      })
    });

    if (data.token || data.accessToken || data.session?.token) {
      authToken =
        data.token ||
        data.accessToken ||
        data.session.token;

      localStorage.setItem(
        "medical_booking_token",
        authToken
      );
    }

    currentUser =
      data.user ||
      data.patient ||
      data.data?.user ||
      null;

    closeModal();

    showMessage(
      "تم إنشاء حسابك بنجاح. مرحباً بك في موعدي 🎉"
    );

    updateAccountButtons();

  } catch (error) {
    errorBox.innerHTML =
      `<div class="mb-error">${escapeHtml(error.message)}</div>`;

    button.disabled = false;
    button.textContent = "إنشاء الحساب";
  }
}

/* =========================================================
   تسجيل الدخول
   ========================================================= */

function showLogin() {
  const modal = createModal(
    "تسجيل الدخول",
    `
      ${formStyles()}

      <p class="mb-note">
        سجل الدخول للوصول إلى مواعيدك وحجوزاتك الطبية.
      </p>

      <form id="loginForm">

        <div class="mb-field">
          <label>رقم الهاتف</label>
          <input
            id="loginPhone"
            type="tel"
            placeholder="أدخل رقم الهاتف"
            required
            autocomplete="tel"
          >
        </div>

        <div class="mb-field">
          <label>كلمة المرور</label>
          <input
            id="loginPassword"
            type="password"
            placeholder="أدخل كلمة المرور"
            required
            autocomplete="current-password"
          >
        </div>

        <div id="loginError"></div>

        <button class="mb-submit" type="submit">
          تسجيل الدخول
        </button>

        <button
          class="mb-secondary"
          type="button"
          id="goSignup"
        >
          ليس لدي حساب — إنشاء حساب جديد
        </button>

      </form>
    `
  );

  modal
    .querySelector("#loginForm")
    ?.addEventListener("submit", loginPatient);

  modal
    .querySelector("#goSignup")
    ?.addEventListener("click", showSignup);
}

async function loginPatient(event) {
  event.preventDefault();

  const phone =
    document.getElementById("loginPhone").value.trim();

  const password =
    document.getElementById("loginPassword").value;

  const errorBox =
    document.getElementById("loginError");

  errorBox.innerHTML = "";

  const button =
    event.target.querySelector("button[type='submit']");

  button.disabled = true;
  button.textContent = "جاري تسجيل الدخول...";

  try {
    const data = await apiRequest("/patient/login", {
      method: "POST",
      body: JSON.stringify({
        phone,
        password
      })
    });

    authToken =
      data.token ||
      data.accessToken ||
      data.session?.token ||
      null;

    if (!authToken) {
      throw new Error("لم يتم استلام جلسة دخول من الخادم.");
    }

    localStorage.setItem(
      "medical_booking_token",
      authToken
    );

    currentUser =
      data.user ||
      data.patient ||
      data.data?.user ||
      null;

    closeModal();

    showMessage(
      "تم تسجيل الدخول بنجاح 👋"
    );

    updateAccountButtons();

  } catch (error) {
    errorBox.innerHTML =
      `<div class="mb-error">${escapeHtml(error.message)}</div>`;

    button.disabled = false;
    button.textContent = "تسجيل الدخول";
  }
}

/* =========================================================
   التحقق من الجلسة
   ========================================================= */

async function loadCurrentUser() {
  if (!authToken) {
    updateAccountButtons();
    return;
  }

  try {
    const data =
      await apiRequest("/patient/me");

    currentUser =
      data.user ||
      data.patient ||
      data.data?.user ||
      data;

    updateAccountButtons();

  } catch {
    authToken = null;
    currentUser = null;

    localStorage.removeItem(
      "medical_booking_token"
    );

    updateAccountButtons();
  }
}

/* =========================================================
   تحديث أزرار الحساب
   ========================================================= */

function updateAccountButtons() {
  const loginBtn =
    document.getElementById("loginBtn");

  const signupBtn =
    document.getElementById("signupBtn");

  if (!loginBtn || !signupBtn) return;

  if (authToken && currentUser) {

    const name =
      currentUser.name ||
      currentUser.full_name ||
      currentUser.fullName ||
      "حسابي";

    loginBtn.innerHTML =
      `مرحباً ${escapeHtml(name)} <span>♙</span>`;

    signupBtn.textContent =
      "تسجيل الخروج";

    signupBtn.onclick = logoutPatient;

    loginBtn.onclick = showAccount;

  } else {

    loginBtn.innerHTML =
      `تسجيل الدخول <span>♙</span>`;

    signupBtn.innerHTML =
      `إنشاء حساب <span>♙</span>`;

    loginBtn.onclick = showLogin;
    signupBtn.onclick = showSignup;
  }
}

/* =========================================================
   حساب المريض
   ========================================================= */

async function showAccount() {
  let appointments = [];

  try {
    const data =
      await apiRequest("/my-appointments");

    appointments =
      data.appointments ||
      data.data ||
      data ||
      [];

    if (!Array.isArray(appointments)) {
      appointments = [];
    }

  } catch {
    appointments = [];
  }

  const appointmentHtml = appointments.length
    ? appointments.map(a => `
        <div style="
          border:1px solid #e3e9ed;
          border-radius:12px;
          padding:12px;
          margin-bottom:10px;
          background:#fafcfd;
        ">
          <strong>${escapeHtml(
            a.doctor_name ||
            a.doctorName ||
            a.doctor ||
            "الطبيب"
          )}</strong>

          <div style="
            font-size:12px;
            color:#687984;
            margin-top:5px;
          ">
            ${escapeHtml(
              a.service_name ||
              a.serviceName ||
              a.service ||
              "موعد طبي"
            )}
          </div>

          <div style="
            font-size:12px;
            margin-top:5px;
          ">
            ${escapeHtml(a.date || "")}
            ${escapeHtml(a.time || "")}
          </div>

          <div style="
            margin-top:7px;
            font-size:12px;
            font-weight:700;
            color:#07527c;
          ">
            الحالة: ${escapeHtml(
              a.status || "قيد المراجعة"
            )}
          </div>
        </div>
      `).join("")
    : `
      <div style="
        text-align:center;
        padding:20px;
        color:#71808b;
        font-size:13px;
      ">
        لا توجد حجوزات حتى الآن.
      </div>
    `;

  createModal(
    "حسابي",
    `
      ${formStyles}

      <div style="
        background:#f5f9fb;
        border-radius:14px;
        padding:16px;
        margin-bottom:20px;
      ">
        <strong style="color:#07527c;">
          ${escapeHtml(
            currentUser?.name ||
            currentUser?.full_name ||
            "المريض"
          )}
        </strong>

        <div style="
          color:#6c7c85;
          font-size:12px;
          margin-top:5px;
        ">
          ${escapeHtml(
            currentUser?.phone ||
            ""
          )}
        </div>
      </div>

      <h3 style="
        color:#07527c;
        font-size:16px;
        margin-bottom:12px;
      ">
        مواعيدي
      </h3>

      ${appointmentHtml}
    `
  );
}

/* =========================================================
   تسجيل الخروج
   ========================================================= */

async function logoutPatient() {
  try {
    if (authToken) {
      await apiRequest("/logout", {
        method: "POST"
      });
    }
  } catch {
    // حتى لو فشل الطلب، نمسح الجلسة المحلية
  }

  authToken = null;
  currentUser = null;

  localStorage.removeItem(
    "medical_booking_token"
  );

  updateAccountButtons();

  showMessage("تم تسجيل الخروج بنجاح.");
}

/* =========================================================
   نافذة حجز الموعد
   ========================================================= */

async function showBooking(doctorName, doctorSpecialty) {
  if (!authToken || !currentUser) {
    showMessage(
      "يرجى تسجيل الدخول أولاً حتى تتمكن من حجز الموعد.",
      "error"
    );

    showLogin();
    return;
  }

  let services = [];

  try {
    const data =
      await apiRequest("/services");

    services =
      data.services ||
      data.data ||
      data ||
      [];

    if (!Array.isArray(services)) {
      services = [];
    }

  } catch {
    services = [];
  }

  const serviceOptions = services.length
    ? services.map(service => `
        <option value="${escapeHtml(
          service.id || service.name
        )}">
          ${escapeHtml(
            service.name ||
            service.title ||
            "خدمة طبية"
          )}
        </option>
      `).join("")
    : `
        <option value="كشف طبي">كشف طبي</option>
        <option value="استشارة">استشارة</option>
        <option value="متابعة">متابعة</option>
      `;

  const modal = createModal(
    "حجز موعد طبي",
    `
      ${formStyles}

      <div style="
        background:#f5f9fb;
        border-radius:12px;
        padding:12px;
        margin-bottom:18px;
        text-align:center;
      ">
        <strong style="color:#07527c;">
          ${escapeHtml(doctorName)}
        </strong>
        <div style="
          font-size:12px;
          color:#71808b;
          margin-top:4px;
        ">
          ${escapeHtml(doctorSpecialty)}
        </div>
      </div>

      <form id="bookingForm">

        <div class="mb-field">
          <label>نوع الخدمة</label>
          <select id="bookingService" required>
            ${serviceOptions}
          </select>
        </div>

        <div class="mb-field">
          <label>التاريخ</label>
          <input
            id="bookingDate"
            type="date"
            required
          >
        </div>

        <div class="mb-field">
          <label>الوقت</label>
          <input
            id="bookingTime"
            type="time"
            required
          >
        </div>

        <div class="mb-field">
          <label>ملاحظات إضافية</label>
          <input
            id="bookingNotes"
            type="text"
            placeholder="اختياري"
          >
        </div>

        <div id="bookingError"></div>

        <button class="mb-submit" type="submit">
          تأكيد حجز الموعد
        </button>

      </form>
    `
  );

  const dateInput =
    modal.querySelector("#bookingDate");

  if (dateInput) {
    const today =
      new Date().toISOString().split("T")[0];

    dateInput.min = today;
  }

  modal
    .querySelector("#bookingForm")
    ?.addEventListener(
      "submit",
      event =>
        createAppointment(
          event,
          doctorName,
          doctorSpecialty
        )
    );
}

/* =========================================================
   إنشاء الموعد
   ========================================================= */

async function createAppointment(
  event,
  doctorName,
  doctorSpecialty
) {
  event.preventDefault();

  const service =
    document.getElementById("bookingService").value;

  const date =
    document.getElementById("bookingDate").value;

  const time =
    document.getElementById("bookingTime").value;

  const notes =
    document.getElementById("bookingNotes").value.trim();

  const errorBox =
    document.getElementById("bookingError");

  const button =
    event.target.querySelector("button[type='submit']");

  errorBox.innerHTML = "";

  button.disabled = true;
  button.textContent = "جاري إرسال الحجز...";

  try {
    await apiRequest("/appointments", {
      method: "POST",
      body: JSON.stringify({
        doctorName,
        doctorSpecialty,
        service,
        date,
        time,
        notes
      })
    });

    closeModal();

    showMessage(
      "تم إرسال طلب حجز الموعد بنجاح. سيتم تأكيده من الجهة الطبية."
    );

  } catch (error) {
    errorBox.innerHTML =
      `<div class="mb-error">${escapeHtml(error.message)}</div>`;

    button.disabled = false;
    button.textContent = "تأكيد حجز الموعد";
  }
}

/* =========================================================
   أزرار حجز الطبيب
   ========================================================= */

document.querySelectorAll(".book").forEach(btn => {

  btn.addEventListener("click", event => {

    event.preventDefault();

    const card =
      btn.closest(".doctor-card");

    if (!card) return;

    const doctorName =
      card.dataset.name ||
      card.querySelector("h3")?.textContent ||
      "الطبيب";

    const doctorSpecialty =
      card.dataset.specialty ||
      card.querySelector("span")?.textContent ||
      "تخصص طبي";

    showBooking(
      doctorName,
      doctorSpecialty
    );
  });

});

/* =========================================================
   أزرار تسجيل الدخول وإنشاء الحساب
   ========================================================= */

document.getElementById("loginBtn")?.addEventListener(
  "click",
  event => {
    event.preventDefault();

    if (authToken && currentUser) {
      showAccount();
    } else {
      showLogin();
    }
  }
);

document.getElementById("signupBtn")?.addEventListener(
  "click",
  event => {
    event.preventDefault();

    if (authToken && currentUser) {
      logoutPatient();
    } else {
      showSignup();
    }
  }
);

/* =========================================================
   بدء التطبيق
   ========================================================= */

loadCurrentUser();

/* =========================================================
   موعدي - Frontend Application
========================================================= */

const API = "/api";

/* =========================================================
   STORAGE
========================================================= */

function getToken() {
  return localStorage.getItem("medical_booking_token") || "";
}

function getRefreshToken() {
  return localStorage.getItem("medical_booking_refresh_token") || "";
}

function getCurrentUser() {
  try {
    return JSON.parse(
      localStorage.getItem("medical_booking_user") || "null"
    );
  } catch {
    return null;
  }
}

function saveSession(data) {
  if (data?.token) {
    localStorage.setItem(
      "medical_booking_token",
      data.token
    );
  }

  if (data?.refreshToken) {
    localStorage.setItem(
      "medical_booking_refresh_token",
      data.refreshToken
    );
  }

  if (data?.user) {
    localStorage.setItem(
      "medical_booking_user",
      JSON.stringify(data.user)
    );
  }

  if (data?.patient) {
    localStorage.setItem(
      "medical_booking_patient",
      JSON.stringify(data.patient)
    );
  }
}

function clearSession() {
  localStorage.removeItem("medical_booking_token");
  localStorage.removeItem("medical_booking_refresh_token");
  localStorage.removeItem("medical_booking_user");
  localStorage.removeItem("medical_booking_patient");
}

/* =========================================================
   API HELPER
========================================================= */

async function apiFetch(url, options = {}) {
  const headers = {
    ...(options.headers || {})
  };

  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const token = getToken();

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;

  try {
    response = await fetch(`${API}${url}`, {
      ...options,
      headers
    });
  } catch (error) {
    throw new Error(
      "تعذر الاتصال بالخادم. تأكد من اتصال الإنترنت."
    );
  }

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      data.error ||
      data.message ||
      "حدث خطأ غير متوقع"
    );
  }

  return data;
}

/* =========================================================
   MOBILE MENU
========================================================= */

const menu = document.getElementById("mobileMenu");
const nav = document.querySelector(".nav");

menu?.addEventListener("click", () => {
  const isOpen = nav.style.display === "flex";

  nav.style.display = isOpen ? "none" : "flex";
  nav.style.position = "absolute";
  nav.style.top = "66px";
  nav.style.right = "0";
  nav.style.left = "0";
  nav.style.background = "#07517b";
  nav.style.padding = "12px 20px";
  nav.style.flexDirection = "column";
  nav.style.gap = "5px";
});

/* إغلاق القائمة بعد اختيار رابط */
document.querySelectorAll(".nav a").forEach(link => {
  link.addEventListener("click", () => {
    if (window.innerWidth <= 850) {
      nav.style.display = "none";
    }
  });
});

/* =========================================================
   SPECIALTIES
========================================================= */

document.querySelectorAll(".specialty-card").forEach(card => {
  card.addEventListener("click", () => {
    const specialty = card.dataset.specialty || "";

    const specialtySelect =
      document.getElementById("specialty");

    if (specialtySelect) {
      specialtySelect.value = specialty;
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
   SEARCH
========================================================= */

const searchForm =
  document.getElementById("searchForm");

searchForm?.addEventListener("submit", async event => {
  event.preventDefault();

  const name =
    document.getElementById("searchName")
      ?.value
      .trim() || "";

  const specialty =
    document.getElementById("specialty")
      ?.value || "";

  const area =
    document.getElementById("area")
      ?.value || "";

  const cards = [
    ...document.querySelectorAll(".doctor-card")
  ];

  let count = 0;

  cards.forEach(card => {
    const doctorName =
      card.dataset.name || "";

    const doctorSpecialty =
      card.dataset.specialty || "";

    const matchesName =
      !name ||
      doctorName.includes(name) ||
      doctorSpecialty.includes(name);

    const matchesSpecialty =
      !specialty ||
      doctorSpecialty === specialty;

    const visible =
      matchesName &&
      matchesSpecialty;

    card.style.display =
      visible ? "flex" : "none";

    if (visible) {
      count++;
    }
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

    result.textContent =
      count
        ? `تم العثور على ${count} طبيب مطابق للبحث${area ? ` في ${area}` : ""}.`
        : "لا توجد نتائج مطابقة حالياً.";

    setTimeout(() => {
      result.hidden = true;
    }, 3000);
  }
});

/* =========================================================
   MODAL
========================================================= */

function removeModal() {
  document
    .getElementById("medicalBookingModal")
    ?.remove();
}

function createModal(content) {
  removeModal();

  const overlay =
    document.createElement("div");

  overlay.id =
    "medicalBookingModal";

  overlay.innerHTML = `
    <div class="mb-modal-overlay">
      <div class="mb-modal">
        <button class="mb-close" id="mbClose">×</button>
        ${content}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document
    .getElementById("mbClose")
    ?.addEventListener(
      "click",
      removeModal
    );

  overlay
    .querySelector(".mb-modal-overlay")
    ?.addEventListener("click", event => {
      if (
        event.target.classList.contains(
          "mb-modal-overlay"
        )
      ) {
        removeModal();
      }
    });

  return overlay;
}

/* =========================================================
   MODAL STYLE
========================================================= */

function injectModalStyles() {
  if (
    document.getElementById(
      "medicalBookingModalStyles"
    )
  ) {
    return;
  }

  const style =
    document.createElement("style");

  style.id =
    "medicalBookingModalStyles";

  style.textContent = `
    .mb-modal-overlay {
      position: fixed;
      inset: 0;
      z-index: 99999;
      background: rgba(0, 0, 0, .58);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px;
      direction: rtl;
    }

    .mb-modal {
      position: relative;
      width: min(470px, 100%);
      max-height: 92vh;
      overflow-y: auto;
      background: #fff;
      border-radius: 22px;
      padding: 28px;
      box-shadow: 0 25px 80px rgba(0,0,0,.25);
      font-family: Cairo, sans-serif;
    }

    .mb-close {
      position: absolute;
      top: 10px;
      left: 12px;
      border: 0;
      background: transparent;
      font-size: 30px;
      cursor: pointer;
      color: #777;
      line-height: 1;
    }

    .mb-title {
      color: #07527c;
      margin: 0 0 6px;
      font-size: 25px;
      font-weight: 800;
    }

    .mb-subtitle {
      color: #777;
      margin: 0 0 22px;
      font-size: 14px;
    }

    .mb-form-group {
      margin-bottom: 14px;
    }

    .mb-form-group label {
      display: block;
      margin-bottom: 6px;
      color: #333;
      font-size: 14px;
      font-weight: 700;
    }

    .mb-form-group input,
    .mb-form-group select,
    .mb-form-group textarea {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #d8e0e5;
      border-radius: 11px;
      padding: 12px 13px;
      font-family: Cairo, sans-serif;
      font-size: 14px;
      outline: none;
      background: #fff;
    }

    .mb-form-group input:focus,
    .mb-form-group select:focus,
    .mb-form-group textarea:focus {
      border-color: #07527c;
      box-shadow: 0 0 0 3px rgba(7,82,124,.08);
    }

    .mb-submit {
      width: 100%;
      border: 0;
      border-radius: 12px;
      padding: 13px;
      background: #07527c;
      color: white;
      font-family: Cairo, sans-serif;
      font-size: 15px;
      font-weight: 800;
      cursor: pointer;
      margin-top: 8px;
    }

    .mb-submit:hover {
      opacity: .92;
    }

    .mb-submit:disabled {
      opacity: .6;
      cursor: not-allowed;
    }

    .mb-switch {
      text-align: center;
      margin-top: 17px;
      font-size: 13px;
      color: #777;
    }

    .mb-switch button {
      border: 0;
      background: none;
      color: #07527c;
      font-family: Cairo, sans-serif;
      font-weight: 800;
      cursor: pointer;
    }

    .mb-message {
      border-radius: 10px;
      padding: 10px 12px;
      margin-bottom: 14px;
      font-size: 13px;
      display: none;
    }

    .mb-message.error {
      display: block;
      background: #fff0f0;
      color: #b42318;
    }

    .mb-message.success {
      display: block;
      background: #edfdf3;
      color: #067647;
    }

    .mb-user-box {
      background: #f4f8fa;
      border-radius: 14px;
      padding: 15px;
      margin-bottom: 18px;
    }

    .mb-user-box strong {
      color: #07527c;
    }

    .mb-appointment-success {
      text-align: center;
      padding: 15px 5px;
    }

    .mb-success-icon {
      font-size: 45px;
      margin-bottom: 8px;
    }

    .mb-appointment-success h3 {
      color: #07527c;
      margin: 5px 0 8px;
    }

    .mb-appointment-success p {
      color: #666;
      font-size: 14px;
      line-height: 1.8;
    }
  `;

  document.head.appendChild(style);
}

injectModalStyles();

/* =========================================================
   REGISTER MODAL
========================================================= */

function showRegisterModal() {
  const modal = createModal(`
    <h2 class="mb-title">إنشاء حساب</h2>
    <p class="mb-subtitle">
      أنشئ حسابك في منصة موعدي وابدأ بحجز مواعيدك الطبية.
    </p>

    <div class="mb-message" id="registerMessage"></div>

    <form id="registerForm">

      <div class="mb-form-group">
        <label for="registerUsername">
          اسم المستخدم
        </label>
        <input
          id="registerUsername"
          name="username"
          type="text"
          placeholder="مثال: mahir123"
          autocomplete="username"
          required
          minlength="3"
        >
      </div>

      <div class="mb-form-group">
        <label for="registerFullName">
          الاسم الكامل
        </label>
        <input
          id="registerFullName"
          name="full_name"
          type="text"
          placeholder="اكتب اسمك الكامل"
          autocomplete="name"
          required
          minlength="2"
        >
      </div>

      <div class="mb-form-group">
        <label for="registerPhone">
          رقم الهاتف
        </label>
        <input
          id="registerPhone"
          name="phone"
          type="tel"
          placeholder="مثال: 09xxxxxxxx"
          autocomplete="tel"
          required
        >
      </div>

      <div class="mb-form-group">
        <label for="registerEmail">
          البريد الإلكتروني
          <span style="font-weight:400;color:#999;">
            (اختياري)
          </span>
        </label>
        <input
          id="registerEmail"
          name="email"
          type="email"
          placeholder="example@email.com"
          autocomplete="email"
        >
      </div>

      <div class="mb-form-group">
        <label for="registerPassword">
          كلمة المرور
        </label>
        <input
          id="registerPassword"
          name="password"
          type="password"
          placeholder="6 أحرف على الأقل"
          autocomplete="new-password"
          required
          minlength="6"
        >
      </div>

      <div class="mb-form-group">
        <label for="registerPasswordConfirm">
          تأكيد كلمة المرور
        </label>
        <input
          id="registerPasswordConfirm"
          name="password_confirm"
          type="password"
          placeholder="أعد كتابة كلمة المرور"
          autocomplete="new-password"
          required
        >
      </div>

      <button
        type="submit"
        class="mb-submit"
        id="registerSubmit"
      >
        إنشاء الحساب
      </button>

    </form>

    <div class="mb-switch">
      لديك حساب بالفعل؟
      <button type="button" id="switchToLogin">
        تسجيل الدخول
      </button>
    </div>
  `);

  modal
    .querySelector("#switchToLogin")
    ?.addEventListener(
      "click",
      showLoginModal
    );

  modal
    .querySelector("#registerForm")
    ?.addEventListener(
      "submit",
      handleRegister
    );
}

/* =========================================================
   REGISTER HANDLER
========================================================= */

async function handleRegister(event) {
  event.preventDefault();

  const form = event.currentTarget;

  const username =
    form.username.value.trim();

  const fullName =
    form.full_name.value.trim();

  const phone =
    form.phone.value.trim();

  const email =
    form.email.value.trim();

  const password =
    form.password.value;

  const confirmPassword =
    form.password_confirm.value;

  const message =
    document.getElementById(
      "registerMessage"
    );

  const submit =
    document.getElementById(
      "registerSubmit"
    );

  if (password !== confirmPassword) {
    message.className =
      "mb-message error";

    message.textContent =
      "كلمتا المرور غير متطابقتين.";

    return;
  }

  if (password.length < 6) {
    message.className =
      "mb-message error";

    message.textContent =
      "كلمة المرور يجب أن تكون 6 أحرف على الأقل.";

    return;
  }

  submit.disabled = true;
  submit.textContent =
    "جاري إنشاء الحساب...";

  message.className =
    "mb-message";

  try {
    const data =
      await apiFetch(
        "/patient/register",
        {
          method: "POST",
          body: JSON.stringify({
            username,
            full_name: fullName,
            phone,
            email: email || null,
            password
          })
        }
      );

    saveSession(data);

    message.className =
      "mb-message success";

    message.textContent =
      "تم إنشاء الحساب بنجاح.";

    setTimeout(() => {
      removeModal();

      updateAccountButtons();

      showWelcomeMessage(
        `مرحباً ${data.patient?.full_name || fullName}، تم إنشاء حسابك بنجاح.`
      );
    }, 700);

  } catch (error) {
    message.className =
      "mb-message error";

    message.textContent =
      error.message ||
      "تعذر إنشاء الحساب.";

    submit.disabled = false;
    submit.textContent =
      "إنشاء الحساب";
  }
}

/* =========================================================
   LOGIN MODAL
========================================================= */

function showLoginModal() {
  const modal = createModal(`
    <h2 class="mb-title">تسجيل الدخول</h2>
    <p class="mb-subtitle">
      أدخل اسم المستخدم وكلمة المرور للدخول إلى حسابك.
    </p>

    <div class="mb-message" id="loginMessage"></div>

    <form id="loginForm">

      <div class="mb-form-group">
        <label for="loginUsername">
          اسم المستخدم
        </label>
        <input
          id="loginUsername"
          name="username"
          type="text"
          placeholder="اسم المستخدم"
          autocomplete="username"
          required
        >
      </div>

      <div class="mb-form-group">
        <label for="loginPassword">
          كلمة المرور
        </label>
        <input
          id="loginPassword"
          name="password"
          type="password"
          placeholder="كلمة المرور"
          autocomplete="current-password"
          required
        >
      </div>

      <button
        type="submit"
        class="mb-submit"
        id="loginSubmit"
      >
        تسجيل الدخول
      </button>

    </form>

    <div class="mb-switch">
      ليس لديك حساب؟
      <button type="button" id="switchToRegister">
        إنشاء حساب جديد
      </button>
    </div>
  `);

  modal
    .querySelector("#switchToRegister")
    ?.addEventListener(
      "click",
      showRegisterModal
    );

  modal
    .querySelector("#loginForm")
    ?.addEventListener(
      "submit",
      handleLogin
    );
}

/* =========================================================
   LOGIN HANDLER
========================================================= */

async function handleLogin(event) {
  event.preventDefault();

  const form =
    event.currentTarget;

  const username =
    form.username.value.trim();

  const password =
    form.password.value;

  const message =
    document.getElementById(
      "loginMessage"
    );

  const submit =
    document.getElementById(
      "loginSubmit"
    );

  submit.disabled = true;
  submit.textContent =
    "جاري تسجيل الدخول...";

  try {
    const data =
      await apiFetch(
        "/patient/login",
        {
          method: "POST",
          body: JSON.stringify({
            username,
            password
          })
        }
      );

    saveSession(data);

    removeModal();

    updateAccountButtons();

    showWelcomeMessage(
      `مرحباً ${data.patient?.full_name || data.user?.username || ""}`
    );

  } catch (error) {
    message.className =
      "mb-message error";

    message.textContent =
      error.message ||
      "تعذر تسجيل الدخول.";

    submit.disabled = false;
    submit.textContent =
      "تسجيل الدخول";
  }
}

/* =========================================================
   WELCOME MESSAGE
========================================================= */

function showWelcomeMessage(text) {
  const box =
    document.createElement("div");

  box.style.cssText = `
    position:fixed;
    top:85px;
    right:20px;
    z-index:100000;
    background:#07527c;
    color:#fff;
    padding:13px 18px;
    border-radius:12px;
    box-shadow:0 10px 30px rgba(0,0,0,.18);
    font-family:Cairo,sans-serif;
    font-size:14px;
    max-width:90%;
  `;

  box.textContent = text;

  document.body.appendChild(box);

  setTimeout(() => {
    box.remove();
  }, 3500);
}

/* =========================================================
   ACCOUNT BUTTONS
========================================================= */

function updateAccountButtons() {
  const loginBtn =
    document.getElementById("loginBtn");

  const signupBtn =
    document.getElementById("signupBtn");

  const user =
    getCurrentUser();

  if (!loginBtn || !signupBtn) {
    return;
  }

  if (user) {
    loginBtn.innerHTML =
      "حسابي <span>♙</span>";

    signupBtn.textContent =
      "تسجيل الخروج";

    loginBtn.onclick =
      showAccountModal;

    signupBtn.onclick =
      handleLogout;
  } else {
    loginBtn.innerHTML =
      "تسجيل الدخول <span>♙</span>";

    signupBtn.innerHTML =
      "إنشاء حساب <span>♙</span>";

    loginBtn.onclick =
      showLoginModal;

    signupBtn.onclick =
      showRegisterModal;
  }
}

/* =========================================================
   ACCOUNT MODAL
========================================================= */

function showAccountModal() {
  const user =
    getCurrentUser();

  let patient = null;

  try {
    patient =
      JSON.parse(
        localStorage.getItem(
          "medical_booking_patient"
        ) || "null"
      );
  } catch {}

  createModal(`
    <h2 class="mb-title">حسابي</h2>

    <div class="mb-user-box">
      <div>
        <strong>اسم المستخدم:</strong>
        ${escapeHtml(user?.username || "")}
      </div>

      <div style="margin-top:7px;">
        <strong>الاسم:</strong>
        ${escapeHtml(patient?.full_name || "")}
      </div>

      <div style="margin-top:7px;">
        <strong>الهاتف:</strong>
        ${escapeHtml(patient?.phone || "")}
      </div>
    </div>

    <button
      class="mb-submit"
      id="myAppointmentsBtn"
      type="button"
    >
      مواعيدي
    </button>
  `);

  document
    .getElementById(
      "myAppointmentsBtn"
    )
    ?.addEventListener(
      "click",
      showMyAppointments
    );
}

/* =========================================================
   LOGOUT
========================================================= */

async function handleLogout() {
  try {
    if (getToken()) {
      await apiFetch(
        "/logout",
        {
          method: "POST"
        }
      );
    }
  } catch {
    // Even if the server request fails,
    // remove the local session.
  }

  clearSession();

  updateAccountButtons();

  showWelcomeMessage(
    "تم تسجيل الخروج بنجاح."
  );
}

/* =========================================================
   MY APPOINTMENTS
========================================================= */

async function showMyAppointments() {
  const modal =
    createModal(`
      <h2 class="mb-title">مواعيدي</h2>
      <p class="mb-subtitle">
        جاري تحميل مواعيدك...
      </p>
      <div id="appointmentsContent"></div>
    `);

  const content =
    modal.querySelector(
      "#appointmentsContent"
    );

  try {
    const data =
      await apiFetch(
        "/my-appointments"
      );

    const appointments =
      data.appointments || [];

    if (!appointments.length) {
      content.innerHTML = `
        <div style="
          text-align:center;
          padding:25px 5px;
          color:#777;
        ">
          لا توجد مواعيد محجوزة حالياً.
        </div>
      `;

      return;
    }

    content.innerHTML =
      appointments.map(
        appointment => `
          <div style="
            border:1px solid #e1e7eb;
            border-radius:14px;
            padding:14px;
            margin-bottom:10px;
            background:#fafcfd;
          ">
            <strong style="color:#07527c;">
              ${escapeHtml(
                appointment.service_name ||
                "موعد طبي"
              )}
            </strong>

            <div style="
              margin-top:7px;
              color:#555;
              font-size:13px;
            ">
              التاريخ:
              ${escapeHtml(
                appointment.appointment_date || ""
              )}
            </div>

            <div style="
              margin-top:4px;
              color:#555;
              font-size:13px;
            ">
              الوقت:
              ${escapeHtml(
                appointment.appointment_time || ""
              )}
            </div>

            <div style="
              margin-top:7px;
              font-weight:700;
              color:${getStatusColor(
                appointment.status
              )};
            ">
              ${getStatusText(
                appointment.status
              )}
            </div>
          </div>
        `
      ).join("");

  } catch (error) {
    content.innerHTML = `
      <div class="mb-message error" style="display:block;">
        ${escapeHtml(
          error.message ||
          "تعذر تحميل المواعيد."
        )}
      </div>
    `;
  }
}

/* =========================================================
   STATUS
========================================================= */

function getStatusText(status) {
  const statuses = {
    pending: "قيد الانتظار",
    confirmed: "تم تأكيد الموعد",
    cancelled: "تم إلغاء الموعد"
  };

  return (
    statuses[status] ||
    status ||
    "غير معروف"
  );
}

function getStatusColor(status) {
  if (status === "confirmed") {
    return "#067647";
  }

  if (status === "cancelled") {
    return "#b42318";
  }

  return "#b54708";
}

/* =========================================================
   BOOKING
========================================================= */

document.querySelectorAll(".book").forEach(btn => {
  btn.addEventListener("click", async event => {
    event.preventDefault();

    const card =
      btn.closest(".doctor-card");

    const doctorName =
      card?.dataset.name || "";

    const doctorSpecialty =
      card?.dataset.specialty || "";

    if (!getToken()) {
      showLoginModal();

      showWelcomeMessage(
        "يرجى تسجيل الدخول أولاً لحجز موعد."
      );

      return;
    }

    await showBookingModal(
      doctorName,
      doctorSpecialty
    );
  });
});

/* =========================================================
   BOOKING MODAL
========================================================= */

async function showBookingModal(
  doctorName = "",
  doctorSpecialty = ""
) {
  let services = [];

  try {
    const data =
      await apiFetch("/services");

    services =
      data.services || [];
  } catch (error) {
    showWelcomeMessage(
      error.message ||
      "تعذر تحميل الخدمات."
    );

    return;
  }

  const modal =
    createModal(`
      <h2 class="mb-title">
        حجز موعد
      </h2>

      <p class="mb-subtitle">
        ${doctorName
          ? `الطبيب: ${escapeHtml(doctorName)}`
          : "اختر تفاصيل الموعد"}
      </p>

      <div class="mb-message" id="bookingMessage"></div>

      <form id="bookingForm">

        <div class="mb-form-group">
          <label>
            الخدمة الطبية
          </label>

          <select
            id="bookingService"
            required
          >
            <option value="">
              اختر الخدمة
            </option>

            ${services.map(
              service => `
                <option value="${escapeHtml(
                  service.id
                )}">
                  ${escapeHtml(
                    service.name
                  )}
                  ${
                    service.price != null
                      ? ` - ${escapeHtml(
                          String(service.price)
                        )}`
                      : ""
                  }
                </option>
              `
            ).join("")}
          </select>
        </div>

        <div class="mb-form-group">
          <label>
            التاريخ
          </label>

          <input
            id="bookingDate"
            type="date"
            required
          >
        </div>

        <div class="mb-form-group">
          <label>
            الوقت
          </label>

          <input
            id="bookingTime"
            type="time"
            required
          >
        </div>

        <div class="mb-form-group">
          <label>
            ملاحظات
            <span style="font-weight:400;color:#999;">
              (اختياري)
            </span>
          </label>

          <textarea
            id="bookingNotes"
            rows="3"
            placeholder="أي ملاحظات ترغب في إضافتها..."
          ></textarea>
        </div>

        <button
          type="submit"
          class="mb-submit"
          id="bookingSubmit"
        >
          تأكيد طلب الحجز
        </button>

      </form>
    `);

  const dateInput =
    modal.querySelector(
      "#bookingDate"
    );

  const today =
    new Date()
      .toISOString()
      .slice(0, 10);

  dateInput.min = today;

  modal
    .querySelector("#bookingForm")
    ?.addEventListener(
      "submit",
      async event => {
        event.preventDefault();

        const message =
          modal.querySelector(
            "#bookingMessage"
          );

        const submit =
          modal.querySelector(
            "#bookingSubmit"
          );

        const serviceId =
          modal.querySelector(
            "#bookingService"
          ).value;

        const date =
          modal.querySelector(
            "#bookingDate"
          ).value;

        const time =
          modal.querySelector(
            "#bookingTime"
          ).value;

        const notes =
          modal.querySelector(
            "#bookingNotes"
          ).value.trim();

        submit.disabled = true;
        submit.textContent =
          "جاري إرسال طلب الحجز...";

        try {
          const data =
            await apiFetch(
              "/appointments",
              {
                method: "POST",
                body: JSON.stringify({
                  service_id: serviceId,
                  doctor_id: null,
                  appointment_date: date,
                  appointment_time: time,
                  notes
                })
              }
            );

          modal.querySelector(
            ".mb-modal"
          ).innerHTML = `
            <button
              class="mb-close"
              id="mbClose"
            >
              ×
            </button>

            <div class="mb-appointment-success">

              <div class="mb-success-icon">
                ✓
              </div>

              <h3>
                تم إرسال طلب الحجز
              </h3>

              <p>
                تم استلام طلب موعدك بنجاح.
                سيظهر الموعد في حسابك بعد إرساله.
              </p>

              <button
                class="mb-submit"
                id="closeBookingSuccess"
                type="button"
              >
                حسناً
              </button>

            </div>
          `;

          modal
            .querySelector("#mbClose")
            ?.addEventListener(
              "click",
              removeModal
            );

          modal
            .querySelector(
              "#closeBookingSuccess"
            )
            ?.addEventListener(
              "click",
              removeModal
            );

        } catch (error) {
          message.className =
            "mb-message error";

          message.textContent =
            error.message ||
            "تعذر إرسال طلب الحجز.";

          submit.disabled = false;
          submit.textContent =
            "تأكيد طلب الحجز";
        }
      }
    );
}

/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* =========================================================
   INITIALIZE
========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  () => {
    updateAccountButtons();
  }
);

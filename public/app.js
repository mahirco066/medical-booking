/* =========================================================
   موعدي - Medical Booking
   public/app.js
   Dynamic doctors + real booking + patient authentication
   ========================================================= */

(() => {
  "use strict";

  const API = "/api";

  const STORAGE = {
    token: "medical_booking_token",
    refreshToken: "medical_booking_refresh_token",
    user: "medical_booking_user",
    patient: "medical_booking_patient"
  };

  let doctors = [];
  let services = [];
  let selectedDoctor = null;

  /* =========================================================
     Basic helpers
     ========================================================= */

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) =>
    Array.from(root.querySelectorAll(selector));

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getToken() {
    return localStorage.getItem(STORAGE.token) || "";
  }

  function getStoredUser() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE.user) || "null");
    } catch {
      return null;
    }
  }

  function getStoredPatient() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE.patient) || "null");
    } catch {
      return null;
    }
  }

  function saveAuth(data) {
    if (!data) return;

    if (data.token) {
      localStorage.setItem(STORAGE.token, data.token);
    }

    if (data.refresh_token) {
      localStorage.setItem(STORAGE.refreshToken, data.refresh_token);
    }

    if (data.user) {
      localStorage.setItem(STORAGE.user, JSON.stringify(data.user));
    }

    if (data.patient) {
      localStorage.setItem(STORAGE.patient, JSON.stringify(data.patient));
    }
  }

  function clearAuth() {
    localStorage.removeItem(STORAGE.token);
    localStorage.removeItem(STORAGE.refreshToken);
    localStorage.removeItem(STORAGE.user);
    localStorage.removeItem(STORAGE.patient);
  }

  function notify(message, type = "info") {
    let box = document.getElementById("medicalBookingToast");

    if (!box) {
      box = document.createElement("div");
      box.id = "medicalBookingToast";

      Object.assign(box.style, {
        position: "fixed",
        top: "22px",
        right: "22px",
        zIndex: "99999",
        maxWidth: "360px",
        padding: "14px 18px",
        borderRadius: "14px",
        fontFamily: "Cairo, sans-serif",
        fontSize: "14px",
        lineHeight: "1.7",
        boxShadow: "0 10px 30px rgba(0,0,0,.15)",
        transition: "all .25s ease",
        opacity: "0",
        transform: "translateY(-10px)"
      });

      document.body.appendChild(box);
    }

    box.textContent = message;

    if (type === "success") {
      box.style.background = "#16a34a";
      box.style.color = "#fff";
    } else if (type === "error") {
      box.style.background = "#dc2626";
      box.style.color = "#fff";
    } else {
      box.style.background = "#0f766e";
      box.style.color = "#fff";
    }

    box.style.opacity = "1";
    box.style.transform = "translateY(0)";

    clearTimeout(box._timer);

    box._timer = setTimeout(() => {
      box.style.opacity = "0";
      box.style.transform = "translateY(-10px)";
    }, 3500);
  }

  /* =========================================================
     API helper
     ========================================================= */

  async function api(path, options = {}) {
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

    const response = await fetch(`${API}${path}`, {
      ...options,
      headers
    });

    let data = null;

    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      const message =
        data?.error ||
        data?.message ||
        "حدث خطأ أثناء تنفيذ الطلب.";

      const error = new Error(message);
      error.status = response.status;
      error.data = data;

      throw error;
    }

    return data;
  }

  /* =========================================================
     Modal system
     ========================================================= */

  function createModal(id, title, bodyHtml, width = "520px") {
    const old = document.getElementById(id);

    if (old) {
      old.remove();
    }

    const overlay = document.createElement("div");

    overlay.id = id;

    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(15, 23, 42, .62)",
      backdropFilter: "blur(5px)",
      WebkitBackdropFilter: "blur(5px)",
      zIndex: "9999",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px",
      direction: "rtl"
    });

    overlay.innerHTML = `
      <div class="mb-modal-box" style="
        width:min(100%, ${width});
        max-height:90vh;
        overflow:auto;
        background:#fff;
        border-radius:22px;
        box-shadow:0 25px 70px rgba(0,0,0,.25);
        font-family:Cairo,sans-serif;
      ">
        <div style="
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:15px;
          padding:20px 24px;
          border-bottom:1px solid #eef2f7;
        ">
          <h3 style="
            margin:0;
            color:#0f172a;
            font-size:20px;
            font-weight:800;
          ">${escapeHtml(title)}</h3>

          <button type="button"
            class="mb-close"
            style="
              width:38px;
              height:38px;
              border:0;
              border-radius:50%;
              background:#f1f5f9;
              color:#334155;
              font-size:23px;
              cursor:pointer;
            "
          >&times;</button>
        </div>

        <div style="padding:24px;">
          ${bodyHtml}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();

    $(".mb-close", overlay)?.addEventListener("click", close);

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        close();
      }
    });

    return overlay;
  }

  function fieldStyle() {
    return `
      width:100%;
      box-sizing:border-box;
      padding:12px 14px;
      border:1px solid #dbe3ec;
      border-radius:12px;
      outline:none;
      font-family:Cairo,sans-serif;
      font-size:14px;
      background:#fff;
      color:#0f172a;
    `;
  }

  function labelStyle() {
    return `
      display:block;
      margin-bottom:7px;
      color:#334155;
      font-size:13px;
      font-weight:700;
    `;
  }

  function primaryButtonStyle() {
    return `
      width:100%;
      border:0;
      border-radius:13px;
      padding:13px 18px;
      background:#0f766e;
      color:#fff;
      font-family:Cairo,sans-serif;
      font-size:15px;
      font-weight:800;
      cursor:pointer;
    `;
  }

  function secondaryButtonStyle() {
    return `
      width:100%;
      border:1px solid #dbe3ec;
      border-radius:13px;
      padding:12px 18px;
      background:#fff;
      color:#0f766e;
      font-family:Cairo,sans-serif;
      font-size:14px;
      font-weight:800;
      cursor:pointer;
    `;
  }

  /* =========================================================
     Registration
     ========================================================= */

  function openRegisterModal() {
    const modal = createModal(
      "registerModal",
      "إنشاء حساب جديد",
      `
        <form id="registerForm">

          <div style="margin-bottom:14px;">
            <label style="${labelStyle()}">اسم المستخدم</label>
            <input
              id="registerUsername"
              name="username"
              required
              autocomplete="username"
              placeholder="مثال: mahir123"
              style="${fieldStyle()}"
            >
          </div>

          <div style="margin-bottom:14px;">
            <label style="${labelStyle()}">الاسم الكامل</label>
            <input
              id="registerFullName"
              name="full_name"
              required
              autocomplete="name"
              placeholder="الاسم الكامل"
              style="${fieldStyle()}"
            >
          </div>

          <div style="margin-bottom:14px;">
            <label style="${labelStyle()}">رقم الهاتف</label>
            <input
              id="registerPhone"
              name="phone"
              required
              inputmode="tel"
              autocomplete="tel"
              placeholder="رقم الهاتف"
              style="${fieldStyle()}"
            >
          </div>

          <div style="margin-bottom:14px;">
            <label style="${labelStyle()}">البريد الإلكتروني <span style="font-weight:400;color:#94a3b8;">(اختياري)</span></label>
            <input
              id="registerEmail"
              name="email"
              type="email"
              autocomplete="email"
              placeholder="example@email.com"
              style="${fieldStyle()}"
            >
          </div>

          <div style="margin-bottom:14px;">
            <label style="${labelStyle()}">كلمة المرور</label>
            <input
              id="registerPassword"
              name="password"
              type="password"
              required
              minlength="6"
              autocomplete="new-password"
              placeholder="6 أحرف أو أكثر"
              style="${fieldStyle()}"
            >
          </div>

          <div style="margin-bottom:18px;">
            <label style="${labelStyle()}">تأكيد كلمة المرور</label>
            <input
              id="registerConfirmPassword"
              name="confirm_password"
              type="password"
              required
              minlength="6"
              autocomplete="new-password"
              placeholder="أعد كتابة كلمة المرور"
              style="${fieldStyle()}"
            >
          </div>

          <button type="submit" style="${primaryButtonStyle()}">
            إنشاء الحساب
          </button>

          <div style="
            text-align:center;
            margin-top:15px;
            color:#64748b;
            font-size:13px;
          ">
            لديك حساب بالفعل؟
            <button
              type="button"
              id="goToLogin"
              style="
                border:0;
                background:none;
                color:#0f766e;
                font-family:inherit;
                font-weight:800;
                cursor:pointer;
              "
            >تسجيل الدخول</button>
          </div>

        </form>
      `
    );

    $("#registerForm", modal)?.addEventListener("submit", handleRegister);

    $("#goToLogin", modal)?.addEventListener("click", () => {
      modal.remove();
      openLoginModal();
    });
  }

  async function handleRegister(event) {
    event.preventDefault();

    const username = $("#registerUsername")?.value.trim();
    const fullName = $("#registerFullName")?.value.trim();
    const phone = $("#registerPhone")?.value.trim();
    const email = $("#registerEmail")?.value.trim();
    const password = $("#registerPassword")?.value;
    const confirmPassword = $("#registerConfirmPassword")?.value;

    if (!username || !fullName || !phone || !password) {
      notify("يرجى تعبئة جميع الحقول المطلوبة.", "error");
      return;
    }

    if (password.length < 6) {
      notify("كلمة المرور يجب أن تكون 6 أحرف على الأقل.", "error");
      return;
    }

    if (password !== confirmPassword) {
      notify("كلمتا المرور غير متطابقتين.", "error");
      return;
    }

    const button = event.submitter;

    if (button) {
      button.disabled = true;
      button.textContent = "جارٍ إنشاء الحساب...";
    }

    try {
      const data = await api("/patient/register", {
        method: "POST",
        body: JSON.stringify({
          username,
          full_name: fullName,
          phone,
          email: email || null,
          password
        })
      });

      saveAuth(data);

      document.getElementById("registerModal")?.remove();

      updateAuthUI();

      notify(
        data.message || "تم إنشاء الحساب وتسجيل الدخول بنجاح.",
        "success"
      );
    } catch (error) {
      notify(error.message, "error");

      if (button) {
        button.disabled = false;
        button.textContent = "إنشاء الحساب";
      }
    }
  }

  /* =========================================================
     Login
     ========================================================= */

  function openLoginModal() {
    const modal = createModal(
      "loginModal",
      "تسجيل الدخول",
      `
        <form id="loginForm">

          <div style="margin-bottom:15px;">
            <label style="${labelStyle()}">اسم المستخدم</label>
            <input
              id="loginUsername"
              name="username"
              required
              autocomplete="username"
              placeholder="اسم المستخدم"
              style="${fieldStyle()}"
            >
          </div>

          <div style="margin-bottom:20px;">
            <label style="${labelStyle()}">كلمة المرور</label>
            <input
              id="loginPassword"
              name="password"
              type="password"
              required
              autocomplete="current-password"
              placeholder="كلمة المرور"
              style="${fieldStyle()}"
            >
          </div>

          <button type="submit" style="${primaryButtonStyle()}">
            تسجيل الدخول
          </button>

          <div style="
            text-align:center;
            margin-top:15px;
            color:#64748b;
            font-size:13px;
          ">
            ليس لديك حساب؟
            <button
              type="button"
              id="goToRegister"
              style="
                border:0;
                background:none;
                color:#0f766e;
                font-family:inherit;
                font-weight:800;
                cursor:pointer;
              "
            >إنشاء حساب</button>
          </div>

        </form>
      `
    );

    $("#loginForm", modal)?.addEventListener("submit", handleLogin);

    $("#goToRegister", modal)?.addEventListener("click", () => {
      modal.remove();
      openRegisterModal();
    });
  }

  async function handleLogin(event) {
    event.preventDefault();

    const username = $("#loginUsername")?.value.trim();
    const password = $("#loginPassword")?.value;

    if (!username || !password) {
      notify("أدخل اسم المستخدم وكلمة المرور.", "error");
      return;
    }

    const button = event.submitter;

    if (button) {
      button.disabled = true;
      button.textContent = "جارٍ تسجيل الدخول...";
    }

    try {
      const data = await api("/patient/login", {
        method: "POST",
        body: JSON.stringify({
          username,
          password
        })
      });

      saveAuth(data);

      document.getElementById("loginModal")?.remove();

      updateAuthUI();

      notify(
        data.message || "تم تسجيل الدخول بنجاح.",
        "success"
      );
    } catch (error) {
      notify(error.message, "error");

      if (button) {
        button.disabled = false;
        button.textContent = "تسجيل الدخول";
      }
    }
  }

  /* =========================================================
     Account modal
     ========================================================= */

  async function openAccountModal() {
    let patient = getStoredPatient();
    const user = getStoredUser();

    if (!getToken()) {
      openLoginModal();
      return;
    }

    try {
      const data = await api("/patient/me");

      if (data?.patient) {
        patient = data.patient;
        localStorage.setItem(
          STORAGE.patient,
          JSON.stringify(patient)
        );
      }
    } catch {
      // Use cached data if request fails.
    }

    const modal = createModal(
      "accountModal",
      "حسابي",
      `
        <div style="
          background:linear-gradient(135deg,#f0fdfa,#ecfeff);
          border:1px solid #ccfbf1;
          border-radius:18px;
          padding:20px;
          margin-bottom:18px;
        ">

          <div style="
            width:58px;
            height:58px;
            border-radius:50%;
            background:#0f766e;
            color:#fff;
            display:flex;
            align-items:center;
            justify-content:center;
            font-size:24px;
            font-weight:800;
            margin-bottom:12px;
          ">
            ${(patient?.full_name || user?.username || "م").charAt(0)}
          </div>

          <div style="
            font-size:18px;
            font-weight:800;
            color:#0f172a;
          ">
            ${escapeHtml(patient?.full_name || user?.username || "المستخدم")}
          </div>

          <div style="
            margin-top:5px;
            color:#64748b;
            font-size:13px;
          ">
            اسم المستخدم:
            ${escapeHtml(
              patient?.username ||
              user?.username ||
              ""
            )}
          </div>

          ${
            patient?.phone
              ? `
                <div style="
                  margin-top:5px;
                  color:#64748b;
                  font-size:13px;
                ">
                  الهاتف: ${escapeHtml(patient.phone)}
                </div>
              `
              : ""
          }

          ${
            patient?.email
              ? `
                <div style="
                  margin-top:5px;
                  color:#64748b;
                  font-size:13px;
                ">
                  البريد: ${escapeHtml(patient.email)}
                </div>
              `
              : ""
          }

        </div>

        <div style="display:grid;gap:10px;">

          <button
            type="button"
            id="myAppointmentsBtn"
            style="${primaryButtonStyle()}"
          >
            📅 مواعيدي
          </button>

          <button
            type="button"
            id="logoutBtn"
            style="
              ${secondaryButtonStyle()}
              color:#dc2626;
              border-color:#fecaca;
            "
          >
            تسجيل الخروج
          </button>

        </div>
      `
    );

    $("#myAppointmentsBtn", modal)?.addEventListener(
      "click",
      async () => {
        modal.remove();
        await openMyAppointments();
      }
    );

    $("#logoutBtn", modal)?.addEventListener(
      "click",
      logout
    );
  }

  async function logout() {
    try {
      if (getToken()) {
        await api("/logout", {
          method: "POST"
        });
      }
    } catch {
      // Clear local session anyway.
    }

    clearAuth();

    document
      .querySelectorAll(
        "#accountModal,#loginModal,#registerModal,#appointmentsModal,#bookingModal"
      )
      .forEach((element) => element.remove());

    updateAuthUI();

    notify("تم تسجيل الخروج.", "success");
  }

  /* =========================================================
     Authentication UI
     ========================================================= */

  function updateAuthUI() {
    const token = getToken();
    const user = getStoredUser();
    const patient = getStoredPatient();

    const loginBtn = document.getElementById("loginBtn");
    const signupBtn = document.getElementById("signupBtn");

    if (!loginBtn && !signupBtn) {
      return;
    }

    if (token) {
      if (loginBtn) {
        loginBtn.textContent = "حسابي";
        loginBtn.onclick = (event) => {
          event.preventDefault();
          openAccountModal();
        };
      }

      if (signupBtn) {
        signupBtn.textContent = "مواعيدي";
        signupBtn.onclick = async (event) => {
          event.preventDefault();
          await openMyAppointments();
        };
      }

      const name =
        patient?.full_name ||
        user?.full_name ||
        user?.username ||
        "";

      if (name && loginBtn) {
        loginBtn.setAttribute("title", name);
      }
    } else {
      if (loginBtn) {
        loginBtn.textContent = "تسجيل الدخول";
        loginBtn.onclick = (event) => {
          event.preventDefault();
          openLoginModal();
        };
      }

      if (signupBtn) {
        signupBtn.textContent = "إنشاء حساب";
        signupBtn.onclick = (event) => {
          event.preventDefault();
          openRegisterModal();
        };
      }
    }
  }

  /* =========================================================
     Services
     ========================================================= */

  async function loadServices() {
    try {
      const data = await api("/services");

      services =
        Array.isArray(data)
          ? data
          : Array.isArray(data?.services)
            ? data.services
            : [];

      return services;
    } catch (error) {
      console.error("Failed to load services:", error);
      services = [];
      return [];
    }
  }

  /* =========================================================
     Doctors - DYNAMIC
     ========================================================= */

  async function loadDoctors() {
    try {
      const data = await api("/doctors");

      doctors =
        Array.isArray(data)
          ? data
          : Array.isArray(data?.doctors)
            ? data.doctors
            : [];

      renderDoctors(doctors);
      return doctors;
    } catch (error) {
      console.error("Failed to load doctors:", error);

      doctors = [];

      renderDoctors([]);

      return [];
    }
  }

  function doctorImage(doctor) {
    if (doctor?.image_url) {
      return doctor.image_url;
    }

    return "doctor-reference.jpg";
  }

  function doctorInitials(name) {
    const parts = String(name || "طبيب")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (parts.length >= 2) {
      return (
        parts[0].charAt(0) +
        parts[1].charAt(0)
      );
    }

    return parts[0]?.charAt(0) || "ط";
  }

  function createDoctorCard(doctor) {
    const name = doctor.full_name || "طبيب";
    const specialty = doctor.specialty || "تخصص طبي";
    const area = doctor.area || "";
    const image = doctorImage(doctor);

    /*
      نستخدم نفس doctor-card الموجودة في التصميم الحالي.
      إذا كانت styles.css تحتوي على التصميم، سيتم الاحتفاظ به.
    */

    const card = document.createElement("article");

    card.className = "doctor-card";

    card.dataset.id = doctor.id || "";
    card.dataset.doctorId = doctor.id || "";
    card.dataset.name = name;
    card.dataset.specialty = specialty;
    card.dataset.area = area;

    card.innerHTML = `
      <div class="doctor-image-wrap" style="position:relative;">
        <img
          src="${escapeHtml(image)}"
          alt="${escapeHtml(name)}"
          class="doctor-image"
          loading="lazy"
          onerror="this.onerror=null;this.src='doctor-reference.jpg';"
        >

        <div style="
          position:absolute;
          top:12px;
          right:12px;
          width:42px;
          height:42px;
          border-radius:50%;
          background:rgba(15,118,110,.92);
          color:#fff;
          display:flex;
          align-items:center;
          justify-content:center;
          font-weight:800;
          font-size:15px;
        ">
          ${escapeHtml(doctorInitials(name))}
        </div>
      </div>

      <div class="doctor-info">

        <h3 class="doctor-name">
          ${escapeHtml(name)}
        </h3>

        <p class="doctor-specialty">
          ${escapeHtml(specialty)}
        </p>

        ${
          area
            ? `
              <p class="doctor-area">
                📍 ${escapeHtml(area)}
              </p>
            `
            : ""
        }

        ${
          doctor.bio
            ? `
              <p class="doctor-bio">
                ${escapeHtml(doctor.bio)}
              </p>
            `
            : ""
        }

        <div class="doctor-meta" style="
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:10px;
          margin-top:10px;
        ">
          <span class="doctor-rating">
            ⭐ ${doctor.rating || "4.8"}
          </span>

          ${
            doctor.available === false
              ? `
                <span style="
                  color:#dc2626;
                  font-size:12px;
                  font-weight:700;
                ">
                  غير متاح حاليًا
                </span>
              `
              : `
                <span style="
                  color:#16a34a;
                  font-size:12px;
                  font-weight:700;
                ">
                  ● متاح للحجز
                </span>
              `
          }
        </div>

        <button
          type="button"
          class="book"
          data-doctor-id="${escapeHtml(doctor.id || "")}"
        >
          احجز الآن
        </button>

      </div>
    `;

    return card;
  }

  function findDoctorsContainer() {
    /*
      البحث عن القسم الموجود في index.html
      دون تغيير التصميم.
    */

    const section =
      document.getElementById("doctors");

    if (!section) return null;

    return (
      section.querySelector(".doctors-grid") ||
      section.querySelector(".doctors-container") ||
      section.querySelector(".doctor-list") ||
      section.querySelector(".cards") ||
      section.querySelector(".grid") ||
      section.querySelector(".doctors") ||
      (() => {
        const children = Array.from(section.children);

        for (const child of children) {
          if (
            child.querySelector?.(".doctor-card") ||
            child.classList.contains("doctor-card")
          ) {
            return child;
          }
        }

        return null;
      })()
    );
  }

  function renderDoctors(list) {
    const section = document.getElementById("doctors");

    if (!section) {
      return;
    }

    let container = findDoctorsContainer();

    /*
      إذا كان التصميم الحالي لا يحتوي على حاوية واضحة
      للأطباء، نستخدم أول عنصر يحتوي البطاقات.
    */

    if (!container) {
      container = document.createElement("div");

      container.className = "doctors-grid";

      const heading =
        section.querySelector("h2,h3");

      if (heading && heading.parentElement) {
        heading.parentElement.appendChild(container);
      } else {
        section.appendChild(container);
      }
    }

    /*
      إزالة البطاقات القديمة فقط.
      بقية القسم والتصميم لا يتم تغييره.
    */
    $$(".doctor-card", container).forEach(
      (card) => card.remove()
    );

    if (!list.length) {
      container.innerHTML = `
        <div style="
          grid-column:1/-1;
          text-align:center;
          padding:35px 15px;
          color:#64748b;
          font-family:Cairo,sans-serif;
        ">
          <div style="font-size:38px;margin-bottom:8px;">👨‍⚕️</div>
          <div style="font-weight:800;color:#334155;">
            لا توجد أطباء متاحون حاليًا
          </div>
          <div style="font-size:13px;margin-top:5px;">
            سيتم عرض الأطباء هنا عند إضافتهم من لوحة الإدارة.
          </div>
        </div>
      `;

      return;
    }

    const fragment = document.createDocumentFragment();

    list.forEach((doctor) => {
      fragment.appendChild(
        createDoctorCard(doctor)
      );
    });

    container.appendChild(fragment);

    bindDoctorButtons();
  }

  function bindDoctorButtons() {
    $$(".doctor-card .book").forEach((button) => {
      if (button.dataset.bound === "1") {
        return;
      }

      button.dataset.bound = "1";

      button.addEventListener("click", () => {
        const doctorId =
          button.dataset.doctorId;

        const doctor =
          doctors.find(
            (item) =>
              String(item.id) ===
              String(doctorId)
          );

        if (!doctor) {
          notify(
            "تعذر العثور على بيانات الطبيب.",
            "error"
          );
          return;
        }

        selectedDoctor = doctor;

        openBookingModal(doctor);
      });
    });
  }

  /* =========================================================
     Doctor search
     ========================================================= */

  function filterDoctors() {
    const nameInput =
      document.getElementById("searchName");

    const areaInput =
      document.getElementById("area");

    const specialtyInput =
      document.getElementById("specialty");

    const name =
      nameInput?.value.trim().toLowerCase() || "";

    const area =
      areaInput?.value.trim().toLowerCase() || "";

    const specialty =
      specialtyInput?.value.trim().toLowerCase() || "";

    const filtered = doctors.filter((doctor) => {
      const doctorName =
        String(doctor.full_name || "")
          .toLowerCase();

      const doctorSpecialty =
        String(doctor.specialty || "")
          .toLowerCase();

      const doctorArea =
        String(doctor.area || "")
          .toLowerCase();

      const matchName =
        !name ||
        doctorName.includes(name);

      const matchSpecialty =
        !specialty ||
        doctorSpecialty.includes(specialty);

      const matchArea =
        !area ||
        doctorArea.includes(area);

      return (
        matchName &&
        matchSpecialty &&
        matchArea
      );
    });

    renderDoctors(filtered);

    const results =
      document.getElementById("searchResults");

    if (results) {
      results.textContent =
        filtered.length
          ? `تم العثور على ${filtered.length} طبيب.`
          : "لم يتم العثور على أطباء مطابقين للبحث.";
    }

    const doctorsSection =
      document.getElementById("doctors");

    if (
      doctorsSection &&
      filtered.length
    ) {
      doctorsSection.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
  }

  function setupSearch() {
    const form =
      document.getElementById("searchForm");

    if (form) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        filterDoctors();
      });
    }

    [
      "searchName",
      "area",
      "specialty"
    ].forEach((id) => {
      const input =
        document.getElementById(id);

      if (!input) return;

      input.addEventListener("input", () => {
        /*
          البحث أثناء الكتابة بدون إجبار المستخدم
          على إعادة تحميل الصفحة.
        */
        filterDoctors();
      });
    });
  }

  /* =========================================================
     Specialty cards
     ========================================================= */

  function setupSpecialties() {
    $$("[data-specialty]").forEach((card) => {
      if (card.dataset.specialtyBound === "1") {
        return;
      }

      card.dataset.specialtyBound = "1";

      card.addEventListener("click", () => {
        const specialty =
          card.dataset.specialty || "";

        const specialtyInput =
          document.getElementById("specialty");

        if (specialtyInput) {
          specialtyInput.value =
            specialty;
        }

        filterDoctors();
      });
    });
  }

  /* =========================================================
     Booking
     ========================================================= */

  async function openBookingModal(doctor = null) {
    selectedDoctor = doctor || null;

    if (!getToken()) {
      notify(
        "يجب تسجيل الدخول أولًا لحجز موعد.",
        "error"
      );

      openLoginModal();
      return;
    }

    if (!services.length) {
      await loadServices();
    }

    const serviceOptions = services
      .filter((service) => service.active !== false)
      .map(
        (service) => `
          <option value="${escapeHtml(service.id)}">
            ${escapeHtml(service.name)}
            ${
              service.price !== null &&
              service.price !== undefined &&
              service.price !== ""
                ? ` — ${escapeHtml(service.price)}`
                : ""
            }
          </option>
        `
      )
      .join("");

    if (!serviceOptions) {
      notify(
        "لا توجد خدمات متاحة للحجز حاليًا.",
        "error"
      );
      return;
    }

    const doctorBox = selectedDoctor
      ? `
        <div style="
          display:flex;
          align-items:center;
          gap:12px;
          padding:13px;
          border-radius:15px;
          background:#f0fdfa;
          border:1px solid #ccfbf1;
          margin-bottom:17px;
        ">

          <img
            src="${escapeHtml(doctorImage(selectedDoctor))}"
            alt="${escapeHtml(selectedDoctor.full_name)}"
            style="
              width:55px;
              height:55px;
              border-radius:14px;
              object-fit:cover;
            "
            onerror="this.onerror=null;this.src='doctor-reference.jpg';"
          >

          <div>
            <div style="
              font-weight:800;
              color:#0f172a;
              font-size:16px;
            ">
              ${escapeHtml(selectedDoctor.full_name)}
            </div>

            <div style="
              color:#0f766e;
              font-size:13px;
              margin-top:3px;
            ">
              ${escapeHtml(selectedDoctor.specialty || "تخصص طبي")}
            </div>

            ${
              selectedDoctor.area
                ? `
                  <div style="
                    color:#64748b;
                    font-size:12px;
                    margin-top:2px;
                  ">
                    📍 ${escapeHtml(selectedDoctor.area)}
                  </div>
                `
                : ""
            }
          </div>

        </div>
      `
      : `
        <div style="
          padding:13px;
          border-radius:14px;
          background:#f8fafc;
          color:#64748b;
          font-size:13px;
          margin-bottom:17px;
        ">
          لم يتم اختيار طبيب محدد.
        </div>
      `;

    const modal = createModal(
      "bookingModal",
      "حجز موعد طبي",
      `
        ${doctorBox}

        <form id="bookingForm">

          <div style="margin-bottom:14px;">
            <label style="${labelStyle()}">
              الخدمة الطبية
            </label>

            <select
              id="bookingService"
              required
              style="${fieldStyle()}"
            >
              <option value="">اختر الخدمة</option>
              ${serviceOptions}
            </select>
          </div>

          <div style="margin-bottom:14px;">
            <label style="${labelStyle()}">
              تاريخ الموعد
            </label>

            <input
              id="bookingDate"
              type="date"
              required
              min="${new Date().toISOString().split("T")[0]}"
              style="${fieldStyle()}"
            >
          </div>

          <div style="margin-bottom:14px;">
            <label style="${labelStyle()}">
              وقت الموعد
            </label>

            <input
              id="bookingTime"
              type="time"
              required
              style="${fieldStyle()}"
            >
          </div>

          <div style="margin-bottom:19px;">
            <label style="${labelStyle()}">
              ملاحظات <span style="font-weight:400;color:#94a3b8;">(اختياري)</span>
            </label>

            <textarea
              id="bookingNotes"
              rows="3"
              placeholder="أي ملاحظات ترغب في إضافتها..."
              style="${fieldStyle()}resize:vertical;"
            ></textarea>
          </div>

          <button
            type="submit"
            style="${primaryButtonStyle()}"
          >
            تأكيد حجز الموعد
          </button>

        </form>
      `,
      "560px"
    );

    $("#bookingForm", modal)?.addEventListener(
      "submit",
      handleBooking
    );
  }

  async function handleBooking(event) {
    event.preventDefault();

    const serviceId =
      $("#bookingService")?.value;

    const date =
      $("#bookingDate")?.value;

    const time =
      $("#bookingTime")?.value;

    const notes =
      $("#bookingNotes")?.value.trim() || "";

    if (!serviceId || !date || !time) {
      notify(
        "يرجى اختيار الخدمة والتاريخ والوقت.",
        "error"
      );
      return;
    }

    const button = event.submitter;

    if (button) {
      button.disabled = true;
      button.textContent = "جارٍ تأكيد الحجز...";
    }

    try {
      const data = await api("/appointments", {
        method: "POST",
        body: JSON.stringify({
          service_id: serviceId,

          /*
            أهم إضافة:
            إرسال ID الطبيب الحقيقي من قاعدة البيانات.
          */
          doctor_id:
            selectedDoctor?.id ||
            null,

          appointment_date: date,
          appointment_time: time,
          notes
        })
      });

      document
        .getElementById("bookingModal")
        ?.remove();

      notify(
        data.message ||
          "تم إرسال طلب حجز الموعد بنجاح.",
        "success"
      );

      selectedDoctor = null;

      /*
        تحديث المواعيد تلقائيًا في حال فتحها لاحقًا.
      */
    } catch (error) {
      notify(
        error.message ||
          "تعذر حجز الموعد.",
        "error"
      );

      if (button) {
        button.disabled = false;
        button.textContent =
          "تأكيد حجز الموعد";
      }
    }
  }

  /* =========================================================
     My appointments
     ========================================================= */

  async function openMyAppointments() {
    if (!getToken()) {
      openLoginModal();
      return;
    }

    let appointments = [];

    try {
      const data =
        await api("/my-appointments");

      appointments =
        Array.isArray(data)
          ? data
          : Array.isArray(data?.appointments)
            ? data.appointments
            : [];
    } catch (error) {
      if (error.status === 401) {
        clearAuth();
        updateAuthUI();
        openLoginModal();
        notify(
          "انتهت جلسة الدخول، يرجى تسجيل الدخول مرة أخرى.",
          "error"
        );
        return;
      }

      notify(
        error.message,
        "error"
      );
      return;
    }

    const statusLabel = (status) => {
      switch (status) {
        case "confirmed":
          return {
            text: "مؤكد",
            bg: "#dcfce7",
            color: "#166534"
          };

        case "cancelled":
          return {
            text: "ملغي",
            bg: "#fee2e2",
            color: "#991b1b"
          };

        case "completed":
          return {
            text: "مكتمل",
            bg: "#e0e7ff",
            color: "#3730a3"
          };

        default:
          return {
            text: "في انتظار التأكيد",
            bg: "#fef3c7",
            color: "#92400e"
          };
      }
    };

    const cards = appointments
      .map((appointment) => {
        const status =
          statusLabel(
            appointment.status
          );

        const doctorName =
          appointment.doctor_name ||
          appointment.doctor?.full_name ||
          "لم يتم تحديد طبيب";

        const serviceName =
          appointment.service_name ||
          appointment.service?.name ||
          "خدمة طبية";

        return `
          <div style="
            border:1px solid #e2e8f0;
            border-radius:17px;
            padding:16px;
            margin-bottom:12px;
            background:#fff;
          ">

            <div style="
              display:flex;
              align-items:flex-start;
              justify-content:space-between;
              gap:10px;
              margin-bottom:10px;
            ">

              <div>
                <div style="
                  font-size:16px;
                  font-weight:800;
                  color:#0f172a;
                ">
                  ${escapeHtml(serviceName)}
                </div>

                <div style="
                  margin-top:4px;
                  color:#0f766e;
                  font-size:13px;
                  font-weight:700;
                ">
                  👨‍⚕️ ${escapeHtml(doctorName)}
                </div>
              </div>

              <span style="
                display:inline-block;
                white-space:nowrap;
                background:${status.bg};
                color:${status.color};
                padding:5px 9px;
                border-radius:20px;
                font-size:11px;
                font-weight:800;
              ">
                ${status.text}
              </span>

            </div>

            <div style="
              display:grid;
              grid-template-columns:1fr 1fr;
              gap:8px;
              color:#64748b;
              font-size:13px;
            ">

              <div>
                📅 ${escapeHtml(
                  appointment.appointment_date || ""
                )}
              </div>

              <div>
                🕐 ${escapeHtml(
                  appointment.appointment_time || ""
                )}
              </div>

            </div>

            ${
              appointment.notes
                ? `
                  <div style="
                    margin-top:10px;
                    padding-top:10px;
                    border-top:1px solid #f1f5f9;
                    color:#64748b;
                    font-size:12px;
                  ">
                    ملاحظات:
                    ${escapeHtml(appointment.notes)}
                  </div>
                `
                : ""
            }

          </div>
        `;
      })
      .join("");

    createModal(
      "appointmentsModal",
      "مواعيدي",
      appointments.length
        ? cards
        : `
          <div style="
            text-align:center;
            padding:35px 10px;
            color:#64748b;
          ">
            <div style="font-size:45px;margin-bottom:10px;">
              📅
            </div>

            <div style="
              color:#334155;
              font-weight:800;
              font-size:17px;
            ">
              لا توجد مواعيد حتى الآن
            </div>

            <div style="
              margin-top:6px;
              font-size:13px;
            ">
              يمكنك اختيار طبيب والبدء بحجز موعدك.
            </div>
          </div>
        `,
      "650px"
    );
  }

  /* =========================================================
     Navigation
     ========================================================= */

  function setupNavigation() {
    $$("a[href^='#']").forEach((link) => {
      if (link.dataset.navBound === "1") {
        return;
      }

      link.dataset.navBound = "1";

      link.addEventListener("click", (event) => {
        const href =
          link.getAttribute("href");

        if (
          !href ||
          href === "#" ||
          href.length < 2
        ) {
          return;
        }

        const target =
          document.querySelector(href);

        if (target) {
          event.preventDefault();

          target.scrollIntoView({
            behavior: "smooth",
            block: "start"
          });
        }
      });
    });
  }

  /* =========================================================
     Existing book buttons
     Handles any static cards temporarily present
     ========================================================= */

  function bindExistingStaticBookButtons() {
    $$(".doctor-card .book").forEach((button) => {
      if (button.dataset.bound === "1") {
        return;
      }

      button.dataset.bound = "1";

      button.addEventListener("click", () => {
        const doctorId =
          button.dataset.doctorId ||
          button.closest(".doctor-card")
            ?.dataset?.id;

        const doctor =
          doctors.find(
            (item) =>
              String(item.id) ===
              String(doctorId)
          );

        if (doctor) {
          selectedDoctor = doctor;
          openBookingModal(doctor);
          return;
        }

        /*
          في حال كانت بطاقة قديمة ولم تحصل على ID بعد،
          نفتح الحجز بدون طبيب محدد بدل تعطيل الزر.
        */
        selectedDoctor = null;
        openBookingModal(null);
      });
    });
  }

  /* =========================================================
     Mobile menu compatibility
     ========================================================= */

  function setupMobileMenu() {
    const menuBtn =
      document.getElementById("menuBtn");

    const mobileMenu =
      document.getElementById("mobileMenu");

    if (!menuBtn || !mobileMenu) {
      return;
    }

    menuBtn.addEventListener("click", () => {
      mobileMenu.classList.toggle("active");
    });

    $$("#mobileMenu a").forEach((link) => {
      link.addEventListener("click", () => {
        mobileMenu.classList.remove("active");
      });
    });
  }

  /* =========================================================
     Hero / existing buttons compatibility
     ========================================================= */

  function setupHeroButtons() {
    const heroBookingBtn =
      document.getElementById(
        "heroBookingBtn"
      );

    if (heroBookingBtn) {
      heroBookingBtn.addEventListener(
        "click",
        () => {
          const doctorsSection =
            document.getElementById(
              "doctors"
            );

          if (doctorsSection) {
            doctorsSection.scrollIntoView({
              behavior: "smooth",
              block: "start"
            });
          }
        }
      );
    }
  }

  /* =========================================================
     Search button compatibility
     ========================================================= */

  function setupSearchButtonCompatibility() {
    const searchBtn =
      document.getElementById("searchBtn");

    if (searchBtn) {
      searchBtn.addEventListener("click", () => {
        filterDoctors();
      });
    }
  }

  /* =========================================================
     Init
     ========================================================= */

  async function init() {
    updateAuthUI();

    setupNavigation();
    setupSearch();
    setupSpecialties();
    setupMobileMenu();
    setupHeroButtons();
    setupSearchButtonCompatibility();

    /*
      تحميل الخدمات والأطباء بالتوازي.
    */
    await Promise.all([
      loadServices(),
      loadDoctors()
    ]);

    /*
      للتوافق مع أي بطاقات موجودة مؤقتًا في HTML.
    */
    bindExistingStaticBookButtons();

    /*
      عند وجود جلسة دخول، نحاول تحديث بيانات المريض.
    */
    if (getToken()) {
      try {
        const data =
          await api("/patient/me");

        if (data?.patient) {
          localStorage.setItem(
            STORAGE.patient,
            JSON.stringify(data.patient)
          );
        }
      } catch {
        // لا نوقف الصفحة إذا فشل التحديث.
      }
    }

    updateAuthUI();

    console.log(
      "Medical Booking initialized successfully."
    );

    console.log(
      `Dynamic doctors loaded: ${doctors.length}`
    );
  }

  /* =========================================================
     Start
     ========================================================= */

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init
    );
  } else {
    init();
  }

})();

const doctors = [...document.querySelectorAll(".doctor-profile")];
const toast = document.getElementById("toast");

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

document.getElementById("menuToggle").addEventListener("click", () => {
  document.getElementById("mainNav").classList.toggle("open");
});

document.querySelectorAll(".main-nav a").forEach(link => {
  link.addEventListener("click", () => document.getElementById("mainNav").classList.remove("open"));
});

document.getElementById("searchForm").addEventListener("submit", e => {
  e.preventDefault();
  const q = document.getElementById("doctorSearch").value.trim().toLowerCase();
  const area = document.getElementById("areaSelect").value;
  let count = 0;

  doctors.forEach(card => {
    const text = `${card.dataset.name} ${card.dataset.specialty}`.toLowerCase();
    const matchText = !q || text.includes(q);
    const matchArea = !area || card.dataset.area === area;
    const visible = matchText && matchArea;
    card.style.display = visible ? "" : "none";
    if (visible) count++;
  });

  document.getElementById("noResults").hidden = count !== 0;
  document.getElementById("searchMessage").textContent =
    count ? `تم العثور على ${count} طبيب/أطباء مطابقين للبحث.` : "";

  document.getElementById("doctors").scrollIntoView({ behavior: "smooth", block: "start" });
});

document.querySelectorAll(".specialty-card").forEach(card => {
  card.addEventListener("click", () => {
    const specialty = card.dataset.specialty;
    document.getElementById("doctorSearch").value = specialty;
    document.getElementById("searchForm").dispatchEvent(new Event("submit"));
  });
});

document.querySelectorAll(".book-btn").forEach(button => {
  button.addEventListener("click", () => {
    showToast(`سيتم فتح حجز موعد مع ${button.dataset.doctor} في الخطوة التالية.`);
  });
});

document.getElementById("loginBtn").addEventListener("click", () => {
  showToast("صفحة تسجيل الدخول ستُفعّل ضمن نظام الحسابات.");
});

document.getElementById("registerBtn").addEventListener("click", () => {
  showToast("صفحة إنشاء الحساب ستُفعّل ضمن نظام الحسابات.");
});

document.querySelectorAll('a[href="#"]').forEach(link => {
  link.addEventListener("click", e => e.preventDefault());
});

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

document.querySelectorAll(".specialty-card").forEach(card => {
  card.addEventListener("click", () => {
    document.getElementById("specialty").value = card.dataset.specialty;
    document.getElementById("searchForm").scrollIntoView({behavior:"smooth", block:"center"});
  });
});

document.getElementById("searchForm").addEventListener("submit", e => {
  e.preventDefault();
  const name = document.getElementById("searchName").value.trim();
  const specialty = document.getElementById("specialty").value;
  const area = document.getElementById("area").value;

  const cards = [...document.querySelectorAll(".doctor-card")];
  let count = 0;
  cards.forEach(card => {
    const matchesName = !name || card.dataset.name.includes(name) || card.dataset.specialty.includes(name);
    const matchesSpecialty = !specialty || card.dataset.specialty === specialty;
    const visible = matchesName && matchesSpecialty;
    card.style.display = visible ? "flex" : "none";
    if (visible) count++;
  });

  document.getElementById("doctors").scrollIntoView({behavior:"smooth", block:"start"});
  const result = document.getElementById("searchResults");
  result.hidden = false;
  result.textContent = count ? `تم العثور على ${count} طبيب مطابق للبحث${area ? ` في ${area}` : ""}.` : "لا توجد نتائج مطابقة حالياً.";
  setTimeout(() => result.hidden = true, 3000);
});

document.querySelectorAll(".book").forEach(btn => {
  btn.addEventListener("click", () => {
    alert("سيتم فتح شاشة حجز الموعد في الخطوة التالية.");
  });
});

document.getElementById("loginBtn").addEventListener("click", () => alert("تسجيل الدخول سيتم ربطه بنظام الحسابات."));
document.getElementById("signupBtn").addEventListener("click", () => alert("إنشاء الحساب سيتم ربطه بنظام التسجيل."));

// ===== 모바일 메뉴 토글 =====
function initNav() {
  const navToggle = document.querySelector(".nav-toggle");
  const navMenu = document.querySelector(".nav-menu");
  if (!navToggle || !navMenu) return;

  navToggle.addEventListener("click", () => {
    const isOpen = navMenu.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", isOpen);
  });
}

// ===== 스크롤 시 헤더 그림자 & 맨 위로 버튼 =====
function initScroll() {
  const header = document.querySelector(".header");
  const toTop = document.querySelector(".to-top");

  function onScroll() {
    const y = window.scrollY;
    header?.classList.toggle("scrolled", y > 10);
    toTop?.classList.toggle("show", y > 500);
  }
  window.addEventListener("scroll", onScroll);
  onScroll();

  toTop?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

// ===== 스크롤 등장 애니메이션 =====
function initReveal() {
  const revealTargets = document.querySelectorAll(
    ".course-card, .instructor, .faq-item, .signup-form, .section-title, .home-card"
  );
  revealTargets.forEach((el) => el.classList.add("reveal"));

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );

  revealTargets.forEach((el) => observer.observe(el));
}

initNav();
initScroll();
initReveal();

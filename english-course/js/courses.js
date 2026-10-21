// ===== 강의 레벨 필터 =====
const filters = document.querySelectorAll(".filter");
const cards = document.querySelectorAll(".course-card");

filters.forEach((btn) => {
  btn.addEventListener("click", () => {
    filters.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    const level = btn.dataset.level;
    cards.forEach((card) => {
      const match = level === "all" || card.dataset.level === level;
      card.classList.toggle("hidden", !match);
    });
  });
});

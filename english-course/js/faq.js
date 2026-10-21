// ===== FAQ 아코디언 =====
document.querySelectorAll(".faq-item").forEach((item) => {
  const question = item.querySelector(".faq-q");
  const answer = item.querySelector(".faq-a");

  question.addEventListener("click", () => {
    const isOpen = item.classList.toggle("open");
    answer.style.maxHeight = isOpen ? answer.scrollHeight + "px" : null;
  });
});

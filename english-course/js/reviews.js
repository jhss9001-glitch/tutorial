// ===== 후기 슬라이더 =====
const slides = document.querySelectorAll(".slide");
const dotsWrap = document.querySelector(".dots");
let current = 0;
let autoTimer;

slides.forEach((_, i) => {
  const dot = document.createElement("button");
  dot.className = "dot" + (i === 0 ? " active" : "");
  dot.setAttribute("aria-label", `${i + 1}번째 후기`);
  dot.addEventListener("click", () => {
    showSlide(i);
    restartAuto();
  });
  dotsWrap.appendChild(dot);
});

const dots = dotsWrap.querySelectorAll(".dot");

function showSlide(index) {
  slides[current].classList.remove("active");
  dots[current].classList.remove("active");
  current = (index + slides.length) % slides.length;
  slides[current].classList.add("active");
  dots[current].classList.add("active");
}

function restartAuto() {
  clearInterval(autoTimer);
  autoTimer = setInterval(() => showSlide(current + 1), 5000);
}

document.querySelector(".prev").addEventListener("click", () => {
  showSlide(current - 1);
  restartAuto();
});

document.querySelector(".next").addEventListener("click", () => {
  showSlide(current + 1);
  restartAuto();
});

restartAuto();

// ===== 숫자 카운트업 =====
function countUp(el) {
  const target = Number(el.dataset.target);
  const duration = 1500;
  const start = performance.now();

  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.floor(target * eased).toLocaleString();
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

document.querySelectorAll(".count").forEach(countUp);

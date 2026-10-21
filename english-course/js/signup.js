// ===== 신청 폼 검증 =====
const form = document.querySelector(".signup-form");
const successMsg = document.querySelector(".form-success");
const nameInput = document.getElementById("name");
const emailInput = document.getElementById("email");
const levelInput = document.getElementById("level");

function setError(input, message) {
  const field = input.closest(".field");
  field.classList.toggle("invalid", Boolean(message));
  field.querySelector(".error").textContent = message;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();

  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  const level = levelInput.value;
  let valid = true;

  if (name.length < 2) {
    setError(nameInput, "이름을 2글자 이상 입력해 주세요.");
    valid = false;
  } else {
    setError(nameInput, "");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setError(emailInput, "올바른 이메일 주소를 입력해 주세요.");
    valid = false;
  } else {
    setError(emailInput, "");
  }

  if (!level) {
    setError(levelInput, "관심 레벨을 선택해 주세요.");
    valid = false;
  } else {
    setError(levelInput, "");
  }

  if (!valid) {
    successMsg.hidden = true;
    return;
  }

  successMsg.textContent = `${name}님, 신청이 완료되었어요! ${email}로 레벨 테스트 링크를 보내드릴게요.`;
  successMsg.hidden = false;
  form.reset();
});

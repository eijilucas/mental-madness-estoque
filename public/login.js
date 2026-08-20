const form = document.getElementById("login-form");
const errorEl = document.getElementById("login-error");

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  errorEl.textContent = "";

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  const submitBtn = form.querySelector("button");
  submitBtn.disabled = true;

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || "Falha ao entrar";
      return;
    }
    window.location.href = "/";
  } catch (err) {
    errorEl.textContent = "Falha ao entrar";
  } finally {
    submitBtn.disabled = false;
  }
});

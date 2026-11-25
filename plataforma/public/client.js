"use strict";

const loginScreen = document.querySelector("#login-screen");
const accountScreen = document.querySelector("#account-screen");
const loginForm = document.querySelector("#login-form");
const message = document.querySelector("#login-message");
const loginButton = document.querySelector("#login-button");
let csrfToken = "";

function showAccount(user) {
  document.querySelector("#account-email").textContent = user.email;
  document.querySelector("#account-name").textContent = user.name || user.email.split("@")[0];
  document.querySelector("#account-role").textContent = user.role === "MAIN" ? "Administração principal" : "Conta ativa";
  loginScreen.hidden = true;
  accountScreen.hidden = false;
  const team = document.querySelector("#team");
  team.hidden = user.role !== "MAIN";
  document.querySelector("#team-nav").hidden = team.hidden;
  if (user.role === "MAIN") loadAccounts();
  document.dispatchEvent(new CustomEvent("nhac:session", { detail: user.role }));
}

async function loadAccounts() {
  const rows = document.querySelector("#team-rows");
  const status = document.querySelector("#team-message");
  rows.replaceChildren();
  status.textContent = "Carregando contas…";
  try {
    const response = await fetch("/api/admin/users", { credentials: "same-origin" });
    if (!response.ok) throw new Error("accounts");
    const data = await response.json();
    for (const account of data.users) {
      const row = document.createElement("tr");
      for (const value of [account.name, account.email, account.role === "MAIN" ? "MAIN" : "Cliente", account.active ? "Ativa" : "Inativa"]) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      rows.append(row);
    }
    status.textContent = data.users.length ? "" : "Nenhuma conta cadastrada.";
  } catch {
    status.textContent = "Não foi possível carregar as contas.";
  }
}

async function refreshSession() {
  const response = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (response.ok) {
    const data = await response.json();
    csrfToken = data.csrfToken;
    showAccount(data.user);
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginButton.disabled = true;
  message.textContent = "";
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(loginForm)))
    });
    if (!response.ok) {
      message.textContent = response.status === 429
        ? "Muitas tentativas. Aguarde antes de tentar novamente."
        : response.status === 401
          ? "Confira o e-mail, a senha e o código de autenticação."
          : "Não foi possível entrar. Tente novamente.";
      return;
    }
    const data = await response.json();
    csrfToken = data.csrfToken;
    loginForm.reset();
    showAccount(data.user);
  } catch {
    message.textContent = "Não foi possível conectar. Tente novamente.";
  } finally {
    loginButton.disabled = false;
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", headers: { "X-CSRF-Token": csrfToken } });
    if (!response.ok) throw new Error("logout");
    csrfToken = "";
    document.dispatchEvent(new CustomEvent("nhac:session", { detail: null }));
    document.querySelector("#team").hidden = true;
    document.querySelector("#team-rows").replaceChildren();
    accountScreen.hidden = true;
    loginScreen.hidden = false;
    document.querySelector("#email").focus();
  } catch {
    window.alert("Não foi possível sair da conta. Tente novamente.");
  }
});

refreshSession().catch(() => { message.textContent = "Não foi possível conectar. Tente novamente."; });

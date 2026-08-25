// frontend/script.js
// Data asli dari /api/list (dibaca dari data/nomor.json di GitHub).
// Aksi admin (add/ban/unban/del) manggil /api/admin, yang bakal commit
// balik ke repo. Gak ada data fake lagi di sini.

let data = {}; // { "62812xxx": "active" | "banned" }

const rowsEl = document.getElementById("rows");
const emptyEl = document.getElementById("emptyState");
const statsEl = document.getElementById("statsRow");
const countEl = document.getElementById("listCount");
const overlay = document.getElementById("overlay");
const pwInput = document.getElementById("pwInput");
const pwErr = document.getElementById("pwErr");
const loginBtn = document.getElementById("loginBtn");
const addBtn = document.getElementById("addBtn");
const addInput = document.getElementById("addInput");
const debugOutput = document.getElementById("debugOutput");

// ── tampilin raw JSON response terakhir ke panel debug ──
function showDebug(payload, status, isOk) {
  if (!debugOutput) return;
  debugOutput.classList.remove("is-error", "is-ok");
  debugOutput.classList.add(isOk ? "is-ok" : "is-error");
  debugOutput.textContent = `HTTP ${status}\n` + JSON.stringify(payload, null, 2);
}

// ── toast kecil buat feedback aksi ──
function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2200);
}

// ── render list + stats dari `data` ──
function render() {
  const entries = Object.entries(data);
  const total = entries.length;
  const banned = entries.filter(([, s]) => s === "banned").length;
  const access = total - banned;

  statsEl.innerHTML = `
    <div class="stat"><span class="num display">${total}</span><span class="cap">Total</span></div>
    <div class="stat"><span class="num display">${access}</span><span class="cap">Access</span></div>
    <div class="stat"><span class="num display">${banned}</span><span class="cap">Banned</span></div>
  `;
  countEl.textContent = `${total} entri`;

  rowsEl.innerHTML = "";
  if (!total) {
    emptyEl.style.display = "block";
    return;
  }
  emptyEl.style.display = "none";

  entries.forEach(([nomor, status], i) => {
    const row = document.createElement("div");
    row.className = "entry";
    row.innerHTML = `
      <div class="entry-top">
        <div class="entry-main">
          <span class="entry-idx">${String(i + 1).padStart(2, "0")}</span>
          <span class="entry-num ${status === "banned" ? "banned" : ""}">${nomor}</span>
        </div>
        <span class="status ${status === "banned" ? "banned" : "access"}">
          <span class="mark"></span>${status === "banned" ? "Banned" : "Access"}
        </span>
      </div>
      <div class="entry-actions">
        <button class="icon-btn" data-action="${status === "banned" ? "unban" : "ban"}" data-nomor="${nomor}">
          ${status === "banned" ? "↺ Unban" : "⊘ Ban"}
        </button>
        <button class="icon-btn" data-action="del" data-nomor="${nomor}">✕ Hapus</button>
      </div>
    `;
    rowsEl.appendChild(row);
  });
}

// ── ambil data publik ──
async function loadList() {
  countEl.textContent = "Memuat...";
  try {
    const resp = await fetch("/api/list");
    const json = await resp.json();
    data = json.data || {};
    render();
  } catch {
    countEl.textContent = "Gagal memuat";
    toast("Gagal ambil data, coba refresh");
  }
}

// ── panggil aksi admin, semuanya nge-commit ke GitHub di backend ──
async function callAdmin(payload, btn) {
  if (btn) btn.disabled = true;
  try {
    const resp = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await resp.json();
    showDebug(json, resp.status, resp.ok);
    if (!resp.ok) {
      toast(json.error || "Gagal, coba lagi");
      if (resp.status === 401) exitAdmin();
      return null;
    }
    return json;
  } catch (err) {
    showDebug({ error: String(err) }, "network error", false);
    toast("Gagal konek ke server");
    return null;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── aksi per baris (ban/unban/del) ──
rowsEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const { action, nomor } = btn.dataset;
  const result = await callAdmin({ action, nomor }, btn);
  if (result) {
    data = result.data || data;
    render();
    toast(action === "del" ? "Nomor dihapus" : action === "ban" ? "Nomor di-banned" : "Nomor di-unban");
  }
});

// ── tambah nomor ──
addBtn.addEventListener("click", async () => {
  const val = addInput.value.trim().replace(/[^0-9]/g, "");
  if (!val) return;
  const result = await callAdmin({ action: "add", nomor: val }, addBtn);
  if (result) {
    data = result.data || data;
    addInput.value = "";
    render();
    toast("Nomor ditambahkan");
  }
});
addInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addBtn.click();
});

// ── mode admin: toggle & login ──
function enterAdmin() {
  document.body.classList.add("admin");
  render();
}
function exitAdmin() {
  document.body.classList.remove("admin");
  render();
}

document.getElementById("menuBtn").addEventListener("click", async () => {
  if (document.body.classList.contains("admin")) {
    await callAdmin({ action: "logout" });
    exitAdmin();
    return;
  }
  overlay.classList.add("open");
  pwInput.value = "";
  pwErr.classList.remove("show");
  setTimeout(() => pwInput.focus(), 50);
});

document.getElementById("cancelBtn").addEventListener("click", () => {
  overlay.classList.remove("open");
});

loginBtn.addEventListener("click", async () => {
  const password = pwInput.value;
  if (!password) return;
  loginBtn.disabled = true;
  try {
    const resp = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", password }),
    });
    const json = await resp.json();
    showDebug(json, resp.status, resp.ok);
    if (resp.ok) {
      overlay.classList.remove("open");
      enterAdmin();
    } else {
      pwErr.textContent = json.error || "Password salah, coba lagi.";
      pwErr.classList.add("show");
    }
  } catch {
    pwErr.textContent = "Gagal konek ke server.";
    pwErr.classList.add("show");
  } finally {
    loginBtn.disabled = false;
  }
});
pwInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loginBtn.click();
});

// ── init: muat data, terus cek kalau session admin masih aktif ──
(async function init() {
  await loadList();
  try {
    const resp = await fetch("/api/admin");
    const json = await resp.json();
    if (json.authed) enterAdmin();
  } catch {
    /* diem aja, anggap belum login */
  }
})();

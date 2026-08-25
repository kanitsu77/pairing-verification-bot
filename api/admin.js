// api/admin.js
// GET  /api/admin  -> cek status session ({ authed: true/false })
// POST /api/admin  -> { action: "login" | "logout" | "add" | "del" | "ban" | "unban", ... }
// Semua logic GitHub Contents API + session admin digabung langsung di sini (gak pake /lib).

const crypto = require("crypto");

const API_BASE = "https://api.github.com";
const COOKIE_NAME = "pv_session";
const SIX_HOURS = 1000 * 60 * 60 * 6;

// ── GitHub Contents API ──
function ghConfig() {
  const {
    GH_TOKEN,
    GH_OWNER,
    GH_REPO,
    GH_BRANCH = "main",
    DATA_PATH = "data/nomor.json",
  } = process.env;

  if (!GH_TOKEN || !GH_OWNER || !GH_REPO) {
    throw new Error(
      "Env belum lengkap: GH_TOKEN, GH_OWNER, GH_REPO wajib di-set di Vercel project settings."
    );
  }
  return { GH_TOKEN, GH_OWNER, GH_REPO, GH_BRANCH, DATA_PATH };
}

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "pairing-verif",
  };
}

async function getData() {
  const { GH_TOKEN, GH_OWNER, GH_REPO, GH_BRANCH, DATA_PATH } = ghConfig();
  const url = `${API_BASE}/repos/${GH_OWNER}/${GH_REPO}/contents/${DATA_PATH}?ref=${GH_BRANCH}`;
  const resp = await fetch(url, { headers: ghHeaders(GH_TOKEN) });

  if (resp.status === 404) return { data: {}, sha: null };

  if (!resp.ok) {
    throw new Error(`GitHub GET gagal: ${resp.status} ${await resp.text()}`);
  }
  const json = await resp.json();
  const content = Buffer.from(json.content, "base64").toString("utf8");
  let data = {};
  try {
    data = JSON.parse(content || "{}");
  } catch {
    data = {};
  }
  return { data, sha: json.sha };
}

async function putData(data, sha, message) {
  const { GH_TOKEN, GH_OWNER, GH_REPO, GH_BRANCH, DATA_PATH } = ghConfig();
  const url = `${API_BASE}/repos/${GH_OWNER}/${GH_REPO}/contents/${DATA_PATH}`;
  const body = {
    message: message || "update data/nomor.json",
    content: Buffer.from(JSON.stringify(data, null, 2)).toString("base64"),
    branch: GH_BRANCH,
  };
  if (sha) body.sha = sha;

  const resp = await fetch(url, {
    method: "PUT",
    headers: { ...ghHeaders(GH_TOKEN), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`GitHub PUT gagal: ${resp.status} ${await resp.text()}`);
  }
  return resp.json();
}

// ── session admin (stateless, HMAC-signed) ──
const ADMIN_PASSWORD = process.env.ADMIN || "";
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto.createHash("sha256").update(ADMIN_PASSWORD || "fallback").digest("hex");

function sign(payload) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
}
function createToken() {
  const expires = Date.now() + SIX_HOURS;
  const payload = String(expires);
  return `${payload}.${sign(payload)}`;
}
function verifyToken(token) {
  if (!token || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  if (sign(payload) !== sig) return false;
  return Date.now() < Number(payload);
}
function getCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const match = raw.split(";").map((c) => c.trim()).find((c) => c.startsWith(name + "="));
  return match ? match.split("=")[1] : null;
}
function isAuthed(req) {
  return verifyToken(getCookie(req, COOKIE_NAME));
}
function checkPassword(input) {
  if (!ADMIN_PASSWORD) return false; // env belum di-set -> tolak semua
  return input === ADMIN_PASSWORD;
}

function normalizeNomor(n) {
  if (!n) return "";
  let x = String(n).replace(/[^0-9]/g, "");
  if (x.startsWith("0")) x = "62" + x.slice(1);
  return x;
}

// ── handler ──
module.exports = async (req, res) => {
  if (req.method === "GET") {
    res.status(200).json({ authed: isAuthed(req) });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = req.body || {};
  const action = body.action;

  if (action === "login") {
    if (checkPassword(body.password)) {
      const token = createToken();
      res.setHeader(
        "Set-Cookie",
        `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=21600; SameSite=Lax`
      );
      res.status(200).json({ ok: true });
    } else {
      res.status(401).json({ error: "Password salah" });
    }
    return;
  }

  if (action === "logout") {
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`);
    res.status(200).json({ ok: true });
    return;
  }

  if (!isAuthed(req)) {
    res.status(401).json({ error: "Belum login / session habis" });
    return;
  }

  if (!["add", "del", "ban", "unban"].includes(action)) {
    res.status(400).json({ error: "Action gak dikenal" });
    return;
  }

  const nomor = normalizeNomor(body.nomor);
  if (!nomor) {
    res.status(400).json({ error: "Nomor kosong / gak valid" });
    return;
  }

  try {
    const { data, sha } = await getData();

    if (action === "add") {
      data[nomor] = data[nomor] === "banned" ? "banned" : "active";
    } else if (action === "del") {
      delete data[nomor];
    } else if (action === "ban") {
      data[nomor] = "banned";
    } else if (action === "unban") {
      data[nomor] = "active";
    }

    await putData(data, sha, `${action} ${nomor} via admin panel`);
    res.status(200).json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

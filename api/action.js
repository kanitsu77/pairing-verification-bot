// api/action.js
// Nge-handle 5 endpoint sekaligus (biar gak numpuk banyak serverless function):
//   GET /ceknomor?nomor=                        -> publik, gak butuh apikey
//   GET /add?nomor=&apikey=                      -> butuh apikey = env.ADMIN
//   GET /del?nomor=&apikey=
//   GET /ban?nomor=&apikey=
//   GET /unban?nomor=&apikey=
// Routing "/ceknomor" dst -> "/api/action?type=..." diatur di vercel.json.

const API_BASE = "https://api.github.com";

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

function normalizeNomor(n) {
  if (!n) return "";
  let x = String(n).replace(/[^0-9]/g, "");
  if (x.startsWith("0")) x = "62" + x.slice(1);
  return x;
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { type, nomor, apikey } = req.query;
  const norm = normalizeNomor(nomor);

  // ── /ceknomor — publik, gak butuh apikey ──
  if (type === "cek") {
    if (!norm) {
      res.status(400).json({ error: "Parameter ?nomor= wajib diisi" });
      return;
    }
    try {
      const { data } = await getData();
      const raw = data[norm];
      const status = raw === "banned" ? "Banned" : raw === "active" ? "Success" : "No Access";
      res.status(200).json({ nomor: norm, status });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  // ── /add /del /ban /unban — semuanya butuh apikey = env.ADMIN ──
  const ADMIN = process.env.ADMIN || "";
  if (!ADMIN || apikey !== ADMIN) {
    res.status(401).json({ error: "API key salah atau kosong" });
    return;
  }
  if (!norm) {
    res.status(400).json({ error: "Parameter ?nomor= wajib diisi" });
    return;
  }
  if (!["add", "del", "ban", "unban"].includes(type)) {
    res.status(400).json({ error: "Endpoint tidak dikenal" });
    return;
  }

  try {
    const { data, sha } = await getData();

    if (type === "add") data[norm] = data[norm] === "banned" ? "banned" : "active";
    else if (type === "del") delete data[norm];
    else if (type === "ban") data[norm] = "banned";
    else if (type === "unban") data[norm] = "active";

    await putData(data, sha, `${type} ${norm} via API`);
    res.status(200).json({ ok: true, nomor: norm, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

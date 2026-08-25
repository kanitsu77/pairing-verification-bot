// api/list.js — GET /api/list
// Publik, dipanggil frontend buat nampilin registry + stats.
// Semua logic GitHub Contents API digabung langsung di sini (gak pake /lib).

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

  if (resp.status === 404) return { data: {}, sha: null }; // file belum ada di repo

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

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const { data } = await getData();
    res.status(200).json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

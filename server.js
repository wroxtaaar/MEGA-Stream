require("dotenv").config();

const path = require("node:path");
const express = require("express");
const { Storage } = require("megajs");

const app = express();
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const REFRESH_MS = Math.max(60, Number(process.env.CATALOG_REFRESH_SECONDS || 300)) * 1000;
const VIDEO_EXTENSIONS = new Set([
  ".mp4", ".m4v", ".mkv", ".webm", ".mov", ".avi", ".mpg", ".mpeg",
  ".m2ts", ".ts", ".wmv", ".ogv", ".3gp"
]);

const accountConfigs = [
  { id: "account1", label: "MEGA Account 1", email: process.env.MEGA_EMAIL, password: process.env.MEGA_PASSWORD, tfa: process.env.MEGA_TFA_CODE },
  { id: "account2", label: "MEGA Account 2", email: process.env.MEGA2_EMAIL, password: process.env.MEGA2_PASSWORD, tfa: process.env.MEGA2_TFA_CODE }
].filter((account) => account.email && account.password);
if (!accountConfigs.length) {
  console.error("Set MEGA_EMAIL and MEGA_PASSWORD in .env (and optionally MEGA2_EMAIL/MEGA2_PASSWORD).");
  process.exit(1);
}
if ((process.env.MEGA2_EMAIL && !process.env.MEGA2_PASSWORD) || (!process.env.MEGA2_EMAIL && process.env.MEGA2_PASSWORD)) {
  console.error("Configure both MEGA2_EMAIL and MEGA2_PASSWORD, or leave both empty.");
  process.exit(1);
}

if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use(express.static(path.join(__dirname, "public"), { index: false }));

const accounts = accountConfigs.map((config) => ({ ...config, storage: null, ready: false, error: null, catalog: [], folders: [] }));
let storageReady = false;
let storageError = null;
let catalog = [];
let folderCatalog = [];
let lastCatalogRefresh = 0;
let refreshInFlight = null;

function videoMime(name) {
  const ext = path.extname(name).toLowerCase();
  return ({
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".mpg": "video/mpeg",
    ".mpeg": "video/mpeg",
    ".m2ts": "video/mp2t",
    ".ts": "video/mp2t",
    ".wmv": "video/x-ms-wmv",
    ".ogv": "video/ogg",
    ".3gp": "video/3gpp"
  })[ext] || "application/octet-stream";
}

function walkFiles(folder, account, parent = "") {
  const output = [];
  for (const item of (folder && Array.isArray(folder.children) ? folder.children : [])) {
    const relativePath = parent ? parent + "/" + item.name : item.name;
    if (item.directory) {
      output.push(...walkFiles(item, account, relativePath));
      continue;
    }
    if (!item.nodeId || !VIDEO_EXTENSIONS.has(path.extname(item.name || "").toLowerCase())) continue;
    output.push({
      id: account.id + ":" + String(item.nodeId),
      nodeId: String(item.nodeId),
      accountId: account.id,
      accountName: account.label,
      name: item.name || "Untitled video",
      path: relativePath,
      folderPath: parent,
      size: Number(item.size || 0),
      mime: videoMime(item.name || ""),
      modifiedAt: item.timestamp ? Number(item.timestamp) * 1000 : null
    });
  }
  return output;
}


function walkFolders(folder, account, parent = "") {
  const output = [];
  for (const item of (folder && Array.isArray(folder.children) ? folder.children : [])) {
    if (!item.directory) continue;
    const folderPath = parent ? parent + "/" + item.name : item.name;
    output.push({
      id: account.id + ":" + String(item.nodeId || folderPath),
      accountId: account.id,
      accountName: account.label,
      name: item.name || "Untitled folder",
      path: folderPath,
      parentPath: parent
    });
    output.push(...walkFolders(item, account, folderPath));
  }
  return output;
}

async function connectOneAccount(account) {
  console.log("Connecting to " + account.label + "...");
  try {
    const storage = new Storage({
      email: account.email,
      password: account.password,
      ...(account.tfa ? { secondFactorCode: account.tfa } : {}),
      autoload: true,
      keepalive: true
    });
    account.storage = storage;
    await storage.ready;
    account.ready = true;
    account.error = null;
    console.log(account.label + " connected. Account tree loaded.");
  } catch (error) {
    account.ready = false;
    account.error = error;
    console.error(account.label + " connection failed:", error.message);
  }
}

async function connectMega() {
  await Promise.all(accounts.map(connectOneAccount));
  storageReady = accounts.some((account) => account.ready);
  storageError = storageReady ? null : new Error("No MEGA accounts connected.");
  if (storageReady) await refreshCatalog(true);
}

async function refreshCatalog(force = false) {
  storageReady = accounts.some((account) => account.ready);
  if (!storageReady) throw new Error("No MEGA account is connected.");
  if (!force && Date.now() - lastCatalogRefresh < REFRESH_MS) return catalog;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    await Promise.all(accounts.filter((account) => account.ready && account.storage).map(async (account) => {
      try {
        await account.storage.reload();
        account.catalog = walkFiles(account.storage.root, account).sort((a, b) => a.name.localeCompare(b.name));
        account.folders = walkFolders(account.storage.root, account).sort((a, b) => a.name.localeCompare(b.name));
      } catch (error) {
        account.error = error;
        console.error("Refresh failed for " + account.label + ":", error.message);
      }
    }));
    catalog = accounts.flatMap((account) => account.catalog).sort((a, b) => a.name.localeCompare(b.name));
    folderCatalog = accounts.flatMap((account) => account.folders).sort((a, b) => a.name.localeCompare(b.name));
    lastCatalogRefresh = Date.now();
    console.log("Indexed " + catalog.length + " video files across " + accounts.filter((account) => account.ready).length + " connected MEGA account(s).");
    return catalog;
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return { invalid: true };
  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { invalid: true };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
    return { invalid: true };
  }
  end = Math.min(end, size - 1);
  return { start, end };
}

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.get("/api/status", (req, res) => {
  res.json({
    megaConnected: storageReady,
    videoCount: catalog.length,
    lastIndexedAt: lastCatalogRefresh || null,
    accounts: accounts.map((account) => ({ id: account.id, name: account.label, connected: account.ready, videoCount: account.catalog.length })),
    error: storageError ? "MEGA connection needs attention." : accounts.some((account) => account.error) ? "One MEGA account could not connect; other connected accounts remain available." : null
  });
});

app.get("/api/accounts", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ accounts: accounts.map((account) => ({ id: account.id, name: account.label, connected: account.ready, videoCount: account.catalog.length })) });
});

app.get("/api/videos", async (req, res) => {
  try {
    const force = req.query.refresh === "1";
    const files = await refreshCatalog(force);
    res.set("Cache-Control", "no-store");
    res.json({ videos: files, count: files.length });
  } catch (err) {
    console.error("Catalogue error:", err.message);
    res.status(503).json({ error: "Could not load the MEGA video library. Check the server logs." });
  }
});


app.get("/api/folders", async (req, res) => {
  try {
    const force = req.query.refresh === "1";
    await refreshCatalog(force);
    res.set("Cache-Control", "no-store");
    res.json({ folders: folderCatalog, count: folderCatalog.length });
  } catch (err) {
    console.error("Folder catalogue error:", err.message);
    res.status(503).json({ error: "Could not load MEGA folders. Check the server logs." });
  }
});

app.get("/api/account", async (req, res) => {
  try {
    if (!storageReady || !accounts.some((account) => account.ready && account.storage)) return res.status(503).json({ error: "MEGA is not connected." });
    const results = await Promise.all(accounts.filter((account) => account.ready && account.storage).map(async (account) => {
      const info = await account.storage.getAccountInfo();
      return {
        id: account.id,
        name: account.label,
        spaceUsed: Number(info.spaceUsed || 0),
        spaceTotal: Number(info.spaceTotal || 0),
        downloadBandwidthUsed: Number(info.downloadBandwidthUsed || 0),
        downloadBandwidthTotal: Number(info.downloadBandwidthTotal || 0)
      };
    }));
    res.json({ accounts: results });
  } catch (err) {
    console.error("MEGA account info error:", err.message);
    res.status(503).json({ error: "MEGA account information is temporarily unavailable." });
  }
});

app.head("/api/stream/:id", async (req, res) => {
  try {
    const files = await refreshCatalog();
    const item = files.find((entry) => entry.id === req.params.id);
    if (!item) return res.sendStatus(404);
    res.set({
      "Accept-Ranges": "bytes",
      "Content-Type": item.mime,
      "Content-Length": String(item.size),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    });
    return res.status(200).end();
  } catch (err) {
    console.error("Stream HEAD error:", err.message);
    return res.sendStatus(503);
  }
});

app.get("/api/stream/:id", async (req, res) => {
  let upstream;
  try {
    const files = await refreshCatalog();
    const item = files.find((entry) => entry.id === req.params.id);
    if (!item) return res.status(404).json({ error: "Video not found. Refresh the library and try again." });
    if (!Number.isSafeInteger(item.size) || item.size <= 0) {
      return res.status(422).json({ error: "MEGA did not report a valid file size." });
    }

    const range = parseRange(req.headers.range, item.size);
    if (range && range.invalid) {
      res.set("Content-Range", "bytes */" + item.size);
      return res.status(416).end();
    }

    const start = range ? range.start : 0;
    const end = range ? range.end : item.size - 1;
    const length = end - start + 1;
    res.status(range ? 206 : 200);
    res.set({
      "Content-Type": item.mime,
      "Accept-Ranges": "bytes",
      "Content-Length": String(length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline; filename*=UTF-8''" + encodeURIComponent(item.name)
    });
    if (range) res.set("Content-Range", "bytes " + start + "-" + end + "/" + item.size);

    const account = accounts.find((entry) => entry.id === item.accountId && entry.ready && entry.storage);
    const file = account && account.storage.files[item.nodeId];
    if (!file) {
      res.status(404).end();
      return;
    }
    upstream = file.download({ start, end, maxConnections: 2, forceHttps: true });
    upstream.on("error", (err) => {
      console.error("MEGA stream error:", err.message);
      if (!res.headersSent) res.status(502);
      res.destroy(err);
    });
    res.on("close", () => {
      if (upstream && !upstream.destroyed) upstream.destroy();
    });
    upstream.pipe(res);
  } catch (err) {
    console.error("Stream setup error:", err.message);
    if (!res.headersSent) res.status(503).json({ error: "Could not start the MEGA stream." });
    else res.destroy(err);
  }
});

app.get("/healthz", (req, res) => res.json({ ok: true, megaConnected: storageReady }));

const server = app.listen(PORT, HOST, () => {
  console.log("MEGA Stream listening on http://" + HOST + ":" + PORT);
});

connectMega().catch((err) => {
  storageError = err;
  storageReady = false;
  console.error("MEGA connection failed:", err.message);
  console.error("Check MEGA_EMAIL, MEGA_PASSWORD and any required two-factor authentication.");
});

async function shutdown() {
  console.log("Shutting down...");
  server.close();
  for (const account of accounts) {
    try { if (account.storage && typeof account.storage.close === "function") await account.storage.close(); } catch {}
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

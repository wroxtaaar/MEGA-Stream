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

if (!process.env.MEGA_EMAIL || !process.env.MEGA_PASSWORD) {
  console.error("Set MEGA_EMAIL and MEGA_PASSWORD in .env.");
  process.exit(1);
}

if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use(express.static(path.join(__dirname, "public"), { index: false }));

let storage = null;
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

function walkFiles(folder, parent = "") {
  const output = [];
  for (const item of (folder && Array.isArray(folder.children) ? folder.children : [])) {
    const relativePath = parent ? parent + "/" + item.name : item.name;
    if (item.directory) {
      output.push(...walkFiles(item, relativePath));
      continue;
    }
    if (!item.nodeId || !VIDEO_EXTENSIONS.has(path.extname(item.name || "").toLowerCase())) continue;
    output.push({
      id: String(item.nodeId),
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


function walkFolders(folder, parent = "") {
  const output = [];
  for (const item of (folder && Array.isArray(folder.children) ? folder.children : [])) {
    if (!item.directory) continue;
    const folderPath = parent ? parent + "/" + item.name : item.name;
    output.push({
      id: String(item.nodeId || folderPath),
      name: item.name || "Untitled folder",
      path: folderPath,
      parentPath: parent
    });
    output.push(...walkFolders(item, folderPath));
  }
  return output;
}

async function connectMega() {
  console.log("Connecting to MEGA...");
  storage = new Storage({
    email: process.env.MEGA_EMAIL,
    password: process.env.MEGA_PASSWORD,
    ...(process.env.MEGA_TFA_CODE ? { secondFactorCode: process.env.MEGA_TFA_CODE } : {}),
    autoload: true,
    keepalive: true
  });
  await storage.ready;
  storageReady = true;
  storageError = null;
  console.log("MEGA connected. Account tree loaded.");
  await refreshCatalog(true);
}

async function refreshCatalog(force = false) {
  if (!storageReady || !storage || !storage.root) throw new Error("MEGA is not connected.");
  if (!force && Date.now() - lastCatalogRefresh < REFRESH_MS) return catalog;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    await storage.reload();
    catalog = walkFiles(storage.root).sort((a, b) => a.name.localeCompare(b.name));
    folderCatalog = walkFolders(storage.root).sort((a, b) => a.name.localeCompare(b.name));
    lastCatalogRefresh = Date.now();
    console.log("Indexed " + catalog.length + " video files from MEGA.");
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
    error: storageError ? "MEGA connection needs attention." : null
  });
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
    if (!storageReady || !storage) return res.status(503).json({ error: "MEGA is not connected." });
    const info = await storage.getAccountInfo();
    res.json({
      name: storage.name || "MEGA account",
      spaceUsed: Number(info.spaceUsed || 0),
      spaceTotal: Number(info.spaceTotal || 0),
      downloadBandwidthUsed: Number(info.downloadBandwidthUsed || 0),
      downloadBandwidthTotal: Number(info.downloadBandwidthTotal || 0)
    });
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

    const file = storage.files[item.id];
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
  try { if (storage && typeof storage.close === "function") await storage.close(); } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

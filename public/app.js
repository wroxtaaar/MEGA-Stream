const $ = (selector) => document.querySelector(selector);
const connection = $("#connection");
const grid = $("#video-grid");
const summary = $("#library-summary");
const search = $("#search");
const notice = $("#notice");
const playerPanel = $("#player-panel");
const player = $("#player");
const nowPlaying = $("#now-playing");
const breadcrumb = $("#breadcrumbs");
const backButton = $("#back-folder");
const sortSelect = $("#sort-by");
const aspectSelect = $("#aspect-ratio");
let currentAspectRatio = "original";
let videos = [];
let folders = [];
let currentFolder = "";
let searchMode = false;

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 1024) return value + " B";
  const units = ["KB", "MB", "GB", "TB"];
  let n = value / 1024;
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) { n /= 1024; unit++; }
  return n.toFixed(n >= 10 ? 0 : 1) + " " + units[unit];
}
function showNotice(message) { notice.textContent = message; notice.classList.remove("hidden"); }
function hideNotice() { notice.classList.add("hidden"); notice.textContent = ""; }
async function api(url) {
  const response = await fetch(url, { credentials: "same-origin" });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed (" + response.status + ")");
  return data;
}
async function checkStatus() {
  try {
    const status = await api("/api/status");
    connection.classList.toggle("ok", status.megaConnected);
    connection.lastChild.textContent = status.megaConnected ? " MEGA connected" : " MEGA reconnect needed";
    if (status.error) showNotice(status.error);
    await loadLibrary();
  } catch (error) {
    connection.lastChild.textContent = " Service unavailable";
    showNotice(error.message);
  }
}
async function loadLibrary(force = false) {
  summary.textContent = "Loading your MEGA library…";
  hideNotice();
  try {
    const suffix = force ? "?refresh=1" : "";
    const [videoData, folderData] = await Promise.all([api("/api/videos" + suffix), api("/api/folders" + suffix)]);
    videos = videoData.videos || [];
    folders = folderData.folders || [];
    renderLibrary();
    summary.textContent = videos.length + " video" + (videos.length === 1 ? "" : "s") + " · " + folders.length + " folder" + (folders.length === 1 ? "" : "s") + " · stored in MEGA";
    connection.classList.add("ok");
    connection.lastChild.textContent = " MEGA connected";
  } catch (error) {
    summary.textContent = "Could not load the library";
    showNotice(error.message);
  }
}
function openFolder(path) {
  currentFolder = path;
  searchMode = false;
  search.value = "";
  renderLibrary();
}
function renderBreadcrumbs() {
  breadcrumb.replaceChildren();
  const root = document.createElement("button");
  root.className = "crumb";
  root.type = "button";
  root.textContent = "My Drive";
  root.addEventListener("click", () => openFolder(""));
  breadcrumb.append(root);
  if (!currentFolder) return;
  const parts = currentFolder.split("/");
  let path = "";
  for (const part of parts) {
    path = path ? path + "/" + part : part;
    const nextPath = path;
    const sep = document.createElement("span");
    sep.className = "crumb-separator";
    sep.textContent = "›";
    const crumb = document.createElement("button");
    crumb.className = "crumb";
    crumb.type = "button";
    crumb.textContent = part;
    crumb.addEventListener("click", () => openFolder(nextPath));
    breadcrumb.append(sep, crumb);
  }
}
function createFolderCard(folder) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "folder-card";
  card.setAttribute("aria-label", "Open folder " + folder.name);
  const icon = document.createElement("span");
  icon.className = "folder-icon";
  icon.textContent = "📁";
  const details = document.createElement("span");
  details.className = "folder-details";
  const name = document.createElement("span");
  name.className = "folder-name";
  name.textContent = folder.name;
  const count = videos.filter(v => v.folderPath === folder.path || v.folderPath.startsWith(folder.path + "/")).length;
  const meta = document.createElement("span");
  meta.className = "folder-meta";
  meta.textContent = count + " video" + (count === 1 ? "" : "s") + " in this folder and subfolders";
  details.append(name, meta);
  const arrow = document.createElement("span");
  arrow.className = "folder-arrow";
  arrow.textContent = "›";
  card.append(icon, details, arrow);
  card.addEventListener("click", () => openFolder(folder.path));
  return card;
}
function createVideoCard(video) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "video-card";
  card.setAttribute("aria-label", "Play " + video.name);
  const poster = document.createElement("div");
  poster.className = "poster";
  const ext = (video.name.split(".").pop() || "video").slice(0, 5);
  const type = document.createElement("span");
  type.className = "file-type";
  type.textContent = ext;
  const play = document.createElement("span");
  play.className = "play-mark";
  play.textContent = "▶";
  poster.append(type, play);
  const info = document.createElement("div");
  info.className = "video-info";
  const name = document.createElement("div");
  name.className = "video-name";
  name.textContent = video.name;
  name.title = video.name;
  const meta = document.createElement("div");
  meta.className = "video-meta";
  const size = document.createElement("span");
  size.textContent = formatBytes(video.size);
  meta.append(size);
  const pathLine = document.createElement("div");
  pathLine.className = "path-line";
  pathLine.textContent = video.folderPath || "My Drive";
  pathLine.title = video.path;
  info.append(name, meta, pathLine);
  card.append(poster, info);
  card.addEventListener("click", () => playVideo(video));
  return card;
}
function sortVideos(items) {
  const mode = sortSelect.value;
  return [...items].sort((a, b) => {
    if (mode === "size-desc") return (b.size || 0) - (a.size || 0) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    if (mode === "size-asc") return (a.size || 0) - (b.size || 0) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
}
function sortFolders(items) {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}
function renderLibrary() {
  const query = search.value.trim().toLocaleLowerCase();
  searchMode = Boolean(query);
  renderBreadcrumbs();
  backButton.classList.toggle("hidden", !currentFolder);
  grid.replaceChildren();
  const fragment = document.createDocumentFragment();
  if (searchMode) {
    const matchingFolders = folders.filter(f => (f.name + " " + f.path).toLocaleLowerCase().includes(query));
    const matchingVideos = videos.filter(v => (v.name + " " + v.path).toLocaleLowerCase().includes(query));
    sortFolders(matchingFolders).forEach(f => fragment.append(createFolderCard(f)));
    sortVideos(matchingVideos).forEach(v => fragment.append(createVideoCard(v)));
    $("#empty-state").classList.toggle("hidden", matchingFolders.length + matchingVideos.length > 0);
  } else {
    const childFolders = folders.filter(f => f.parentPath === currentFolder);
    const currentVideos = videos.filter(v => v.folderPath === currentFolder);
    sortFolders(childFolders).forEach(f => fragment.append(createFolderCard(f)));
    sortVideos(currentVideos).forEach(v => fragment.append(createVideoCard(v)));
    $("#empty-state").classList.toggle("hidden", childFolders.length + currentVideos.length > 0);
  }
  grid.append(fragment);
}
function applyAspectRatio() {
  currentAspectRatio = aspectSelect.value;
  if (currentAspectRatio === "original") {
    player.style.aspectRatio = "auto";
    player.style.height = "auto";
    player.style.objectFit = "contain";
    player.style.maxHeight = "70vh";
    return;
  }
  const ratios = { "16:9": 16 / 9, "4:3": 4 / 3, "21:9": 21 / 9 };
  const ratio = ratios[currentAspectRatio];
  const availableWidth = Math.max(240, playerPanel.clientWidth - 36);
  const height = Math.min(availableWidth / ratio, window.innerHeight * 0.7);
  player.style.aspectRatio = String(ratio);
  player.style.height = height + "px";
  player.style.maxHeight = "70vh";
  player.style.objectFit = "contain";
}
function playVideo(video) {
  playerPanel.classList.remove("hidden");
  nowPlaying.textContent = video.name;
  player.pause();
  player.src = "/api/stream/" + encodeURIComponent(video.id);
  player.load();
  applyAspectRatio();
  playerPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  player.play().catch(() => {});
}
$("#refresh").addEventListener("click", () => loadLibrary(true));
$("#close-player").addEventListener("click", () => {
  player.pause();
  player.removeAttribute("src");
  player.load();
  playerPanel.classList.add("hidden");
});
backButton.addEventListener("click", () => {
  currentFolder = currentFolder.includes("/") ? currentFolder.slice(0, currentFolder.lastIndexOf("/")) : "";
  renderLibrary();
});
search.addEventListener("input", renderLibrary);
aspectSelect.addEventListener("change", applyAspectRatio);
window.addEventListener("resize", () => { if (!playerPanel.classList.contains("hidden")) applyAspectRatio(); });
sortSelect.addEventListener("change", renderLibrary);
checkStatus();

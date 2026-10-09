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
const accountFilter = $("#account-filter");
let accountList = [];
const aspectSelect = $("#aspect-ratio");
const playerStage = $("#player-stage");
const playerOverlay = $("#player-overlay");
const fullscreenButton = $("#fullscreen-player");
const playPauseButton = $("#play-pause");
const seekControl = $("#player-seek");
const timeLabel = $("#player-time");
const volumeControl = $("#player-volume");
let overlayHideTimer = null;
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
    updateAccountFilter(status.accounts || []);
    if (status.error) showNotice(status.error);
    connection.classList.toggle("ok", status.megaConnected);
    connection.lastChild.textContent = status.megaConnected ? " MEGA connected" : " MEGA reconnect needed";
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
    const [videoData, folderData, accountData] = await Promise.all([api("/api/videos" + suffix), api("/api/folders" + suffix), api("/api/accounts")]);
    videos = videoData.videos || [];
    folders = folderData.folders || [];
    updateAccountFilter(accountData.accounts || []);
    renderLibrary();
    summary.textContent = videos.length + " video" + (videos.length === 1 ? "" : "s") + " · " + folders.length + " folder" + (folders.length === 1 ? "" : "s") + " · stored in MEGA";
    connection.classList.add("ok");
    connection.lastChild.textContent = " MEGA connected";
  } catch (error) {
    summary.textContent = "Could not load the library";
    showNotice(error.message);
  }
}
function updateAccountFilter(accounts) {
  accountList = accounts;
  const selected = accountFilter.value || "all";
  accountFilter.replaceChildren();
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All accounts";
  accountFilter.append(allOption);
  for (const account of accounts) {
    const option = document.createElement("option");
    option.value = account.id;
    option.textContent = account.name + (account.connected ? "" : " (offline)");
    accountFilter.append(option);
  }
  accountFilter.value = accounts.some((account) => account.id === selected) ? selected : "all";
}
function accountFiltered(items) {
  const selected = accountFilter.value;
  return selected === "all" ? items : items.filter((item) => item.accountId === selected);
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
  const count = videos.filter(v => v.accountId === folder.accountId && (v.folderPath === folder.path || v.folderPath.startsWith(folder.path + "/"))).length;
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
  pathLine.textContent = (video.folderPath || "My Drive") + " · " + (video.accountName || "MEGA");
  pathLine.title = video.accountName + " · " + video.path;
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
  const visibleVideos = accountFiltered(videos);
  const visibleFolders = accountFiltered(folders);
  searchMode = Boolean(query);
  renderBreadcrumbs();
  backButton.classList.toggle("hidden", !currentFolder);
  grid.replaceChildren();
  const fragment = document.createDocumentFragment();
  if (searchMode) {
    const matchingFolders = visibleFolders.filter(f => (f.name + " " + f.path + " " + f.accountName).toLocaleLowerCase().includes(query));
    const matchingVideos = visibleVideos.filter(v => (v.name + " " + v.path + " " + v.accountName).toLocaleLowerCase().includes(query));
    sortFolders(matchingFolders).forEach(f => fragment.append(createFolderCard(f)));
    sortVideos(matchingVideos).forEach(v => fragment.append(createVideoCard(v)));
    $("#empty-state").classList.toggle("hidden", matchingFolders.length + matchingVideos.length > 0);
  } else {
    const childFolders = visibleFolders.filter(f => f.parentPath === currentFolder);
    const currentVideos = visibleVideos.filter(v => v.folderPath === currentFolder);
    sortFolders(childFolders).forEach(f => fragment.append(createFolderCard(f)));
    sortVideos(currentVideos).forEach(v => fragment.append(createVideoCard(v)));
    $("#empty-state").classList.toggle("hidden", childFolders.length + currentVideos.length > 0);
  }
  grid.append(fragment);
}
function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? h + ":" + String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0") : m + ":" + String(sec).padStart(2, "0");
}
function applyAspectRatio() {
  currentAspectRatio = aspectSelect.value;
  const fullscreen = document.fullscreenElement === playerStage || document.fullscreenElement === player;
  const ratios = { "16:9": 16 / 9, "16:10": 16 / 10, "4:3": 4 / 3, "21:9": 21 / 9 };
  const ratio = ratios[currentAspectRatio];
  // Never stretch the encoded picture. Size the video box to the chosen ratio,
  // then use contain so the actual video keeps its own proportions.
  player.style.objectFit = "contain";
  player.style.margin = "auto";
  if (fullscreen) {
    playerStage.style.aspectRatio = "auto";
    playerStage.style.display = "flex";
    playerStage.style.alignItems = "center";
    playerStage.style.justifyContent = "center";
    if (ratio) {
      const fittedWidth = Math.min(window.innerWidth, window.innerHeight * ratio);
      const fittedHeight = Math.min(window.innerHeight, window.innerWidth / ratio);
      const width = Math.min(fittedWidth, fittedHeight * ratio);
      player.style.width = width + "px";
      player.style.height = (width / ratio) + "px";
      player.style.maxWidth = "100vw";
      player.style.maxHeight = "100vh";
    } else {
      player.style.width = "100%";
      player.style.height = "100%";
      player.style.maxWidth = "100vw";
      player.style.maxHeight = "100vh";
    }
  } else if (ratio) {
    playerStage.style.aspectRatio = String(ratio);
    player.style.width = "100%";
    player.style.height = "100%";
    player.style.maxHeight = "none";
    player.style.maxWidth = "none";
  } else {
    playerStage.style.aspectRatio = "16 / 9";
    player.style.width = "100%";
    player.style.height = "100%";
    player.style.maxHeight = "70vh";
    player.style.maxWidth = "100%";
  }
}
function updatePlaybackControls() {
  playPauseButton.textContent = player.paused ? "▶" : "Ⅱ";
  playPauseButton.setAttribute("aria-label", player.paused ? "Play video" : "Pause video");
  const duration = Number.isFinite(player.duration) ? player.duration : 0;
  timeLabel.textContent = formatTime(player.currentTime) + " / " + formatTime(duration);
  seekControl.value = duration ? String(Math.round(player.currentTime / duration * 1000)) : "0";
}
function revealOverlay() {
  togglePlayerOverlay(true);
  clearTimeout(overlayHideTimer);
  if (!player.paused) overlayHideTimer = setTimeout(() => togglePlayerOverlay(false), 3500);
}

function togglePlayerOverlay(force) {
  const show = typeof force === "boolean" ? force : playerOverlay.classList.contains("is-hidden");
  playerOverlay.classList.toggle("is-hidden", !show);
  playerStage.classList.toggle("controls-hidden", !show);
  if (show && !player.paused) {
    clearTimeout(overlayHideTimer);
    overlayHideTimer = setTimeout(() => togglePlayerOverlay(false), 3500);
  }
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (player.requestFullscreen) await player.requestFullscreen();
    // Avoid native video fullscreen because it replaces our custom overlay with browser controls.
    else throw new Error("Custom fullscreen is not supported by this browser.");
  } catch (error) {
    showNotice("Fullscreen is unavailable in this browser.");
  }
}

function playVideo(video) {
  playerPanel.classList.remove("hidden");
  nowPlaying.textContent = video.name;
  player.pause();
  player.src = "/api/stream/" + encodeURIComponent(video.id);
  player.load();
  applyAspectRatio();
  togglePlayerOverlay(true);
  playerPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  player.play().catch(() => {});
  updatePlaybackControls();
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
aspectSelect.addEventListener("change", () => { applyAspectRatio(); revealOverlay(); });
playPauseButton.addEventListener("click", (event) => { event.stopPropagation(); if (player.paused) player.play().catch(() => {}); else player.pause(); revealOverlay(); });
seekControl.addEventListener("input", () => { if (Number.isFinite(player.duration) && player.duration > 0) player.currentTime = Number(seekControl.value) / 1000 * player.duration; revealOverlay(); });
volumeControl.addEventListener("input", () => { player.volume = Number(volumeControl.value); player.muted = player.volume === 0; revealOverlay(); });
["timeupdate","durationchange","play","pause","loadedmetadata","volumechange","ended"].forEach(name => player.addEventListener(name, updatePlaybackControls));
fullscreenButton.addEventListener("click", (event) => { event.stopPropagation(); toggleFullscreen(); });
playerStage.addEventListener("click", (event) => {
  // Taps on the video toggle playback; taps on the overlay background
  // show/hide controls. Interactive controls keep their own click behavior.
  if (event.target.closest("button, input, select, label")) return;
  if (event.target === player || event.target.closest("video")) {
    if (player.paused) player.play().catch(() => {});
    else player.pause();
    revealOverlay();
    return;
  }
  togglePlayerOverlay();
});
playerStage.addEventListener("dblclick", (event) => {
  if (!event.target.closest(".player-overlay")) toggleFullscreen();
});
document.addEventListener("fullscreenchange", () => {
  const fullscreen = document.fullscreenElement === playerStage || document.fullscreenElement === player;
  fullscreenButton.textContent = fullscreen ? "⛶ Exit fullscreen" : "⛶ Fullscreen";
  revealOverlay();
  applyAspectRatio();
  // Keep the ratio picker visible after entering fullscreen; it can still auto-hide after interaction.
});
window.addEventListener("resize", () => { if (!playerPanel.classList.contains("hidden")) applyAspectRatio(); });
playerStage.addEventListener("pointermove", () => { if (document.fullscreenElement === playerStage) revealOverlay(); });
sortSelect.addEventListener("change", renderLibrary);
accountFilter.addEventListener("change", () => { currentFolder = ""; renderLibrary(); });
checkStatus();

const $ = (selector) => document.querySelector(selector);
const library = $("#library");
const connection = $("#connection");
const grid = $("#video-grid");
const summary = $("#library-summary");
const search = $("#search");
const notice = $("#notice");
const playerPanel = $("#player-panel");
const player = $("#player");
const nowPlaying = $("#now-playing");
let videos = [];

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 1024) return value + " B";
  const units = ["KB", "MB", "GB", "TB"];
  let n = value / 1024;
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) { n /= 1024; unit++; }
  return n.toFixed(n >= 10 ? 0 : 1) + " " + units[unit];
}
function showNotice(message) {
  notice.textContent = message;
  notice.classList.remove("hidden");
}
function hideNotice() { notice.classList.add("hidden"); notice.textContent = ""; }
async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request failed (" + response.status + ")");
  }
  return data;
}
async function checkStatus() {
  try {
    const status = await api("/api/status");
    connection.classList.toggle("ok", status.megaConnected);
    connection.lastChild.textContent = status.megaConnected ? " MEGA connected" : " MEGA reconnect needed";
    if (status.error) showNotice(status.error);
    await loadVideos();
  } catch (error) {
    connection.lastChild.textContent = " Service unavailable";
    showNotice(error.message);
  }
}
async function loadVideos(force = false) {
  summary.textContent = "Loading your MEGA library…";
  hideNotice();
  try {
    const data = await api("/api/videos" + (force ? "?refresh=1" : ""));
    videos = data.videos || [];
    renderVideos();
    summary.textContent = videos.length + " video" + (videos.length === 1 ? "" : "s") + " · stored in MEGA";
    connection.classList.add("ok");
    connection.lastChild.textContent = " MEGA connected";
  } catch (error) {
    summary.textContent = "Could not load the library";
    showNotice(error.message);
  }
}
function renderVideos() {
  const query = search.value.trim().toLocaleLowerCase();
  const filtered = videos.filter((video) => (video.name + " " + video.path).toLocaleLowerCase().includes(query));
  grid.replaceChildren();
  $("#empty-state").classList.toggle("hidden", filtered.length !== 0);
  if (filtered.length === 0) return;
  const fragment = document.createDocumentFragment();
  for (const video of filtered) {
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
    const filler = document.createElement("span");
    meta.append(size, filler);
    const pathLine = document.createElement("div");
    pathLine.className = "path-line";
    pathLine.textContent = video.path.includes("/") ? video.path.slice(0, video.path.lastIndexOf("/")) : "My Drive";
    pathLine.title = video.path;
    info.append(name, meta, pathLine);
    card.append(poster, info);
    card.addEventListener("click", () => playVideo(video));
    fragment.append(card);
  }
  grid.append(fragment);
}
function playVideo(video) {
  playerPanel.classList.remove("hidden");
  nowPlaying.textContent = video.name;
  player.pause();
  player.src = "/api/stream/" + encodeURIComponent(video.id);
  player.load();
  playerPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  player.play().catch(() => {});
}
$("#refresh").addEventListener("click", () => loadVideos(true));
$($("#close-player").addEventListener("click", () => {
  player.pause();
  player.removeAttribute("src");
  player.load();
  playerPanel.classList.add("hidden");
});
search.addEventListener("input", renderVideos);
checkStatus();

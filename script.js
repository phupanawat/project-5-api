// Quake Watch
// API:        USGS Earthquake GeoJSON feeds (no API key needed, CORS enabled)
// Animation:  mo.js (Shape, Burst, Html, Timeline)

const FEEDS = {
  hour: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson",
  day: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
  week: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson",
};

const PAGE_SIZE = 48; // cards added per "Show more" click
const MAG_COLORS = {
  "mag-minor": "#4cc38a",
  "mag-light": "#f2c94c",
  "mag-moderate": "#ff9f43",
  "mag-strong": "#ff5d5d",
};

const state = {
  range: "day",
  minMag: 0,
  sort: "newest",
  quakes: [], // everything from the current feed
  visible: [], // after filter + sort
  shown: 0, // how many cards are currently on the page
};

const grid = document.getElementById("quake-grid");
const statusEl = document.getElementById("status");
const moreButton = document.getElementById("more-button");
const refreshButton = document.getElementById("refresh-button");
const epicenterEl = document.getElementById("epicenter");

// Skip animations if mo.js failed to load or the user prefers reduced motion
const canAnimate =
  typeof window.mojs !== "undefined" &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

async function loadQuakes() {
  setStatus("Loading earthquakes…");
  refreshButton.disabled = true;

  try {
    const response = await fetch(FEEDS[state.range]);
    if (!response.ok) {
      throw new Error("USGS responded with status " + response.status);
    }
    const data = await response.json();

    // Keep only the fields the page uses
    state.quakes = data.features
      .filter((f) => f.properties.type === "earthquake" && f.properties.mag !== null)
      .map((f) => ({
        id: f.id,
        mag: f.properties.mag,
        place: f.properties.place || "Unknown location",
        time: f.properties.time,
        url: f.properties.url,
        tsunami: f.properties.tsunami === 1,
        depth: f.geometry ? f.geometry.coordinates[2] : null,
      }));

    document.getElementById("updated").textContent =
      "Updated " + new Date(data.metadata.generated).toLocaleTimeString();

    render();
  } catch (error) {
    console.error(error);
    state.quakes = [];
    render();
    setStatus("Could not load earthquake data. Check your connection and try Refresh.", true);
  } finally {
    refreshButton.disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function render() {
  const sorters = {
    newest: (a, b) => b.time - a.time,
    strongest: (a, b) => b.mag - a.mag,
    deepest: (a, b) => (b.depth ?? -Infinity) - (a.depth ?? -Infinity),
  };

  state.visible = state.quakes
    .filter((q) => q.mag >= state.minMag)
    .sort(sorters[state.sort]);
  state.shown = 0;

  grid.replaceChildren();
  updateStats();
  showMore();

  if (state.visible.length === 0) {
    setStatus("No earthquakes match these filters.");
  } else {
    setStatus("");
  }
}

function showMore() {
  const next = state.visible.slice(state.shown, state.shown + PAGE_SIZE);
  const cards = next.map(createCard);
  grid.append(...cards);
  state.shown += next.length;
  moreButton.hidden = state.shown >= state.visible.length;
  animateCardsIn(cards);
}

function createCard(quake) {
  const level = magLevel(quake.mag);

  const card = document.createElement("article");
  card.className = "quake-card " + level;
  card.tabIndex = 0;
  card.dataset.mag = quake.mag;
  card.dataset.level = level;

  const mag = document.createElement("div");
  mag.className = "quake-mag";
  mag.textContent = quake.mag.toFixed(1);

  const place = document.createElement("p");
  place.className = "quake-place";
  place.textContent = quake.place;

  const meta = document.createElement("div");
  meta.className = "quake-meta";
  meta.append(makeSpan(timeAgo(quake.time)));
  if (quake.depth !== null) {
    meta.append(makeSpan(quake.depth.toFixed(1) + " km deep"));
  }
  if (quake.tsunami) {
    meta.append(makeSpan("Tsunami alert"));
  }

  const link = document.createElement("a");
  link.className = "quake-link";
  link.href = quake.url;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "USGS details";

  card.append(mag, place, meta, link);
  return card;
}

function makeSpan(text) {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
}

function updateStats() {
  const list = state.visible;
  const strongest = list.reduce((top, q) => (top === null || q.mag > top.mag ? q : top), null);
  const depths = list.filter((q) => q.depth !== null).map((q) => q.depth);

  setText("stat-count", list.length);
  setText("stat-max", strongest ? strongest.mag.toFixed(1) : "--");
  setText("stat-avg", list.length ? average(list.map((q) => q.mag)).toFixed(1) : "--");
  setText("stat-depth", depths.length ? average(depths).toFixed(0) + " km" : "--");

  setText("strongest-mag", strongest ? "M " + strongest.mag.toFixed(1) : "--");
  setText("strongest-place", strongest ? strongest.place : "No earthquakes to show");
  document.getElementById("strongest-mag").style.color = strongest
    ? MAG_COLORS[magLevel(strongest.mag)]
    : "";

  startRipples(strongest ? strongest.mag : null);
}

/* ------------------------------------------------------------------ */
/* Animations (mo.js)                                                  */
/* ------------------------------------------------------------------ */

// 1) Epicenter ripples: mojs.Shape rings that loop. Stronger quake = bigger, faster rings.
let ripples = [];

function startRipples(mag) {
  ripples.forEach((ring) => {
    ring.stop();
    ring.el.remove();
  });
  ripples = [];

  if (!canAnimate || mag === null) return;

  const radius = clamp(22 + mag * 6, 22, 68);
  const duration = clamp(3200 - mag * 280, 1200, 3200);
  const color = MAG_COLORS[magLevel(mag)];

  for (let i = 0; i < 3; i++) {
    const ring = new mojs.Shape({
      parent: epicenterEl,
      shape: "circle",
      fill: "none",
      stroke: color,
      strokeWidth: { 5: 0 },
      radius: { 4: radius },
      opacity: { 1: 0 },
      duration: duration,
      delay: (i * duration) / 3,
      easing: "cubic.out",
      repeat: 9999,
    }).play();
    ripples.push(ring);
  }
}

// 2) Card entrance: mojs.Html slides and fades each new card in, staggered.
function animateCardsIn(cards) {
  // Browsers pause animation frames in background tabs, which would leave the
  // cards stuck invisible, so only animate when the page is actually on screen.
  if (!canAnimate || document.visibilityState !== "visible") return;

  cards.forEach((card, index) => {
    new mojs.Html({
      el: card,
      y: { 30: 0 },
      opacity: { 0: 1 },
      duration: 500,
      delay: Math.min(index, 20) * 40,
      easing: "cubic.out",
    }).play();
  });
}

// 3) Shockwave on click: a mojs.Burst and a mojs.Shape ring on one mojs.Timeline.
let shockBurst = null;
let shockRing = null;
let shockTimeline = null;

if (canAnimate) {
  shockBurst = new mojs.Burst({
    left: 0,
    top: 0,
    count: 12,
    radius: { 0: 80 },
    children: {
      shape: "line",
      stroke: "#ff7a3d",
      strokeWidth: { 4: 0 },
      radius: 14,
      duration: 700,
      easing: "quad.out",
    },
  });

  shockRing = new mojs.Shape({
    left: 0,
    top: 0,
    shape: "circle",
    fill: "none",
    stroke: "#ff7a3d",
    strokeWidth: { 12: 0 },
    radius: { 0: 60 },
    opacity: { 1: 0 },
    duration: 700,
    easing: "cubic.out",
  });

  shockTimeline = new mojs.Timeline();
  shockTimeline.add(shockBurst, shockRing);
}

function shockwave(card, x, y) {
  if (!canAnimate) return;

  const mag = Number(card.dataset.mag);
  const color = MAG_COLORS[card.dataset.level];
  const size = clamp(40 + mag * 22, 40, 220); // magnitude controls the size

  shockBurst.tune({
    x: x,
    y: y,
    radius: { 0: size },
    children: { stroke: color },
  });
  shockRing.tune({
    x: x,
    y: y,
    radius: { 0: size * 0.75 },
    stroke: color,
  });
  shockTimeline.replay();

  // Jolt the card itself
  new mojs.Html({
    el: card,
    scaleX: { 0.94: 1 },
    scaleY: { 0.94: 1 },
    duration: 700,
    easing: "elastic.out",
  }).play();
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

grid.addEventListener("click", (event) => {
  const card = event.target.closest(".quake-card");
  if (!card || event.target.closest("a")) return;
  shockwave(card, event.pageX, event.pageY);
});

// Keyboard support: Enter or Space fires the shockwave from the card center
grid.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = event.target.closest(".quake-card");
  if (!card || event.target !== card) return;
  event.preventDefault();
  const box = card.getBoundingClientRect();
  shockwave(card, box.left + box.width / 2 + window.scrollX, box.top + box.height / 2 + window.scrollY);
});

document.getElementById("range-buttons").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  setActive(button);
  state.range = button.dataset.range;
  loadQuakes();
});

document.getElementById("mag-buttons").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  setActive(button);
  state.minMag = Number(button.dataset.mag);
  render();
});

document.getElementById("sort-select").addEventListener("change", (event) => {
  state.sort = event.target.value;
  render();
});

refreshButton.addEventListener("click", loadQuakes);
moreButton.addEventListener("click", showMore);

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function magLevel(mag) {
  if (mag >= 5) return "mag-strong";
  if (mag >= 4) return "mag-moderate";
  if (mag >= 2.5) return "mag-light";
  return "mag-minor";
}

function timeAgo(timestamp) {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return minutes + " min ago";
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
  const days = Math.round(hours / 24);
  return days + (days === 1 ? " day ago" : " days ago");
}

function average(numbers) {
  return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setText(id, text) {
  document.getElementById(id).textContent = text;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function setActive(button) {
  button.parentElement.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
  button.classList.add("active");
}

loadQuakes();

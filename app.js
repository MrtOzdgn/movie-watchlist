import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
  getFirestore, collection, addDoc, doc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

const CONFIG = window.APP_CONFIG || {};
const TMDB_KEY = CONFIG.TMDB_API_KEY;
const TMDB_IMG = "https://image.tmdb.org/t/p/w185";
const GENRE_MAP = {
  28:"Action", 12:"Adventure", 16:"Animation", 35:"Comedy", 80:"Crime",
  99:"Documentary", 18:"Drama", 10751:"Family", 14:"Fantasy", 36:"History",
  27:"Horror", 10402:"Music", 9648:"Mystery", 10749:"Romance",
  878:"Science Fiction", 10770:"TV Movie", 53:"Thriller", 10752:"War", 37:"Western"
};
const GENRE_PALETTE = ["#2c6e63", "#c4472b", "#a9821f", "#6b4e71", "#35607a", "#6b7a35"];
const STATUS_ORDER = ["to-watch", "watching", "watched"];
const STATUS_LABEL = { "to-watch":"To Watch", "watching":"Watching", "watched":"Watched" };

const els = {
  loginBtn: document.getElementById("login-btn"),
  authStatus: document.getElementById("auth-status"),
  authEmail: document.getElementById("auth-email"),
  logoutBtn: document.getElementById("logout-btn"),
  configWarning: document.getElementById("config-warning"),
  tabs: document.getElementById("status-tabs"),
  addBtn: document.getElementById("add-btn"),
  searchPanel: document.getElementById("search-panel"),
  searchInput: document.getElementById("search-input"),
  searchResults: document.getElementById("search-results"),
  searchClose: document.getElementById("search-close"),
  statusMsg: document.getElementById("status-msg"),
  grid: document.getElementById("grid"),
  emptyMsg: document.getElementById("empty-msg"),
  cardCount: document.getElementById("card-count"),
  loginModal: document.getElementById("login-modal"),
  loginForm: document.getElementById("login-form"),
  loginEmail: document.getElementById("login-email"),
  loginPassword: document.getElementById("login-password"),
  loginError: document.getElementById("login-error"),
  loginCancel: document.getElementById("login-cancel"),
};

let movies = [];
let currentFilter = "all";
let loggedIn = false;
let db = null;
let auth = null;

function isConfigured() {
  const fc = CONFIG.FIREBASE_CONFIG || {};
  return fc.apiKey && fc.apiKey !== "PASTE_ME" && fc.projectId && fc.projectId !== "PASTE_ME";
}

function showStatus(msg, isError) {
  els.statusMsg.textContent = msg;
  els.statusMsg.hidden = !msg;
  els.statusMsg.classList.toggle("error", !!isError);
  if (msg && !isError) {
    setTimeout(() => { if (els.statusMsg.textContent === msg) els.statusMsg.hidden = true; }, 3000);
  }
}

function colorForGenre(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return GENRE_PALETTE[h % GENRE_PALETTE.length];
}

function starsMarkup(rating) {
  let s = "";
  for (let i = 1; i <= 5; i++) s += i <= rating ? "*" : '<span class="off">*</span>';
  return s;
}

function renderGrid() {
  const filtered = currentFilter === "all" ? movies : movies.filter(m => m.status === currentFilter);
  els.emptyMsg.hidden = filtered.length !== 0;
  els.emptyMsg.textContent = currentFilter === "all"
    ? "No cards filed yet."
    : `No cards filed under "${STATUS_LABEL[currentFilter]}".`;
  els.cardCount.textContent = movies.length;

  els.grid.innerHTML = filtered.map((m, i) => {
    const cardNo = String(i + 1).padStart(3, "0");
    const posterMarkup = m.posterUrl
      ? `<img class="card-poster" src="${m.posterUrl}" alt="${escapeHtml(m.title)} poster">`
      : `<div class="card-poster-blank">NO STILL<br>ON FILE</div>`;
    const editableStamp = loggedIn ? "editable" : "";
    const editableStars = loggedIn ? "editable" : "";
    return `
      <div class="card" data-id="${m.id}">
        ${loggedIn ? `<button class="card-delete" data-action="delete" data-id="${m.id}">Withdraw</button>` : ""}
        <div class="card-tab" style="background:${colorForGenre(m.genre)};">${escapeHtml(m.genre)}</div>
        <div class="card-body">
          ${posterMarkup}
          <div class="card-info">
            <div class="card-no">CARD NO. ${cardNo}</div>
            <div class="card-title">${escapeHtml(m.title)}</div>
            <div class="card-meta">${m.year || "—"}</div>
          </div>
        </div>
        <div class="card-foot">
          <button class="stars ${editableStars}" data-action="rate" data-id="${m.id}" ${loggedIn ? "" : "disabled"}>${starsMarkup(m.rating)}</button>
          <button class="stamp ${m.status} ${editableStamp}" data-action="cycle-status" data-id="${m.id}" ${loggedIn ? "" : "disabled"}>${STATUS_LABEL[m.status]}</button>
        </div>
      </div>
    `;
  }).join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ---------- Firestore wiring ----------
function startListening() {
  const q = query(collection(db, "movies"), orderBy("addedAt", "desc"));
  onSnapshot(q, snap => {
    movies = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderGrid();
  }, err => {
    showStatus("Couldn't load the drawer: " + err.message, true);
  });
}

async function addMovie(result) {
  const dup = movies.find(m => m.tmdbId === result.id);
  if (dup) { showStatus(`"${result.title}" is already on your list.`, true); return; }
  const genreId = (result.genre_ids || [])[0];
  await addDoc(collection(db, "movies"), {
    tmdbId: result.id,
    title: result.title,
    year: (result.release_date || "").slice(0, 4),
    genre: GENRE_MAP[genreId] || "Unspecified",
    posterUrl: result.poster_path ? TMDB_IMG + result.poster_path : null,
    status: "to-watch",
    rating: 0,
    addedAt: serverTimestamp(),
  });
  showStatus(`Filed "${result.title}".`, false);
}

async function cycleStatus(id) {
  const m = movies.find(x => x.id === id);
  if (!m) return;
  const next = STATUS_ORDER[(STATUS_ORDER.indexOf(m.status) + 1) % STATUS_ORDER.length];
  await updateDoc(doc(db, "movies", id), { status: next });
}

async function setRating(id, rating) {
  const m = movies.find(x => x.id === id);
  if (!m) return;
  const next = m.rating === rating ? 0 : rating;
  await updateDoc(doc(db, "movies", id), { rating: next });
}

async function withdrawMovie(id) {
  const m = movies.find(x => x.id === id);
  if (!m) return;
  if (!confirm(`Withdraw "${m.title}" from the drawer?`)) return;
  await deleteDoc(doc(db, "movies", id));
}

// ---------- TMDb search ----------
let searchTimer = null;
async function runSearch(qText) {
  if (!qText.trim()) { els.searchResults.innerHTML = ""; return; }
  if (!TMDB_KEY || TMDB_KEY === "PASTE_YOUR_TMDB_API_KEY_HERE") {
    els.searchResults.innerHTML = `<p class="search-empty">TMDb API key isn't set up yet — edit config.js.</p>`;
    return;
  }
  try {
    const res = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(qText)}&include_adult=false`);
    const data = await res.json();
    const results = (data.results || []).slice(0, 6);
    if (!results.length) {
      els.searchResults.innerHTML = `<p class="search-empty">No matches.</p>`;
      return;
    }
    els.searchResults.innerHTML = results.map(r => `
      <div class="search-result" data-id="${r.id}">
        ${r.poster_path
          ? `<img src="${TMDB_IMG}${r.poster_path}" alt="">`
          : `<div class="sr-noimg">NO IMG</div>`}
        <div>
          <div class="sr-title">${escapeHtml(r.title)}</div>
          <div class="sr-meta">${(r.release_date || "—").slice(0, 4)}</div>
        </div>
      </div>
    `).join("");
    els.searchResults.querySelectorAll(".search-result").forEach(el => {
      el.addEventListener("click", () => {
        const r = results.find(x => String(x.id) === el.dataset.id);
        if (r) addMovie(r);
        els.searchPanel.hidden = true;
        els.searchInput.value = "";
        els.searchResults.innerHTML = "";
      });
    });
  } catch (e) {
    els.searchResults.innerHTML = `<p class="search-empty">Search failed: ${escapeHtml(e.message)}</p>`;
  }
}

// ---------- Event wiring ----------
els.tabs.addEventListener("click", e => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  els.tabs.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  btn.classList.add("active");
  currentFilter = btn.dataset.filter;
  renderGrid();
});

els.addBtn.addEventListener("click", () => {
  els.searchPanel.hidden = !els.searchPanel.hidden;
  if (!els.searchPanel.hidden) els.searchInput.focus();
});
els.searchClose.addEventListener("click", () => { els.searchPanel.hidden = true; });
els.searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const val = els.searchInput.value;
  searchTimer = setTimeout(() => runSearch(val), 350);
});

els.grid.addEventListener("click", e => {
  const btn = e.target.closest("button[data-action]");
  if (!btn || btn.disabled) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === "delete") withdrawMovie(id);
  if (btn.dataset.action === "cycle-status") cycleStatus(id);
  if (btn.dataset.action === "rate") {
    const rect = btn.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const starWidth = rect.width / 5;
    const rating = Math.min(5, Math.max(1, Math.ceil(relX / starWidth)));
    setRating(id, rating);
  }
});

els.loginBtn.addEventListener("click", () => {
  els.loginModal.hidden = false;
  els.loginError.hidden = true;
  els.loginEmail.focus();
});
els.loginCancel.addEventListener("click", () => { els.loginModal.hidden = true; });
els.loginModal.addEventListener("click", e => { if (e.target === els.loginModal) els.loginModal.hidden = true; });

els.loginForm.addEventListener("submit", async e => {
  e.preventDefault();
  els.loginError.hidden = true;
  try {
    await signInWithEmailAndPassword(auth, els.loginEmail.value, els.loginPassword.value);
    els.loginModal.hidden = true;
    els.loginForm.reset();
  } catch (err) {
    els.loginError.textContent = "Couldn't sign in — check your email and password.";
    els.loginError.hidden = false;
  }
});

els.logoutBtn.addEventListener("click", () => signOut(auth));

function updateAuthUI(user) {
  loggedIn = !!user;
  els.loginBtn.hidden = loggedIn;
  els.authStatus.hidden = !loggedIn;
  els.addBtn.hidden = !loggedIn;
  if (loggedIn) els.authEmail.textContent = user.email;
  if (!loggedIn) els.searchPanel.hidden = true;
  renderGrid();
}

// ---------- Boot ----------
function boot() {
  if (!isConfigured()) {
    els.configWarning.hidden = false;
    els.configWarning.textContent =
      "Firebase isn't configured yet. Open config.js and paste in your Firebase project settings to make this drawer live.";
    return;
  }
  const app = initializeApp(CONFIG.FIREBASE_CONFIG);
  db = getFirestore(app);
  auth = getAuth(app);
  onAuthStateChanged(auth, updateAuthUI);
  startListening();
}

boot();

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
  getFirestore, collection, addDoc, doc, updateDoc, deleteDoc, setDoc, getDoc, getDocs,
  onSnapshot, query, orderBy, where, or, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile,
  signOut, onAuthStateChanged
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
const STATUS_ORDER = ["to-watch", "watched"];
const STATUS_LABEL = { "to-watch":"To Watch", "watched":"Watched" };
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

const els = {
  loginBtn: document.getElementById("login-btn"),
  authStatus: document.getElementById("auth-status"),
  authName: document.getElementById("auth-name"),
  logoutBtn: document.getElementById("logout-btn"),
  configWarning: document.getElementById("config-warning"),

  sectionTabs: document.getElementById("section-tabs"),
  requestBadge: document.getElementById("request-badge"),
  drawerSection: document.getElementById("drawer-section"),
  friendsSection: document.getElementById("friends-section"),
  friendsList: document.getElementById("friends-list"),
  friendsEmpty: document.getElementById("friends-empty"),
  friendsSignedOut: document.getElementById("friends-signed-out"),
  commonwealthSection: document.getElementById("commonwealth-section"),
  commonwealthList: document.getElementById("commonwealth-list"),
  commonwealthEmpty: document.getElementById("commonwealth-empty"),
  viewingBanner: document.getElementById("viewing-banner"),
  viewingName: document.getElementById("viewing-name"),
  backToFriends: document.getElementById("back-to-friends"),
  signedOutMsg: document.getElementById("signed-out-msg"),

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
  authModalTitle: document.getElementById("auth-modal-title"),
  authSubmitBtn: document.getElementById("auth-submit-btn"),
  authModeToggle: document.getElementById("auth-mode-toggle"),
  nameField: document.getElementById("name-field"),
  signupName: document.getElementById("signup-name"),
  usernameField: document.getElementById("username-field"),
  signupUsername: document.getElementById("signup-username"),
  loginForm: document.getElementById("login-form"),
  loginEmail: document.getElementById("login-email"),
  loginPassword: document.getElementById("login-password"),
  loginError: document.getElementById("login-error"),
  loginCancel: document.getElementById("login-cancel"),
};

let movies = [];
let currentFilter = "all";
let currentUser = null;
let section = "mine"; // 'mine' | 'friends' | 'friend' | 'commonwealth'
let viewingUid = null;
let viewingReadOnly = true;
let authMode = "signin";
let unsubscribeMovies = null;
let unsubscribeFriendships = null;
let unsubscribeProfiles = null;
let profiles = []; // all profiles: {uid, username, displayName, email}
let friendships = []; // all friendship docs involving currentUser
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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function fallbackName(user) {
  return user.displayName || (user.email ? user.email.split("@")[0] : "Member");
}

function pairId(a, b) { return a < b ? `${a}_${b}` : `${b}_${a}`; }

function profileFor(uid) { return profiles.find(p => p.uid === uid); }

// ---------- Drawer rendering ----------
function renderGrid() {
  const filtered = currentFilter === "all" ? movies : movies.filter(m => m.status === currentFilter);
  els.emptyMsg.hidden = filtered.length !== 0;
  els.emptyMsg.textContent = currentFilter === "all"
    ? "No cards filed yet."
    : `No cards filed under "${STATUS_LABEL[currentFilter]}".`;
  els.cardCount.textContent = movies.length;
  els.addBtn.hidden = viewingReadOnly;

  const editable = !viewingReadOnly;
  els.grid.innerHTML = filtered.map((m, i) => {
    const cardNo = String(i + 1).padStart(3, "0");
    const posterMarkup = m.posterUrl
      ? `<img class="card-poster" src="${m.posterUrl}" alt="${escapeHtml(m.title)} poster">`
      : `<div class="card-poster-blank">NO STILL<br>ON FILE</div>`;
    const metaLine = `${m.year || "—"}${m.director ? ` · Dir. ${escapeHtml(m.director)}` : ""}`;
    return `
      <div class="card" data-id="${m.id}">
        ${editable ? `<button class="card-delete" data-action="delete" data-id="${m.id}">Withdraw</button>` : ""}
        <div class="card-tab" style="background:${colorForGenre(m.genre)};">${escapeHtml(m.genre)}</div>
        <div class="card-body">
          ${posterMarkup}
          <div class="card-info">
            <div class="card-no">CARD NO. ${cardNo}</div>
            <div class="card-title">${escapeHtml(m.title)}</div>
            <div class="card-meta">${metaLine}</div>
          </div>
        </div>
        <div class="card-foot">
          <button class="stars ${editable ? "editable" : ""}" data-action="rate" data-id="${m.id}" ${editable ? "" : "disabled"}>${starsMarkup(m.rating)}</button>
          <button class="stamp ${m.status} ${editable ? "editable" : ""}" data-action="cycle-status" data-id="${m.id}" ${editable ? "" : "disabled"}>${STATUS_LABEL[m.status]}</button>
        </div>
      </div>
    `;
  }).join("");
}

// ---------- Drawer switching ----------
function watchMovies(uid) {
  if (unsubscribeMovies) { unsubscribeMovies(); unsubscribeMovies = null; }
  const q = query(collection(db, "users", uid, "movies"), orderBy("addedAt", "desc"));
  unsubscribeMovies = onSnapshot(q, snap => {
    movies = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderGrid();
  }, err => {
    showStatus("Couldn't load this drawer: " + err.message, true);
  });
}

function setSectionTabActive(name) {
  els.sectionTabs.querySelectorAll(".section-tab").forEach(t => {
    t.classList.toggle("active", t.dataset.section === name);
  });
}

function hideAllSections() {
  els.viewingBanner.hidden = true;
  els.friendsSection.hidden = true;
  els.commonwealthSection.hidden = true;
  els.signedOutMsg.hidden = true;
  els.drawerSection.hidden = true;
}

function showMyDrawer() {
  section = "mine";
  setSectionTabActive("mine");
  hideAllSections();

  if (!currentUser) {
    els.signedOutMsg.hidden = false;
    if (unsubscribeMovies) { unsubscribeMovies(); unsubscribeMovies = null; }
    movies = [];
    return;
  }
  els.drawerSection.hidden = false;
  viewingUid = currentUser.uid;
  viewingReadOnly = false;
  watchMovies(viewingUid);
}

// ---------- Friends (mutual, accepted only) ----------
function acceptedFriendUids() {
  if (!currentUser) return [];
  return friendships
    .filter(f => f.status === "accepted")
    .map(f => (f.uidA === currentUser.uid ? f.uidB : f.uidA));
}

function pendingIncoming() {
  if (!currentUser) return [];
  return friendships.filter(f => f.status === "pending" && f.requestedBy !== currentUser.uid);
}

function relationshipWith(theirUid) {
  const f = friendships.find(x => x.uidA === theirUid || x.uidB === theirUid);
  if (!f) return "none";
  if (f.status === "accepted") return "friends";
  return f.requestedBy === currentUser.uid ? "requested" : "incoming";
}

function renderFriendsSection() {
  if (!currentUser) {
    els.friendsList.innerHTML = "";
    els.friendsEmpty.hidden = true;
    els.friendsSignedOut.hidden = false;
    return;
  }
  els.friendsSignedOut.hidden = true;
  const uids = acceptedFriendUids();
  els.friendsEmpty.hidden = uids.length !== 0;
  els.friendsList.innerHTML = uids.map(uid => {
    const p = profileFor(uid);
    const name = p ? p.displayName : "Member";
    const username = p ? p.username : "";
    return `
      <button class="friend-card" data-uid="${uid}">
        <div class="friend-name">${escapeHtml(name)}</div>
        <div class="friend-count">${username ? "@" + escapeHtml(username) + " · " : ""}View drawer →</div>
      </button>
    `;
  }).join("");
  els.friendsList.querySelectorAll(".friend-card").forEach(btn => {
    const p = profileFor(btn.dataset.uid);
    btn.addEventListener("click", () => viewFriendDrawer(btn.dataset.uid, p ? p.displayName : "Member"));
  });
}

function showFriends() {
  section = "friends";
  setSectionTabActive("friends");
  hideAllSections();
  els.friendsSection.hidden = false;
  renderFriendsSection();
}

function viewFriendDrawer(uid, name) {
  section = "friend";
  hideAllSections();
  els.drawerSection.hidden = false;
  els.viewingBanner.hidden = false;
  els.viewingName.textContent = name;
  viewingUid = uid;
  viewingReadOnly = true;
  watchMovies(uid);
}

// ---------- Commonwealth (everyone, with add-friend actions) ----------
function renderCommonwealth() {
  const others = profiles.filter(p => !currentUser || p.uid !== currentUser.uid);
  els.commonwealthEmpty.hidden = others.length !== 0;
  els.commonwealthList.innerHTML = others.map(p => {
    const rel = currentUser ? relationshipWith(p.uid) : "none";
    let actionHtml = "";
    if (currentUser) {
      if (rel === "none") actionHtml = `<button class="member-action" data-action="add" data-uid="${p.uid}">Add Friend</button>`;
      else if (rel === "requested") actionHtml = `<button class="member-action pending" disabled>Requested</button>`;
      else if (rel === "incoming") actionHtml = `<button class="member-action accept" data-action="accept" data-uid="${p.uid}">Accept Request</button>`;
      else if (rel === "friends") actionHtml = `<button class="member-action is-friend" data-action="view" data-uid="${p.uid}" data-name="${escapeHtml(p.displayName)}">Friends · View</button>`;
    }
    return `
      <div class="member-card">
        <div class="member-info">
          <div class="friend-name">${escapeHtml(p.displayName || "Unnamed")}</div>
          <div class="member-username">${p.username ? "@" + escapeHtml(p.username) : ""}</div>
        </div>
        ${actionHtml}
      </div>
    `;
  }).join("");

  els.commonwealthList.querySelectorAll("[data-action]").forEach(btn => {
    const uid = btn.dataset.uid;
    if (btn.dataset.action === "add") btn.addEventListener("click", () => sendFriendRequest(uid));
    if (btn.dataset.action === "accept") btn.addEventListener("click", () => acceptFriendRequest(uid));
    if (btn.dataset.action === "view") btn.addEventListener("click", () => viewFriendDrawer(uid, btn.dataset.name));
  });
}

function showCommonwealth() {
  section = "commonwealth";
  setSectionTabActive("commonwealth");
  hideAllSections();
  els.commonwealthSection.hidden = false;
  renderCommonwealth();
}

async function sendFriendRequest(theirUid) {
  if (!currentUser) return;
  const id = pairId(currentUser.uid, theirUid);
  try {
    await setDoc(doc(db, "friendships", id), {
      uidA: currentUser.uid < theirUid ? currentUser.uid : theirUid,
      uidB: currentUser.uid < theirUid ? theirUid : currentUser.uid,
      requestedBy: currentUser.uid,
      status: "pending",
      createdAt: serverTimestamp(),
    });
    showStatus("Friend request sent.", false);
  } catch (e) {
    showStatus("Couldn't send request: " + e.message, true);
  }
}

async function acceptFriendRequest(theirUid) {
  if (!currentUser) return;
  const id = pairId(currentUser.uid, theirUid);
  try {
    await updateDoc(doc(db, "friendships", id), { status: "accepted" });
    showStatus("You're now friends.", false);
  } catch (e) {
    showStatus("Couldn't accept request: " + e.message, true);
  }
}

function updateRequestBadge() {
  const count = pendingIncoming().length;
  els.requestBadge.hidden = count === 0;
  els.requestBadge.textContent = String(count);
}

function watchFriendships() {
  if (unsubscribeFriendships) { unsubscribeFriendships(); unsubscribeFriendships = null; }
  if (!currentUser) { friendships = []; updateRequestBadge(); return; }
  const q = query(collection(db, "friendships"),
    or(where("uidA", "==", currentUser.uid), where("uidB", "==", currentUser.uid)));
  unsubscribeFriendships = onSnapshot(q, snap => {
    friendships = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateRequestBadge();
    if (section === "friends") renderFriendsSection();
    if (section === "commonwealth") renderCommonwealth();
  }, err => {
    showStatus("Couldn't load friend requests: " + err.message, true);
  });
}

function watchProfiles() {
  if (unsubscribeProfiles) { unsubscribeProfiles(); unsubscribeProfiles = null; }
  unsubscribeProfiles = onSnapshot(collection(db, "profiles"), snap => {
    profiles = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    if (section === "commonwealth") renderCommonwealth();
    if (section === "friends") renderFriendsSection();
  }, err => {
    showStatus("Couldn't load members: " + err.message, true);
  });
}

// ---------- Firestore writes (always on the signed-in user's own drawer) ----------
async function addMovie(result) {
  const dup = movies.find(m => m.tmdbId === result.id);
  if (dup) { showStatus(`"${result.title}" is already on your list.`, true); return; }
  const genreId = (result.genre_ids || [])[0];
  let director = null;
  try {
    const cRes = await fetch(`https://api.themoviedb.org/3/movie/${result.id}/credits?api_key=${TMDB_KEY}`);
    const cData = await cRes.json();
    const d = (cData.crew || []).find(c => c.job === "Director");
    director = d ? d.name : null;
  } catch (e) { /* poster/title still work without a director credit */ }

  await addDoc(collection(db, "users", currentUser.uid, "movies"), {
    tmdbId: result.id,
    title: result.title,
    year: (result.release_date || "").slice(0, 4),
    genre: GENRE_MAP[genreId] || "Unspecified",
    director,
    posterUrl: result.poster_path ? TMDB_IMG + result.poster_path : null,
    status: "to-watch",
    rating: 0,
    addedAt: serverTimestamp(),
  });
  showStatus(`Filed "${result.title}".`, false);
}

async function cycleStatus(id) {
  const m = movies.find(x => x.id === id);
  if (!m || !currentUser) return;
  const next = STATUS_ORDER[(STATUS_ORDER.indexOf(m.status) + 1) % STATUS_ORDER.length];
  await updateDoc(doc(db, "users", currentUser.uid, "movies", id), { status: next });
}

async function setRating(id, rating) {
  const m = movies.find(x => x.id === id);
  if (!m || !currentUser) return;
  const next = m.rating === rating ? 0 : rating;
  await updateDoc(doc(db, "users", currentUser.uid, "movies", id), { rating: next });
}

async function withdrawMovie(id) {
  const m = movies.find(x => x.id === id);
  if (!m || !currentUser) return;
  if (!confirm(`Withdraw "${m.title}" from the drawer?`)) return;
  await deleteDoc(doc(db, "users", currentUser.uid, "movies", id));
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

// ---------- Auth ----------
async function ensureProfile(user, overrides) {
  const ref = doc(db, "profiles", user.uid);
  if (overrides) {
    await setDoc(ref, { ...overrides, email: user.email, updatedAt: serverTimestamp() }, { merge: true });
    return;
  }
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { displayName: fallbackName(user), email: user.email, updatedAt: serverTimestamp() }, { merge: true });
  }
}

function authErrorMessage(err) {
  switch (err.code) {
    case "auth/email-already-in-use": return "That email already has an account — try signing in instead.";
    case "auth/weak-password": return "Password should be at least 6 characters.";
    case "auth/invalid-email": return "That email address looks invalid.";
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-credential": return "Couldn't sign in — check your email and password.";
    default: return err.message || "Something went wrong.";
  }
}

function setAuthMode(mode) {
  authMode = mode;
  els.nameField.hidden = mode !== "signup";
  els.usernameField.hidden = mode !== "signup";
  els.authModalTitle.textContent = mode === "signup" ? "Create Account" : "Sign In";
  els.authSubmitBtn.textContent = mode === "signup" ? "Create Account" : "Sign In";
  els.authModeToggle.textContent = mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account";
  els.loginError.hidden = true;
}

function updateAuthUI(user) {
  els.loginBtn.hidden = !!user;
  els.authStatus.hidden = !user;
  if (user) els.authName.textContent = fallbackName(user);
  if (!user) els.searchPanel.hidden = true;
}

// ---------- Event wiring ----------
els.sectionTabs.addEventListener("click", e => {
  const btn = e.target.closest(".section-tab");
  if (!btn) return;
  if (btn.dataset.section === "mine") showMyDrawer();
  else if (btn.dataset.section === "friends") showFriends();
  else showCommonwealth();
});
els.backToFriends.addEventListener("click", showFriends);

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
  setAuthMode("signin");
  els.loginModal.hidden = false;
  els.loginEmail.focus();
});
els.loginCancel.addEventListener("click", () => { els.loginModal.hidden = true; });
els.loginModal.addEventListener("click", e => { if (e.target === els.loginModal) els.loginModal.hidden = true; });
els.authModeToggle.addEventListener("click", () => setAuthMode(authMode === "signup" ? "signin" : "signup"));

els.loginForm.addEventListener("submit", async e => {
  e.preventDefault();
  els.loginError.hidden = true;
  const email = els.loginEmail.value;
  const password = els.loginPassword.value;
  try {
    if (authMode === "signup") {
      const name = els.signupName.value.trim();
      const username = els.signupUsername.value.trim().toLowerCase();
      if (!name) {
        els.loginError.textContent = "Please enter a display name.";
        els.loginError.hidden = false;
        return;
      }
      if (!USERNAME_RE.test(username)) {
        els.loginError.textContent = "Username must be 3-20 characters: lowercase letters, numbers, or _.";
        els.loginError.hidden = false;
        return;
      }
      const usernameRef = doc(db, "usernames", username);
      const usernameSnap = await getDoc(usernameRef);
      if (usernameSnap.exists()) {
        els.loginError.textContent = "That username is taken — try another.";
        els.loginError.hidden = false;
        return;
      }

      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      els.authName.textContent = name;
      try {
        await setDoc(usernameRef, { uid: cred.user.uid });
        await ensureProfile(cred.user, { displayName: name, username });
      } catch (profileErr) {
        showStatus("Signed up, but couldn't save your profile/username — try again from your account later.", true);
      }
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    els.loginModal.hidden = true;
    els.loginForm.reset();
  } catch (err) {
    els.loginError.textContent = authErrorMessage(err);
    els.loginError.hidden = false;
  }
});

els.logoutBtn.addEventListener("click", () => signOut(auth));

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

  watchProfiles();

  onAuthStateChanged(auth, async user => {
    currentUser = user;
    updateAuthUI(user);
    if (user) { try { await ensureProfile(user); } catch (e) { /* profile is best-effort; drawer still works */ } }
    watchFriendships();
    if (section === "mine") showMyDrawer();
    else if (section === "friends") renderFriendsSection();
    else if (section === "commonwealth") renderCommonwealth();
  });

  showMyDrawer();
}

boot();

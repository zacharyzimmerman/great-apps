/* Great Apps Framework — Shared JS for the Great Apps suite */

const GreatApp = (() => {
  const $ = (sel) => document.querySelector(sel);

  // ── SVG Icons ─────────────────────────────
  const icons = {
    play: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,3 20,12 6,21"/></svg>',
    pause: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="4" height="18"/><rect x="15" y="3" width="4" height="18"/></svg>',
  };

  // ── Audio Player ──────────────────────────
  let listAudio = new Audio();
  let listPlayingId = null;
  let playButtons = [];

  function updatePlayButtons() {
    const btns = document.querySelectorAll(".play-btn");
    for (const btn of btns) {
      const isThis = btn.dataset.id === listPlayingId;
      const isPlaying = isThis && !listAudio.paused;
      btn.innerHTML = isPlaying ? icons.pause : icons.play;
      btn.classList.toggle("playing", isPlaying);
    }
  }

  function togglePlay(id, audioUrl, e) {
    if (e && e.stopPropagation) e.stopPropagation();
    if (!audioUrl) return;

    if (listPlayingId === id && !listAudio.paused) {
      listAudio.pause();
    } else {
      if (listPlayingId !== id) {
        listAudio.src = audioUrl;
        listPlayingId = id;
      }
      listAudio.play();
    }
    updatePlayButtons();
  }

  function stopListAudio() {
    listAudio.pause();
    listPlayingId = null;
    updatePlayButtons();
  }

  listAudio.addEventListener("pause", updatePlayButtons);
  listAudio.addEventListener("play", updatePlayButtons);
  listAudio.addEventListener("ended", () => {
    listPlayingId = null;
    updatePlayButtons();
  });

  // ── Navigation ────────────────────────────
  function showView(viewId) {
    document.querySelectorAll(".view").forEach((v) => (v.hidden = true));
    $(viewId).hidden = false;
  }

  // ── Search Toggle ─────────────────────────
  function initSearchToggle(toggleSel, barSel, inputSel) {
    $(toggleSel).addEventListener("click", () => {
      const bar = $(barSel);
      bar.hidden = !bar.hidden;
      if (!bar.hidden) $(inputSel).focus();
    });
  }

  // ── Keyboard Shortcuts ────────────────────
  function initKeyboard({ searchSel = "#search", detailViewSel = "#detail-view" } = {}) {
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey && e.key === "k") || (e.key === "/" && document.activeElement !== $(searchSel))) {
        e.preventDefault();
        const searchBar = $(searchSel).closest(".search-bar") || $(searchSel).parentElement;
        if (searchBar.hidden) searchBar.hidden = false;
        $(searchSel).focus();
        $(searchSel).select();
        return;
      }
      if (e.key === "Escape" && !$(detailViewSel).hidden) {
        history.back();
      }
    });
  }

  // ── List Item Rendering ───────────────────
  function createPlayButton(id, audioUrl) {
    const btn = document.createElement("button");
    btn.className = "play-btn";
    btn.dataset.id = id;
    btn.setAttribute("aria-label", "Play");
    const isPlaying = id === listPlayingId && !listAudio.paused;
    btn.innerHTML = isPlaying ? icons.pause : icons.play;
    if (isPlaying) btn.classList.add("playing");
    btn.addEventListener("click", (e) => togglePlay(id, audioUrl, e));
    return btn;
  }

  // ── Service Worker Registration ───────────
  function registerSW(path = "sw.js") {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register(path);
    }
  }

  // ── Public API ────────────────────────────
  return {
    $,
    icons,
    togglePlay,
    stopListAudio,
    updatePlayButtons,
    showView,
    initSearchToggle,
    initKeyboard,
    createPlayButton,
    registerSW,
    get listAudio() { return listAudio; },
    get listPlayingId() { return listPlayingId; },
  };
})();

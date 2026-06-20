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
  // precacheAudio: once the worker is active, ask it to download every clip so
  // all audio plays offline (the SW listens for the CACHE_AUDIO message).
  function registerSW(path = "sw.js", { precacheAudio = false } = {}) {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(path).catch(() => {});
    if (precacheAudio) {
      navigator.serviceWorker.ready
        .then((reg) => {
          const sw = reg.active || navigator.serviceWorker.controller;
          if (sw) sw.postMessage({ type: "CACHE_AUDIO" });
        })
        .catch(() => {});
    }
  }

  // ── PWA Zoom Suppression ──────────────────
  // iOS Safari ignores `user-scalable=no`, so block its pinch/double-tap zoom
  // gestures directly (CSS touch-action handles other browsers). Idempotent.
  let zoomDisabled = false;
  function disableZoom() {
    if (zoomDisabled) return;
    zoomDisabled = true;
    for (const evt of ["gesturestart", "gesturechange", "gestureend"]) {
      document.addEventListener(evt, (e) => e.preventDefault(), { passive: false });
    }
    // Pinch-zoom always involves more than one active touch point.
    document.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches.length > 1) e.preventDefault();
      },
      { passive: false }
    );
    // Double-tap-to-zoom: suppress a second tap landing on roughly the same spot.
    let last = { t: 0, x: 0, y: 0 };
    document.addEventListener(
      "touchend",
      (e) => {
        const touch = e.changedTouches[0];
        const now = Date.now();
        if (
          touch &&
          now - last.t <= 300 &&
          Math.abs(touch.clientX - last.x) < 40 &&
          Math.abs(touch.clientY - last.y) < 40
        ) {
          e.preventDefault();
        }
        last = touch ? { t: now, x: touch.clientX, y: touch.clientY } : { t: 0, x: 0, y: 0 };
      },
      { passive: false }
    );
  }

  // ── Master/Detail Hash Router ─────────────
  // Wires browser back/forward + a deep-link from the initial URL hash for the
  // standard list↔detail apps. `onSelect` should be the no-history-push variant
  // (the app pushes history itself when the user taps an item).
  function initRouter({ stateKey, exists, onSelect, onRoot }) {
    window.addEventListener("popstate", (e) => {
      if (e.state && e.state[stateKey]) onSelect(e.state[stateKey]);
      else onRoot();
    });
    if (window.location.hash) {
      const id = window.location.hash.slice(1);
      if (!exists || exists(id)) {
        onSelect(id);
        history.replaceState({ [stateKey]: id }, "", "#" + id);
      }
    }
  }

  // ── Detail Field Helper ───────────────────
  // Show `el` with `prefix + value` when value is present, otherwise hide it
  // (or its parent, for fields wrapped in a section).
  function setField(el, value, { prefix = "", hideParent = false } = {}) {
    if (!el) return;
    const target = hideParent ? el.parentElement : el;
    if (value || value === 0) {
      el.textContent = prefix + value;
      if (target) target.hidden = false;
    } else if (target) {
      target.hidden = true;
    }
  }

  // ── Bundle Loading & Versioning ───────────
  function setVersionLabel(version, sel = "#version-label") {
    const el = $(sel);
    if (el && version) el.textContent = `v${version}`;
  }

  // Append `?v=<version>` to each tag/song's audioUrl so a re-trimmed clip
  // (same path) busts the browser cache. Mutates and returns the map.
  function applyAudioVersion(items, version) {
    if (!version || !items) return items;
    for (const id in items) {
      const it = items[id];
      if (it && it.audioUrl && !it.audioUrl.includes("?")) it.audioUrl += `?v=${version}`;
    }
    return items;
  }

  // Fetch a content bundle fresh (no-store + cache-buster), optionally stamping
  // the version label. Returns the parsed bundle.
  async function loadBundle(url, { versionLabelSel } = {}) {
    const resp = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
    const bundle = await resp.json();
    if (versionLabelSel) setVersionLabel(bundle.version, versionLabelSel);
    return bundle;
  }

  // ── Copyright Footer ──────────────────────
  function injectCopyright() {
    const footer = document.querySelector('.list-footer') || document.querySelector('.editor-footer');
    if (footer && !footer.querySelector('.copyright')) {
      const el = document.createElement('span');
      el.className = 'copyright';
      el.textContent = '\u00A9 2026 Zachary Zimmerman';
      footer.appendChild(el);
    }
  }

  document.addEventListener('DOMContentLoaded', injectCopyright);

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
    disableZoom,
    initRouter,
    setField,
    setVersionLabel,
    applyAudioVersion,
    loadBundle,
    get listAudio() { return listAudio; },
    get listPlayingId() { return listPlayingId; },
  };
})();

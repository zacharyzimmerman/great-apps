/* Great Apps Framework — Shared service-worker core.
 *
 * Each app ships a thin web/sw.js that does:
 *
 *   importScripts("https://cdn.jsdelivr.net/gh/<user>/great-apps@main/sw-core.js");
 *   const VERSION = "x.y.z";            // stamped by the app's build
 *   GreatSW.init({ version: VERSION, cachePrefix: "great-foo", shell: [...] });
 *
 * Bumping VERSION (the app's build re-stamps it) ships a byte-changed sw.js, so
 * the browser activates a fresh worker that re-precaches the shell and evicts
 * the previous cache — offline support without ever serving stale content.
 */
(function (global) {
  function init(config) {
    const version = config.version;
    const CACHE = `${config.cachePrefix}-${version}`;
    const shell = config.shell || [];
    // pathname suffixes served network-first under a normalized (search-stripped)
    // key, e.g. ["tags-bundle.json"] — keeps the page's ?t= cache-buster from
    // filling the cache with dead entries.
    const dataFiles = config.dataFiles || [];
    const audio = config.audio || null; // { pathSegment, precache?: { bundleUrl, extract? } }

    function putInCache(request, response) {
      return caches.open(CACHE).then((c) => c.put(request, response));
    }

    function isDataFile(pathname) {
      return dataFiles.some((f) => pathname.endsWith(f));
    }

    // ── Offline audio precache ───────────────────────────────────────────
    let audioPrecache = null;

    function getBundle(cache, bundleUrl) {
      return fetch(bundleUrl, { cache: "no-store" })
        .then((resp) => {
          if (!resp || !resp.ok) throw new Error("bundle fetch failed");
          cache.put(new Request(bundleUrl), resp.clone());
          return resp.json();
        })
        .catch(() =>
          cache.match(new Request(bundleUrl), { ignoreSearch: true }).then((c) => (c ? c.json() : null))
        );
    }

    // Default: pull audioUrl off every entry in bundle.tags/songs/items and
    // version-bust it exactly as the page does (?v=<bundle.version>).
    function defaultExtract(bundle) {
      const v = bundle.version || version;
      const items = bundle.tags || bundle.songs || bundle.items || {};
      const urls = [];
      for (const id in items) {
        const u = items[id] && items[id].audioUrl;
        if (u) urls.push(u.indexOf("?") === -1 ? `${u}?v=${v}` : u);
      }
      return urls;
    }

    async function precacheAudio() {
      if (!audio || !audio.precache) return;
      const cache = await caches.open(CACHE);
      const bundle = await getBundle(cache, audio.precache.bundleUrl);
      if (!bundle) return;
      const extract = audio.precache.extract || defaultExtract;
      const urls = extract(bundle);
      // Sequential + skip-if-cached: gentle (one clip at a time) and resumable —
      // an interrupted load just continues on the next visit.
      for (const u of urls) {
        const req = new Request(u);
        if (await cache.match(req)) continue;
        try {
          const resp = await fetch(req);
          if (resp && (resp.ok || resp.type === "opaque")) await cache.put(req, resp.clone());
        } catch (_) {
          // Offline / transient — leave it for the next CACHE_AUDIO trigger.
        }
      }
    }

    function precacheAudioOnce() {
      if (!audioPrecache) {
        audioPrecache = precacheAudio().finally(() => {
          audioPrecache = null;
        });
      }
      return audioPrecache;
    }

    // ── Lifecycle ────────────────────────────────────────────────────────
    global.addEventListener("install", (e) => {
      e.waitUntil(
        caches
          .open(CACHE)
          // allSettled: a single failed asset (e.g. a CDN hiccup) must not abort install.
          .then((c) => Promise.allSettled(shell.map((u) => c.add(new Request(u, { cache: "reload" })))))
          .then(() => global.skipWaiting())
      );
    });

    global.addEventListener("activate", (e) => {
      e.waitUntil(
        caches
          .keys()
          .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
          .then(() => global.clients.claim())
      );
    });

    global.addEventListener("message", (e) => {
      if (e.data && e.data.type === "CACHE_AUDIO") {
        e.waitUntil(precacheAudioOnce());
      }
    });

    // ── Fetch ────────────────────────────────────────────────────────────
    global.addEventListener("fetch", (e) => {
      const req = e.request;
      if (req.method !== "GET") return;

      let url;
      try {
        url = new URL(req.url);
      } catch (_) {
        return;
      }
      const sameOrigin = url.origin === global.location.origin;

      // 1. Page navigations — network-first, fall back to the cached shell offline.
      if (req.mode === "navigate") {
        e.respondWith(
          fetch(req)
            .then((resp) => {
              putInCache(req, resp.clone());
              return resp;
            })
            .catch(() =>
              caches
                .match("./index.html", { ignoreSearch: true })
                .then((m) => m || caches.match("./", { ignoreSearch: true }))
            )
        );
        return;
      }

      // 2. Data bundles — network-first online, cache fallback offline, stored
      //    under a normalized key so ?t=<ts> cache-busters don't accumulate.
      if (sameOrigin && isDataFile(url.pathname)) {
        const key = new Request(url.pathname.split("/").pop());
        e.respondWith(
          fetch(req)
            .then((resp) => {
              putInCache(key, resp.clone());
              return resp;
            })
            .catch(() => caches.match(key, { ignoreSearch: true }))
        );
        return;
      }

      // 3. Audio — cache-first by full URL. Clips are version-busted (?v=), so a
      //    re-trim is a new key (miss → refetch) while played clips stay offline.
      if (audio && sameOrigin && url.pathname.includes(audio.pathSegment)) {
        e.respondWith(
          caches.match(req).then(
            (cached) =>
              cached ||
              fetch(req).then((resp) => {
                putInCache(req, resp.clone());
                return resp;
              })
          )
        );
        return;
      }

      // 4. Everything else (shell, css/js, icons, CDN framework) —
      //    stale-while-revalidate: serve cache instantly, refresh in background.
      e.respondWith(
        caches.match(req, { ignoreSearch: true }).then((cached) => {
          const network = fetch(req)
            .then((resp) => {
              if (resp && (resp.ok || resp.type === "opaque")) putInCache(req, resp.clone());
              return resp;
            })
            .catch(() => cached);
          return cached || network;
        })
      );
    });
  }

  global.GreatSW = { init };
})(self);

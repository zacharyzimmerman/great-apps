// Unit tests for the shared service-worker core (sw-core.js).
// Loads sw-core.js in a sandboxed VM with mocked Cache Storage + fetch, calls
// GreatSW.init(...), then drives install/activate/fetch/message events to verify
// offline behavior deterministically (no browser required).

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = fs.readFileSync(path.join(__dirname, "sw-core.js"), "utf-8");
const ORIGIN = "https://great-apps.test";
const BASE = ORIGIN + "/";
const CDN = "https://cdn.jsdelivr.net/gh/zacharyzimmerman/great-apps@main/";

function resolveUrl(input) {
  if (input && typeof input === "object" && "url" in input) return input.url;
  return new URL(input, BASE).href;
}

class MockRequest {
  constructor(input, init = {}) {
    if (input instanceof MockRequest) {
      this.url = input.url;
      this.method = input.method;
      this.mode = input.mode;
    } else {
      this.url = resolveUrl(input);
      this.method = "GET";
      this.mode = "cors";
    }
    if (init.method) this.method = init.method;
    if (init.mode) this.mode = init.mode;
    this.cache = init.cache;
  }
  clone() {
    return this;
  }
}

class MockResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.ok = init.ok !== false;
    this.status = init.status || 200;
    this.type = init.type || "basic";
  }
  clone() {
    return new MockResponse(this.body, { ok: this.ok, status: this.status, type: this.type });
  }
  async json() {
    return typeof this.body === "string" ? JSON.parse(this.body) : this.body;
  }
}

const TAG_CONFIG = {
  version: "0.4.54",
  cachePrefix: "great-tags",
  shell: [
    "./",
    "./index.html",
    "./app.js",
    "./styles.css",
    "./tags-bundle.json",
    CDN + "framework.js",
  ],
  dataFiles: ["tags-bundle.json"],
  audio: { pathSegment: "/audio/", precache: { bundleUrl: "tags-bundle.json" } },
};

function makeHarness(config = TAG_CONFIG) {
  const net = { online: true, bodies: {} };
  const fetchCalls = [];

  function mockFetch(req) {
    const url = resolveUrl(req);
    fetchCalls.push(url);
    if (!net.online) return Promise.reject(new Error("offline"));
    const base = url.split("?")[0];
    const body = net.bodies[base] !== undefined ? net.bodies[base] : `net:${base}`;
    return Promise.resolve(new MockResponse(body, { ok: true, status: 200 }));
  }

  class FakeCache {
    constructor() {
      this.map = new Map();
    }
    async put(req, resp) {
      this.map.set(resolveUrl(req), resp);
    }
    async match(req, opts = {}) {
      const key = resolveUrl(req);
      if (this.map.has(key)) return this.map.get(key);
      if (opts.ignoreSearch) {
        const base = key.split("?")[0];
        for (const [k, v] of this.map) if (k.split("?")[0] === base) return v;
      }
      return undefined;
    }
    async add(req) {
      const r = await mockFetch(req);
      if (r && r.ok) await this.put(req, r);
    }
  }

  const storage = new Map();
  const caches = {
    async open(name) {
      if (!storage.has(name)) storage.set(name, new FakeCache());
      return storage.get(name);
    },
    async keys() {
      return [...storage.keys()];
    },
    async delete(name) {
      return storage.delete(name);
    },
    async match(req, opts) {
      for (const c of storage.values()) {
        const m = await c.match(req, opts);
        if (m) return m;
      }
      return undefined;
    },
  };

  const listeners = {};
  const self = {
    location: new URL(BASE),
    addEventListener: (type, cb) => {
      listeners[type] = cb;
    },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };

  const ctx = { self, caches, fetch: mockFetch, Request: MockRequest, Response: MockResponse, URL, Promise, console };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  ctx.self.GreatSW.init(config);

  async function dispatchLifecycle(type) {
    let p;
    listeners[type]({ waitUntil: (x) => (p = x) });
    await p;
  }

  function dispatchFetch(input, init) {
    const request = new MockRequest(input, init);
    let responded;
    listeners.fetch({ request, respondWith: (x) => (responded = x) });
    return responded;
  }

  async function dispatchMessage(data) {
    let p = Promise.resolve();
    listeners.message({ data, waitUntil: (x) => (p = x) });
    await p;
  }

  return { net, caches, storage, listeners, dispatchLifecycle, dispatchFetch, dispatchMessage, fetchCalls };
}

describe("GreatSW service-worker core", () => {
  it("precaches the configured shell on install", async () => {
    const h = makeHarness();
    await h.dispatchLifecycle("install");
    const names = await h.caches.keys();
    expect(names).toEqual(["great-tags-0.4.54"]);
    const cache = await h.caches.open(names[0]);
    expect(await cache.match("./index.html")).toBeTruthy();
    expect(await cache.match("./app.js")).toBeTruthy();
    expect(await cache.match(CDN + "framework.js")).toBeTruthy();
  });

  it("serves the cached shell for navigations when offline", async () => {
    const h = makeHarness();
    h.net.bodies[BASE + "index.html"] = "INDEX_HTML";
    await h.dispatchLifecycle("install");
    h.net.online = false;
    const resp = await h.dispatchFetch(BASE, { mode: "navigate" });
    expect(resp).toBeTruthy();
    expect(resp.body).toBe("INDEX_HTML");
  });

  it("data bundle: network-first online, cached fallback offline", async () => {
    const h = makeHarness();
    h.net.bodies[BASE + "tags-bundle.json"] = "FRESH_BUNDLE";
    await h.dispatchLifecycle("install");

    const online = await h.dispatchFetch("tags-bundle.json?t=12345", { mode: "cors" });
    expect(online.body).toBe("FRESH_BUNDLE");

    h.net.online = false;
    const offline = await h.dispatchFetch("tags-bundle.json?t=99999", { mode: "cors" });
    expect(offline).toBeTruthy();
    expect(offline.body).toBe("FRESH_BUNDLE");
  });

  it("audio: cache-first, available offline once fetched; new version refetches", async () => {
    const h = makeHarness();
    await h.dispatchLifecycle("install");
    h.net.bodies[BASE + "audio/danny-boy.mp3"] = "AUDIO_V50";

    const first = await h.dispatchFetch("audio/danny-boy.mp3?v=0.4.50");
    expect(first.body).toBe("AUDIO_V50");

    h.net.online = false;
    const replay = await h.dispatchFetch("audio/danny-boy.mp3?v=0.4.50");
    expect(replay.body).toBe("AUDIO_V50");

    const newVersion = h.dispatchFetch("audio/danny-boy.mp3?v=0.4.99");
    await expect(newVersion).rejects.toThrow();
  });

  it("activate evicts caches from older versions", async () => {
    const h = makeHarness();
    const stale = await h.caches.open("great-tags-0.0.1-old");
    await stale.put("./app.js", new MockResponse("STALE"));
    await h.dispatchLifecycle("install");
    await h.dispatchLifecycle("activate");
    const names = await h.caches.keys();
    expect(names).not.toContain("great-tags-0.0.1-old");
    expect(names.length).toBe(1);
  });

  it("CACHE_AUDIO message precaches every clip so all play offline", async () => {
    const h = makeHarness();
    h.net.bodies[BASE + "tags-bundle.json"] = JSON.stringify({
      version: "0.4.54",
      tags: {
        "danny-boy": { audioUrl: "audio/danny-boy.mp3" },
        "sweet-may": { audioUrl: "audio/sweet-may.mp3" },
      },
    });
    h.net.bodies[BASE + "audio/danny-boy.mp3"] = "DANNY";
    h.net.bodies[BASE + "audio/sweet-may.mp3"] = "SWEETMAY";
    await h.dispatchLifecycle("install");

    await h.dispatchMessage({ type: "CACHE_AUDIO" });

    const cache = await h.caches.open((await h.caches.keys())[0]);
    expect(await cache.match("audio/danny-boy.mp3?v=0.4.54")).toBeTruthy();
    expect(await cache.match("audio/sweet-may.mp3?v=0.4.54")).toBeTruthy();

    h.net.online = false;
    const offline = await h.dispatchFetch("audio/sweet-may.mp3?v=0.4.54");
    expect(offline.body).toBe("SWEETMAY");
  });

  it("CACHE_AUDIO does not refetch clips already cached", async () => {
    const h = makeHarness();
    h.net.bodies[BASE + "tags-bundle.json"] = JSON.stringify({
      version: "0.4.54",
      tags: { "danny-boy": { audioUrl: "audio/danny-boy.mp3" } },
    });
    h.net.bodies[BASE + "audio/danny-boy.mp3"] = "DANNY";
    await h.dispatchLifecycle("install");

    await h.dispatchMessage({ type: "CACHE_AUDIO" });
    const before = h.fetchCalls.filter((u) => u.includes("audio/danny-boy.mp3")).length;
    await h.dispatchMessage({ type: "CACHE_AUDIO" });
    const after = h.fetchCalls.filter((u) => u.includes("audio/danny-boy.mp3")).length;
    expect(before).toBe(1);
    expect(after).toBe(1);
  });

  it("works with no audio config (shell-only apps)", async () => {
    const h = makeHarness({
      version: "0.2.8",
      cachePrefix: "great-trove",
      shell: ["./", "./index.html", "./app.js"],
    });
    h.net.bodies[BASE + "index.html"] = "TROVE";
    await h.dispatchLifecycle("install");
    const names = await h.caches.keys();
    expect(names).toEqual(["great-trove-0.2.8"]);
    // A CACHE_AUDIO message is a harmless no-op when no audio is configured.
    await h.dispatchMessage({ type: "CACHE_AUDIO" });
    h.net.online = false;
    const resp = await h.dispatchFetch(BASE, { mode: "navigate" });
    expect(resp.body).toBe("TROVE");
  });
});

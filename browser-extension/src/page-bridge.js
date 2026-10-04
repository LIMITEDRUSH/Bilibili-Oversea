(() => {
  "use strict";

  const SOURCE = "bili-cdn-auto-page-v2";
  const PLAYURL_PATTERN = /(?:\/playurl|\/play\/url)(?:\?|$)/i;
  const MAX_URLS = 8;
  const mediaRequests = new WeakMap();

  function mediaUrl(value) {
    try {
      const url = new URL(String(value));
      return ["http:", "https:"].includes(url.protocol)
        && (
          url.hostname.toLowerCase().endsWith(".bilivideo.com")
          || url.hostname.toLowerCase().endsWith(".mcdn.bilivideo.cn")
          || url.hostname.toLowerCase() === "upos-hz-mirrorakam.akamaized.net"
        )
        && url.pathname.includes("/upgcxcode/");
    } catch {
      return false;
    }
  }

  function collectMediaUrls(root) {
    const output = [];
    const seenObjects = new WeakSet();
    const seenUrls = new Set();
    const queue = [root];
    let visited = 0;
    while (queue.length && output.length < MAX_URLS && visited < 4_000) {
      const value = queue.shift();
      visited += 1;
      if (typeof value === "string") {
        if (mediaUrl(value) && !seenUrls.has(value)) {
          seenUrls.add(value);
          output.push(value);
        }
        continue;
      }
      if (!value || typeof value !== "object" || seenObjects.has(value)) continue;
      seenObjects.add(value);
      queue.push(...(Array.isArray(value) ? value : Object.values(value)).slice(0, 200));
    }
    return output;
  }

  function collectMediaTracks(root) {
    const tracks = new Map();
    const seen = new WeakSet();
    const queue = [root];
    let visited = 0;
    while (queue.length && visited++ < 4_000 && tracks.size < 128) {
      const value = queue.shift();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      for (const kind of ["video", "audio"]) {
        for (const track of Array.isArray(value.dash?.[kind]) ? value.dash[kind].slice(0, 32) : []) {
          for (const url of collectMediaUrls(track)) {
            if (tracks.size < 128) tracks.set(url, { url, kind });
          }
        }
      }
      queue.push(...(Array.isArray(value) ? value : Object.values(value)).slice(0, 200));
    }
    return [...tracks.values()];
  }

  function announce(payload, reason = "playurl") {
    const urls = collectMediaUrls(payload);
    if (urls.length) window.postMessage({ source: SOURCE, type: "media-urls", reason, urls, tracks: collectMediaTracks(payload) }, location.origin);
  }

  function looksLikePlayurl(value) {
    try {
      return PLAYURL_PATTERN.test(new URL(String(value), location.href).pathname);
    } catch {
      return false;
    }
  }

  function rangeStart(range) {
    const start = Number(String(range || "").match(/^bytes=(\d+)-/i)?.[1] || 0);
    return Number.isSafeInteger(start) && start >= 0 && start <= 2 ** 40 ? start : 0;
  }

  function observeResponse(value, originalUrl, startByte = 0) {
    if (mediaUrl(value)) window.postMessage({ source: SOURCE, type: "media-observed", urls: [value],
      originals: [{ url: value, originalUrl: mediaUrl(originalUrl) ? String(originalUrl) : value, startByte }] }, location.origin);
  }

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === "function") {
    window.fetch = async function biliCdnAutoFetch(input, init) {
      const response = await nativeFetch.call(this, input, init);
      const requestUrl = typeof input === "string" || input instanceof URL ? input : input?.url;
      if (looksLikePlayurl(requestUrl)) response.clone().json().then((value) => announce(value, "fetch")).catch(() => {});
      if (mediaUrl(requestUrl)) {
        const headers = typeof Headers === "function" ? new Headers(init?.headers || input?.headers) : null;
        observeResponse(response.url, requestUrl, rangeStart(headers?.get("range")));
      }
      return response;
    };
  }

  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function biliCdnAutoOpen(method, url, ...rest) {
    if (looksLikePlayurl(url)) {
      this.addEventListener("load", () => {
        try {
          announce(this.responseType === "json" ? this.response : JSON.parse(this.responseText), "xhr");
        } catch {}
      }, { once: true });
    } else if (mediaUrl(url)) {
      mediaRequests.set(this, { originalUrl: String(url), startByte: 0 });
      this.addEventListener("load", () => {
        const request = mediaRequests.get(this);
        observeResponse(this.responseURL, request?.originalUrl, request?.startByte || 0);
      }, { once: true });
    }
    return nativeOpen.call(this, method, url, ...rest);
  };

  const nativeSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  if (typeof nativeSetRequestHeader === "function") {
    XMLHttpRequest.prototype.setRequestHeader = function biliCdnAutoHeader(name, value) {
      if (String(name).toLowerCase() === "range" && mediaRequests.has(this)) mediaRequests.get(this).startByte = rangeStart(value);
      return nativeSetRequestHeader.call(this, name, value);
    };
  }

  window.addEventListener("message", (event) => {
    if (event.source === window && event.data?.source === SOURCE && event.data?.type === "rescan") {
      announce(window.__playinfo__, "rescan");
    }
  });

  for (const method of ["pushState", "replaceState"]) {
    const native = window.history?.[method];
    if (typeof native !== "function") continue;
    window.history[method] = function biliCdnAutoHistory(...args) {
      const result = native.apply(this, args);
      window.postMessage({ source: SOURCE, type: "page-changed", url: location.href }, location.origin);
      return result;
    };
  }

  queueMicrotask(() => announce(window.__playinfo__, "initial"));
})();

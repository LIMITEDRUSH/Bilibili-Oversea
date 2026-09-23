(() => {
  "use strict";

  const SOURCE = "bili-cdn-auto-page-v2";
  const PLAYURL_PATTERN = /(?:\/playurl|\/play\/url)(?:\?|$)/i;
  const MAX_URLS = 8;

  function mediaUrl(value) {
    try {
      const url = new URL(String(value));
      return ["http:", "https:"].includes(url.protocol)
        && (
          url.hostname.toLowerCase().endsWith(".bilivideo.com")
          || url.hostname.toLowerCase().endsWith(".mcdn.bilivideo.cn")
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

  function announce(payload) {
    const urls = collectMediaUrls(payload);
    if (urls.length) window.postMessage({ source: SOURCE, type: "media-urls", urls }, location.origin);
  }

  function looksLikePlayurl(value) {
    try {
      return PLAYURL_PATTERN.test(new URL(String(value), location.href).pathname);
    } catch {
      return false;
    }
  }

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === "function") {
    window.fetch = async function biliCdnAutoFetch(input, init) {
      const response = await nativeFetch.call(this, input, init);
      const requestUrl = typeof input === "string" || input instanceof URL ? input : input?.url;
      if (looksLikePlayurl(requestUrl)) response.clone().json().then(announce).catch(() => {});
      return response;
    };
  }

  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function biliCdnAutoOpen(method, url, ...rest) {
    if (looksLikePlayurl(url)) {
      this.addEventListener("load", () => {
        try {
          announce(this.responseType === "json" ? this.response : JSON.parse(this.responseText));
        } catch {}
      }, { once: true });
    }
    return nativeOpen.call(this, method, url, ...rest);
  };

  window.addEventListener("message", (event) => {
    if (event.source === window && event.data?.source === SOURCE && event.data?.type === "rescan") {
      announce(window.__playinfo__);
    }
  });
  queueMicrotask(() => announce(window.__playinfo__));
})();

async (page) => {
  const report = await page.evaluate(() => {
    const a = window.__multiAudit, v = document.querySelector("video");
    const samples = a?.samples || [], duration = a?.final?.duration || v.duration;
    const steady = samples.filter(s => s.time > 10 && duration - s.time > 10 && !s.paused);
    return { title: a?.final?.title || a?.meta?.title || document.title, views: a?.final?.views || a?.meta?.views || document.querySelector(".view-text")?.textContent,
      quality: a?.final?.quality || document.querySelector(".bpx-player-ctrl-quality-result")?.textContent,
      width: a?.final?.width || v.videoWidth, height: a?.final?.height || v.videoHeight,
      duration: a?.final?.duration || v.duration, time: a?.final?.duration || v.currentTime, ended: !!a?.final,
      samples: samples.length, frames: samples.at(-1)?.frames, dropped: samples.at(-1)?.dropped,
      firstTime: samples[0]?.time, fromStart: samples.some(s => s.time < 2),
      steadyMinBuffer: steady.length ? Math.min(...steady.map(s => s.buffer)) : null,
      episodes: a?.episodes.map(e => ({ flag: e.flag, time: +e.time.toFixed(2), durationMs: Math.round(e.last - e.first + 1500), buffer: +e.buffer.toFixed(2) })),
      events: a?.events, endedWall: a?.final?.endedWall, routes: [...new Set(samples.map(s => s.actual).filter(Boolean))] };
  });
  const local = page.__multiAudit, groups = {};
  for (const r of local.network.filter(r => !report.endedWall || r.at <= report.endedWall)) {
    const host = r.actual || r.host, g = groups[host] ||= { count: 0, bytes: 0, errors: 0, aborted: 0, httpErrors: 0, maxTtfb: 0, cacheHits: 0 };
    g.count++; g.bytes += r.bytes; g.maxTtfb = Math.max(g.maxTtfb, r.ttfb || 0); g.cacheHits += Number(r.cached === true);
    g.errors += Number(!!r.error && !r.error.includes("ABORTED"));
    g.aborted += Number(!!r.error?.includes("ABORTED"));
    g.httpErrors += Number(r.status >= 400);
  }
  return { target: local.target, coldBenchmark: local.cold, ...report, network: groups,
    inflight: [...local.requests.values()].filter(r => !report.endedWall || r.at <= report.endedWall).map(r => ({ host: r.host, age: Date.now() - r.at })),
    scope: "headless decoding/playhead/network observations; not physical display rendering; CDN cache unknown" };
}

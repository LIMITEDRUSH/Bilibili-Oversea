// Presentation only: never feeds the routing or recovery state machine.
export function clockLabel(value) {
  if (!Number.isFinite(value) || value < 0) return "--:--";
  const seconds = Math.floor(value);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds / 60) % 60;
  const s = seconds % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : String(m).padStart(2, "0"))
    + ":" + String(s).padStart(2, "0");
}

export function playbackView(info, { supported = true, now = Date.now() } = {}) {
  const fresh = info && Number.isFinite(info.sampledAt) && now - info.sampledAt >= -1000
    && now - info.sampledAt < 5000;
  const phases = {
    playing: "正在播放", paused: "已暂停", buffering: "正在缓冲", seeking: "正在跳转",
    ended: "播放结束", loading: "正在加载", error: "播放出错", empty: "等待视频",
  };
  const phase = !supported ? "unsupported" : !fresh ? "unknown"
    : Object.hasOwn(phases, info.status) ? info.status : "unknown";
  const hasVideo = fresh && info.hasVideo === true && phase !== "loading" && phase !== "unsupported";
  const width = Number(info?.width), height = Number(info?.height);
  const resolution = hasVideo && Number.isInteger(width) && width > 0 && width <= 16384
    && Number.isInteger(height) && height > 0 && height <= 16384 ? `${width} × ${height}` : "—";
  const ahead = Number(info?.bufferedAhead);
  return {
    phase,
    title: phases[phase] || (phase === "unsupported" ? "打开 B 站播放页" : "读取播放状态"),
    videoTitle: !supported ? "Bilibili oversea" : fresh && info.title
      ? String(info.title).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 240) : "未读取到视频标题",
    resolution,
    buffer: hasVideo && Number.isFinite(ahead) && ahead >= 0 ? `${Math.min(ahead, 86400).toFixed(1)} 秒` : "—",
    progress: hasVideo ? clockLabel(info.currentTime) + " / " + clockLabel(info.duration) : "--:-- / --:--",
  };
}

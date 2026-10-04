async (page) => {
  await page.waitForTimeout(40000);
  const audit = await page.evaluate(()=>{
    const v=document.querySelector('video'),a=window.__lowAudit;
    const samples=a.samples.filter(s=>s.time>1&&!s.paused&&!s.ended);
    const frames=v.getVideoPlaybackQuality?.();
    return {title:document.title,duration:v.duration,time:+v.currentTime.toFixed(2),resolution:[v.videoWidth,v.videoHeight],quality:document.querySelector('.bpx-player-ctrl-quality-result')?.textContent,paused:v.paused,ended:v.ended,frames:frames?{total:frames.totalVideoFrames,dropped:frames.droppedVideoFrames}:null,sampleCount:a.samples.length,minBuffer:samples.length?Math.min(...samples.map(s=>s.buffer)):null,lowBufferSamples:samples.filter(s=>s.buffer<8).length,events:a.events,lastSamples:a.samples.slice(-6)};
  });
  const local=page.__lowAudit;
  const network=local?.network||[];
  return {...audit,networkCount:network.length,failures:network.filter(r=>r.error&&!/ABORTED/.test(r.error)),recentRequests:network.slice(-8)};
}

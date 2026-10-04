async (page) => {
  const report=await page.evaluate(()=>{
    const v=document.querySelector('video'),a=window.__lowAudit,q=v?.getVideoPlaybackQuality?.();
    const firstEnd=a?.events.find(e=>e.type==='ended');
    const duration=firstEnd?.time||v?.duration;
    const timeline=(a?.samples||[]).filter(s=>!firstEnd||s.at<=firstEnd.at);
    const samples=timeline.filter(s=>s.time>1&&!s.paused&&!s.ended);
    const steady=samples.filter(s=>s.time>=10&&duration-s.time>10);
    return {title:document.title,time:firstEnd?.time??v?.currentTime,duration,ended:Boolean(firstEnd)||v?.ended,paused:v?.paused,resolution:[v?.videoWidth,v?.videoHeight],quality:document.querySelector('.bpx-player-ctrl-quality-result')?.textContent,frames:q&&(!firstEnd||Math.abs(v.duration-duration)<1)?{total:q.totalVideoFrames,dropped:q.droppedVideoFrames}:null,minBuffer:samples.length?Math.min(...samples.map(s=>s.buffer)):null,steadyMinBuffer:steady.length?Math.min(...steady.map(s=>s.buffer)):null,steadyLowSamples:steady.filter(s=>s.buffer<8).length,events:a?.events.filter(e=>!firstEnd||e.at<=firstEnd.at),sampleCount:timeline.length,lastSamples:timeline.slice(-8),hosts:[...new Set(samples.map(s=>s.selected))],endedWall:firstEnd?performance.timeOrigin+a.started+firstEnd.at:null};
  });
  const local=page.__lowAudit,network=(local?.network||[]).filter(r=>!report.endedWall||r.at<report.endedWall);
  const groups={};
  for(const r of network){const host=r.responseHost||r.host;const group=groups[host]||={requests:0,bytes:0,maxTtfb:0,maxElapsed:0,errors:0};group.requests++;group.bytes+=r.bytes||0;group.maxTtfb=Math.max(group.maxTtfb,r.ttfb||0);group.maxElapsed=Math.max(group.maxElapsed,r.elapsed||0);if(r.error&&!/ABORTED/.test(r.error))group.errors++;}
  const final=await page.evaluate(()=>window.__lowAudit?.final||{});
  const midPlaybackEvents=(report.events||[]).filter(e=>e.time>10&&e.time<report.duration-1&&['waiting','stalled','seeking','pause','error'].includes(e.type));
  const result={...report,...final,midPlaybackEvents,networkGroups:groups,failures:network.filter(r=>r.error&&!/ABORTED/.test(r.error)),inflight:[...(local?.requests.values()||[])].filter(r=>!report.endedWall||r.at<report.endedWall).map(r=>({host:r.host,responseHost:r.responseHost,status:r.status,age:Date.now()-r.at})),recent:network.slice(-3)};
  result.pass=result.ended&&result.resolution[0]===1920&&result.resolution[1]===1080&&String(result.quality).includes('60帧')&&midPlaybackEvents.length===0;
  return result;
}

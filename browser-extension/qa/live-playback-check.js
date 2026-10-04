async (page) => {
  const browser = await page.context().browser().newBrowserCDPSession();
  for (const target of (await browser.send('Target.getTargets')).targetInfos.filter(t=>t.url.endsWith('/src/popup.html'))) await browser.send('Target.closeTarget',{targetId:target.targetId});
  await browser.detach();
  await page.bringToFront();
  await page.evaluate(async()=>{const v=document.querySelector('video');v.muted=true;await v.play()});
  const worker = page.context().serviceWorkers().find(w=>w.url().endsWith('/src/worker.js'));
  const client = await page.context().newCDPSession(page);
  const versions=[];
  client.on('ServiceWorker.workerVersionUpdated',e=>versions.push(...e.versions));
  await client.send('ServiceWorker.enable');
  await page.waitForTimeout(1000);
  const version=versions.find(v=>v.scriptURL===worker.url() && v.runningStatus==='running');
  if(version) await client.send('ServiceWorker.stopWorker',{versionId:version.versionId});
  const samples=[];
  for(let i=0;i<16;i++) {
    await page.waitForTimeout(2000);
    samples.push(await page.evaluate(()=>{const v=document.querySelector('video');const t=v.currentTime;let buffer=0;for(let j=0;j<v.buffered.length;j++)if(v.buffered.start(j)<=t && v.buffered.end(j)>=t)buffer=v.buffered.end(j)-t;return {time:Number(t.toFixed(2)),buffer:Number(buffer.toFixed(2)),paused:v.paused,ready:v.readyState,phase:document.documentElement.dataset.biliCdnAutoPhase,host:document.documentElement.dataset.biliCdnAutoSelectedHost}}));
  }
  await client.detach();
  return {title:await page.title(),stoppedWorker:Boolean(version),samples,progress:samples.at(-1).time-samples[0].time,pass:samples.at(-1).time-samples[0].time>27 && samples.every(s=>!s.paused&&s.ready>=3&&s.buffer>8)};
}

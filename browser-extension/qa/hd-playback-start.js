async (page) => {
  await page.__lowAudit?.session?.detach().catch(()=>{});
  const worker = page.context().serviceWorkers().find(w => w.url().endsWith('/src/worker.js'));
  if (!worker) throw new Error('Extension worker unavailable');
  const ui = await page.context().newPage();
  await ui.goto(new URL('../src/popup.html', worker.url()).href);
  const tabs = await ui.evaluate(async() => {const own=await chrome.tabs.getCurrent();return (await chrome.tabs.query({})).filter(t=>t.id!==own.id);});
  const tabId = (tabs.find(t => t.url?.includes('BV1V3Ye6zE6f'))||tabs[0]).id;
  const initial = await ui.evaluate(tabId => chrome.runtime.sendMessage({type:'get-state',tabId}),tabId);
  // Only the dedicated QA profile is touched. Never read user credentials.
  const mode=page.__lowplayMode||'auto';
  await ui.evaluate(tabId=>chrome.runtime.sendMessage({type:'set-settings',tabId,settings:{enabled:true,mode:'original',manualHost:'',disabledHosts:[]}}),tabId);
  await page.goto('about:blank');
  const coldBenchmark=mode==='auto'&&page.__lowplayCacheMode!=='warm';
  if(coldBenchmark) await ui.evaluate(()=>chrome.storage.local.remove(['biliCdnAutoBenchmarkV3','biliCdnAutoBenchmarkV4','biliCdnAutoBenchmarkV5']));
  await ui.evaluate(({tabId,mode}) => chrome.runtime.sendMessage({type:'set-settings',tabId,settings:{enabled:true,mode,manualHost:'',disabledHosts:[]}}),{tabId,mode});
  await ui.close();
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.setCacheDisabled', {cacheDisabled:true});
  const requests = new Map();
  const network = [];
  session.on('Network.requestWillBeSent', e => {
    const u = new URL(e.request.url);
    if (!u.pathname.includes('/upgcxcode/')) return;
    requests.set(e.requestId,{host:u.hostname,kind:u.pathname.includes('m4s')?'dash':'other',range:e.request.headers.Range||e.request.headers.range||'',at:Date.now()});
  });
  session.on('Network.responseReceived', e => {
    const req=requests.get(e.requestId); if(!req)return;
    Object.assign(req,{responseHost:new URL(e.response.url).hostname,status:e.response.status,ttfb:Date.now()-req.at,cache:e.response.fromDiskCache||e.response.fromServiceWorker||false});
  });
  session.on('Network.loadingFinished', e => {
    const req=requests.get(e.requestId);if(!req)return;
    network.push({...req,elapsed:Date.now()-req.at,bytes:e.encodedDataLength});requests.delete(e.requestId);
  });
  session.on('Network.loadingFailed', e => {
    const req=requests.get(e.requestId);if(!req)return;
    network.push({...req,elapsed:Date.now()-req.at,error:e.errorText});requests.delete(e.requestId);
  });
  page.__lowAudit={session,network,requests,tabId};
  if(!page.__lowAuditInitAdded) await page.addInitScript(() => {
    const audit=window.__lowAudit={started:performance.now(),events:[],samples:[]};
    const attached=new WeakSet();
    function sample(){
      const v=document.querySelector('video');if(!v)return;
      let buffer=0;for(let i=0;i<v.buffered.length;i++)if(v.buffered.start(i)<=v.currentTime&&v.buffered.end(i)>=v.currentTime)buffer=v.buffered.end(i)-v.currentTime;
      if(!attached.has(v)){
        attached.add(v);
        for(const type of ['waiting','stalled','playing','pause','seeking','seeked','error','ended'])v.addEventListener(type,()=>{
          audit.events.push({type,at:Math.round(performance.now()-audit.started),time:+v.currentTime.toFixed(2),ready:v.readyState,paused:v.paused});
          if(type==='ended'&&!audit.final){const q=v.getVideoPlaybackQuality?.();audit.final={title:document.title,resolution:[v.videoWidth,v.videoHeight],quality:document.querySelector('.bpx-player-ctrl-quality-result')?.textContent,frames:q?{total:q.totalVideoFrames,dropped:q.droppedVideoFrames}:null};}
        });
      }
      audit.samples.push({at:Math.round(performance.now()-audit.started),time:+v.currentTime.toFixed(2),buffer:+buffer.toFixed(2),paused:v.paused,ready:v.readyState,ended:v.ended,phase:document.documentElement.dataset.biliCdnAutoPhase,selected:document.documentElement.dataset.biliCdnAutoSelectedHost,actual:document.documentElement.dataset.biliCdnAutoActualHost});
    }
    setInterval(sample,2000);
  });
  page.__lowAuditInitAdded=true;
  if(page.url().includes('/video/BV1V3Ye6zE6f'))await page.reload({waitUntil:'domcontentloaded'});
  else await page.goto('https://www.bilibili.com/video/BV1V3Ye6zE6f/',{waitUntil:'domcontentloaded'});
  await page.bringToFront();
  await page.waitForSelector('video');
  await page.evaluate(async()=>{const v=document.querySelector('video');v.muted=true;v.currentTime=0;await v.play();});
  return {version:await worker.evaluate(()=>chrome.runtime.getManifest().version),mode,coldBenchmark,initialMode:initial.settings.mode,initialWinner:initial.state?.selectedHost||'',monitoring:true};
}

async (page) => {
  const worker = page.context().serviceWorkers().find(w=>w.url().endsWith('/src/worker.js'));
  const saved = await worker.evaluate(async () => (await chrome.storage.local.get('biliCdnAutoSettingsV2')).biliCdnAutoSettingsV2);
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({url:'https://www.bilibili.com/video/*'}))[0].id);
  const sourceUrl = await page.evaluate(() => performance.getEntriesByType('resource').find(r=>r.name.includes('/upgcxcode/') && r.name.includes('.bilivideo.com/'))?.name);
  if (!sourceUrl) throw new Error('Play a Bilibili video in the dedicated test profile first.');
  const sourceHost = new URL(sourceUrl).hostname;
  const targetHost = sourceHost.includes('aliov')?'upos-sz-mirrorcosov.bilivideo.com':'upos-sz-mirroraliov.bilivideo.com';
  const ui = await page.context().newPage();
  await ui.goto(new URL('../src/popup.html', worker.url()).href);
  const session = await page.context().newCDPSession(page);
  const probes = new Map();
  const observed = [];
  session.on('Network.requestWillBeSent', event => {
    const headers=event.request.headers;
    if (Object.entries(headers).some(([key,value])=>key.toLowerCase()==='range' && value==='bytes=0-1023')) {
      if (!probes.has(event.requestId)) probes.set(event.requestId,new URL(event.request.url).hostname);
    }
  });
  session.on('Network.responseReceived', event => {
    if (probes.has(event.requestId)) observed.push({requested:probes.get(event.requestId),received:new URL(event.response.url).hostname,status:event.response.status});
  });
  await session.send('Network.enable');
  let result;
  try {
    const applied=await ui.evaluate(({tabId,settings})=>chrome.runtime.sendMessage({type:'set-settings',tabId,settings}), {tabId,settings:{...saved,enabled:true,mode:'manual',manualHost:targetHost,disabledHosts:[]}});
    const probe=await worker.evaluate(({tabId,sourceUrl,sourceHost})=>chrome.tabs.sendMessage(tabId,{type:'probe-candidates',sourceUrl,hosts:[sourceHost],byteLimit:1024,timeoutMs:4500}), {tabId,sourceUrl,sourceHost});
    const playbackRequest=await page.evaluate(async sourceUrl=>{try{const response=await fetch(sourceUrl,{headers:{Range:'bytes=0-3071'},credentials:'omit'});await response.body?.cancel();return {host:new URL(response.url).hostname,status:response.status};}catch(error){return {error:error.message}}},sourceUrl);
    result={sourceHost,targetHost,installed:applied.state.ruleInstalled,probe:probe.results,playbackRequest,network:observed};
    result.pass=applied.state.ruleInstalled && probe.results.some(r=>r.ok && r.host===sourceHost && r.responseHost===sourceHost) && playbackRequest.host===targetHost && playbackRequest.status===206;
  } finally {
    await ui.evaluate(({tabId,settings})=>chrome.runtime.sendMessage({type:'set-settings',tabId,settings}), {tabId,settings:saved});
    await session.detach();
    await ui.close();
  }
  return result;
}

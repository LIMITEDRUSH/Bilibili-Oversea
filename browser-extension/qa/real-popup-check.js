// Run through playwright-cli against a dedicated browser profile with this
// extension loaded. Uses the actual chrome.action popup, not a normal page.
async (page) => {
  const context = page.context();
  const worker = context.serviceWorkers().find(w => w.url().endsWith('/src/worker.js'));
  if (!worker) throw new Error('Load the extension into a dedicated Edge/Chrome profile first.');
  const saved = await worker.evaluate(async () => (await chrome.storage.local.get('biliCdnAutoSettingsV2')).biliCdnAutoSettingsV2);
  const session = await context.browser().newBrowserCDPSession();
  const checks = [];
  let attachment;
  let sequence = 0;
  const check = (name, value, detail) => {
    checks.push({name, pass:Boolean(value), detail});
    if (!value) throw new Error(name + ': ' + JSON.stringify(detail));
  };
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const sessionId = attachment.sessionId;
    const timeout = setTimeout(() => { session.off('Target.receivedMessageFromTarget', listener); reject(new Error('CDP timeout: ' + method)); }, 40000);
    const listener = event => {
      if (event.sessionId !== sessionId) return;
      const message = JSON.parse(event.message);
      if (message.id !== id) return;
      clearTimeout(timeout);
      session.off('Target.receivedMessageFromTarget', listener);
      if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
    };
    session.on('Target.receivedMessageFromTarget', listener);
    session.send('Target.sendMessageToTarget', {sessionId, message:JSON.stringify({id,method,params})}).catch(reject);
  });
  const evaluate = async expression => {
    const result = await request('Runtime.evaluate', {expression,returnByValue:true,awaitPromise:true,userGesture:true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Popup evaluation failed');
    return result.result.value;
  };
  const wait = expression => evaluate(`new Promise((resolve,reject)=>{const until=Date.now()+35000;const tick=()=>{if(${expression})return resolve(true);if(Date.now()>until)return reject(new Error('UI did not settle'));setTimeout(tick,50)};tick()})`);
  const open = async () => {
    if (attachment) { await session.send('Target.detachFromTarget',{sessionId:attachment.sessionId}).catch(()=>{}); attachment=null; }
    const targets = await session.send('Target.getTargets');
    for (const target of targets.targetInfos.filter(t => t.url.endsWith('/src/popup.html'))) {
      await session.send('Target.closeTarget',{targetId:target.targetId});
      // Allow Edge's native bubble widget to finish closing too.
      await page.waitForTimeout(500);
    }
    await page.bringToFront();
    // Closing a native bubble through CDP can outlive its target. Give the
    // widget a bounded retry rather than treating that harness race as UI data.
    for (let attempt=0;attempt<3;attempt++) {
      try {
        await worker.evaluate(async () => {
          const [window] = await chrome.windows.getAll();
          await chrome.windows.update(window.id,{focused:true});
          await chrome.action.openPopup({windowId:window.id});
        });
        break;
      } catch(error) {
        if (attempt===2) throw error;
        await page.waitForTimeout(500);
      }
    }
    const {targetInfos} = await session.send('Target.getTargets');
    const target = targetInfos.find(t => t.url.endsWith('/src/popup.html'));
    if (!target) throw new Error('Action popup missing');
    attachment = await session.send('Target.attachToTarget',{targetId:target.targetId,flatten:false});
    await wait(`document.querySelector('#enabled') && !document.querySelector('#enabled').disabled`);
  };
  const click = async selector => {
    const rect = await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled)throw new Error('Unavailable action');el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,label:el.getAttribute('aria-label')||el.textContent}})()`);
    await request('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.x,y:rect.y,button:'left',clickCount:1});
    await request('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.x,y:rect.y,button:'left',clickCount:1});
  };
  const layout = async name => {
    const value = await evaluate(`(()=>{const shell=document.querySelector('.shell');shell.scrollTop=shell.scrollHeight;const footer=document.querySelector('footer').getBoundingClientRect();const result={width:innerWidth,height:innerHeight,rootWidth:document.documentElement.scrollWidth,bodyWidth:document.body.getBoundingClientRect().width,footerBottom:footer.bottom,footerTop:footer.top,phase:document.querySelector('#phase').textContent};shell.scrollTop=0;return result})()`);
    check(name,value.width===400 && value.rootWidth===400 && value.bodyWidth===400 && value.height<=600 && value.footerBottom<=value.height+2 && value.footerTop>=0,value);
  };
  let failure = '';
  const wasPaused = await page.evaluate(() => document.querySelector('video')?.paused);
  try {
    await page.evaluate(async () => {
      const video = document.querySelector('video');
      if (!video) throw new Error('Bilibili video missing');
      if (video.ended) video.currentTime = 0;
      await video.play();
    });
    await open();
    await wait(`document.querySelector('#statusPanel').dataset.playback==='playing'`);
    const video = await page.evaluate(() => { const v=document.querySelector('video'); return { width:v.videoWidth,height:v.videoHeight,title:document.querySelector('h1.video-title')?.textContent?.trim(),paused:v.paused }; });
    const displayed = await evaluate(`({status:document.querySelector('#playbackStatus').textContent,resolution:document.querySelector('#resolution').textContent,title:document.querySelector('#videoTitle').textContent,buffer:document.querySelector('#buffer').textContent,progress:document.querySelector('#progress').textContent,animation:getComputedStyle(document.querySelector('#dot')).animationName,help:document.querySelector('footer a').href})`);
    check('Live playing status uses real frames, not route mode',!video.paused && displayed.status==='正在播放' && displayed.animation==='breathe',displayed);
    check('Actual resolution and video title are shown',displayed.resolution===video.width+' × '+video.height && displayed.title===video.title,{video,displayed});
    check('Buffer and progress are populated',/秒$/.test(displayed.buffer) && !displayed.progress.includes('--'),{buffer:displayed.buffer,progress:displayed.progress});
    check('Every popup link enters the personal site',displayed.help==='https://limitedrush.online/projects/bilibili-oversea');
    const originalHeading = await page.evaluate(() => {
      const h=document.querySelector('h1.video-title');
      const saved={text:h.textContent,title:h.getAttribute('title')};
      h.textContent='长标题与排版检查：'.repeat(20);h.setAttribute('title',h.textContent);return saved;
    });
    try {
      await wait(`document.querySelector('#videoTitle').textContent.startsWith('长标题与排版检查')`);
      const titleLayout=await evaluate(`({height:document.querySelector('#videoTitle').getBoundingClientRect().height,width:document.documentElement.scrollWidth,clamp:getComputedStyle(document.querySelector('#videoTitle')).webkitLineClamp})`);
      check('Controlled long-title DOM fixture stays within two lines',titleLayout.height===44 && titleLayout.width===400 && titleLayout.clamp==='2',titleLayout);
    } finally {
      await page.evaluate(saved=>{const h=document.querySelector('h1.video-title');h.textContent=saved.text;if(saved.title===null)h.removeAttribute('title');else h.setAttribute('title',saved.title);},originalHeading);
    }
    await page.evaluate(() => document.querySelector('video').pause());
    await wait(`document.querySelector('#statusPanel').dataset.playback==='paused'`);
    check('Pausing video stops the breathing light',await evaluate(`document.querySelector('#playbackStatus').textContent==='已暂停' && getComputedStyle(document.querySelector('#dot')).animationName==='none'`));
    await request('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await page.evaluate(() => document.querySelector('video').play());
    await wait(`document.querySelector('#statusPanel').dataset.playback==='playing'`);
    check('Reduced motion disables breathing while preserving real status',await evaluate(`getComputedStyle(document.querySelector('#dot')).animationName==='none' && document.querySelector('#playbackStatus').textContent==='正在播放'`));
    await request('Emulation.setEmulatedMedia',{features:[]});
    for (let i=0;i<5;i++) { await open(); await layout('Native popup opening ' + (i+1)); }
    await click('#enabled');
    await wait(`document.querySelector('#routeMode').textContent==='优化关闭' && !document.querySelector('#enabled').disabled`);
    await layout('Paused layout');
    await open();
    check('Paused setting survives reopening',await evaluate(`!document.querySelector('#enabled').checked`));
    await click('#enabled');
    await wait(`!document.querySelector('#enabled').disabled`);
    await click('#original');
    await wait(`document.querySelector('#routeMode').textContent==='原始线路' && !document.querySelector('#original').disabled`);
    const rules = await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
    const redirects = rules.filter(rule => rule.action.type === 'redirect');
    check('Original mode removes redirect rules',redirects.length===0,{redirects:redirects.length});
    await layout('Original layout');
    await click('#auto');
    await wait(`!document.querySelector('#auto').disabled && document.querySelector('#auto').getAttribute('aria-pressed')==='true'`);
    await layout('Auto layout');
    const passthrough = await evaluate(`(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return (await chrome.runtime.sendMessage({type:'get-state',tabId:tab.id})).state?.passthroughReason})()`);
    if (passthrough === 'baseline-akamai') {
      check('Akamai native passthrough is explicit',await evaluate(`document.querySelector('#routeMode').textContent==='原始直通' && document.querySelector('#message').hidden && document.querySelector('#applyState').textContent==='直通'`));
      check('Akamai does not offer an ineffective retest',await evaluate(`document.querySelector('#retest').disabled`));
      check('Akamai empty state does not promise automatic benchmarking',await evaluate(`document.querySelector('#results').textContent.includes('未参与测速') && document.querySelectorAll('#results .result').length===3 && document.querySelector('#routeMode').textContent==='原始直通'`));
      const nativeRules=await worker.evaluate(()=>chrome.declarativeNetRequest.getSessionRules());
      check('Akamai automatic mode installs no playback redirect',!nativeRules.some(rule=>rule.action.type==='redirect'));
    } else {
    await wait(`Array.from(document.querySelectorAll('button[data-action-key]')).some(b=>b.dataset.actionKey.startsWith('use:') && !b.disabled)`);
    const originalHost = await evaluate(`(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return (await chrome.runtime.sendMessage({type:'get-state',tabId:tab.id})).state.originalHost})()`);
    const fixedKey = await evaluate(`(()=>{const buttons=Array.from(document.querySelectorAll('button[data-action-key]')).filter(b=>b.dataset.actionKey.startsWith('use:')&&!b.disabled);return (buttons.find(b=>b.dataset.actionKey.slice(4)!==${JSON.stringify(originalHost)})||buttons[0]).dataset.actionKey})()`);
    {
      await click('[data-action-key="'+fixedKey+'"]');
      await wait(`document.querySelector('#routeMode').textContent==='固定线路' && !document.querySelector('#enabled').disabled`);
      await layout('Fixed layout');
      const host=fixedKey.slice(4);
      const fixedRules = await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
      check('Fixed node applies its redirect target',host===originalHost ? !fixedRules.some(rule=>rule.action.type==='redirect') : fixedRules.some(rule=>rule.action.redirect?.transform?.host===host),{host,originalHost,direct:host===originalHost});
      await click('[data-action-key="exclude:'+host+'"]');
      await wait(`!document.querySelector('#enabled').disabled`);
      const restoredKey='exclude:'+host;
      const available=await evaluate(`Array.from(document.querySelectorAll('button[data-action-key]')).some(b=>b.dataset.actionKey===${JSON.stringify(restoredKey)} && b.textContent==='恢复')`);
      check('Excluded current node has a Restore action',available,{host});
      await click('[data-action-key="'+restoredKey+'"]');
      await wait(`!document.querySelector('#enabled').disabled`);
      await layout('Restored layout');
    }
    await wait(`!document.querySelector('#retest').disabled`);
    await click('#retest');
    await wait(`document.querySelector('#phase').textContent==='正在测速' && !document.querySelector('#routingActivity').hidden`);
    check('Retest leaves pause and mode controls usable',await evaluate(`!document.querySelector('#enabled').disabled && !document.querySelector('#original').disabled`));
    await click('#original');
    await wait(`document.querySelector('#routeMode').textContent==='原始线路' && !document.querySelector('#original').disabled`);
    await page.waitForTimeout(1500);
    const cancelledRules = await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
    check('Cancelled retest cannot reinstall playback redirects',!cancelledRules.some(rule=>rule.action.type==='redirect'));
    await layout('Cancelled retest layout');
    }
    await evaluate(`Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async value=>{window.qaDiagnostics=JSON.parse(value)}})`);
    await click('#copyDiagnostics');
    const copied=await evaluate(`({label:document.querySelector('#copyDiagnostics').textContent,version:window.qaDiagnostics?.version,hasUrls:JSON.stringify(window.qaDiagnostics).includes('https://')})`);
    check('Copy diagnostics control exports no media URLs',copied.label==='已复制' && Boolean(copied.version) && !copied.hasUrls,copied);
    const currentTabId = await worker.evaluate(async()=> (await chrome.tabs.query({active:true,currentWindow:true}))[0].id);
    await worker.evaluate(async tabId=>chrome.runtime.sendMessage({type:'state-updated',tabId,state:{phase:'error',lastError:'连接失败，请检查当前网络后重新测试。'.repeat(8),results:Array.from({length:8},(_,i)=>({host:['upos-sz-mirroraliov.bilivideo.com','upos-sz-mirrorcosov.bilivideo.com','upos-sz-mirrorhwov.bilivideo.com'][i]||'long-unknown-candidate-'+i+'.bilivideo.com',ok:false,status:403,error:'fixture'}))}}).catch(()=>{}),currentTabId);
    await wait(`document.querySelector('#phase').textContent==='线路测试未完成' || document.querySelector('#statusPanel').dataset.phase==='error'`);
    await layout('Controlled error and long-domain fixture');
    const scrolling = await evaluate(`(()=>{const list=document.querySelector('#results');list.scrollTop=list.scrollHeight;return {rows:list.children.length,scrollable:list.scrollHeight>list.clientHeight,lastVisible:list.lastElementChild.getBoundingClientRect().bottom<=list.getBoundingClientRect().bottom+2}})()`);
    check('Eight-node fixture scrolls to final row',scrolling.rows===8 && scrolling.scrollable && scrolling.lastVisible,scrolling);
    // UI-only boundary fixture; no media request, measurement or rule is faked.
    await worker.evaluate(async tabId=>chrome.runtime.sendMessage({type:'state-updated',tabId,settings:{enabled:true,mode:'auto',manualHost:'',disabledHosts:[]},state:{phase:'original',passthroughReason:'baseline-akamai',actualHost:'upos-hz-mirrorakam.akamaized.net',originalHost:'upos-hz-mirrorakam.akamaized.net',sourceKind:'video',ruleInstalled:false,lastDetectedAt:Date.now(),results:[]}}).catch(()=>{}),currentTabId);
    await wait(`document.querySelector('#routeMode').textContent==='原始直通'`);
    check('Controlled Akamai UI fixture has truthful empty state',await evaluate(`document.querySelector('#results').textContent.includes('未参与测速') && document.querySelectorAll('#results .result').length===3 && document.querySelector('#routeMode').textContent==='原始直通'`));
    check('Controlled Akamai UI fixture disables ineffective retest',await evaluate(`document.querySelector('#retest').disabled && document.querySelector('#applyState').textContent==='直通'`));
    await open();
    await layout('Real state restored after fixture');
    await evaluate(`(async()=>chrome.runtime.sendMessage({type:'set-settings',tabId:(await chrome.tabs.query({active:true,currentWindow:true}))[0].id,settings:{enabled:true,mode:'auto',manualHost:'',disabledHosts:[]}}))()`);
    await wait(`document.querySelector('#auto').getAttribute('aria-pressed')==='true' && document.querySelector('#original').getAttribute('aria-pressed')==='false'`);
    check('External setting change synchronizes mode buttons',await evaluate(`document.querySelector('#auto').getAttribute('aria-pressed')==='true'`));
  } catch(error) { failure=String(error.message); }
  finally {
    if (attachment && saved) await evaluate(`(async()=>chrome.runtime.sendMessage({type:'set-settings',tabId:(await chrome.tabs.query({active:true,currentWindow:true}))[0].id,settings:${JSON.stringify(saved)}}))()`).catch(()=>{});
    if (attachment) await session.send('Target.detachFromTarget',{sessionId:attachment.sessionId}).catch(()=>{});
    await session.detach();
    if (wasPaused) await page.evaluate(() => document.querySelector('video')?.pause()).catch(()=>{});
  }
  return {checks,pass:!failure,failure,clipboard:'Captured in popup memory; system clipboard unchanged'};
}

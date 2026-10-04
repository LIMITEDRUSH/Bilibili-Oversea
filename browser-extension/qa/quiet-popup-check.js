// Background rendered-page verification. Never calls chrome.action.openPopup.
// Active-tab binding is controlled; backend requests still use the real tab.
async (page) => {
  const context=page.context();
  const worker=context.serviceWorkers().find(w=>w.url().endsWith('/src/worker.js'));
  if(!worker)throw new Error('Dedicated extension profile required');
  await page.bringToFront();
  const {tab,saved}=await worker.evaluate(async url=>({tab:(await chrome.tabs.query({})).find(tab=>tab.url===url),saved:(await chrome.storage.local.get('biliCdnAutoSettingsV2')).biliCdnAutoSettingsV2}),page.url());
  if(!tab)throw new Error('Actual playback tab not found');
  const ui=await context.newPage();
  await ui.setViewportSize({width:400,height:700});
  await ui.addInitScript(value=>{chrome.tabs.query=async()=>[value];},tab);
  const extensionUrl=worker.url().replace('/src/worker.js','');
  const version=await worker.evaluate(()=>chrome.runtime.getManifest().version);
  const checks=[];
  const check=(name,value,detail)=>{checks.push({name,pass:!!value,detail});if(!value)throw new Error(name+': '+JSON.stringify(detail));};
  const snapshot=()=>ui.evaluate(()=>({rows:[...document.querySelectorAll('.result')].map(row=>({host:row.querySelector('.host-name').title,text:row.textContent})),summary:document.querySelector('#resultSummary').textContent,busy:!document.querySelector('#routingActivity').hidden,message:document.querySelector('#message').textContent,phase:document.querySelector('#statusPanel').dataset.phase}));
    const footerPosition=()=>ui.evaluate(()=>{const footer=document.querySelector('footer').getBoundingClientRect(),list=document.querySelector('#results').getBoundingClientRect(),shell=document.querySelector('.shell');return {top:footer.top,bottom:footer.bottom,listBottom:list.bottom,shellScroll:shell.scrollHeight-shell.clientHeight};});
  const wait=async()=>ui.waitForFunction(()=>!document.querySelector('#enabled').disabled);
  const fixture=async state=>{
    await worker.evaluate(async value=>chrome.runtime.sendMessage({type:'state-updated',tabId:value.tabId,settings:{enabled:true,mode:'auto',manualHost:'',disabledHosts:[]},state:value.state}).catch(()=>{}),{tabId:tab.id,state});
    await ui.waitForFunction(expected=>document.querySelector('#statusPanel').dataset.phase===expected,state.phase);
  };
  const preset=['upos-sz-mirroraliov.bilivideo.com','upos-sz-mirrorcosov.bilivideo.com','upos-sz-mirrorhwov.bilivideo.com'];
  let failure='',realRetest='not eligible';
  try{
    await ui.goto(extensionUrl+'/src/popup.html');await wait();
    const initial=await snapshot();
    check('Rendered root is 400px',await ui.evaluate(()=>document.documentElement.scrollWidth===400));
    if(await ui.locator('#retest').isEnabled()){
      await ui.locator('#retest').click();
      await ui.waitForFunction(()=>!document.querySelector('#routingActivity').hidden);
      let minimum=Infinity;
      for(let i=0;i<20;i++){minimum=Math.min(minimum,(await snapshot()).rows.length);await ui.waitForTimeout(100);}
      check('Real retest never empties the candidate directory',minimum>=3,{minimum});
      await ui.waitForFunction(()=>document.querySelector('#routingActivity').hidden,{},{timeout:45000});
      realRetest='completed';
    }
    check('Background UI opened no native popup',!context.pages().some(p=>p!==ui&&p.url().endsWith('/src/popup.html')));
    const results=Array.from({length:8},(_,i)=>({host:preset[i]||'observed-'+i+'.bilivideo.com',ok:true,kbps:8000-i*100,status:206,ttfbMs:12,sampledAt:Date.now()-10000}));
    await fixture({phase:'testing',lastDetectedAt:1,selectedHost:preset[0],actualHost:preset[0],results});
    const busyFooter=await footerPosition();
    check('Controlled retest fixture retains all eight nodes',(await snapshot()).rows.length>=8);
    check('Previous measurements are labelled during retest',(await snapshot()).rows.some(row=>row.text.includes('上次')));
    const oldScroll=await ui.evaluate(()=>{const list=document.querySelector('#results');list.scrollTop=list.scrollHeight;return list.scrollTop;});
    await fixture({phase:'active',lastDetectedAt:1,selectedHost:preset[1],actualHost:preset[1],results});
    const activeFooter=await footerPosition();
    check('Retest does not move footer or create outer scrolling',Math.abs(busyFooter.top-activeFooter.top)<1&&activeFooter.shellScroll===0&&activeFooter.listBottom<activeFooter.top,{busyFooter,activeFooter});
    const scroll=await ui.evaluate(()=>{const list=document.querySelector('#results');return {top:list.scrollTop,max:list.scrollHeight-list.clientHeight};});
    check('Result updates preserve list scroll position within new bounds',Math.abs(Math.min(oldScroll,scroll.max)-scroll.top)<=2,{oldScroll,...scroll});
    await fixture({phase:'waiting',lastDetectedAt:1,originalHost:'another-real-source.bilivideo.com',results:[]});
    const empty=await snapshot();
    check('Controlled empty-result fixture retains preset and observed source',empty.rows.some(row=>row.host==='another-real-source.bilivideo.com')&&preset.every(host=>empty.rows.some(row=>row.host===host)),{rows:empty.rows.length});
    check('Unmeasured nodes do not invent throughput',empty.rows.filter(row=>row.text.includes('未测速')).every(row=>!row.text.includes('Mbps')));
    await fixture({phase:'original',passthroughReason:'baseline-akamai',originalHost:'upos-hz-mirrorakam.akamaized.net',actualHost:'upos-hz-mirrorakam.akamaized.net',lastDetectedAt:1,results:[]});
    const native=await snapshot();
    check('Native passthrough retains candidate directory without measurements',preset.every(host=>native.rows.some(row=>row.host===host&&row.text.includes('未参与测速'))));
    check('Observed Akamai source is visible but has no fixed or exclude action',await ui.evaluate(()=>{const row=[...document.querySelectorAll('.result')].find(el=>el.querySelector('.host-name').title==='upos-hz-mirrorakam.akamaized.net');return row&&row.querySelectorAll('button').length===0&&row.textContent.includes('不参与测速或固定');}));
    check('Native passthrough does not enable unsupported retest',!await ui.locator('#retest').isEnabled());
    await fixture({phase:'error',ruleInstalled:true,lastError:'撤销规则未完成',lastDetectedAt:1,results:[]});
    check('Rule failure does not claim successful shutdown',await ui.locator('#routeMode').textContent()==='规则异常');
    const layout=await ui.evaluate(()=>{const shell=document.querySelector('.shell');shell.scrollTop=shell.scrollHeight;return {width:document.documentElement.scrollWidth,height:shell.getBoundingClientRect().height,footer:document.querySelector('footer').getBoundingClientRect().bottom};});
    check('Long-state footer remains reachable',layout.width===400&&layout.height<=600&&layout.footer<=602,layout);
    await ui.reload();await wait();
    await ui.waitForTimeout(1500);
    await ui.screenshot({path:'output/playwright/ui-v'+version+'/quiet-preview.png',clip:{x:0,y:0,width:400,height:Math.ceil(await ui.locator('.shell').evaluate(el=>el.getBoundingClientRect().height))}});
    check('Help stays on the personal website',(await ui.locator('footer a').getAttribute('href'))==='https://limitedrush.online/projects/bilibili-oversea');
    return {checks,pass:true,realRetest,initialPhase:initial.phase,scope:'headless rendered extension page; active-tab binding and labelled fixtures controlled; not native-popup sizing or full-playback acceptance'};
  }catch(error){failure=String(error.message);return {checks,pass:false,failure,realRetest};}
  finally{
    if(saved)await ui.evaluate(value=>chrome.runtime.sendMessage({type:'set-settings',tabId:value.tabId,settings:value.settings}),{tabId:tab.id,settings:saved}).catch(()=>{});
    await ui.close();await page.bringToFront();
  }
}

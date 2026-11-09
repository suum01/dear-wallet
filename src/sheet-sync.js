import { emptyState, parseState } from './domain.js';
import { GoogleSheets, stateDiff, applyPatches, mergeForConnection, spreadsheetId } from './sheets.js';
import { GOOGLE_CLIENT_ID } from './google-config.js';
const META_KEY='dear-wallet.sheets.v1';
function defaultStorage(){try{return globalThis.localStorage;}catch{return {getItem:()=>null,setItem:()=>{throw new Error('브라우저 저장 권한을 확인해주세요.');},removeItem:()=>{throw new Error('브라우저 저장 권한을 확인해주세요.');}};}}
const SCOPE='https://www.googleapis.com/auth/spreadsheets';
let sdkPromise;
function googleSDK() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;script.referrerPolicy='strict-origin-when-cross-origin';
    const timeout=setTimeout(()=>{script.remove();sdkPromise=null;reject(new Error('구글 로그인 준비가 늦어지고 있어요. 네트워크를 확인하고 다시 눌러주세요.'));},12000);
    script.onload=()=>{clearTimeout(timeout); if(globalThis.google?.accounts?.oauth2)resolve();else{sdkPromise=null;reject(new Error('구글 로그인 기능을 불러오지 못했어요.'));}};
    script.onerror=()=>{clearTimeout(timeout);script.remove();sdkPromise=null;reject(new Error('구글 로그인에 연결하지 못했어요. 인터넷 연결과 브라우저 차단 설정을 확인해주세요.'));};document.head.append(script);
  });return sdkPromise;
}
export function readSyncMeta(storage) {
  try { const m=JSON.parse(storage.getItem(META_KEY));return m?.version===1 && spreadsheetId(m.id)===m.id && typeof m.title==='string' && parseState(JSON.stringify(m.baseline)) ? m : null; } catch {return null;}
}
export class SheetSync {
  constructor({getLocal,applyLocal,onChange=()=>{},isDemo=()=>false,isLocalReady=()=>true,storage=defaultStorage(),client}) {
    this.getLocal=getLocal;this.applyLocal=applyLocal;this.onChange=onChange;this.isDemo=isDemo;this.isLocalReady=isLocalReady;this.storage=storage;this.meta=readSyncMeta(storage);this.busy=false;this.token='';this.expires=0;this.message='';this.lastError='';
    this.client=client || new GoogleSheets({token:()=>{if(!this.authorized())throw new Error('구글 로그인이 만료됐어요. 다시 로그인해주세요.');return this.token;}});
  }
  authorized(){return !!this.token && Date.now()<this.expires;}
  dirty(){return this.isLocalReady() && !!this.meta && stateDiff(this.meta.baseline,this.getLocal()).length>0;}
  notify(){this.onChange(this);}
  cancelTimer(){clearTimeout(this.timer);}
  changed(){this.lastError='';this.notify();this.schedule();}
  schedule(){this.cancelTimer();if(this.meta && this.authorized() && !this.isDemo())this.timer=setTimeout(()=>{void this.sync();},900);}
  async run(operation){
    if(this.busy) return null;
    if(!this.isLocalReady()){this.lastError='기존 브라우저 데이터를 확인하지 못해 동기화를 중지했어요. 시트는 변경하지 않았어요.';this.notify();return null;}
    if(this.isDemo()){this.lastError='샘플 모드에서는 시트에 연결하거나 저장하지 않아요.';this.notify();return null;}
    this.busy=true;this.lastError='';this.notify();
    try{return await operation();}catch(error){if(error.status===401){this.token='';this.expires=0;}this.lastError=error.name==='TimeoutError'?'구글 응답을 기다리다 중단했어요. 기록은 이 기기에 남아 있어요. 다시 동기화해주세요.':error instanceof TypeError?'시트에 연결하지 못했어요. 인터넷을 확인하고 다시 동기화해주세요. 기록은 이 기기에 남아 있어요.':error.message || '동기화하지 못했어요. 다시 시도해주세요.';return null;}
    finally{this.busy=false;this.notify();}
  }
  async inspect(id){return this.run(()=>this.client.read(id));}
  async adopt(snapshot,merge){return this.run(async()=>{
    // Keep a recoverable copy before changing the local view or attaching a sheet.
    const latest=await this.client.read(snapshot.id);
    const local=structuredClone(this.getLocal());
    this.storage.setItem(`dear-wallet.beforeSheets.${Date.now()}`,JSON.stringify(local));
    const next=merge ? mergeForConnection(latest.state,local) : latest.state;
    if(merge && !Object.values(latest.tables).some(rows=>rows.length>1 && rows[0]?.[0]!=='카테고리ID')) next.settings=structuredClone(local.settings);
    await this.client.write(latest,stateDiff(latest.state,next));
    const saved=await this.client.read(snapshot.id);
    const during=stateDiff(local,this.getLocal());
    this.applyLocal(applyPatches(saved.state,during));
    const meta={version:1,id:snapshot.id,title:saved.title,baseline:saved.state,lastSync:new Date().toISOString()};
    this.storage.setItem(META_KEY,JSON.stringify(meta));this.meta=meta;this.message='시트에 연결하고 저장했어요.';if(during.length)this.schedule();return true;
  });}
  async sync(){
    this.cancelTimer();if(!this.meta)return null;
    if(!this.authorized()){this.lastError='구글에 다시 로그인하면 저장 대기 중인 기록을 동기화할 수 있어요.';this.notify();return null;}
    const work=()=>this.run(async()=>{
      const stored=readSyncMeta(this.storage);if(stored?.id===this.meta.id)this.meta=stored;
      const start=structuredClone(this.getLocal()),diff=stateDiff(this.meta.baseline,start);
      const remote=await this.client.read(this.meta.id);
      // A single batch atomically appends the changes; unrelated IDs are untouched.
      await this.client.write(remote,diff);
      const saved=await this.client.read(this.meta.id);
      const during=stateDiff(start,this.getLocal());
      this.applyLocal(applyPatches(saved.state,during));
      const meta={...this.meta,title:saved.title,baseline:saved.state,lastSync:new Date().toISOString()};
      this.storage.setItem(META_KEY,JSON.stringify(meta));this.meta=meta;this.message='시트에 저장했어요.';
      if(during.length)this.schedule();return true;
    });
    return globalThis.navigator?.locks ? navigator.locks.request(`dear-wallet-sheet-${this.meta.id}`,work) : work();
  }
  disconnect(){if(this.busy)return;this.cancelTimer();this.storage.removeItem(META_KEY);this.meta=null;this.token='';this.expires=0;this.lastError='';this.message='이 기기에서 시트 연결을 해제했어요. 기록은 이 기기에 남아 있어요.';this.notify();}
}
export function mountSheetSync({getLocal,applyLocal,isDemo,isLocalReady,onApplied,onToast}) {
  const $=selector=>document.querySelector(selector);let preview=null,ready=false,preparing=false,authBusy=false;
  const sync=new SheetSync({getLocal,applyLocal:state=>{applyLocal(state);onApplied();},isDemo,isLocalReady,onChange:render});
  function render(){
    const meta=sync.meta,dirty=sync.dirty();
    $('#sheet-url').value=meta?.id || $('#sheet-url').value;
    $('#sheet-url').disabled=!!meta || sync.busy || authBusy;
    $('#google-connect').disabled=sync.busy || preparing || authBusy || isDemo();
    $('#google-connect').textContent=preparing?'구글 로그인 준비 중…':authBusy?'구글 로그인 중…':meta?'구글 로그인 · 동기화':'구글 로그인 · 시트 확인';
    $('#sheet-sync-now').hidden=!meta;$('#sheet-sync-now').disabled=sync.busy || !sync.authorized() || isDemo();
    $('#sheet-disconnect').hidden=!meta;$('#sheet-disconnect').disabled=sync.busy || authBusy;
    $('#sheet-preview').hidden=!preview;
    $('#sheet-adopt').disabled=sync.busy;$('#sheet-merge').disabled=sync.busy;
    if(preview)$('#sheet-preview-description').textContent=`‘${preview.title}’에서 지출·수입·이체 ${preview.state.entries.filter(e=>!e.deletedAt).length}건을 확인했어요. 이 기기 기록 ${getLocal().entries.filter(e=>!e.deletedAt).length}건은 별도로 보관한 뒤 연결해요.`;
    $('#sheet-status').textContent=isDemo()?'샘플 모드에서는 시트 동기화를 쉬어요.':sync.busy?'시트와 안전하게 동기화하는 중이에요…':sync.lastError || (meta?`${meta.title} · ${dirty?'이 기기에 저장됨 · 시트 저장 대기':sync.authorized()?'시트와 연결됨':'다시 로그인 필요'}${meta.lastSync?` · 마지막 동기화 ${new Date(meta.lastSync).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}`:''}`:sync.message || '구글 로그인 후 기존 시트를 확인해요.');
    $('#sheet-status').classList.toggle('sync-error',!!sync.lastError);
    $('#sync-banner').hidden=!meta || isDemo();
    $('#sync-banner-text').textContent=sync.busy?'시트와 동기화 중…':sync.lastError || (dirty?'이 기기에 저장했어요. 시트 저장을 기다리고 있어요.':sync.authorized()?`${meta?.title} · 시트 저장 완료`:'시트 동기화를 위해 구글에 다시 로그인해주세요.');
    $('.local-note').textContent=isDemo()?'샘플 기록은 시트에 저장되지 않아요.':meta?(dirty?'이 기기 저장 · 시트 저장 대기':sync.authorized()?'시트 저장 완료 · 이 기기에도 보관':'이 기기에 보관 · 구글 로그인 필요'):'기록은 이 브라우저에 보관돼요';
  }
  function refreshPeriodFields(){const form=$('#settings-form');form.elements.periodMode.value=getLocal().settings.periodMode;form.elements.payday.value=getLocal().settings.payday;$('#payday-label').hidden=getLocal().settings.periodMode!=='payday';}
  $('#sheet-url').addEventListener('input',()=>{preview=null;render();});
  async function prepare(){
    if(ready || preparing)return;preparing=true;render();
    try{await googleSDK();ready=true;}catch(error){sync.lastError=error.message;}finally{preparing=false;render();}
  }
  $('#google-connect').addEventListener('click',()=>{
    if(!ready){void prepare();return;}
    const id=spreadsheetId($('#sheet-url').value);if(!id){sync.lastError='구글 시트 주소나 ID를 확인해주세요.';render();return;}
    authBusy=true;render();
    const client=google.accounts.oauth2.initTokenClient({client_id:GOOGLE_CLIENT_ID,scope:SCOPE,include_granted_scopes:false,
      callback:async response=>{
        authBusy=false;
        if(response.error || !response.access_token){sync.lastError='구글 로그인 권한이 승인되지 않았어요. 다시 시도해주세요.';render();return;}
        sync.token=response.access_token;sync.expires=Date.now()+(Number(response.expires_in)||3600)*1000-30000;
        if(!google.accounts.oauth2.hasGrantedAllScopes(response,SCOPE)){sync.token='';sync.lastError='시트를 읽고 저장할 권한을 승인해주세요.';render();return;}
        if(sync.meta){if(await sync.sync())refreshPeriodFields();}else{preview=await sync.inspect(id);render();}
      },error_callback:()=>{authBusy=false;sync.lastError='로그인 창이 닫혔거나 차단됐어요. 다시 로그인해주세요.';render();}});
    try{client.requestAccessToken({prompt:'select_account'});}catch{authBusy=false;sync.lastError='구글 로그인 창을 열지 못했어요. 다시 시도해주세요.';render();}
  });
  for(const [id,merge] of [['sheet-adopt',false],['sheet-merge',true]])$( '#'+id).addEventListener('click',async()=>{
    if(preview && await sync.adopt(preview,merge)){preview=null;refreshPeriodFields();render();onToast('구글 시트에 연결했어요. 다른 기기에서도 같은 시트로 로그인해주세요.');}
  });
  $('#sheet-sync-now').addEventListener('click',async()=>{if(await sync.sync())refreshPeriodFields();});
  $('#sheet-disconnect').addEventListener('click',()=>{ $('#sheet-disconnect-confirm').hidden=false; });
  $('#sheet-keep-connection').addEventListener('click',()=>{$('#sheet-disconnect-confirm').hidden=true;});
  $('#sheet-confirm-disconnect').addEventListener('click',()=>{try{sync.disconnect();preview=null;$('#sheet-disconnect-confirm').hidden=true;render();}catch{sync.lastError='연결 설정을 지우지 못했어요. 브라우저 저장 권한을 확인해주세요.';render();}});
  $('#sync-settings').addEventListener('click',()=>{document.querySelector('.topbar [data-open=settings]').click();$('#sheet-status').scrollIntoView({block:'nearest'});});
  window.addEventListener('online',()=>{if(sync.authorized())void sync.sync();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden && sync.authorized() && sync.meta && !isDemo())void sync.sync();});
  window.addEventListener('storage',event=>{if(event.key===META_KEY){sync.meta=readSyncMeta(sync.storage);render();}});
  return {sync,prepare,render};
}

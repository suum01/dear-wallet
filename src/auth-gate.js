import { FIREBASE_CONFIG } from './firebase-config.js';
import { AccountStore, firebaseConfigured, loginError } from './account-store.js';

export function mountAuthGate({storage,onAccount,onClear,onDemo,onLegacy,onHome}) {
  const $=selector=>document.querySelector(selector);
  let provider=null,store=null,user=null,mode='login',returnMode='login',epoch=0,ready=false,loginBusy=false;
  const configured=firebaseConfigured(FIREBASE_CONFIG);
  function message(text,error=false){$('#login-status').textContent=text;$('#login-status').classList.toggle('login-error',error);}
  function display(next){
    mode=next;const app=['account','demo','legacy'].includes(next);
    $('#login-view').hidden=app;$('#app-shell').hidden=!app;$('#onboarding-view').hidden=next!=='onboarding';
    if(next==='onboarding'){$('#login-view').hidden=true;$('#app-shell').hidden=true;}
    $('#google-sign-in').disabled=!ready || loginBusy || next==='loading';
    $('#account-panel').hidden=next!=='account';$('#account-status-banner').hidden=next!=='account';$('.sheet-connection').hidden=next!=='legacy';
    $('#legacy-mode-banner').hidden=next!=='legacy';
    $('#retry-account').hidden=next!=='load-error';$('#login-sign-out').hidden=next!=='load-error';
    $('#session-sign-out').hidden=next!=='account';$('#return-login').hidden=next==='account';
    $('#account-email').textContent=next==='account'?(user?.email || ''):'';
    $('.skip-link').href=app?'#main':next==='onboarding'?'#onboarding-title':'#login-title';
    $('#account-identity').textContent=next==='account'?(user?.displayName || user?.email || '내 계정') : next==='demo'?'샘플 둘러보기':'이 기기 기록';
    if(!app)document.title=next==='onboarding'?'나에게 맞게 시작하기 — Dear Wallet':'로그인 — Dear Wallet';
  }
  function status(){
    if(!store || mode!=='account')return;
    const text=store.busy?'계정 기록을 동기화하고 있어요…':store.error || (store.pending()?'이 기기에 저장했어요 · 계정 저장 대기':'계정에 저장 완료');
    $('#account-sync-text').textContent=text;$('#account-sync-status').textContent=text;
    $('#account-sync').disabled=store.busy;$('#sync-banner').hidden=true;$('.local-note').textContent=text;
  }
  async function openAccount(nextUser){
    const request=++epoch;store?.stop();store=null;user=nextUser;
    if(!nextUser){onClear();display('login');message('폰에서도 컴퓨터에서도, 내 기록을 이어서 써요.');return;}
    onClear();display('loading');message('로그인됐어요. 내 기록을 불러오는 중이에요…');
    const nextStore=new AccountStore({uid:nextUser.uid,provider,storage,onApply:state=>{if(request===epoch)onAccount(state,nextStore);},onStatus:status});
    store=nextStore;
    try{
      const result=await store.initialize();if(request!==epoch || !result)return;
      loginBusy=false;
      if(result.onboardingComplete){display('account');onHome();status();}
      else{display('onboarding');$('#onboarding-form').elements.periodMode.value=nextStore.local.settings.periodMode;$('#onboarding-form').elements.payday.value=nextStore.local.settings.payday;$('#onboarding-payday').hidden=nextStore.local.settings.periodMode!=='payday';}
    }catch(error){if(request!==epoch)return;loginBusy=false;display('load-error');message(loginError(error),true);$('#retry-account').hidden=false;$('#login-sign-out').hidden=false;}
  }
  async function initialize(){
    if(!configured){ready=true;display('login');message('Google 로그인 연결을 준비 중이에요. 먼저 둘러보거나 이 기기의 기록을 열 수 있어요.');return;}
    message('로그인 상태를 확인하고 있어요…');
    try{
      const module=await import('./firebase-provider.js');provider=await module.createFirebaseProvider(FIREBASE_CONFIG);ready=true;if(!['legacy','demo'].includes(mode))display('login');
      provider.subscribe(nextUser=>{if(['demo','legacy'].includes(mode))return;void openAccount(nextUser);},error=>{ready=true;display('login');message(loginError(error),true);});
    }catch(error){ready=false;if(!['legacy','demo'].includes(mode))display('login');message(loginError(error),true);$('#retry-login-init').hidden=false;}
  }
  $('#google-sign-in').addEventListener('click',()=>{
    if(!provider){message('Google 로그인 서비스 연결 설정이 아직 완료되지 않았어요. 기존 기록은 그대로 보관돼요.',true);return;}
    if(loginBusy)return;
    loginBusy=true;$('#google-sign-in').disabled=true;message('구글 창에서 계정을 선택해주세요.');
    // Invoke the SDK directly in this user gesture so Safari can open its popup.
    try{Promise.resolve(provider.signIn()).then(result=>{if(result?.user && ['login','load-error'].includes(mode))void openAccount(result.user);}).catch(error=>{loginBusy=false;display('login');message(loginError(error),true);});}
    catch(error){loginBusy=false;display('login');message(loginError(error),true);}
  });
  function enterDemo(){returnMode=mode;if(mode!=='account'){++epoch;store?.stop();store=null;}display('demo');onDemo();onHome();}
  function exitDemo(){if(returnMode==='account' && store?.initialized){onAccount(store.local,store);display('account');onHome();status();}else if(returnMode==='legacy'){onLegacy();display('legacy');onHome();}else{onClear();display('login');message(configured?'Google 계정으로 내 기록을 이어서 써요.':'Google 로그인 연결을 준비 중이에요. 먼저 둘러보거나 이 기기의 기록을 열 수 있어요.');}}
  $('#preview-app').addEventListener('click',enterDemo);
  $('#legacy-entry').addEventListener('click',()=>{try{sessionStorage.setItem('dear-wallet.local-mode','legacy');}catch{}++epoch;store?.stop();store=null;display('legacy');onLegacy();onHome();});
  async function logout(){
    try{sessionStorage.removeItem('dear-wallet.local-mode');}catch{}++epoch;store?.stop();store=null;user=null;loginBusy=false;
    document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());onClear();display('login');message('로그아웃했어요. 기록은 계정과 이 기기에 보관돼요.');
    try{await provider?.signOut();}catch(error){message(loginError(error),true);}
  }
  $('#session-sign-out').addEventListener('click',()=>void logout());
  $('#login-sign-out').addEventListener('click',()=>void logout());
  $('#return-login').addEventListener('click',()=>{try{sessionStorage.removeItem('dear-wallet.local-mode');}catch{}++epoch;onClear();display('login');message('Google 계정으로 내 가계부를 이어서 써요.');});
  $('#retry-account').addEventListener('click',()=>{if(user)void openAccount(user);});
  $('#retry-login-init').addEventListener('click',()=>{ $('#retry-login-init').hidden=true;void initialize(); });
  $('#account-sync').addEventListener('click',()=>void store?.sync());
  $('#onboarding-form').elements.periodMode.addEventListener('change',event=>{$('#onboarding-payday').hidden=event.target.value!=='payday';});
  for(let i=1;i<=31;i++)$('#onboarding-form').elements.payday.add(new Option(`매월 ${i}일`,i));
  async function finish(settings){
    const button=$('#onboarding-submit');button.disabled=true;$('#onboarding-error').textContent='';
    try{if(await store.finishOnboarding(settings)){display('account');onHome();status();}}
    catch(error){$('#onboarding-error').textContent=loginError(error);}finally{button.disabled=false;}
  }
  $('#onboarding-form').addEventListener('submit',event=>{event.preventDefault();void finish({periodMode:event.currentTarget.elements.periodMode.value,payday:Number(event.currentTarget.elements.payday.value)});});
  $('#onboarding-later').addEventListener('click',()=>void finish({periodMode:'calendar',payday:25}));
  $('#onboarding-sign-out').addEventListener('click',()=>void logout());
  window.addEventListener('online',()=>{if(mode==='account')void store?.sync();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden && mode==='account')void store?.sync();});
  window.addEventListener('storage',event=>{if(store && event.key===`dear-wallet.account.${encodeURIComponent(store.uid)}.v1` && mode==='account')void store.sync();});
  for(const button of document.querySelectorAll('[data-login-info]'))button.addEventListener('click',()=>{
    const privacy=button.dataset.loginInfo==='privacy';$('#login-info-title').textContent=privacy?'개인정보 안내':'이용 안내';
    $('#login-info-body').textContent=privacy?'Google 로그인에는 계정 식별자와 기본 프로필을 사용해요. Google 비밀번호는 이 앱이 받지 않아요. 연결된 계정 기록은 해당 계정으로만 접근하도록 저장하고, 이 기기에도 복사본을 보관해요. 샘플 둘러보기는 실제 계정 기록을 사용하지 않아요. AI 자동 분류를 선택하면 사용처·내용·거래 종류를 Google AI에 보내요. 금액·계좌정보·지출 이유·과거 기록은 보내지 않아요.':'개인 지출과 예산을 기록하고 돌아보는 서비스예요. 로그인한 계정의 기록과 이 기기 기존 기록은 자동으로 합치지 않아요. 중요한 기록은 설정에서 파일로 내보내 보관할 수 있어요.';
    $('#login-info-dialog').showModal();
  });
  $('#login-info-dialog [data-close]').addEventListener('click',()=>$('#login-info-dialog').close());
  display('login');void initialize();
  try{if(sessionStorage.getItem('dear-wallet.local-mode')==='legacy')$('#legacy-entry').click();}catch{}
  return {get mode(){return mode;},get store(){return store;},get aiAvailable(){return mode==='account' && typeof provider?.classifyWithAI==='function';},async classifyWithAI(input){if(mode!=='account' || !user || !provider?.classifyWithAI)throw new Error('AI 분류는 Google 로그인 후 사용할 수 있어요.');const request=epoch;const result=await provider.classifyWithAI(input);if(request!==epoch || mode!=='account')throw new Error('로그인 상태가 바뀌었어요.');return result;},status,enterDemo,exitDemo,showLogin(){++epoch;onClear();display('login');},showApp(){if(user && store?.initialized)display('account');else display('legacy');}};
}

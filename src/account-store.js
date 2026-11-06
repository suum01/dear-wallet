import { emptyState, parseState } from './domain.js';
import { stateDiff, applyPatches } from './sheets.js';
export const accountCacheKey=uid=>`dear-wallet.account.${encodeURIComponent(uid)}.v1`;
export function firebaseConfigured(config){return !!config && ['apiKey','authDomain','projectId','appId'].every(key=>typeof config[key]==='string' && config[key].trim() && !config[key].includes('YOUR_'));}
export function loginError(error){
  const code=error?.code || '';
  if(['auth/popup-closed-by-user','auth/cancelled-popup-request'].includes(code))return '로그인을 취소했어요. 원할 때 다시 시작할 수 있어요.';
  if(code==='auth/popup-blocked')return '로그인 창이 차단됐어요. Safari나 Chrome에서 팝업을 허용하고 다시 눌러주세요.';
  if(code==='auth/unauthorized-domain')return '이 웹 주소의 Google 로그인이 아직 허용되지 않았어요. 관리자 설정이 필요해요.';
  if(['auth/operation-not-allowed','auth/configuration-not-found','auth/invalid-api-key'].includes(code))return 'Google 로그인 서비스 설정이 아직 완료되지 않았어요.';
  if(['permission-denied','firestore/permission-denied'].includes(code))return '계정 기록에 접근하지 못했어요. 데이터베이스 접근 설정을 확인해야 해요.';
  if(code==='auth/network-request-failed' || ['unavailable','firestore/unavailable'].includes(code))return '연결이 원활하지 않아요. 인터넷을 확인하고 다시 시도해주세요.';
  return error?.message && !code ? error.message : '로그인하거나 기록을 불러오지 못했어요. 다시 시도해주세요.';
}
export class AccountStore {
  constructor({uid,provider,storage,onApply=()=>{},onStatus=()=>{}}){this.uid=uid;this.provider=provider;this.storage=storage;this.onApply=onApply;this.onStatus=onStatus;this.local=emptyState();this.baseline=emptyState();this.active=true;this.busy=false;this.error='';this.initialized=false;}
  readCache(){
    const raw=this.storage.getItem(accountCacheKey(this.uid));if(raw===null)return null;
    let cache;try{cache=JSON.parse(raw);}catch{throw new Error('이 기기의 계정 기록을 확인하지 못했어요. 원본을 유지한 채 불러오기를 멈췄어요.');}
    if(cache?.version!==1 || !parseState(JSON.stringify(cache.state)) || !parseState(JSON.stringify(cache.baseline)))throw new Error('이 기기의 계정 기록을 확인하지 못했어요. 기존 기록을 보존한 채 불러오기를 멈췄어요.');
    return cache;
  }
  cache(state,baseline){
    this.storage.setItem(accountCacheKey(this.uid),JSON.stringify({version:1,state,baseline}));
    this.local=structuredClone(state);this.baseline=structuredClone(baseline);
    if(this.active)this.onApply(this.local);
  }
  pending(){return stateDiff(this.baseline,this.local).length>0;}
  async initialize(){
    const cached=this.readCache(),remote=await this.provider.read(this.uid);if(!this.active)return null;
    const pending=cached?stateDiff(cached.baseline,cached.state):[];
    if(pending.length){await this.provider.write(this.uid,pending);if(!this.active)return null;const saved=await this.provider.read(this.uid);if(!this.active)return null;this.cache(saved.state,saved.state);}else this.cache(remote.state,remote.state);
    this.initialized=true;this.onStatus(this);return {onboardingComplete:remote.onboardingComplete};
  }
  save(state){
    if(!this.active || !this.initialized)throw new Error('로그인 상태를 확인해주세요.');
    if(!parseState(JSON.stringify(state)))throw new Error('기록 형식을 확인해주세요.');
    this.cache(state,this.baseline);this.error='';this.onStatus(this);this.schedule();
  }
  schedule(){clearTimeout(this.timer);if(this.active)this.timer=setTimeout(()=>void this.sync(),800);}
  async sync(){
    clearTimeout(this.timer);if(!this.active || !this.initialized)return false;
    const run=async()=>{
      if(!this.active || this.busy)return false;this.busy=true;this.error='';this.onStatus(this);
      try{
        const cache=this.readCache();if(cache){this.local=cache.state;this.baseline=cache.baseline;}
        const start=structuredClone(this.local),patches=stateDiff(this.baseline,start);
        await this.provider.write(this.uid,patches);if(!this.active)return false;
        const remote=await this.provider.read(this.uid);if(!this.active)return false;
        const latestCache=this.readCache(),during=stateDiff(start,latestCache?.state || this.local);
        this.cache(applyPatches(remote.state,during),remote.state);if(during.length)this.schedule();return true;
      }catch(error){this.error=loginError(error);return false;}finally{this.busy=false;if(this.active)this.onStatus(this);}
    };
    return globalThis.navigator?.locks?navigator.locks.request(`dear-wallet-account-${this.uid}`,run):run();
  }
  async finishOnboarding(settings){
    await this.provider.completeOnboarding(this.uid,settings);if(!this.active)return false;
    const next=structuredClone(this.local);next.settings={...next.settings,...settings};this.cache(next,{...this.baseline,settings:{...this.baseline.settings,...settings}});this.onStatus(this);return true;
  }
  stop(){this.active=false;clearTimeout(this.timer);}
}

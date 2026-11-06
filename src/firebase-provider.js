import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, getDocsFromServer, getDocFromServer, writeBatch, serverTimestamp, query, where } from 'firebase/firestore';
import { emptyState, parseState } from './domain.js';
import { applyPatches } from './sheets.js';

export async function createFirebaseProvider(config) {
  const app=initializeApp(config),auth=getAuth(app),db=getFirestore(app);
  await setPersistence(auth,browserLocalPersistence);
  const google=new GoogleAuthProvider();google.setCustomParameters({prompt:'select_account'});
  const cache=new Map();
  const wallet=uid=>collection(db,'users',uid,'wallet');
  const account=uid=>doc(db,'users',uid,'account','profile');
  function changeRef(uid,patch){return doc(wallet(uid),`${patch.table}__${encodeURIComponent(patch.key)}`);}
  return {
    subscribe(callback,onError){return onAuthStateChanged(auth,callback,onError);},
    signIn(){return signInWithPopup(auth,google);},
    signOut(){cache.clear();return signOut(auth);},
    async read(uid){
      const previous=cache.get(uid);
      const source=previous?.cursor?query(wallet(uid),where('savedAt','>=',previous.cursor)):wallet(uid);
      const [snapshot,profile]=await Promise.all([getDocsFromServer(source),previous?Promise.resolve(null):getDocFromServer(account(uid))]);
      const patches=snapshot.docs.map(row=>row.data());
      for(const patch of patches)if(!['entries','budgets','fixedCosts','settings'].includes(patch.table) || typeof patch.key!=='string')throw new Error('저장된 기록의 형식을 확인하지 못했어요. 기존 기록은 바꾸지 않았어요.');
      const state=applyPatches(previous?.state || emptyState(),patches);
      let cursor=previous?.cursor || null;
      for(const patch of patches){const time=patch.savedAt;if(time && typeof time.seconds==='number' && (!cursor || time.seconds>cursor.seconds || (time.seconds===cursor.seconds && time.nanoseconds>cursor.nanoseconds)))cursor=time;}
      if(!parseState(JSON.stringify(state)))throw new Error('저장된 기록의 형식을 확인하지 못했어요. 기존 기록은 바꾸지 않았어요.');
      const onboardingComplete=profile?profile.exists() && profile.data().onboardingComplete===true:previous.onboardingComplete;
      cache.set(uid,{state:structuredClone(state),cursor,onboardingComplete});
      return {state,onboardingComplete};
    },
    async write(uid,patches){
      for(let offset=0;offset<patches.length;offset+=400){
        const batch=writeBatch(db);
        for(const patch of patches.slice(offset,offset+400))batch.set(changeRef(uid,patch),{table:patch.table,key:patch.key,value:patch.value,savedAt:serverTimestamp()});
        await batch.commit();
      }
    },
    async completeOnboarding(uid,settings){
      const batch=writeBatch(db);
      for(const key of ['periodMode','payday'])batch.set(changeRef(uid,{table:'settings',key}),{table:'settings',key,value:settings[key],savedAt:serverTimestamp()});
      batch.set(account(uid),{onboardingComplete:true,updatedAt:serverTimestamp()},{merge:true});
      await batch.commit();
      if(cache.has(uid))cache.get(uid).onboardingComplete=true;
    }
  };
}

import {firebaseConfig} from './firebase-config.js';
export const devMode=firebaseConfig.apiKey.startsWith('YOUR');
const V='https://www.gstatic.com/firebasejs/10.12.2/';
let fb,auth;
async function load(){
  if(devMode||fb)return;
  fb={...await import(V+'firebase-app.js'),...await import(V+'firebase-auth.js')};
  auth=fb.getAuth(fb.initializeApp(firebaseConfig));await auth.authStateReady();
}
export async function signIn(email,pw){await load();if(devMode){localStorage.setItem('sc_dev',email.toLowerCase());return;}await fb.signInWithEmailAndPassword(auth,email,pw);}
export async function google(){await load();if(devMode)throw new Error('Google sign-in needs Firebase setup (see README).');const p=new fb.GoogleAuthProvider();p.setCustomParameters({hd:'bitsathy.ac.in'});await fb.signInWithPopup(auth,p);}
export async function reset(email){await load();if(devMode)throw new Error('Password reset needs Firebase setup (see README).');await fb.sendPasswordResetEmail(auth,email);}
export async function getToken(){await load();if(devMode){const e=localStorage.getItem('sc_dev');return e?'dev:'+e:null;}return auth.currentUser?auth.currentUser.getIdToken():null;}
export async function requireLogin(){const t=await getToken();if(!t)location.replace('/login.html?next='+encodeURIComponent(location.pathname+location.search));return t;}
export async function signOutUser(){await load();if(devMode)localStorage.removeItem('sc_dev');else await fb.signOut(auth);location.replace('/login.html');}
export async function enablePush(post){
  if(devMode||!('serviceWorker' in navigator)||!('Notification' in window))return;
  try{
    const m=await import(V+'firebase-messaging.js');
    const reg=await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    if(await Notification.requestPermission()!=='granted')return;
    const token=await m.getToken(m.getMessaging(fb.getApp()),{vapidKey:firebaseConfig.vapidKey,serviceWorkerRegistration:reg});
    await post(token);
  }catch(e){console.warn('Push not enabled',e);}
}
export async function api(p,o={}){
  const t=await getToken();
  const r=await fetch('/api'+p,{method:o.method||'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:o.body?JSON.stringify(o.body):undefined});
  const d=await r.json().catch(()=>({}));
  if(r.status===401){await signOutUser();}
  if(!r.ok)throw new Error(d.error||'Something went wrong');return d;
}

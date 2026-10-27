
import { firebaseConfig } from './firebase-config.js';

const VERSION = 'https://www.gstatic.com/firebasejs/10.12.2/';

let app;
let auth;
let firebase;

async function loadFirebase() {
  if (auth) return;

  firebase = {
    ...(await import(VERSION + 'firebase-app.js')),
    ...(await import(VERSION + 'firebase-auth.js'))
  };

  app = firebase.initializeApp(firebaseConfig);
  auth = firebase.getAuth(app);
}

export async function signUp(email, password) {
  await loadFirebase();

  if (!email.toLowerCase().endsWith('@bitsathy.ac.in')) {
    throw new Error('Use your @bitsathy.ac.in college email.');
  }

  const result = await firebase.createUserWithEmailAndPassword(
    auth,
    email,
    password
  );

  await firebase.sendEmailVerification(result.user);
  await firebase.signOut(auth);

  return result;
}

export async function signIn(email, password) {
  await loadFirebase();

  const result = await firebase.signInWithEmailAndPassword(
    auth,
    email,
    password
  );

  if (!result.user.emailVerified) {
    await firebase.signOut(auth);
    throw new Error('Please verify your email first. Check your inbox.');
  }

  return result;
}

export async function google() {
  await loadFirebase();

  const provider = new firebase.GoogleAuthProvider();
  provider.setCustomParameters({ hd: 'bitsathy.ac.in' });

  const result = await firebase.signInWithPopup(auth, provider);

  if (!result.user.email.toLowerCase().endsWith('@bitsathy.ac.in')) {
    await firebase.signOut(auth);
    throw new Error('Use your college Google account.');
  }

  return result;
}

export async function reset(email) {
  await loadFirebase();
  return firebase.sendPasswordResetEmail(auth, email);
}

export async function getToken() {
  await loadFirebase();

  await auth.authStateReady();

  return auth.currentUser
    ? auth.currentUser.getIdToken()
    : null;
}


import { firebaseConfig } from './firebase-config.js';

export const devMode = firebaseConfig.apiKey.startsWith('YOUR');

const V = 'https://www.gstatic.com/firebasejs/10.12.2/';
let fb, auth, app;

async function load() {
  if (devMode || fb) return;

  fb = {
    ...await import(V + 'firebase-app.js'),
    ...await import(V + 'firebase-auth.js')
  };

  app = fb.initializeApp(firebaseConfig);
  auth = fb.getAuth(app);
  await auth.authStateReady();
}

// Check college email
export function isCollegeEmail(email) {
  return /^[^\s@]+@bitsathy\.ac\.in$/i.test(email.trim());
}

// Create a new student account
export async function signUp(email, password) {
  await load();

  email = email.trim().toLowerCase();

  if (!isCollegeEmail(email)) {
    throw new Error('Use your @bitsathy.ac.in college email.');
  }

  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }

  if (devMode) {
    throw new Error('Real registration requires Firebase configuration.');
  }

  const result = await fb.createUserWithEmailAndPassword(
    auth, email, password
  );

  await fb.sendEmailVerification(result.user);

  await fb.signOut(auth);

  return {
    message: 'Verification email sent. Verify your email before signing in.'
  };
}

// Sign in existing student
export async function signIn(email, password) {
  await load();

  email = email.trim().toLowerCase();

  if (!isCollegeEmail(email)) {
    throw new Error('Use your @bitsathy.ac.in college email.');
  }

  if (devMode) {
    throw new Error('Please configure Firebase first.');
  }

  const result = await fb.signInWithEmailAndPassword(
    auth, email, password
  );

  if (!result.user.emailVerified) {
    await fb.signOut(auth);
    throw new Error('Verify your college email first. Check your inbox.');
  }

  return result;
}

// Google sign-in
export async function google() {
  await load();

  if (devMode) {
    throw new Error('Please configure Firebase first.');
  }

  const provider = new fb.GoogleAuthProvider();
  provider.setCustomParameters({ hd: 'bitsathy.ac.in' });

  const result = await fb.signInWithPopup(auth, provider);

  if (
    !result.user.email?.toLowerCase().endsWith('@bitsathy.ac.in') ||
    !result.user.emailVerified
  ) {
    await fb.signOut(auth);
    throw new Error('Use a verified @bitsathy.ac.in Google account.');
  }

  return result;
}

// Forgot password
export async function reset(email) {
  await load();

  email = email.trim().toLowerCase();

  if (!isCollegeEmail(email)) {
    throw new Error('Enter your @bitsathy.ac.in college email.');
  }

  if (devMode) {
    throw new Error('Please configure Firebase first.');
  }

  await fb.sendPasswordResetEmail(auth, email);
}

// Current login token
export async function getToken() {
  await load();

  if (devMode) {
    const email = localStorage.getItem('sc_dev');
    return email ? 'dev:' + email : null;
  }

  return auth.currentUser
    ? auth.currentUser.getIdToken()
    : null;
}

// Require login
export async function requireLogin() {
  const token = await getToken();

  if (!token) {
    const base = location.pathname.includes('/Smart_campus_bit/')
      ? '/Smart_campus_bit/'
      : '/';

    location.replace(
      base + 'login.html?next=' +
      encodeURIComponent(location.pathname + location.search)
    );
  }

  return token;
}

// Sign out
export async function signOutUser() {
  await load();

  if (devMode) {
    localStorage.removeItem('sc_dev');
  } else {
    await fb.signOut(auth);
  }

  const base = location.pathname.includes('/Smart_campus_bit/')
    ? '/Smart_campus_bit/'
    : '/';

  location.replace(base + 'login.html');
}

// Push notifications (optional)
export async function enablePush(post) {
  if (
    devMode ||
    !('serviceWorker' in navigator) ||
    !('Notification' in window)
  ) return;

  try {
    const messaging = await import(V + 'firebase-messaging.js');

    const base = location.pathname.includes('/Smart_campus_bit/')
      ? '/Smart_campus_bit/'
      : '/';

    const registration = await navigator.serviceWorker.register(
      base + 'firebase-messaging-sw.js'
    );

    if (await Notification.requestPermission() !== 'granted') return;

    const token = await messaging.getToken(
      messaging.getMessaging(app),
      {
        vapidKey: firebaseConfig.vapidKey,
        serviceWorkerRegistration: registration
      }
    );

    await post(token);
  } catch (error) {
    console.warn('Push not enabled', error);
  }
}

// Backend API
export async function api(path, options = {}) {
  const token = await getToken();

  const response = await fetch('/api' + path, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
    body: options.body
      ? JSON.stringify(options.body)
      : undefined
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Something went wrong');
  }

  return data;
}

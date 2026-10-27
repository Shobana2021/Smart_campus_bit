importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js','https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
// Use the same values as js/firebase-config.js
firebase.initializeApp({apiKey:"YOUR_API_KEY",authDomain:"YOUR_PROJECT.firebaseapp.com",projectId:"YOUR_PROJECT",messagingSenderId:"YOUR_SENDER_ID",appId:"YOUR_APP_ID"});
firebase.messaging().onBackgroundMessage(p=>self.registration.showNotification(p.notification.title,{body:p.notification.body}));

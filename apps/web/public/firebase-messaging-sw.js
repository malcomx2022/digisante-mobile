/* Service worker Firebase Cloud Messaging — notifications push en arrière-plan.
 * La config Firebase (PUBLIQUE) est passée en paramètres d'URL à l'enregistrement,
 * car un service worker ne lit pas process.env. Distinct du SW PWA (sw.js) :
 * il opère sur le scope /firebase-cloud-messaging-push-scope.
 */
/* eslint-disable */
importScripts('https://www.gstatic.com/firebasejs/12.14.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.14.0/firebase-messaging-compat.js');

const params = new URL(self.location).searchParams;
const config = {
  apiKey: params.get('apiKey'),
  authDomain: params.get('authDomain'),
  projectId: params.get('projectId'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
};

if (config.apiKey && config.projectId && config.messagingSenderId) {
  firebase.initializeApp(config);
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const title = (payload.notification && payload.notification.title) || 'DigiSanté';
    const body = (payload.notification && payload.notification.body) || '';
    self.registration.showNotification(title, { body, icon: '/icon.svg', badge: '/icon.svg' });
  });
}

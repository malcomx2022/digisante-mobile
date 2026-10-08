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

// WHATWG normalise les antislashs comme des slashs : contrôler l'origine APRÈS
// parsing, et refuser les séparateurs encodés/contrôles avant toute navigation.
function internalLink(raw) {
  if (typeof raw !== 'string' || !/^\/(?!\/)/.test(raw) || /[\\\u0000-\u0020]|%(?:2f|5c)/i.test(raw)) return '/';
  try {
    const url = new URL(raw, self.location.origin);
    return url.origin === self.location.origin ? url.pathname + url.search + url.hash : '/';
  } catch { return '/'; }
}

if (config.apiKey && config.projectId && config.messagingSenderId) {
  firebase.initializeApp(config);
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const title = (payload.notification && payload.notification.title) || 'DigiSanté';
    const body = (payload.notification && payload.notification.body) || '';
    // `link` (données du message) = page à ouvrir au clic ; défaut : l'accueil.
    const link = internalLink(payload.data && payload.data.link);
    self.registration.showNotification(title, { body, icon: '/icon-192.png', badge: '/icon-192.png', data: { link } });
  });
}

// Clic sur une notification : ramène au premier plan un onglet de l'app déjà ouvert,
// sinon en ouvre un. Seuls les chemins INTERNES sont suivis (jamais une URL externe
// qu'un message aurait pu porter).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.link) || '/';
  const target = internalLink(raw);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          return Promise.resolve('navigate' in client ? client.navigate(target) : undefined).then(() => client.focus());
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

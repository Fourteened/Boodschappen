// Minimal service worker: makes the app installable and is the place
// where push notifications (reminders, Picnic delivery updates) will live.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

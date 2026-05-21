// Service Worker — Food Waste Tracker
// Handles push notifications and daily expiry checks

const CACHE_NAME = "fwt-v1";

self.addEventListener("install", e => {
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(clients.claim());
});

// Handle push notifications from server (future use)
self.addEventListener("push", e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || "Food Waste Tracker", {
      body: data.body || "Check your food tracker!",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "food-reminder",
      renotify: true,
      data: { url: "/" }
    })
  );
});

// Handle notification click — open the app
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow("/");
    })
  );
});

// Daily alarm via periodic sync (where supported)
self.addEventListener("periodicsync", e => {
  if (e.tag === "daily-check") {
    e.waitUntil(checkExpiry());
  }
});

// Message from app to trigger check immediately
self.addEventListener("message", e => {
  if (e.data === "CHECK_EXPIRY") {
    checkExpiry();
  }
});

async function checkExpiry() {
  // Read items from IndexedDB (written by the app)
  try {
    const items = await getItemsFromDB();
    if (!items || items.length === 0) return;

    const today = new Date(); today.setHours(0,0,0,0);
    const expiring = items.filter(item => {
      const expiry = new Date(item.expiry); expiry.setHours(0,0,0,0);
      const days = Math.round((expiry - today) / 86400000);
      return days >= 0 && days <= 2;
    });

    if (expiring.length === 0) return;

    const lines = expiring.map(item => {
      const expiry = new Date(item.expiry); expiry.setHours(0,0,0,0);
      const days = Math.round((expiry - today) / 86400000);
      const when = days === 0 ? "today!" : days === 1 ? "tomorrow" : "in 2 days";
      return `${item.name} — use ${when}`;
    });

    const title = expiring.length === 1
      ? `⚠️ 1 item expiring soon`
      : `⚠️ ${expiring.length} items expiring soon`;

    await self.registration.showNotification(title, {
      body: lines.join("\n"),
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "food-reminder",
      renotify: true,
      data: { url: "/" }
    });
  } catch (err) {
    console.error("SW check error:", err);
  }
}

function getItemsFromDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("FoodWasteTracker", 1);
    req.onerror = () => resolve([]);
    req.onsuccess = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("items")) { resolve([]); return; }
      const tx = db.transaction("items", "readonly");
      const store = tx.objectStore("items");
      const all = store.getAll();
      all.onsuccess = () => resolve(all.result || []);
      all.onerror = () => resolve([]);
    };
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore("items", { keyPath: "id" });
    };
  });
}

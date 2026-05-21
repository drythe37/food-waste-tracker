// Notification & Service Worker helpers

// Register service worker
export async function registerSW() {
  if (!("serviceWorker" in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    console.log("SW registered:", reg.scope);
    return reg;
  } catch (e) {
    console.error("SW registration failed:", e);
    return false;
  }
}

// Request notification permission
export async function requestNotificationPermission() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  const result = await Notification.requestPermission();
  return result;
}

// Schedule daily check using setTimeout (works while app is open)
// and periodic background sync (where supported, works when closed)
export async function scheduleDailyCheck(reg) {
  if (!reg) return;

  // Try periodic background sync (Android Chrome supports this)
  if ("periodicSync" in reg) {
    try {
      const status = await navigator.permissions.query({ name: "periodic-background-sync" });
      if (status.state === "granted") {
        await reg.periodicSync.register("daily-check", { minInterval: 24 * 60 * 60 * 1000 });
        console.log("Periodic sync registered");
      }
    } catch (e) {
      console.log("Periodic sync not available, using fallback");
    }
  }

  // Fallback: schedule check via setTimeout when app is open
  scheduleNextCheck();
}

function scheduleNextCheck() {
  const now = new Date();
  const next8am = new Date();
  next8am.setHours(8, 0, 0, 0);
  if (now >= next8am) next8am.setDate(next8am.getDate() + 1);
  const msUntil8am = next8am - now;

  setTimeout(() => {
    triggerCheck();
    // Re-schedule for tomorrow
    setInterval(triggerCheck, 24 * 60 * 60 * 1000);
  }, msUntil8am);

  console.log(`Next check in ${Math.round(msUntil8am / 60000)} mins`);
}

function triggerCheck() {
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage("CHECK_EXPIRY");
  }
}

// Write items to IndexedDB so the service worker can read them
export function syncItemsToDB(items) {
  if (!("indexedDB" in window)) return;
  const req = indexedDB.open("FoodWasteTracker", 1);
  req.onupgradeneeded = e => {
    e.target.result.createObjectStore("items", { keyPath: "id" });
  };
  req.onsuccess = e => {
    const db = e.target.result;
    const tx = db.transaction("items", "readwrite");
    const store = tx.objectStore("items");
    store.clear();
    items.forEach(item => store.put(item));
  };
}

// Send an immediate test notification
export async function sendTestNotification() {
  if (Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification("🥦 Food Waste Tracker", {
    body: "Notifications are working! You'll be reminded 2 days before anything expires.",
    icon: "/icon-192.png",
    tag: "test",
  });
  return true;
}

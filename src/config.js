// ============================================================
// STEP 1: Replace these values with your Firebase project config
// Get them from: Firebase Console → Project Settings → Your Apps
// ============================================================
export const firebaseConfig = {
  apiKey: "PASTE_YOUR_FIREBASE_API_KEY_HERE",
  authDomain: "PASTE_YOUR_AUTH_DOMAIN_HERE",
  projectId: "PASTE_YOUR_PROJECT_ID_HERE",
  storageBucket: "PASTE_YOUR_STORAGE_BUCKET_HERE",
  messagingSenderId: "PASTE_YOUR_MESSAGING_SENDER_ID_HERE",
  appId: "PASTE_YOUR_APP_ID_HERE"
};

// ============================================================
// STEP 2: Replace with your Google OAuth Client ID
// Get it from: Google Cloud Console → APIs & Services → Credentials
// Make sure Google Calendar API is enabled in your project
// ============================================================
export const GOOGLE_CLIENT_ID = "PASTE_YOUR_GOOGLE_CLIENT_ID_HERE";

// ============================================================
// App settings — these are already configured for you
// ============================================================
export const APP_SETTINGS = {
  reminderDaysBefore: 2,
  householdEmails: [
    "ryan.sinclair3790@gmail.com",
    "robynaimee23@gmail.com"
  ]
};

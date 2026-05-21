# Food Waste Tracker — Setup Guide
## Everything you need to do, step by step

---

## STEP 1 — Create a Firebase Project (5 mins)

1. Go to **https://console.firebase.google.com**
2. Click **"Add project"** → name it `food-waste-tracker` → Continue
3. Disable Google Analytics (you don't need it) → **Create project**
4. Once created, click the **web icon (</>)** to add a web app
5. Name it `food-waste-tracker` → click **Register app**
6. You'll see a block of config that looks like this:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "food-waste-tracker-xxxx.firebaseapp.com",
  projectId: "food-waste-tracker-xxxx",
  ...
};
```

7. **Copy all of those values** into `src/config.js` — replace the PASTE_YOUR_... placeholders

### Enable Google Sign-In:
- In Firebase Console → **Authentication** → Get started → **Google** → Enable → Save

### Enable Firestore Database:
- In Firebase Console → **Firestore Database** → Create database
- Choose **"Start in production mode"** → select `europe-west2` (London) → Enable
- Go to **Rules** tab → paste this and click Publish:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /items/{item} {
      allow read, write: if request.auth != null;
    }
  }
}
```

---

## STEP 2 — Set up Google Calendar API (5 mins)

1. Go to **https://console.cloud.google.com**
2. Select the same project (or create a new one)
3. Go to **APIs & Services** → **Library**
4. Search for **"Google Calendar API"** → click it → **Enable**
5. Go to **APIs & Services** → **Credentials**
6. Click **"+ Create Credentials"** → **OAuth client ID**
7. Application type: **Web application**
8. Name: `Food Waste Tracker`
9. Under **Authorised JavaScript origins** add:
   - `http://localhost:3000` (for testing)
   - `https://YOUR-APP-NAME.vercel.app` (add this after deploying)
10. Click **Create** → copy the **Client ID**
11. Paste it into `src/config.js` replacing `PASTE_YOUR_GOOGLE_CLIENT_ID_HERE`

---

## STEP 3 — Put the code on GitHub (2 mins)

1. Go to **https://github.com** → sign in (or create free account)
2. Click **"New repository"** → name it `food-waste-tracker` → Create
3. Upload all the project files (drag and drop the folder contents)

---

## STEP 4 — Deploy to Vercel (2 mins)

1. Go to **https://vercel.com** → sign in with GitHub
2. Click **"Add New Project"** → import your `food-waste-tracker` repo
3. Leave all settings as default → click **Deploy**
4. Vercel will give you a URL like `https://food-waste-tracker-xxxx.vercel.app`
5. **Copy that URL** and go back to Google Cloud Console → add it to the Authorised JavaScript origins (Step 2, point 9)

---

## STEP 5 — Install on your phones

**On iPhone (Safari):**
1. Open the app URL in Safari
2. Tap the Share button (box with arrow)
3. Scroll down → tap **"Add to Home Screen"**
4. Tap **Add** — it'll appear as an app icon

**On Android (Chrome):**
1. Open the app URL in Chrome
2. Tap the three-dot menu
3. Tap **"Add to Home screen"** or **"Install app"**

Both Ryan and Robyn install it separately and sign in with their own Google accounts.

---

## Total ongoing costs: £0
- Firebase free tier: more than enough for household use
- Vercel free tier: no limits for personal projects
- Google Calendar API: free

---

## Need help?
Just paste any error messages into Claude and it'll help you fix them.

import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { firebaseConfig } from "./config";

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Request Google Calendar scope at sign-in
googleProvider.addScope("https://www.googleapis.com/auth/calendar.events");

export const db = getFirestore(app);

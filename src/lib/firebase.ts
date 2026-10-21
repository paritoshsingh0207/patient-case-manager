import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
const appCheckSiteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
export const firebaseReady = Object.values(firebaseConfig).every(Boolean);
let app: FirebaseApp | undefined;
let appCheck: AppCheck | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
if (firebaseReady) {
  app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  if (appCheckSiteKey && typeof window !== 'undefined') {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }
  auth = getAuth(app);
  db = getFirestore(app);
}
export { app, appCheck, auth, db };

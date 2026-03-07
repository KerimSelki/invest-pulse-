import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut, onAuthStateChanged, signInAnonymously, updateProfile } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBMVZE8a6PLfpuWclSKG8LtCpxQdLXS7Ac",
  authDomain: "invest-pulse-42016.firebaseapp.com",
  projectId: "invest-pulse-42016",
  storageBucket: "invest-pulse-42016.firebasestorage.app",
  messagingSenderId: "968723860951",
  appId: "1:968723860951:web:1de1d8e8f0d8cf7ddb0f92",
  measurementId: "G-781R7ZS1BC"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export const loginWithEmail = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const registerWithEmail = (email, password) => createUserWithEmailAndPassword(auth, email, password);
export const loginWithGoogle = () => signInWithPopup(auth, googleProvider);
export const loginAsGuest = () => signInAnonymously(auth);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email);
export const logoutUser = () => signOut(auth);
export const onAuthChange = (callback) => onAuthStateChanged(auth, callback);
export { updateProfile };

export const getUserData = async (uid) => {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() ? snap.data() : null;
  } catch (e) { console.error("getUserData:", e); return null; }
};

export const saveUserData = async (uid, data) => {
  try {
    await setDoc(doc(db, "users", uid), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
    return true;
  } catch (e) { console.error("saveUserData:", e); return false; }
};

export const savePortfolios = async (uid, portfolios, sections) => {
  try {
    await setDoc(doc(db, "users", uid), { portfolios, sections, updatedAt: new Date().toISOString() }, { merge: true });
    return true;
  } catch (e) { console.error("savePortfolios:", e); return false; }
};

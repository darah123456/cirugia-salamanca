import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyC56benUByvzJqF6g5nwv35bHEWFND3hlQ",
  authDomain: "citas-41a39.firebaseapp.com",
  projectId: "citas-41a39",
  storageBucket: "citas-41a39.firebasestorage.app",
  messagingSenderId: "856384783258",
  appId: "1:856384783258:web:10687d624021d96edf7023"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
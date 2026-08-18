// lib/firebase.js
// Init Firebase Admin sekali, dipakai bareng sama semua serverless function
// di /api. Pakai env var yang sama kayak yang udah ada di project utama:
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY

const admin = require("firebase-admin");

const DATABASE_URL =
    "https://hidzproject-8f335-default-rtdb.asia-southeast1.firebasedatabase.app";

function getDb() {
    if (!admin.apps.length) {
        const projectId = process.env.FIREBASE_PROJECT_ID;
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
        const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

        if (!projectId || !clientEmail || !privateKey) {
            throw new Error("Env var Firebase Admin belum lengkap.");
        }

        admin.initializeApp({
            credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
            databaseURL: DATABASE_URL,
        });
    }
    return admin.database();
}

// Username dipakai jadi key path RTDB, jadi harus disaring dulu —
// RTDB gak boleh ada karakter . # $ [ ] / di key-nya.
function sanitizeUser(raw) {
    if (typeof raw !== "string") return null;
    const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    return cleaned.length >= 3 && cleaned.length <= 30 ? cleaned : null;
}

module.exports = { admin, getDb, sanitizeUser };

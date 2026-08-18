// api/hidzai-history.js
// Ambil & hapus riwayat chat HidzAI dari Firebase, dipakai buat sinkronisasi
// lintas device berdasarkan username yang diset di app (bukan sistem login,
// cuma identifier ringan biar histori bisa dibaca dari device lain).

const { getDb, sanitizeUser } = require("../lib/firebase");

const HISTORY_LIMIT = 60;

module.exports = async function handler(req, res) {
    const user = sanitizeUser(req.query && req.query.user);
    if (!user) {
        return res.status(400).json({ error: "Username tidak valid." });
    }

    const db = getDb();
    const ref = db.ref("hidzaiChats/" + user);

    if (req.method === "GET") {
        try {
            const snap = await ref.limitToLast(HISTORY_LIMIT).once("value");
            const val = snap.val() || {};
            const messages = Object.keys(val)
                .map((key) => val[key])
                .sort((a, b) => (a.ts || 0) - (b.ts || 0))
                .map((m) => ({ role: m.role, content: m.content }));
            return res.status(200).json({ messages });
        } catch (err) {
            return res.status(500).json({ error: "Gagal ambil riwayat." });
        }
    }

    if (req.method === "DELETE") {
        try {
            await ref.remove();
            return res.status(200).json({ ok: true });
        } catch (err) {
            return res.status(500).json({ error: "Gagal hapus riwayat." });
        }
    }

    res.setHeader("Allow", "GET, DELETE");
    return res.status(405).json({ error: "Method tidak diizinkan." });
};

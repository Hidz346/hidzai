// api/hidzai-chat.js
// Proxy chat HidzAI ke Anthropic API, sekaligus nyimpen riwayat ke Firebase
// kalau usernya dikirim dari client. Kredensial gak pernah nyampe ke
// browser — semua disimpen lewat env var di server:
//   ANTHROPIC_API_KEY
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY

const { admin, getDb, sanitizeUser } = require("../lib/firebase");

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1024;
const MAX_HISTORY = 20;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_IMAGE_BASE64_LENGTH = 6000000; // kira-kira setara file asli 4MB
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

const SYSTEM_PROMPT =
    "Kamu adalah HidzAI, asisten yang jadi bagian dari ekosistem HidzProject buatan Hidz. " +
    "Jawab dengan santai, jelas, dan seperlunya. Pakai Bahasa Indonesia kecuali user " +
    "mintanya bahasa lain. Kalau gak tau jawabannya, bilang terus terang.";

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({ error: "Method tidak diizinkan." });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: "ANTHROPIC_API_KEY belum di-set di server." });
    }

    let body = req.body;
    if (typeof body === "string") {
        try {
            body = JSON.parse(body);
        } catch (e) {
            body = null;
        }
    }

    const incomingRaw = Array.isArray(body && body.messages) ? body.messages : [];
    if (incomingRaw.length === 0) {
        return res.status(400).json({ error: "Pesan kosong." });
    }

    const user = sanitizeUser(body && body.user);
    const incoming = incomingRaw.slice(-MAX_HISTORY);
    const lastIndex = incoming.length - 1;

    // cuma pesan terakhir yang boleh bawa gambar — history lama yang ada
    // gambarnya diganti jadi placeholder teks biar payload gak membengkak
    const messages = [];
    for (let i = 0; i < incoming.length; i++) {
        const m = incoming[i];
        if (!m || (m.role !== "user" && m.role !== "assistant")) continue;

        const text = typeof m.content === "string" ? m.content.slice(0, MAX_MESSAGE_LENGTH) : "";
        const canHaveImage = i === lastIndex && m.role === "user";
        const image = canHaveImage ? validateImage(m.image) : null;

        if (!text && !image) continue;

        if (image) {
            const blocks = [
                { type: "image", source: { type: "base64", media_type: image.media_type, data: image.data } },
            ];
            if (text) blocks.push({ type: "text", text });
            messages.push({ role: "user", content: blocks });
        } else {
            messages.push({ role: m.role, content: text || "[gambar]" });
        }
    }

    if (messages.length === 0) {
        return res.status(400).json({ error: "Format pesan tidak valid." });
    }

    try {
        const upstream = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model: MODEL,
                max_tokens: MAX_TOKENS,
                system: SYSTEM_PROMPT,
                messages: messages,
            }),
        });

        const data = await upstream.json();

        if (!upstream.ok) {
            const message = (data && data.error && data.error.message) || "Gagal menghubungi HidzAI.";
            return res.status(upstream.status).json({ error: message });
        }

        const reply =
            (data.content || [])
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join("\n")
                .trim() || "Hmm, aku gak punya jawaban buat itu.";

        if (user) {
            try {
                await logToFirebase(user, incoming[lastIndex], reply);
            } catch (err) {
                // gagal nyimpen riwayat gak boleh bikin chat-nya ikut gagal
                console.error("Gagal nyimpen riwayat HidzAI:", err);
            }
        }

        return res.status(200).json({ reply });
    } catch (err) {
        return res.status(500).json({ error: "Server lagi bermasalah, coba lagi sebentar." });
    }
};

function validateImage(image) {
    if (!image || typeof image.data !== "string" || typeof image.media_type !== "string") return null;
    if (ALLOWED_IMAGE_TYPES.indexOf(image.media_type) === -1) return null;
    if (image.data.length > MAX_IMAGE_BASE64_LENGTH) return null;
    return image;
}

async function logToFirebase(user, lastUserMsg, reply) {
    const db = getDb();
    const ref = db.ref("hidzaiChats/" + user);
    const userText =
        (typeof lastUserMsg.content === "string" && lastUserMsg.content.trim()) ||
        (lastUserMsg.image ? "[gambar]" : "");

    await ref.push({ role: "user", content: userText, ts: admin.database.ServerValue.TIMESTAMP });
    await ref.push({ role: "assistant", content: reply, ts: admin.database.ServerValue.TIMESTAMP });
}


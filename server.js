const express = require("express")
const multer = require("multer")
const crypto = require("crypto")
const fs = require("fs")
const path = require("path")

const app = express()

app.use(express.json())
app.use(express.static("public"))
app.use("/uploads", express.static("uploads"))

if (!fs.existsSync("uploads")) {
    fs.mkdirSync("uploads")
}

/* =========================
   STATE
========================= */

let threads = []

const adminSessions = {}
const adminFailCooldown = {}
const replyCooldown = {}

const MAX_THREADS = 500
const MAX_REPLIES = 500

/* =========================
   UPLOADS
========================= */

function storageEngine() {
    return multer.diskStorage({
        destination: (req, file, cb) => cb(null, "uploads/"),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname || "")
            cb(null, Date.now() + "-" + crypto.randomBytes(6).toString("hex") + ext)
        }
    })
}

const upload = multer({
    storage: storageEngine(),
    limits: { fileSize: 50 * 1024 * 1024 }
})

/* =========================
   HELPERS
========================= */

function ip(req) {
    return req.headers["x-forwarded-for"] || req.socket.remoteAddress
}

function now() {
    return Date.now()
}

function isAdmin(req) {
    const token = req.headers["x-admin-token"]
    return token && adminSessions[token]
}

function requireAdmin(req, res) {
    if (!isAdmin(req)) {
        res.status(403).json({ error: "no" })
        return false
    }
    return true
}

function findThread(id) {
    return threads.find(t => t.id === id)
}

/* =========================
   THREAD LIMITS
========================= */

function trimThreads() {
    if (threads.length > MAX_THREADS) {
        threads = threads.slice(0, MAX_THREADS)
    }
}

function trimReplies(t) {
    if (t.replies.length > MAX_REPLIES) {
        t.replies = t.replies.slice(-MAX_REPLIES)
    }
}

/* =========================
   PUBLIC
========================= */

app.get("/threads", (req, res) => {
    res.json(threads)
})

/* =========================
   ADMIN LOGIN
========================= */

app.post("/admin/login", (req, res) => {
    const user = ip(req)

    if (!adminFailCooldown[user] || now() - adminFailCooldown[user] > 30000) {
        adminFailCooldown[user] = 0
    }

    if (req.body.password !== "fish") {
        adminFailCooldown[user] = now()
        return res.status(403).json({ error: "wrong" })
    }

    const token = crypto.randomBytes(24).toString("hex")
    adminSessions[token] = true

    res.json({ token })
})

/* =========================
   CREATE THREAD
========================= */

app.post("/admin/thread", upload.single("media"), (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "no" })

    const thread = {
        id: crypto.randomUUID(),
        text: req.body.text || "",
        media: req.file ? "/uploads/" + req.file.filename : "",
        time: new Date().toISOString(),
        replies: [],
        pendingReplies: []
    }

    threads.unshift(thread)
    trimThreads()

    res.json(thread)
})

/* =========================
   USER REPLY
========================= */

app.post("/threads/:id/reply", upload.single("media"), (req, res) => {
    const user = ip(req)

    if (!replyCooldown[user] || now() - replyCooldown[user] < 10000) {
        return res.status(429).json({ error: "slow" })
    }

    const t = findThread(req.params.id)
    if (!t) return res.status(404).json({ error: "not found" })

    const reply = {
        id: crypto.randomUUID(),
        text: req.body.text || "",
        media: req.file ? "/uploads/" + req.file.filename : "",
        time: new Date().toISOString()
    }

    t.pendingReplies.push(reply)
    replyCooldown[user] = now()

    res.json({ ok: true })
})

/* =========================
   ADMIN THREAD ACTIONS (FIXED)
========================= */

app.delete("/admin/thread/:id", (req, res) => {
    if (!requireAdmin(req, res)) return

    threads = threads.filter(t => t.id !== req.params.id)
    res.json({ ok: true })
})

app.post("/admin/thread/:id/pin", (req, res) => {
    if (!requireAdmin(req, res)) return

    const t = findThread(req.params.id)
    if (!t) return res.status(404).json({ error: "not found" })

    threads = [t, ...threads.filter(x => x.id !== t.id)]
    res.json({ ok: true })
})

app.post("/admin/thread/:id/bottom", (req, res) => {
    if (!requireAdmin(req, res)) return

    const t = findThread(req.params.id)
    if (!t) return res.status(404).json({ error: "not found" })

    threads = [...threads.filter(x => x.id !== t.id), t]
    res.json({ ok: true })
})

/* =========================
   MODERATION
========================= */

app.post("/admin/thread/:id/reply/:rid/approve", (req, res) => {
    if (!requireAdmin(req, res)) return

    const t = findThread(req.params.id)
    if (!t) return res.status(404).json({ error: "thread not found" })

    const idx = t.pendingReplies.findIndex(r => r.id === req.params.rid)
    if (idx === -1) return res.status(404).json({ error: "not found" })

    const reply = t.pendingReplies.splice(idx, 1)[0]
    t.replies.push(reply)

    res.json({ ok: true })
})

app.delete("/admin/thread/:id/reply/:rid", (req, res) => {
    if (!requireAdmin(req, res)) return

    const t = findThread(req.params.id)
    if (!t) return res.status(404).json({ error: "thread not found" })

    t.pendingReplies = t.pendingReplies.filter(r => r.id !== req.params.rid)
    t.replies = t.replies.filter(r => r.id !== req.params.rid)

    res.json({ ok: true })
})

/* =========================
   START
========================= */

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
    console.log("server running on", PORT)
})

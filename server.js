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

let threads = []

const adminSessions = {}
const adminFailCooldown = {}

const MAX_THREADS = 500
const MAX_REPLIES = 500

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

function ip(req) {
    return (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "")
        .split(",")[0]
        .trim()
}

function isAdmin(req) {
    const token = req.headers["x-admin-token"]
    return token && adminSessions[token]
}

function requireAdmin(req, res) {
    const token = req.headers["x-admin-token"]
    if (!token || !adminSessions[token]) {
        res.status(403).json({ error: "no" })
        return false
    }
    return true
}

function findThread(id) {
    return threads.find(t => t.id === id)
}

function trimThreads() {
    if (threads.length > MAX_THREADS) {
        threads = threads.slice(0, MAX_THREADS)
    }
}

app.get("/threads", (req, res) => {
    res.json(threads)
})

app.get("/admin/threads", (req, res) => {
    if (!requireAdmin(req, res)) return

    res.json(
        threads.map(t => ({
            id: t.id,
            text: t.text,
            media: t.media,
            time: t.time,
            replies: t.replies || [],
            pendingReplies: t.pendingReplies || []
        }))
    )
})

app.post("/admin/login", (req, res) => {
    const user = ip(req)

    if (!adminFailCooldown[user] || Date.now() - adminFailCooldown[user] > 30000) {
        adminFailCooldown[user] = 0
    }

    if (req.body.password !== "fish") {
        adminFailCooldown[user] = Date.now()
        return res.status(403).json({ error: "wrong" })
    }

    const token = crypto.randomBytes(24).toString("hex")
    adminSessions[token] = true

    res.json({ token })
})

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

app.post("/threads/:id/reply", upload.single("media"), (req, res) => {
    const t = findThread(req.params.id)
    if (!t) return res.status(404).json({ error: "not found" })

    const reply = {
        id: crypto.randomUUID(),
        text: req.body.text || "",
        media: req.file ? "/uploads/" + req.file.filename : "",
        time: new Date().toISOString()
    }

    if (!t.pendingReplies) t.pendingReplies = []
    if (!t.replies) t.replies = []

    t.pendingReplies.push(reply)

    if (t.pendingReplies.length > MAX_REPLIES) {
        t.pendingReplies = t.pendingReplies.slice(-MAX_REPLIES)
    }

    res.json({ ok: true })
})

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

app.post("/admin/thread/:id/reply/:rid/approve", (req, res) => {
    if (!requireAdmin(req, res)) return

    const t = findThread(req.params.id)
    if (!t) return res.status(404).json({ error: "thread not found" })

    const idx = (t.pendingReplies || []).findIndex(r => r.id === req.params.rid)
    if (idx === -1) return res.status(404).json({ error: "not found" })

    const reply = t.pendingReplies.splice(idx, 1)[0]

    if (!t.replies) t.replies = []
    t.replies.push(reply)

    res.json({ ok: true })
})

app.delete("/admin/thread/:id/reply/:rid", (req, res) => {
    if (!requireAdmin(req, res)) return

    const t = findThread(req.params.id)
    if (!t) return res.status(404).json({ error: "thread not found" })

    t.pendingReplies = (t.pendingReplies || []).filter(r => r.id !== req.params.rid)
    t.replies = (t.replies || []).filter(r => r.id !== req.params.rid)

    res.json({ ok: true })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
    console.log("server running on", PORT)
})

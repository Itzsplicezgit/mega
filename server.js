const express = require("express")
const multer = require("multer")
const crypto = require("crypto")
const fs = require("fs")
const path = require("path")

const app = express()

app.use(express.json())
app.use(express.static("public"))
app.use("/uploads", express.static("uploads"))

if(!fs.existsSync("uploads")){
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

function storageEngine(){
return multer.diskStorage({
destination:(req,file,cb)=>{
cb(null,"uploads/")
},
filename:(req,file,cb)=>{
const ext = path.extname(file.originalname || "")
cb(null,Date.now()+"-"+crypto.randomBytes(6).toString("hex")+ext)
}
})
}

const userUpload = multer({
storage:storageEngine(),
limits:{fileSize:10*1024*1024}
})

const adminUpload = multer({
storage:storageEngine(),
limits:{fileSize:25*1024*1024}
})

/* =========================
   HELPERS
========================= */

function ip(req){
return req.headers["x-forwarded-for"] || req.socket.remoteAddress
}

function now(){
return Date.now()
}

function canReply(id){
return !replyCooldown[id] || now() - replyCooldown[id] > 30000
}

function isAdmin(req){
return adminSessions[req.headers["x-admin-token"]]
}

function findThread(id){
return threads.find(t => t.id === id)
}

function trimThreads(){
if(threads.length > MAX_THREADS){
threads = threads.slice(0, MAX_THREADS)
}
}

function trimReplies(t){
if(t.replies.length > MAX_REPLIES){
t.replies = t.replies.slice(-MAX_REPLIES)
}
}

/* =========================
   PUBLIC THREAD VIEW
========================= */

app.get("/threads",(req,res)=>{
res.json(threads)
})

/* =========================
   USER REPLY -> PENDING
========================= */

app.post("/threads/:id/reply",(req,res)=>{
userUpload.single("media")(req,res,err=>{
try{
if(err){
return res.status(400).json({error:"file too large"})
}

const user = ip(req)
if(!canReply(user)){
return res.status(429).json({error:"slow"})
}

const t = findThread(req.params.id)
if(!t){
return res.status(404).json({error:"not found"})
}

const reply = {
id: crypto.randomUUID(),
text: req.body.text || "",
media: req.file ? "/uploads/" + req.file.filename : "",
time: new Date().toISOString()
}

/* 👇 goes to pending first */
t.pendingReplies.push(reply)

replyCooldown[user] = now()

res.json({ok:true, pending:true})

}catch(e){
res.status(500).json({error:"server error"})
}
})
})

/* =========================
   ADMIN AUTH
========================= */

app.post("/admin/login",(req,res)=>{
const user = ip(req)

if(!adminFailCooldown[user] || now()-adminFailCooldown[user] > 30000){
adminFailCooldown[user] = 0
}

const {password} = req.body

if(password !== "fish"){
adminFailCooldown[user] = now()
return res.status(403).json({error:"wrong"})
}

const token = crypto.randomBytes(24).toString("hex")
adminSessions[token] = true

res.json({token})
})

function requireAdmin(req,res){
if(!isAdmin(req)){
res.status(403).json({error:"no"})
return false
}
return true
}

/* =========================
   ADMIN THREADS
========================= */

app.post("/admin/thread",(req,res)=>{
adminUpload.single("media")(req,res,err=>{
try{
if(err){
return res.status(500).json({error:"upload error"})
}

if(!requireAdmin(req,res)) return

const thread = {
id: crypto.randomUUID(),
text: req.body.text || "",
media: req.file ? "/uploads/" + req.file.filename : "",
time: new Date().toISOString(),
replies: [],          // approved
pendingReplies: [],   // waiting approval
pinned: false
}

threads.unshift(thread)
trimThreads()

res.json(thread)

}catch(e){
res.status(500).json({error:"server error"})
}
})
})

app.get("/admin/threads",(req,res)=>{
if(!requireAdmin(req,res)) return
res.json(threads)
})

app.delete("/admin/thread/:id",(req,res)=>{
if(!requireAdmin(req,res)) return
threads = threads.filter(t => t.id !== req.params.id)
res.json({ok:true})
})

app.post("/admin/thread/:id/pin",(req,res)=>{
if(!requireAdmin(req,res)) return

const t = findThread(req.params.id)
if(!t) return res.status(404).json({error:"no"})

threads = threads.filter(x => x.id !== t.id)
threads.unshift(t)

res.json({ok:true})
})

app.post("/admin/thread/:id/bottom",(req,res)=>{
if(!requireAdmin(req,res)) return

const t = findThread(req.params.id)
if(!t) return res.status(404).json({error:"no"})

threads = threads.filter(x => x.id !== req.params.id)
threads.push(t)

res.json({ok:true})
})

/* =========================
   APPROVE / REJECT REPLIES
========================= */

app.post("/admin/thread/:id/reply/:rid/approve",(req,res)=>{
if(!requireAdmin(req,res)) return

const t = findThread(req.params.id)
if(!t) return res.status(404).json({error:"thread not found"})

const idx = t.pendingReplies.findIndex(r => r.id === req.params.rid)
if(idx === -1) return res.status(404).json({error:"not found"})

const reply = t.pendingReplies.splice(idx,1)[0]
t.replies.push(reply)

res.json({ok:true})
})

app.delete("/admin/thread/:id/reply/:rid",(req,res)=>{
if(!requireAdmin(req,res)) return

const t = findThread(req.params.id)
if(!t) return res.status(404).json({error:"thread not found"})

t.pendingReplies = t.pendingReplies.filter(r => r.id !== req.params.rid)
t.replies = t.replies.filter(r => r.id !== req.params.rid)

res.json({ok:true})
})

/* =========================
   START
========================= */

const PORT = process.env.PORT || 3000
app.listen(PORT,()=>{
console.log("server running on",PORT)
})

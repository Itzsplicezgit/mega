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

let threads = []

const replyCooldown = {}
const adminSessions = {}
const adminFailCooldown = {}

const MAX_THREADS = 500
const MAX_REPLIES = 500

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
limits:{}
})

function ip(req){
return req.headers["x-forwarded-for"]||req.socket.remoteAddress
}

function now(){
return Date.now()
}

function canReply(id){
return !replyCooldown[id]||now()-replyCooldown[id]>30*1000
}

function canAdminTry(id){
return !adminFailCooldown[id]||now()-adminFailCooldown[id]>30*1000
}

function isAdmin(req){
return adminSessions[req.headers["x-admin-token"]]
}

function trimThreads(){
if(threads.length>MAX_THREADS){
threads=threads.slice(0,MAX_THREADS)
}
}

function trimReplies(t){
if(t.replies.length>MAX_REPLIES){
t.replies=t.replies.slice(-MAX_REPLIES)
}
}

app.get("/threads",(req,res)=>{
res.json(threads)
})

app.post("/threads/:id/reply",(req,res)=>{
userUpload.single("media")(req,res,err=>{
try{
if(err){
return res.status(400).json({error:"file too large (max 10MB)"})
}

const user=ip(req)

if(!canReply(user)){
return res.status(429).json({error:"slow"})
}

const t=threads.find(x=>x.id===req.params.id)
if(!t)return res.status(404).json({error:"not found"})

const reply={
text:req.body.text||"",
media:req.file?"/uploads/"+req.file.filename:"",
time:new Date().toISOString()
}

t.replies.push(reply)

trimReplies(t)
replyCooldown[user]=now()

res.json({ok:true,thread:t})

}catch(e){
res.status(500).json({error:"server error"})
}
})
})

app.post("/admin/login",(req,res)=>{
const user=ip(req)

if(!canAdminTry(user)){
return res.status(429).json({error:"cooldown"})
}

const {password}=req.body

if(password!=="fish"){
adminFailCooldown[user]=now()
return res.status(403).json({error:"wrong"})
}

const token=crypto.randomBytes(24).toString("hex")
adminSessions[token]=true

res.json({token})
})

app.post("/admin/thread",(req,res)=>{
adminUpload.single("media")(req,res,err=>{
try{
if(err){
return res.status(500).json({error:"upload error"})
}

if(!isAdmin(req))return res.status(403).json({error:"no"})

const thread={
id:crypto.randomUUID(),
text:req.body.text||"",
media:req.file?"/uploads/"+req.file.filename:"",
time:new Date().toISOString(),
replies:[],
pinned:false
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
if(!isAdmin(req))return res.status(403).json({error:"no"})
res.json(threads)
})

app.delete("/admin/thread/:id",(req,res)=>{
if(!isAdmin(req))return res.status(403).json({error:"no"})
threads=threads.filter(t=>t.id!==req.params.id)
res.json({ok:true})
})

app.post("/admin/thread/:id/pin",(req,res)=>{
if(!isAdmin(req))return res.status(403).json({error:"no"})
const t=threads.find(x=>x.id===req.params.id)
if(!t)return res.status(404).json({error:"no"})
threads=threads.filter(x=>x.id!==t.id)
threads.unshift(t)
res.json({ok:true})
})

app.post("/admin/thread/:id/bottom",(req,res)=>{
if(!isAdmin(req))return res.status(403).json({error:"no"})
const t=threads.find(x=>x.id===req.params.id)
if(!t)return res.status(404).json({error:"no"})
threads=threads.filter(x=>x.id!==req.params.id)
threads.push(t)
res.json({ok:true})
})

const PORT=process.env.PORT||3000
app.listen(PORT,()=>{
console.log("server running on",PORT)
})

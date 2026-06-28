const express = require("express");
const multer = require("multer");
const crypto = require("crypto");

const app = express();

app.use(express.json());
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

let threads = [];
const postCooldown = {};
const replyCooldown = {};
const adminSessions = {};
const adminFailCooldown = {};

const storage = multer.diskStorage({
destination: "uploads/",
filename: (req, file, cb) => {
cb(null, Date.now() + "-" + file.originalname);
}
});

const upload = multer({
storage,
limits: { fileSize: 100 * 1024 * 1024 }
});

function ip(req){
return req.headers["x-forwarded-for"] || req.socket.remoteAddress;
}

function now(){
return Date.now();
}

function canPost(id){
return !postCooldown[id] || now() - postCooldown[id] > 10 * 60 * 1000;
}

function canReply(id){
return !replyCooldown[id] || now() - replyCooldown[id] > 30 * 1000;
}

function canAdminTry(id){
return !adminFailCooldown[id] || now() - adminFailCooldown[id] > 30 * 1000;
}

app.get("/threads",(req,res)=>{
res.json(threads);
});

app.post("/threads", upload.single("media"), (req,res)=>{
const user = ip(req);

if(!canPost(user)){
return res.status(429).json({error:"cooldown"});
}

const text = req.body.text || "";
const media = req.file ? "/uploads/" + req.file.filename : "";

if(!text && !media){
return res.status(400).json({error:"empty"});
}

const thread = {
id: crypto.randomUUID(),
text,
media,
time: new Date().toISOString(),
replies: [],
pinned:false
};

threads.unshift(thread);
postCooldown[user] = now();

res.json(thread);
});

app.post("/threads/:id/reply", upload.single("media"), (req,res)=>{
const user = ip(req);

if(!canReply(user)){
return res.status(429).json({error:"slow"});
}

const t = threads.find(x=>x.id===req.params.id);
if(!t) return res.status(404).json({error:"not found"});

t.replies.push({
text: req.body.text || "",
media: req.file ? "/uploads/" + req.file.filename : "",
time: new Date().toISOString()
});

replyCooldown[user] = now();

res.json({ok:true});
});

app.post("/admin/login",(req,res)=>{
const user = ip(req);

if(!canAdminTry(user)){
return res.status(429).json({error:"cooldown"});
}

const {password} = req.body;

if(password !== "fish"){
adminFailCooldown[user] = now();
return res.status(403).json({error:"wrong"});
}

const token = crypto.randomBytes(24).toString("hex");
adminSessions[token] = true;

res.json({token});
});

function isAdmin(req){
return adminSessions[req.headers["x-admin-token"]];
}

app.get("/admin/threads",(req,res)=>{
if(!isAdmin(req)) return res.status(403).json({error:"no"});
res.json(threads);
});

app.delete("/admin/thread/:id",(req,res)=>{
if(!isAdmin(req)) return res.status(403).json({error:"no"});
threads = threads.filter(t=>t.id !== req.params.id);
res.json({ok:true});
});

app.post("/admin/thread/:id/pin",(req,res)=>{
if(!isAdmin(req)) return res.status(403).json({error:"no"});

const t = threads.find(x=>x.id===req.params.id);
if(!t) return res.status(404).json({error:"no"});

t.pinned = true;
threads = [t, ...threads.filter(x=>x.id !== t.id)];

res.json({ok:true});
});

app.post("/admin/thread/:id/bottom",(req,res)=>{
if(!isAdmin(req)) return res.status(403).json({error:"no"});

const t = threads.find(x=>x.id===req.params.id);
threads = threads.filter(x=>x.id !== req.params.id);
threads.push(t);

res.json({ok:true});
});

const PORT = process.env.PORT || 3000;

app.listen(PORT,()=>{
console.log("server running on",PORT);
});

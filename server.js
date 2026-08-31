require("dotenv").config?.();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-me";

app.use(cors());
app.use(express.json({limit:"2mb"}));
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname, "public")));

const uploadDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadDir, {recursive:true});
const upload = multer({dest: uploadDir, limits:{fileSize: 5 * 1024 * 1024}});

const db = new Database(path.join(__dirname, "data.sqlite"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 role TEXT NOT NULL CHECK(role IN ('admin','customer','investor')),
 name TEXT NOT NULL,
 father_husband TEXT,
 mobile TEXT UNIQUE,
 email TEXT,
 address TEXT,
 password_hash TEXT,
 language TEXT DEFAULT 'Hindi',
 status TEXT DEFAULT 'active',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS otp_codes(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 mobile TEXT NOT NULL,
 code_hash TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 attempts INTEGER DEFAULT 0,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS loans(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 customer_id INTEGER NOT NULL,
 loan_id TEXT UNIQUE NOT NULL,
 product TEXT NOT NULL,
 principal REAL DEFAULT 0,
 outstanding REAL DEFAULT 0,
 interest_rate REAL DEFAULT 0,
 emi REAL DEFAULT 0,
 dpd INTEGER DEFAULT 0,
 status TEXT DEFAULT 'active',
 start_date TEXT,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(customer_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS investments(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 customer_id INTEGER NOT NULL,
 investment_id TEXT UNIQUE NOT NULL,
 amount REAL NOT NULL,
 investment_date TEXT NOT NULL,
 relation_name TEXT,
 status TEXT DEFAULT 'active',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(customer_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS documents(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 customer_id INTEGER NOT NULL,
 doc_type TEXT NOT NULL,
 file_name TEXT NOT NULL,
 file_path TEXT NOT NULL,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(customer_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS service_requests(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 customer_id INTEGER NOT NULL,
 subject TEXT NOT NULL,
 message TEXT NOT NULL,
 status TEXT DEFAULT 'open',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(customer_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS mandates(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 customer_id INTEGER NOT NULL,
 bank_name TEXT,
 account_last4 TEXT,
 status TEXT DEFAULT 'pending',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(customer_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS closure_requests(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 customer_id INTEGER NOT NULL,
 loan_id TEXT,
 reason TEXT,
 status TEXT DEFAULT 'pending',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(customer_id) REFERENCES users(id)
);
`);

function seedAdmin(){
  const existing = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get();
  if(!existing){
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || "ChangeMe123!", 12);
    db.prepare("INSERT INTO users(role,name,mobile,email,password_hash) VALUES(?,?,?,?,?)")
      .run("admin","Emergency Sanstha Admin","9999999999",process.env.ADMIN_EMAIL || "admin@emergencysanstha.local",hash);
  }
}
seedAdmin();

const otpLimiter = rateLimit({windowMs: 10*60*1000, max: 10, standardHeaders:true, legacyHeaders:false});

function sign(user){
  return jwt.sign({id:user.id, role:user.role}, JWT_SECRET, {expiresIn:"8h"});
}
function auth(req,res,next){
  const h=req.headers.authorization||"";
  if(!h.startsWith("Bearer ")) return res.status(401).json({error:"Login required"});
  try{
    req.user=jwt.verify(h.slice(7), JWT_SECRET);
    next();
  }catch(e){ return res.status(401).json({error:"Invalid or expired session"}); }
}
function roles(...allowed){
  return (req,res,next)=> allowed.includes(req.user.role) ? next() : res.status(403).json({error:"Access denied"});
}
function idCode(prefix){
  return prefix + "-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(2).toString("hex").toUpperCase();
}
function safeUser(id){
  return db.prepare("SELECT id,role,name,father_husband,mobile,email,address,language,status,created_at FROM users WHERE id=?").get(id);
}

app.post("/api/auth/admin-login", otpLimiter, (req,res)=>{
  const {email,password}=req.body;
  const user=db.prepare("SELECT * FROM users WHERE email=? AND role='admin'").get(email);
  if(!user || !bcrypt.compareSync(password||"",user.password_hash||""))
    return res.status(401).json({error:"Invalid admin credentials"});
  res.json({token:sign(user), user:safeUser(user.id)});
});

app.post("/api/auth/request-otp", otpLimiter, (req,res)=>{
  const mobile=String(req.body.mobile||"").replace(/\D/g,"");
  if(!/^[6-9]\d{9}$/.test(mobile)) return res.status(400).json({error:"Enter a valid 10-digit Indian mobile number"});
  const code=String(crypto.randomInt(100000,1000000));
  const hash=bcrypt.hashSync(code,10);
  db.prepare("DELETE FROM otp_codes WHERE mobile=?").run(mobile);
  db.prepare("INSERT INTO otp_codes(mobile,code_hash,expires_at) VALUES(?,?,?)")
    .run(mobile,hash,Date.now()+5*60*1000);
  // Demo only. Never return OTP in production.
  const payload={message:"OTP generated. Check your SMS in production."};
  if((process.env.OTP_MODE||"demo")==="demo") payload.demo_otp=code;
  res.json(payload);
});

app.post("/api/auth/verify-otp", otpLimiter, (req,res)=>{
  const mobile=String(req.body.mobile||"").replace(/\D/g,"");
  const code=String(req.body.otp||"");
  const row=db.prepare("SELECT * FROM otp_codes WHERE mobile=? ORDER BY id DESC LIMIT 1").get(mobile);
  if(!row || Date.now()>row.expires_at) return res.status(400).json({error:"OTP expired or not found"});
  if(row.attempts>=5) return res.status(429).json({error:"Too many attempts"});
  db.prepare("UPDATE otp_codes SET attempts=attempts+1 WHERE id=?").run(row.id);
  if(!bcrypt.compareSync(code,row.code_hash)) return res.status(401).json({error:"Invalid OTP"});
  db.prepare("DELETE FROM otp_codes WHERE id=?").run(row.id);

  let user=db.prepare("SELECT * FROM users WHERE mobile=? AND role IN ('customer','investor')").get(mobile);
  if(!user){
    const role=req.body.role==="investor" ? "investor" : "customer";
    const result=db.prepare("INSERT INTO users(role,name,mobile) VALUES(?,?,?)").run(role,"New Customer",mobile);
    user=db.prepare("SELECT * FROM users WHERE id=?").get(result.lastInsertRowid);
  }
  res.json({token:sign(user),user:safeUser(user.id)});
});

app.get("/api/me",auth,(req,res)=>res.json({user:safeUser(req.user.id)}));

app.get("/api/customer/dashboard",auth,roles("customer","investor"),(req,res)=>{
  const user=safeUser(req.user.id);
  const loans=db.prepare("SELECT * FROM loans WHERE customer_id=? ORDER BY id DESC").all(req.user.id);
  const investments=db.prepare("SELECT * FROM investments WHERE customer_id=? ORDER BY id DESC").all(req.user.id);
  const requests=db.prepare("SELECT * FROM service_requests WHERE customer_id=? ORDER BY id DESC").all(req.user.id);
  res.json({user,loans,investments,requests});
});

app.put("/api/customer/profile",auth,roles("customer","investor"),(req,res)=>{
  const {name,father_husband,address,language,email}=req.body;
  db.prepare("UPDATE users SET name=?,father_husband=?,address=?,language=?,email=? WHERE id=?")
    .run(name||"Customer",father_husband||"",address||"",language||"Hindi",email||"",req.user.id);
  res.json({user:safeUser(req.user.id)});
});

app.post("/api/customer/service-request",auth,roles("customer","investor"),(req,res)=>{
  const {subject,message}=req.body;
  if(!subject||!message) return res.status(400).json({error:"Subject and message are required"});
  const r=db.prepare("INSERT INTO service_requests(customer_id,subject,message) VALUES(?,?,?)").run(req.user.id,subject,message);
  res.json({id:r.lastInsertRowid,message:"Service request submitted"});
});

app.post("/api/customer/mandate",auth,roles("customer","investor"),(req,res)=>{
  const {bank_name,account_last4}=req.body;
  db.prepare("INSERT INTO mandates(customer_id,bank_name,account_last4) VALUES(?,?,?)")
    .run(req.user.id,bank_name||"",String(account_last4||"").slice(-4));
  res.json({message:"Account mandate request submitted"});
});

app.post("/api/customer/closure",auth,roles("customer"),(req,res)=>{
  const {loan_id,reason}=req.body;
  db.prepare("INSERT INTO closure_requests(customer_id,loan_id,reason) VALUES(?,?,?)")
    .run(req.user.id,loan_id||"",reason||"");
  res.json({message:"Loan closure request submitted"});
});

app.post("/api/customer/document",auth,roles("customer","investor"),upload.single("file"),(req,res)=>{
  if(!req.file) return res.status(400).json({error:"File required"});
  const type=req.body.doc_type||"Other";
  db.prepare("INSERT INTO documents(customer_id,doc_type,file_name,file_path) VALUES(?,?,?,?)")
    .run(req.user.id,type,req.file.originalname,req.file.path);
  res.json({message:"Document uploaded"});
});

app.get("/api/customer/documents",auth,roles("customer","investor"),(req,res)=>{
  res.json(db.prepare("SELECT id,doc_type,file_name,created_at FROM documents WHERE customer_id=? ORDER BY id DESC").all(req.user.id));
});

// Admin APIs
app.get("/api/admin/stats",auth,roles("admin"),(req,res)=>{
  const customers=db.prepare("SELECT COUNT(*) c FROM users WHERE role IN ('customer','investor')").get().c;
  const loans=db.prepare("SELECT COUNT(*) c FROM loans").get().c;
  const investments=db.prepare("SELECT COALESCE(SUM(amount),0) s FROM investments").get().s;
  const outstanding=db.prepare("SELECT COALESCE(SUM(outstanding),0) s FROM loans").get().s;
  res.json({customers,loans,investments,outstanding});
});

app.get("/api/admin/customers",auth,roles("admin"),(req,res)=>{
  res.json(db.prepare("SELECT id,role,name,father_husband,mobile,email,address,language,status,created_at FROM users WHERE role IN ('customer','investor') ORDER BY id DESC").all());
});

app.post("/api/admin/customers",auth,roles("admin"),(req,res)=>{
  const {role="customer",name,father_husband,mobile,email,address,language="Hindi"}=req.body;
  if(!name||!mobile) return res.status(400).json({error:"Name and mobile are required"});
  try{
    const r=db.prepare("INSERT INTO users(role,name,father_husband,mobile,email,address,language) VALUES(?,?,?,?,?,?,?)")
      .run(role==="investor"?"investor":"customer",name,father_husband||"",mobile,email||"",address||"",language);
    res.json({user:safeUser(r.lastInsertRowid)});
  }catch(e){res.status(400).json({error:"Mobile may already exist"});}
});

app.put("/api/admin/customers/:id",auth,roles("admin"),(req,res)=>{
  const {name,father_husband,mobile,email,address,language,status,role}=req.body;
  db.prepare("UPDATE users SET name=?,father_husband=?,mobile=?,email=?,address=?,language=?,status=?,role=? WHERE id=?")
    .run(name||"Customer",father_husband||"",mobile||"",email||"",address||"",language||"Hindi",status||"active",role==="investor"?"investor":"customer",req.params.id);
  res.json({user:safeUser(req.params.id)});
});

app.get("/api/admin/loans",auth,roles("admin"),(req,res)=>{
  res.json(db.prepare(`SELECT loans.*, users.name customer_name, users.mobile
    FROM loans JOIN users ON users.id=loans.customer_id ORDER BY loans.id DESC`).all());
});

app.post("/api/admin/loans",auth,roles("admin"),(req,res)=>{
  const {customer_id,product,principal,outstanding,interest_rate,emi,dpd,start_date,status="active"}=req.body;
  if(!customer_id||!product) return res.status(400).json({error:"Customer and product are required"});
  const loan_id=idCode("LN");
  db.prepare(`INSERT INTO loans(customer_id,loan_id,product,principal,outstanding,interest_rate,emi,dpd,start_date,status)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(customer_id,loan_id,product,Number(principal)||0,Number(outstanding)||0,Number(interest_rate)||0,Number(emi)||0,Number(dpd)||0,start_date||"",status);
  res.json({loan_id});
});

app.put("/api/admin/loans/:id",auth,roles("admin"),(req,res)=>{
  const {product,principal,outstanding,interest_rate,emi,dpd,start_date,status}=req.body;
  db.prepare(`UPDATE loans SET product=?,principal=?,outstanding=?,interest_rate=?,emi=?,dpd=?,start_date=?,status=? WHERE id=?`)
    .run(product,Number(principal)||0,Number(outstanding)||0,Number(interest_rate)||0,Number(emi)||0,Number(dpd)||0,start_date||"",status||"active",req.params.id);
  res.json({message:"Loan updated"});
});

app.get("/api/admin/investments",auth,roles("admin"),(req,res)=>{
  res.json(db.prepare(`SELECT investments.*, users.name customer_name, users.mobile
    FROM investments JOIN users ON users.id=investments.customer_id ORDER BY investments.id DESC`).all());
});

app.post("/api/admin/investments",auth,roles("admin"),(req,res)=>{
  const {customer_id,amount,investment_date,relation_name,status="active"}=req.body;
  if(!customer_id||!amount||!investment_date) return res.status(400).json({error:"Customer, amount and date are required"});
  const investment_id=idCode("INV");
  db.prepare(`INSERT INTO investments(customer_id,investment_id,amount,investment_date,relation_name,status)
    VALUES(?,?,?,?,?,?)`).run(customer_id,investment_id,Number(amount),investment_date,relation_name||"",status);
  res.json({investment_id});
});

app.get("/api/admin/requests",auth,roles("admin"),(req,res)=>{
  res.json(db.prepare(`SELECT service_requests.*, users.name customer_name, users.mobile
    FROM service_requests JOIN users ON users.id=service_requests.customer_id ORDER BY service_requests.id DESC`).all());
});

app.put("/api/admin/requests/:id",auth,roles("admin"),(req,res)=>{
  db.prepare("UPDATE service_requests SET status=? WHERE id=?").run(req.body.status||"open",req.params.id);
  res.json({message:"Request status updated"});
});

app.get("/api/admin/mandates",auth,roles("admin"),(req,res)=>{
  res.json(db.prepare(`SELECT mandates.*, users.name customer_name, users.mobile
    FROM mandates JOIN users ON users.id=mandates.customer_id ORDER BY mandates.id DESC`).all());
});

app.put("/api/admin/mandates/:id",auth,roles("admin"),(req,res)=>{
  db.prepare("UPDATE mandates SET status=? WHERE id=?").run(req.body.status||"pending",req.params.id);
  res.json({message:"Mandate updated"});
});

app.get("/api/admin/closures",auth,roles("admin"),(req,res)=>{
  res.json(db.prepare(`SELECT closure_requests.*, users.name customer_name, users.mobile
    FROM closure_requests JOIN users ON users.id=closure_requests.customer_id ORDER BY closure_requests.id DESC`).all());
});

app.put("/api/admin/closures/:id",auth,roles("admin"),(req,res)=>{
  db.prepare("UPDATE closure_requests SET status=? WHERE id=?").run(req.body.status||"pending",req.params.id);
  res.json({message:"Closure request updated"});
});

app.get("/api/admin/documents",auth,roles("admin"),(req,res)=>{
  res.json(db.prepare(`SELECT documents.*, users.name customer_name, users.mobile
    FROM documents JOIN users ON users.id=documents.customer_id ORDER BY documents.id DESC`).all());
});

app.get("/api/admin/export/:type",auth,roles("admin"),(req,res)=>{
  const type=req.params.type;
  let rows=[];
  if(type==="customers") rows=db.prepare("SELECT * FROM users WHERE role IN ('customer','investor')").all();
  else if(type==="loans") rows=db.prepare("SELECT * FROM loans").all();
  else if(type==="investments") rows=db.prepare("SELECT * FROM investments").all();
  else return res.status(400).json({error:"Unsupported export"});
  const cols=Object.keys(rows[0]||{id:""});
  const csv=[cols.join(","),...rows.map(r=>cols.map(c=>`"${String(r[c]??"").replaceAll('"','""')}"`).join(","))].join("\n");
  res.setHeader("Content-Type","text/csv");
  res.setHeader("Content-Disposition",`attachment; filename=${type}.csv`);
  res.send(csv);
});

app.get("*",(req,res)=>{
  if(req.path.startsWith("/api/")) return res.status(404).json({error:"API route not found"});
  res.sendFile(path.join(__dirname,"public","index.html"));
});

app.listen(PORT,()=>console.log(`Emergency Sanstha Portal running at http://localhost:${PORT}`));

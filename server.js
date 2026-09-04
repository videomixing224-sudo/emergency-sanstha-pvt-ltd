require("dotenv").config();

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
const PDFDocument = require("pdfkit");

const app = express();

/*
 * Railway / Reverse Proxy configuration
 * This fixes express-rate-limit X-Forwarded-For errors.
 */
app.set("trust proxy", 1);

const PORT = process.env.PORT || 8080;

const JWT_SECRET =
  process.env.JWT_SECRET || "dev-only-change-this-secret";

const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL || "admin@example.com";

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || "ChangeThisAdminPassword!";

/* -----------------------------
   Middleware
----------------------------- */

app.use(cors());

app.use(express.json({
  limit: "2mb"
}));

app.use(express.urlencoded({
  extended: true
}));

app.use(express.static(
  path.join(__dirname, "public")
));

/* -----------------------------
   Upload directory
----------------------------- */

const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, "uploads");

fs.mkdirSync(uploadDir, {
  recursive: true
});

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

/* -----------------------------
   SQLite Database
----------------------------- */

const dbPath = process.env.DB_PATH || path.join(__dirname, "data.sqlite");

// Ensure the parent directory exists (important when using a Railway Volume).
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/* -----------------------------
   Database Tables
----------------------------- */

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
 login_id TEXT,
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

CREATE TABLE IF NOT EXISTS loan_payments(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 loan_id INTEGER NOT NULL,
 customer_id INTEGER NOT NULL,
 amount REAL NOT NULL,
 payment_date TEXT NOT NULL,
 note TEXT,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(loan_id) REFERENCES loans(id),
 FOREIGN KEY(customer_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS loan_adjustments(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 loan_id INTEGER NOT NULL,
 customer_id INTEGER NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('interest','penalty','add','subtract')),
 amount REAL NOT NULL,
 transaction_date TEXT NOT NULL,
 note TEXT,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(loan_id) REFERENCES loans(id),
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

CREATE TABLE IF NOT EXISTS investment_transactions(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 investment_id INTEGER NOT NULL,
 customer_id INTEGER NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('deposit','withdrawal')),
 amount REAL NOT NULL,
 transaction_date TEXT NOT NULL,
 note TEXT,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(investment_id) REFERENCES investments(id),
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

/* -----------------------------
   Safe schema migrations
----------------------------- */
function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

addColumnIfMissing("users", "login_id", "TEXT");
addColumnIfMissing("loans", "duration_days", "INTEGER DEFAULT 0");
addColumnIfMissing("loans", "payment_frequency", "TEXT DEFAULT 'monthly'");
addColumnIfMissing("loans", "agreement_created_at", "TEXT");
addColumnIfMissing("loans", "signature_data", "TEXT");
addColumnIfMissing("loans", "signed_at", "TEXT");

db.prepare(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login_id
  ON users(login_id)
`).run();

/* -----------------------------
   Admin Seed / Sync
----------------------------- */

function seedAdmin() {

  const existing = db
    .prepare(
      "SELECT * FROM users WHERE role='admin' LIMIT 1"
    )
    .get();

  const passwordHash = bcrypt.hashSync(
    ADMIN_PASSWORD,
    12
  );

  if (!existing) {

    db.prepare(`
      INSERT INTO users
      (
        role,
        name,
        mobile,
        email,
        password_hash
      )
      VALUES (?, ?, ?, ?, ?)
    `).run(
      "admin",
      "Emergency Sanstha Admin",
      "9999999999",
      ADMIN_EMAIL,
      passwordHash
    );

    console.log("Admin account created.");

  } else {

    /*
     * Keep the admin account synchronized
     * with Railway ADMIN_EMAIL / ADMIN_PASSWORD.
     */

    db.prepare(`
      UPDATE users
      SET
        email=?,
        password_hash=?,
        status='active'
      WHERE role='admin'
    `).run(
      ADMIN_EMAIL,
      passwordHash
    );

    console.log("Admin account synchronized.");
  }
}

seedAdmin();

/* -----------------------------
   Backfill Customer Login IDs
----------------------------- */

db.prepare(`
  SELECT id
  FROM users
  WHERE role IN ('customer','investor')
    AND (login_id IS NULL OR login_id='')
`).all().forEach((row) => {
  const mobileUser = db.prepare(`
    SELECT mobile
    FROM users
    WHERE id=?
    LIMIT 1
  `).get(row.id);

  if (mobileUser?.mobile) {
    const mobile = String(mobileUser.mobile)
      .replace(/\D/g, "")
      .replace(/^91(?=\d{10}$)/, "");

    db.prepare(`
      UPDATE users
      SET login_id=?
      WHERE id=?
    `).run(
      mobile,
      row.id
    );
  }
});



/* -----------------------------
   Rate Limiter
----------------------------- */

const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false
});

/* -----------------------------
   Authentication Helpers
----------------------------- */

function sign(user) {

  return jwt.sign(
    {
      id: user.id,
      role: user.role
    },
    JWT_SECRET,
    {
      expiresIn: "8h"
    }
  );
}

function auth(req, res, next) {

  const header =
    req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {

    return res.status(401).json({
      error: "Login required"
    });
  }

  try {

    req.user = jwt.verify(
      header.slice(7),
      JWT_SECRET
    );

    next();

  } catch (error) {

    return res.status(401).json({
      error: "Invalid or expired session"
    });
  }
}

function roles(...allowed) {

  return (req, res, next) => {

    if (allowed.includes(req.user.role)) {

      return next();
    }

    return res.status(403).json({
      error: "Access denied"
    });
  };
}

function idCode(prefix) {

  return (
    prefix +
    "-" +
    Date.now()
      .toString(36)
      .toUpperCase() +
    "-" +
    crypto
      .randomBytes(2)
      .toString("hex")
      .toUpperCase()
  );
}

function safeUser(id) {

  return db.prepare(`
    SELECT
      id,
      login_id,
      role,
      name,
      father_husband,
      mobile,
      email,
      address,
      language,
      status,
      created_at
    FROM users
    WHERE id=?
  `).get(id);
}


/* -----------------------------
   Customer Login Credentials
----------------------------- */

function customerLoginId(userId) {
  const user = db.prepare(`
    SELECT mobile
    FROM users
    WHERE id=?
    LIMIT 1
  `).get(userId);

  if (!user || !user.mobile) {
    throw new Error("Customer mobile number is required");
  }

  return String(user.mobile).replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
}

function generateCustomerPassword() {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let value = "";

  for (let i = 0; i < 10; i++) {
    value += alphabet[
      crypto.randomInt(0, alphabet.length)
    ];
  }

  return value;
}

function ensureCustomerCredentials(userId, requestedPassword = "") {
  const user = db.prepare(`
    SELECT *
    FROM users
    WHERE id=?
      AND role IN ('customer','investor')
    LIMIT 1
  `).get(userId);

  if (!user) {
    throw new Error("Customer not found");
  }

  const loginId = customerLoginId(user.id);
  let temporaryPassword = null;

  db.prepare(`
    UPDATE users
    SET login_id=?
    WHERE id=?
  `).run(loginId, user.id);

  if (!user.password_hash || requestedPassword) {
    temporaryPassword = String(requestedPassword || generateCustomerPassword()).trim();

    if (temporaryPassword.length < 6) {
      throw new Error("Password must be at least 6 characters");
    }

    db.prepare(`
      UPDATE users
      SET password_hash=?, status='active'
      WHERE id=?
    `).run(
      bcrypt.hashSync(temporaryPassword, 12),
      user.id
    );
  }

  return {
    login_id: loginId,
    temporary_password: temporaryPassword
  };
}

/* -----------------------------
   Admin Login
----------------------------- */

app.post(
  "/api/auth/admin-login",
  (req, res) => {
    try {
      const email = String(req.body?.email || "")
        .trim()
        .toLowerCase();

      const password = String(req.body?.password || "");

      if (!email || !password) {
        return res.status(400).json({
          error: "Email and password are required"
        });
      }

      /*
       * Primary admin credentials come from Railway Variables.
       * This avoids a stale/mismatched database password preventing
       * the configured administrator from logging in.
       */
      const configuredEmail = String(
        process.env.ADMIN_EMAIL || ""
      ).trim().toLowerCase();

      const configuredPassword = String(
        process.env.ADMIN_PASSWORD || ""
      );

      if (
        configuredEmail &&
        configuredPassword &&
        email === configuredEmail &&
        password === configuredPassword
      ) {
        const admin = db.prepare(`
          SELECT *
          FROM users
          WHERE role='admin'
          LIMIT 1
        `).get();

        if (!admin) {
          return res.status(500).json({
            error: "Admin account is not initialized"
          });
        }

        // Make sure the returned account is active and matches
        // the Railway-configured administrator.
        if (
          admin.email !== configuredEmail ||
          admin.status !== "active"
        ) {
          db.prepare(`
            UPDATE users
            SET email=?, status='active'
            WHERE id=?
          `).run(
            configuredEmail,
            admin.id
          );

          admin.email = configuredEmail;
          admin.status = "active";
        }

        return res.json({
          token: sign({
            ...admin,
            role: "admin"
          }),
          user: safeUser(admin.id)
        });
      }

      /*
       * Backward-compatible database check.
       */
      const user = db.prepare(`
        SELECT *
        FROM users
        WHERE LOWER(email)=?
          AND role='admin'
          AND status='active'
        LIMIT 1
      `).get(email);

      if (
        !user ||
        !user.password_hash ||
        !bcrypt.compareSync(
          password,
          user.password_hash
        )
      ) {
        return res.status(401).json({
          error: "Invalid admin credentials"
        });
      }

      return res.json({
        token: sign(user),
        user: safeUser(user.id)
      });

    } catch (error) {
      console.error(
        "Admin login error:",
        error
      );

      return res.status(500).json({
        error: "Admin login failed"
      });
    }
  }
);

/* -----------------------------
   Request REAL SMS OTP via 2Factor
   SMS channel is explicitly selected.
----------------------------- */

/* -----------------------------
   Request REAL SMS OTP via 2Factor
   SMS channel is explicitly selected.
----------------------------- */

app.post(
  "/api/auth/request-otp",
  otpLimiter,
  async (req, res) => {

    try {

      const mobile =
        String(req.body.mobile || "")
          .replace(/\D/g, "");

      if (!/^[6-9]\d{9}$/.test(mobile)) {
        return res.status(400).json({
          error: "Enter a valid 10-digit Indian mobile number"
        });
      }

      const code = String(
        crypto.randomInt(100000, 1000000)
      );

      const hash = bcrypt.hashSync(code, 10);

      db.prepare(
        "DELETE FROM otp_codes WHERE mobile=?"
      ).run(mobile);

      db.prepare(`
        INSERT INTO otp_codes
        (mobile, code_hash, expires_at)
        VALUES (?, ?, ?)
      `).run(
        mobile,
        hash,
        Date.now() + 5 * 60 * 1000
      );

      // 2Factor account/API key
      // Keep the existing Railway variable name for compatibility.
      const apiKey =
        process.env.TWOFATOR_API_KEY ||
        process.env.TWOFACTOR_API_KEY;

      if (!apiKey) {
        db.prepare(
          "DELETE FROM otp_codes WHERE mobile=?"
        ).run(mobile);

        console.error(
          "TWOFATOR_API_KEY / TWOFACTOR_API_KEY is missing"
        );

        return res.status(500).json({
          error: "SMS service is not configured"
        });
      }

      /*
       * SMS-ONLY mode
       *
       * Do NOT use 2Factor's OTP/SEND endpoint here because their
       * OTP platform may use voice fallback. We send the already
       * generated OTP through the Transactional SMS API instead.
       *
       * Required Railway variables:
       *   TWOFATOR_API_KEY   (or TWOFACTOR_API_KEY)
       *   TSMS_TEMPLATE_NAME (approved Transactional SMS template)
       *   TSMS_SENDER_ID    (approved sender/header, e.g. TFACTR)
       *
       * The template must contain a placeholder for VAR1.
       */
      const template =
        process.env.TSMS_TEMPLATE_NAME ||
        process.env.TRANSACTIONAL_TEMPLATE_NAME ||
        process.env.OTP_TEMPLATE_NAME ||
        process.env.OTP_TEMPLATE;

      const senderId =
        process.env.TSMS_SENDER_ID ||
        process.env.TRANSACTIONAL_SENDER_ID;

      if (!template || !senderId) {
        db.prepare(
          "DELETE FROM otp_codes WHERE mobile=?"
        ).run(mobile);

        console.error(
          "Transactional SMS configuration missing: TSMS_TEMPLATE_NAME and TSMS_SENDER_ID are required"
        );

        return res.status(500).json({
          error:
            "SMS template/sender is not configured"
        });
      }

      const tsmsUrl =
        "https://2factor.in/API/V1/" +
        encodeURIComponent(apiKey) +
        "/ADDON_SERVICES/SEND/TSMS";

      const form = new URLSearchParams();
      form.set("From", senderId);
      form.set("To", "91" + mobile);
      form.set("TemplateName", template);
      form.set("VAR1", code);

      const smsResponse = await fetch(tsmsUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json, text/plain, */*"
        },
        body: form.toString()
      });

      const rawText = await smsResponse.text();

      let smsData = null;
      try {
        smsData = JSON.parse(rawText);
      } catch (_) {
        // Legacy 2Factor responses can be plain text.
      }

      const providerStatus = String(
        smsData?.Status ??
        smsData?.status ??
        rawText
      ).trim().toLowerCase();

      console.log("2Factor Transactional SMS response:", {
        http_status: smsResponse.status,
        provider_status:
          smsData?.Status ?? smsData?.status ?? null,
        details:
          smsData?.Details ?? smsData?.details ?? null,
        raw_response: rawText
      });

      const sent =
        smsResponse.ok &&
        (
          providerStatus === "success" ||
          providerStatus === "sent" ||
          providerStatus.includes("success") ||
          providerStatus.includes("sent")
        );

      if (!sent) {
        db.prepare(
          "DELETE FROM otp_codes WHERE mobile=?"
        ).run(mobile);

        return res.status(502).json({
          error: "Unable to send SMS OTP"
        });
      }

      return res.json({
        message: "OTP sent successfully by SMS"
      });

    } catch (error) {

      console.error("2Factor SMS OTP error:", error);

      return res.status(500).json({
        error: "Failed to send SMS OTP"
      });
    }
  }
);

app.post(
  "/api/auth/verify-otp",
  otpLimiter,
  (req, res) => {

    const mobile =
      String(req.body.mobile || "")
        .replace(/\D/g, "");

    const code =
      String(req.body.otp || "");

    const row = db.prepare(`
      SELECT *
      FROM otp_codes
      WHERE mobile=?
      ORDER BY id DESC
      LIMIT 1
    `).get(mobile);

    if (
      !row ||
      Date.now() > row.expires_at
    ) {

      return res.status(400).json({
        error:
          "OTP expired or not found"
      });
    }

    if (row.attempts >= 5) {

      return res.status(429).json({
        error:
          "Too many attempts"
      });
    }

    db.prepare(`
      UPDATE otp_codes
      SET attempts=attempts+1
      WHERE id=?
    `).run(row.id);

    if (
      !bcrypt.compareSync(
        code,
        row.code_hash
      )
    ) {

      return res.status(401).json({
        error: "Invalid OTP"
      });
    }

    db.prepare(
      "DELETE FROM otp_codes WHERE id=?"
    ).run(row.id);

    let user = db.prepare(`
      SELECT *
      FROM users
      WHERE mobile=?
      AND role IN ('customer','investor')
    `).get(mobile);

    if (!user) {

      const role =
        req.body.role === "investor"
          ? "investor"
          : "customer";

      const result = db.prepare(`
        INSERT INTO users
        (
          role,
          name,
          mobile
        )
        VALUES (?, ?, ?)
      `).run(
        role,
        "New Customer",
        mobile
      );

      user = db.prepare(
        "SELECT * FROM users WHERE id=?"
      ).get(
        result.lastInsertRowid
      );
    }

    return res.json({
      token: sign(user),
      user: safeUser(user.id)
    });
  }
);

/* -----------------------------
   Customer Login with User ID + Password
----------------------------- */

app.post(
  "/api/auth/customer-login",
  (req, res) => {
    try {
      const loginId = String(
        req.body?.mobile ||
        req.body?.login_id ||
        req.body?.user_id ||
        ""
      ).replace(/\D/g, "")
       .replace(/^91(?=\d{10}$)/, "");

      const password = String(
        req.body?.password || ""
      );

      if (!loginId || !password) {
        return res.status(400).json({
          error:
            "User ID and password are required"
        });
      }

      const user = db.prepare(`
        SELECT *
        FROM users
        WHERE (
          login_id=?
          OR REPLACE(REPLACE(REPLACE(mobile,'+',''),' ',''),'-','')=?
          OR REPLACE(mobile,' ','')=?
        )
          AND role IN ('customer','investor')
          AND status='active'
        LIMIT 1
      `).get(
        loginId,
        loginId,
        "91" + loginId
      );

      if (
        !user ||
        !user.password_hash ||
        !bcrypt.compareSync(
          password,
          user.password_hash
        )
      ) {
        return res.status(401).json({
          error:
            "Invalid customer User ID or password"
        });
      }

      return res.json({
        token: sign(user),
        user: safeUser(user.id)
      });

    } catch (error) {
      console.error(
        "Customer login error:",
        error
      );

      return res.status(500).json({
        error:
          "Customer login failed"
      });
    }
  }
);

/* -----------------------------
   Current User
----------------------------- */

app.get(
  "/api/me",
  auth,
  (req, res) => {

    return res.json({
      user: safeUser(req.user.id)
    });
  }
);

/* -----------------------------
   Customer Dashboard
----------------------------- */

app.get(
  "/api/customer/dashboard",
  auth,
  roles("customer", "investor"),
  (req, res) => {

    const user =
      safeUser(req.user.id);

    const loans = db.prepare(`
      SELECT *
      FROM loans
      WHERE customer_id=?
      ORDER BY id DESC
    `).all(req.user.id);

    const investments = db.prepare(`
      SELECT
        i.*,
        COALESCE((SELECT SUM(t.amount) FROM investment_transactions t
                  WHERE t.investment_id=i.id AND t.type='deposit'),0) AS deposit_total,
        COALESCE((SELECT SUM(t.amount) FROM investment_transactions t
                  WHERE t.investment_id=i.id AND t.type='withdrawal'),0) AS withdrawal_total,
        (
          i.amount
          + COALESCE((SELECT SUM(t.amount) FROM investment_transactions t
                      WHERE t.investment_id=i.id AND t.type='deposit'),0)
          - COALESCE((SELECT SUM(t.amount) FROM investment_transactions t
                      WHERE t.investment_id=i.id AND t.type='withdrawal'),0)
        ) AS balance
      FROM investments i
      WHERE i.customer_id=?
      ORDER BY i.id DESC
    `).all(req.user.id);

    const requests = db.prepare(`
      SELECT *
      FROM service_requests
      WHERE customer_id=?
      ORDER BY id DESC
    `).all(req.user.id);

    const payments = db.prepare(`
      SELECT loan_payments.*, loans.loan_id AS loan_code
      FROM loan_payments
      JOIN loans ON loans.id=loan_payments.loan_id
      WHERE loan_payments.customer_id=?
      ORDER BY loan_payments.payment_date DESC, loan_payments.id DESC
    `).all(req.user.id);

    const loanTransactions = db.prepare(`
      SELECT loan_payments.loan_id, loans.loan_id AS loan_code, 'payment' AS type,
             loan_payments.amount, loan_payments.payment_date AS transaction_date, loan_payments.note
      FROM loan_payments JOIN loans ON loans.id=loan_payments.loan_id
      WHERE loan_payments.customer_id=?
      UNION ALL
      SELECT loan_adjustments.loan_id, loans.loan_id AS loan_code, loan_adjustments.type,
             loan_adjustments.amount, loan_adjustments.transaction_date, loan_adjustments.note
      FROM loan_adjustments JOIN loans ON loans.id=loan_adjustments.loan_id
      WHERE loan_adjustments.customer_id=?
      ORDER BY transaction_date DESC
    `).all(req.user.id, req.user.id);

    return res.json({
      user,
      loans,
      investments,
      requests,
      payments,
      loanTransactions
    });
  }
);

/* -----------------------------
   Customer Profile
----------------------------- */

app.put(
  "/api/customer/profile",
  auth,
  roles("customer", "investor"),
  (req, res) => {

    const {
      name,
      father_husband,
      address,
      language,
      email
    } = req.body;

    db.prepare(`
      UPDATE users
      SET
        name=?,
        father_husband=?,
        address=?,
        language=?,
        email=?
      WHERE id=?
    `).run(
      name || "Customer",
      father_husband || "",
      address || "",
      language || "Hindi",
      email || "",
      req.user.id
    );

    return res.json({
      user: safeUser(req.user.id)
    });
  }
);

/* -----------------------------
   Customer Service Request
----------------------------- */

app.post(
  "/api/customer/service-request",
  auth,
  roles("customer", "investor"),
  (req, res) => {

    const {
      subject,
      message
    } = req.body;

    if (!subject || !message) {

      return res.status(400).json({
        error:
          "Subject and message are required"
      });
    }

    const result = db.prepare(`
      INSERT INTO service_requests
      (
        customer_id,
        subject,
        message
      )
      VALUES (?, ?, ?)
    `).run(
      req.user.id,
      subject,
      message
    );

    return res.json({
      id: result.lastInsertRowid,
      message:
        "Service request submitted"
    });
  }
);

/* -----------------------------
   Customer Mandate
----------------------------- */

app.post(
  "/api/customer/mandate",
  auth,
  roles("customer", "investor"),
  (req, res) => {

    const {
      bank_name,
      account_last4
    } = req.body;

    db.prepare(`
      INSERT INTO mandates
      (
        customer_id,
        bank_name,
        account_last4
      )
      VALUES (?, ?, ?)
    `).run(
      req.user.id,
      bank_name || "",
      String(account_last4 || "")
        .slice(-4)
    );

    return res.json({
      message:
        "Account mandate request submitted"
    });
  }
);

/* -----------------------------
   Loan Closure
----------------------------- */

app.post(
  "/api/customer/closure",
  auth,
  roles("customer"),
  (req, res) => {

    const {
      loan_id,
      reason
    } = req.body;

    db.prepare(`
      INSERT INTO closure_requests
      (
        customer_id,
        loan_id,
        reason
      )
      VALUES (?, ?, ?)
    `).run(
      req.user.id,
      loan_id || "",
      reason || ""
    );

    return res.json({
      message:
        "Loan closure request submitted"
    });
  }
);

/* -----------------------------
   Customer Document
----------------------------- */

app.post(
  "/api/customer/document",
  auth,
  roles("customer", "investor"),
  upload.single("file"),
  (req, res) => {

    if (!req.file) {

      return res.status(400).json({
        error: "File required"
      });
    }

    const type =
      req.body.doc_type || "Other";

    db.prepare(`
      INSERT INTO documents
      (
        customer_id,
        doc_type,
        file_name,
        file_path
      )
      VALUES (?, ?, ?, ?)
    `).run(
      req.user.id,
      type,
      req.file.originalname,
      req.file.path
    );

    return res.json({
      message:
        "Document uploaded"
    });
  }
);

/* -----------------------------
   Customer Documents
----------------------------- */

app.get(
  "/api/customer/documents",
  auth,
  roles("customer", "investor"),
  (req, res) => {

    return res.json(
      db.prepare(`
        SELECT
          id,
          doc_type,
          file_name,
          created_at
        FROM documents
        WHERE customer_id=?
        ORDER BY id DESC
      `).all(req.user.id)
    );
  }
);


/* -----------------------------
   Loan Agreement PDF
----------------------------- */
function formatDate(value) {
  if (!value) return "-";
  const d = new Date(String(value) + (String(value).length === 10 ? "T00:00:00" : ""));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function loanAgreementData(loanId, userId = null) {
  const q = userId
    ? `SELECT loans.*, users.name customer_name, users.father_husband, users.mobile, users.email, users.address,
              users.login_id, users.language
       FROM loans JOIN users ON users.id=loans.customer_id
       WHERE loans.id=? AND loans.customer_id=? LIMIT 1`
    : `SELECT loans.*, users.name customer_name, users.father_husband, users.mobile, users.email, users.address,
              users.login_id, users.language
       FROM loans JOIN users ON users.id=loans.customer_id
       WHERE loans.id=? LIMIT 1`;
  return userId
    ? db.prepare(q).get(loanId, userId)
    : db.prepare(q).get(loanId);
}

function buildLoanAgreementPdf(loan, res) {
  const doc = new PDFDocument({ size: "A4", margin: 45 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="Loan-Agreement-${String(loan.loan_id).replace(/[^A-Za-z0-9_-]/g, "_")}.pdf"`
  );
  doc.pipe(res);

  const line = (y) => {
    doc.moveTo(45, y).lineTo(550, y).stroke();
  };

  doc.fontSize(18).font("Helvetica-Bold").text("EMERGENCY SANSTHA PVT LTD", { align: "center" });
  doc.fontSize(12).font("Helvetica-Bold").text("LOAN AGREEMENT", { align: "center" });
  doc.moveDown(0.6);
  doc.fontSize(9).font("Helvetica").text(`Agreement generated: ${formatDate(loan.agreement_created_at || new Date().toISOString())}`, { align: "right" });
  line(doc.y + 4);
  doc.moveDown(0.7);

  doc.fontSize(12).font("Helvetica-Bold").text("1. Customer Details");
  doc.moveDown(0.25);
  const customerRows = [
    ["Customer Name", loan.customer_name],
    ["Father / Husband Name", loan.father_husband || "-"],
    ["Customer ID / User ID", loan.login_id || loan.mobile || "-"],
    ["Registered Mobile", loan.mobile || "-"],
    ["Email", loan.email || "-"],
    ["Address", loan.address || "-"]
  ];
  customerRows.forEach(([a,b]) => {
    doc.fontSize(10).font("Helvetica-Bold").text(`${a}: `, { continued: true });
    doc.font("Helvetica").text(String(b));
  });

  doc.moveDown(0.7);
  doc.fontSize(12).font("Helvetica-Bold").text("2. Loan Details");
  doc.moveDown(0.25);
  const loanRows = [
    ["Loan ID", loan.loan_id],
    ["Loan Product", loan.product],
    ["Principal / Loan Amount", `INR ${Number(loan.principal || 0).toLocaleString("en-IN")}`],
    ["Outstanding Amount", `INR ${Number(loan.outstanding || 0).toLocaleString("en-IN")}`],
    ["Interest Rate", `${Number(loan.interest_rate || 0)}%`],
    ["EMI Amount", `INR ${Number(loan.emi || 0).toLocaleString("en-IN")}`],
    ["Loan Duration", `${Number(loan.duration_days || 0)} days`],
    ["Payment Frequency", String(loan.payment_frequency || "monthly").toUpperCase()],
    ["Loan Start Date", formatDate(loan.start_date)],
    ["Current Status", loan.status || "active"],
    ["Current DPD", String(loan.dpd || 0)]
  ];
  loanRows.forEach(([a,b]) => {
    doc.fontSize(10).font("Helvetica-Bold").text(`${a}: `, { continued: true });
    doc.font("Helvetica").text(String(b));
  });

  const paid = db.prepare("SELECT COALESCE(SUM(amount),0) total FROM loan_payments WHERE loan_id=?").get(loan.id).total || 0;
  doc.moveDown(0.7);
  doc.fontSize(12).font("Helvetica-Bold").text("3. Payment Summary");
  doc.moveDown(0.25);
  doc.fontSize(10).font("Helvetica").text(`Total payments recorded: INR ${Number(paid).toLocaleString("en-IN")}`);
  doc.text(`Current outstanding: INR ${Number(loan.outstanding || 0).toLocaleString("en-IN")}`);

  doc.moveDown(0.7);
  doc.fontSize(12).font("Helvetica-Bold").text("4. Agreement");
  doc.moveDown(0.3);
  doc.fontSize(9.5).font("Helvetica").text(
    "The customer confirms that the above customer and loan information has been provided for this loan record. " +
    "The customer agrees to repay the applicable loan dues according to the agreed repayment schedule and the terms communicated by the lending institution. " +
    "This document is a record of the loan details and customer acknowledgement."
  );

  doc.moveDown(0.7);
  doc.fontSize(8.5).font("Helvetica").text(
    "Important: This digitally generated document should be used together with the institution's applicable loan terms, disclosures, KYC/consent records and any legally required e-sign/e-stamp process."
  );

  doc.moveDown(1);
  doc.fontSize(10).font("Helvetica-Bold").text("Customer Signature / Acknowledgement");
  doc.moveDown(0.3);
  if (loan.signature_data && /^data:image\/png;base64,/.test(loan.signature_data)) {
    try {
      const img = Buffer.from(loan.signature_data.split(",")[1], "base64");
      doc.image(img, { fit: [220, 80], align: "left" });
      doc.moveDown(0.2);
      doc.fontSize(9).font("Helvetica").text(`Signed electronically on: ${formatDate(loan.signed_at)}`);
    } catch (_) {
      doc.fontSize(9).font("Helvetica").text("Signature image could not be rendered.");
    }
  } else {
    doc.rect(45, doc.y, 220, 75).stroke();
    doc.fontSize(9).font("Helvetica").text("Customer signature", 55, doc.y + 55);
  }

  doc.moveDown(1.2);
  doc.fontSize(10).font("Helvetica-Bold").text("For Emergency Sanstha PVT LTD");
  doc.fontSize(9).font("Helvetica").text("Authorized Representative");
  doc.moveDown(0.8);
  doc.fontSize(8).text("Loan ID: " + loan.loan_id);
  doc.end();
}

app.get("/api/admin/loans/:id/agreement.pdf", auth, roles("admin"), (req, res) => {
  const loan = loanAgreementData(Number(req.params.id));
  if (!loan) return res.status(404).json({ error: "Loan not found" });
  if (!loan.agreement_created_at) {
    db.prepare("UPDATE loans SET agreement_created_at=? WHERE id=?").run(new Date().toISOString(), loan.id);
    loan.agreement_created_at = new Date().toISOString();
  }
  return buildLoanAgreementPdf(loan, res);
});

app.get("/api/customer/loans/:id/agreement.pdf", auth, roles("customer", "investor"), (req, res) => {
  const loan = loanAgreementData(Number(req.params.id), req.user.id);
  if (!loan) return res.status(404).json({ error: "Loan not found" });
  if (!loan.agreement_created_at) {
    db.prepare("UPDATE loans SET agreement_created_at=? WHERE id=?").run(new Date().toISOString(), loan.id);
    loan.agreement_created_at = new Date().toISOString();
  }
  return buildLoanAgreementPdf(loan, res);
});

app.post("/api/customer/loans/:id/sign-agreement", auth, roles("customer", "investor"), (req, res) => {
  const loan = loanAgreementData(Number(req.params.id), req.user.id);
  if (!loan) return res.status(404).json({ error: "Loan not found" });

  const signature = String(req.body?.signature_data || "");
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature)) {
    return res.status(400).json({ error: "Valid signature is required" });
  }
  if (signature.length > 700000) {
    return res.status(400).json({ error: "Signature image is too large" });
  }

  const signedAt = new Date().toISOString();
  db.prepare(`
    UPDATE loans
    SET signature_data=?, signed_at=?, agreement_created_at=COALESCE(agreement_created_at,?)
    WHERE id=? AND customer_id=?
  `).run(signature, signedAt, signedAt, loan.id, req.user.id);

  return res.json({
    message: "Loan agreement signed successfully",
    signed_at: signedAt,
    loan_id: loan.loan_id
  });
});

app.get("/api/admin/loans/:id/agreement-status", auth, roles("admin"), (req, res) => {
  const loan = db.prepare("SELECT id, loan_id, signature_data, signed_at, agreement_created_at FROM loans WHERE id=? LIMIT 1").get(req.params.id);
  if (!loan) return res.status(404).json({ error: "Loan not found" });
  return res.json({
    loan_id: loan.loan_id,
    signed: Boolean(loan.signature_data),
    signed_at: loan.signed_at || null,
    agreement_created_at: loan.agreement_created_at || null
  });
});

/* =====================================================
   ADMIN APIs
===================================================== */

/* -----------------------------
   Admin Stats
----------------------------- */

app.get(
  "/api/admin/stats",
  auth,
  roles("admin"),
  (req, res) => {

    const customers =
      db.prepare(`
        SELECT COUNT(*) c
        FROM users
        WHERE role IN ('customer','investor')
      `).get().c;

    const loans =
      db.prepare(`
        SELECT COUNT(*) c
        FROM loans
      `).get().c;

    const investments =
      db.prepare(`
        SELECT COALESCE(SUM(
          i.amount
          + COALESCE((SELECT SUM(t.amount) FROM investment_transactions t
                     WHERE t.investment_id=i.id AND t.type='deposit'),0)
          - COALESCE((SELECT SUM(t.amount) FROM investment_transactions t
                     WHERE t.investment_id=i.id AND t.type='withdrawal'),0)
        ),0) s
        FROM investments i
        WHERE i.status='active'
      `).get().s;

    const outstanding =
      db.prepare(`
        SELECT
          COALESCE(SUM(outstanding),0) s
        FROM loans
      `).get().s;

    return res.json({
      customers,
      loans,
      investments,
      outstanding
    });
  }
);

/* -----------------------------
   Admin Customers
----------------------------- */

app.get(
  "/api/admin/customers",
  auth,
  roles("admin"),
  (req, res) => {

    return res.json(
      db.prepare(`
        SELECT
          id,
          role,
          name,
          father_husband,
          mobile,
          email,
          address,
          language,
          status,
          created_at
        FROM users
        WHERE role IN ('customer','investor')
        ORDER BY id DESC
      `).all()
    );
  }
);

/* -----------------------------
   Add Customer
----------------------------- */

app.post(
  "/api/admin/customers",
  auth,
  roles("admin"),
  (req, res) => {

    const {
      role = "customer",
      name,
      father_husband,
      mobile,
      email,
      address,
      language = "Hindi",
      password = ""
    } = req.body;

    if (!name || !mobile) {

      return res.status(400).json({
        error:
          "Name and mobile are required"
      });
    }

    const normalizedMobile = String(mobile)
      .replace(/\D/g, "")
      .replace(/^91(?=\d{10}$)/, "");

    if (!/^[6-9]\d{9}$/.test(normalizedMobile)) {
      return res.status(400).json({
        error: "Enter a valid 10-digit Indian mobile number"
      });
    }

    try {

      const finalRole =
        role === "investor"
          ? "investor"
          : "customer";

      const result = db.prepare(`
        INSERT INTO users
        (
          role,
          name,
          father_husband,
          mobile,
          email,
          address,
          language,
          login_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        finalRole,
        name,
        father_husband || "",
        normalizedMobile,
        email || "",
        address || "",
        language,
        normalizedMobile
      );

      let credentials = {
        login_id: normalizedMobile,
        temporary_password: null
      };

      // Password is optional at customer creation. If Admin does not set one,
      // the password is generated when the first loan is created.
      if (String(password || "").trim()) {
        credentials = ensureCustomerCredentials(
          result.lastInsertRowid,
          password
        );
      }

      return res.json({
        user: safeUser(result.lastInsertRowid),
        customer_user_id: credentials.login_id,
        temporary_password: credentials.temporary_password,
        message: credentials.temporary_password
          ? `Customer created. User ID: ${credentials.login_id} | Password: ${credentials.temporary_password}`
          : `Customer created. User ID: ${credentials.login_id}. Password will be generated when the loan is created.`
      });

    } catch (error) {

      console.error(
        "Customer creation error:",
        error
      );

      return res.status(400).json({
        error:
          "Mobile may already exist"
      });
    }
  }
);

/* -----------------------------
   Update Customer
----------------------------- */

app.put(
  "/api/admin/customers/:id",
  auth,
  roles("admin"),
  (req, res) => {

    const {
      name,
      father_husband,
      mobile,
      email,
      address,
      language,
      status,
      role
    } = req.body;

    db.prepare(`
      UPDATE users
      SET
        name=?,
        father_husband=?,
        mobile=?,
        email=?,
        address=?,
        language=?,
        status=?,
        role=?
      WHERE id=?
    `).run(
      name || "Customer",
      father_husband || "",
      mobile || "",
      email || "",
      address || "",
      language || "Hindi",
      status || "active",
      role === "investor"
        ? "investor"
        : "customer",
      req.params.id
    );

    return res.json({
      user:
        safeUser(req.params.id)
    });
  }
);

/* -----------------------------
   Delete Customer (only after all loans are cleared)
----------------------------- */
app.delete("/api/admin/customers/:id", auth, roles("admin"), (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "Invalid customer ID" });
  }

  const customer = db.prepare(`
    SELECT id, role, name
    FROM users
    WHERE id=? AND role IN ('customer','investor')
    LIMIT 1
  `).get(userId);

  if (!customer) {
    return res.status(404).json({ error: "Customer not found" });
  }

  const loans = db.prepare(`
    SELECT id, loan_id, outstanding, status
    FROM loans
    WHERE customer_id=?
  `).all(userId);

  const activeLoan = loans.find(l => {
    const outstanding = Number(l.outstanding || 0);
    const status = String(l.status || "").toLowerCase();
    return outstanding > 0 && !["cleared", "closed"].includes(status);
  });

  if (activeLoan) {
    return res.status(400).json({
      error: "Customer cannot be deleted while a loan has outstanding amount. Clear the loan first."
    });
  }

  try {
    const transaction = db.transaction(() => {
      // Delete all child records first because SQLite foreign keys are enabled.
      db.prepare("DELETE FROM closure_requests WHERE customer_id=?").run(userId);
      db.prepare("DELETE FROM service_requests WHERE customer_id=?").run(userId);
      db.prepare("DELETE FROM mandates WHERE customer_id=?").run(userId);
      db.prepare("DELETE FROM documents WHERE customer_id=?").run(userId);
      db.prepare("DELETE FROM investment_transactions WHERE customer_id=?").run(userId);
      // Delete investment transactions by investment_id as well, including older
      // records whose customer_id may not match the parent investment.
      const investments = db.prepare("SELECT id FROM investments WHERE customer_id=?").all(userId);
      for (const investment of investments) {
        db.prepare("DELETE FROM investment_transactions WHERE investment_id=?").run(investment.id);
      }
      db.prepare("DELETE FROM investments WHERE customer_id=?").run(userId);
      db.prepare("DELETE FROM loan_payments WHERE customer_id=?").run(userId);
      db.prepare("DELETE FROM loan_adjustments WHERE customer_id=?").run(userId);

      // Also remove loan child records by loan_id in case older records have a mismatched customer_id.
      for (const loan of loans) {
        db.prepare("DELETE FROM loan_payments WHERE loan_id=?").run(loan.id);
        db.prepare("DELETE FROM loan_adjustments WHERE loan_id=?").run(loan.id);
      }

      db.prepare("DELETE FROM loans WHERE customer_id=?").run(userId);
      const deleted = db.prepare("DELETE FROM users WHERE id=? AND role IN ('customer','investor')").run(userId);
      if (deleted.changes !== 1) throw new Error("Customer record could not be deleted");
    });

    transaction();
    return res.json({ message: `Customer ${customer.name} deleted successfully` });
  } catch (error) {
    console.error("Customer delete error:", error);
    return res.status(500).json({
      error: "Customer delete failed: " + (error.message || "database error")
    });
  }
});

/* -----------------------------
   Admin Loans
----------------------------- */

app.get(
  "/api/admin/loans",
  auth,
  roles("admin"),
  (req, res) => {

    return res.json(
      db.prepare(`
        SELECT
          loans.*,
          users.name customer_name,
          users.mobile,
          COALESCE((SELECT SUM(amount) FROM loan_payments WHERE loan_payments.loan_id=loans.id), 0) AS total_paid,
          COALESCE((SELECT SUM(amount) FROM loan_adjustments WHERE loan_adjustments.loan_id=loans.id AND loan_adjustments.type='interest'), 0) AS total_interest,
          COALESCE((SELECT SUM(amount) FROM loan_adjustments WHERE loan_adjustments.loan_id=loans.id AND loan_adjustments.type='penalty'), 0) AS total_penalty,
          COALESCE((SELECT SUM(amount) FROM loan_adjustments WHERE loan_adjustments.loan_id=loans.id AND loan_adjustments.type IN ('add','interest','penalty')), 0) AS total_added,
          COALESCE((SELECT SUM(amount) FROM loan_adjustments WHERE loan_adjustments.loan_id=loans.id AND loan_adjustments.type='subtract'), 0) AS total_subtracted
        FROM loans
        JOIN users
          ON users.id=loans.customer_id
        ORDER BY loans.id DESC
      `).all()
    );
  }
);

/* -----------------------------
   Add Loan
----------------------------- */

app.post(
  "/api/admin/loans",
  auth,
  roles("admin"),
  (req, res) => {

    const {
      customer_id,
      product,
      principal,
      outstanding,
      interest_rate,
      emi,
      dpd,
      start_date,
      duration_days,
      payment_frequency = "monthly",
      password = "",
      status = "active"
    } = req.body;

    if (!customer_id || !product) {

      return res.status(400).json({
        error:
          "Customer and product are required"
      });
    }

    const loan_id =
      idCode("LN");

    const agreementCreatedAt = new Date().toISOString();
    db.prepare(`
      INSERT INTO loans
      (
        customer_id,
        loan_id,
        product,
        principal,
        outstanding,
        interest_rate,
        emi,
        dpd,
        start_date,
        duration_days,
        payment_frequency,
        status,
        agreement_created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      customer_id,
      loan_id,
      product,
      Number(principal) || 0,
      Number(outstanding) || 0,
      Number(interest_rate) || 0,
      Number(emi) || 0,
      Number(dpd) || 0,
      start_date || "",
      Math.max(0, Number(duration_days) || 0),
      ["weekly", "monthly"].includes(String(payment_frequency).toLowerCase())
        ? String(payment_frequency).toLowerCase()
        : "monthly",
      status,
      agreementCreatedAt
    );

    const credentials =
      ensureCustomerCredentials(
        Number(customer_id),
        password
      );

    return res.json({
      loan_id,
      customer_id: Number(customer_id),
      customer_user_id:
        credentials.login_id,
      temporary_password:
        credentials.temporary_password,
      password_generated:
        Boolean(
          credentials.temporary_password
        ),
      message:
        credentials.temporary_password
          ? `Loan created. Customer User ID: ${credentials.login_id} | Password: ${credentials.temporary_password}`
          : `Loan created. Customer Login ID: ${credentials.login_id}. Existing password kept.`
    });
  }
);


/* -----------------------------
   Admin: Reset Customer Login
----------------------------- */

app.post(
  "/api/admin/customers/:id/reset-login",
  auth,
  roles("admin"),
  (req, res) => {
    try {
      const userId = Number(req.params.id);
      const user = db.prepare(`
        SELECT id, mobile, role, status
        FROM users
        WHERE id=?
          AND role IN ('customer','investor')
        LIMIT 1
      `).get(userId);

      if (!user) {
        return res.status(404).json({ error: "Customer not found" });
      }

      const loginId = customerLoginId(userId);
      const password = generateCustomerPassword();

      db.prepare(`
        UPDATE users
        SET login_id=?, password_hash=?, status='active'
        WHERE id=?
      `).run(
        loginId,
        bcrypt.hashSync(password, 12),
        userId
      );

      return res.json({
        customer_id: userId,
        customer_user_id: loginId,
        temporary_password: password,
        message: `Customer login reset. Login ID: ${loginId} | Password: ${password}`
      });
    } catch (error) {
      console.error("Customer login reset error:", error);
      return res.status(500).json({ error: "Unable to reset customer login" });
    }
  }
);

/* -----------------------------
   Update Loan
----------------------------- */

app.put(
  "/api/admin/loans/:id",
  auth,
  roles("admin"),
  (req, res) => {

    const {
      product,
      principal,
      outstanding,
      interest_rate,
      emi,
      dpd,
      start_date,
      duration_days,
      payment_frequency,
      status
    } = req.body;

    db.prepare(`
      UPDATE loans
      SET
        product=?,
        principal=?,
        outstanding=?,
        interest_rate=?,
        emi=?,
        dpd=?,
        start_date=?,
        duration_days=?,
        payment_frequency=?,
        status=?
      WHERE id=?
    `).run(
      product,
      Number(principal) || 0,
      Number(outstanding) || 0,
      Number(interest_rate) || 0,
      Number(emi) || 0,
      Number(dpd) || 0,
      start_date || "",
      Math.max(0, Number(duration_days) || 0),
      ["weekly", "monthly"].includes(String(payment_frequency).toLowerCase())
        ? String(payment_frequency).toLowerCase()
        : "monthly",
      status || "active",
      req.params.id
    );

    return res.json({
      message:
        "Loan updated"
    });
  }
);

/* -----------------------------
   Mark Loan Cleared
----------------------------- */
app.post("/api/admin/loans/:id/clear", auth, roles("admin"), (req, res) => {
  const loan = db.prepare("SELECT id FROM loans WHERE id=? LIMIT 1").get(req.params.id);
  if (!loan) return res.status(404).json({ error: "Loan not found" });

  db.prepare(`
    UPDATE loans
    SET outstanding=0, status='cleared'
    WHERE id=?
  `).run(req.params.id);

  return res.json({ message: "Loan marked as cleared" });
});

/* -----------------------------
   Delete Cleared Loan
----------------------------- */
app.delete("/api/admin/loans/:id", auth, roles("admin"), (req, res) => {
  const loan = db.prepare(`
    SELECT id, loan_id, outstanding, status
    FROM loans
    WHERE id=?
    LIMIT 1
  `).get(req.params.id);

  if (!loan) return res.status(404).json({ error: "Loan not found" });

  const cleared =
    Number(loan.outstanding || 0) <= 0 ||
    ["cleared", "closed"].includes(String(loan.status).toLowerCase());

  if (!cleared) {
    return res.status(400).json({
      error: "Only cleared/closed loans can be deleted"
    });
  }

  try {
    const tx = db.transaction(() => {
      // loan_adjustments and loan_payments reference loans.id, so they must
      // be removed before deleting the parent loan.
      db.prepare("DELETE FROM closure_requests WHERE loan_id=?").run(loan.loan_id);
      db.prepare("DELETE FROM loan_payments WHERE loan_id=?").run(loan.id);
      db.prepare("DELETE FROM loan_adjustments WHERE loan_id=?").run(loan.id);
      db.prepare("DELETE FROM loans WHERE id=?").run(req.params.id);
    });
    tx();
  } catch (error) {
    console.error("Loan delete error:", error);
    return res.status(500).json({
      error: "Loan delete failed: " + (error.message || "database error")
    });
  }

  return res.json({ message: "Cleared loan deleted successfully" });
});

/* -----------------------------
   Admin Loan Payments / Collections
----------------------------- */
app.get("/api/admin/payments", auth, roles("admin"), (req, res) => {
  return res.json(db.prepare(`
    SELECT loan_payments.*, loans.loan_id AS loan_code,
           users.name AS customer_name, users.mobile
    FROM loan_payments
    JOIN loans ON loans.id=loan_payments.loan_id
    JOIN users ON users.id=loan_payments.customer_id
    ORDER BY loan_payments.payment_date DESC, loan_payments.id DESC
  `).all());
});

app.post("/api/admin/loans/:id/payments", auth, roles("admin"), (req, res) => {
  const loan = db.prepare(`
    SELECT id, loan_id, customer_id, outstanding, status
    FROM loans WHERE id=? LIMIT 1
  `).get(req.params.id);

  if (!loan) return res.status(404).json({ error: "Loan not found" });

  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Valid payment amount is required" });
  }

  const currentOutstanding = Math.max(0, Number(loan.outstanding || 0));
  if (amount > currentOutstanding) {
    return res.status(400).json({
      error: `Payment cannot exceed outstanding amount ${currentOutstanding}`
    });
  }

  const paymentDate = String(req.body.payment_date || new Date().toISOString().slice(0, 10));
  const note = String(req.body.note || "").trim();

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO loan_payments (loan_id, customer_id, amount, payment_date, note)
      VALUES (?, ?, ?, ?, ?)
    `).run(loan.id, loan.customer_id, amount, paymentDate, note);

    const newOutstanding = Math.max(0, currentOutstanding - amount);
    const newStatus = newOutstanding <= 0 ? "cleared" : (loan.status === "cleared" ? "active" : loan.status);

    db.prepare(`
      UPDATE loans SET outstanding=?, status=? WHERE id=?
    `).run(newOutstanding, newStatus, loan.id);

    return { newOutstanding, newStatus };
  });

  const result = tx();
  return res.json({
    message: result.newOutstanding <= 0
      ? "Payment saved. Loan is now cleared."
      : "Payment saved successfully.",
    loan_id: loan.loan_id,
    amount,
    outstanding: result.newOutstanding
  });
});

app.get("/api/admin/loans/:id/payments", auth, roles("admin"), (req, res) => {
  const loan = db.prepare("SELECT id FROM loans WHERE id=? LIMIT 1").get(req.params.id);
  if (!loan) return res.status(404).json({ error: "Loan not found" });

  return res.json(db.prepare(`
    SELECT id, loan_id, amount, payment_date, note, created_at
    FROM loan_payments
    WHERE loan_id=?
    ORDER BY id DESC
  `).all(loan.id));
});

/* -----------------------------
   Loan Interest / Penalty / +/- Adjustments
----------------------------- */
app.get("/api/admin/loans/:id/transactions", auth, roles("admin"), (req, res) => {
  const loan = db.prepare("SELECT id FROM loans WHERE id=? LIMIT 1").get(req.params.id);
  if (!loan) return res.status(404).json({ error: "Loan not found" });

  const rows = db.prepare(`
    SELECT id, 'payment' AS type, amount, payment_date AS transaction_date, note, created_at
    FROM loan_payments WHERE loan_id=?
    UNION ALL
    SELECT id, type, amount, transaction_date, note, created_at
    FROM loan_adjustments WHERE loan_id=?
    ORDER BY transaction_date DESC, id DESC
  `).all(loan.id, loan.id);
  return res.json(rows);
});

app.get("/api/admin/loan-transactions", auth, roles("admin"), (req, res) => {
  const rows = db.prepare(`
    SELECT lp.loan_id AS loan_id, l.loan_id AS loan_code, c.name AS customer_name, c.mobile,
           'payment' AS type, lp.amount, lp.payment_date AS transaction_date, lp.note, lp.created_at
    FROM loan_payments lp
    JOIN loans l ON l.id=lp.loan_id
    JOIN users c ON c.id=l.customer_id AND c.role IN ('customer','investor')
    UNION ALL
    SELECT la.loan_id AS loan_id, l.loan_id AS loan_code, c.name AS customer_name, c.mobile,
           la.type, la.amount, la.transaction_date, la.note, la.created_at
    FROM loan_adjustments la
    JOIN loans l ON l.id=la.loan_id
    JOIN users c ON c.id=l.customer_id AND c.role IN ('customer','investor')
    ORDER BY transaction_date DESC, created_at DESC
  `).all();
  return res.json(rows);
});

app.post("/api/admin/loans/:id/adjustments", auth, roles("admin"), (req, res) => {
  const loan = db.prepare(`
    SELECT id, loan_id, customer_id, outstanding, status
    FROM loans WHERE id=? LIMIT 1
  `).get(req.params.id);
  if (!loan) return res.status(404).json({ error: "Loan not found" });

  const type = String(req.body.type || "");
  if (!["interest","penalty","add","subtract"].includes(type)) {
    return res.status(400).json({ error: "Invalid adjustment type" });
  }
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Enter a valid amount" });
  }
  const transactionDate = String(req.body.transaction_date || new Date().toISOString().slice(0,10));
  const note = String(req.body.note || "").trim();
  const current = Math.max(0, Number(loan.outstanding || 0));
  if (type === "subtract" && amount > current) {
    return res.status(400).json({ error: `Amount cannot exceed current outstanding ${current}` });
  }

  const delta = ["interest","penalty","add"].includes(type) ? amount : -amount;
  const next = Math.max(0, current + delta);
  const status = next <= 0 ? "cleared" : (loan.status === "cleared" ? "active" : loan.status);

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO loan_adjustments
      (loan_id, customer_id, type, amount, transaction_date, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(loan.id, loan.customer_id, type, amount, transactionDate, note);
    db.prepare("UPDATE loans SET outstanding=?, status=? WHERE id=?").run(next, status, loan.id);
  });
  tx();

  return res.json({
    message: type === "interest" ? "Interest added successfully"
      : type === "penalty" ? "Penalty added successfully"
      : type === "add" ? "Loan amount increased successfully"
      : "Loan amount reduced successfully",
    loan_id: loan.loan_id,
    outstanding: next
  });
});

/* -----------------------------
   Admin Investments
----------------------------- */

app.get(
  "/api/admin/investments",
  auth,
  roles("admin"),
  (req, res) => {
    return res.json(
      db.prepare(`
        SELECT
          i.*,
          u.name AS customer_name,
          u.mobile,
          COALESCE((SELECT SUM(t.amount) FROM investment_transactions t
                    WHERE t.investment_id=i.id AND t.type='deposit'),0) AS deposit_total,
          COALESCE((SELECT SUM(t.amount) FROM investment_transactions t
                    WHERE t.investment_id=i.id AND t.type='withdrawal'),0) AS withdrawal_total,
          (
            i.amount
            + COALESCE((SELECT SUM(t.amount) FROM investment_transactions t
                        WHERE t.investment_id=i.id AND t.type='deposit'),0)
            - COALESCE((SELECT SUM(t.amount) FROM investment_transactions t
                        WHERE t.investment_id=i.id AND t.type='withdrawal'),0)
          ) AS balance
        FROM investments i
        JOIN users u ON u.id=i.customer_id
        ORDER BY i.id DESC
      `).all()
    );
  }
);

/* -----------------------------
   Add New Investment
----------------------------- */

app.post(
  "/api/admin/investments",
  auth,
  roles("admin"),
  (req, res) => {
    const {
      customer_id,
      amount,
      investment_date,
      relation_name,
      status = "active"
    } = req.body;

    if (!customer_id || !amount || !investment_date) {
      return res.status(400).json({
        error: "Investor, amount and date are required"
      });
    }

    const customer = db.prepare(`
      SELECT id FROM users
      WHERE id=? AND role='investor'
      LIMIT 1
    `).get(customer_id);

    if (!customer) {
      return res.status(400).json({ error: "Select a valid investor customer" });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: "Enter a valid investment amount" });
    }

    const investment_id = idCode("INV");

    db.prepare(`
      INSERT INTO investments
      (customer_id, investment_id, amount, investment_date, relation_name, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      customer_id,
      investment_id,
      numericAmount,
      investment_date,
      String(relation_name || "").trim(),
      status
    );

    return res.json({
      investment_id,
      message: "New investment added successfully"
    });
  }
);

/* -----------------------------
   Investment Transactions
----------------------------- */

app.get(
  "/api/admin/investment-transactions",
  auth,
  roles("admin"),
  (req, res) => {
    return res.json(
      db.prepare(`
        SELECT
          t.*,
          i.investment_id AS investment_code,
          u.name AS customer_name,
          u.mobile
        FROM investment_transactions t
        JOIN investments i ON i.id=t.investment_id
        JOIN users u ON u.id=t.customer_id
        ORDER BY t.id DESC
      `).all()
    );
  }
);

app.post(
  "/api/admin/investment-transactions",
  auth,
  roles("admin"),
  (req, res) => {
    const {
      investment_id,
      type,
      amount,
      transaction_date,
      note
    } = req.body;

    if (!investment_id || !["deposit", "withdrawal"].includes(type) || !amount || !transaction_date) {
      return res.status(400).json({
        error: "Investment, transaction type, amount and date are required"
      });
    }

    const investment = db.prepare(`
      SELECT
        i.id,
        i.customer_id,
        i.investment_id,
        i.status,
        (
          i.amount
          + COALESCE((SELECT SUM(t.amount) FROM investment_transactions t
                      WHERE t.investment_id=i.id AND t.type='deposit'),0)
          - COALESCE((SELECT SUM(t.amount) FROM investment_transactions t
                      WHERE t.investment_id=i.id AND t.type='withdrawal'),0)
        ) AS balance
      FROM investments i
      WHERE i.id=?
      LIMIT 1
    `).get(investment_id);

    if (!investment) {
      return res.status(404).json({ error: "Investment not found" });
    }

    if (investment.status !== "active") {
      return res.status(400).json({ error: "Only active investments can receive transactions" });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: "Enter a valid amount" });
    }

    if (type === "withdrawal" && numericAmount > Number(investment.balance)) {
      return res.status(400).json({
        error: `Withdrawal cannot exceed current balance ${investment.balance}`
      });
    }

    db.prepare(`
      INSERT INTO investment_transactions
      (investment_id, customer_id, type, amount, transaction_date, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      investment.id,
      investment.customer_id,
      type,
      numericAmount,
      transaction_date,
      String(note || "").trim()
    );

    const newBalance =
      Number(investment.balance) +
      (type === "deposit" ? numericAmount : -numericAmount);

    return res.json({
      message: type === "deposit"
        ? "Investment deposit saved successfully"
        : "Investment withdrawal saved successfully",
      balance: newBalance
    });
  }
);

/* -----------------------------
   Admin Requests
----------------------------- */

app.get(
  "/api/admin/requests",
  auth,
  roles("admin"),
  (req, res) => {

    return res.json(
      db.prepare(`
        SELECT
          service_requests.*,
          users.name customer_name,
          users.mobile
        FROM service_requests
        JOIN users
          ON users.id=service_requests.customer_id
        ORDER BY service_requests.id DESC
      `).all()
    );
  }
);

app.put(
  "/api/admin/requests/:id",
  auth,
  roles("admin"),
  (req, res) => {

    db.prepare(`
      UPDATE service_requests
      SET status=?
      WHERE id=?
    `).run(
      req.body.status || "open",
      req.params.id
    );

    return res.json({
      message:
        "Request status updated"
    });
  }
);

/* -----------------------------
   Admin Mandates
----------------------------- */

app.get(
  "/api/admin/mandates",
  auth,
  roles("admin"),
  (req, res) => {

    return res.json(
      db.prepare(`
        SELECT
          mandates.*,
          users.name customer_name,
          users.mobile
        FROM mandates
        JOIN users
          ON users.id=mandates.customer_id
        ORDER BY mandates.id DESC
      `).all()
    );
  }
);

app.put(
  "/api/admin/mandates/:id",
  auth,
  roles("admin"),
  (req, res) => {

    db.prepare(`
      UPDATE mandates
      SET status=?
      WHERE id=?
    `).run(
      req.body.status || "pending",
      req.params.id
    );

    return res.json({
      message:
        "Mandate updated"
    });
  }
);

/* -----------------------------
   Admin Closures
----------------------------- */

app.get(
  "/api/admin/closures",
  auth,
  roles("admin"),
  (req, res) => {

    return res.json(
      db.prepare(`
        SELECT
          closure_requests.*,
          users.name customer_name,
          users.mobile
        FROM closure_requests
        JOIN users
          ON users.id=closure_requests.customer_id
        ORDER BY closure_requests.id DESC
      `).all()
    );
  }
);

app.put(
  "/api/admin/closures/:id",
  auth,
  roles("admin"),
  (req, res) => {

    db.prepare(`
      UPDATE closure_requests
      SET status=?
      WHERE id=?
    `).run(
      req.body.status || "pending",
      req.params.id
    );

    return res.json({
      message:
        "Closure request updated"
    });
  }
);

/* -----------------------------
   Admin Documents
----------------------------- */

app.get(
  "/api/admin/documents",
  auth,
  roles("admin"),
  (req, res) => {

    return res.json(
      db.prepare(`
        SELECT
          documents.*,
          users.name customer_name,
          users.mobile
        FROM documents
        JOIN users
          ON users.id=documents.customer_id
        ORDER BY documents.id DESC
      `).all()
    );
  }
);

/* -----------------------------
   CSV Export
----------------------------- */

app.get(
  "/api/admin/export/:type",
  auth,
  roles("admin"),
  (req, res) => {

    const type =
      req.params.type;

    let rows = [];

    if (type === "customers") {

      rows = db.prepare(`
        SELECT *
        FROM users
        WHERE role IN ('customer','investor')
      `).all();

    } else if (type === "loans") {

      rows = db.prepare(
        "SELECT * FROM loans"
      ).all();

    } else if (type === "investments") {

      rows = db.prepare(
        "SELECT * FROM investments"
      ).all();

    } else {

      return res.status(400).json({
        error:
          "Unsupported export"
      });
    }

    const cols =
      Object.keys(
        rows[0] || { id: "" }
      );

    const csv = [
      cols.join(","),
      ...rows.map(row =>
        cols.map(col =>
          `"${String(
            row[col] ?? ""
          ).replaceAll('"', '""')}"`
        ).join(",")
      )
    ].join("\n");

    res.setHeader(
      "Content-Type",
      "text/csv"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${type}.csv`
    );

    return res.send(csv);
  }
);

/* -----------------------------
   Frontend
----------------------------- */

app.get("*", (req, res) => {

  if (
    req.path.startsWith("/api/")
  ) {

    return res.status(404).json({
      error:
        "API route not found"
    });
  }

  return res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

/* -----------------------------
   Start Server
----------------------------- */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Emergency Sanstha Portal running on port ${PORT}`
    );

    console.log(
      "Admin configuration loaded."
    );
  }
);

// 🌐 Web Monitor v2 – Inteligentný monitoring s cenami a notifikáciami
require("dotenv").config();
const express = require("express");
const nodemailer = require("nodemailer");
const puppeteer = require("puppeteer");
const Database = require("better-sqlite3");
const admin = require("firebase-admin");

const app = express();
const PORT = 3000;

// ═══════════════════════════════════════════
// 📦 DATABÁZA (SQLite – dáta prežijú reštart)
// ═══════════════════════════════════════════
const db = new Database("monitor.db");

db.exec(`
    CREATE TABLE IF NOT EXISTS uzivatelia (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        fcm_token TEXT,
        vytvoreny TEXT DEFAULT (datetime('now'))
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS monitory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uzivatel_id INTEGER NOT NULL,
        stranka TEXT NOT NULL,
        klucove_slova TEXT NOT NULL,
        cena_od REAL,
        cena_do REAL,
        stav TEXT DEFAULT '⏳ Čakám...',
        posledna_kontrola TEXT,
        posledny_nalez TEXT,
        aktivny INTEGER DEFAULT 1,
        vytvoreny TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (uzivatel_id) REFERENCES uzivatelia(id)
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS historia (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        monitor_id INTEGER NOT NULL,
        najdeny_text TEXT,
        najdena_cena REAL,
        cas TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (monitor_id) REFERENCES monitory(id)
    )
`);

// ═══════════════════════════════════════════
// 🔧 CORS + Middleware
// ═══════════════════════════════════════════
app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, PUT, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ═══════════════════════════════════════════
// 📧 EMAIL
// ═══════════════════════════════════════════
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});

async function posliEmail(komu, predmet, sprava) {
    try {
        await transporter.sendMail({
            from: "Web Monitor <" + process.env.GMAIL_USER + ">",
            to: komu,
            subject: predmet,
            html: sprava
        });
        console.log("📧 Email odoslaný na: " + komu);
    } catch (chyba) {
        console.log("🚨 Email chyba: " + chyba.message);
    }
}

// ═══════════════════════════════════════════
// 📱 PUSH NOTIFIKÁCIE (Firebase)
// ═══════════════════════════════════════════
let firebaseReady = false;

if (process.env.FIREBASE_CREDENTIALS) {
    try {
        const creds = JSON.parse(process.env.FIREBASE_CREDENTIALS);
        admin.initializeApp({
            credential: admin.credential.cert(creds)
        });
        firebaseReady = true;
        console.log("🔥 Firebase pripravený na push notifikácie");
    } catch (e) {
        console.log("⚠️ Firebase neaktívny: " + e.message);
    }
}

async function posliPush(fcmToken, titulok, sprava) {
    if (!firebaseReady || !fcmToken) return;
    try {
        await admin.messaging().send({
            token: fcmToken,
            notification: {
                title: titulok,
                body: sprava
            }
        });
        console.log("📱 Push notifikácia odoslaná!");
    } catch (chyba) {
        console.log("⚠️ Push chyba: " + chyba.message);
    }
}

// ═══════════════════════════════════════════
// 🔍 INTELIGENTNÝ SCRAPING
// ═══════════════════════════════════════════

// Extrahuj všetky ceny zo stránky
function najdiCeny(html) {
    const ceny = [];
    // Hľadá vzory: 50€, 50 €, €50, 50.99€, 50,99 €, 50 EUR, atď.
    const vzory = [
        /(\d(?:[\d\s]*\d)?(?:[.,]\d{1,2})?)\s*€/g,
        /€\s*(\d(?:[\d\s]*\d)?(?:[.,]\d{1,2})?)/g,
        /(\d(?:[\d\s]*\d)?(?:[.,]\d{1,2})?)\s*EUR/gi
    ];

    for (const vzor of vzory) {
        let zhoda;
        while ((zhoda = vzor.exec(html)) !== null) {
            const cislo = zhoda[1].replace(/\s/g, "").replace(",", ".");
            const cena = parseFloat(cislo);
            if (!isNaN(cena) && cena > 0 && cena < 100000) {
                ceny.push(cena);
            }
        }
    }

    return [...new Set(ceny)]; // odstráň duplikáty
}

// Skontroluj jednu stránku
async function skontrolujMonitor(monitor) {
    const cas = new Date().toISOString();
    let browser;

    try {
        browser = await puppeteer.launch({
            executablePath: "/snap/bin/chromium",
            headless: "new",
            args: ["--no-sandbox", "--disable-setuid-sandbox"]
        });
        const page = await browser.newPage();
        await page.goto(monitor.stranka, { waitUntil: "networkidle2", timeout: 30000 });
        const html = await page.content();
        const cistyText = await page.evaluate(function() { return document.body.innerText.toLowerCase(); });
        await browser.close();
        browser = null;

        // 1. Skontroluj kľúčové slová
        const slova = monitor.klucove_slova.toLowerCase().split(",").map(function(s) { return s.trim(); });
        const najdeneSlova = slova.filter(function(slovo) {
            return cistyText.includes(slovo);
        });

        const vsetkyNajdene = najdeneSlova.length === slova.length;

        // 2. Skontroluj ceny (ak sú zadané)
        let cenaOk = true;
        let najdenaCena = null;

        if (monitor.cena_od !== null || monitor.cena_do !== null) {
            const ceny = najdiCeny(html);
            cenaOk = false;

            for (const cena of ceny) {
                const odOk = monitor.cena_od === null || cena >= monitor.cena_od;
                const doOk = monitor.cena_do === null || cena <= monitor.cena_do;
                if (odOk && doOk) {
                    cenaOk = true;
                    najdenaCena = cena;
                    break;
                }
            }
        }

        // 3. Vyhodnotenie
        if (vsetkyNajdene && cenaOk) {
            // NÁJDENÉ!
            const cenaPopis = najdenaCena ? " za " + najdenaCena + "€" : "";

            db.prepare("UPDATE monitory SET stav = ?, posledna_kontrola = ?, posledny_nalez = ? WHERE id = ?")
                .run("✅ Nájdené" + cenaPopis, cas, cas, monitor.id);

            // Ulož do histórie
            db.prepare("INSERT INTO historia (monitor_id, najdeny_text, najdena_cena) VALUES (?, ?, ?)")
                .run(monitor.id, najdeneSlova.join(", "), najdenaCena);

            // Pošli notifikácie
            const uzivatel = db.prepare("SELECT * FROM uzivatelia WHERE id = ?").get(monitor.uzivatel_id);

            if (uzivatel) {
                const emailHtml = `
                    <h1>🔔 Web Monitor – Nájdené!</h1>
                    <p><strong>Stránka:</strong> ${monitor.stranka}</p>
                    <p><strong>Kľúčové slová:</strong> ${monitor.klucove_slova}</p>
                    ${najdenaCena ? "<p><strong>Cena:</strong> " + najdenaCena + " €</p>" : ""}
                    <p><a href="${monitor.stranka}">🔗 Otvoriť stránku</a></p>
                `;

                await posliEmail(
                    uzivatel.email,
                    "🔔 Nájdené: " + monitor.klucove_slova + cenaPopis,
                    emailHtml
                );

                await posliPush(
                    uzivatel.fcm_token,
                    "🔔 Nájdené" + cenaPopis,
                    monitor.klucove_slova + " na " + monitor.stranka
                );
            }

            console.log("  ✅ [" + monitor.id + "] " + monitor.stranka + " – nájdené!" + cenaPopis);
        } else {
            db.prepare("UPDATE monitory SET stav = ?, posledna_kontrola = ? WHERE id = ?")
                .run("❌ Nenájdené", cas, monitor.id);
            console.log("  ❌ [" + monitor.id + "] " + monitor.stranka + " – nenájdené");
        }

    } catch (chyba) {
        if (browser) try { await browser.close(); } catch (_) {}
        db.prepare("UPDATE monitory SET stav = ?, posledna_kontrola = ? WHERE id = ?")
            .run("🚨 Chyba: " + chyba.message, cas, monitor.id);
        console.log("  🚨 [" + monitor.id + "] " + monitor.stranka + " – " + chyba.message);
    }
}

// Skontroluj všetky aktívne monitory
async function skontrolujVsetky() {
    const cas = new Date().toLocaleTimeString("sk-SK");
    const aktivne = db.prepare("SELECT * FROM monitory WHERE aktivny = 1").all();
    console.log("🔍 [" + cas + "] Kontrolujem " + aktivne.length + " stránok...");

    for (const monitor of aktivne) {
        await skontrolujMonitor(monitor);
    }
}

// ═══════════════════════════════════════════
// 🌐 API ENDPOINTY
// ═══════════════════════════════════════════

// --- Registrácia používateľa (prvé spustenie appky) ---
app.post("/api/registracia", function (req, res) {
    const email = req.body.email;
    if (!email) return res.json({ chyba: "Zadaj email!" });

    try {
        const existujuci = db.prepare("SELECT * FROM uzivatelia WHERE email = ?").get(email);
        if (existujuci) {
            return res.json({ ok: true, uzivatel_id: existujuci.id, sprava: "Vitaj späť!" });
        }

        const result = db.prepare("INSERT INTO uzivatelia (email) VALUES (?)").run(email);
        res.json({ ok: true, uzivatel_id: result.lastInsertRowid, sprava: "Registrácia úspešná!" });
    } catch (chyba) {
        res.json({ chyba: chyba.message });
    }
});

// --- Uloženie FCM tokenu pre push notifikácie ---
app.post("/api/fcm-token", function (req, res) {
    const uzivatel_id = req.body.uzivatel_id;
    const fcm_token = req.body.fcm_token;

    if (!uzivatel_id || !fcm_token) return res.json({ chyba: "Chýba uzivatel_id alebo fcm_token!" });

    db.prepare("UPDATE uzivatelia SET fcm_token = ? WHERE id = ?").run(fcm_token, uzivatel_id);
    res.json({ ok: true });
});

// --- Pridanie nového monitoringu ---
app.post("/api/pridaj", function (req, res) {
    const uzivatel_id = req.body.uzivatel_id;
    const stranka = req.body.stranka;
    const klucove_slova = req.body.klucove_slova;
    const cena_od = req.body.cena_od != null && req.body.cena_od !== "" ? Number(req.body.cena_od) : null;
    const cena_do = req.body.cena_do != null && req.body.cena_do !== "" ? Number(req.body.cena_do) : null;

    if (!uzivatel_id || !stranka || !klucove_slova) {
        return res.json({ chyba: "Vyplň všetky povinné polia!" });
    }

    // Pridaj https:// ak chýba
    let url = stranka;
    if (!url.startsWith("http")) {
        url = "https://" + url;
    }

    try {
        const result = db.prepare(
            "INSERT INTO monitory (uzivatel_id, stranka, klucove_slova, cena_od, cena_do) VALUES (?, ?, ?, ?, ?)"
        ).run(uzivatel_id, url, klucove_slova, cena_od, cena_do);

        const novyMonitor = db.prepare("SELECT * FROM monitory WHERE id = ?").get(result.lastInsertRowid);
        skontrolujMonitor(novyMonitor); // okamžitá kontrola

        res.json({ ok: true, monitor_id: result.lastInsertRowid });
    } catch (chyba) {
        res.json({ chyba: chyba.message });
    }
});

// --- Zoznam monitorov používateľa ---
app.get("/api/monitory/:uzivatel_id", function (req, res) {
    const monitory = db.prepare("SELECT * FROM monitory WHERE uzivatel_id = ? ORDER BY id DESC")
        .all(req.params.uzivatel_id);
    res.json(monitory);
});

// --- História nálezov ---
app.get("/api/historia/:monitor_id", function (req, res) {
    const historia = db.prepare("SELECT * FROM historia WHERE monitor_id = ? ORDER BY cas DESC LIMIT 50")
        .all(req.params.monitor_id);
    res.json(historia);
});

// --- Zmazanie monitoru ---
app.delete("/api/zmaz/:id", function (req, res) {
    const id = parseInt(req.params.id);
    const monitor = db.prepare("SELECT * FROM monitory WHERE id = ?").get(id);

    if (!monitor) return res.json({ chyba: "Monitor nenájdený!" });

    db.prepare("DELETE FROM historia WHERE monitor_id = ?").run(id);
    db.prepare("DELETE FROM monitory WHERE id = ?").run(id);
    res.json({ ok: true, zmazana: monitor.stranka });
});

// --- Pozastavenie / obnovenie monitoru ---
app.put("/api/toggle/:id", function (req, res) {
    const monitor = db.prepare("SELECT * FROM monitory WHERE id = ?").get(req.params.id);
    if (!monitor) return res.json({ chyba: "Monitor nenájdený!" });

    const novyStav = monitor.aktivny ? 0 : 1;
    db.prepare("UPDATE monitory SET aktivny = ? WHERE id = ?").run(novyStav, monitor.id);
    res.json({ ok: true, aktivny: novyStav });
});

// --- Globálny stav (pre dashboard) ---
app.get("/api/stav", function (req, res) {
    const monitory = db.prepare("SELECT m.*, u.email FROM monitory m JOIN uzivatelia u ON m.uzivatel_id = u.id ORDER BY m.id DESC").all();
    res.json(monitory);
});

// ═══════════════════════════════════════════
// 🌐 WEBOVÝ DASHBOARD
// ═══════════════════════════════════════════
function escapeHtml(text) {
    if (!text) return "";
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

app.get("/", function (req, res) {
    const monitory = db.prepare("SELECT m.*, u.email FROM monitory m JOIN uzivatelia u ON m.uzivatel_id = u.id ORDER BY m.id DESC").all();

    let riadky = "";
    for (const m of monitory) {
        const cena = (m.cena_od != null || m.cena_do != null)
            ? (m.cena_od != null ? m.cena_od : "?") + " – " + (m.cena_do != null ? m.cena_do : "?") + " €"
            : "–";
        const aktivny = m.aktivny ? "🟢" : "⏸️";

        riadky += "<tr>"
            + "<td>" + aktivny + "</td>"
            + '<td><a href="' + escapeHtml(m.stranka) + '" target="_blank" style="color:#e94560;">' + escapeHtml(m.stranka) + '</a></td>'
            + "<td>" + escapeHtml(m.klucove_slova) + "</td>"
            + "<td>" + cena + "</td>"
            + "<td>" + escapeHtml(m.stav) + "</td>"
            + "<td>" + escapeHtml(m.posledna_kontrola || "–") + "</td>"
            + "<td>" + escapeHtml(m.email) + "</td>"
            + '<td><a href="/web/vymaz/' + m.id + '" class="del">✕</a></td>'
            + "</tr>";
    }

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>🌐 Web Monitor v2</title>
            <meta charset="utf-8">
            
            <style>
                body { font-family: Arial; max-width: 1100px; margin: 40px auto; padding: 20px; background: #1a1a2e; color: #eee; }
                h1 { text-align: center; }
                .stats { text-align: center; margin-bottom: 20px; color: #aaa; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { padding: 10px 8px; text-align: left; border-bottom: 1px solid #333; font-size: 14px; }
                th { background: #16213e; }
                tr:hover { background: #1a1a3e; }
                form { background: #16213e; padding: 20px; border-radius: 10px; margin-top: 20px; }
                input { padding: 8px; margin: 5px; border: 1px solid #444; background: #1a1a2e; color: #eee; border-radius: 5px; }
                button { padding: 10px 20px; background: #e94560; color: white; border: none; border-radius: 5px; cursor: pointer; margin: 5px; }
                button:hover { background: #c73e54; }
                .del { background: #333; padding: 5px 10px; color: #e94560; text-decoration: none; border-radius: 5px; }
                .del:hover { background: #444; }
                .footer { text-align: center; margin-top: 30px; color: #666; }
            </style>
        </head>
        <body>
            <h1>🌐 Web Monitor v2</h1>
            <p class="stats">
                📊 ${monitory.length} monitorov |
                Kontrola každých 60s |
                <a href="/" style="color:#e94560;">🔄 Obnoviť</a>
            </p>

            <form method="POST" action="/web/pridaj">
                <h3>➕ Pridať nový monitoring</h3>
                <input name="email" placeholder="Tvoj email" required>
                <input name="stranka" placeholder="URL stránky (napr. pelikan.sk)" required>
                <input name="klucove_slova" placeholder="Kľúčové slová (oddelené čiarkou)" required>
                <input name="cena_od" placeholder="Cena od (€)" type="number" step="0.01">
                <input name="cena_do" placeholder="Cena do (€)" type="number" step="0.01">
                <button type="submit">🔍 Pridať monitoring</button>
            </form>

            <table>
                <tr>
                    <th>🟢</th>
                    <th>Stránka</th>
                    <th>Kľúčové slová</th>
                    <th>Cenový rozsah</th>
                    <th>Stav</th>
                    <th>Posledná kontrola</th>
                    <th>Email</th>
                    <th>🗑️</th>
                </tr>
                ${riadky}
            </table>
            <p class="footer">Web Monitor v2 | Puppeteer powered 🚀</p>
        </body>
        </html>
    `);
});

// Webové mazanie monitoru z dashboardu
app.get("/web/vymaz/:id", function (req, res) {
    const id = parseInt(req.params.id);
    const monitor = db.prepare("SELECT * FROM monitory WHERE id = ?").get(id);
    if (monitor) {
        db.prepare("DELETE FROM historia WHERE monitor_id = ?").run(id);
        db.prepare("DELETE FROM monitory WHERE id = ?").run(id);
    }
    res.redirect("/");
});

// Webový formulár na pridanie
app.post("/web/pridaj", function (req, res) {
    const email = req.body.email;
    const stranka = req.body.stranka;
    const klucove_slova = req.body.klucove_slova;
    const cena_od = req.body.cena_od ? parseFloat(req.body.cena_od) : null;
    const cena_do = req.body.cena_do ? parseFloat(req.body.cena_do) : null;

    if (!email || !stranka || !klucove_slova) {
        return res.send("Vyplň všetky povinné polia! <a href='/'>Späť</a>");
    }

    let url = stranka;
    if (!url.startsWith("http")) url = "https://" + url;

    // Nájdi alebo vytvor používateľa
    let uzivatel = db.prepare("SELECT * FROM uzivatelia WHERE email = ?").get(email);
    if (!uzivatel) {
        const result = db.prepare("INSERT INTO uzivatelia (email) VALUES (?)").run(email);
        uzivatel = { id: result.lastInsertRowid };
    }

    const result = db.prepare(
        "INSERT INTO monitory (uzivatel_id, stranka, klucove_slova, cena_od, cena_do) VALUES (?, ?, ?, ?, ?)"
    ).run(uzivatel.id, url, klucove_slova, cena_od, cena_do);

    const novyMonitor = db.prepare("SELECT * FROM monitory WHERE id = ?").get(result.lastInsertRowid);
    skontrolujMonitor(novyMonitor);

    res.redirect("/");
});

// ═══════════════════════════════════════════
// 🚀 ŠTART SERVERA
// ═══════════════════════════════════════════
const intervalSekund = 60;

app.listen(PORT, "0.0.0.0", function () {
    console.log("═══════════════════════════════════════");
    console.log("🌐 Web Monitor v2 beží!");
    console.log("🖥️  Dashboard: http://localhost:" + PORT);
    console.log("═══════════════════════════════════════");

    skontrolujVsetky();
    setInterval(skontrolujVsetky, intervalSekund * 1000);
});
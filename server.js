// 🌐 Web Monitor – Webové rozhranie
require("dotenv").config({ quiet: true });
const express = require("express");
const nodemailer = require("nodemailer");

const app = express();
// ☝️ Vytvor webový server

// CORS – povoľ prístup z Flutter appky
app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});

app.use(express.json());

const PORT = 3000;
// ☝️ Číslo "dvierok" cez ktoré sa pripojíš v prehliadači

// 1. Nastavenia monitoringu
const monitory = [];
let komuPoslat = "";
const intervalSekund = 60;
let emailOdoslany = {};  // kľúč: "stranka|hladanyText" → true (odoslaný, nikdy neresotovať)

// 2. Email
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});

async function posliEmail(sprava) {
    if (!komuPoslat) {
        console.log("ℹ️  Email nie je nastavený, preskakujem.");
        return;
    }
    try {
        await transporter.sendMail({
            from: "Web Monitor <" + process.env.GMAIL_USER + ">",
            to: komuPoslat,
            subject: "🔔 Web Monitor Alert",
            html: "<h1>🔔 Web Monitor</h1><p>" + sprava + "</p>"
        });
        console.log("📧 Email odoslaný na " + komuPoslat);
    } catch (chyba) {
        console.log("🚨 Email chyba: " + chyba.message);
    }
}

// 3. Kontrola stránok
async function skontrolujVsetky() {
    const cas = new Date().toLocaleTimeString("sk-SK");
    console.log("🔍 [" + cas + "] Kontrolujem všetky stránky...");

    for (let i = 0; i < monitory.length; i++) {
        await skontrolujStranku(i);
    }
}

async function skontrolujStranku(index) {
    const m = monitory[index];
    const cas = new Date().toLocaleTimeString("sk-SK");
    const kluc = m.stranka + "|" + m.hladanyText;
    try {
        const odpoved = await fetch(m.stranka);
        const obsah = await odpoved.text();
        m.cas = cas;

        if (obsah.includes(m.hladanyText)) {
            m.stav = "✅ Nájdené";
            console.log("  ✅ " + m.stranka + " – nájdené!");

            if (!emailOdoslany[kluc]) {
                await posliEmail(
                    "Slovo '<strong>" + m.hladanyText + "</strong>' nájdené na " + m.stranka
                );
                emailOdoslany[kluc] = true;
            }
        } else {
            m.stav = "❌ Nenájdené";
            console.log("  ❌ " + m.stranka + " – nenájdené.");
        }

    } catch (chyba) {
        m.stav = "🚨 Chyba";
        m.cas = cas;
        console.log("  🚨 " + m.stranka + " – chyba: " + chyba.message);
    }
}

// 4. Webová stránka
app.get("/", function (req, res) {
    // ☝️ Keď niekto otvorí hlavnú stránku, pošli toto HTML
    let riadky = "";
    for (let i = 0; i < monitory.length; i++) {
        const m = monitory[i];
        riadky += "<tr><td>" + m.stranka + "</td><td>" + m.hladanyText + "</td><td>" + m.stav + "</td><td>" + m.cas + "</td></tr>";
    }

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>🌐 Web Monitor</title>
            <meta charset="utf-8">
            <meta http-equiv="refresh" content="10">
            <style>
                body { font-family: Arial; max-width: 800px; margin: 40px auto; padding: 20px; background: #1a1a2e; color: #eee; }
                h1 { text-align: center; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { padding: 12px; text-align: left; border-bottom: 1px solid #333; }
                th { background: #16213e; }
                tr:hover { background: #1a1a3e; }
                .footer { text-align: center; margin-top: 30px; color: #666; }
            </style>
        </head>
        <body>
            <h1>🌐 Web Monitor Dashboard</h1>
            <p style="text-align:center">Kontrolujem každých ${intervalSekund} sekúnd | Stránka sa obnoví každých 10s</p>
            <table>
                <tr><th>Stránka</th><th>Hľadaný text</th><th>Stav</th><th>Posledná kontrola</th></tr>
                ${riadky}
            </table>
            <p class="footer">⛔ Server zastavíš cez Ctrl+C v termináli</p>
        </body>
        </html>
    `);
});

// 6. API pre Flutter app
app.get("/api/stav", function (req, res) {
    res.json(monitory);
});

// 7. API na pridanie novej stránky
app.post("/api/pridaj", function (req, res) {
    var stranka = req.body.stranka;
    var hladanyText = req.body.hladanyText;

    if (!stranka || !hladanyText) {
        return res.json({ chyba: "Vyplň obe polia!" });
    }

    monitory.push({
        stranka: stranka,
        hladanyText: hladanyText,
        stav: "⏳ Čakám...",
        cas: ""
    });

    skontrolujStranku(monitory.length - 1);
    res.json({ ok: true });
});

// 8. API na zmazanie stránky
app.delete("/api/zmaz/:index", function (req, res) {
    var index = parseInt(req.params.index);
    if (index >= 0 && index < monitory.length) {
        var zmazana = monitory.splice(index, 1);
        // Vymaž aj email tracking pre zmazanú stránku
        var kluc = zmazana[0].stranka + "|" + zmazana[0].hladanyText;
        delete emailOdoslany[kluc];
        res.json({ ok: true, zmazana: zmazana[0].stranka });
    } else {
        res.json({ chyba: "Neplatný index!" });
    }
});

// 9. API na nastavenie emailu
app.get("/api/email", function (req, res) {
    res.json({ email: komuPoslat });
});

app.post("/api/email", function (req, res) {
    var email = req.body.email || "";
    komuPoslat = email.trim();
    console.log("📧 Email nastavený na: " + komuPoslat);
    res.json({ ok: true, email: komuPoslat });
});

// 5. Spusti server
app.listen(PORT, "0.0.0.0", function () {
    console.log("🌐 Dashboard beží na: http://localhost:" + PORT);
    console.log("📱 Pre telefón: http://192.168.100.2:" + PORT);

    skontrolujVsetky();
    setInterval(skontrolujVsetky, intervalSekund * 1000);
});
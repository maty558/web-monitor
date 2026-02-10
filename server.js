// 🌐 Web Monitor – Webové rozhranie
require("dotenv").config({ quiet: true });
const express = require("express");
const nodemailer = require("nodemailer");

const app = express();
// ☝️ Vytvor webový server

const PORT = 3000;
// ☝️ Číslo "dvierok" cez ktoré sa pripojíš v prehliadači

// 1. Nastavenia monitoringu
const monitory = [
    { stranka: "https://www.sme.sk", hladanyText: "Slovensko", stav: "⏳", cas: "-" },
    { stranka: "https://www.aktuality.sk", hladanyText: "Slovensko", stav: "⏳", cas: "-" },
];
const komuPoslat = "matyvoman@gmail.com";
const intervalSekund = 60;
let emailOdoslany = {};

// 2. Email
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});

async function posliEmail(sprava) {
    try {
        await transporter.sendMail({
            from: "Web Monitor <" + process.env.GMAIL_USER + ">",
            to: komuPoslat,
            subject: "🔔 Web Monitor Alert",
            html: "<h1>🔔 Web Monitor</h1><p>" + sprava + "</p>"
        });
        console.log("📧 Email odoslaný!");
    } catch (chyba) {
        console.log("🚨 Email chyba: " + chyba.message);
    }
}

// 3. Kontrola stránok
async function skontrolujVsetky() {
    const cas = new Date().toLocaleTimeString("sk-SK");
    console.log("🔍 [" + cas + "] Kontrolujem všetky stránky...");

    for (let i = 0; i < monitory.length; i++) {
        const m = monitory[i];
        try {
            const odpoved = await fetch(m.stranka);
            const obsah = await odpoved.text();
            m.cas = cas;

            if (obsah.includes(m.hladanyText)) {
                m.stav = "✅ Nájdené";
                console.log("  ✅ " + m.stranka + " – nájdené!");

                if (!emailOdoslany[m.stranka]) {
                    await posliEmail(
                        "Slovo '<strong>" + m.hladanyText + "</strong>' nájdené na " + m.stranka
                    );
                    emailOdoslany[m.stranka] = true;
                }
            } else {
                m.stav = "❌ Nenájdené";
                emailOdoslany[m.stranka] = false;
                console.log("  ❌ " + m.stranka + " – nenájdené.");
            }

        } catch (chyba) {
            m.stav = "🚨 Chyba";
            m.cas = cas;
            console.log("  🚨 " + m.stranka + " – chyba: " + chyba.message);
        }
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

// 5. Spusti server
app.listen(PORT, function () {
    console.log("🌐 Dashboard beží na: http://localhost:" + PORT);
    console.log("👀 Monitorujem " + monitory.length + " stránok každých " + intervalSekund + "s");
    console.log("⛔ Pre zastavenie stlač Ctrl+C");

    skontrolujVsetky();
    setInterval(skontrolujVsetky, intervalSekund * 1000);
});
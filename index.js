// 🌐 Web Monitor s emailovými notifikáciami
// Verzia 3.1 – posiela email len raz

require("dotenv").config({ quiet: true });
const nodemailer = require("nodemailer");

// 1. Nastavenia
const stranka = "https://www.sme.sk";
const hladanyText = "Slovensko";
const komuPoslat = "matyvoman@gmail.com";
const intervalSekund = 60;

// 2. "Pamäť" – či sme už email poslali
let emailOdoslany = false;
// ☝️ let = premenná ktorá sa MÔŽE meniť (na rozdiel od const)

// 3. Priprav emailového "prepravcu"
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});

// 4. Funkcia na posielanie emailov
async function posliEmail(sprava) {
    try {
        await transporter.sendMail({
            from: "Web Monitor <" + process.env.GMAIL_USER + ">",
            to: komuPoslat,
            subject: "🔔 Web Monitor - Našiel som!",
            html: "<h1>🔔 Web Monitor Alert</h1><p>" + sprava + "</p>"
        });
        console.log("📧 Email odoslaný na " + komuPoslat);
    } catch (chyba) {
        console.log("🚨 Chyba pri emaili: " + chyba.message);
    }
}

// 5. Hlavná funkcia
async function skontrolujStranku() {
    try {
        const cas = new Date().toLocaleTimeString("sk-SK");
        console.log("🔍 [" + cas + "] Kontrolujem stránku...");

        const odpoved = await fetch(stranka);
        const obsah = await odpoved.text();

        if (obsah.includes(hladanyText)) {
            console.log("✅ [" + cas + "] NAŠIEL SOM slovo '" + hladanyText + "'!");

            // Pošli email LEN ak sme ho ešte neposlali
            if (!emailOdoslany) {
                await posliEmail(
                    "Slovo '<strong>" + hladanyText + "</strong>' bolo nájdené na stránke " + stranka
                );
                emailOdoslany = true;  // Zapamätaj si že sme poslali
            } else {
                console.log("ℹ️  Email už bol odoslaný, neposielam znova.");
            }

        } else {
            console.log("❌ [" + cas + "] Slovo '" + hladanyText + "' som nenašiel.");
            emailOdoslany = false;
            // ☝️ Ak slovo zmizne, resetuj – aby keď sa znova objaví, pošle nový email
        }

    } catch (chyba) {
        console.log("🚨 Chyba: " + chyba.message);
    }
}

// 6. Spusti!
console.log("👀 Monitorujem stránku každých " + intervalSekund + " sekúnd...");
console.log("⛔ Pre zastavenie stlač Ctrl+C");
skontrolujStranku();
setInterval(skontrolujStranku, intervalSekund * 1000);
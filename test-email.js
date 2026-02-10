require("dotenv").config({ quiet: true });
const nodemailer = require("nodemailer");

async function testEmail() {
    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD
        }
    });

    try {
        const result = await transporter.sendMail({
            from: "Web Monitor <" + process.env.GMAIL_USER + ">",
            to: "matyvoman@gmail.com",
            subject: "🧪 Test email z Web Monitora",
            html: "<h1>Ahoj!</h1><p>Ak toto vidíš, email funguje! 🎉</p>"
        });

        console.log("📧 Email odoslaný!", result.messageId);

    } catch (chyba) {
        console.log("🚨 Chyba:", chyba.message);
    }
}

testEmail();
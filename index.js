const stranka = "https://www.sme.sk";
const hladanyText = "Slovensko";
const intervalSekund = 30; // každých 30 sekúnd skontroluj

async function skontrolujStranku() {
    try {
        const cas = new Date().toLocaleTimeString("sk-SK");
        // ☝️ Zistí aktuálny čas (napr. "18:30:45")

        console.log("🔍 [" + cas + "] Kontrolujem stránku...");

        const odpoved = await fetch(stranka);
        const obsah = await odpoved.text();

        if (obsah.includes(hladanyText)) {
            console.log("✅ [" + cas + "] NAŠIEL SOM slovo '" + hladanyText + "'!");
        } else {
            console.log("❌ [" + cas + "] Slovo '" + hladanyText + "' som nenašiel.");
        }

    } catch (chyba) {
        console.log("🚨 Chyba: " + chyba.message);
    }
}

// Spusti hneď prvýkrát
skontrolujStranku();

// A potom opakuj každých X sekúnd
setInterval(skontrolujStranku, intervalSekund * 1000);
// ☝️ setInterval = "opakuj túto funkciu každých X milisekúnd"
// 30 * 1000 = 30000 milisekúnd = 30 sekúnd

console.log("👀 Monitorujem stránku každých " + intervalSekund + " sekúnd...");
console.log("⛔ Pre zastavenie stlač Ctrl+C");
import "dotenv/config";
import { exec } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TELEGRAM_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const SCRAPERS = [
  "gold-bar/scrape-antam.js",
  "gold-bar/scrape-ubs.js",
  "gold-bar/scrape-lotus-gold.js",
  "gold-bar/scrape-galeri24.js",
  "gold-bar/scrape-dinarkr.js",
  "gold-bar/scrape-waris.js",
  "gold-bar/scrape-stargold.js",
  "gold-bar/scrape-emasku.js",
  "gold-bar/scrape-kinghalim.js",
  "jewelry/scrape-jewelry.js",
  "silver-bar/scrape-indogold.js",
  "silver-bar/scrape-lotus-silver.js",
  "silver-bar/scrape-silvergram.js",
  "silver-bar/scrape-silverium.js",
];

const TIMEOUT_MS = 60000;

// ── Helpers ──────────────────────────────────────────────────
async function sendTelegram(message) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_ID, text: message }
    );
  } catch (err) {
    console.error("Telegram send failed:", err.message);
  }
}

async function logToSupabase(scraperName, status, message = null) {
  await supabase.from("scrape_logs").insert([
    { scraper_name: scraperName, status, message },
  ]);
}

async function runScraper(file) {
  return new Promise((resolve) => {
    const fullPath = path.join(__dirname, file);
    console.log(`🚀 Running ${file}`);
    let settled = false;

    const child = exec(`node ${fullPath}`, async (error, stdout, stderr) => {
      if (settled) return;
      settled = true;
      if (error) {
        console.error(`❌ ERROR in ${file}`);
        console.error(stderr);
        await logToSupabase(file, "failed", stderr?.slice(0, 500));
      } else {
        console.log(`✅ DONE ${file}`);
        await logToSupabase(file, "success", "Scraper completed successfully");
      }
      resolve();
    });

    setTimeout(async () => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      console.warn(`⏱️ TIMEOUT (${TIMEOUT_MS / 1000}s): ${file}`);
      await logToSupabase(file, "timeout", `Killed after ${TIMEOUT_MS / 1000}s`);
      resolve();
    }, TIMEOUT_MS);
  });
}

// ── Export prices.json ke repo ini (di-commit oleh workflow) ─
async function exportPricesJson() {
  console.log("\n📦 Mengambil harga dari Supabase...");

  const { data: allPrices, error } = await supabase
    .from("asset_prices")
    .select("asset_type, brand, variant_label, variant_weight, sell_price, buyback_price")
    .order("scraped_at", { ascending: false });

  if (error) {
    console.error("❌ Gagal ambil harga:", error.message);
    return;
  }

  // Deduplicate — ambil entry terbaru per kombinasi unik
  const seen = new Set();
  const prices = allPrices.filter((p) => {
    const key = `${p.asset_type}|${p.brand}|${p.variant_label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Tulis ke prices.json di root repo
  const payload = JSON.stringify({
    updated_at: new Date().toISOString(),
    count:      prices.length,
    data:       prices,
  }, null, 2);

  fs.writeFileSync(path.join(__dirname, "prices.json"), payload, "utf8");
  console.log(`✅ prices.json ditulis — ${prices.length} harga`);
  // GitHub Actions workflow yang akan git commit + push file ini
}

// ── Main ─────────────────────────────────────────────────────
async function runAll() {
  console.log("====================================");
  console.log("🔥 ASSETIFY AUTO SCRAPER STARTED");
  console.log("====================================");

  const start   = Date.now();
  const results = await Promise.allSettled(SCRAPERS.map((file) => runScraper(file)));
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const failed  = results.filter((r) => r.status === "rejected").length;

  console.log(`\n🎉 ALL SCRAPERS FINISHED in ${elapsed}s`);

  await exportPricesJson();

  if (failed > 0) {
    await sendTelegram(`⚠️ ASSETIFY SCRAPER: ${failed} scraper gagal. Total: ${elapsed}s`);
  } else {
    await sendTelegram(`✅ ASSETIFY SCRAPER: Semua berhasil dalam ${elapsed}s`);
  }
}

runAll();

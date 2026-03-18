import { chromium } from "playwright";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function parseNumber(text) {
  if (!text) return null;

  // ambil angka + titik
  const cleaned = text.replace(/,/g, "");

  // parse float, lalu buang desimal
  return Math.floor(parseFloat(cleaned));
}


async function scrapeGoldTable(page) {
  return await page.$$eval("#table_jewelry_gold tr", rows =>
    rows
      .map(row => {
        const td = row.querySelectorAll("td");
        if (td.length < 4) return null;

        return {
          kadar: td[0].innerText.trim(),
          karat: td[1].innerText.trim(),
          price_sell: td[2].innerText.trim(),
          price_buyback: td[3].innerText.trim(),
        };
      })
      .filter(Boolean)
  );
}

async function scrapeSilverTable(page) {
  return await page.$$eval("#table_jewelry_silver tr", rows =>
    rows
      .map(row => {
        const td = row.querySelectorAll("td");
        if (td.length < 2) return null;

        return {
          price_sell: td[0].innerText.trim(),
          price_buyback: td[1].innerText.trim(),
        };
      })
      .filter(Boolean)
  );
}

async function scrapeIBankJewelry() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log("PAGE LOADING...");
  await page.goto("https://www.ibank.co.id/ibank-v2/rate.do", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  console.log("PAGE LOADED");

  // ===== GOLD JEWELRY =====
  await page.waitForSelector("#table_jewelry_gold tr");

  const goldRaw = await scrapeGoldTable(page);

  const gold = goldRaw.map(g => ({
    kadar: g.kadar,
    karat: Number(g.karat),
    price_sell: parseNumber(g.price_sell),
    price_buyback: parseNumber(g.price_buyback),
  }));

  // ===== SILVER JEWELRY =====
  let silver = null;
  try {
    await page.waitForSelector("#table_jewelry_silver tr", { timeout: 5000 });

    const silverRaw = await scrapeSilverTable(page);

    silver = silverRaw.map(s => ({
      price_sell: parseNumber(s.price_sell),
      price_buyback: parseNumber(s.price_buyback),
    }));
  } catch {
    console.log("No silver jewelry table found");
  }

  await browser.close();

  return {
    source: "iBANK",
    currency: "IDR",
    gold_jewelry: gold,
    silver_jewelry: silver,
    scraped_at: new Date().toISOString(),
  };
}

// ▶️ RUN
async function runPipeline() {
  try {
    const result = await scrapeIBankJewelry();

    const rows = [];

    // 💛 GOLD JEWELRY
    for (const g of result.gold_jewelry) {
      rows.push({
        asset_type: "perhiasan",
        brand: "perhiasan_emas",
        variant_label: `emas_${g.karat}_karat_(${g.kadar}%)`,
        variant_weight: 1,
        sell_price: g.price_sell,
        buyback_price: g.price_buyback,
        scraped_at: result.scraped_at
      });
    }

    // 🤍 SILVER JEWELRY
    if (result.silver_jewelry) {
      for (const s of result.silver_jewelry) {
        rows.push({
          asset_type: "perhiasan",
          brand: "perhiasan_perak",
          variant_label: "perak",
          variant_weight: 1,
          sell_price: s.price_sell,
          buyback_price: s.price_buyback,
          scraped_at: result.scraped_at
        });
      }
    }

    const { error } = await supabase
      .from("asset_prices")
      .upsert(rows, {
        onConflict: "asset_type,brand,variant_label"
      });

    if (error) {
      console.error("UPSERT ERROR:", error);
    } else {
      console.log("✅ IBANK JEWELRY upsert success");
    }

  } catch (err) {
    console.error("PIPELINE FAILED:", err.message);
  }
}

runPipeline();

import { chromium } from "playwright";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ======================
 * UTIL
 * ====================== */
function parseIDR(text = "") {
  if (!text) return null;

  let cleaned = text
    .replace(/Rp/gi, "")
    .replace(/\u00a0/g, "")
    .replace(/\s/g, "");

  if (cleaned.includes(",")) {
    cleaned = cleaned.split(",")[0];
  }

  cleaned = cleaned.replace(/\./g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function parseGram(text = "") {
  if (!text) return null;
  return Number(text.replace(",", "."));
}

/* ======================
 * SCRAPER
 * ====================== */
export async function scrapeSilverium() {
  const browser = await chromium.launch({ headless: true });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    locale: "id-ID"
  });

  const page = await context.newPage();
  console.log("SCRAPER STARTED → MINIGOLD SILVERIUM");

  await page.goto("https://minigold.info/tabel-harga-silverium/", {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForSelector("table tbody tr", { timeout: 60000 });

  const result = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("table tbody tr"));

    let currentType = null;
    const silverRows = [];
    let buybackText = null;

    rows.forEach(tr => {
      const cols = tr.querySelectorAll("td");
      if (cols.length < 3) return;

      const tipeRaw = cols[0].innerText.trim().toUpperCase();

      // ======================
      // DETECT TIPE SECTION
      // ======================
      if (tipeRaw.includes("SILVERIUM")) {
        currentType = "SILVERIUM";
      } else if (tipeRaw.includes("BUYBACK") && tipeRaw.includes("SILVER")) {
        buybackText = cols[2].innerText;
        currentType = null;
        return;
      } else if (tipeRaw !== "") {
        // tipe lain (RAMADAN, DIRHAM, dll)
        currentType = null;
        return;
      }

      // ======================
      // COLLECT SILVERIUM ROWS
      // ======================
      if (currentType === "SILVERIUM") {
        const gram = cols[1]?.innerText;
        const harga = cols[2]?.innerText;
        if (!gram || !harga) return;

        silverRows.push({
          gram,
          price_sell: harga
        });
      }
    });

    return { silverRows, buybackText };
  });

  if (!result.buybackText) {
    throw new Error("Buyback silver per gram tidak ditemukan");
  }

  const buybackPerGram = parseIDR(result.buybackText);

  const silver = result.silverRows.map(item => {
    const gram = parseGram(item.gram);
    const priceSell = parseIDR(item.price_sell);

    return {
      gram,
      price_sell: priceSell,
      price_buyback: Math.round(gram * buybackPerGram)
    };
  });

  await browser.close();

  /* ======================
  * UPSERT SUPABASE
  * ====================== */

  const rows = silver.map(item => ({
    asset_type: "perak",
    brand: "silverium",
    variant_label: `${item.gram} gr`,
    variant_weight: item.gram,
    sell_price: item.price_sell,
    buyback_price: item.price_buyback,
    scraped_at: new Date().toISOString()
  }));

  const { error } = await supabase
    .from("asset_prices")
    .upsert(rows, {
      onConflict: "asset_type,brand,variant_label"
    });

  if (error) {
    throw new Error("SUPABASE UPSERT ERROR: " + error.message);
  }

  console.log("SILVERIUM UPSERT SUCCESS:", rows.length);

  return {
    source: "minigold.info",
    currency: "IDR",
    buyback_per_gram: buybackPerGram,
    silver,
    scraped_at: new Date().toISOString()
  };
}

/* ======================
 * RUN MANUAL
 * ====================== */
(async () => {
  try {
    const res = await scrapeSilverium();
    console.log(JSON.stringify(res, null, 2));
  } catch (err) {
    console.error("SCRAPE FAILED:", err.message);
  }
})();

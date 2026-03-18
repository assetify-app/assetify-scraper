import { chromium } from "playwright";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function parseIDR(text) {
  return Number(text.replace(/\D/g, ""));
}

async function scrapeWarisSampoerna() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log("SCRAPER STARTED → WARIS SAMPOERNA");

  await page.goto("https://sampoernagold.com/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForSelector("table.table-emas tbody tr", {
    timeout: 30000,
  });

  const rawData = await page.$$eval(
    "table.table-emas tbody tr",
    rows =>
      rows
        .map(row => {
          const td = row.querySelectorAll("td");
          if (td.length < 3) return null;

          return {
            gram: td[0].innerText.trim(),
            price_sell: td[1].innerText.trim(),
            price_buyback: td[2].innerText.trim(),
          };
        })
        .filter(Boolean)
  );

  await browser.close();

  const rows = rawData.map(r => {
    const weight = Number(r.gram.replace(",", "."));

    return {
      asset_type: "emas",
      brand: "waris_sampoerna",
      variant_label: `${weight} gr`,
      variant_weight: weight,
      sell_price: parseIDR(r.price_sell),
      buyback_price: parseIDR(r.price_buyback),
      scraped_at: new Date().toISOString()
    };
  });

  return rows;
}

// =======================
// UPSERT KE SUPABASE
// =======================

(async () => {
  try {
    const rows = await scrapeWarisSampoerna();

    const { error } = await supabase
      .from("asset_prices")
      .upsert(rows, {
        onConflict: "asset_type,brand,variant_label"
      });

    if (error) throw error;

    console.log("✅ WARIS SAMPOERNA UPSERT SUCCESS");
  } catch (err) {
    console.error("❌ UPSERT ERROR:", err);
  }
})();
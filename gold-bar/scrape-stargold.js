import { chromium } from "playwright";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function parseIDR(text) {
  if (!text) return null;
  return Number(text.replace(/\D/g, ""));
}

async function scrapeStarGold() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log("SCRAPER STARTED → STAR GOLD");

  await page.goto("https://stargold.id/price/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  const table = page.locator("table.table-bordered").first();

  await table.locator("tbody tr").first().waitFor();


  const rawData = await table.locator("tbody tr").evaluateAll(rows =>
  rows
    .map(row => {
      const td = row.querySelectorAll("td");
      if (td.length < 3) return null;

      return {
        gram: Number(td[0].innerText.trim()),
        price_sell: td[1].innerText.trim(),
        price_buyback: td[2].innerText.trim(),
      };
    })
    .filter(Boolean)
);

  const data = rawData
    .filter(d => !isNaN(d.gram) && d.gram > 0 && d.gram <= 100)
    .map(d => ({
      gram: d.gram,
      price_sell: parseIDR(d.price_sell),
      price_buyback: parseIDR(d.price_buyback),
    }));

  await browser.close();

  return {
    source: "stargold.id",
    brand: "star_gold",
    currency: "IDR",
    data,
    scraped_at: new Date().toISOString(),
  };
}

// ▶ RUN PIPELINE
async function runPipeline() {
  try {
    const result = await scrapeStarGold();

    const rows = result.data.map(item => ({
      asset_type: "emas",
      brand: "star_gold",
      variant_label: `${item.gram} gr`,
      variant_weight: item.gram,
      sell_price: item.price_sell,
      buyback_price: item.price_buyback,
      scraped_at: result.scraped_at
    }));

    const { error } = await supabase
      .from("asset_prices")
      .upsert(rows, {
        onConflict: "asset_type,brand,variant_label"
      });

    if (error) {
      console.error("UPSERT ERROR:", error);
    } else {
      console.log("✅ STAR GOLD upsert success");
    }

  } catch (err) {
    console.error("PIPELINE FAILED:", err.message);
  }
}

runPipeline();
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
  return Number(text.replace(/[^0-9]/g, ""));
}

async function scrapeHRTAGold() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log("SCRAPER STARTED");
  console.log("PAGE LOADING...");

  await page.goto("https://hrtagold.id/en/gold-price", {
    waitUntil: "networkidle",
    timeout: 60000,
  });

  console.log("PAGE LOADED");

  // Tunggu baris data emas muncul
  await page.waitForSelector(
    'tbody[data-slot="table-body"] tr[data-slot="table-row"] span',
    { timeout: 30000 }
  );

  console.log("TABLE ROWS READY");

  const rows = await page.$$eval(
    'tbody[data-slot="table-body"] tr[data-slot="table-row"]',
    rows =>
        rows
        .map(row => {
            const cells = row.querySelectorAll("td");
            if (cells.length < 3) return null;

            const gramText = cells[0].innerText.trim();

            const sellSpans = cells[1].querySelectorAll("span");
            const buySpans = cells[2].querySelectorAll("span");

            if (sellSpans.length < 2 || buySpans.length < 2) return null;

            return {
            gram: gramText,
            sell: sellSpans[1].innerText.trim(),     // ⬅️ ANGKA
            buyback: buySpans[1].innerText.trim(),  // ⬅️ ANGKA
            };
        })
        .filter(Boolean)
    );


  console.log("TOTAL ROWS FOUND:", rows.length);

  // Baris ke 2 – 19 (0.1 gr – 1000 gr)
  const data = rows.slice(0, 17).map(r => ({
    gram: Number(r.gram.replace("gr", "").trim()),
    price_sell: parseIDR(r.sell),
    price_buyback: parseIDR(r.buyback),
  }));

  await browser.close();

  return {
    source: "hrtagold.id",
    brand: "emasku",
    currency: "IDR",
    data,
    scraped_at: new Date().toISOString(),
  };
}

// ▶️ RUN
async function runPipeline() {
  try {
    const result = await scrapeHRTAGold();

    const rows = result.data.map(item => ({
      asset_type: "emas",
      brand: "emasku",
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
      console.log("✅ HRTA GOLD upsert success");
    }

  } catch (err) {
    console.error("PIPELINE FAILED:", err.message);
  }
}

runPipeline();

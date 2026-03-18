import "dotenv/config";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

// ===== SUPABASE CONFIG =====
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // ⚠️ pakai service role untuk server side
);

// ===== HELPERS =====
function parseNumber(text) {
  return Number(text.replace(/[^0-9]/g, ""));
}

async function scrapeTable(page) {
  return await page.$$eval("#priceList table tbody tr", rows =>
    rows
      .map(row => {
        const td = row.querySelectorAll("td");
        if (td.length < 3) return null;

        return {
          gram: td[0].innerText.trim(),
          price_sell: td[1].innerText.trim(),
          price_buy: td[2].innerText.trim(),
        };
      })
      .filter(r => r && r.gram.includes("Gram"))
  );
}

// ===== MAIN SCRAPER =====
async function scrapeLakuemasAntam() {
  const browser = await chromium.launch({ headless: true });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    locale: "id-ID",
  });

  const page = await context.newPage();

  console.log("Opening page...");
  await page.goto("https://www.lakuemas.com/harga-emas-fisik", {
    waitUntil: "networkidle",
    timeout: 60000,
  });

  // ===== CERTIEYE =====
  console.log("Scraping CERTIEYE...");
  await page.click("button#antam");
  await page.waitForTimeout(1500);

  const certieyeRaw = await scrapeTable(page);

  const certieye = certieyeRaw.map(d => ({
    gram: d.gram,
    price_buy: parseNumber(d.price_buy),
    price_sell: parseNumber(d.price_sell),
    type: "certieye",
  }));

  // ===== RETRO =====
  console.log("Scraping RETRO...");
  await page.click("button#retro");
  await page.waitForTimeout(1500);

  const retroRaw = await scrapeTable(page);

  const retro = retroRaw.map(d => ({
    gram: d.gram,
    price_buy: parseNumber(d.price_buy),
    price_sell: parseNumber(d.price_sell),
    type: "retro",
  }));

  await browser.close();

  return [...certieye, ...retro];
}

// ===== SAVE TO SUPABASE =====
async function saveToDatabase(rows) {
  const formatted = rows.map(item => {
    const weight = parseFloat(item.gram.replace(/[^\d.]/g, ""));

    return {
      asset_type: "emas",
      brand: "antam",
      variant_label: `${item.type}_${weight}g`,
      variant_weight: weight,
      sell_price: item.price_sell,
      buyback_price: item.price_buy,
      scraped_at: new Date().toISOString(),
    };
  });

  const { error } = await supabase
    .from("asset_prices")
    .upsert(formatted, {
      onConflict: "asset_type,brand,variant_label",
    });

  if (error) {
    console.error("UPSERT ERROR:", error);
  } else {
    console.log("✅ Data upsert success");
  }
}

// ===== RUN =====
(async () => {
  try {
    const data = await scrapeLakuemasAntam();
    await saveToDatabase(data);
  } catch (err) {
    console.error("SCRAPE ERROR:", err);
  }
})();
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

async function scrapeLotusArchi() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    locale: "id-ID",
  });

  const page = await context.newPage();

  console.log("SCRAPER STARTED → LOTUS ARCHI");

  await page.goto("https://lotusarchi.com/pricing/", {
    waitUntil: "networkidle",
    timeout: 90000,
  });

  // ===== HEADER (BUYBACK PER GRAM) =====
  const headerText = await page.evaluate(() => {
    const el = document.querySelector(".pricing-header, .price-header, body");
    return el?.innerText || document.body.innerText;
  });

  const buybackMatch = headerText.match(/Buyback Price\s*:\s*Rp\s*([\d.]+)/i);
  if (!buybackMatch) {
    throw new Error("BUYBACK PRICE NOT FOUND");
  }

  const buybackPerGram = parseIDR(buybackMatch[1]);

  // ===== TABLE =====
  const rows = await page.$$eval("table tr", trs =>
    trs.map(tr => {
      const tds = tr.querySelectorAll("td");
      if (tds.length < 2) return null;

      const label = tds[0].innerText.trim();
      const price = tds[1].innerText.trim();

      return { label, price };
    }).filter(Boolean)
  );

  // ===== FILTER + PARSE =====
  const map = new Map();

  for (const r of rows) {
    // ❌ Buang Paper Gold & WB
    if (/paper gold/i.test(r.label)) continue;
    if (/\(wb\)/i.test(r.label)) continue;

    const gramMatch = r.label.match(/^(\d+(\.\d+)?)\s*gr/i);
    if (!gramMatch) continue;

    const gram = Number(gramMatch[1]);
    const priceSell = parseIDR(r.price);

    if (!map.has(gram)) {
      map.set(gram, {
        gram,
        price_sell: priceSell,
      });
    }
  }

  const data = [...map.values()]
    .sort((a, b) => a.gram - b.gram)
    .map(d => ({
      gram: d.gram,
      price_sell: d.price_sell,
      price_buyback: Math.round(d.gram * buybackPerGram),
    }));

  await browser.close();

  return {
    source: "lotusarchi.com",
    brand: "Lotus Archi",
    currency: "IDR",
    buyback_per_gram: buybackPerGram,
    data,
    scraped_at: new Date().toISOString(),
  };
}

// ▶ RUN
async function runPipeline() {
  try {
    const result = await scrapeLotusArchi();

    const rows = result.data.map(item => ({
      asset_type: "emas",
      brand: "lotus_archi",
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
      console.log("✅ LOTUS ARCHI upsert success");
    }

  } catch (err) {
    console.error("SCRAPE ERROR:", err.message);
  }
}

// RUN
runPipeline();

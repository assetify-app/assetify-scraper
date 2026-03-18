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
  return Number(text.replace(/[^\d]/g, ""));
}

export async function scrapeGaleri24() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log("SCRAPER STARTED → GALERI24");

  await page.goto("https://galeri24.co.id/harga-emas", {
    waitUntil: "networkidle",
    timeout: 60000
  });

  await page.waitForSelector("text=Harga GALERI 24", { timeout: 60000 });

  const blocks = await page.evaluate(() => {
    const results = {
      galeri24: "",
      dinar_g24: ""
    };

    const sections = Array.from(document.querySelectorAll("section"));

    for (const s of sections) {
      const text = s.innerText || "";
      if (text.includes("Harga GALERI 24")) results.galeri24 = text;
      if (text.includes("Harga DINAR G24")) results.dinar_g24 = text;
    }

    return results;
  });

  function extractRows(text) {
    const rows = [];
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

    for (let i = 0; i < lines.length; i++) {
      const gram = Number(lines[i]);
      if (isNaN(gram)) continue;

      const sell = parseIDR(lines[i + 1]);
      const buyback = parseIDR(lines[i + 2]);

      if (sell && buyback) {
        rows.push({
          gram,
          price_sell: sell,
          price_buyback: buyback
        });
      }
    }
    return rows;
  }

  // === GRAM YANG DIIZINKAN ===
  const GALERI24_GRAMS = [0.5,1,2,5,10,25,50,100,250,500,1000];
  const DINAR_GRAMS = [1.06,2.13,4.25];

  // === GALERI 24 (FILTER + DEDUP + LIMIT) ===
  const galeri24Map = new Map();

  for (const r of extractRows(blocks.galeri24)) {
    if (!GALERI24_GRAMS.includes(r.gram)) continue;
    if (!galeri24Map.has(r.gram)) {
      galeri24Map.set(r.gram, r);
    }
  }

  const galeri24 = [...galeri24Map.values()]
    .sort((a, b) => a.gram - b.gram)
    .slice(0, 11); // 🔒 HARD LIMIT

  // === DINAR G24 ===
  const dinarMap = new Map();

  for (const r of extractRows(blocks.dinar_g24)) {
    if (!DINAR_GRAMS.includes(r.gram)) continue;
    if (!dinarMap.has(r.gram)) {
      dinarMap.set(r.gram, r);
    }
  }

  const dinar_g24 = [...dinarMap.values()]
    .sort((a, b) => a.gram - b.gram);

  await browser.close();

  return {
    source: "galeri24.co.id",
    currency: "IDR",
    data: {
      galeri24,
      dinar_g24
    },
    scraped_at: new Date().toISOString()
  };
}

// RUN
async function runPipeline() {
  try {
    const result = await scrapeGaleri24();

    const rows = [];

    // === GALERI24 GOLD BAR ===
    for (const item of result.data.galeri24) {
      rows.push({
        asset_type: "emas",
        brand: "galeri_24",
        variant_label: `${item.gram} gr`,
        variant_weight: item.gram,
        sell_price: item.price_sell,
        buyback_price: item.price_buyback,
        scraped_at: result.scraped_at
      });
    }

    // === DINAR G24 ===
    for (const item of result.data.dinar_g24) {
      rows.push({
        asset_type: "emas",
        brand: "galeri_24",
        variant_label: `dinar_${item.gram}_gr`,
        variant_weight: item.gram,
        sell_price: item.price_sell,
        buyback_price: item.price_buyback,
        scraped_at: result.scraped_at
      });
    }

    const { error } = await supabase
      .from("asset_prices")
      .upsert(rows, {
        onConflict: "asset_type,brand,variant_label"
      });

    if (error) {
      console.error("UPSERT ERROR:", error);
    } else {
      console.log("✅ GALERI24 & DINAR G24 upsert success");
    }

  } catch (e) {
    console.error("PIPELINE FAILED:", e.message);
  }
}

runPipeline();

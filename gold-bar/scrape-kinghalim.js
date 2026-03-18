import { chromium } from "playwright";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Parse nominal IDR
 * - Ambil angka saja
 * - Buang 2 digit terakhir (desimal .00)
 */
function parseIDR(text) {
  if (!text) return null;
  const digits = text.replace(/[^0-9]/g, "");
  if (digits.length <= 2) return null;
  return Number(digits.slice(0, -2));
}

async function scrapeKingHalim() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log("SCRAPER STARTED");

  await page.goto("https://www.kinghalim.com/goldbarwithamala", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  /**
   * =========================
   * BUYBACK PER GRAM
   * =========================
   * Ambil dari teks:
   * "Harga Buyback : Rp 2,710,000.00 / Gr"
   * (tanpa selector rapuh)
   */
  const buybackText = await page.evaluate(() => {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT
    );
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue?.includes("Harga Buyback")) {
        return node.nodeValue;
      }
    }
    return null;
  });

  if (!buybackText) {
    throw new Error("BUYBACK TEXT NOT FOUND");
  }

  const buybackPerGram = parseIDR(buybackText);

  if (!buybackPerGram) {
    throw new Error("FAILED TO PARSE BUYBACK VALUE");
  }

  /**
   * =========================
   * SELL PRICE CARDS
   * =========================
   * Ambil semua card gramasi
   */
  const raw = await page.$$eval(".kv-ee-item", nodes =>
    nodes
      .map(node => {
        const gramText = node.querySelector("h3")?.innerText;
        const priceText = node.innerText.match(/Rp[\s0-9.,]+/)?.[0];

        if (!gramText || !priceText) return null;

        return { gramText, priceText };
      })
      .filter(Boolean)
  );

  if (raw.length === 0) {
    throw new Error("SELL PRICE CARDS NOT FOUND");
  }

  /**
   * =========================
   * PARSE + DEDUP
   * =========================
   */
  const map = new Map();

  for (const r of raw) {
    const g = r.gramText.match(/(\d+(\.\d+)?)\s*gr/i);
    if (!g) continue;

    const gram = Number(g[1]);
    const priceSell = parseIDR(r.priceText);

    if (!priceSell) continue;

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
    source: "kinghalim.com",
    brand: "King Halim",
    currency: "IDR",
    buyback_per_gram: buybackPerGram,
    data,
    scraped_at: new Date().toISOString(),
  };
}

/**
 * =========================
 * RUN
 * =========================
 */
async function runPipeline() {
  try {
    const result = await scrapeKingHalim();

    const rows = result.data.map(item => ({
      asset_type: "emas",
      brand: "king_halim",
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
      console.log("✅ KING HALIM upsert success");
    }

  } catch (e) {
    console.error("PIPELINE FAILED:", e.message);
  }
}

runPipeline();

import { chromium } from "playwright";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DINAR_GRAM_MAP = {
  "1/8": 0.53,
  "1/4": 1.063,
  "1/2": 2.125,
  "1": 4.25,
  "2": 8.5,
  "3": 12.75,
  "4": 17,
  "5": 21.25,
  "7": 29.75,
  "8": 34,
  "10": 42.5,
  "20": 85
};

export async function scrapeDinarKR() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log("SCRAPER STARTED → DINAR KR");

  await page.goto("https://dinarkr.com/#harga", {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForSelector(".dkr-harga1 table.table-dkr tbody tr", {
    timeout: 60000
  });

  const data = await page.evaluate((GRAM_MAP) => {
    const results = [];

    // 🔧 FIX LABEL BERDASARKAN INDEX TABEL
    const FIX_VARIANT_BY_INDEX = {
      8: "7_dinar",
      9: "8_dinar",
      10: "10_dinar"
    };

    // 🔧 GRAM FINAL HARUS IKUT VARIANT
    const FINAL_GRAM_BY_VARIANT = {
      "7_dinar": 29.75,
      "8_dinar": 34,
      "10_dinar": 42.5,
      "20_dinar": 85
    };

    const rows = document.querySelectorAll(
      ".dkr-harga1 table.table-dkr tbody tr"
    );

    rows.forEach((tr, index) => {
      const img = tr.querySelector("td img");
      const sellEl = tr.querySelector("td.konsumen span");
      const buyEl = tr.querySelector("td.buyback span");

      if (!img || !sellEl || !buyEl) return;

      const alt = img.getAttribute("alt") || "";
      const match = alt.match(/(\d+\/\d+|\d+)/);
      if (!match) return;

      const dinarRaw = match[1];

      const variant =
        FIX_VARIANT_BY_INDEX[index] || `${dinarRaw}_dinar`;

      const gram =
        FINAL_GRAM_BY_VARIANT[variant] ?? GRAM_MAP[dinarRaw];

      results.push({
        variant,
        gram,
        price_sell: Number(sellEl.innerText.replace(/[^\d]/g, "")),
        price_buyback: Number(buyEl.innerText.replace(/[^\d]/g, ""))
      });
    });

    // 🔹 20 DINAR (KANAN / SPECIAL CARD)
    const extra20Sell = document.querySelector(
      ".dkr-harga2-item.pde .harga span"
    );
    const extra20Buy = document.querySelector(
      ".dkr-harga2-item.pde .buyback2 span"
    );

    if (extra20Sell && extra20Buy) {
      results.push({
        variant: "20_dinar",
        gram: FINAL_GRAM_BY_VARIANT["20_dinar"],
        price_sell: Number(extra20Sell.innerText.replace(/[^\d]/g, "")),
        price_buyback: Number(extra20Buy.innerText.replace(/[^\d]/g, ""))
      });
    }

    return results;
  }, DINAR_GRAM_MAP);

  await browser.close();

  return {
    source: "dinarkr.com",
    currency: "IDR",
    data,
    scraped_at: new Date().toISOString()
  };
  
}

// ▶️ RUN MANUAL
(async () => {
  try {
    const res = await scrapeDinarKR();

    console.log("SCRAPED:", res);

    const rows = res.data.map(item => ({
      asset_type: "emas",
      brand: "dinar_kr",
      variant_label: item.variant,       // contoh: "1 Dinar"
      variant_weight: item.gram,         // contoh: 4.25
      sell_price: item.price_sell,
      buyback_price: item.price_buyback,
      scraped_at: res.scraped_at
    }));

    const { error } = await supabase
      .from("asset_prices")
      .upsert(rows, {
        onConflict: "asset_type,brand,variant_label"
      });

    if (error) {
      console.error("UPSERT ERROR:", error);
    } else {
      console.log("✅ DINAR KR Data upsert success");
    }

  } catch (err) {
    console.error("PIPELINE FAILED:", err.message);
  }
})();

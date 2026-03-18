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

  return Number(
    text
      .replace(/Rp/gi, "")
      .replace(/\u00a0/g, "")
      .replace(/\s/g, "")
      .replace(/\/gram/gi, "")
      .split(",")[0]
      .replace(/\./g, "")
  );
}

function parseGram(text = "") {
  const m = text.match(/(\d+)\s*(gr|gram|kg)/i);
  if (!m) return null;
  let g = Number(m[1]);
  if (m[2].toLowerCase() === "kg") g *= 1000;
  return g;
}

/* ======================
 * SCRAPER
 * ====================== */
export async function scrapeLotusArchiSilver() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    locale: "id-ID",
  });

const page = await context.newPage();

  /* ======================
   * 1️⃣ BUYBACK / GRAM
   * ====================== */
  await page.goto("https://lotusarchi.com/pricing/", {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(4000);

  const buybackPerGram = await page.evaluate(() => {
  const rows = document.querySelectorAll("table.pricing tbody tr");

  for (const r of rows) {
    const tds = r.querySelectorAll("td");
    if (tds.length < 2) continue;

    const label = tds[0].innerText.trim().toLowerCase();

    // HARUS exact match
    if (label === "perak lotus archi") {
      return tds[1].innerText;
    }
  }
  return null;
});



  const buyback = parseIDR(buybackPerGram);
  if (!buyback) throw new Error("BUYBACK PERAK NOT FOUND");

  /* ======================
   * 2️⃣ PRODUCT PAGES
   * ====================== */
  const productUrls = [
    "https://lotusarchi.com/product/silver-lotus-archi-50gr/",
    "https://lotusarchi.com/product/lotus-archi-silver-logam-mulia-silver-9999-100gr/",
    "https://lotusarchi.com/product/perak-lotus-archi-logam-mulia-perak-9999-250gr/",
    "https://lotusarchi.com/product/perak-lotus-archi-logam-mulia-perak-9999-500gr/",
    "https://lotusarchi.com/product/perak-lotus-archi-logam-mulia-perak-9999-1000gr/"
  ];

  const silver = [];

  for (const url of productUrls) {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    const data = await page.evaluate(() => {
      return {
        title: document.querySelector("h1")?.innerText || "",
        price: document.querySelector("p.price bdi")?.innerText || ""
      };
    });

    const gram = parseGram(data.title);
    const sell = parseIDR(data.price);
    if (!gram || !sell) continue;

    silver.push({
      gram,
      price_sell: sell,
      price_buyback: gram * buyback
    });
  }

  await browser.close();

  /* ======================
  * 3️⃣ UPSERT SUPABASE
  * ====================== */

  const rows = silver.map((item) => ({
    asset_type: "perak",
    brand: "lotus_archi",
    variant_label: `perak_lotus_archi_${item.gram}gr`,
    variant_weight: item.gram,
    sell_price: item.price_sell,
    buyback_price: item.price_buyback,
    scraped_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("asset_prices")
    .upsert(rows, {
      onConflict: "asset_type,brand,variant_label",
    });

  if (error) {
    throw new Error("SUPABASE UPSERT ERROR: " + error.message);
  }

  return {
    source: "lotusarchi.com",
    currency: "IDR",
    inserted: rows.length,
    scraped_at: new Date().toISOString(),
  };
}

/* ======================
 * RUN
 * ====================== */
(async () => {
  const res = await scrapeLotusArchiSilver();
  console.log(JSON.stringify(res, null, 2));
})();

import axios from "axios";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ======================
 * CONFIG
 * ====================== */
const IBANK_URL = "https://www.ibank.co.id/ibank-v2/rate.do";

const PRODUCTS = [
  { gram: 1, url: "https://www.silvergram.co.id/portal/product-detail.do?id=4917421217" },
  { gram: 5, url: "https://www.silvergram.co.id/portal/product-detail.do?id=4917421218" },
  { gram: 10, url: "https://www.silvergram.co.id/portal/product-detail.do?id=7999320717" },
  { gram: 25, url: "https://www.silvergram.co.id/portal/product-detail.do?id=4912121191" },
  { gram: 50, url: "https://www.silvergram.co.id/portal/product-detail.do?id=46224720882" },
  { gram: 100, url: "https://www.silvergram.co.id/portal/product-detail.do?id=4917421219" },
  { gram: 250, url: "https://www.silvergram.co.id/portal/product-detail.do?id=4917421178" }
];

/* ======================
 * UTIL
 * ====================== */
function parseIDRLoose(text = "") {
  // aman untuk: "IDR 118,800 / PCS"
  return Number(text.replace(/[^\d]/g, ""));
}

function parseIDRFromDecimal(text = "") {
  // iBank format: "46,260.86"
  return Number(text.replace(/,/g, "").split(".")[0]);
}

/* ======================
 * SCRAPER
 * ====================== */
export async function scrapeSilvergram() {

  /* ========= BUYBACK 1 GR (IBANK) ========= */
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });

  const page = await browser.newPage();
  await page.goto(IBANK_URL, {
    waitUntil: "domcontentloaded",
    timeout: 30000
  });

  await page.waitForFunction(() => {
    const el = document.querySelector("#harga_beli_perak");
    return el && el.innerText && el.innerText.trim().length > 0;
  }, { timeout: 30000 });

  const buybackText = await page.evaluate(
    () => document.querySelector("#harga_beli_perak").innerText
  );

  await browser.close();

  const buybackPerGram = parseIDRFromDecimal(buybackText);

  if (!buybackPerGram) {
    throw new Error("BUYBACK PER GRAM SILVER NOT FOUND (IBANK)");
  }

  /* ========= SELL PER PRODUCT (SILVERGRAM) ========= */
  const silver = [];

  for (const item of PRODUCTS) {
    const { data: html } = await axios.get(item.url, {
      timeout: 15000,
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(html);

    const priceSellText = $("#price4").text();
    const price_sell = parseIDRLoose(priceSellText);

    if (!price_sell) continue;

    silver.push({
      brand: "Silvergram",
      gram: item.gram,
      price_sell,
      price_buyback: item.gram * buybackPerGram
    });
  }

  /* ========= UPSERT TO SUPABASE ========= */

  const rows = silver.map((item) => ({
    asset_type: "perak",
    brand: "silvergram",
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

  return {
    source: "silvergram.co.id",
    currency: "IDR",
    buyback_per_gram: buybackPerGram,
    silver,
    scraped_at: new Date().toISOString()
  };

  
}

/* ======================
 * RUN
 * ====================== */
if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeSilvergram()
    .then(res => console.log(JSON.stringify(res, null, 2)))
    .catch(err => console.error("SCRAPE FAILED:", err.message));
}

import { chromium } from "playwright";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function parseIDR(text = "") {
  return Number(text.replace(/[^\d]/g, ""));
}

function parseIDRdigit(text) {
  if (!text) return null;
  const digits = text.replace(/[^0-9]/g, "");
  if (digits.length <= 2) return null;
  return Number(digits.slice(0, -2));
}

export async function scrapeLogamMulia() {
  const browser = await chromium.launch({ headless: true });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    viewport: { width: 1440, height: 900 },
    timezoneId: "Asia/Jakarta",
    locale: "id-ID"
  });

  const page = await context.newPage();

  console.log("SCRAPER STARTED → LOGAM MULIA");

  await page.goto("https://www.logammulia.com/id");
  await page.waitForSelector(".price span.current");

  const hargaJualText = await page.$eval(
    ".price span.current",
    el => el.innerText
  );

  await page.goto("https://www.logammulia.com/id/sell/gold");
  await page.waitForSelector(".chart-info");
  await page.waitForTimeout(1500);

  const hargaBuybackText = await page.evaluate(() => {
    const items = document.querySelectorAll(".chart-info .ci-child");
    for (const item of items) {
      const title = item.querySelector(".title");
      const value = item.querySelector(".value");
      if (title?.innerText.trim() === "Harga Buyback:") {
        return value?.innerText;
      }
    }
    return null;
  });

  await browser.close();

  return {
    source: "logammulia.com",
    currency: "IDR",
    harga_jual_1gr: parseIDRdigit(hargaJualText),
    harga_buyback_1gr: parseIDR(hargaBuybackText),
    scraped_at: new Date().toISOString()
  };
}

// =======================
// INSERT KE SUPABASE
// =======================

async function runPipeline() {
  try {
    const data = await scrapeLogamMulia();

    console.log("SCRAPED:", data);

    const { error } = await supabase.from("asset_prices").insert({
      asset_type: "emas",
      brand: "harga_umum",
      variant_label: "1 gr",
      variant_weight: 1,
      sell_price: data.harga_jual_1gr,
      buyback_price: data.harga_buyback_1gr,
      scraped_at: data.scraped_at
    });

    if (error) throw error;

    console.log("SUCCESS INSERT TO SUPABASE");
  } catch (err) {
    console.error("PIPELINE FAILED:", err.message);
  }
}

// RUN
runPipeline();

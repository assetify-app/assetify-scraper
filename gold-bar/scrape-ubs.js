import axios from "axios";
import * as cheerio from "cheerio";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  Accept: "text/html"
};

const UBS_PRODUCTS = [
  { gram: 0.1, urls: [
    "https://ubslifestyle.com/logam-mulia-ubs-0-1-gram/",
    "https://ubslifestyle.com/fine-gold-0-1gram/",
    "https://ubslifestyle.com/ubs-logam-mulia-0-1-gram-classic/"
  ]},
  { gram: 0.25, urls: [
    "https://ubslifestyle.com/logam-mulia-ubs-0-25-gram/",
    "https://ubslifestyle.com/fine-gold-0-25gram/",
    "https://ubslifestyle.com/ubs-logam-mulia-0-25-gram-classic/"
  ]},
  { gram: 0.5, urls: [
    "https://ubslifestyle.com/fine-gold-0-5gram/",
    "https://ubslifestyle.com/logam-mulia-ubs-0-5-gram/",
    "https://ubslifestyle.com/ubs-logam-mulia-0-5-gram-classic/"
  ]},
  { gram: 1, urls: [
    "https://ubslifestyle.com/fine-gold-1gram/",
    "https://ubslifestyle.com/ubs-logam-mulia-1-gram-classic/",
    "https://ubslifestyle.com/logam-mulia-ubs-1-gram/"
  ]},
  { gram: 2, urls: [
    "https://ubslifestyle.com/fine-gold-2gram/",
    "https://ubslifestyle.com/ubs-logam-mulia-2-gram-classic/",
    "https://ubslifestyle.com/logam-mulia-ubs-2-gram/"
  ]},
  { gram: 3, urls: [
    "https://ubslifestyle.com/fine-gold-3gram/",
    "https://ubslifestyle.com/ubs-logam-mulia-3-gram-classic/",
    "https://ubslifestyle.com/logam-mulia-ubs-3-gram/"
  ]},
  { gram: 4, urls: [
    "https://ubslifestyle.com/fine-gold-4gram/",
    "https://ubslifestyle.com/ubs-logam-mulia-4-gram-classic/",
    "https://ubslifestyle.com/logam-mulia-ubs-4-gram/"
  ]},
  { gram: 5, urls: [
    "https://ubslifestyle.com/fine-gold-5gram/",
    "https://ubslifestyle.com/ubs-logam-mulia-5-gram-classic/",
    "https://ubslifestyle.com/logam-mulia-ubs-5-gram/"
  ]},
  { gram: 10, urls: [
    "https://ubslifestyle.com/fine-gold-10gram/",
    "https://ubslifestyle.com/ubs-logam-mulia-10-gram-classic/",
    "https://ubslifestyle.com/logam-mulia-ubs-10-gram/"
  ]},
  { gram: 25, urls: [
    "https://ubslifestyle.com/ubs-logam-mulia-25-gram-classic/",
    "https://ubslifestyle.com/fine-gold-25gram/",
    "https://ubslifestyle.com/logam-mulia-ubs-25-gram/"
  ]},
  { gram: 50, urls: [
    "https://ubslifestyle.com/ubs-logam-mulia-50-gram-classic/",
    "https://ubslifestyle.com/fine-gold-50gram/",
    "https://ubslifestyle.com/logam-mulia-ubs-50-gram/"
  ]},
  { gram: 100, urls: [
    "https://ubslifestyle.com/ubs-logam-mulia-100-gram-classic/",
    "https://ubslifestyle.com/fine-gold-100gram/",
    "https://ubslifestyle.com/logam-mulia-ubs-100-gram/"
  ]}
];

function parseIDR(text = "") {
  return Number(
    text
      .replace(/Rp/gi, "")
      .replace(/\./g, "")
      .replace(/,/g, "")
      .replace(/\s/g, "")
  );
}

/* ======================
 * SELL PRICE
 * ====================== */
async function scrapeSellPrice(urls) {
  for (const url of urls) {
    try {
      const res = await axios.get(url, { headers: HEADERS, timeout: 15000 });
      const $ = cheerio.load(res.data);

      const meta = $('meta[itemprop="price"]').attr("content");
      if (meta) {
        return { price: Number(meta), source_url: url };
      }

      const priceText = $(".woocommerce-Price-amount").first().text();
      if (priceText) {
        return { price: parseIDR(priceText), source_url: url };
      }
    } catch (_) {}
  }
  return null;
}

/* ======================
 * BUYBACK TABLE (FINAL)
 * ====================== */
async function scrapeBuybackTable() {
  const res = await axios.get(
    "https://ubslifestyle.com/harga-buyback-hari-ini/",
    { headers: HEADERS, timeout: 15000 }
  );

  const $ = cheerio.load(res.data);
  const map = {};

  $(".table-product-wrapper table tbody tr.table-price").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 3) return;

    const gramText = $(tds[0]).text().trim();
    const buybackText = $(tds[2]).text().trim();

    const match = gramText.match(/([\d.]+)\s*gram/i);
    if (!match) return;

    const gram = Number(match[1]);
    const buyback = parseIDR(buybackText);

    if (!isNaN(gram) && buyback) {
      map[gram] = buyback;
    }
  });

  return map;
}

/* ======================
 * MAIN
 * ====================== */
(async () => {
  try {
    console.log("SCRAPER STARTED → UBS GOLD");

    const buybackMap = await scrapeBuybackTable();
    const gold = [];

    for (const item of UBS_PRODUCTS) {
      const sell = await scrapeSellPrice(item.urls);
      if (!sell) continue;

      gold.push({
        gram: item.gram,
        price_sell: sell.price,
        price_buyback: buybackMap[item.gram] ?? null,
        source_url: sell.source_url
      });
    }

    console.log(JSON.stringify({
      source: "ubslifestyle.com",
      currency: "IDR",
      gold,
      scraped_at: new Date().toISOString()
    }, null, 2));

    const rows = gold.map(item => ({
      asset_type: "emas",
      brand: "ubs",
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
      console.error("UPSERT ERROR:", error);
    } else {
      console.log("✅ UBS Data upsert success");
    }

  } catch (err) {
    console.error("SCRAPE FAILED:", err.message);
  }
})();


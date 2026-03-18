import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const URL = "https://www.indogold.id/harga-emas-hari-ini";

function cleanNumber(text) {
  return Number(
    text
      .replace(/Rp|\./g, "")
      .replace(/,/g, "")
      .trim()
  );
}

async function scrapeIndogoldSilver() {
  const { data: html } = await axios.get(URL, {
    timeout: 15000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    },
  });

  const $ = cheerio.load(html);
  const silver = [];

  $(".table-add-product-wrapper").each((_, wrapper) => {
    const elements = $(wrapper).children();

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];

      if ($(el).is("p.subtitle")) {
        const category = $(el).text().trim();
        const table = $(elements[i + 1]);

        if (!table.is("table")) continue;

        table.find("tbody tr").each((_, row) => {
          const cols = $(row).find("td");
          if (cols.length < 3) return;

          const gram = parseFloat(
            $(cols[0])
              .text()
              .replace("Gram", "")
              .replace(/,/g, "")  // handle semua koma
              .trim()
          );

          const price_sell = cleanNumber($(cols[1]).text());
          const price_buyback = cleanNumber($(cols[2]).text());

          silver.push({
            category,
            gram,
            price_sell,
            price_buyback,
          });
        });
      }
    }
  });

  if (silver.length === 0) {
    throw new Error("SILVER INDOGOLD DATA NOT FOUND");
  }

  return {
    source: "indogold.id",
    currency: "IDR",
    silver,
    scraped_at: new Date().toISOString(),
  };
}

/* ============================= */
/* STORE TO SUPABASE            */
/* ============================= */

async function runPipeline() {
  try {
    const result = await scrapeIndogoldSilver();

    const rows = result.silver.map(item => ({
      asset_type: "perak",
      brand: "indogold",
      variant_label: `${item.category.replace(/\s+/g, "_").toLowerCase()}_${item.gram}gr`,
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
      console.log("✅ INDOGOLD SILVER upsert success");
    }

  } catch (err) {
    console.error("PIPELINE FAILED:", err.message);
  }
}

/* ===== RUN DIRECT ===== */
if (import.meta.url === `file://${process.argv[1]}`) {
  runPipeline();
}

export default scrapeIndogoldSilver;
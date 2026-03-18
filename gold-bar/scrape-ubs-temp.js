import { chromium } from "playwright";

function parseIDR(text) { 
    if (!text) return null; 
    return Number(text.replace(/[^\d]/g, "")); 
}

function parseGram(text) {
  const m = text.match(/([\d.]+)\s*gram/i);
  return m ? Number(m[1]) : null;
}

export async function scrapeUBS() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log("SCRAPER STARTED → UBS (IndoGold)");

  await page.goto(
    "https://www.indogold.id/detail-emas-batangan",
    { waitUntil: "networkidle", timeout: 60000 }
  );

  // tunggu produk muncul
  await page.waitForSelector("text=UBS Gold", { timeout: 60000 });

  const blocks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("div"))
      .map(el => el.innerText)
      .filter(Boolean)
      .filter(t => t.includes("UBS Gold"));
  });

  const map = new Map();

  for (const block of blocks) {
    // ❌ buang RETRO
    if (/retro/i.test(block)) continue;

    const gram = parseGram(block);
    if (!gram) continue;

    const buyMatch = block.match(/Harga Beli\s*Rp\s*([\d.,]+)/i);
    const sellMatch = block.match(/Harga Jual\s*Rp\s*([\d.,]+)/i);

    const priceSell = parseIDR(buyMatch?.[1]);
    const priceBuyback = parseIDR(sellMatch?.[1]);

    if (!priceSell || !priceBuyback) continue;

    // dedup per gram
    if (!map.has(gram)) {
      map.set(gram, {
        gram,
        price_sell: priceSell,
        price_buyback: priceBuyback
      });
    }
  }

  await browser.close();

  return {
    source: "indogold.id",
    brand: "UBS",
    currency: "IDR",
    data: [...map.values()].sort((a, b) => a.gram - b.gram),
    scraped_at: new Date().toISOString()
  };
}

// RUN
(async () => {
  const res = await scrapeUBS();
  console.log(JSON.stringify(res, null, 2));
})();

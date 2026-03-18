# assetify-scraper

Scraper harga emas, perak, dan perhiasan untuk Assetify.
Jalan otomatis setiap jam via GitHub Actions.
Hasil disimpan ke Supabase dan diekspor ke `prices.json` di repo ini.

## URL publik prices.json

```
https://raw.githubusercontent.com/GITHUB_USERNAME/assetify-scraper/main/prices.json
```

Ganti `GITHUB_USERNAME` dengan username GitHub kamu.
URL ini yang dipakai di `PRICES_URL` pada `Code.gs` Apps Script.

## Struktur repo

```
assetify-scraper/
├── .github/
│   └── workflows/
│       └── scraper.yml        ← GitHub Actions, jalan tiap jam
├── gold-bar/
│   ├── scrape-antam.js
│   ├── scrape-ubs.js
│   └── ...
├── silver-bar/
│   └── ...
├── jewelry/
│   └── ...
├── appscript/
│   ├── Code.gs                ← Pasang di Google Sheet template
│   └── index.html             ← Pasang di Google Sheet template
├── run-all-scraper.js
├── prices.json                ← Di-generate otomatis, jangan edit manual
├── package.json
├── .env.example
└── .gitignore
```

## Secrets yang dibutuhkan di GitHub

Masuk ke Settings → Secrets and variables → Actions:

| Secret | Keterangan |
|--------|-----------|
| `SUPABASE_URL` | URL project Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key Supabase |
| `TELEGRAM_BOT_TOKEN` | Opsional, untuk notifikasi |
| `TELEGRAM_CHAT_ID` | Opsional, untuk notifikasi |

`GITHUB_TOKEN` sudah tersedia otomatis — tidak perlu ditambah.

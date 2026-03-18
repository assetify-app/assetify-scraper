// ============================================================
//  ASSETIFY — Apps Script (aman di-share ke siapapun)
//  Tidak ada Supabase key. Tidak ada kredensial apapun.
//
//  Yang perlu kamu lakukan SEKALI di template master:
//  Ganti PRICES_URL di bawah dengan URL prices.json publik kamu.
// ============================================================
const PRICES_URL = 'https://r2.assetify.id/prices.json';
// ^ Ganti dengan URL Cloudflare R2 / GitHub raw / endpoint publik kamu
// Format JSON: array of { asset_type, brand, variant_label,
//                         variant_weight, sell_price, buyback_price }

const SHEET_NAME = 'Aset Saya';
const HEADERS    = ['id','asset_type','brand','variant_label',
                    'variant_weight','buy_price','bought_at','created_at'];

// ── Auto-buka dialog saat Sheet dibuka ──────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Assetify')
    .addItem('Buka Dashboard', 'openDashboard')
    .addToUi();
  openDashboard();
}

function openDashboard() {
  const html = HtmlService.createHtmlOutputFromFile('index')
    .setWidth(1100)
    .setHeight(720);
  SpreadsheetApp.getUi().showModalDialog(html, 'Assetify');
}

// ── Sheet helper ─────────────────────────────────────────────
function _getOrCreateSheet() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let   sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length)
         .setFontWeight('bold')
         .setBackground('#f3f4f6');
  }
  return sheet;
}

// ── READ ─────────────────────────────────────────────────────
function getAssets() {
  const sheet = _getOrCreateSheet();
  const data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

// ── CREATE ───────────────────────────────────────────────────
function saveAsset(asset) {
  const sheet = _getOrCreateSheet();
  sheet.appendRow([
    Utilities.getUuid(),
    asset.asset_type,
    asset.brand,
    asset.variant_label  || '',
    asset.variant_weight !== undefined ? asset.variant_weight : '',
    asset.buy_price      || 0,
    asset.bought_at      || '',
    new Date().toISOString()
  ]);
  return true;
}

// ── UPDATE ───────────────────────────────────────────────────
function updateAsset(asset) {
  const sheet   = _getOrCreateSheet();
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol   = headers.indexOf('id');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) !== String(asset.id)) continue;
    const r   = i + 1;
    const set = (col, val) =>
      sheet.getRange(r, headers.indexOf(col) + 1).setValue(val);
    set('asset_type',     asset.asset_type);
    set('brand',          asset.brand);
    set('variant_label',  asset.variant_label  || '');
    set('variant_weight', asset.variant_weight !== undefined ? asset.variant_weight : '');
    set('buy_price',      asset.buy_price      || 0);
    set('bought_at',      asset.bought_at      || '');
    return true;
  }
  return false;
}

// ── DELETE ───────────────────────────────────────────────────
function deleteAsset(id) {
  const sheet   = _getOrCreateSheet();
  const data    = sheet.getDataRange().getValues();
  const idCol   = data[0].indexOf('id');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

// ── FETCH HARGA dari URL publik (tanpa key, tanpa auth) ──────
// Dijalankan server-side agar tidak ada CORS issue di browser user.
// Supabase tidak pernah disentuh dari sisi user sama sekali.
function getPrices() {
  const resp = UrlFetchApp.fetch(PRICES_URL, {
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Gagal mengambil data harga. Coba lagi nanti.');
  }
  return JSON.parse(resp.getContentText());
}

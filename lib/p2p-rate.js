// lib/p2p-rate.js
// Live USDT/DZD exchange rate from Binance P2P (public endpoint, no API key).
// We use P2P rates, NOT bank/official rates, because the P2P market is the
// real-world price Algerians actually pay for USDT (the parallel market).

const BINANCE_P2P_URL = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';

const HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://p2p.binance.com',
  'Referer': 'https://p2p.binance.com/',
};

const CACHE_TTL_MS = 60 * 1000;
let cache = null;

function round(n, d = 4) {
  return Number(n.toFixed(d));
}

// tradeType is from the searcher's perspective:
//   'BUY'  -> returns SELL ads (the price you PAY to buy USDT)
//   'SELL' -> returns BUY ads  (the price you GET when selling USDT)
async function fetchAds(tradeType) {
  const body = {
    fiat: 'DZD',
    page: 1,
    rows: 20,
    tradeType,
    asset: 'USDT',
    countries: [],
    proMerchantAds: false,
    shieldMerchantAds: false,
    filterType: 'all',
    periods: [],
    additionalKycVerifyFilter: 0,
    publisherType: 'merchant',
    payTypes: [],
    classifies: ['mass', 'profession', 'fiat_trade'],
    tradedWith: false,
    followed: false,
  };

  const res = await fetch(BINANCE_P2P_URL, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) throw new Error(`Binance P2P responded ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.data) ? data.data : [];
}

// Volume-weighted average price of a set of ads (robust against outlier pricing).
function vwap(ads) {
  let sum = 0;
  let qty = 0;
  for (const ad of ads) {
    const price = parseFloat(ad?.adv?.price);
    const amount = parseFloat(ad?.adv?.tradableQuantity);
    if (Number.isFinite(price) && Number.isFinite(amount) && amount > 0) {
      sum += price * amount;
      qty += amount;
    }
  }
  return qty > 0 ? sum / qty : null;
}

/**
 * Get the current fair USDT -> DZD rate (mid of buy/sell VWAP), cached 60s.
 * @param {boolean} force - bypass cache
 * @returns {{ rate: number, buy: number, sell: number, fetchedAt: number }}
 */
async function getDzdRate(force = false) {
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;

  const [buyAds, sellAds] = await Promise.all([
    fetchAds('BUY'),
    fetchAds('SELL'),
  ]);

  const buyVwap = vwap(buyAds);
  const sellVwap = vwap(sellAds);
  const rate = buyVwap && sellVwap ? (buyVwap + sellVwap) / 2 : (buyVwap || sellVwap);

  if (!rate || rate <= 0) {
    throw new Error('Could not fetch a valid USDT/DZD rate from Binance P2P');
  }

  cache = {
    rate: round(rate, 4),
    buy: round(buyVwap || rate, 4),
    sell: round(sellVwap || rate, 4),
    fetchedAt: Date.now(),
  };
  return cache;
}

/** Convert DZD -> USDT at a given live rate, rounded to 5 decimals. */
function dzdToUsdt(dzd, rate) {
  return round(dzd / rate, 5);
}

module.exports = { getDzdRate, dzdToUsdt, round };

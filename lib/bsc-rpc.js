// lib/bsc-rpc.js
// BNB Smart Chain RPC provider with automatic fallback.
// The public Binance dataseed nodes throttle eth_getLogs for busy contracts
// (like USDT), so we prefer community/public node endpoints first.

const { ethers } = require('ethers');

const RPC_URLS = [
  'https://bsc-rpc.publicnode.com',
  'https://bsc-dataseed1.binance.org/',
  'https://bsc-dataseed2.binance.org/',
  'https://bsc-dataseed.binance.org/',
  'https://bsc-dataseed4.defibit.io',
];

let cachedProvider = null;

async function getProvider() {
  if (cachedProvider) return cachedProvider;

  for (const url of RPC_URLS) {
    try {
      const provider = new ethers.JsonRpcProvider(url);
      await provider.getBlockNumber();
      cachedProvider = provider;
      console.log('[bsc-rpc] connected:', url);
      return provider;
    } catch (err) {
      console.warn('[bsc-rpc] failed:', url, '-', err.message);
    }
  }

  throw new Error('No working BSC RPC endpoint available');
}

module.exports = { getProvider };

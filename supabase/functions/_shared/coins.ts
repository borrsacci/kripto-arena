// İşlem yapılabilen coinler. Fiyatlar Binance spot USDT paritelerinden alınır.
// maxLev veritabanındaki `coins` tablosuyla aynı olmalı (testler kontrol eder).
export interface Coin {
  symbol: string;
  pair: string;
  name: string;
  maxLev: number;
  color: string;
}

const c = (symbol: string, name: string, maxLev: number, color: string): Coin => ({ symbol, pair: `${symbol}USDT`, name, maxLev, color });

export const COINS: Coin[] = [
  c('BTC', 'Bitcoin', 125, '#F7931A'),
  c('ETH', 'Ethereum', 100, '#7B8CF0'),
  c('SOL', 'Solana', 75, '#A46BFF'),
  c('BNB', 'BNB', 75, '#E8B530'),
  c('XRP', 'XRP', 75, '#9AA4B8'),
  c('DOGE', 'Dogecoin', 50, '#C9A93A'),
  c('ADA', 'Cardano', 50, '#4A7BE0'),
  c('AVAX', 'Avalanche', 50, '#E84142'),
  c('LINK', 'Chainlink', 50, '#3E6AE0'),
  c('TRX', 'Tron', 50, '#EF3346'),
  c('TON', 'Toncoin', 50, '#2AA8F0'),
  c('SUI', 'Sui', 50, '#5AAEFF'),
  c('LTC', 'Litecoin', 50, '#B4B8C0'),
  c('DOT', 'Polkadot', 50, '#E6197F'),
  c('PEPE', 'Pepe', 25, '#4CAF50'),
  c('SHIB', 'Shiba Inu', 25, '#FF9F1A'),
];

export const COIN_BY_SYMBOL: Record<string, Coin> = Object.fromEntries(COINS.map((x) => [x.symbol, x]));

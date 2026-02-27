// ═══ Kripto Varlık Verileri ═══
export const DEFAULT_COINS = [
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin", market: "crypto" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum", market: "crypto" },
  { id: "binancecoin", symbol: "BNB", name: "BNB", market: "crypto" },
  { id: "solana", symbol: "SOL", name: "Solana", market: "crypto" },
  { id: "ripple", symbol: "XRP", name: "XRP", market: "crypto" },
  { id: "cardano", symbol: "ADA", name: "Cardano", market: "crypto" },
  { id: "avalanche-2", symbol: "AVAX", name: "Avalanche", market: "crypto" },
  { id: "polkadot", symbol: "DOT", name: "Polkadot", market: "crypto" },
  { id: "dogecoin", symbol: "DOGE", name: "Dogecoin", market: "crypto" },
  { id: "chainlink", symbol: "LINK", name: "Chainlink", market: "crypto" },
  { id: "tron", symbol: "TRX", name: "TRON", market: "crypto" },
  { id: "matic-network", symbol: "MATIC", name: "Polygon", market: "crypto" },
  { id: "litecoin", symbol: "LTC", name: "Litecoin", market: "crypto" },
  { id: "uniswap", symbol: "UNI", name: "Uniswap", market: "crypto" },
  { id: "stellar", symbol: "XLM", name: "Stellar", market: "crypto" },
];

// CoinGecko ID → Binance symbol overrides
export const BINANCE_OVERRIDES = {
  "binancecoin":"BNB","avalanche-2":"AVAX","matic-network":"MATIC",
  "shiba-inu":"SHIB","internet-computer":"ICP","render-token":"RENDER",
  "injective-protocol":"INJ","sei-network":"SEI","fetch-ai":"FET",
  "the-graph":"GRT","lido-dao":"LDO","immutable-x":"IMX",
  "hedera-hashgraph":"HBAR","theta-token":"THETA","cosmos":"ATOM",
  "bitcoin-cash":"BCH","wrapped-bitcoin":"WBTC","crypto-com-chain":"CRO",
  "elrond-erd-2":"EGLD","axie-infinity":"AXS","decentraland":"MANA",
  "the-sandbox":"SAND","enjincoin":"ENJ","basic-attention-token":"BAT",
  "zilliqa":"ZIL","harmony":"ONE","pancakeswap-token":"CAKE",
  "thorchain":"RUNE","curve-dao-token":"CRV","convex-finance":"CVX",
  "compound-governance-token":"COMP","yearn-finance":"YFI","sushi":"SUSHI",
  "1inch":"1INCH","gala":"GALA","flow":"FLOW","mina-protocol":"MINA",
  "quant-network":"QNT","terra-luna-2":"LUNA","stepn":"GMT",
  "ocean-protocol":"OCEAN","rocket-pool":"RPL","staked-ether":"STETH",
};

export const genDemo = () => {
  const p = {};
  const b = { bitcoin:97000, ethereum:3400, binancecoin:680, solana:190, ripple:2.3, cardano:0.72, "avalanche-2":38, polkadot:7.2, dogecoin:0.32, chainlink:22, tron:0.24, "matic-network":0.38, litecoin:108, uniswap:13.5, stellar:0.42 };
  DEFAULT_COINS.forEach(c => {
    const x = b[c.id] || 10;
    p[c.id] = { usd: x*(1+(Math.random()-.5)*.04), usd_24h_change: (Math.random()-.45)*12, usd_7d_change: (Math.random()-.45)*20, usd_market_cap: x*(1e6+Math.random()*1e9) };
  });
  return p;
};

// ═══ InvestPulse — Veri Kaynakları Birleşik Index ═══
import { DEFAULT_COINS, BINANCE_OVERRIDES, genDemo } from './crypto';
import { BIST_DATA } from './bist';
import { US_DATA } from './us';
import { TEFAS_DATA } from './tefas';

export const STOCK_DATA = { ...BIST_DATA, ...US_DATA, ...TEFAS_DATA };
export const ALL_ASSETS = {
  ...Object.fromEntries(DEFAULT_COINS.map(c => [c.id, c])),
  ...STOCK_DATA,
};

export const isStock = (id) => {
  const a = ALL_ASSETS[id];
  return a && (a.market === "bist" || a.market === "us" || a.market === "tefas");
};
export const getMarketType = (id) => ALL_ASSETS[id]?.market || "crypto";
export const getMarketLabel = (m) => ({ crypto: "Kripto", bist: "BIST", us: "ABD", tefas: "TEFAS" })[m] || m;
export const getMarketColor = (m) => ({ crypto: "#D4A017", bist: "#3B82F6", us: "#9333EA", tefas: "#06B6D4" })[m] || "#8B8EA0";

export const CLR = ["#9333EA","#D4A017","#3B82F6","#22C55E","#EF4444","#06B6D4","#EC4899","#F97316","#8B5CF6","#14B8A6","#F43F5E","#6366F1","#84CC16","#A855F7","#0EA5E9","#F59E0B","#10B981","#E879F9","#38BDF8","#FB923C"];
export const REFRESH = [{label:"1dk",value:60000},{label:"5dk",value:300000},{label:"10dk",value:600000},{label:"30dk",value:1800000}];
export const MAX_RETRIES = 5;
export const RETRY_DELAYS = [2000, 5000, 10000, 30000, 60000];
export const USD_TRY_DEFAULT = 36.42;

export { DEFAULT_COINS, BINANCE_OVERRIDES, genDemo };
export { BIST_DATA } from './bist';
export { US_DATA } from './us';
export { TEFAS_DATA } from './tefas';

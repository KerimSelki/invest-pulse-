import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { themes, animations, SPLASH_DURATION } from "./theme";
import { auth, loginWithEmail, registerWithEmail, loginWithGoogle, loginAsGuest, resetPassword, logoutUser, onAuthChange, getUserData, saveUserData, savePortfolios, updateProfile } from "./firebase";

// ═══ Modüler Veri Kaynakları ═══
import {
  DEFAULT_COINS, BINANCE_OVERRIDES, genDemo,
  STOCK_DATA, ALL_ASSETS,
  BIST_DATA, US_DATA, TEFAS_DATA,
  isStock, getMarketType, getMarketLabel, getMarketColor,
  CLR, REFRESH, MAX_RETRIES, RETRY_DELAYS,
} from "./data";
import { fmt, fPct, genChart } from "./utils/format";

const Spark = ({data,color}) => (<ResponsiveContainer width={100} height={36}><AreaChart data={data.slice(-14)}><defs><linearGradient id={`s${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={.3}/><stop offset="100%" stopColor={color} stopOpacity={0}/></linearGradient></defs><Area type="monotone" dataKey="price" stroke={color} strokeWidth={1.5} fill={`url(#s${color.replace("#","")})`} dot={false}/></AreaChart></ResponsiveContainer>);

// ═══ Coin Search/Picker Component ═══
const searchCache = {};
const CoinPicker = ({ value, onChange, prices, savedKey, knownCoins, fmpStocks }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [localResults, setLocalResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const debounceRef = useRef(null);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const found = knownCoins.find(c => c.id === value);
    if (found) setSelected(found);
  }, [value, knownCoins]);

  useEffect(() => {
    const handler = (e) => { if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setIsOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Instant local filter + delayed API search
  const searchCoins = useCallback(async (q) => {
    if (!q || q.length < 1) { setResults([]); setLocalResults([]); return; }
    const ql = q.toLowerCase();

    // 1) Instant local filter from known coins + STOCK_DATA + FMP stocks
    const local = knownCoins.filter(c =>
      c.name.toLowerCase().includes(ql) || c.symbol.toLowerCase().includes(ql)
    ).map(c => ({ ...c, thumb: null, marketCapRank: null, isLocal: true }));
    
    // STOCK_DATA (BIST + US + TEFAS)
    const stockResults = Object.values(STOCK_DATA).filter(s =>
      s.name.toLowerCase().includes(ql) || s.symbol.toLowerCase().includes(ql) || s.id.toLowerCase().includes(ql)
    ).map(s => ({ ...s, thumb: null, marketCapRank: null, isLocal: true, isStock: true }));
    
    // FMP full stock list (NYSE + NASDAQ + ETF) — tüm US hisseleri
    const fmpResults = (fmpStocks || []).filter(s =>
      s.n.toLowerCase().includes(ql) || s.s.toLowerCase().includes(ql)
    ).slice(0, 30).map(s => ({
      id: s.s, symbol: s.s, name: s.n,
      market: s.s.endsWith(".IS") ? "bist" : "us",
      currency: s.s.endsWith(".IS") ? "₺" : "$",
      sector: s.t === "etf" ? "ETF" : (s.e || "US"),
      thumb: null, marketCapRank: null, isLocal: true, isStock: true, isFMP: true,
    }));

    const combined = [];
    const seen = new Set();
    [...stockResults, ...fmpResults, ...local].forEach(c => { if (!seen.has(c.id)) { seen.add(c.id); combined.push(c); } });
    setLocalResults(combined.slice(0, 30));

    // If stock results found and query is short, skip CoinGecko API
    if ((stockResults.length + fmpResults.length) > 0 && q.length <= 4) { setResults([]); setSearching(false); return; }

    if (q.length < 2) { setResults([]); return; }

    // 2) Check cache first
    if (searchCache[ql]) { setResults(searchCache[ql]); setSearching(false); return; }

    // 3) API search (CoinGecko — crypto only)
    setSearching(true);
    try {
      const base = savedKey ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
      const kp = savedKey ? `&x_cg_pro_api_key=${savedKey}` : "";
      const res = await fetch(`${base}/search?query=${encodeURIComponent(q)}${kp}`);
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      const coins = (data.coins || []).slice(0, 15).map(c => ({
        id: c.id, symbol: c.symbol?.toUpperCase(), name: c.name,
        thumb: c.thumb, marketCapRank: c.market_cap_rank, market: "crypto",
      }));
      searchCache[ql] = coins;
      setResults(coins);
    } catch (e) {
      setResults([]);
    }
    setSearching(false);
  }, [savedKey, knownCoins, fmpStocks]);

  const handleInput = (e) => {
    const val = e.target.value;
    setQuery(val);
    setIsOpen(true);
    if (val.length >= 1) {
      const ql = val.toLowerCase();
      const localCoins = knownCoins.filter(c =>
        c.name.toLowerCase().includes(ql) || c.symbol.toLowerCase().includes(ql)
      ).map(c => ({ ...c, thumb: null, marketCapRank: null, isLocal: true }));
      const stockMatches = Object.values(STOCK_DATA).filter(s =>
        s.name.toLowerCase().includes(ql) || s.symbol.toLowerCase().includes(ql) || s.id.toLowerCase().includes(ql)
      ).map(s => ({ ...s, thumb: null, marketCapRank: null, isLocal: true, isStock: true }));
      const fmpMatches = (fmpStocks || []).filter(s =>
        s.n.toLowerCase().includes(ql) || s.s.toLowerCase().includes(ql)
      ).slice(0, 20).map(s => ({
        id: s.s, symbol: s.s, name: s.n,
        market: s.s.endsWith(".IS") ? "bist" : "us",
        currency: s.s.endsWith(".IS") ? "₺" : "$",
        sector: s.t === "etf" ? "ETF" : (s.e || "US"),
        thumb: null, marketCapRank: null, isLocal: true, isStock: true, isFMP: true,
      }));
      const seen = new Set();
      const combined = [];
      [...stockMatches, ...fmpMatches, ...localCoins].forEach(c => { if (!seen.has(c.id)) { seen.add(c.id); combined.push(c); } });
      setLocalResults(combined.slice(0, 30));
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchCoins(val), 250);
  };

  const selectCoin = (coin) => {
    setSelected(coin);
    setQuery("");
    setIsOpen(false);
    setResults([]);
    setLocalResults([]);
    onChange(coin);
  };

  // Merge local + API results, deduplicated (stocks first)
  const allResults = useMemo(() => {
    const seen = new Set();
    const merged = [];
    // Stock/TEFAS results first (instant, prioritized)
    localResults.filter(c => c.isStock).forEach(c => { if (!seen.has(c.id)) { seen.add(c.id); merged.push(c); } });
    // Then other local results
    localResults.filter(c => !c.isStock).forEach(c => { if (!seen.has(c.id)) { seen.add(c.id); merged.push(c); } });
    // Then API results (crypto)
    results.forEach(c => { if (!seen.has(c.id)) { seen.add(c.id); merged.push(c); } });
    return merged;
  }, [localResults, results]);

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <label style={{display:"block",fontSize:11,color:"#8B8EA0",marginBottom:6,fontWeight:500,textTransform:"uppercase",letterSpacing:.5}}>Varlık Ara & Seç</label>

      {/* Selected display */}
      {selected && !isOpen && (
        <div onClick={() => { setIsOpen(true); setQuery(""); }}
          style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"#0E1018",border:"1px solid #2A2D45",borderRadius:8,cursor:"pointer",transition:"border-color .2s"}}>
          {selected.thumb ? <img src={selected.thumb} alt="" style={{width:24,height:24,borderRadius:6}}/> :
            <div style={{width:24,height:24,borderRadius:6,background:"#9333EA22",color:"#9333EA",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,fontFamily:"'Inter',monospace"}}>{selected.symbol?.charAt(0)}</div>}
          <div style={{flex:1}}>
            <span style={{fontWeight:600,fontSize:14,color:"#E8E9ED"}}>{selected.name}</span>
            <span style={{fontSize:12,color:"#4A4D65",marginLeft:8,fontFamily:"'JetBrains Mono',monospace"}}>{selected.symbol}</span>
          </div>
          <span style={{fontSize:12,color:"#4A4D65"}}>Değiştir ▾</span>
        </div>
      )}

      {/* Search input */}
      {(isOpen || !selected) && (
        <div style={{position:"relative"}}>
          <input
            autoFocus
            value={query}
            onChange={handleInput}
            onFocus={() => setIsOpen(true)}
            placeholder="BTC, THYAO, AAPL, IPB... yazın"
            style={{width:"100%",padding:"10px 12px 10px 36px",background:"#0E1018",border:"1px solid #9333EA44",borderRadius:8,color:"#E8E9ED",fontSize:14,outline:"none",fontFamily:"'Inter',sans-serif"}}
          />
          <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#4A4D65",fontSize:14}}>🔍</span>
          {searching && <span style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",color:"#9333EA",fontSize:12,animation:"spin 1s linear infinite"}}>◌</span>}
        </div>
      )}

      {/* Dropdown results */}
      {isOpen && (
        <div style={{position:"absolute",top:"100%",left:0,right:0,marginTop:4,background:"#151720",border:"1px solid #2A2D45",borderRadius:10,maxHeight:280,overflowY:"auto",zIndex:50,boxShadow:"0 12px 40px rgba(0,0,0,.5)"}}>
          {/* Show default coins when no search */}
          {query.length < 2 && (
            <>
              <div style={{padding:"8px 12px",fontSize:11,color:"#4A4D65",textTransform:"uppercase",letterSpacing:.5,borderBottom:`1px solid #1E2035`}}>Popüler Kriptolar</div>
              {DEFAULT_COINS.slice(0,8).map(coin => {
                const p = prices[coin.id];
                return (
                  <div key={coin.id} onClick={() => selectCoin(coin)}
                    style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",cursor:"pointer",borderBottom:`1px solid #151720`,transition:"background .15s"}}
                    onMouseEnter={e=>e.currentTarget.style.background="#1E2035"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <div style={{width:28,height:28,borderRadius:7,background:"#9333EA15",color:"#9333EA",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,fontFamily:"'Inter',monospace"}}>{coin.symbol.charAt(0)}</div>
                    <div style={{flex:1}}><div style={{fontWeight:600,fontSize:13,color:"#E8E9ED"}}>{coin.name}</div><div style={{fontSize:11,color:"#4A4D65",fontFamily:"'JetBrains Mono',monospace"}}>{coin.symbol}</div></div>
                    {p && <div style={{textAlign:"right"}}><div style={{fontSize:12,fontFamily:"'JetBrains Mono',monospace",color:"#E8E9ED"}}>{fmt(p.usd,p.usd<1?4:2)}</div></div>}
                  </div>
                );
              })}
              <div style={{padding:"8px 12px",fontSize:11,color:"#3b82f6",textTransform:"uppercase",letterSpacing:.5,borderBottom:`1px solid #1E2035`,background:"#3b82f608"}}>BIST · ABD · TEFAS</div>
              {Object.values(STOCK_DATA).slice(0,15).map(asset => {
                const p = prices[asset.id];
                const mc = getMarketColor(asset.market);
                return (
                  <div key={asset.id} onClick={() => selectCoin(asset)}
                    style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",cursor:"pointer",borderBottom:`1px solid #151720`,transition:"background .15s"}}
                    onMouseEnter={e=>e.currentTarget.style.background="#1E2035"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <div style={{width:28,height:28,borderRadius:7,background:mc+"15",color:mc,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,fontFamily:"'Inter',monospace"}}>{asset.symbol.charAt(0)}</div>
                    <div style={{flex:1}}><div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontWeight:600,fontSize:13,color:"#E8E9ED"}}>{asset.name}</span><span style={{fontSize:8,padding:"1px 5px",borderRadius:3,background:mc+"18",color:mc,fontWeight:700}}>{getMarketLabel(asset.market)}</span></div><div style={{fontSize:11,color:"#4A4D65",fontFamily:"'JetBrains Mono',monospace"}}>{asset.symbol}</div></div>
                    {p && <div style={{textAlign:"right"}}><div style={{fontSize:12,fontFamily:"'JetBrains Mono',monospace",color:"#E8E9ED"}}>{fmt(p.usd,p.usd<1?4:2,asset.currency)}</div></div>}
                  </div>
                );
              })}
            </>
          )}

          {/* Search results */}
          {query.length >= 1 && allResults.length === 0 && !searching && (
            <div style={{padding:20,textAlign:"center",color:"#4A4D65",fontSize:13}}>Sonuç bulunamadı</div>
          )}
          {query.length >= 1 && allResults.map(coin => {
            const mc = getMarketColor(coin.market||"crypto");
            return (
            <div key={coin.id} onClick={() => selectCoin(coin)}
              style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",cursor:"pointer",borderBottom:`1px solid #151720`,transition:"background .15s"}}
              onMouseEnter={e=>e.currentTarget.style.background="#1E2035"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              {coin.thumb ? <img src={coin.thumb} alt="" style={{width:28,height:28,borderRadius:7}}/> :
                <div style={{width:28,height:28,borderRadius:7,background:mc+"22",color:mc,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,fontFamily:"'Inter',monospace"}}>{coin.symbol?.charAt(0)}</div>}
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontWeight:600,fontSize:13,color:"#E8E9ED"}}>{coin.name}</span>{coin.market&&coin.market!=="crypto"&&<span style={{fontSize:8,padding:"1px 5px",borderRadius:3,background:mc+"18",color:mc,fontWeight:700}}>{getMarketLabel(coin.market)}</span>}</div>
                <div style={{fontSize:11,color:"#4A4D65",fontFamily:"'JetBrains Mono',monospace"}}>{coin.symbol}</div>
              </div>
              {coin.marketCapRank && <span style={{fontSize:11,color:"#4A4D65",fontFamily:"'JetBrains Mono',monospace"}}>#{coin.marketCapRank}</span>}
            </div>
          );})}
        </div>
      )}
    </div>
  );
};

// ═══ Connection Status Bar ═══
const ConnBar = ({status,retryCount,lastUpdate,refreshInterval,onRefreshChange,apiMode,onRetry,rateLimitInfo}) => {
  const c={connected:{color:"#22C55E",bg:"rgba(34,197,94,.07)",bdr:"rgba(34,197,94,.2)",icon:"●",lbl:"Canlı Bağlantı"},connecting:{color:"#EAB308",bg:"#EAB30812",bdr:"#EAB30833",icon:"◌",lbl:"Bağlanıyor..."},retrying:{color:"#D4A017",bg:"#D4A01712",bdr:"#D4A01733",icon:"↻",lbl:`Yeniden Deneme (${retryCount}/${MAX_RETRIES})`},error:{color:"#EF4444",bg:"rgba(239,68,68,.07)",bdr:"rgba(239,68,68,.2)",icon:"✕",lbl:"Bağlantı Hatası"},ratelimited:{color:"#D4A017",bg:"#D4A01712",bdr:"#D4A01733",icon:"⏱",lbl:"Rate Limit"},demo:{color:"#8B8EA0",bg:"#8B8EA012",bdr:"#8B8EA033",icon:"◇",lbl:"Demo Modu"}}[status]||{color:"#8B8EA0",bg:"#8B8EA012",bdr:"#8B8EA033",icon:"◇",lbl:"Demo"};
  const spinning=status==="connecting"||status==="retrying";
  return (
    <div style={{padding:"10px 24px",background:"#0B0D15",borderBottom:`1px solid #151720`}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:28,height:28,borderRadius:8,border:`1px solid ${c.bdr}`,background:c.bg,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{color:c.color,fontSize:spinning?14:10,display:"inline-block",animation:spinning?"spin 1s linear infinite":"none"}}>{c.icon}</span></div>
          <div><div style={{fontSize:13,fontWeight:600,color:c.color}}>{c.lbl}</div><div style={{fontSize:11,color:"#4A4D65"}}>{apiMode==="live"?"Binance + CoinGecko":"Çevrimdışı"}{lastUpdate&&` • ${lastUpdate.toLocaleTimeString("tr-TR")}`}</div></div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {status==="error"&&<button onClick={onRetry} style={{padding:"6px 14px",background:"#151720",border:"1px solid #2A2D45",color:"#9333EA",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"'Inter',sans-serif"}}>↻ Tekrar Dene</button>}
          <div style={{display:"flex",alignItems:"center",gap:4}}><span style={{fontSize:11,color:"#4A4D65",marginRight:4}}>Güncelleme:</span>
          {REFRESH.map(o=><button key={o.value} onClick={()=>onRefreshChange(o.value)} style={{padding:"4px 10px",background:refreshInterval===o.value?"#9333EA18":"transparent",border:`1px solid ${refreshInterval===o.value?"#9333EA44":"#1E2035"}`,color:refreshInterval===o.value?"#9333EA":"#4A4D65",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"'Inter',sans-serif"}}>{o.label}</button>)}</div>
        </div>
      </div>
      {rateLimitInfo&&<div style={{marginTop:8,padding:"8px 12px",background:"rgba(212,160,23,.08)",borderRadius:8,border:"1px solid rgba(212,160,23,.2)"}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{color:"#D4A017",fontSize:11}}>⚠ Rate Limit</span><span style={{color:"#8B8EA0",fontSize:11}}>{rateLimitInfo}</span></div></div>}
    </div>
  );
};

// ═══ Settings Panel ═══
const Settings = ({show,onClose,apiKey,onKeyChange,onSave,keyStatus}) => {
  if(!show) return null;
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,backdropFilter:"blur(8px)"}} onClick={onClose}>
      <div style={{background:"linear-gradient(135deg,#131a27,#12141E)",border:"1px solid #2A2D45",borderRadius:16,width:"100%",maxWidth:500,boxShadow:"0 24px 64px rgba(0,0,0,.5)"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 20px",borderBottom:`1px solid #1E2035`}}><h3 style={{fontSize:16,fontWeight:600,color:"#E8E9ED"}}>⚙ API Ayarları</h3><button style={{background:"none",border:"none",color:"#4A4D65",fontSize:18,cursor:"pointer"}} onClick={onClose}>✕</button></div>
        <div style={{padding:20}}>
          <div style={{marginBottom:24}}>
            <div style={{fontSize:14,fontWeight:600,color:"#E8E9ED",marginBottom:6}}>CoinGecko API</div>
            <div style={{fontSize:12,color:"#4A4D65",lineHeight:1.5,marginBottom:12}}>Ücretsiz plan: ~10-30 req/dk. Pro plan ile daha yüksek limitler.</div>
            <div style={{display:"flex",gap:10,alignItems:"flex-end"}}>
              <div style={{flex:1}}><label style={{display:"block",fontSize:11,color:"#8B8EA0",marginBottom:6,fontWeight:500,textTransform:"uppercase",letterSpacing:.5}}>API Key (Opsiyonel)</label><input style={{width:"100%",padding:"10px 12px",background:"#0E1018",border:"1px solid #2A2D45",borderRadius:8,color:"#E8E9ED",fontSize:14,outline:"none",fontFamily:"'JetBrains Mono',monospace"}} type="password" placeholder="CG-xxxxxxxxxxxx" value={apiKey} onChange={e=>onKeyChange(e.target.value)}/></div>
              <button style={{padding:"10px 16px",background:"linear-gradient(135deg,#9333EA,#D4A017)",border:"none",borderRadius:8,color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Inter',sans-serif"}} onClick={onSave}>Kaydet</button>
            </div>
            {keyStatus&&<div style={{marginTop:8,fontSize:12,fontWeight:500,color:keyStatus.type==="success"?"#22C55E":"#EAB308"}}>{keyStatus.type==="success"?"✓":"⏳"} {keyStatus.message}</div>}
          </div>
          <div>
            <div style={{fontSize:14,fontWeight:600,color:"#E8E9ED",marginBottom:10}}>Rate Limit Bilgisi</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
              {[["Ücretsiz","10-30/dk"],["Demo Key","30/dk"],["Pro","500/dk"]].map(([l,v])=><div key={l} style={{background:"#0E1018",borderRadius:8,padding:12,border:`1px solid #1E2035`,textAlign:"center"}}><div style={{fontSize:10,color:"#4A4D65",textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>{l}</div><div style={{fontSize:14,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:"#E8E9ED"}}>{v}</div></div>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ═══ Splash Screen — Premium Açılış Animasyonu ═══
const SplashScreen = ({ onFinish }) => {
  const [phase, setPhase] = useState(0); // 0: logo, 1: text, 2: fade out

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 600);
    const t2 = setTimeout(() => setPhase(2), 2000);
    const t3 = setTimeout(() => onFinish(), SPLASH_DURATION);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onFinish]);

  return (
    <div style={{position:"fixed",inset:0,zIndex:9999,background:"#0B0D15",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",opacity:phase===2?0:1,transition:"opacity 0.8s ease-out",fontFamily:"'Inter',sans-serif"}}>
      {/* Animated gradient orbs */}
      <div style={{position:"absolute",width:300,height:300,borderRadius:"50%",background:"radial-gradient(circle,rgba(147,51,234,.15) 0%,transparent 70%)",top:"30%",left:"40%",animation:"float 4s ease-in-out infinite",filter:"blur(40px)"}}/>
      <div style={{position:"absolute",width:200,height:200,borderRadius:"50%",background:"radial-gradient(circle,rgba(212,160,23,.12) 0%,transparent 70%)",top:"45%",left:"55%",animation:"float 5s ease-in-out infinite reverse",filter:"blur(30px)"}}/>
      
      {/* Logo */}
      <div style={{position:"relative",marginBottom:32}}>
        {/* Pulse ring */}
        <div style={{position:"absolute",inset:-20,borderRadius:"50%",border:"2px solid rgba(147,51,234,.3)",animation:"pulseRing 2s ease-out infinite"}}/>
        <svg width="80" height="80" viewBox="0 0 80 80" style={{opacity:phase>=0?1:0,transform:phase>=0?"scale(1)":"scale(0.5)",transition:"all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)"}}>
          <defs>
            <linearGradient id="splashGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#9333EA"/>
              <stop offset="100%" stopColor="#D4A017"/>
            </linearGradient>
          </defs>
          <circle cx="40" cy="40" r="38" fill="none" stroke="url(#splashGrad)" strokeWidth="2.5" opacity="0.6"/>
          <path d="M20 44 L32 30 L44 40 L60 20" fill="none" stroke="url(#splashGrad)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="100" style={{animation:"drawLine 1.2s ease-out forwards",animationDelay:"0.3s"}}/>
          <circle cx="60" cy="20" r="4" fill="#D4A017" style={{opacity:phase>=1?1:0,transition:"opacity 0.5s",transitionDelay:"0.8s"}}/>
        </svg>
      </div>

      {/* Brand name */}
      <div style={{opacity:phase>=1?1:0,transform:phase>=1?"translateY(0)":"translateY(15px)",transition:"all 0.6s ease-out"}}>
        <div style={{fontSize:36,fontWeight:800,letterSpacing:"-0.5px",background:"linear-gradient(135deg,#9333EA,#D4A017)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",marginBottom:8}}>InvestPulse</div>
        <div style={{fontSize:13,color:"#4A4D65",textAlign:"center",letterSpacing:2,textTransform:"uppercase"}}>Portföy Yönetim Sistemi</div>
      </div>

      {/* Loading indicator */}
      <div style={{marginTop:40,width:120,height:2,background:"#1E2035",borderRadius:2,overflow:"hidden",opacity:phase>=1?1:0,transition:"opacity 0.4s"}}>
        <div style={{height:"100%",background:"linear-gradient(90deg,#9333EA,#D4A017)",borderRadius:2,animation:"loadBar 1.8s ease-in-out"}}/>
      </div>

      <style>{animations}</style>
    </div>
  );
};

// ═══ Auth System with Registration ═══
const AuthScreen = ({ onLogin }) => {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    const unsub = onAuthChange((user) => {
      if (user) onLogin(user);
      setCheckingAuth(false);
    });
    return unsub;
  }, [onLogin]);

  if (checkingAuth) return (
    <div style={{minHeight:"100vh",background:"#0B0D15",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:40,marginBottom:16,animation:"spin 1s linear infinite"}}>◌</div>
        <div style={{color:"#4A4D65",fontSize:14}}>Oturum kontrol ediliyor...</div>
      </div>
      <style>{animations}</style>
    </div>
  );

  const handleLogin = async () => {
    if (!email.trim() || !password) { setError("E-posta ve şifre gerekli"); return; }
    setLoading(true); setError("");
    try { await loginWithEmail(email.trim(), password); }
    catch (e) {
      const msg = e.code === "auth/invalid-credential" ? "E-posta veya şifre hatalı" :
        e.code === "auth/user-not-found" ? "Hesap bulunamadı" :
        e.code === "auth/too-many-requests" ? "Çok fazla deneme, bekleyin" :
        e.code === "auth/invalid-email" ? "Geçersiz e-posta" : "Giriş hatası: " + e.message;
      setError(msg);
    }
    setLoading(false);
  };

  const handleRegister = async () => {
    if (!username.trim() || username.trim().length < 3) { setError("Kullanıcı adı en az 3 karakter"); return; }
    if (!email.trim()) { setError("E-posta gerekli"); return; }
    if (password.length < 6) { setError("Şifre en az 6 karakter"); return; }
    if (password !== confirmPass) { setError("Şifreler eşleşmiyor"); return; }
    setLoading(true); setError("");
    try {
      const cred = await registerWithEmail(email.trim(), password);
      await updateProfile(cred.user, { displayName: username.trim() });
      await saveUserData(cred.user.uid, { name: username.trim(), email: email.trim().toLowerCase(), createdAt: new Date().toISOString() });
    } catch (e) {
      const msg = e.code === "auth/email-already-in-use" ? "Bu e-posta zaten kayıtlı" :
        e.code === "auth/weak-password" ? "Şifre çok zayıf" :
        e.code === "auth/invalid-email" ? "Geçersiz e-posta" : "Kayıt hatası: " + e.message;
      setError(msg);
    }
    setLoading(false);
  };

  const handleGoogleLogin = async () => {
    setLoading(true); setError("");
    try {
      const cred = await loginWithGoogle();
      await saveUserData(cred.user.uid, { name: cred.user.displayName || "Google Kullanıcı", email: cred.user.email, loginMethod: "google", lastLogin: new Date().toISOString() });
    } catch (e) { if (e.code !== "auth/popup-closed-by-user") setError("Google giriş hatası"); }
    setLoading(false);
  };

  const handleGuestLogin = async () => {
    setLoading(true); setError("");
    try { await loginAsGuest(); } catch (e) { setError("Misafir giriş hatası"); }
    setLoading(false);
  };

  const handleForgot = async () => {
    if (!email.trim()) { setError("E-posta girin"); return; }
    setLoading(true); setError("");
    try {
      await resetPassword(email.trim());
      setSuccess("Şifre sıfırlama e-postası gönderildi!");
      setTimeout(() => { setMode("login"); setSuccess(""); }, 4000);
    } catch (e) {
      setError(e.code === "auth/user-not-found" ? "Hesap bulunamadı" : "Hata: " + e.message);
    }
    setLoading(false);
  };

  const inpSt = {width:"100%",padding:"12px 14px 12px 42px",background:"#0E1018",border:"1px solid #1E2035",borderRadius:10,color:"#E8E9ED",fontSize:14,outline:"none",fontFamily:"'Inter',sans-serif",transition:"all .2s"};
  const iconSt = {position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",fontSize:16,color:"#4A4D65"};
  const eyeSt = {position:"absolute",right:14,top:"50%",transform:"translateY(-50%)",cursor:"pointer",fontSize:14,color:"#4A4D65",userSelect:"none"};
  const Inp = (icon, val, set, ph, type="text", onKey=null) => (
    <div style={{position:"relative",marginBottom:16}}>
      <span style={iconSt}>{icon}</span>
      <input type={type==="password"?(showPass?"text":"password"):type} value={val}
        onChange={e=>{set(e.target.value);setError("");}}
        onKeyDown={e=>e.key==="Enter"&&onKey&&onKey()}
        onFocus={e=>e.target.style.borderColor="#9333EA44"}
        onBlur={e=>e.target.style.borderColor="#1E2035"}
        placeholder={ph} style={inpSt}/>
      {type==="password"&&<span onClick={()=>setShowPass(!showPass)} style={eyeSt}>{showPass?"◉":"◎"}</span>}
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#0B0D15",display:"flex",fontFamily:"'Inter',sans-serif"}}>
      <div style={{flex:1,background:"linear-gradient(135deg,#1A0D2E 0%,#0B0D15 50%,#1A1508 100%)",display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",padding:40,position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",inset:0,opacity:.04,backgroundImage:"radial-gradient(circle at 1px 1px, #9333EA 1px, transparent 0)",backgroundSize:"40px 40px"}}/>
        <div style={{position:"absolute",width:400,height:400,borderRadius:"50%",background:"radial-gradient(circle,rgba(147,51,234,.08) 0%,transparent 70%)",top:"20%",left:"20%",filter:"blur(60px)"}}/>
        <div style={{position:"absolute",width:300,height:300,borderRadius:"50%",background:"radial-gradient(circle,rgba(212,160,23,.06) 0%,transparent 70%)",bottom:"20%",right:"20%",filter:"blur(50px)"}}/>
        <div style={{position:"relative",zIndex:1,textAlign:"center",maxWidth:400}}>
          <svg width="72" height="72" viewBox="0 0 80 80" style={{marginBottom:24,filter:"drop-shadow(0 0 30px rgba(147,51,234,.3))"}}>
            <defs><linearGradient id="authGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#9333EA"/><stop offset="100%" stopColor="#D4A017"/></linearGradient></defs>
            <circle cx="40" cy="40" r="38" fill="none" stroke="url(#authGrad)" strokeWidth="2"/>
            <path d="M20 44 L32 30 L44 40 L60 20" fill="none" stroke="url(#authGrad)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="60" cy="20" r="3.5" fill="#D4A017"/>
          </svg>
          <div style={{fontSize:38,fontWeight:800,letterSpacing:"-0.5px",background:"linear-gradient(135deg,#9333EA,#D4A017)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",marginBottom:12}}>InvestPulse</div>
          <div style={{fontSize:15,color:"#4A4D65",lineHeight:1.6,marginBottom:32}}>Kripto, BIST, TEFAS ve ABD hisseleri.</div>
          <div style={{display:"flex",gap:24,justifyContent:"center"}}>
            {[["8000+","Hisse"],["800+","Kripto"],["BIST","516"],["ETF","60+"]].map(([n,l])=>(
              <div key={l+n} style={{textAlign:"center"}}>
                <div style={{fontSize:22,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",background:"linear-gradient(135deg,#9333EA,#D4A017)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>{n}</div>
                <div style={{fontSize:11,color:"#4A4D65",textTransform:"uppercase",letterSpacing:1,marginTop:2}}>{l}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{position:"absolute",bottom:24,fontSize:11,color:"#1E2035"}}>© 2026 InvestPulse</div>
      </div>
      <div style={{width:480,display:"flex",alignItems:"center",justifyContent:"center",padding:40,background:"#080A12"}}>
        <div style={{width:"100%",maxWidth:380}}>
          <div style={{display:"flex",gap:2,background:"#0E1018",borderRadius:10,padding:3,marginBottom:32}}>
            {[["login","Giriş Yap"],["register","Kayıt Ol"]].map(([m,l])=>(
              <button key={m} onClick={()=>{setMode(m);setError("");setSuccess("");}}
                style={{flex:1,padding:"10px",borderRadius:8,border:"none",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Inter',sans-serif",
                  background:mode===m?"linear-gradient(135deg,#9333EA15,#D4A01710)":"transparent",
                  color:mode===m?"#A855F7":"#4A4D65",transition:"all .2s"}}>{l}</button>
            ))}
          </div>
          {mode==="login"&&<>
            <h2 style={{fontSize:24,fontWeight:700,color:"#E8E9ED",marginBottom:4}}>Hoş Geldiniz</h2>
            <p style={{fontSize:13,color:"#4A4D65",marginBottom:28}}>Hesabınıza giriş yapın</p>
            {Inp("✉",email,setEmail,"E-posta adresi","email",handleLogin)}
            {Inp("🔒",password,setPassword,"Şifre","password",handleLogin)}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
              <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:13,color:"#4A4D65"}}>
                <div onClick={()=>setRememberMe(!rememberMe)} style={{width:18,height:18,borderRadius:4,border:"1px solid "+(rememberMe?"#9333EA":"#2A2D45"),background:rememberMe?"#9333EA22":"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
                  {rememberMe&&<span style={{color:"#9333EA",fontSize:12}}>✓</span>}
                </div>
                Beni hatırla
              </label>
              <span onClick={()=>{setMode("forgot");setError("");}} style={{fontSize:12,color:"#9333EA",cursor:"pointer"}}>Şifremi unuttum</span>
            </div>
          </>}
          {mode==="register"&&<>
            <h2 style={{fontSize:24,fontWeight:700,color:"#E8E9ED",marginBottom:4}}>Hesap Oluştur</h2>
            <p style={{fontSize:13,color:"#4A4D65",marginBottom:28}}>Ücretsiz hesabınızı oluşturun</p>
            {Inp("👤",username,setUsername,"Kullanıcı adı (min. 3 karakter)")}
            {Inp("✉",email,setEmail,"E-posta adresi","email")}
            {Inp("🔒",password,setPassword,"Şifre (min. 6 karakter)","password")}
            {Inp("🔒",confirmPass,setConfirmPass,"Şifre tekrar","password",handleRegister)}
          </>}
          {mode==="forgot"&&<>
            <h2 style={{fontSize:24,fontWeight:700,color:"#E8E9ED",marginBottom:4}}>Şifre Sıfırlama</h2>
            <p style={{fontSize:13,color:"#4A4D65",marginBottom:28}}>E-postanıza sıfırlama bağlantısı göndereceğiz</p>
            {Inp("✉",email,setEmail,"E-posta adresi","email",handleForgot)}
            <span onClick={()=>{setMode("login");setError("");}} style={{fontSize:12,color:"#9333EA",cursor:"pointer"}}>← Giriş'e dön</span>
            <div style={{height:16}}/>
          </>}
          {error&&<div style={{padding:"10px 14px",background:"rgba(239,68,68,.07)",border:"1px solid rgba(239,68,68,.2)",borderRadius:8,color:"#EF4444",fontSize:13,marginBottom:16,display:"flex",alignItems:"center",gap:8}}><span>⚠</span>{error}</div>}
          {success&&<div style={{padding:"10px 14px",background:"rgba(34,197,94,.07)",border:"1px solid rgba(34,197,94,.2)",borderRadius:8,color:"#22C55E",fontSize:13,marginBottom:16,display:"flex",alignItems:"center",gap:8}}><span>✓</span>{success}</div>}
          <button onClick={mode==="login"?handleLogin:mode==="register"?handleRegister:handleForgot} disabled={loading}
            style={{width:"100%",padding:"14px",background:loading?"#6b4a0a":"linear-gradient(135deg,#9333EA,#D4A017)",border:"none",borderRadius:12,color:"#fff",fontSize:15,fontWeight:600,cursor:loading?"wait":"pointer",fontFamily:"'Inter',sans-serif",boxShadow:"0 4px 24px rgba(147,51,234,.25)",opacity:loading?.7:1}}>
            {loading?"İşleniyor...":mode==="login"?"Giriş Yap":mode==="register"?"Kayıt Ol":"Sıfırlama E-postası Gönder"}
          </button>
          {mode!=="forgot"&&<>
            <div style={{display:"flex",alignItems:"center",gap:12,margin:"20px 0"}}><div style={{flex:1,height:1,background:"#1E2035"}}/><span style={{fontSize:12,color:"#4A4D65"}}>veya</span><div style={{flex:1,height:1,background:"#1E2035"}}/></div>
            <button onClick={handleGoogleLogin} disabled={loading}
              style={{width:"100%",padding:"12px",background:"#0E1018",border:"1px solid #2A2D45",borderRadius:10,color:"#E8E9ED",fontSize:14,fontWeight:500,cursor:"pointer",fontFamily:"'Inter',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:10}}
              onMouseEnter={e=>e.currentTarget.style.borderColor="#9333EA44"} onMouseLeave={e=>e.currentTarget.style.borderColor="#2A2D45"}>
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              Google ile Giriş Yap
            </button>
            <button onClick={handleGuestLogin} disabled={loading}
              style={{width:"100%",padding:"12px",background:"transparent",border:"1px solid #1E2035",borderRadius:10,color:"#4A4D65",fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"'Inter',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}
              onMouseEnter={e=>e.currentTarget.style.borderColor="#4A4D65"} onMouseLeave={e=>e.currentTarget.style.borderColor="#1E2035"}>
              👤 Misafir olarak devam et
            </button>
          </>}
        </div>
      </div>
      <style>{animations + "\n@media(max-width:900px){div[style*=\"flex:1\"]{display:none!important}div[style*=\"width:480\"]{width:100%!important}}"}</style>
    </div>
  );
};

// ═══════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════
export default function CryptoPortfolio() {
  const [showSplash, setShowSplash] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState("");
  const [themeMode, setThemeMode] = useState(() => {
    try { return localStorage.getItem("ip_theme") || "dark"; } catch(e) { return "dark"; }
  });
  const T = themes[themeMode];
  const toggleTheme = () => {
    const next = themeMode === "dark" ? "light" : "dark";
    setThemeMode(next);
    try { localStorage.setItem("ip_theme", next); } catch(e) {}
  };
  const [tab, setTab] = useState("overview");
  // ═══ TRADE JOURNAL STATE ═══
  const [trades, setTrades] = useState(() => { try { return JSON.parse(localStorage.getItem("ip_trades") || "[]"); } catch(e) { return []; } });
  const [tradeView, setTradeView] = useState("list"); // list | add | analytics | goals
  const [tradeFilter, setTradeFilter] = useState("all"); // all | open | closed | win | loss
  const [tradeSearch, setTradeSearch] = useState("");
  const [tradeKasa, setTradeKasa] = useState(() => { try { return parseFloat(localStorage.getItem("ip_trade_kasa") || "5000"); } catch(e) { return 5000; } });
  const [goals, setGoals] = useState(() => { try { return JSON.parse(localStorage.getItem("ip_goals") || "[]"); } catch(e) { return []; } });
  const [editTrade, setEditTrade] = useState(null);
  const [newTrade, setNewTrade] = useState({symbol:"",market:"Kripto",exchange:"Bybit",direction:"Long",status:"Acik",leverage:"1x",entryPrice:"",exitPrice:"",amount:"100",stopLoss:"",tp1:"",tp2:"",tp3:"",entryDate:new Date().toISOString().slice(0,16),exitDate:"",strategy:"",tags:"",notes:"",score:5,setupQuality:"B Orta",execution:5,followedPlan:true,setupType:"",emotion:"",mistakes:"",successes:"",lessons:""});

  // Trade localStorage sync
  useEffect(() => { try { localStorage.setItem("ip_trades", JSON.stringify(trades)); } catch(e) {} }, [trades]);
  useEffect(() => { try { localStorage.setItem("ip_trade_kasa", String(tradeKasa)); } catch(e) {} }, [tradeKasa]);
  useEffect(() => { try { localStorage.setItem("ip_goals", JSON.stringify(goals)); } catch(e) {} }, [goals]);

  // Trade helper functions
  const calcPnl = (t) => { if (!t.entryPrice || !t.exitPrice) return 0; const e=parseFloat(t.entryPrice),x=parseFloat(t.exitPrice),a=parseFloat(t.amount)||100,l=parseFloat(t.leverage)||1; return t.direction==="Long"?(x-e)/e*a*l:(e-x)/e*a*l; };
  const calcPnlPct = (t) => { if (!t.entryPrice || !t.exitPrice) return 0; const e=parseFloat(t.entryPrice),x=parseFloat(t.exitPrice),l=parseFloat(t.leverage)||1; return t.direction==="Long"?(x-e)/e*100*l:(e-x)/e*100*l; };
  const closedTrades = trades.filter(t=>t.status==="Kapali");
  const winTrades = closedTrades.filter(t=>calcPnl(t)>0);
  const lossTrades = closedTrades.filter(t=>calcPnl(t)<0);
  const totalPnl = closedTrades.reduce((s,t)=>s+calcPnl(t),0);
  const winRate = closedTrades.length>0?(winTrades.length/closedTrades.length*100):0;
  const avgWin = winTrades.length>0?winTrades.reduce((s,t)=>s+calcPnl(t),0)/winTrades.length:0;
  const avgLoss = lossTrades.length>0?Math.abs(lossTrades.reduce((s,t)=>s+calcPnl(t),0)/lossTrades.length):0;
  const profitFactor = avgLoss>0?(avgWin*winTrades.length)/(avgLoss*lossTrades.length):0;
  const maxDrawdown = (() => { let peak=0,dd=0,maxDd=0; closedTrades.sort((a,b)=>new Date(a.exitDate)-new Date(b.exitDate)).forEach(t=>{const eq=peak+calcPnl(t);if(eq>peak)peak=eq;dd=peak-eq;if(dd>maxDd)maxDd=dd;}); return maxDd; })();

  const resetNewTrade = () => setNewTrade({symbol:"",market:"Kripto",exchange:"Bybit",direction:"Long",status:"Acik",leverage:"1x",entryPrice:"",exitPrice:"",amount:"100",stopLoss:"",tp1:"",tp2:"",tp3:"",entryDate:new Date().toISOString().slice(0,16),exitDate:"",strategy:"",tags:"",notes:"",score:5,setupQuality:"B Orta",execution:5,followedPlan:true,setupType:"",emotion:"",mistakes:"",successes:"",lessons:""});

  const saveTrade = () => {
    const t = editTrade !== null ? {...newTrade, id: trades[editTrade].id} : {...newTrade, id: Date.now()};
    if (!t.symbol.trim()) return;
    if (editTrade !== null) { const updated=[...trades]; updated[editTrade]=t; setTrades(updated); }
    else setTrades(prev=>[t,...prev]);
    resetNewTrade(); setEditTrade(null); setTradeView("list");
  };

  const deleteTrade = (idx) => { setTrades(prev=>prev.filter((_,i)=>i!==idx)); };

  const filteredTrades = trades.filter(t => {
    if (tradeFilter==="open" && t.status!=="Acik") return false;
    if (tradeFilter==="closed" && t.status!=="Kapali") return false;
    if (tradeFilter==="win" && (t.status!=="Kapali" || calcPnl(t)<=0)) return false;
    if (tradeFilter==="loss" && (t.status!=="Kapali" || calcPnl(t)>=0)) return false;
    if (tradeSearch && !t.symbol.toLowerCase().includes(tradeSearch.toLowerCase()) && !t.notes?.toLowerCase().includes(tradeSearch.toLowerCase()) && !t.tags?.toLowerCase().includes(tradeSearch.toLowerCase())) return false;
    return true;
  });

  const equityData = (() => { let eq=0; return closedTrades.sort((a,b)=>new Date(a.exitDate||a.entryDate)-new Date(b.exitDate||b.entryDate)).map(t=>{eq+=calcPnl(t);return {date:new Date(t.exitDate||t.entryDate).toLocaleDateString("tr-TR",{day:"2-digit",month:"short"}),equity:+eq.toFixed(2),pnl:+calcPnl(t).toFixed(2)};});})();

  const [prices, setPrices] = useState({});
  const [knownCoins, setKnownCoins] = useState(() => {
    try { const s = localStorage.getItem("ip_knownCoins"); return s ? JSON.parse(s) : [...DEFAULT_COINS]; } catch(e) { return [...DEFAULT_COINS]; }
  });

  // Multi-portfolio system
  const [portfolios, setPortfolios] = useState(() => {
    try {
      const s = localStorage.getItem("ip_portfolios");
      return s ? JSON.parse(s) : { "Ana Portföy": [{coinId:"bitcoin",amount:0.5,buyPrice:65000},{coinId:"ethereum",amount:4,buyPrice:2800},{coinId:"solana",amount:25,buyPrice:120}] };
    } catch(e) { return { "Ana Portföy": [{coinId:"bitcoin",amount:0.5,buyPrice:65000},{coinId:"ethereum",amount:4,buyPrice:2800},{coinId:"solana",amount:25,buyPrice:120}] }; }
  });
  const [activePortfolio, setActivePortfolio] = useState(() => {
    try { return localStorage.getItem("ip_activePortfolio") || "Ana Portföy"; } catch(e) { return "Ana Portföy"; }
  });
  const [showPortfolioMenu, setShowPortfolioMenu] = useState(false);
  const [newPortfolioName, setNewPortfolioName] = useState("");
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState("");

  // Active portfolio items
  const portfolio = portfolios[activePortfolio] || [];
  const setPortfolio = (updater) => {
    setPortfolios(prev => {
      const current = prev[activePortfolio] || [];
      const next = typeof updater === "function" ? updater(current) : updater;
      return { ...prev, [activePortfolio]: next };
    });
  };
  const [showAdd, setShowAdd] = useState(false);
  const [ncCoin, setNcCoin] = useState(null);
  const [ncAmount, setNcAmount] = useState("");
  const [ncBuyPrice, setNcBuyPrice] = useState("");
  const [ncSection, setNcSection] = useState("Genel");
  const [sections, setSections] = useState(() => {
    try { const s = localStorage.getItem("ip_sections"); return s ? JSON.parse(s) : ["Genel"]; } catch(e) { return ["Genel"]; }
  });
  const [newSectionInput, setNewSectionInput] = useState("");
  const [dragIdx, setDragIdx] = useState(null); // index of item being dragged
  const [dragOverSection, setDragOverSection] = useState(null); // section being hovered
  const [editSectionName, setEditSectionName] = useState(null);
  const [editSectionValue, setEditSectionValue] = useState("");
  const [chartData, setChartData] = useState({});
  const [selChart, setSelChart] = useState("bitcoin");
  const [loading, setLoading] = useState(true);
  const [fmpStocks, setFmpStocks] = useState([]);
  const [search, setSearch] = useState("");
  const [chartPeriod, setChartPeriod] = useState(30);
  const [editIdx, setEditIdx] = useState(null);
  const [delConfirm, setDelConfirm] = useState(null);
  const [apiMode, setApiMode] = useState("connecting");
  const [connStatus, setConnStatus] = useState("connecting");
  const [retryCount, setRetryCount] = useState(0);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [refreshInterval, setRefreshInterval] = useState(300000);
  const [rateLimitInfo, setRateLimitInfo] = useState(null);
  const [reqLog, setReqLog] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [savedKey, setSavedKey] = useState("");
  const [keyStatus, setKeyStatus] = useState(null);
  const intRef = useRef(null);
  const retryRef = useRef(null);

  const log = useCallback((type,ok,detail)=>setReqLog(p=>[{time:new Date(),type,success:ok,detail},...p.slice(0,49)]),[]);

  // Save to localStorage on change
  useEffect(() => { try { localStorage.setItem("ip_portfolios", JSON.stringify(portfolios)); } catch(e) {} }, [portfolios]);
  useEffect(() => { try { localStorage.setItem("ip_activePortfolio", activePortfolio); } catch(e) {} }, [activePortfolio]);
  useEffect(() => { try { localStorage.setItem("ip_knownCoins", JSON.stringify(knownCoins)); } catch(e) {} }, [knownCoins]);
  useEffect(() => { try { localStorage.setItem("ip_sections", JSON.stringify(sections)); } catch(e) {} }, [sections]);

  const buildUrl = useCallback((path,params="")=>{
    const base=savedKey?"https://pro-api.coingecko.com/api/v3":"https://api.coingecko.com/api/v3";
    const kp=savedKey?`x_cg_pro_api_key=${savedKey}`:"";
    const parts=[params,kp].filter(Boolean).join("&");
    return `${base}${path}${parts?"?"+parts:""}`;
  },[savedKey]);

  // All Binance tickers stored here
  const binanceRef = useRef({}); // symbol -> ticker
  const futuresRef = useRef({}); // symbol -> futures ticker (perp)
  const [showPerp, setShowPerp] = useState(false); // Toggle spot/perp view

  // ── Fetch ALL Binance Spot USDT tickers ──
  const fetchAllBinance = useCallback(async () => {
    try {
      const res = await fetch("https://api.binance.com/api/v3/ticker/24hr");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const map = {};
      data.forEach(t => { if (t.symbol.endsWith("USDT")) map[t.symbol] = t; });
      binanceRef.current = map;
      return map;
    } catch (e) {
      log("price", false, `Binance Spot: ${e.message}`);
      return null;
    }
  }, [log]);

  // ── Fetch ALL Binance Futures USDT Perpetual tickers + funding rates ──
  const fetchAllFutures = useCallback(async () => {
    try {
      const [tickerRes, fundingRes] = await Promise.all([
        fetch("https://fapi.binance.com/fapi/v1/ticker/24hr"),
        fetch("https://fapi.binance.com/fapi/v1/premiumIndex"),
      ]);
      if (!tickerRes.ok) throw new Error(`Futures HTTP ${tickerRes.status}`);
      const tickers = await tickerRes.json();
      const funding = fundingRes.ok ? await fundingRes.json() : [];

      const fundingMap = {};
      funding.forEach(f => {
        fundingMap[f.symbol] = {
          markPrice: parseFloat(f.markPrice),
          indexPrice: parseFloat(f.indexPrice),
          fundingRate: parseFloat(f.lastFundingRate),
          nextFundingTime: f.nextFundingTime,
        };
      });

      const map = {};
      tickers.forEach(t => {
        if (t.symbol.endsWith("USDT")) {
          map[t.symbol] = {
            ...t,
            perp: true,
            markPrice: fundingMap[t.symbol]?.markPrice || parseFloat(t.lastPrice),
            indexPrice: fundingMap[t.symbol]?.indexPrice || 0,
            fundingRate: fundingMap[t.symbol]?.fundingRate || 0,
            nextFundingTime: fundingMap[t.symbol]?.nextFundingTime || 0,
          };
        }
      });
      futuresRef.current = map;
      return map;
    } catch (e) {
      log("price", false, `Binance Futures: ${e.message}`);
      return null;
    }
  }, [log]);

  // Resolve any coinId to Binance price
  const resolveBinancePrice = useCallback((coinId, binData) => {
    if (!binData || Object.keys(binData).length === 0) return null;
    // Known overrides where CoinGecko ID != Binance symbol
    const overrides = {
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
    // Try override
    const ov = overrides[coinId];
    if (ov && binData[ov + "USDT"]) return binData[ov + "USDT"];
    // Try coin symbol from knownCoins
    const coin = knownCoins.find(c => c.id === coinId);
    if (coin) {
      const sym = coin.symbol.toUpperCase() + "USDT";
      if (binData[sym]) return binData[sym];
    }
    // Try coinId as symbol
    const direct = coinId.toUpperCase().replace(/-\d+$/,"").replace(/-/g,"") + "USDT";
    if (binData[direct]) return binData[direct];
    return null;
  }, [knownCoins]);

  // ── Fetch CoinGecko markets (top 250 in ONE call) ──
  const fetchCoinGeckoMarkets = useCallback(async () => {
    try {
      const url = buildUrl("/coins/markets", "vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h,7d");
      const res = await fetch(url);
      if (res.status === 429) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const f = {};
      data.forEach(c => {
        f[c.id] = {
          usd: c.current_price,
          usd_24h_change: c.price_change_percentage_24h || 0,
          usd_7d_change: c.price_change_percentage_7d_in_currency || 0,
          usd_market_cap: c.market_cap || 0,
        };
      });
      return f;
    } catch (e) {
      log("price", false, `CoinGecko markets: ${e.message}`);
      return null;
    }
  }, [buildUrl, log]);

  // ── Fetch specific coins from CoinGecko (for coins not in top 250) ──
  const fetchCoinGeckoSpecific = useCallback(async (ids) => {
    if (!ids || ids.length === 0) return null;
    try {
      const url = buildUrl("/simple/price", `ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true&include_7d_change=true&include_market_cap=true`);
      const res = await fetch(url);
      if (res.status === 429 || !res.ok) return null;
      const data = await res.json();
      const f = {};
      Object.entries(data).forEach(([id, v]) => {
        f[id] = { usd: v.usd, usd_24h_change: v.usd_24h_change || 0, usd_7d_change: v.usd_7d_change || 0, usd_market_cap: v.usd_market_cap || 0 };
      });
      return f;
    } catch (e) { return null; }
  }, [buildUrl]);

  // ══ MAIN FETCH: Binance (all) + CoinGecko (top 250 + specific) ══
  const fetchPrices = useCallback(async (isRetry = false) => {
    if (!isRetry) setConnStatus("connecting");
    try {
      const allPrices = {};
      let source = "";

      // 1) Binance Spot — all USDT pairs, instant
      const binData = await fetchAllBinance();
      if (binData) {
        const allCoins = new Set([...DEFAULT_COINS.map(c=>c.id), ...knownCoins.map(c=>c.id), ...Object.values(portfolios).flat().map(p=>p.coinId)]);
        allCoins.forEach(coinId => {
          const ticker = resolveBinancePrice(coinId, binData);
          if (ticker) {
            allPrices[coinId] = {
              usd: parseFloat(ticker.lastPrice),
              usd_24h_change: parseFloat(ticker.priceChangePercent),
              usd_7d_change: 0,
              usd_market_cap: parseFloat(ticker.quoteVolume),
            };
          }
        });
        source = `Spot: ${Object.keys(allPrices).length}`;
      }

      // 1.5) Binance Futures Perpetual — mark price, funding rate
      const futData = await fetchAllFutures();
      if (futData) {
        const allCoins = new Set([...DEFAULT_COINS.map(c=>c.id), ...knownCoins.map(c=>c.id), ...Object.values(portfolios).flat().map(p=>p.coinId)]);
        let perpCount = 0;
        allCoins.forEach(coinId => {
          const ticker = resolveBinancePrice(coinId, futData);
          if (ticker && ticker.perp) {
            perpCount++;
            if (allPrices[coinId]) {
              // Add perp data to existing spot data
              allPrices[coinId].perp_price = parseFloat(ticker.lastPrice);
              allPrices[coinId].mark_price = ticker.markPrice;
              allPrices[coinId].index_price = ticker.indexPrice;
              allPrices[coinId].funding_rate = ticker.fundingRate;
              allPrices[coinId].next_funding = ticker.nextFundingTime;
              allPrices[coinId].perp_24h_change = parseFloat(ticker.priceChangePercent);
              allPrices[coinId].perp_volume = parseFloat(ticker.quoteVolume);
            } else {
              // No spot data, use perp as primary
              allPrices[coinId] = {
                usd: parseFloat(ticker.lastPrice),
                usd_24h_change: parseFloat(ticker.priceChangePercent),
                usd_7d_change: 0,
                usd_market_cap: parseFloat(ticker.quoteVolume),
                perp_price: parseFloat(ticker.lastPrice),
                mark_price: ticker.markPrice,
                index_price: ticker.indexPrice,
                funding_rate: ticker.fundingRate,
                next_funding: ticker.nextFundingTime,
                perp_24h_change: parseFloat(ticker.priceChangePercent),
                perp_volume: parseFloat(ticker.quoteVolume),
              };
            }
          }
        });
        source += ` + Perp: ${perpCount}`;
      }

      // 2) CoinGecko markets — top 250 (fills 7d change + market cap + missing coins)
      const cgMarkets = await fetchCoinGeckoMarkets();
      if (cgMarkets) {
        Object.entries(cgMarkets).forEach(([id, data]) => {
          if (!allPrices[id]) {
            allPrices[id] = data; // Coin not on Binance
          } else {
            // Merge: keep Binance price (more real-time) but add CG metadata
            allPrices[id] = {
              ...allPrices[id],
              usd_7d_change: data.usd_7d_change || allPrices[id].usd_7d_change,
              usd_market_cap: data.usd_market_cap || allPrices[id].usd_market_cap,
            };
          }
        });
        source += ` + CG: ${Object.keys(cgMarkets).length}`;
      }

      // 3) Any portfolio coins still missing? Fetch specifically
      const missing = [];
      [...new Set(Object.values(portfolios).flat().map(p=>p.coinId))].forEach(id => {
        if (!allPrices[id]) missing.push(id);
      });
      // Separate crypto missing from stock missing
      const cryptoMissing = missing.filter(id => !isStock(id));
      const stockMissing = missing.filter(id => isStock(id));

      if (cryptoMissing.length > 0) {
        const specific = await fetchCoinGeckoSpecific(cryptoMissing);
        if (specific) {
          Object.assign(allPrices, specific);
          source += ` + Specific: ${Object.keys(specific).length}`;
        }
      }

      // 4) Hisse/ETF — BIST için Yahoo (Vercel proxy), US için FMP
      const FMP_KEY = "00rEssEWw276o3NRJY1BcLH1ACQGb1D6";
      const portfolioStockIds = [...new Set(Object.values(portfolios).flat().map(p=>p.coinId).filter(id=>isStock(id)))];
      const allStockIds = Object.keys(STOCK_DATA);
      const stocksToFetch = [...new Set([...portfolioStockIds, ...allStockIds.slice(0, 80)])];

      // BIST (.IS) ve US hisselerini ayır
      const bistStocks = stocksToFetch.filter(s => s.endsWith(".IS"));
      const usStocks = stocksToFetch.filter(s => !s.endsWith(".IS") && !s.endsWith(".TEFAS"));

      if (stocksToFetch.length > 0) {
        const results = {};
        let stockSource = "";

        // A) US hisseleri → FMP API (CORS-free, hızlı)
        if (usStocks.length > 0) {
          for (let i = 0; i < usStocks.length; i += 50) {
            const batch = usStocks.slice(i, i + 50);
            try {
              const url = `https://financialmodelingprep.com/api/v3/quote/${batch.join(",")}?apikey=${FMP_KEY}`;
              const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
              if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) {
                  data.forEach(q => {
                    if (!q.symbol) return;
                    results[q.symbol] = {
                      usd: q.price || 0,
                      usd_24h_change: q.changesPercentage || 0,
                      usd_7d_change: 0,
                      usd_market_cap: q.marketCap || 0,
                      currency: "$",
                      market: "us",
                    };
                  });
                  if (!stockSource) stockSource = "FMP";
                }
              }
            } catch (e) {}
            if (i + 50 < usStocks.length) await new Promise(r => setTimeout(r, 300));
          }
        }

        // B) BIST hisseleri → Yahoo Finance (Vercel proxy)
        if (bistStocks.length > 0) {
          for (let i = 0; i < bistStocks.length; i += 50) {
            const batch = bistStocks.slice(i, i + 50);
            try {
              const baseUrl = window.location.origin;
              const url = `${baseUrl}/api/stocks?symbols=${batch.join(",")}`;
              const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
              if (res.ok) {
                const data = await res.json();
                if (data?.quoteResponse?.result?.length > 0) {
                  data.quoteResponse.result.forEach(q => {
                    if (!q.symbol) return;
                    results[q.symbol] = {
                      usd: q.regularMarketPrice || 0,
                      usd_24h_change: q.regularMarketChangePercent || 0,
                      usd_7d_change: 0,
                      usd_market_cap: 0,
                      currency: "₺",
                      market: "bist",
                    };
                  });
                  stockSource = stockSource ? stockSource + "+Yahoo" : "Yahoo";
                }
              }
            } catch (e) {}
            if (i + 50 < bistStocks.length) await new Promise(r => setTimeout(r, 500));
          }
        }

        if (Object.keys(results).length > 0) {
          Object.assign(allPrices, results);
          source += ` + ${stockSource}: ${Object.keys(results).length}`;
          log("price", true, `Hisse/Fon: ${Object.keys(results).length} (${stockSource})`);
          // Cache all fetched
          try {
            const prev = JSON.parse(localStorage.getItem("ip_stock_prices") || "{}");
            const updated = { ...prev };
            Object.entries(results).forEach(([id, v]) => { updated[id] = { ...v, _ts: Date.now() }; });
            localStorage.setItem("ip_stock_prices", JSON.stringify(updated));
          } catch(e) {}
        } else {
          // Load from cache
          try {
            const cached = JSON.parse(localStorage.getItem("ip_stock_prices") || "{}");
            if (Object.keys(cached).length > 0) {
              Object.entries(cached).forEach(([id, v]) => { if (!allPrices[id]) allPrices[id] = v; });
              source += ` + StockCache: ${Object.keys(cached).length}`;
            }
          } catch(e) {}
          log("price", false, "Hisse/Fon: API erişilemedi, cache kullanıldı");
        }
      }

      // 5) TEFAS Fonları — Vercel serverless function üzerinden
      const tefasIds = Object.keys(TEFAS_DATA);
      const portfolioTefas = [...new Set(Object.values(portfolios).flat().map(p=>p.coinId).filter(id=>id.endsWith(".TEFAS")))];
      const tefasToFetch = [...new Set([...portfolioTefas, ...tefasIds])];

      if (tefasToFetch.length > 0) {
        try {
          const baseUrl = window.location.origin;
          const url = `${baseUrl}/api/tefas?symbols=${tefasToFetch.join(",")}`;
          const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
          if (res.ok) {
            const data = await res.json();
            if (data?.results?.length > 0) {
              data.results.forEach(r => {
                allPrices[r.symbol] = {
                  usd: r.price || 0,
                  usd_24h_change: r.changesPercentage || 0,
                  usd_7d_change: 0,
                  usd_market_cap: 0,
                  currency: "₺",
                  market: "tefas",
                };
              });
              source += ` + TEFAS: ${data.results.length}`;
              log("price", true, `TEFAS: ${data.results.length} fon`);
            }
          }
        } catch (e) {
          log("price", false, "TEFAS: API erişilemedi");
        }
      }

      if (Object.keys(allPrices).length > 0) {
        setPrices(prev => ({ ...prev, ...allPrices }));
        setApiMode("live"); setConnStatus("connected"); setLastUpdate(new Date());
        setRetryCount(0); setRateLimitInfo(null); setLoading(false);
        log("price", true, source);
        return;
      }

      throw new Error("Hiçbir kaynaktan veri alınamadı");
    } catch (err) {
      log("price", false, err.message);
      if (retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAYS[retryCount] || 60000;
        setConnStatus("retrying"); setRetryCount(p => p + 1);
        retryRef.current = setTimeout(() => fetchPrices(true), delay);
      } else {
        setPrices(genDemo()); setApiMode("demo"); setConnStatus("demo");
        setLastUpdate(new Date()); setLoading(false); setRetryCount(0);
      }
    }
  }, [retryCount, fetchAllBinance, resolveBinancePrice, fetchCoinGeckoMarkets, fetchCoinGeckoSpecific, knownCoins, portfolios, log]);

  // Fetch single coin price (for newly added coins)
  const fetchCoinPrice = useCallback(async (coinId) => {
    // Try Binance
    const ticker = resolveBinancePrice(coinId, binanceRef.current);
    if (ticker) {
      setPrices(prev => ({ ...prev, [coinId]: { usd: parseFloat(ticker.lastPrice), usd_24h_change: parseFloat(ticker.priceChangePercent), usd_7d_change: 0, usd_market_cap: parseFloat(ticker.quoteVolume) } }));
      return;
    }
    // Fallback CoinGecko
    try {
      const url = buildUrl("/simple/price", `ids=${coinId}&vs_currencies=usd&include_24hr_change=true`);
      const res = await fetch(url); if (!res.ok) return;
      const data = await res.json();
      if (data[coinId]) setPrices(prev => ({ ...prev, [coinId]: { usd: data[coinId].usd, usd_24h_change: data[coinId].usd_24h_change || 0, usd_7d_change: 0, usd_market_cap: 0 } }));
    } catch (e) {}
  }, [resolveBinancePrice, buildUrl]);

  const fetchChart = useCallback(async(coinId)=>{
    // Try Binance klines
    const ticker = resolveBinancePrice(coinId, binanceRef.current);
    if (ticker) {
      const symbol = Object.entries(binanceRef.current).find(([,v]) => v === ticker)?.[0];
      if (symbol) {
        try {
          const interval = chartPeriod <= 7 ? "1h" : chartPeriod <= 30 ? "4h" : "1d";
          const limit = chartPeriod <= 7 ? chartPeriod * 24 : chartPeriod <= 30 ? chartPeriod * 6 : chartPeriod;
          const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
          if (res.ok) {
            const data = await res.json();
            setChartData(p => ({ ...p, [`${coinId}-${chartPeriod}`]: data.map(k => ({ date: new Date(k[0]).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" }), price: parseFloat(parseFloat(k[4]).toFixed(2)) })) }));
            log("chart", true, `Binance: ${coinId} ${chartPeriod}g`);
            return;
          }
        } catch (e) {}
      }
    }
    // Fallback CoinGecko
    try {
      const url=buildUrl(`/coins/${coinId}/market_chart`,`vs_currency=usd&days=${chartPeriod}`);
      const res=await fetch(url);
      if(res.status===429){setChartData(p=>({...p,[`${coinId}-${chartPeriod}`]:genChart(prices[coinId]?.usd||100,chartPeriod)}));return;}
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const data=await res.json();
      setChartData(p=>({...p,[`${coinId}-${chartPeriod}`]:data.prices.map(([ts,pr])=>({date:new Date(ts).toLocaleDateString("tr-TR",{day:"2-digit",month:"short"}),price:+pr.toFixed(2)}))}));
      log("chart",true,`CoinGecko: ${coinId} ${chartPeriod}g`);
    } catch(e){log("chart",false,e.message);setChartData(p=>({...p,[`${coinId}-${chartPeriod}`]:genChart(prices[coinId]?.usd||100,chartPeriod)}));}
  },[resolveBinancePrice,chartPeriod,prices,buildUrl,log]);

  useEffect(()=>{fetchPrices();return()=>{if(retryRef.current)clearTimeout(retryRef.current);};},[]);
  useEffect(()=>{if(intRef.current)clearInterval(intRef.current);intRef.current=setInterval(()=>{if(connStatus!=="retrying"&&connStatus!=="ratelimited")fetchPrices();},refreshInterval);return()=>{if(intRef.current)clearInterval(intRef.current);};},[refreshInterval,connStatus,fetchPrices]);

  // FMP tüm hisse listesi — startup'ta çek, 24 saat cache'le
  useEffect(() => {
    const loadFmpStocks = async () => {
      // Önce localStorage cache'e bak
      try {
        const cached = JSON.parse(localStorage.getItem("ip_fmp_stocklist") || "{}");
        if (cached.stocks && cached.ts && (Date.now() - cached.ts < 86400000)) {
          setFmpStocks(cached.stocks);
          return;
        }
      } catch(e) {}

      // Cache yoksa veya eski → API'den çek
      try {
        const baseUrl = window.location.origin;
        const res = await fetch(`${baseUrl}/api/stocklist`, { signal: AbortSignal.timeout(30000) });
        if (res.ok) {
          const data = await res.json();
          if (data?.stocks?.length > 0) {
            setFmpStocks(data.stocks);
            try { localStorage.setItem("ip_fmp_stocklist", JSON.stringify({ stocks: data.stocks, ts: Date.now() })); } catch(e) {}
          }
        }
      } catch (e) {
        // // console.log("FMP stock list fetch failed:", e.message);
      }
    };
    loadFmpStocks();
  }, []);
  useEffect(()=>{if(Object.keys(prices).length>0)fetchChart(selChart);},[selChart,chartPeriod,prices,fetchChart]);

  const saveKey=()=>{if(apiKey.trim()){setSavedKey(apiKey.trim());setKeyStatus({type:"success",message:"API key kaydedildi!"});setRetryCount(0);setTimeout(()=>fetchPrices(),500);}else{setSavedKey("");setKeyStatus({type:"info",message:"Key kaldırıldı."});}setTimeout(()=>setKeyStatus(null),4000);};
  const retry=()=>{setRetryCount(0);setConnStatus("connecting");if(retryRef.current)clearTimeout(retryRef.current);fetchPrices();};

  // Add coin with dynamic coin support
  const addCoin = () => {
    if (!ncCoin || !ncAmount || !ncBuyPrice) return;
    const coinId = ncCoin.id;
    const section = ncSection || "Genel";

    if (!knownCoins.find(c => c.id === coinId)) {
      setKnownCoins(prev => [...prev, { id: coinId, symbol: ncCoin.symbol, name: ncCoin.name, market: ncCoin.market, currency: ncCoin.currency }]);
    }

    if (editIdx !== null) {
      setPortfolio(p => p.map((it, i) => i === editIdx ? { coinId, amount: +ncAmount, buyPrice: +ncBuyPrice, section } : it));
      setEditIdx(null);
    } else {
      setPortfolio(p => [...p, { coinId, amount: +ncAmount, buyPrice: +ncBuyPrice, section }]);
    }

    // Fetch price if not available — different strategy for stocks vs crypto
    if (!prices[coinId]) {
      if (isStock(coinId)) {
        // Trigger a full fetchPrices which includes stock fetching
        fetchPrices();
      } else {
        fetchCoinPrice(coinId);
      }
    }

    setNcCoin(null); setNcAmount(""); setNcBuyPrice(""); setNcSection("Genel");
    setShowAdd(false);
  };

  const pData=useMemo(()=>portfolio.map(item=>{
    const coin = knownCoins.find(c=>c.id===item.coinId) || ALL_ASSETS[item.coinId] || {id:item.coinId,symbol:"?",name:item.coinId};
    const cp=prices[item.coinId]?.usd||0;const ch=prices[item.coinId]?.usd_24h_change||0;const cv=item.amount*cp;const iv=item.amount*item.buyPrice;const pnl=cv-iv;
    const mkt = getMarketType(item.coinId);
    const cur = ALL_ASSETS[item.coinId]?.currency || "$";
    return{...item,coin:{...coin,market:mkt,currency:cur},currentPrice:cp,change24h:ch,currentValue:cv,investedValue:iv,pnl,pnlPct:iv>0?(pnl/iv)*100:0,market:mkt,currency:cur};
  }),[portfolio,prices,knownCoins]);

  const totVal=pData.reduce((s,i)=>s+i.currentValue,0), totInv=pData.reduce((s,i)=>s+i.investedValue,0), totPnl=totVal-totInv, totPnlPct=totInv>0?(totPnl/totInv)*100:0, tot24h=pData.reduce((s,i)=>s+i.currentValue*(i.change24h/100),0);
  const pieData=pData.map((item,i)=>({name:item.coin?.symbol||"?",value:+item.currentValue.toFixed(2),color:CLR[i%CLR.length]}));

  // ══ ALL PORTFOLIOS combined data ══
  const allPData = useMemo(() => {
    const combined = {};
    Object.entries(portfolios).forEach(([pName, items]) => {
      items.forEach(item => {
        const coin = knownCoins.find(c => c.id === item.coinId) || { id: item.coinId, symbol: "?", name: item.coinId };
        const cp = prices[item.coinId]?.usd || 0;
        const ch = prices[item.coinId]?.usd_24h_change || 0;
        if (!combined[item.coinId]) {
          combined[item.coinId] = { coinId: item.coinId, coin, currentPrice: cp, change24h: ch, totalAmount: 0, totalInvested: 0, portfolios: [] };
        }
        combined[item.coinId].totalAmount += item.amount;
        combined[item.coinId].totalInvested += item.amount * item.buyPrice;
        combined[item.coinId].portfolios.push({ name: pName, amount: item.amount, buyPrice: item.buyPrice });
      });
    });
    return Object.values(combined).map(c => ({
      ...c,
      currentValue: c.totalAmount * c.currentPrice,
      pnl: (c.totalAmount * c.currentPrice) - c.totalInvested,
      pnlPct: c.totalInvested > 0 ? (((c.totalAmount * c.currentPrice) - c.totalInvested) / c.totalInvested) * 100 : 0,
    })).sort((a, b) => b.currentValue - a.currentValue);
  }, [portfolios, prices, knownCoins]);
  const allTotVal = allPData.reduce((s, i) => s + i.currentValue, 0);
  const allTotInv = allPData.reduce((s, i) => s + i.totalInvested, 0);
  const allTotPnl = allTotVal - allTotInv;
  const allTotPnlPct = allTotInv > 0 ? (allTotPnl / allTotInv) * 100 : 0;
  const allTot24h = allPData.reduce((s, i) => s + i.currentValue * (i.change24h / 100), 0);
  const allPieData = allPData.map((item, i) => ({ name: item.coin?.symbol || "?", value: +item.currentValue.toFixed(2), color: CLR[i % CLR.length] }));
  // Per-portfolio summary
  const portfolioSummaries = useMemo(() => {
    return Object.entries(portfolios).map(([name, items]) => {
      let val = 0, inv = 0, ch24 = 0;
      items.forEach(item => {
        const cp = prices[item.coinId]?.usd || 0;
        const change = prices[item.coinId]?.usd_24h_change || 0;
        const cv = item.amount * cp;
        val += cv; inv += item.amount * item.buyPrice; ch24 += cv * (change / 100);
      });
      return { name, value: val, invested: inv, pnl: val - inv, pnlPct: inv > 0 ? ((val - inv) / inv) * 100 : 0, change24h: ch24, count: items.length };
    });
  }, [portfolios, prices]);
  const [marketFilter, setMarketFilter] = useState("all"); // all | crypto | bist | us | tefas
  const [showReportNotif, setShowReportNotif] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
  const [showReportHistory, setShowReportHistory] = useState(false);
  const [reportHistory, setReportHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("ip_report_history") || "[]"); } catch(e) { return []; }
  });

  // Ay sonu hatırlatma — her ay 25'inden sonra göster
  useEffect(() => {
    const today = new Date();
    const day = today.getDate();
    const key = `ip_report_${today.getFullYear()}_${today.getMonth()}`;
    const generated = localStorage.getItem(key);
    if (day >= 25 && !generated) setShowReportNotif(true);
  }, []);

  // PDF Rapor Oluştur
  const generateReport = async () => {
    try {
      const doc = new jsPDF("p", "mm", "a4");
      const w = doc.internal.pageSize.getWidth();
      const h = doc.internal.pageSize.getHeight();
      const now = new Date();
      
      // Turkce ASCII uyumlu ay isimleri
      const aylar = ["Ocak","Subat","Mart","Nisan","Mayis","Haziran","Temmuz","Agustos","Eylul","Ekim","Kasim","Aralik"];
      const ay = aylar[now.getMonth()];
      const dateStr = now.getDate() + " " + ay + " " + now.getFullYear();
      const timeStr = now.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });

      // Para formati — tam sayilar virgullu (1,234.56 yerine 1.234,56)
      const fmtTR = (v, cur="$") => {
        const abs = Math.abs(v);
        const parts = abs.toFixed(2).split(".");
        const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
        const result = intPart + "," + parts[1];
        return (cur === "$" ? "$" : "") + result + (cur === "TL" ? " TL" : "");
      };
      const fmtPct = (v) => (v >= 0 ? "+" : "") + v.toFixed(2) + "%";

      // === SAYFA 1: Kapak ===
      // Koyu header
      doc.setFillColor(11, 13, 21);
      doc.rect(0, 0, w, 50, "F");
      // Gradient cizgi
      doc.setFillColor(147, 51, 234);
      doc.rect(0, 48, w * 0.5, 2, "F");
      doc.setFillColor(212, 160, 23);
      doc.rect(w * 0.5, 48, w * 0.5, 2, "F");

      // Logo ve baslik
      doc.setTextColor(147, 51, 234);
      doc.setFontSize(30);
      doc.text("InvestPulse", 20, 24);
      doc.setFontSize(9);
      doc.setTextColor(130, 140, 160);
      doc.text("PORTFOY YONETIM SISTEMI", 20, 33);
      doc.text(dateStr + " - " + timeStr, 20, 42);

      doc.setFontSize(10);
      doc.setTextColor(180, 180, 180);
      doc.text("Kullanici: " + currentUser, w - 20, 33, { align: "right" });
      doc.text("Aktif Portfoy: " + activePortfolio, w - 20, 42, { align: "right" });

      // Rapor basligi
      doc.setFontSize(18);
      doc.setTextColor(40, 40, 60);
      doc.text("Aylik Portfoy Raporu - " + ay + " " + now.getFullYear(), 20, 66);

      // Ozet kartlar - genisletilmis
      let y = 78;
      const cardW = (w - 50) / 3;

      const drawCard = (x, label, value, subText, color) => {
        doc.setFillColor(245, 247, 250);
        doc.roundedRect(x, y, cardW, 34, 3, 3, "F");
        doc.setDrawColor(230, 232, 240);
        doc.roundedRect(x, y, cardW, 34, 3, 3, "S");
        doc.setFontSize(8);
        doc.setTextColor(120, 120, 140);
        doc.text(label, x + 6, y + 10);
        doc.setFontSize(16);
        doc.setTextColor(color[0], color[1], color[2]);
        doc.text(value, x + 6, y + 22);
        if (subText) {
          doc.setFontSize(8);
          doc.text(subText, x + 6, y + 30);
        }
      };

      drawCard(15, "Toplam Deger", fmtTR(allTotVal), "Tum portfoyler", [30, 30, 50]);
      drawCard(15 + cardW + 5, "Toplam Yatirim", fmtTR(allTotInv), allPData.length + " varlik", [60, 60, 80]);
      const pnlColor = allTotPnl >= 0 ? [0, 160, 70] : [200, 50, 50];
      drawCard(15 + (cardW + 5) * 2, "Kar / Zarar", (allTotPnl >= 0 ? "+" : "") + fmtTR(Math.abs(allTotPnl)), fmtPct(allTotPnlPct), pnlColor);

      y += 42;

      // Piyasa Dagilimi
      doc.setFontSize(12);
      doc.setTextColor(40, 40, 60);
      doc.text("Piyasa Dagilimi", 20, y);
      y += 8;

      const mktTotals = {};
      allPData.forEach(item => { const m = getMarketType(item.coinId); mktTotals[m] = (mktTotals[m] || 0) + item.currentValue; });
      const mktColors = { crypto: [147, 51, 234], bist: [59, 130, 246], us: [212, 160, 23], tefas: [6, 182, 212] };
      const mktLabels2 = { crypto: "Kripto", bist: "BIST", us: "ABD", tefas: "TEFAS" };
      
      // Bar grafik
      let barX = 20;
      const barW = w - 40;
      Object.entries(mktTotals).forEach(([m, val]) => {
        const pct = allTotVal > 0 ? val / allTotVal : 0;
        const segW = barW * pct;
        doc.setFillColor(mktColors[m]?.[0]||140, mktColors[m]?.[1]||140, mktColors[m]?.[2]||160);
        doc.roundedRect(barX, y, Math.max(segW, 1), 8, 1, 1, "F");
        if (segW > 25) {
          doc.setFontSize(7);
          doc.setTextColor(255, 255, 255);
          doc.text((mktLabels2[m] || m) + " " + (pct * 100).toFixed(1) + "%", barX + 3, y + 5.5);
        }
        barX += segW;
      });
      y += 14;

      // Piyasa detay tablosu
      const mktData = Object.entries(mktTotals).map(([m, val]) => {
        const pct = allTotVal > 0 ? (val / allTotVal * 100) : 0;
        const count = allPData.filter(item => getMarketType(item.coinId) === m).length;
        return [mktLabels2[m] || m, fmtTR(val), pct.toFixed(1) + "%", String(count) + " varlik"];
      });
      
      if (mktData.length > 1) {
        autoTable(doc, {
          startY: y,
          head: [["Piyasa", "Deger", "Oran", "Varlik Sayisi"]],
          body: mktData,
          theme: "grid",
          headStyles: { fillColor: [147, 51, 234], textColor: [255, 255, 255], fontSize: 8, fontStyle: "bold" },
          bodyStyles: { fontSize: 8, textColor: [60, 60, 80] },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          margin: { left: 20, right: 20 },
          tableWidth: w - 40,
        });
        y = doc.lastAutoTable.finalY + 10;
      } else {
        y += 2;
      }

      // Portfolyo bazli ozet
      if (Object.keys(portfolios).length > 1) {
        doc.setFontSize(12);
        doc.setTextColor(40, 40, 60);
        doc.text("Portfolyo Ozeti", 20, y);
        y += 4;

        const pSumData = portfolioSummaries.map(p => {
          const pctOfTotal = allTotVal > 0 ? (p.value / allTotVal * 100) : 0;
          return [
            p.name,
            fmtTR(p.value),
            fmtTR(p.invested),
            (p.pnl >= 0 ? "+" : "") + fmtTR(Math.abs(p.pnl)),
            fmtPct(p.pnlPct),
            pctOfTotal.toFixed(1) + "%",
            String(p.count),
          ];
        });

        autoTable(doc, {
          startY: y,
          head: [["Portfolyo", "Deger", "Yatirim", "K/Z", "K/Z %", "Agirlik", "Varlik"]],
          body: pSumData,
          theme: "grid",
          headStyles: { fillColor: [20, 28, 42], textColor: [200, 200, 220], fontSize: 8, fontStyle: "bold" },
          bodyStyles: { fontSize: 8, textColor: [60, 60, 80] },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          margin: { left: 15, right: 15 },
          didParseCell: (data) => {
            if (data.section === "body" && (data.column.index === 3 || data.column.index === 4)) {
              const val = data.cell.raw || "";
              if (val.startsWith("+")) data.cell.styles.textColor = [0, 160, 70];
              else if (val.startsWith("-")) data.cell.styles.textColor = [200, 50, 50];
            }
          },
        });
        y = doc.lastAutoTable.finalY + 10;
      }

      // Tum varliklar tablosu
      if (y > h - 40) { doc.addPage(); y = 20; }
      doc.setFontSize(12);
      doc.setTextColor(40, 40, 60);
      doc.text("Tum Varliklar", 20, y);
      y += 4;

      const tableData = allPData.map(item => {
        const mkt = getMarketType(item.coinId);
        const cur = ALL_ASSETS[item.coinId]?.currency === "₺" ? "TL" : "$";
        const pctOfTotal = allTotVal > 0 ? (item.currentValue / allTotVal * 100) : 0;
        return [
          (item.coin?.symbol || "?") + " [" + getMarketLabel(mkt) + "]",
          item.totalAmount.toFixed(item.totalAmount < 1 ? 6 : 2),
          fmtTR(item.currentPrice, cur),
          fmtTR(item.currentValue, cur),
          fmtTR(item.totalInvested, cur),
          (item.pnl >= 0 ? "+" : "-") + fmtTR(Math.abs(item.pnl), cur),
          fmtPct(item.pnlPct),
          pctOfTotal.toFixed(1) + "%",
        ];
      });

      autoTable(doc, {
        startY: y,
        head: [["Varlik", "Miktar", "Fiyat", "Deger", "Maliyet", "K/Z", "K/Z %", "Agirlik"]],
        body: tableData,
        theme: "grid",
        headStyles: { fillColor: [20, 28, 42], textColor: [200, 200, 220], fontSize: 7, fontStyle: "bold" },
        bodyStyles: { fontSize: 7, textColor: [60, 60, 80] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 12, right: 12 },
        didParseCell: (data) => {
          if (data.section === "body" && (data.column.index === 5 || data.column.index === 6)) {
            const val = data.cell.raw || "";
            if (val.startsWith("+")) data.cell.styles.textColor = [0, 160, 70];
            else if (val.startsWith("-")) data.cell.styles.textColor = [200, 50, 50];
          }
        },
      });

      // Footer — her sayfaya
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        // Alt cizgi
        doc.setDrawColor(147, 51, 234);
        doc.setLineWidth(0.3);
        doc.line(20, h - 14, w - 20, h - 14);
        // Footer text
        doc.setFontSize(7);
        doc.setTextColor(140, 140, 160);
        doc.text("InvestPulse Portfoy Raporu", 20, h - 9);
        doc.text(dateStr, w / 2, h - 9, { align: "center" });
        doc.text("Sayfa " + i + " / " + pageCount, w - 20, h - 9, { align: "right" });
      }

      // Preview
      const pdfUrl = doc.output("bloburl");
      setPdfPreviewUrl(pdfUrl);

      localStorage.setItem("ip_report_" + now.getFullYear() + "_" + now.getMonth(), "1");
      setShowReportNotif(false);

      try {
        const hist = JSON.parse(localStorage.getItem("ip_report_history") || "[]");
        const entry = { date: now.toISOString(), totVal: allTotVal, totInv: allTotInv, pnl: allTotPnl, pnlPct: allTotPnlPct, assets: allPData.length, user: currentUser };
        hist.push(entry);
        const trimmed = hist.slice(-24);
        localStorage.setItem("ip_report_history", JSON.stringify(trimmed));
        setReportHistory(trimmed);
      } catch(e) {}

    } catch (err) {
      console.error("PDF rapor hatasi:", err);
      alert("Rapor olusturulurken hata olustu: " + err.message);
    }
  };
  const allAssetList = useMemo(() => [...DEFAULT_COINS, ...Object.values(STOCK_DATA)], []);
  const filtered = allAssetList.filter(c => {
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase()) || c.symbol.toLowerCase().includes(search.toLowerCase());
    const matchMarket = marketFilter === "all" || c.market === marketFilter;
    return matchSearch && matchMarket;
  });
  const curChart=chartData[`${selChart}-${chartPeriod}`]||[];
  const st={card:{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:14,padding:20,overflow:"hidden",backdropFilter:"blur(10px)"},th:{padding:"10px 12px",fontSize:11,color:T.textMuted,textTransform:"uppercase",letterSpacing:.8,fontWeight:600,textAlign:"left",borderBottom:`1px solid ${T.border}`,whiteSpace:"nowrap"},td:{padding:"11px 12px",fontSize:13,borderBottom:`1px solid ${T.border}`,verticalAlign:"middle"},tt:{background:T.bgInput,border:`1px solid ${T.borderLight}`,borderRadius:8,color:T.text,fontSize:12,fontFamily:"'JetBrains Mono',monospace"}};

  if (showSplash) return <SplashScreen onFinish={() => setShowSplash(false)} />;
  if (!isLoggedIn) return <AuthScreen onLogin={async (user) => { const name = user.displayName || user.email?.split("@")[0] || (user.isAnonymous ? "Misafir" : "Kullanici"); setCurrentUser(name); setIsLoggedIn(true); if (!user.isAnonymous) { try { const data = await getUserData(user.uid); if (data && data.portfolios) { setPortfolios(data.portfolios); if (data.sections) setSections(data.sections); } else { const lp = localStorage.getItem("ip_portfolios"); if (lp) { const p = JSON.parse(lp); setPortfolios(p); await savePortfolios(user.uid, p, sections); } } } catch(e) { console.error("Firestore:", e); } } }} />;

  // Loading artık sayfayı bloklamaz — skeleton gösterilir
  const isLoading = loading && Object.keys(prices).length === 0;

  return (
    <div style={{fontFamily:"'Inter',sans-serif",background:T.bg,minHeight:"100vh",color:T.text,transition:"background .3s, color .3s"}}>
      <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 24px",borderBottom:`1px solid ${T.border}`,background:T.headerBg,backdropFilter:"blur(20px)",position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <svg width="30" height="30" viewBox="0 0 80 80">
            <defs><linearGradient id="hdrGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#9333EA"/><stop offset="100%" stopColor="#D4A017"/></linearGradient></defs>
            <circle cx="40" cy="40" r="38" fill="none" stroke="url(#hdrGrad)" strokeWidth="2.5"/>
            <path d="M20 44 L32 30 L44 40 L60 20" fill="none" stroke="url(#hdrGrad)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="60" cy="20" r="3" fill="#D4A017"/>
          </svg>
          <div>
            <span style={{fontSize:20,fontWeight:800,fontFamily:"'Inter',sans-serif",background:"linear-gradient(135deg,#9333EA,#D4A017)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>InvestPulse</span>
            <div style={{fontSize:9,color:T.textMuted,fontFamily:"'JetBrains Mono',monospace",letterSpacing:1.5,textTransform:"uppercase"}}>Portföy Yönetim Sistemi</div>
          </div>
          <div style={{width:8,height:8,borderRadius:"50%",marginLeft:4,background:connStatus==="connected"?T.green:connStatus==="connecting"||connStatus==="retrying"?"#EAB308":T.red,boxShadow:`0 0 8px ${connStatus==="connected"?T.greenGlow:"rgba(239,68,68,.3)"}`,transition:"background .3s"}} title={connStatus==="connected"?"Canlı veri":connStatus==="connecting"?"Bağlanıyor...":"Hata"}/>

        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <span style={{fontSize:12,color:T.textMuted,fontFamily:"'JetBrains Mono',monospace"}}>👤 {currentUser}</span>
          <button onClick={toggleTheme} style={{background:T.bgCardSolid,border:`1px solid ${T.border}`,color:T.textSecondary,width:34,height:34,borderRadius:8,cursor:"pointer",fontSize:15,display:"flex",alignItems:"center",justifyContent:"center",transition:"all .2s"}} title={themeMode==="dark"?"Açık Tema":"Koyu Tema"}>{themeMode==="dark"?"☀":"🌙"}</button>

          <button onClick={async()=>{await logoutUser();setIsLoggedIn(false);setCurrentUser("");}} style={{background:T.redGlow,border:`1px solid ${T.red}33`,color:T.red,padding:"0 12px",height:34,borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"'Inter',sans-serif"}}>Çıkış</button>
        </div>
      </header>
      {/* Loading indicator — header altında ince bar */}
      {isLoading&&<div style={{width:"100%",height:2,background:T.border,overflow:"hidden"}}><div style={{height:"100%",background:`linear-gradient(90deg,${T.accent},${T.gold},${T.accent})`,backgroundSize:"200% 100%",animation:"shimmer 1.5s infinite linear"}}/></div>}
      <nav style={{display:"flex",gap:4,padding:"10px 24px",borderBottom:`1px solid ${T.border}`,overflowX:"auto",background:T.bgSecondary}}>
        {[{id:"overview",lbl:"Dashboard",ic:"⊞"},{id:"portfolio",lbl:"Portföy",ic:"◎"},{id:"trade",lbl:"Trade",ic:"📈"},{id:"reports",lbl:"Raporlar",ic:"📄"}].map(t=>
          <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"9px 18px",background:tab===t.id?T.accentGlow:"transparent",border:tab===t.id?`1px solid ${T.accent}33`:"1px solid transparent",color:tab===t.id?T.accent:T.textMuted,fontSize:13,fontWeight:tab===t.id?600:500,cursor:"pointer",borderRadius:8,display:"flex",alignItems:"center",gap:6,fontFamily:"'Inter',sans-serif",position:"relative",whiteSpace:"nowrap",transition:"all .2s"}}>
            <span style={{fontSize:16}}>{t.ic}</span>{t.lbl}
          </button>)}
      </nav>
      <main style={{padding:"20px 24px",maxWidth:1300,margin:"0 auto"}}>
        {showReportNotif&&<div style={{background:`linear-gradient(135deg,${T.greenGlow},${T.bgCardSolid})`,border:`1px solid ${T.green}33`,borderRadius:12,padding:"14px 20px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:20}}>📊</span>
            <div><div style={{fontSize:13,color:T.green,fontWeight:600}}>Aylık Rapor Zamanı</div><div style={{fontSize:11,color:T.textMuted,marginTop:2}}>Bu ay henüz portföy raporu oluşturmadınız</div></div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={generateReport} style={{background:T.green,border:"none",color:"#0B0D15",padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>Rapor Oluştur</button>
            <button onClick={()=>setShowReportNotif(false)} style={{background:"none",border:`1px solid ${T.green}33`,color:T.textMuted,padding:"8px 12px",borderRadius:8,cursor:"pointer",fontSize:12}}>Kapat</button>
          </div>
        </div>}

        {/* ═══ PORTFOLIO ═══ */}
        {tab==="portfolio"&&<div style={{animation:"fadeUp .4s ease-out"}}>
          {/* Portfolio Selector Bar */}
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,flexWrap:"wrap",position:"relative"}}>
            <div style={{display:"flex",gap:4,flex:1,overflowX:"auto",paddingBottom:4}}>
              {Object.keys(portfolios).map(name=>(
                <button key={name} onClick={()=>setActivePortfolio(name)}
                  onDoubleClick={()=>{setRenameTarget(name);setRenameValue(name);}}
                  style={{padding:"8px 16px",background:activePortfolio===name?"linear-gradient(135deg,#9333EA22,#D4A01711)":T.bgCardSolid,border:`1px solid ${activePortfolio===name?"#9333EA44":T.borderLight}`,color:activePortfolio===name?"#9333EA":T.textSecondary,borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:activePortfolio===name?600:400,fontFamily:"'Inter',sans-serif",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:6}}>
                  {name}
                  <span style={{fontSize:11,color:T.textMuted}}>({(portfolios[name]||[]).length})</span>
                </button>
              ))}
            </div>
            <div style={{display:"flex",gap:6}}>
              <button onClick={()=>setShowPortfolioMenu(!showPortfolioMenu)}
                style={{padding:"8px 12px",background:T.bgCardSolid,border:`1px solid ${T.borderLight}`,color:T.textSecondary,borderRadius:8,cursor:"pointer",fontSize:13,fontFamily:"'Inter',sans-serif"}}>+ Yeni Portföy</button>
              {Object.keys(portfolios).length>1&&<button onClick={()=>{
                if(window.confirm(`"${activePortfolio}" portföyünü silmek istediğinize emin misiniz?`)){
                  setPortfolios(prev=>{const next={...prev};delete next[activePortfolio];return next;});
                  setActivePortfolio(Object.keys(portfolios).find(k=>k!==activePortfolio)||"Ana Portföy");
                }
              }} style={{padding:"8px 12px",background:T.redGlow,border:`1px solid ${T.red}33`,color:T.red,borderRadius:8,cursor:"pointer",fontSize:12,fontFamily:"'Inter',sans-serif"}}>🗑</button>}
            </div>

            {/* New Portfolio Input */}
            {showPortfolioMenu&&<div style={{position:"absolute",top:"100%",right:0,marginTop:4,background:T.bgCardSolid,border:`1px solid ${T.borderLight}`,borderRadius:10,padding:12,zIndex:50,boxShadow:"0 12px 40px rgba(0,0,0,.5)",width:260}}>
              <div style={{fontSize:12,color:T.textSecondary,marginBottom:8}}>Yeni portföy adı:</div>
              <div style={{display:"flex",gap:8}}>
                <input autoFocus value={newPortfolioName} onChange={e=>setNewPortfolioName(e.target.value)}
                  onKeyDown={e=>{if(e.key==="Enter"&&newPortfolioName.trim()){setPortfolios(prev=>({...prev,[newPortfolioName.trim()]:[]}));setActivePortfolio(newPortfolioName.trim());setNewPortfolioName("");setShowPortfolioMenu(false);}}}
                  placeholder="örn: Uzun Vade"
                  style={{flex:1,padding:"8px 10px",background:T.bg,border:`1px solid ${T.borderLight}`,borderRadius:6,color:T.text,fontSize:13,outline:"none",fontFamily:"'Inter',sans-serif"}}/>
                <button onClick={()=>{if(newPortfolioName.trim()){setPortfolios(prev=>({...prev,[newPortfolioName.trim()]:[]}));setActivePortfolio(newPortfolioName.trim());setNewPortfolioName("");setShowPortfolioMenu(false);}}}
                  style={{padding:"8px 14px",background:"linear-gradient(135deg,#9333EA,#D4A017)",border:"none",borderRadius:6,color:T.text,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>Ekle</button>
              </div>
            </div>}

            {/* Rename Modal */}
            {renameTarget&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}} onClick={()=>setRenameTarget(null)}>
              <div style={{background:T.bgCardSolid,border:`1px solid ${T.borderLight}`,borderRadius:12,padding:20,width:300}} onClick={e=>e.stopPropagation()}>
                <div style={{fontSize:14,fontWeight:600,color:T.text,marginBottom:12}}>Portföyü Yeniden Adlandır</div>
                <input autoFocus value={renameValue} onChange={e=>setRenameValue(e.target.value)}
                  onKeyDown={e=>{if(e.key==="Enter"&&renameValue.trim()&&renameValue!==renameTarget){
                    setPortfolios(prev=>{const next={};Object.entries(prev).forEach(([k,v])=>{next[k===renameTarget?renameValue.trim():k]=v;});return next;});
                    if(activePortfolio===renameTarget)setActivePortfolio(renameValue.trim());setRenameTarget(null);}}}
                  style={{width:"100%",padding:"10px 12px",background:T.bg,border:`1px solid ${T.borderLight}`,borderRadius:8,color:T.text,fontSize:14,outline:"none",marginBottom:12,fontFamily:"'Inter',sans-serif"}}/>
                <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                  <button onClick={()=>setRenameTarget(null)} style={{padding:"8px 16px",background:T.bgCardSolid,border:`1px solid ${T.borderLight}`,borderRadius:6,color:T.textSecondary,fontSize:12,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>İptal</button>
                  <button onClick={()=>{if(renameValue.trim()&&renameValue!==renameTarget){setPortfolios(prev=>{const next={};Object.entries(prev).forEach(([k,v])=>{next[k===renameTarget?renameValue.trim():k]=v;});return next;});if(activePortfolio===renameTarget)setActivePortfolio(renameValue.trim());setRenameTarget(null);}}}
                    style={{padding:"8px 16px",background:"linear-gradient(135deg,#9333EA,#D4A017)",border:"none",borderRadius:6,color:T.text,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>Kaydet</button>
                </div>
              </div>
            </div>}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:14,marginBottom:20}}>
            <div style={{...st.card,background:T.gradientHero,border:`1px solid ${T.accent}22`}}><div style={{fontSize:11,color:T.textMuted,textTransform:"uppercase",letterSpacing:1,marginBottom:8,fontWeight:500}}>Portföy Değeri</div><div style={{fontSize:28,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:T.text}}>{fmt(totVal)}</div><div style={{fontSize:13,marginTop:6,fontFamily:"'JetBrains Mono',monospace",color:tot24h>=0?T.green:T.red}}>{tot24h>=0?"▲":"▼"} {fmt(Math.abs(tot24h))} (24s)</div></div>
            <div style={st.card}><div style={{fontSize:11,color:T.textMuted,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Yatırım</div><div style={{fontSize:20,fontWeight:700,fontFamily:"'Inter',monospace"}}>{fmt(totInv)}</div></div>
            <div style={st.card}><div style={{fontSize:11,color:T.textMuted,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>K/Z</div><div style={{fontSize:20,fontWeight:700,fontFamily:"'Inter',monospace",color:totPnl>=0?T.green:T.red}}>{totPnl>=0?"+":""}{fmt(totPnl)} <span style={{fontSize:13}}>{fPct(totPnlPct)}</span></div></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:pieData.length>0?"260px 1fr":"1fr",gap:18}}>
            <div style={st.card}>
              <h3 style={{fontSize:14,fontWeight:600,marginBottom:12}}>Dağılım</h3>
              {pieData.length>0?<><ResponsiveContainer width="100%" height={200}><PieChart><Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={3} dataKey="value" stroke="none">{pieData.map((e,i)=><Cell key={i} fill={e.color}/>)}</Pie><Tooltip formatter={v=>fmt(v)} contentStyle={st.tt}/></PieChart></ResponsiveContainer>
              <div style={{marginTop:8}}>{pieData.map((item,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 0",borderBottom:`1px solid ${T.bgCardSolid}`}}><span style={{width:8,height:8,borderRadius:2,background:item.color,flexShrink:0}}/><span style={{flex:1,fontSize:12,color:T.textSecondary}}>{item.name}</span><span style={{fontSize:11,fontFamily:"'JetBrains Mono',monospace"}}>{totVal>0?((item.value/totVal)*100).toFixed(1):0}%</span></div>)}</div></>:<div style={{textAlign:"center",padding:40,color:T.textMuted}}>Portföye varlık ekleyin</div>}
            </div>
            <div style={st.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}><h3 style={{fontSize:15,fontWeight:600}}>Varlıklar</h3><button onClick={()=>{setEditIdx(null);setNcCoin(null);setNcAmount("");setNcBuyPrice("");setNcSection("Genel");setShowAdd(true);}} style={{padding:"7px 14px",background:"linear-gradient(135deg,#9333EA,#D4A017)",border:"none",borderRadius:8,color:T.text,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>+ Ekle</button></div>
              <div style={{overflowX:"auto"}}>
                {pData.length===0?<div style={{textAlign:"center",padding:40,color:T.textMuted}}><div style={{fontSize:48,marginBottom:12}}>📊</div>Henüz varlık yok</div>:
                <table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr>{["","Coin","Fiyat","24s","Miktar","Değer","Ağırlık","K/Z","İşlem"].map((h,i)=><th key={i} style={{...st.th,textAlign:i<=1?"left":i===8?"center":"right",width:i===0?30:undefined}}>{h}</th>)}</tr></thead><tbody>
                {(()=>{
                  const grouped = {};
                  pData.forEach((item, i) => {
                    const sec = item.section || "Genel";
                    if (!grouped[sec]) grouped[sec] = [];
                    grouped[sec].push({ ...item, origIdx: i });
                  });
                  const sectionOrder = sections.filter(s => grouped[s]);
                  Object.keys(grouped).forEach(s => { if (!sectionOrder.includes(s)) sectionOrder.push(s); });
                  // Also show empty sections as drop targets
                  sections.forEach(s => { if (!sectionOrder.includes(s)) sectionOrder.push(s); });

                  const rows = [];
                  sectionOrder.forEach((secName, si) => {
                    const items = grouped[secName] || [];
                    const secVal = items.reduce((s, it) => s + it.currentValue, 0);
                    const secPnl = items.reduce((s, it) => s + it.pnl, 0);
                    const secInv = items.reduce((s, it) => s + it.investedValue, 0);
                    const isDropTarget = dragIdx !== null && dragOverSection === secName;

                    rows.push(
                      <tr key={`sec-${secName}`}
                        onDragOver={e=>{e.preventDefault();setDragOverSection(secName);}}
                        onDragLeave={()=>setDragOverSection(null)}
                        onDrop={e=>{e.preventDefault();if(dragIdx!==null){setPortfolio(p=>p.map((it,i)=>i===dragIdx?{...it,section:secName}:it));}setDragIdx(null);setDragOverSection(null);}}>
                        <td colSpan={9} style={{padding:items.length>0?"14px 12px 8px":"10px 12px",borderBottom:`2px solid ${isDropTarget?"#9333EA":T.borderLight}`,background:isDropTarget?"#9333EA08":`${T.bgCardSolid}99`,transition:"all .2s"}}>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                            <div style={{display:"flex",alignItems:"center",gap:10}}>
                              <div style={{width:4,height:20,borderRadius:2,background:CLR[si%CLR.length]}}/>
                              {editSectionName===secName?(
                                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                                  <input autoFocus value={editSectionValue} onChange={e=>setEditSectionValue(e.target.value)}
                                    onKeyDown={e=>{
                                      if(e.key==="Enter"&&editSectionValue.trim()){
                                        const nv=editSectionValue.trim();
                                        setSections(p=>p.map(s=>s===secName?nv:s));
                                        setPortfolio(p=>p.map(it=>it.section===secName?{...it,section:nv}:it));
                                        setEditSectionName(null);
                                      }
                                      if(e.key==="Escape") setEditSectionName(null);
                                    }}
                                    style={{padding:"4px 8px",background:T.bg,border:"1px solid #9333EA44",borderRadius:4,color:T.text,fontSize:14,fontWeight:700,outline:"none",fontFamily:"'Inter',sans-serif",width:160}}/>
                                  <button onClick={()=>{const nv=editSectionValue.trim();if(nv){setSections(p=>p.map(s=>s===secName?nv:s));setPortfolio(p=>p.map(it=>it.section===secName?{...it,section:nv}:it));}setEditSectionName(null);}}
                                    style={{padding:"3px 8px",background:"#9333EA22",border:"1px solid #9333EA44",borderRadius:4,color:"#9333EA",fontSize:11,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>✓</button>
                                  <button onClick={()=>setEditSectionName(null)}
                                    style={{padding:"3px 8px",background:T.bgCardSolid,border:`1px solid ${T.borderLight}`,borderRadius:4,color:T.textMuted,fontSize:11,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>✕</button>
                                </div>
                              ):(
                                <>
                                  <span style={{fontSize:14,fontWeight:700,color:T.text,letterSpacing:.3}}>{secName}</span>
                                  <span style={{fontSize:11,color:T.textMuted,background:T.bgCardSolid,padding:"2px 8px",borderRadius:4}}>{items.length} coin</span>
                                  <button onClick={()=>{setEditSectionName(secName);setEditSectionValue(secName);}}
                                    style={{width:22,height:22,border:`1px solid ${T.borderLight}`,background:T.bgCardSolid,color:T.textMuted,borderRadius:4,cursor:"pointer",fontSize:10,display:"flex",alignItems:"center",justifyContent:"center"}} title="Yeniden adlandır">✎</button>
                                  {sections.length>1&&<button onClick={()=>{
                                    const fallback=sections.find(s=>s!==secName)||"Kategorisiz";
                                    if(window.confirm(`"${secName}" kategorisini silmek istediğinize emin misiniz? İçindeki coinler "${fallback}" kategorisine taşınacak.`)){
                                      setPortfolio(p=>p.map(it=>it.section===secName?{...it,section:fallback}:it));
                                      setSections(p=>p.filter(s=>s!==secName));
                                    }
                                  }} style={{width:22,height:22,border:`1px solid ${T.red}33`,background:T.redGlow,color:T.red,borderRadius:4,cursor:"pointer",fontSize:10,display:"flex",alignItems:"center",justifyContent:"center"}} title="Kategoriyi sil">✕</button>}
                                </>
                              )}
                              {isDropTarget&&<span style={{fontSize:11,color:"#9333EA",animation:"pulse 1s infinite"}}>← Buraya bırak</span>}
                            </div>
                            {items.length>0&&editSectionName!==secName&&<div style={{display:"flex",gap:16,fontSize:12,fontFamily:"'JetBrains Mono',monospace"}}>
                              <span style={{color:T.textSecondary}}>Değer: <span style={{color:T.text,fontWeight:600}}>{fmt(secVal)}</span></span>
                              <span style={{color:T.textSecondary}}>K/Z: <span style={{color:secPnl>=0?T.green:T.red,fontWeight:600}}>{secPnl>=0?"+":""}{fmt(secPnl)} ({fPct(secInv>0?(secPnl/secInv)*100:0)})</span></span>
                              {totVal>0&&<span style={{color:"#9333EA"}}>{(secVal/totVal*100).toFixed(1)}%</span>}
                            </div>}
                          </div>
                        </td>
                      </tr>
                    );

                    items.forEach((item) => {
                      const i = item.origIdx;
                      const pct = totVal > 0 ? (item.currentValue / totVal * 100) : 0;
                      const isDragging = dragIdx === i;
                      rows.push(
                        <tr key={i} draggable
                          onDragStart={()=>setDragIdx(i)}
                          onDragEnd={()=>{setDragIdx(null);setDragOverSection(null);}}
                          style={{opacity:isDragging?.4:1,cursor:"grab",transition:"opacity .2s"}}>
                        <td style={{...st.td,width:30,textAlign:"center",color:T.borderLight,fontSize:14,cursor:"grab"}}>⠿</td>
                        <td style={st.td}><div style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:32,height:32,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,fontFamily:"'Inter',monospace",background:CLR[i%CLR.length]+"22",color:CLR[i%CLR.length]}}>{item.coin?.symbol?.charAt(0)||"?"}</div><div><div style={{fontWeight:600,fontSize:13}}>{item.coin?.name}</div><div style={{fontSize:11,color:T.textMuted,fontFamily:"'JetBrains Mono',monospace"}}>{item.coin?.symbol}</div></div></div></td>
                        <td style={{...st.td,textAlign:"right",fontFamily:"'JetBrains Mono',monospace"}}>{fmt(item.currentPrice,item.currentPrice<1?4:2)}</td>
                        <td style={{...st.td,textAlign:"right",color:item.change24h>=0?T.green:T.red,fontFamily:"'JetBrains Mono',monospace"}}>{fPct(item.change24h)}</td>
                        <td style={{...st.td,textAlign:"right",fontFamily:"'JetBrains Mono',monospace"}}>{item.amount}</td>
                        <td style={{...st.td,textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontWeight:600}}>{fmt(item.currentValue)}</td>
                        <td style={{...st.td,textAlign:"right"}}><div style={{display:"flex",alignItems:"center",gap:6,justifyContent:"flex-end"}}><div style={{width:50,height:5,background:T.border,borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${pct}%`,background:CLR[i%CLR.length],borderRadius:3}}/></div><span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#9333EA",fontWeight:600,minWidth:40,textAlign:"right"}}>{pct.toFixed(1)}%</span></div></td>
                        <td style={{...st.td,textAlign:"right"}}><div style={{color:item.pnl>=0?T.green:T.red,fontFamily:"'JetBrains Mono',monospace",fontWeight:600}}>{item.pnl>=0?"+":""}{fmt(item.pnl)}</div><div style={{color:item.pnl>=0?`${T.green}aa`:`${T.red}aa`,fontSize:11}}>{fPct(item.pnlPct)}</div></td>
                        <td style={{...st.td,textAlign:"center"}}><div style={{display:"flex",gap:6,justifyContent:"center"}}><button onClick={()=>{const it=portfolio[i];const c=knownCoins.find(x=>x.id===it.coinId);setNcCoin(c||{id:it.coinId,symbol:"?",name:it.coinId});setNcAmount(""+it.amount);setNcBuyPrice(""+it.buyPrice);setNcSection(it.section||"Genel");setEditIdx(i);setShowAdd(true);}} style={{width:28,height:28,border:`1px solid ${T.borderLight}`,background:T.bgCardSolid,color:T.textSecondary,borderRadius:6,cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>✎</button><button onClick={()=>setDelConfirm(i)} style={{width:28,height:28,border:`1px solid ${T.red}33`,background:T.redGlow,color:T.red,borderRadius:6,cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button></div></td></tr>
                      );
                    });
                  });
                  return rows;
                })()}
                </tbody></table>}
              </div>
            </div>
          </div>
        </div>}

        {/* ═══ DASHBOARD ═══ */}
        {tab==="overview"&&<div style={{animation:"fadeUp .4s ease-out"}}>
          {/* Summary Cards */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:14,marginBottom:20}}>
            <div style={{...st.card,background:T.gradientHero,border:`1px solid ${T.accent}22`}}><div style={{fontSize:11,color:T.textMuted,textTransform:"uppercase",letterSpacing:1,marginBottom:8,fontWeight:500}}>Toplam Değer</div><div style={{fontSize:28,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:T.text}}>{isLoading?<span style={{display:"inline-block",width:120,height:28,background:T.border,borderRadius:6,animation:"skeletonPulse 1.5s infinite"}}/>:fmt(allTotVal)}</div><div style={{fontSize:13,marginTop:6,fontFamily:"'JetBrains Mono',monospace",color:allTot24h>=0?T.green:T.red}}>{isLoading?"":`${allTot24h>=0?"▲":"▼"} ${fmt(Math.abs(allTot24h))} (24s)`}</div></div>
            <div style={st.card}><div style={{fontSize:11,color:T.textMuted,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Toplam Yatırım</div><div style={{fontSize:20,fontWeight:700,fontFamily:"'Inter',monospace"}}>{isLoading?<span style={{display:"inline-block",width:100,height:20,background:T.border,borderRadius:6,animation:"skeletonPulse 1.5s infinite"}}/>:fmt(allTotInv)}</div></div>
            <div style={st.card}><div style={{fontSize:11,color:T.textMuted,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Kar / Zarar</div><div style={{fontSize:20,fontWeight:700,fontFamily:"'Inter',monospace",color:allTotPnl>=0?T.green:T.red}}>{isLoading?<span style={{display:"inline-block",width:100,height:20,background:T.border,borderRadius:6,animation:"skeletonPulse 1.5s infinite"}}/>:<>{allTotPnl>=0?"+":""}{fmt(allTotPnl)}</>}</div>{!isLoading&&<div style={{fontSize:12,marginTop:2,fontFamily:"'JetBrains Mono',monospace",color:allTotPnl>=0?T.green:T.red}}>{fPct(allTotPnlPct)}</div>}</div>
          </div>

          {/* Market Distribution Bar */}
          {(()=>{
            const mktTotals={};
            allPData.forEach(item=>{const m=getMarketType(item.coinId);mktTotals[m]=(mktTotals[m]||0)+item.currentValue;});
            const mktE=Object.entries(mktTotals).sort((a,b)=>b[1]-a[1]);
            if(mktE.length===0) return null;
            return(<div style={{...st.card,marginBottom:20,padding:16}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:10,flexWrap:"wrap",gap:8}}>
                <span style={{fontSize:12,fontWeight:600,color:T.textSecondary}}>Piyasa Dağılımı</span>
                <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                  {mktE.map(([m,val])=>(<span key={m} style={{fontSize:11,fontFamily:"'JetBrains Mono',monospace",display:"flex",alignItems:"center",gap:4}}><span style={{width:8,height:8,borderRadius:2,background:getMarketColor(m)}}/><span style={{color:T.textSecondary}}>{getMarketLabel(m)}</span><span style={{color:T.text,fontWeight:600}}>{allTotVal>0?(val/allTotVal*100).toFixed(1):0}%</span></span>))}
                </div>
              </div>
              <div style={{height:8,borderRadius:4,overflow:"hidden",display:"flex",gap:2}}>
                {mktE.map(([m,val])=>(<div key={m} style={{height:"100%",flex:allTotVal>0?val/allTotVal:0,background:getMarketColor(m),borderRadius:2,transition:"flex .5s",minWidth:val>0?4:0}}/>))}
              </div>
            </div>);
          })()}

          {/* Portföy Kartları (sadece çoklu portföy varsa) */}
          {portfolioSummaries.length>1&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:12,marginBottom:20}}>
            {portfolioSummaries.map((ps,i)=>(<div key={ps.name} style={{...st.card,padding:16,cursor:"pointer",transition:"border-color .2s"}} onClick={()=>{setActivePortfolio(ps.name);setTab("portfolio");}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><span style={{fontSize:14,fontWeight:600}}>{ps.name}</span><span style={{fontSize:11,color:T.textMuted}}>{ps.count} varlık</span></div>
              <div style={{fontSize:20,fontWeight:700,fontFamily:"'Inter',monospace",color:T.text,marginBottom:4}}>{fmt(ps.value)}</div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12,fontFamily:"'JetBrains Mono',monospace"}}><span style={{color:ps.pnl>=0?T.green:T.red}}>{ps.pnl>=0?"+":""}{fmt(ps.pnl)} ({fPct(ps.pnlPct)})</span><span style={{color:"#9333EA"}}>{allTotVal>0?(ps.value/allTotVal*100).toFixed(1):0}%</span></div>
            </div>))}
          </div>}

          {/* 🔥 Portföyümde En Çok Yükselen & Düşenler */}
          {allPData.length>1&&(()=>{
            const sorted=[...allPData].filter(x=>x.currentPrice>0).sort((a,b)=>b.change24h-a.change24h);
            const gainers=sorted.slice(0,5);
            const losers=[...sorted].reverse().slice(0,5);
            if(sorted.length===0) return null;
            const renderItem=(item,i,max)=>{
              const mc=getMarketColor(getMarketType(item.coinId));
              const isUp=item.change24h>=0;
              const absPct=Math.abs(item.change24h);
              const maxPct=Math.max(...sorted.map(x=>Math.abs(x.change24h)),1);
              const barW=Math.max((absPct/maxPct)*100,2);
              return(<div key={item.coinId} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:i<max-1?`1px solid ${T.bgCardSolid}`:"none"}}>
                <div style={{width:26,height:26,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,fontFamily:"'Inter',monospace",background:mc+"18",color:mc}}>{item.coin?.symbol?.charAt(0)||"?"}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:4}}>
                    <span style={{fontWeight:600,fontSize:12,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{item.coin?.symbol}</span>
                    <span style={{fontSize:7,padding:"1px 3px",borderRadius:2,background:mc+"15",color:mc,fontWeight:700}}>{getMarketLabel(getMarketType(item.coinId))}</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginTop:3}}>
                    <div style={{flex:1,height:3,background:T.border,borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:barW+"%",background:isUp?T.green:T.red,borderRadius:2,transition:"width .5s"}}/></div>
                  </div>
                </div>
                <div style={{textAlign:"right",minWidth:80}}>
                  <div style={{fontSize:13,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:isUp?T.green:T.red}}>{isUp?"▲":"▼"} {absPct.toFixed(2)}%</div>
                  <div style={{fontSize:10,color:T.textMuted,fontFamily:"'JetBrains Mono',monospace"}}>{fmt(item.currentValue)}</div>
                </div>
              </div>);
            };
            return(<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:20}}>
              <div style={{...st.card,padding:16}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:12}}><span style={{fontSize:16}}>🚀</span><span style={{fontSize:13,fontWeight:600,color:T.green}}>En Çok Yükselen</span><span style={{fontSize:10,color:T.textMuted}}>(24s)</span></div>
                {gainers.map((item,i)=>renderItem(item,i,gainers.length))}
              </div>
              <div style={{...st.card,padding:16}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:12}}><span style={{fontSize:16}}>📉</span><span style={{fontSize:13,fontWeight:600,color:T.red}}>En Çok Düşen</span><span style={{fontSize:10,color:T.textMuted}}>(24s)</span></div>
                {losers.map((item,i)=>renderItem(item,i,losers.length))}
              </div>
            </div>);
          })()}

          {/* Dağılım + Tüm Varlıklar */}
          <div style={{display:"grid",gridTemplateColumns:allPData.length>0?"260px 1fr":"1fr",gap:18}}>
            {allPData.length>0&&<div style={st.card}>
              <h3 style={{fontSize:14,fontWeight:600,marginBottom:12}}>Dağılım</h3>
              <ResponsiveContainer width="100%" height={200}><PieChart><Pie data={allPieData.slice(0,12)} cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={2} dataKey="value" stroke="none">{allPieData.slice(0,12).map((e,i)=><Cell key={i} fill={e.color}/>)}</Pie><Tooltip formatter={v=>[fmt(v),""]} contentStyle={st.tt}/></PieChart></ResponsiveContainer>
              <div style={{marginTop:8,maxHeight:180,overflowY:"auto"}}>{allPieData.map((item,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 0",borderBottom:`1px solid ${T.bgCardSolid}`}}><span style={{width:8,height:8,borderRadius:2,background:item.color,flexShrink:0}}/><span style={{flex:1,fontSize:12,color:T.textSecondary}}>{item.name}</span><span style={{fontSize:11,fontFamily:"'JetBrains Mono',monospace",color:"#9333EA"}}>{allTotVal>0?((item.value/allTotVal)*100).toFixed(1):0}%</span></div>)}</div>
            </div>}
            <div style={st.card}>
              <h3 style={{fontSize:14,fontWeight:600,marginBottom:12}}>Tüm Varlıklar</h3>
              <div style={{overflowX:"auto"}}>
                {allPData.length===0?<div style={{textAlign:"center",padding:40,color:T.textMuted}}>Portföylere varlık ekleyin</div>:
                <table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr>{["Varlık","Fiyat","24s","Değer","Ağırlık","K/Z"].map((h,i)=><th key={h} style={{...st.th,textAlign:i===0?"left":"right"}}>{h}</th>)}</tr></thead><tbody>
                {allPData.map((item,i)=>{
                  const pct=allTotVal>0?(item.currentValue/allTotVal*100):0;const mc=getMarketColor(getMarketType(item.coinId));
                  return(<tr key={item.coinId}>
                    <td style={st.td}><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:28,height:28,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,fontFamily:"'Inter',monospace",background:mc+"18",color:mc}}>{item.coin?.symbol?.charAt(0)||"?"}</div><div><div style={{display:"flex",alignItems:"center",gap:4}}><span style={{fontWeight:600,fontSize:12}}>{item.coin?.name}</span><span style={{fontSize:8,padding:"1px 4px",borderRadius:2,background:mc+"15",color:mc,fontWeight:700}}>{getMarketLabel(getMarketType(item.coinId))}</span></div><div style={{fontSize:10,color:T.textMuted,fontFamily:"'JetBrains Mono',monospace"}}>{item.coin?.symbol}</div></div></div></td>
                    <td style={{...st.td,textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>{fmt(item.currentPrice,item.currentPrice<1?4:2)}</td>
                    <td style={{...st.td,textAlign:"right",color:item.change24h>=0?T.green:T.red,fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>{fPct(item.change24h)}</td>
                    <td style={{...st.td,textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontWeight:600,fontSize:12}}>{fmt(item.currentValue)}</td>
                    <td style={{...st.td,textAlign:"right"}}><div style={{display:"flex",alignItems:"center",gap:4,justifyContent:"flex-end"}}><div style={{width:36,height:4,background:T.border,borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:`${pct}%`,background:CLR[i%CLR.length],borderRadius:2}}/></div><span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"#9333EA",fontWeight:600,minWidth:36,textAlign:"right"}}>{pct.toFixed(1)}%</span></div></td>
                    <td style={{...st.td,textAlign:"right"}}><span style={{color:item.pnl>=0?T.green:T.red,fontFamily:"'JetBrains Mono',monospace",fontWeight:600,fontSize:12}}>{item.pnl>=0?"+":""}{fmt(item.pnl)}</span></td>
                  </tr>);})}
                </tbody></table>}
              </div>
            </div>
          </div>
        </div>}

        {/* ═══ REPORTS ═══ */}

        {/* ═══ TRADE JOURNAL ═══ */}
        {tab==="trade"&&<div style={{animation:"fadeUp .4s ease-out"}}>
          {/* Trade Header */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}>
            <div>
              <div style={{fontSize:20,fontWeight:700,color:T.text}}>Trade Journal</div>
              <div style={{fontSize:13,color:T.textMuted}}>{trades.length} trade • Toplam K/Z <span style={{color:totalPnl>=0?T.green:T.red,fontWeight:600}}>${totalPnl.toFixed(2)}</span></div>
            </div>
            <div style={{display:"flex",gap:8}}>
              {[{v:"list",l:"Geçmiş",ic:"☰"},{v:"add",l:"Yeni Trade",ic:"+"},{v:"analytics",l:"Analitik",ic:"📊"},{v:"goals",l:"Hedefler",ic:"◎"}].map(v=>
                <button key={v.v} onClick={()=>{setTradeView(v.v);if(v.v==="add"){resetNewTrade();setEditTrade(null);}}} style={{padding:"8px 16px",background:tradeView===v.v?"linear-gradient(135deg,#9333EA,#D4A017)":T.bgCard,border:`1px solid ${tradeView===v.v?T.accent+"44":T.border}`,color:tradeView===v.v?"#fff":T.textSecondary,fontSize:12,fontWeight:600,cursor:"pointer",borderRadius:8,fontFamily:"'Inter',sans-serif",display:"flex",alignItems:"center",gap:4}}>{v.ic} {v.l}</button>
              )}
            </div>
          </div>

          {/* ═══ TRADE LIST ═══ */}
          {tradeView==="list"&&<>
            {/* Kasa & Filtreler */}
            <div style={{display:"flex",gap:12,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:6,background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:8,padding:"6px 12px"}}>
                <span style={{fontSize:11,color:T.textMuted}}>Kasa:</span>
                <input value={tradeKasa} onChange={e=>setTradeKasa(parseFloat(e.target.value)||0)} style={{width:80,background:"transparent",border:"none",color:T.gold,fontSize:13,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",outline:"none"}} />
                <span style={{fontSize:11,color:T.textMuted}}>USDT</span>
              </div>
              <input value={tradeSearch} onChange={e=>setTradeSearch(e.target.value)} placeholder="Sembol, not, etiket ara..." style={{flex:1,minWidth:150,padding:"8px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none",fontFamily:"'Inter',sans-serif"}} />
              <div style={{display:"flex",gap:4}}>
                {[{f:"all",l:"Tümü"},{f:"open",l:"Açık"},{f:"closed",l:"Kapalı"},{f:"win",l:"Kazanç"},{f:"loss",l:"Kayıp"}].map(f=>
                  <button key={f.f} onClick={()=>setTradeFilter(f.f)} style={{padding:"6px 10px",background:tradeFilter===f.f?T.accentGlow:"transparent",border:`1px solid ${tradeFilter===f.f?T.accent+"33":"transparent"}`,color:tradeFilter===f.f?T.accent:T.textMuted,fontSize:11,fontWeight:600,cursor:"pointer",borderRadius:6,fontFamily:"'Inter',sans-serif"}}>{f.l}</button>
                )}
              </div>
            </div>

            {/* Trade Listesi */}
            {filteredTrades.length===0?
              <div style={{...st.card,padding:60,textAlign:"center"}}><div style={{fontSize:40,marginBottom:12}}>📈</div><div style={{fontSize:16,fontWeight:600,color:T.text,marginBottom:4}}>Henüz trade yok</div><div style={{fontSize:13,color:T.textMuted,marginBottom:16}}>İlk tradeni ekleyerek başla</div><button onClick={()=>{setTradeView("add");resetNewTrade();setEditTrade(null);}} style={{padding:"10px 24px",background:"linear-gradient(135deg,#9333EA,#D4A017)",border:"none",borderRadius:8,color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>İlk Tradeni Ekle</button></div>
            :
              <div style={{...st.card,padding:0,overflow:"hidden"}}><div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr>
                  {["Sembol","Yön","Giriş","Çıkış","Miktar","K/Z","K/Z%","Durum","Puan",""].map(h=><th key={h} style={{...st.th,textAlign:h===""?"center":"left",padding:"10px 8px"}}>{h}</th>)}
                </tr></thead><tbody>
                {filteredTrades.map((t,i)=>{
                  const pnl=calcPnl(t);const pnlPct=calcPnlPct(t);const isWin=pnl>0;
                  return <tr key={t.id||i} style={{borderBottom:`1px solid ${T.border}`}}>
                    <td style={{padding:"10px 8px"}}><div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:12,fontWeight:700,color:T.text,fontFamily:"'JetBrains Mono',monospace"}}>{t.symbol}</span><span style={{fontSize:9,padding:"1px 5px",borderRadius:3,background:t.market==="Kripto"?"#F7931A18":"#3b82f618",color:t.market==="Kripto"?"#F7931A":"#3b82f6",fontWeight:700}}>{t.market}</span></div><div style={{fontSize:10,color:T.textMuted}}>{t.exchange} • {t.leverage}</div></td>
                    <td style={{padding:"10px 8px"}}><span style={{fontSize:11,padding:"3px 8px",borderRadius:4,background:t.direction==="Long"?"#22C55E18":"#EF444418",color:t.direction==="Long"?"#22C55E":"#EF4444",fontWeight:700}}>{t.direction}</span></td>
                    <td style={{padding:"10px 8px",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:T.text}}>${parseFloat(t.entryPrice||0).toFixed(2)}</td>
                    <td style={{padding:"10px 8px",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:t.exitPrice?T.text:T.textMuted}}>{t.exitPrice?"$"+parseFloat(t.exitPrice).toFixed(2):"—"}</td>
                    <td style={{padding:"10px 8px",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:T.text}}>${parseFloat(t.amount||0).toFixed(0)}</td>
                    <td style={{padding:"10px 8px",fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:700,color:t.status==="Kapali"?(isWin?T.green:T.red):T.textMuted}}>{t.status==="Kapali"?(isWin?"+":"")+pnl.toFixed(2):"—"}</td>
                    <td style={{padding:"10px 8px",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:t.status==="Kapali"?(isWin?T.green:T.red):T.textMuted}}>{t.status==="Kapali"?(isWin?"+":"")+pnlPct.toFixed(2)+"%":"—"}</td>
                    <td style={{padding:"10px 8px"}}><span style={{fontSize:10,padding:"3px 8px",borderRadius:4,background:t.status==="Acik"?"#EAB30818":"#4A4D6518",color:t.status==="Acik"?"#EAB308":"#8B8EA0",fontWeight:600}}>{t.status==="Acik"?"Açık":"Kapalı"}</span></td>
                    <td style={{padding:"10px 8px",textAlign:"center"}}><span style={{fontSize:12,fontWeight:700,color:t.score>=7?T.green:t.score>=4?T.gold:T.red}}>{t.score}/10</span></td>
                    <td style={{padding:"10px 8px",textAlign:"center"}}><div style={{display:"flex",gap:4,justifyContent:"center"}}><button onClick={()=>{setNewTrade({...t});setEditTrade(i);setTradeView("add");}} style={{width:26,height:26,border:`1px solid ${T.borderLight}`,background:T.bgCardSolid,color:T.textSecondary,borderRadius:5,cursor:"pointer",fontSize:11,display:"flex",alignItems:"center",justifyContent:"center"}}>✎</button><button onClick={()=>deleteTrade(i)} style={{width:26,height:26,border:`1px solid ${T.red}33`,background:T.redGlow,color:T.red,borderRadius:5,cursor:"pointer",fontSize:11,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button></div></td>
                  </tr>;
                })}
                </tbody></table>
              </div></div>
            }
          </>}

          {/* ═══ ADD/EDIT TRADE ═══ */}
          {tradeView==="add"&&<div>
            <div style={{display:"grid",gap:16}}>
              {/* Risk Yönetimi */}
              <div style={{...st.card,borderLeft:`3px solid ${T.gold}`}}>
                <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:12,display:"flex",alignItems:"center",gap:8}}>🛡 Risk Yönetimi</div>
                <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Toplam Kasa (USDT)</div><input value={tradeKasa} onChange={e=>setTradeKasa(parseFloat(e.target.value)||0)} style={{padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.gold,fontSize:14,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",outline:"none",width:150}} /></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Risk % (Kasanın)</div><div style={{display:"flex",gap:4}}>{["0.5","1","1.5","2","3","5"].map(r=><button key={r} onClick={()=>setNewTrade(p=>({...p,amount:String((tradeKasa*parseFloat(r)/100).toFixed(2))}))} style={{padding:"6px 10px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:6,color:T.text,fontSize:11,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace"}}>%{r}</button>)}</div></div>
                </div>
              </div>

              {/* Trade Bilgileri */}
              <div style={{...st.card,borderLeft:`3px solid ${T.accent}`}}>
                <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:12,display:"flex",alignItems:"center",gap:8}}>📈 Trade Bilgileri</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Sembol</div><input value={newTrade.symbol} onChange={e=>setNewTrade(p=>({...p,symbol:e.target.value.toUpperCase()}))} placeholder="BTC/USDT" style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none",fontFamily:"'Inter',sans-serif"}} /></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Piyasa Türü</div><select value={newTrade.market} onChange={e=>setNewTrade(p=>({...p,market:e.target.value}))} style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}}><option>Kripto</option><option>Forex</option><option>Hisse</option><option>Emtia</option></select></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Borsa</div><select value={newTrade.exchange} onChange={e=>setNewTrade(p=>({...p,exchange:e.target.value}))} style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}}><option>Bybit</option><option>Binance</option><option>OKX</option><option>Gate.io</option><option>Coinbase</option><option>Diger</option></select></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Yön</div><div style={{display:"flex",gap:6}}>{["Long","Short"].map(d=><button key={d} onClick={()=>setNewTrade(p=>({...p,direction:d}))} style={{flex:1,padding:"10px",background:newTrade.direction===d?(d==="Long"?"#22C55E18":"#EF444418"):T.bgInput,border:`1px solid ${newTrade.direction===d?(d==="Long"?"#22C55E44":"#EF444444"):T.border}`,borderRadius:8,color:newTrade.direction===d?(d==="Long"?"#22C55E":"#EF4444"):T.textMuted,fontSize:13,fontWeight:600,cursor:"pointer"}}>{d}</button>)}</div></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Durum</div><select value={newTrade.status} onChange={e=>setNewTrade(p=>({...p,status:e.target.value}))} style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}}><option value="Acik">Açık</option><option value="Kapali">Kapalı</option></select></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Kaldıraç</div><select value={newTrade.leverage} onChange={e=>setNewTrade(p=>({...p,leverage:e.target.value}))} style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}}>{["1x","2x","3x","5x","10x","20x","25x","50x","75x","100x","125x"].map(l=><option key={l}>{l}</option>)}</select></div>
                </div>
              </div>

              {/* Fiyat & Pozisyon */}
              <div style={{...st.card,borderLeft:`3px solid #3b82f6`}}>
                <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:12,display:"flex",alignItems:"center",gap:8}}>💲 Fiyat & Pozisyon</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Giriş Fiyatı</div><input type="number" value={newTrade.entryPrice} onChange={e=>setNewTrade(p=>({...p,entryPrice:e.target.value}))} placeholder="0.00" style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace"}} /></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Çıkış Fiyatı</div><input type="number" value={newTrade.exitPrice} onChange={e=>setNewTrade(p=>({...p,exitPrice:e.target.value}))} placeholder="0.00" style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace"}} /></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Kontrat Miktarı (USDT)</div><input type="number" value={newTrade.amount} onChange={e=>setNewTrade(p=>({...p,amount:e.target.value}))} placeholder="100" style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace"}} /></div>
                </div>
              </div>

              {/* SL & TP */}
              <div style={{...st.card,borderLeft:`3px solid #10b981`}}>
                <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:12,display:"flex",alignItems:"center",gap:8}}>🎯 Stop Loss & Take Profit</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12}}>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Stop Loss</div><input type="number" value={newTrade.stopLoss} onChange={e=>setNewTrade(p=>({...p,stopLoss:e.target.value}))} placeholder="0.00" style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.red}33`,borderRadius:8,color:T.red,fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace"}} /></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Take Profit 1</div><input type="number" value={newTrade.tp1} onChange={e=>setNewTrade(p=>({...p,tp1:e.target.value}))} placeholder="0.00" style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.green}33`,borderRadius:8,color:T.green,fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace"}} /></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Take Profit 2</div><input type="number" value={newTrade.tp2} onChange={e=>setNewTrade(p=>({...p,tp2:e.target.value}))} placeholder="Opsiyonel" style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace"}} /></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Take Profit 3</div><input type="number" value={newTrade.tp3} onChange={e=>setNewTrade(p=>({...p,tp3:e.target.value}))} placeholder="Opsiyonel" style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace"}} /></div>
                </div>
              </div>

              {/* Tarihler */}
              <div style={{...st.card,borderLeft:`3px solid #8B5CF6`}}>
                <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:12,display:"flex",alignItems:"center",gap:8}}>📅 Tarihler</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Giriş Tarihi</div><input type="datetime-local" value={newTrade.entryDate} onChange={e=>setNewTrade(p=>({...p,entryDate:e.target.value}))} style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}} /></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Çıkış Tarihi</div><input type="datetime-local" value={newTrade.exitDate} onChange={e=>setNewTrade(p=>({...p,exitDate:e.target.value}))} style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}} /></div>
                </div>
              </div>

              {/* Notlar & Strateji */}
              <div style={{...st.card,borderLeft:`3px solid #F59E0B`}}>
                <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:12,display:"flex",alignItems:"center",gap:8}}>📝 Notlar & Strateji</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Strateji</div><select value={newTrade.strategy} onChange={e=>setNewTrade(p=>({...p,strategy:e.target.value}))} style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}}><option value="">Strateji seç...</option><option>Breakout</option><option>Pullback</option><option>Trend Following</option><option>Range</option><option>Scalp</option><option>Swing</option><option>News</option><option>Diger</option></select></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Etiketler</div><input value={newTrade.tags} onChange={e=>setNewTrade(p=>({...p,tags:e.target.value}))} placeholder="scalp, haber, kırılım" style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}} /></div>
                </div>
                <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Notlar</div><textarea value={newTrade.notes} onChange={e=>setNewTrade(p=>({...p,notes:e.target.value}))} placeholder="Trade sebebi, piyasa koşulları, öğrenilen dersler..." rows={3} style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none",resize:"vertical",fontFamily:"'Inter',sans-serif"}} /></div>
              </div>

              {/* Trade Analizi / Puanlama */}
              <div style={{...st.card,borderLeft:`3px solid #EC4899`}}>
                <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:12,display:"flex",alignItems:"center",gap:8}}>⭐ Trade Puanlama</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Genel Trade Puanı (1-10)</div><div style={{display:"flex",gap:4}}>{[1,2,3,4,5,6,7,8,9,10].map(n=><button key={n} onClick={()=>setNewTrade(p=>({...p,score:n}))} style={{width:30,height:30,borderRadius:6,border:`1px solid ${newTrade.score===n?T.accent+"66":T.border}`,background:newTrade.score===n?T.accentGlow:T.bgInput,color:newTrade.score===n?T.accent:T.textMuted,fontSize:12,fontWeight:700,cursor:"pointer"}}>{n}</button>)}</div></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Setup Kalitesi</div><div style={{display:"flex",gap:4}}>{["A+ Mükemmel","A İyi","B Orta","C Zayıf"].map(q=><button key={q} onClick={()=>setNewTrade(p=>({...p,setupQuality:q}))} style={{padding:"8px 12px",borderRadius:6,border:`1px solid ${newTrade.setupQuality===q?T.accent+"66":T.border}`,background:newTrade.setupQuality===q?T.accentGlow:T.bgInput,color:newTrade.setupQuality===q?T.accent:T.textMuted,fontSize:11,fontWeight:600,cursor:"pointer"}}>{q}</button>)}</div></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Execution Puanı (1-10)</div><div style={{display:"flex",gap:4}}>{[1,2,3,4,5,6,7,8,9,10].map(n=><button key={n} onClick={()=>setNewTrade(p=>({...p,execution:n}))} style={{width:30,height:30,borderRadius:6,border:`1px solid ${newTrade.execution===n?T.gold+"66":T.border}`,background:newTrade.execution===n?"#D4A01718":T.bgInput,color:newTrade.execution===n?T.gold:T.textMuted,fontSize:12,fontWeight:700,cursor:"pointer"}}>{n}</button>)}</div></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Plana Uyuldu mu?</div><div style={{display:"flex",gap:8}}>{[{v:true,l:"✓ Evet"},{v:false,l:"✕ Hayır"}].map(o=><button key={String(o.v)} onClick={()=>setNewTrade(p=>({...p,followedPlan:o.v}))} style={{flex:1,padding:"10px",borderRadius:8,border:`1px solid ${newTrade.followedPlan===o.v?(o.v?T.green:T.red)+"44":T.border}`,background:newTrade.followedPlan===o.v?(o.v?"#22C55E18":"#EF444418"):T.bgInput,color:newTrade.followedPlan===o.v?(o.v?T.green:T.red):T.textMuted,fontSize:13,fontWeight:600,cursor:"pointer"}}>{o.l}</button>)}</div></div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:12}}>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Duygu Durumu</div><select value={newTrade.emotion} onChange={e=>setNewTrade(p=>({...p,emotion:e.target.value}))} style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}}><option value="">Duygu seç...</option><option>Sakin</option><option>Heyecanlı</option><option>Korkulu</option><option>Açgözlü</option><option>Sabırsız</option><option>Kararsız</option><option>Güvenli</option></select></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Öğrenilen Dersler</div><input value={newTrade.lessons} onChange={e=>setNewTrade(p=>({...p,lessons:e.target.value}))} placeholder="Bu tradeden ne öğrendin?" style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}} /></div>
                </div>
              </div>

              {/* Kaydet */}
              <div style={{display:"flex",gap:12,justifyContent:"flex-end"}}>
                <button onClick={()=>{resetNewTrade();setEditTrade(null);setTradeView("list");}} style={{padding:"12px 24px",background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:10,color:T.textMuted,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>İptal</button>
                <button onClick={saveTrade} style={{padding:"12px 32px",background:"linear-gradient(135deg,#9333EA,#D4A017)",border:"none",borderRadius:10,color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'Inter',sans-serif",boxShadow:"0 4px 20px rgba(147,51,234,.25)"}}>{editTrade!==null?"Güncelle":"Trade Kaydet"}</button>
              </div>
            </div>
          </div>}

          {/* ═══ ANALYTICS ═══ */}
          {tradeView==="analytics"&&<div>
            {/* Özet Kartları */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
              <div style={{...st.card,borderLeft:`3px solid ${totalPnl>=0?T.green:T.red}`}}><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Toplam K/Z</div><div style={{fontSize:22,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:totalPnl>=0?T.green:T.red}}>${totalPnl.toFixed(2)}</div></div>
              <div style={{...st.card,borderLeft:`3px solid ${T.gold}`}}><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Kazanma Oranı</div><div style={{fontSize:22,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:T.gold}}>{winRate.toFixed(1)}%</div></div>
              <div style={{...st.card,borderLeft:`3px solid ${T.accent}`}}><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Profit Factor</div><div style={{fontSize:22,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:T.accent}}>{profitFactor.toFixed(2)}</div></div>
              <div style={{...st.card,borderLeft:`3px solid #8B5CF6`}}><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Toplam Trade</div><div style={{fontSize:22,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:"#8B5CF6"}}>{closedTrades.length}</div></div>
            </div>

            {/* Equity Eğrisi */}
            <div style={{...st.card,marginBottom:20}}>
              <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:12}}>Equity Eğrisi</div>
              {equityData.length>0?<ResponsiveContainer width="100%" height={260}>
                <AreaChart data={equityData}><defs><linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={T.accent} stopOpacity={0.3}/><stop offset="100%" stopColor={T.accent} stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke={T.border} /><XAxis dataKey="date" tick={{fontSize:10,fill:T.textMuted}} /><YAxis tick={{fontSize:10,fill:T.textMuted}} tickFormatter={v=>"$"+v} />
                <Tooltip contentStyle={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:8,fontSize:12}} />
                <Area type="monotone" dataKey="equity" stroke={T.accent} fill="url(#eqGrad)" strokeWidth={2} /></AreaChart>
              </ResponsiveContainer>:<div style={{padding:40,textAlign:"center",color:T.textMuted}}>Kapalı trade verisi yok</div>}
            </div>

            {/* Detay Kartları */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
              <div style={st.card}><div style={{fontSize:11,color:T.textMuted}}>En İyi Trade</div><div style={{fontSize:16,fontWeight:700,color:T.green,fontFamily:"'JetBrains Mono',monospace"}}>${closedTrades.length>0?Math.max(...closedTrades.map(t=>calcPnl(t))).toFixed(2):"0.00"}</div></div>
              <div style={st.card}><div style={{fontSize:11,color:T.textMuted}}>En Kötü Trade</div><div style={{fontSize:16,fontWeight:700,color:T.red,fontFamily:"'JetBrains Mono',monospace"}}>${closedTrades.length>0?Math.min(...closedTrades.map(t=>calcPnl(t))).toFixed(2):"0.00"}</div></div>
              <div style={st.card}><div style={{fontSize:11,color:T.textMuted}}>Ort. Kazanç</div><div style={{fontSize:16,fontWeight:700,color:T.green,fontFamily:"'JetBrains Mono',monospace"}}>${avgWin.toFixed(2)}</div></div>
              <div style={st.card}><div style={{fontSize:11,color:T.textMuted}}>Ort. Kayıp</div><div style={{fontSize:16,fontWeight:700,color:T.red,fontFamily:"'JetBrains Mono',monospace"}}>${avgLoss.toFixed(2)}</div></div>
              <div style={st.card}><div style={{fontSize:11,color:T.textMuted}}>Max Drawdown</div><div style={{fontSize:16,fontWeight:700,color:T.red,fontFamily:"'JetBrains Mono',monospace"}}>${maxDrawdown.toFixed(2)}</div></div>
              <div style={st.card}><div style={{fontSize:11,color:T.textMuted}}>Risk/Ödül</div><div style={{fontSize:16,fontWeight:700,color:T.accent,fontFamily:"'JetBrains Mono',monospace"}}>{avgLoss>0?(avgWin/avgLoss).toFixed(2):"0.00"}</div></div>
              <div style={st.card}><div style={{fontSize:11,color:T.textMuted}}>Beklenti</div><div style={{fontSize:16,fontWeight:700,color:T.gold,fontFamily:"'JetBrains Mono',monospace"}}>${closedTrades.length>0?(totalPnl/closedTrades.length).toFixed(2):"0.00"}</div></div>
              <div style={st.card}><div style={{fontSize:11,color:T.textMuted}}>Ort. Süre</div><div style={{fontSize:16,fontWeight:700,color:"#8B5CF6",fontFamily:"'JetBrains Mono',monospace"}}>{closedTrades.length>0?Math.round(closedTrades.reduce((s,t)=>{const d=t.exitDate&&t.entryDate?((new Date(t.exitDate)-new Date(t.entryDate))/3600000):0;return s+d;},0)/closedTrades.length)+"s":"0s"}</div></div>
            </div>
          </div>}

          {/* ═══ GOALS ═══ */}
          {tradeView==="goals"&&<div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
              <div style={{...st.card,borderLeft:`3px solid ${T.gold}`}}><div style={{fontSize:11,color:T.textMuted}}>Aktif Hedefler</div><div style={{fontSize:22,fontWeight:700,color:T.gold}}>{goals.filter(g=>g.status==="active").length}</div></div>
              <div style={{...st.card,borderLeft:`3px solid ${T.green}`}}><div style={{fontSize:11,color:T.textMuted}}>Tamamlanan</div><div style={{fontSize:22,fontWeight:700,color:T.green}}>{goals.filter(g=>g.status==="done").length}</div></div>
              <div style={{...st.card,borderLeft:`3px solid ${T.red}`}}><div style={{fontSize:11,color:T.textMuted}}>Duraklatılan</div><div style={{fontSize:22,fontWeight:700,color:T.red}}>{goals.filter(g=>g.status==="paused").length}</div></div>
              <div style={{...st.card,borderLeft:`3px solid #8B5CF6`}}><div style={{fontSize:11,color:T.textMuted}}>Toplam</div><div style={{fontSize:22,fontWeight:700,color:"#8B5CF6"}}>{goals.length}</div></div>
            </div>
            {goals.length===0?
              <div style={{...st.card,padding:60,textAlign:"center"}}><div style={{fontSize:40,marginBottom:12}}>◎</div><div style={{fontSize:16,fontWeight:600,color:T.text,marginBottom:4}}>Henüz hedef yok</div><div style={{fontSize:13,color:T.textMuted,marginBottom:16}}>Trading hedeflerini belirleyerek motivasyonunu artır</div><button onClick={()=>{const g={id:Date.now(),title:"",target:"",current:0,deadline:"",status:"active",type:"pnl"};setGoals(prev=>[...prev,g]);}} style={{padding:"10px 24px",background:"linear-gradient(135deg,#9333EA,#D4A017)",border:"none",borderRadius:8,color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>İlk Hedefini Oluştur</button></div>
            :
              <div style={{display:"grid",gap:12}}>{goals.map((g,i)=><div key={g.id} style={{...st.card,display:"flex",alignItems:"center",gap:16}}>
                <div style={{flex:1}}>
                  <input value={g.title} onChange={e=>{const u=[...goals];u[i]={...u[i],title:e.target.value};setGoals(u);}} placeholder="Hedef başlığı..." style={{background:"transparent",border:"none",color:T.text,fontSize:15,fontWeight:600,outline:"none",width:"100%",fontFamily:"'Inter',sans-serif"}} />
                  <div style={{display:"flex",gap:8,marginTop:6,alignItems:"center"}}>
                    <select value={g.status} onChange={e=>{const u=[...goals];u[i]={...u[i],status:e.target.value};setGoals(u);}} style={{padding:"4px 8px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:4,color:T.text,fontSize:11,outline:"none"}}><option value="active">Aktif</option><option value="done">Tamamlandı</option><option value="paused">Duraklatıldı</option></select>
                    <input type="date" value={g.deadline||""} onChange={e=>{const u=[...goals];u[i]={...u[i],deadline:e.target.value};setGoals(u);}} style={{padding:"4px 8px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:4,color:T.text,fontSize:11,outline:"none"}} />
                  </div>
                </div>
                <button onClick={()=>setGoals(prev=>prev.filter((_,j)=>j!==i))} style={{width:30,height:30,border:`1px solid ${T.red}33`,background:T.redGlow,color:T.red,borderRadius:6,cursor:"pointer",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
              </div>)}</div>
            }
            {goals.length>0&&<button onClick={()=>setGoals(prev=>[...prev,{id:Date.now(),title:"",target:"",current:0,deadline:"",status:"active",type:"pnl"}])} style={{marginTop:12,padding:"10px 20px",background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:8,color:T.accent,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>+ Yeni Hedef</button>}
          </div>}
        </div>}



        {tab==="reports"&&<div style={{animation:"fadeUp .4s ease-out"}}>
          {/* Report Actions */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16,marginBottom:24}}>
            <div style={{...st.card,padding:24,display:"flex",flexDirection:"column",alignItems:"center",textAlign:"center",gap:16,background:T.gradientHero,border:`1px solid ${T.accent}22`}}>
              <div style={{width:56,height:56,borderRadius:16,background:T.accentGlow,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>📊</div>
              <div>
                <div style={{fontSize:18,fontWeight:700,marginBottom:4,color:T.text}}>Yeni Rapor Oluştur</div>
                <div style={{fontSize:13,color:T.textSecondary,lineHeight:1.5}}>Portföyünüzün güncel durumunu içeren detaylı PDF rapor oluşturun</div>
              </div>
              <button onClick={generateReport} style={{padding:"12px 28px",background:"linear-gradient(135deg,#9333EA,#D4A017)",border:"none",borderRadius:10,color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'Inter',sans-serif",boxShadow:"0 4px 20px rgba(147,51,234,.25)"}}>📄 PDF Rapor Oluştur</button>
            </div>
            <div style={{...st.card,padding:24}}>
              <div style={{fontSize:14,fontWeight:600,color:T.text,marginBottom:16,display:"flex",alignItems:"center",gap:8}}>📈 Rapor Özeti</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <div style={{background:T.bgInput,borderRadius:10,padding:14,border:`1px solid ${T.border}`}}>
                  <div style={{fontSize:11,color:T.textSecondary,marginBottom:4}}>Toplam Rapor</div>
                  <div style={{fontSize:24,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:T.text}}>{reportHistory.length}</div>
                </div>
                <div style={{background:T.bgInput,borderRadius:10,padding:14,border:`1px solid ${T.border}`}}>
                  <div style={{fontSize:11,color:T.textSecondary,marginBottom:4}}>Son Rapor</div>
                  <div style={{fontSize:13,fontWeight:600,fontFamily:"'JetBrains Mono',monospace",color:T.text}}>{reportHistory.length>0?new Date(reportHistory[reportHistory.length-1].date).toLocaleDateString("tr-TR",{day:"2-digit",month:"short",year:"numeric"}):"—"}</div>
                </div>
                <div style={{background:T.bgInput,borderRadius:10,padding:14,border:`1px solid ${T.border}`}}>
                  <div style={{fontSize:11,color:T.textSecondary,marginBottom:4}}>Portföy Değeri</div>
                  <div style={{fontSize:13,fontWeight:600,fontFamily:"'JetBrains Mono',monospace",color:T.text}}>{fmt(allTotVal)}</div>
                </div>
                <div style={{background:T.bgInput,borderRadius:10,padding:14,border:`1px solid ${T.border}`}}>
                  <div style={{fontSize:11,color:T.textSecondary,marginBottom:4}}>Toplam K/Z</div>
                  <div style={{fontSize:13,fontWeight:600,fontFamily:"'JetBrains Mono',monospace",color:allTotPnl>=0?T.green:T.red}}>{allTotPnl>=0?"+":""}{fmt(allTotPnl)}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Report History */}
          <div style={st.card}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <h3 style={{fontSize:15,fontWeight:600,color:T.text}}>Rapor Geçmişi</h3>
              {reportHistory.length>0&&<button onClick={()=>{localStorage.removeItem("ip_report_history");setReportHistory([]);}} style={{background:T.redGlow,border:`1px solid ${T.red}33`,color:T.red,padding:"6px 14px",borderRadius:8,cursor:"pointer",fontSize:11,fontWeight:500,fontFamily:"'Inter',sans-serif"}}>Geçmişi Temizle</button>}
            </div>
            {reportHistory.length===0?
              <div style={{textAlign:"center",padding:48,color:T.textMuted}}>
                <div style={{fontSize:48,marginBottom:12,opacity:.5}}>📋</div>
                <div style={{fontSize:15,fontWeight:500,color:T.textSecondary,marginBottom:6}}>Henüz rapor oluşturulmamış</div>
                <div style={{fontSize:13,color:T.textMuted}}>Yukarıdaki butonu kullanarak ilk raporunuzu oluşturun</div>
              </div>:
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {[...reportHistory].reverse().map((r,i)=>{
                  const d=new Date(r.date);
                  return(<div key={i} style={{background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:10,padding:16,display:"flex",justifyContent:"space-between",alignItems:"center",transition:"border-color .2s"}}
                    onMouseEnter={e=>e.currentTarget.style.borderColor=T.accent+"44"} onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
                    <div>
                      <div style={{fontSize:14,fontWeight:600,color:T.text}}>{d.toLocaleDateString("tr-TR",{day:"2-digit",month:"long",year:"numeric"})}</div>
                      <div style={{fontSize:12,color:T.textSecondary,marginTop:3}}>{d.toLocaleTimeString("tr-TR",{hour:"2-digit",minute:"2-digit"})} • {r.assets||0} varlık{r.user?" • "+r.user:""}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:15,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:T.text}}>{fmt(r.totVal||0)}</div>
                      <div style={{fontSize:12,fontFamily:"'JetBrains Mono',monospace",color:(r.pnl||0)>=0?T.green:T.red,marginTop:2}}>{(r.pnl||0)>=0?"+":""}{fmt(r.pnl||0)} ({r.pnlPct!=null?fPct(r.pnlPct):"—"})</div>
                    </div>
                  </div>);
                })}
              </div>}
          </div>
        </div>}

      </main>

      {/* ═══ ADD/EDIT MODAL with CoinPicker ═══ */}
      {showAdd&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,backdropFilter:"blur(8px)"}} onClick={()=>{setShowAdd(false);setEditIdx(null);}}>
        <div style={{background:`linear-gradient(135deg,${T.bgCardSolid},${T.bgSecondary})`,border:`1px solid ${T.borderLight}`,borderRadius:16,width:"100%",maxWidth:480,boxShadow:"0 24px 64px rgba(0,0,0,.5)",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 20px",borderBottom:`1px solid ${T.border}`}}><h3 style={{fontSize:16,fontWeight:600}}>{editIdx!==null?"Varlığı Düzenle":"Yeni Varlık Ekle"}</h3><button style={{background:"none",border:"none",color:T.textMuted,fontSize:18,cursor:"pointer"}} onClick={()=>{setShowAdd(false);setEditIdx(null);}}>✕</button></div>
          <div style={{padding:20}}>
            {/* Coin Picker */}
            <div style={{marginBottom:16}}>
              <CoinPicker
                value={ncCoin?.id || ""}
                onChange={async (coin) => {
                  setNcCoin(coin);
                  setNcAmount("");
                  const p = prices[coin.id]?.usd;
                  if (p && p > 0) {
                    setNcBuyPrice(p < 1 ? p.toFixed(6) : p.toFixed(2));
                  } else {
                    setNcBuyPrice("yükleniyor...");
                    // Her zaman FMP'yi dene (stock + ETF + bilinmeyen)
                    const isStockLike = coin.isStock || coin.isFMP || isStock(coin.id) || coin.market === "us" || coin.market === "bist";
                    if (isStockLike || !coin.market || coin.market !== "crypto") {
                      try {
                        const FMP_KEY = "00rEssEWw276o3NRJY1BcLH1ACQGb1D6";
                        const sym = coin.id || coin.symbol;
                        const res = await fetch(`https://financialmodelingprep.com/api/v3/quote/${sym}?apikey=${FMP_KEY}`, { signal: AbortSignal.timeout(10000) });
                        if (res.ok) {
                          const data = await res.json();
                          if (data?.[0]?.price) {
                            const pr = data[0].price;
                            setNcBuyPrice(pr < 1 ? pr.toFixed(6) : pr.toFixed(2));
                            setPrices(prev => ({...prev, [coin.id]: { usd: pr, usd_24h_change: data[0].changesPercentage||0, usd_7d_change:0, usd_market_cap: data[0].marketCap||0, currency: coin.currency||"$", market: coin.market||"us" }}));
                            return;
                          }
                        }
                      } catch(e) {}
                    }
                    // Crypto — CoinGecko fallback
                    if (coin.market === "crypto" || (!coin.isStock && !coin.isFMP)) {
                      try {
                        const base = savedKey ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
                        const kp = savedKey ? `&x_cg_pro_api_key=${savedKey}` : "";
                        const res = await fetch(`${base}/simple/price?ids=${coin.id}&vs_currencies=usd&include_24hr_change=true${kp}`);
                        if (res.ok) {
                          const data = await res.json();
                          const usd = data[coin.id]?.usd;
                          if (usd) {
                            setNcBuyPrice(usd < 1 ? usd.toFixed(6) : usd.toFixed(2));
                            setPrices(prev => ({...prev, [coin.id]: {usd, usd_24h_change: data[coin.id]?.usd_24h_change||0, usd_7d_change:0, usd_market_cap:0}}));
                            return;
                          }
                        }
                      } catch(e) {}
                    }
                    setNcBuyPrice("");
                  }
                }}
                prices={prices}
                savedKey={savedKey}
                knownCoins={knownCoins}
                fmpStocks={fmpStocks}
              />
            </div>

            {ncCoin && <div style={{background:T.bg,borderRadius:10,padding:14,marginBottom:16,border:"1px solid #9333EA22"}}>
              <div style={{fontSize:10,color:"#9333EA",textTransform:"uppercase",letterSpacing:1,marginBottom:8,fontWeight:600}}>✓ Seçilen Coin</div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:36,height:36,borderRadius:8,background:"#9333EA15",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:700,fontFamily:"'Inter',monospace",color:"#9333EA"}}>{ncCoin.symbol?.charAt(0)}</div>
                <div><div style={{fontSize:14,fontWeight:600,color:T.text}}>{ncCoin.name}</div><div style={{fontSize:11,color:T.textMuted,fontFamily:"'JetBrains Mono',monospace"}}>{ncCoin.symbol}</div></div>
                {prices[ncCoin.id]&&<div style={{marginLeft:"auto",textAlign:"right"}}><div style={{fontSize:14,fontFamily:"'JetBrains Mono',monospace",color:T.green,fontWeight:600}}>{fmt(prices[ncCoin.id].usd,prices[ncCoin.id].usd<1?4:2)}</div><div style={{fontSize:10,color:prices[ncCoin.id]?.usd_24h_change>=0?`${T.green}aa`:`${T.red}aa`}}>{fPct(prices[ncCoin.id]?.usd_24h_change||0)}</div></div>}
              </div>
            </div>}

            {/* ── Section 2: Kategori Seçimi ── */}
            <div style={{marginBottom:16}}>
              <div style={{fontSize:10,color:T.textSecondary,textTransform:"uppercase",letterSpacing:1,marginBottom:10,fontWeight:600,borderBottom:`1px solid ${T.border}`,paddingBottom:6}}>Kategori</div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:8}}>
                {sections.map(s=>(
                  <button key={s} onClick={()=>setNcSection(s)}
                    style={{padding:"5px 12px",borderRadius:6,border:`1px solid ${ncSection===s?"#9333EA44":T.borderLight}`,background:ncSection===s?"#9333EA15":T.bgInput,color:ncSection===s?"#9333EA":T.textSecondary,fontSize:11,cursor:"pointer",fontFamily:"'Inter',sans-serif",fontWeight:ncSection===s?600:400,transition:"all .15s"}}>
                    {s}
                  </button>
                ))}
              </div>
              <div style={{display:"flex",gap:6}}>
                <input value={newSectionInput} onChange={e=>setNewSectionInput(e.target.value)}
                  onKeyDown={e=>{if(e.key==="Enter"&&newSectionInput.trim()&&!sections.includes(newSectionInput.trim())){setSections(p=>[...p,newSectionInput.trim()]);setNcSection(newSectionInput.trim());setNewSectionInput("");}}}
                  placeholder="Yeni kategori ekle..."
                  style={{flex:1,padding:"6px 10px",background:T.bgInput,border:`1px solid ${T.borderLight}`,borderRadius:6,color:T.text,fontSize:12,outline:"none",fontFamily:"'Inter',sans-serif"}}/>
                <button onClick={()=>{if(newSectionInput.trim()&&!sections.includes(newSectionInput.trim())){setSections(p=>[...p,newSectionInput.trim()]);setNcSection(newSectionInput.trim());setNewSectionInput("");}}}
                  style={{padding:"6px 12px",background:T.bgCardSolid,border:`1px solid ${T.borderLight}`,borderRadius:6,color:T.textSecondary,fontSize:11,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>+</button>
              </div>
            </div>

            {/* ── Section 3: İşlem Bilgileri ── */}
            <div style={{marginBottom:16}}>
              <div style={{fontSize:10,color:T.textSecondary,textTransform:"uppercase",letterSpacing:1,marginBottom:10,fontWeight:600,borderBottom:`1px solid ${T.border}`,paddingBottom:6}}>İşlem Bilgileri</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <div>
                  <label style={{display:"block",fontSize:11,color:T.textSecondary,marginBottom:6,fontWeight:500}}>Miktar</label>
                  <input type="number" step="any" placeholder="örn: 0.5" value={ncAmount} onChange={e=>setNcAmount(e.target.value)} style={{width:"100%",padding:"11px 12px",background:T.bgInput,border:`1px solid ${T.borderLight}`,borderRadius:8,color:T.text,fontSize:14,outline:"none",fontFamily:"'JetBrains Mono',monospace"}}/>
                </div>
                <div>
                  <label style={{display:"block",fontSize:11,color:T.textSecondary,marginBottom:6,fontWeight:500}}>Alış Fiyatı ($)</label>
                  <input type="number" step="any" placeholder="örn: 65000" value={ncBuyPrice} onChange={e=>setNcBuyPrice(e.target.value)} style={{width:"100%",padding:"11px 12px",background:T.bgInput,border:`1px solid ${T.borderLight}`,borderRadius:8,color:T.text,fontSize:14,outline:"none",fontFamily:"'JetBrains Mono',monospace"}}/>
                </div>
              </div>
              {ncCoin && prices[ncCoin.id] && <div style={{marginTop:8,fontSize:11,color:T.textMuted}}>Güncel fiyat: <span style={{color:"#9333EA",fontFamily:"'JetBrains Mono',monospace"}}>{fmt(prices[ncCoin.id].usd,prices[ncCoin.id].usd<1?6:2)}</span></div>}
            </div>

            {/* ── Section 3: Hesap Özeti ── */}
            {ncCoin&&ncAmount&&ncBuyPrice&&<div style={{marginBottom:16}}>
              <div style={{fontSize:10,color:T.textSecondary,textTransform:"uppercase",letterSpacing:1,marginBottom:10,fontWeight:600,borderBottom:`1px solid ${T.border}`,paddingBottom:6}}>Hesap Özeti</div>
              <div style={{background:T.bgInput,borderRadius:10,padding:14,border:`1px solid ${T.border}`}}>
                {[
                  ["Toplam Maliyet", fmt(ncAmount*ncBuyPrice), T.textSecondary],
                  ["Güncel Değer", fmt(ncAmount*(prices[ncCoin.id]?.usd||0)), T.text],
                  ["Tahmini K/Z", (()=>{const pnl=ncAmount*((prices[ncCoin.id]?.usd||0)-ncBuyPrice);return {text:(pnl>=0?"+":"")+fmt(Math.abs(pnl))+" ("+fPct(ncBuyPrice>0?((prices[ncCoin.id]?.usd||0)/ncBuyPrice-1)*100:0)+")",color:pnl>=0?T.green:T.red};})(), null],
                ].map(([l,v,c],i)=>{
                  const isKZ = l==="Tahmini K/Z";
                  return <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",fontSize:13,borderBottom:i<2?`1px solid ${T.bgCardSolid}`:"none"}}>
                    <span style={{color:T.textMuted}}>{l}</span>
                    <span style={{fontWeight:isKZ?700:600,fontFamily:"'JetBrains Mono',monospace",color:isKZ?v.color:c}}>{isKZ?v.text:v}</span>
                  </div>;
                })}
              </div>
            </div>}

            {/* ── Section 4: Portföy Seçimi ── */}
            {Object.keys(portfolios).length>1&&<div style={{marginBottom:16}}>
              <div style={{fontSize:10,color:T.textSecondary,textTransform:"uppercase",letterSpacing:1,marginBottom:10,fontWeight:600,borderBottom:`1px solid ${T.border}`,paddingBottom:6}}>Eklenecek Portföy</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {Object.keys(portfolios).map(name=>(
                  <button key={name} onClick={()=>setActivePortfolio(name)}
                    style={{padding:"6px 14px",borderRadius:6,border:`1px solid ${activePortfolio===name?"#9333EA44":T.borderLight}`,background:activePortfolio===name?"#9333EA11":T.bgInput,color:activePortfolio===name?"#9333EA":T.textSecondary,fontSize:12,cursor:"pointer",fontFamily:"'Inter',sans-serif",fontWeight:activePortfolio===name?600:400}}>
                    {name}
                  </button>
                ))}
              </div>
            </div>}

            <button onClick={addCoin} disabled={!ncCoin||!ncAmount||!ncBuyPrice} style={{width:"100%",padding:13,background:"linear-gradient(135deg,#9333EA,#D4A017)",border:"none",borderRadius:10,color:T.text,fontSize:15,fontWeight:600,cursor:"pointer",fontFamily:"'Inter',sans-serif",opacity:ncCoin&&ncAmount&&ncBuyPrice?1:.5,boxShadow:"0 4px 20px rgba(247,147,26,.2)"}}>{editIdx!==null?"Güncelle":"Portföye Ekle"}</button>
          </div>
        </div>
      </div>}

      {/* Delete Confirm */}
      {delConfirm!==null&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,backdropFilter:"blur(8px)"}} onClick={()=>setDelConfirm(null)}>
        <div style={{background:`linear-gradient(135deg,${T.bgCardSolid},${T.bgSecondary})`,border:`1px solid ${T.borderLight}`,borderRadius:16,width:"100%",maxWidth:380,boxShadow:"0 24px 64px rgba(0,0,0,.5)"}} onClick={e=>e.stopPropagation()}>
          <div style={{padding:30,textAlign:"center"}}>
            <div style={{fontSize:40,marginBottom:12}}>⚠️</div>
            <div style={{fontSize:16,fontWeight:600,marginBottom:8}}>Silmek istediğinize emin misiniz?</div>
            <div style={{color:T.textSecondary,fontSize:13,marginBottom:20}}>{pData[delConfirm]?.coin?.name} kaldırılacak.</div>
            <div style={{display:"flex",gap:10,justifyContent:"center"}}>
              <button onClick={()=>setDelConfirm(null)} style={{padding:"10px 24px",background:T.bgCardSolid,border:`1px solid ${T.borderLight}`,borderRadius:8,color:T.textSecondary,fontSize:13,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>İptal</button>
              <button onClick={()=>{setPortfolio(p=>p.filter((_,j)=>j!==delConfirm));setDelConfirm(null);}} style={{padding:"10px 24px",background:`linear-gradient(135deg,${T.red},#DC2626)`,border:"none",borderRadius:8,color:T.text,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>Sil</button>
            </div>
          </div>
        </div>
      </div>}

      <Settings show={showSettings} onClose={()=>setShowSettings(false)} apiKey={apiKey} onKeyChange={setApiKey} onSave={saveKey} keyStatus={keyStatus}/>

      {/* PDF Preview Modal */}
      {pdfPreviewUrl&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:1000,display:"flex",flexDirection:"column",animation:"fadeUp .3s ease-out"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 20px",background:T.bgCardSolid,borderBottom:`1px solid ${T.border}`}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:18}}>📄</span>
            <span style={{fontSize:14,fontWeight:600,color:T.text}}>Portföy Raporu</span>
            <span style={{fontSize:11,color:T.textMuted}}>{new Date().toLocaleDateString("tr-TR",{day:"2-digit",month:"long",year:"numeric"})}</span>
          </div>
          <div style={{display:"flex",gap:8}}>
            <a href={pdfPreviewUrl} download={"InvestPulse_Rapor_"+new Date().getFullYear()+"_"+String(new Date().getMonth()+1).padStart(2,"0")+".pdf"} style={{background:T.green,color:"#0B0D15",padding:"8px 16px",borderRadius:8,fontSize:12,fontWeight:600,textDecoration:"none",display:"flex",alignItems:"center",gap:4}}>⬇ İndir</a>
            <button onClick={()=>{URL.revokeObjectURL(pdfPreviewUrl);setPdfPreviewUrl(null);}} style={{background:T.redGlow,border:`1px solid ${T.red}33`,color:T.red,padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>✕ Kapat</button>
          </div>
        </div>
        <iframe src={pdfPreviewUrl} style={{flex:1,border:"none",background:"#fff"}} title="PDF Preview"/>
      </div>}

      <style>{animations + `body{background:${T.bg};transition:background .3s}`}</style>
    </div>
  );
}

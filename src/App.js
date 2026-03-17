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
    <div style={{minHeight:"100vh",background:"#060812",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center"}}>
        <svg width="48" height="48" viewBox="0 0 80 80" style={{marginBottom:16,animation:"spin 2s linear infinite"}}>
          <circle cx="40" cy="40" r="35" fill="none" stroke="#9333EA22" strokeWidth="3"/>
          <circle cx="40" cy="40" r="35" fill="none" stroke="#9333EA" strokeWidth="3" strokeDasharray="60 160" strokeLinecap="round"/>
        </svg>
        <div style={{color:"#4A4D65",fontSize:14,fontFamily:"'Inter',sans-serif"}}>Yükleniyor...</div>
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
        e.code === "auth/too-many-requests" ? "Çok fazla deneme, lütfen bekleyin" :
        e.code === "auth/invalid-email" ? "Geçersiz e-posta adresi" : "Giriş hatası";
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
        e.code === "auth/weak-password" ? "Şifre çok zayıf (min. 6 karakter)" :
        e.code === "auth/invalid-email" ? "Geçersiz e-posta" : "Kayıt hatası";
      setError(msg);
    }
    setLoading(false);
  };

  const handleGoogleLogin = async () => {
    setLoading(true); setError("");
    try {
      const cred = await loginWithGoogle();
      await saveUserData(cred.user.uid, { name: cred.user.displayName || "Kullanıcı", email: cred.user.email, loginMethod: "google", lastLogin: new Date().toISOString() });
    } catch (e) { if (e.code !== "auth/popup-closed-by-user") setError("Google giriş hatası"); }
    setLoading(false);
  };

  const handleGuestLogin = async () => {
    setLoading(true); setError("");
    try { await loginAsGuest(); } catch (e) { setError("Misafir giriş hatası"); }
    setLoading(false);
  };

  const handleForgot = async () => {
    if (!email.trim()) { setError("E-posta adresinizi girin"); return; }
    setLoading(true); setError("");
    try {
      await resetPassword(email.trim());
      setSuccess("Sıfırlama e-postası gönderildi!");
      setTimeout(() => { setMode("login"); setSuccess(""); }, 3000);
    } catch (e) { setError(e.code === "auth/user-not-found" ? "Hesap bulunamadı" : "Hata oluştu"); }
    setLoading(false);
  };

  const inp = (icon, val, set, ph, type="text", onKey=null) => (
    <div style={{position:"relative",marginBottom:14}}>
      <span style={{position:"absolute",left:16,top:"50%",transform:"translateY(-50%)",fontSize:15,opacity:.4}}>{icon}</span>
      <input type={type==="password"?(showPass?"text":"password"):type} value={val}
        onChange={e=>{set(e.target.value);setError("");}}
        onKeyDown={e=>e.key==="Enter"&&onKey&&onKey()}
        onFocus={e=>{e.target.style.borderColor="#9333EA";e.target.style.boxShadow="0 0 0 3px rgba(147,51,234,.1)";}}
        onBlur={e=>{e.target.style.borderColor="#1a1d2e";e.target.style.boxShadow="none";}}
        placeholder={ph} style={{width:"100%",padding:"14px 14px 14px 46px",background:"rgba(255,255,255,.03)",border:"1.5px solid #1a1d2e",borderRadius:12,color:"#E8E9ED",fontSize:14,outline:"none",fontFamily:"'Inter',sans-serif",transition:"all .25s ease"}}/>
      {type==="password"&&<span onClick={()=>setShowPass(!showPass)} style={{position:"absolute",right:16,top:"50%",transform:"translateY(-50%)",cursor:"pointer",fontSize:13,opacity:.4,userSelect:"none"}}>{showPass?"◉":"◎"}</span>}
    </div>
  );

  const features = [
    {ic:"📊",t:"Portföy Takibi",d:"Kripto, BIST, ABD hisseleri"},
    {ic:"📈",t:"Trade Journal",d:"Profesyonel trade günlüğü"},
    {ic:"🔒",t:"Güvenli",d:"Firebase ile şifreli depolama"},
    {ic:"📱",t:"Her Cihazda",d:"Bulut senkronizasyon"}
  ];

  return (
    <div style={{minHeight:"100vh",background:"#060812",display:"flex",fontFamily:"'Inter',sans-serif",overflow:"hidden"}}>
      {/* Sol - Hero */}
      <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",padding:"40px 60px",position:"relative"}}>
        {/* Animated background */}
        <div style={{position:"absolute",inset:0,overflow:"hidden"}}>
          <div style={{position:"absolute",width:500,height:500,borderRadius:"50%",background:"radial-gradient(circle,rgba(147,51,234,.12) 0%,transparent 70%)",top:"-10%",left:"-5%",filter:"blur(80px)",animation:"float 8s ease-in-out infinite"}}/>
          <div style={{position:"absolute",width:400,height:400,borderRadius:"50%",background:"radial-gradient(circle,rgba(212,160,23,.08) 0%,transparent 70%)",bottom:"-5%",right:"10%",filter:"blur(60px)",animation:"float 10s ease-in-out infinite reverse"}}/>
          <div style={{position:"absolute",width:300,height:300,borderRadius:"50%",background:"radial-gradient(circle,rgba(59,130,246,.06) 0%,transparent 70%)",top:"40%",right:"-5%",filter:"blur(50px)",animation:"float 12s ease-in-out infinite"}}/>
          <div style={{position:"absolute",inset:0,opacity:.02,backgroundImage:"radial-gradient(circle at 1px 1px, #9333EA 0.5px, transparent 0)",backgroundSize:"48px 48px"}}/>
        </div>

        <div style={{position:"relative",zIndex:1,maxWidth:440,width:"100%"}}>
          {/* Logo */}
          <div style={{marginBottom:40}}>
            <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:24}}>
              <div style={{width:52,height:52,borderRadius:14,background:"linear-gradient(135deg,#9333EA20,#D4A01720)",border:"1px solid #9333EA22",display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(10px)"}}>
                <svg width="28" height="28" viewBox="0 0 80 80"><defs><linearGradient id="lGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#9333EA"/><stop offset="100%" stopColor="#D4A017"/></linearGradient></defs><path d="M20 50 L32 32 L48 42 L62 18" fill="none" stroke="url(#lGrad)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/><circle cx="62" cy="18" r="4" fill="#D4A017"/></svg>
              </div>
              <div>
                <div style={{fontSize:26,fontWeight:800,letterSpacing:"-.5px",background:"linear-gradient(135deg,#C084FC,#D4A017)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>InvestPulse</div>
                <div style={{fontSize:12,color:"#4A4D65",letterSpacing:"2px",textTransform:"uppercase",marginTop:2}}>Trading & Portföy</div>
              </div>
            </div>
            <h1 style={{fontSize:36,fontWeight:800,color:"#E8E9ED",lineHeight:1.2,marginBottom:12,letterSpacing:"-.5px"}}>Yatırımlarını<br/><span style={{background:"linear-gradient(135deg,#9333EA,#D4A017)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>tek yerden</span> yönet.</h1>
            <p style={{fontSize:15,color:"#6B6F8A",lineHeight:1.7}}>Kripto, hisse, BIST ve TEFAS portföyünü takip et. Trade günlüğü tut, performansını analiz et.</p>
          </div>

          {/* Feature pills */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {features.map(f=>(
              <div key={f.t} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",background:"rgba(255,255,255,.02)",border:"1px solid #12141E",borderRadius:12,transition:"border-color .2s"}}
                onMouseEnter={e=>e.currentTarget.style.borderColor="#9333EA22"} onMouseLeave={e=>e.currentTarget.style.borderColor="#12141E"}>
                <span style={{fontSize:20}}>{f.ic}</span>
                <div><div style={{fontSize:12,fontWeight:600,color:"#C8CAD4"}}>{f.t}</div><div style={{fontSize:10,color:"#4A4D65"}}>{f.d}</div></div>
              </div>
            ))}
          </div>

          {/* Stats */}
          <div style={{display:"flex",gap:32,marginTop:32}}>
            {[["8,000+","Hisse & ETF"],["800+","Kripto"],["516","BIST"],["Gerçek Zamanlı","Fiyatlar"]].map(([n,l])=>(
              <div key={l}>
                <div style={{fontSize:18,fontWeight:800,fontFamily:"'JetBrains Mono',monospace",background:"linear-gradient(135deg,#C084FC,#D4A017)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>{n}</div>
                <div style={{fontSize:10,color:"#3D4058",textTransform:"uppercase",letterSpacing:1,marginTop:2}}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{position:"absolute",bottom:20,left:60,fontSize:11,color:"#1E2035"}}>© 2026 InvestPulse — Tüm hakları saklıdır</div>
      </div>

      {/* Sağ - Auth Form */}
      <div style={{width:440,display:"flex",alignItems:"center",justifyContent:"center",padding:"40px 36px",background:"rgba(8,10,18,.8)",borderLeft:"1px solid #12141E",backdropFilter:"blur(20px)"}}>
        <div style={{width:"100%",maxWidth:360}}>
          {/* Tab switch */}
          <div style={{display:"flex",gap:0,background:"#0C0E18",borderRadius:12,padding:4,marginBottom:28,border:"1px solid #12141E"}}>
            {[["login","Giriş Yap"],["register","Kayıt Ol"]].map(([m,l])=>(
              <button key={m} onClick={()=>{setMode(m);setError("");setSuccess("");}}
                style={{flex:1,padding:"11px",borderRadius:9,border:"none",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Inter',sans-serif",transition:"all .3s",
                  background:mode===m?"linear-gradient(135deg,rgba(147,51,234,.15),rgba(212,160,23,.1))":"transparent",
                  color:mode===m?"#C084FC":"#4A4D65",
                  boxShadow:mode===m?"0 2px 12px rgba(147,51,234,.1)":"none"}}>{l}</button>
            ))}
          </div>

          {/* Login Form */}
          {mode==="login"&&<>
            <div style={{marginBottom:24}}>
              <h2 style={{fontSize:22,fontWeight:700,color:"#E8E9ED",marginBottom:6}}>Hoş Geldiniz</h2>
              <p style={{fontSize:13,color:"#4A4D65",margin:0}}>Hesabınıza giriş yapın</p>
            </div>
            {inp("✉",email,setEmail,"E-posta adresi","email",handleLogin)}
            {inp("🔒",password,setPassword,"Şifre","password",handleLogin)}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,marginTop:-4}}>
              <label onClick={()=>setRememberMe(!rememberMe)} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12,color:"#4A4D65"}}>
                <div style={{width:16,height:16,borderRadius:4,border:"1.5px solid "+(rememberMe?"#9333EA":"#1E2035"),background:rememberMe?"#9333EA15":"transparent",display:"flex",alignItems:"center",justifyContent:"center",transition:"all .2s"}}>
                  {rememberMe&&<span style={{color:"#9333EA",fontSize:10,fontWeight:700}}>✓</span>}
                </div>
                Beni hatırla
              </label>
              <span onClick={()=>{setMode("forgot");setError("");}} style={{fontSize:12,color:"#9333EA",cursor:"pointer",fontWeight:500}}>Şifremi unuttum</span>
            </div>
          </>}

          {/* Register Form */}
          {mode==="register"&&<>
            <div style={{marginBottom:24}}>
              <h2 style={{fontSize:22,fontWeight:700,color:"#E8E9ED",marginBottom:6}}>Hesap Oluştur</h2>
              <p style={{fontSize:13,color:"#4A4D65",margin:0}}>Ücretsiz başlayın, kart gerekmez</p>
            </div>
            {inp("👤",username,setUsername,"Kullanıcı adı")}
            {inp("✉",email,setEmail,"E-posta adresi","email")}
            {inp("🔒",password,setPassword,"Şifre (min. 6 karakter)","password")}
            {inp("🔒",confirmPass,setConfirmPass,"Şifre tekrar","password",handleRegister)}
          </>}

          {/* Forgot Form */}
          {mode==="forgot"&&<>
            <div style={{marginBottom:24}}>
              <h2 style={{fontSize:22,fontWeight:700,color:"#E8E9ED",marginBottom:6}}>Şifre Sıfırlama</h2>
              <p style={{fontSize:13,color:"#4A4D65",margin:0}}>E-postanıza sıfırlama linki göndereceğiz</p>
            </div>
            {inp("✉",email,setEmail,"E-posta adresi","email",handleForgot)}
            <span onClick={()=>{setMode("login");setError("");}} style={{fontSize:12,color:"#9333EA",cursor:"pointer",fontWeight:500}}>← Giriş ekranına dön</span>
            <div style={{height:12}}/>
          </>}

          {/* Error / Success */}
          {error&&<div style={{padding:"10px 14px",background:"rgba(239,68,68,.06)",border:"1px solid rgba(239,68,68,.15)",borderRadius:10,color:"#F87171",fontSize:12,marginBottom:14,display:"flex",alignItems:"center",gap:8,animation:"fadeUp .3s ease-out"}}><span>⚠</span>{error}</div>}
          {success&&<div style={{padding:"10px 14px",background:"rgba(34,197,94,.06)",border:"1px solid rgba(34,197,94,.15)",borderRadius:10,color:"#4ADE80",fontSize:12,marginBottom:14,display:"flex",alignItems:"center",gap:8,animation:"fadeUp .3s ease-out"}}><span>✓</span>{success}</div>}

          {/* Submit button */}
          <button onClick={mode==="login"?handleLogin:mode==="register"?handleRegister:handleForgot} disabled={loading}
            style={{width:"100%",padding:"14px",background:loading?"#2A1545":"linear-gradient(135deg,#9333EA,#7C3AED)",border:"none",borderRadius:12,color:"#fff",fontSize:14,fontWeight:600,cursor:loading?"wait":"pointer",fontFamily:"'Inter',sans-serif",transition:"all .3s",boxShadow:"0 4px 24px rgba(147,51,234,.3)",opacity:loading?.6:1,letterSpacing:".3px",position:"relative",overflow:"hidden"}}>
            {loading?<span style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8}}><svg width="16" height="16" viewBox="0 0 24 24" style={{animation:"spin 1s linear infinite"}}><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="30 60" strokeLinecap="round"/></svg>İşleniyor...</span>:mode==="login"?"Giriş Yap":mode==="register"?"Hesap Oluştur":"Sıfırlama Linki Gönder"}
          </button>

          {/* Divider + Social */}
          {mode!=="forgot"&&<>
            <div style={{display:"flex",alignItems:"center",gap:16,margin:"22px 0"}}>
              <div style={{flex:1,height:1,background:"linear-gradient(90deg,transparent,#1E2035)"}}/>
              <span style={{fontSize:11,color:"#3D4058",textTransform:"uppercase",letterSpacing:1}}>veya</span>
              <div style={{flex:1,height:1,background:"linear-gradient(90deg,#1E2035,transparent)"}}/>
            </div>

            <button onClick={handleGoogleLogin} disabled={loading}
              style={{width:"100%",padding:"12px",background:"rgba(255,255,255,.03)",border:"1.5px solid #1a1d2e",borderRadius:12,color:"#C8CAD4",fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"'Inter',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:8,transition:"all .25s"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor="#9333EA44";e.currentTarget.style.background="rgba(147,51,234,.04)";}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor="#1a1d2e";e.currentTarget.style.background="rgba(255,255,255,.03)";}}>
              <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              Google ile devam et
            </button>

            <button onClick={handleGuestLogin} disabled={loading}
              style={{width:"100%",padding:"12px",background:"transparent",border:"1.5px solid #12141E",borderRadius:12,color:"#4A4D65",fontSize:12,fontWeight:500,cursor:"pointer",fontFamily:"'Inter',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:8,transition:"all .25s"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor="#1E2035";e.currentTarget.style.color="#6B6F8A";}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor="#12141E";e.currentTarget.style.color="#4A4D65";}}>
              Misafir olarak göz at
            </button>
          </>}

          <div style={{textAlign:"center",marginTop:20,fontSize:11,color:"#1E2035"}}>Giriş yaparak kullanım koşullarını kabul edersiniz</div>
        </div>
      </div>

      <style>{animations + `
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-20px)} }
        @media(max-width:900px){
          div[style*="flex:1"]{display:none!important}
          div[style*="width:440"]{width:100%!important;border-left:none!important}
        }
      `}</style>
    </div>
  );
};

// ═══════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════
export default function CryptoPortfolio() {
  const [showSplash, setShowSplash] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const firebaseUserRef = useRef(null);
  const dataLoadedRef = useRef(false);
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
  const [newsFilter, setNewsFilter] = useState("portfolio");
  const [symResults, setSymResults] = useState([]);
  const [symOpen, setSymOpen] = useState(false);
  const [newsData, setNewsData] = useState([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsLoaded, setNewsLoaded] = useState(false);
  // ═══ TRADE JOURNAL STATE ═══
  const [trades, setTrades] = useState(() => { try { return JSON.parse(localStorage.getItem("ip_trades") || "[]"); } catch(e) { return []; } });
  const [tradeView, setTradeView] = useState("list"); // list | add | analytics | goals
  const [tradeFilter, setTradeFilter] = useState("all"); // all | open | closed | win | loss
  const [tradeSearch, setTradeSearch] = useState("");
  const [tradeKasa, setTradeKasa] = useState(() => { try { return parseFloat(localStorage.getItem("ip_trade_kasa") || "5000"); } catch(e) { return 5000; } });
  const [tradeR, setTradeR] = useState(() => { try { return parseFloat(localStorage.getItem("ip_trade_r") || "100"); } catch(e) { return 100; } });
  const [entryCount, setEntryCount] = useState(3);
  const [screenshotPasteActive, setScreenshotPasteActive] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState("");
  const [toasts, setToasts] = useState([]);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState("");
  const [priceAlerts, setPriceAlerts] = useState(() => { try { return JSON.parse(localStorage.getItem("ip_price_alerts") || "[]"); } catch(e) { return []; } });
  const [bulkSelected, setBulkSelected] = useState([]);
  const [tradeDraft, setTradeDraft] = useState(null);
  const [tradeTemplates, setTradeTemplates] = useState(() => { try { return JSON.parse(localStorage.getItem("ip_trade_templates") || "[]"); } catch(e) { return []; } });
  const [calendarMonth, setCalendarMonth] = useState(() => { const d=new Date(); return {y:d.getFullYear(),m:d.getMonth()}; });
  const [goals, setGoals] = useState(() => { try { return JSON.parse(localStorage.getItem("ip_goals") || "[]"); } catch(e) { return []; } });
  const [editTrade, setEditTrade] = useState(null);
  const [newTrade, setNewTrade] = useState({symbol:"",market:"Kripto",exchange:"Bybit",direction:"Long",status:"Acik",leverage:"1x",entryPrice:"",exitPrice:"",amount:"100",stopLoss:"",rAmount:"",screenshot:"",tp1:"",tp1Amount:"",tp2:"",tp2Amount:"",tp3:"",tp3Amount:"",entry1Price:"",entry1Amount:"",entry2Price:"",entry2Amount:"",entry3Price:"",entry3Amount:"",entryDate:new Date().toISOString().slice(0,16),exitDate:"",strategy:"",tags:"",notes:"",score:5,setupQuality:"B Orta",execution:5,followedPlan:true,setupType:"",emotion:"",mistakes:"",successes:"",lessons:""});

  // Trade localStorage sync
  useEffect(() => { try { localStorage.setItem("ip_trades", JSON.stringify(trades)); } catch(e) {} }, [trades]);
  useEffect(() => { try { localStorage.setItem("ip_trade_kasa", String(tradeKasa)); } catch(e) {} }, [tradeKasa]);
  useEffect(() => { try { localStorage.setItem("ip_trade_r", String(tradeR)); } catch(e) {} }, [tradeR]);
  useEffect(() => { try { localStorage.setItem("ip_trade_templates", JSON.stringify(tradeTemplates)); } catch(e) {} }, [tradeTemplates]);
  useEffect(() => { try { localStorage.setItem("ip_price_alerts", JSON.stringify(priceAlerts)); } catch(e) {} }, [priceAlerts]);
  useEffect(() => {
    if (tradeView === "add" && (newTrade.symbol || newTrade.entryPrice)) {
      setTradeDraft(newTrade);
    }
  }, [newTrade, tradeView]); // eslint-disable-line
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
  const tradeVolume = trades.reduce((s,t) => s + parseFloat(t.amount||0), 0);
  const openTrades = trades.filter(t => t.status==="Acik");
  const avgDuration = closedTrades.length>0 ? Math.round(closedTrades.reduce((s,t)=>{
    return s + (t.exitDate&&t.entryDate ? (new Date(t.exitDate)-new Date(t.entryDate))/3600000 : 0);
  },0)/closedTrades.length) : 0;
  const tradesByMarket = trades.reduce((acc,t)=>{ acc[t.market||"Kripto"]=(acc[t.market||"Kripto"]||0)+1; return acc; },{});
  const longCount = trades.filter(t=>t.direction==="Long").length;
  const shortCount = trades.filter(t=>t.direction==="Short").length;
  const monthlyPnlData = (()=>{ const mp={}; closedTrades.forEach(t=>{ const m=new Date(t.exitDate||t.entryDate).toLocaleDateString("tr-TR",{month:"short",year:"2-digit"}); mp[m]=(mp[m]||0)+calcPnl(t); }); return Object.entries(mp).map(([month,pnl])=>({month,pnl:+pnl.toFixed(2)})); })();

  const resetNewTrade = () => setNewTrade({symbol:"",market:"Kripto",exchange:"Bybit",direction:"Long",status:"Acik",leverage:"1x",entryPrice:"",exitPrice:"",amount:"100",stopLoss:"",rAmount:"",screenshot:"",tp1:"",tp1Amount:"",tp2:"",tp2Amount:"",tp3:"",tp3Amount:"",entry1Price:"",entry1Amount:"",entry2Price:"",entry2Amount:"",entry3Price:"",entry3Amount:"",entryDate:new Date().toISOString().slice(0,16),exitDate:"",strategy:"",tags:"",notes:"",score:5,setupQuality:"B Orta",execution:5,followedPlan:true,setupType:"",emotion:"",mistakes:"",successes:"",lessons:""});

  const showToast = (msg, type="success") => {
    const id = Date.now();
    setToasts(prev => [...prev, {id, msg, type}]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

  const saveTrade = () => {
    const t = editTrade !== null ? {...newTrade, id: trades[editTrade].id} : {...newTrade, id: Date.now()};
    if (!t.symbol.trim()) return;
    if (editTrade !== null) { const updated=[...trades]; updated[editTrade]=t; setTrades(updated); }
    else setTrades(prev=>[t,...prev]);
    resetNewTrade(); setEditTrade(null); setTradeView("list");
    showToast(editTrade !== null ? "Trade güncellendi ✓" : "Trade kaydedildi ✓");
  };

  const deleteTrade = (idx) => { setTrades(prev=>prev.filter((_,i)=>i!==idx)); showToast("Trade silindi", "error"); };

  const filteredTrades = trades.filter(t => {
    if (tradeFilter==="all" && t.status!=="Acik") return false;
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
  // ── Haber Akışı ──
  const fetchNews = useCallback(async (filterMode) => {
    setNewsLoading(true);
    const coins = [...new Set(
      Object.values(portfolios).flat().map(p => {
        const nc = knownCoins.find(x => x.id === p.coinId);
        return nc && nc.symbol ? nc.symbol.toUpperCase() : null;
      }).filter(Boolean)
    )].slice(0, 15);
    const currStr = filterMode === "portfolio" ? coins.join(",") : "";
    const mapArticle = (a, src) => ({
      id: String(a.id || Math.random()),
      title: a.title || "",
      body: (a.body || a.description || a.metadata && a.metadata.description || "").slice(0, 280),
      url: a.url || "#",
      imageUrl: a.imageurl || a.thumb_2x || a.thumb || (a.metadata && a.metadata.image) || "",
      source: (a.source_info && a.source_info.name) || a.source || (a.source && a.source.title) || src,
      publishedAt: a.published_on ? a.published_on * 1000 : (a.published_at ? new Date(a.published_at).getTime() : Date.now()),
      currencies: Array.isArray(a.currencies) ? a.currencies.map(x => x.code || x) : (a.categories || "").split("|").map(s => s.trim()).filter(Boolean),
      sentiment: "neutral",
      isPortfolio: false,
    });
    const markPortfolio = (articles) => articles.map(a => ({
      ...a,
      isPortfolio: coins.some(s => {
        const ttl = a.title ? a.title.toUpperCase() : "";
        const curs = Array.isArray(a.currencies) ? a.currencies : [];
        return ttl.includes(s) || curs.includes(s);
      }),
    }));
    try {
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
      const params = currStr ? "?currencies=" + encodeURIComponent(currStr) + "&limit=50" : "?limit=50";
      const r = await fetch(baseUrl + "/api/news" + params, { signal: AbortSignal.timeout(12000) });
      if (r.ok) {
        const d = await r.json();
        if (d && d.articles && d.articles.length > 0) {
          setNewsData(markPortfolio(d.articles));
          setNewsLoaded(true);
          setNewsLoading(false);
          return;
        }
      }
    } catch(e) {}
    try {
      const catQ = currStr ? "&categories=" + encodeURIComponent(currStr) : "";
      const r = await fetch("https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest" + catQ, { signal: AbortSignal.timeout(10000) });
      if (r.ok) {
        const d = await r.json();
        if (d && d.Data && d.Data.length > 0) {
          const arts = d.Data.slice(0, 40).map(a => mapArticle(a, "CryptoCompare"));
          setNewsData(markPortfolio(arts));
          setNewsLoaded(true);
          setNewsLoading(false);
          return;
        }
      }
    } catch(e) {}
    try {
      const r = await fetch("https://cryptopanic.com/api/free/v1/posts/?auth_token=FREE&public=true&kind=news" + (currStr ? "&currencies=" + encodeURIComponent(currStr) : ""), { signal: AbortSignal.timeout(10000) });
      if (r.ok) {
        const d = await r.json();
        if (d && d.results && d.results.length > 0) {
          const arts = d.results.map(a => mapArticle(a, "CryptoPanic"));
          setNewsData(markPortfolio(arts));
          setNewsLoaded(true);
        }
      }
    } catch(e) {}
    setNewsLoading(false);
  }, [portfolios, knownCoins]);


  useEffect(() => {
    try { localStorage.setItem("ip_portfolios", JSON.stringify(portfolios)); } catch(e) {}
    const fu = firebaseUserRef.current;
    if (fu && !fu.isAnonymous && dataLoadedRef.current) { savePortfolios(fu.uid, portfolios, sections); }
  }, [portfolios]); // eslint-disable-line
  useEffect(() => { try { localStorage.setItem("ip_activePortfolio", activePortfolio); } catch(e) {} }, [activePortfolio]);
  useEffect(() => { try { localStorage.setItem("ip_knownCoins", JSON.stringify(knownCoins)); } catch(e) {} }, [knownCoins]);
  useEffect(() => {
    try { localStorage.setItem("ip_sections", JSON.stringify(sections)); } catch(e) {}
    const fu = firebaseUserRef.current;
    if (fu && !fu.isAnonymous && dataLoadedRef.current) { savePortfolios(fu.uid, portfolios, sections); }
  }, [sections]); // eslint-disable-line

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

  // ── Keyboard shortcuts ──
  useEffect(()=>{
    const handler = (e) => {
      // Ctrl+K = command palette
      if((e.ctrlKey||e.metaKey) && e.key==="k") { e.preventDefault(); setCmdOpen(o=>!o); setCmdQuery(""); }
      // Esc = close palette / go back
      if(e.key==="Escape") { if(cmdOpen){setCmdOpen(false);} else if(tradeView==="add"){setTradeView("list");resetNewTrade();setEditTrade(null);} }
      // N = new trade (when not typing)
      if(e.key==="n" && !e.ctrlKey && !e.metaKey && e.target.tagName!=="INPUT" && e.target.tagName!=="TEXTAREA") {
        if(tab==="trade") { setTradeView("add"); resetNewTrade(); setEditTrade(null); }
      }
      // Number keys 1-5 = tab switch
      if(!e.ctrlKey && !e.metaKey && e.target.tagName!=="INPUT" && e.target.tagName!=="TEXTAREA") {
        const tabMap = {"1":"overview","2":"portfolio","3":"trade","4":"news","5":"reports"};
        if(tabMap[e.key]) setTab(tabMap[e.key]);
      }
    };
    window.addEventListener("keydown", handler);
    return ()=>window.removeEventListener("keydown", handler);
  },[cmdOpen,tradeView,tab]); // eslint-disable-line
  useEffect(()=>{ if(tab==="news"&&!newsLoaded&&!newsLoading) fetchNews("portfolio"); },[tab]); // eslint-disable-line

  // ── Price alert checker ──
  useEffect(()=>{
    if(priceAlerts.length===0) return;
    priceAlerts.forEach(alert => {
      const current = prices[alert.coinId]?.usd;
      if(!current) return;
      const triggered = alert.type==="above" ? current >= alert.price : current <= alert.price;
      if(triggered && !alert.fired) {
        showToast(`🔔 ${alert.symbol}: $${current.toFixed(2)} — Hedef fiyata ulaştı!`, "alert");
        setPriceAlerts(prev => prev.map(a => a.id===alert.id ? {...a, fired:true} : a));
        if("Notification" in window && Notification.permission==="granted") {
          new Notification(`InvestPulse Alarm: ${alert.symbol}`, {body:`$${current.toFixed(2)} — Hedef fiyata ulaştı!`});
        }
      }
    });
  },[prices]); // eslint-disable-line
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

  // ── Takvim computed ──
  const calY = calendarMonth.y, calM = calendarMonth.m;
  const calFirstDay = new Date(calY, calM, 1).getDay();
  const calOffset = calFirstDay===0 ? 6 : calFirstDay-1;
  const calDaysInMonth = new Date(calY, calM+1, 0).getDate();
  const calCells = [];
  for(let i=0;i<calOffset;i++) calCells.push(null);
  for(let d=1;d<=calDaysInMonth;d++) calCells.push(d);
  while(calCells.length%7!==0) calCells.push(null);

  const calMonthStr = `${calY}-${String(calM+1).padStart(2,"0")}`;
  const calMonthTrades = trades.filter(t => (t.entryDate||"").startsWith(calMonthStr));
  const calMonthPnl = calMonthTrades.filter(t=>t.status==="Kapali").reduce((s,t)=>s+calcPnl(t),0);
  const calMonthWins = calMonthTrades.filter(t=>t.status==="Kapali"&&calcPnl(t)>0).length;
  const calMonthClosed = calMonthTrades.filter(t=>t.status==="Kapali").length;
  const calTradeDays = new Set(calMonthTrades.map(t=>(t.entryDate||"").slice(0,10))).size;

  // ── Haberler için computed ──
  const newsPortfolioCoins = [...new Set(
    Object.values(portfolios).flat().map(p => {
      const nc = knownCoins.find(x => x.id === p.coinId);
      return nc && nc.symbol ? nc.symbol.toUpperCase() : null;
    }).filter(Boolean)
  )].slice(0, 15);

  const newsFiltered = newsFilter === "portfolio"
    ? newsData.filter(a => {
        if (a.isPortfolio) return true;
        const ttl = a.title ? a.title.toUpperCase() : "";
        const curs = Array.isArray(a.currencies) ? a.currencies : [];
        return newsPortfolioCoins.some(s => ttl.includes(s) || curs.includes(s));
      })
    : newsData;

  const newsTimeAgo = (ts) => {
    const d = (Date.now() - ts) / 1000;
    if (d < 3600) return Math.floor(d/60) + " dk önce";
    if (d < 86400) return Math.floor(d/3600) + " sa önce";
    return Math.floor(d/86400) + " gün önce";
  };

  if (showSplash) return <SplashScreen onFinish={() => setShowSplash(false)} />;
  if (!isLoggedIn) return <AuthScreen onLogin={async (user) => { const name = user.displayName || user.email?.split("@")[0] || (user.isAnonymous ? "Misafir" : "Kullanici"); setCurrentUser(name); setFirebaseUser(user); firebaseUserRef.current = user; if (!user.isAnonymous) { try { const data = await getUserData(user.uid); if (data && data.portfolios) { setPortfolios(data.portfolios); if (data.sections) setSections(data.sections); } else { const lp = localStorage.getItem("ip_portfolios"); if (lp) { const p = JSON.parse(lp); setPortfolios(p); await savePortfolios(user.uid, p, sections); } } } catch(e) { console.error("Firestore:", e); } } setDataLoaded(true); dataLoadedRef.current = true; setIsLoggedIn(true); }} />;

  // Loading artık sayfayı bloklamaz — skeleton gösterilir
  const isLoading = loading && Object.keys(prices).length === 0;

  // ── Yükselen & Düşenler ──
  const gainersLosers = allPData.filter(x=>x.currentPrice>0).sort((a,b)=>b.change24h-a.change24h);
  const topGainers = gainersLosers.slice(0,5);
  const topLosers = [...gainersLosers].reverse().slice(0,5);

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
        {[{id:"overview",lbl:"Dashboard",ic:"⊞"},{id:"portfolio",lbl:"Portföy",ic:"◎"},{id:"trade",lbl:"Trade",ic:"📈"},{id:"news",lbl:"Haberler",ic:"📰"},{id:"reports",lbl:"Raporlar",ic:"📄"}].map(t=>
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
          {/* Fiyat Alarmları panel */}
          {priceAlerts.length>0&&(
            <div style={{...st.card,marginBottom:14,padding:14}}>
              <div style={{fontSize:12,fontWeight:700,color:T.text,marginBottom:10,display:"flex",justifyContent:"space-between"}}>
                <span>🔔 Aktif Alarmlar</span>
                <button onClick={()=>setPriceAlerts([])} style={{fontSize:10,color:T.textMuted,background:"none",border:"none",cursor:"pointer"}}>Tümünü Sil</button>
              </div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {priceAlerts.map(a=>(
                  <div key={a.id} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 10px",background:a.fired?T.bgInput:T.accentGlow,border:`1px solid ${a.fired?T.border:T.accent+"44"}`,borderRadius:7}}>
                    <span style={{fontSize:11,fontWeight:700,color:a.fired?T.textMuted:T.accent}}>{a.symbol}</span>
                    <span style={{fontSize:10,color:T.textMuted}}>{a.type==="above"?"≥":"≤"}</span>
                    <span style={{fontSize:11,fontFamily:"'JetBrains Mono',monospace",color:a.fired?T.textMuted:T.text}}>${a.price}</span>
                    {a.fired&&<span style={{fontSize:9,color:T.green,fontWeight:700}}>✓</span>}
                    <button onClick={()=>setPriceAlerts(prev=>prev.filter(x=>x.id!==a.id))} style={{fontSize:9,color:T.textMuted,background:"none",border:"none",cursor:"pointer",marginLeft:2}}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}
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
                <table style={{width:"100%",borderCollapse:"collapse",tableLayout:"auto"}}><thead><tr>{["","Coin","Fiyat","24s","Miktar","Değer","Ağırlık","K/Z","İşlem"].map((h,i)=><th key={i} style={{...st.th,textAlign:i<=1?"left":i===8?"center":"right",width:i===0?30:undefined}}>{h}</th>)}</tr></thead><tbody>
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

          {/* 🔥 En Çok Yükselen & Düşenler */}
          {gainersLosers.length>1&&(
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:20}}>
              <div style={{...st.card,padding:16}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:12}}>
                  <span style={{fontSize:16}}>🚀</span>
                  <span style={{fontSize:13,fontWeight:600,color:T.green}}>En Çok Yükselen</span>
                  <span style={{fontSize:10,color:T.textMuted}}>(24s)</span>
                </div>
                {topGainers.map((item,i)=>(
                  <div key={item.coinId} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:i<topGainers.length-1?`1px solid ${T.bgCardSolid}`:"none"}}>
                    <div style={{width:26,height:26,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,background:getMarketColor(getMarketType(item.coinId))+"18",color:getMarketColor(getMarketType(item.coinId))}}>{item.coin?.symbol?.charAt(0)||"?"}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:4}}>
                        <span style={{fontWeight:600,fontSize:12}}>{item.coin?.symbol}</span>
                        <span style={{fontSize:7,padding:"1px 3px",borderRadius:2,background:getMarketColor(getMarketType(item.coinId))+"15",color:getMarketColor(getMarketType(item.coinId)),fontWeight:700}}>{getMarketLabel(getMarketType(item.coinId))}</span>
                      </div>
                      <div style={{flex:1,height:3,background:T.border,borderRadius:2,overflow:"hidden",marginTop:3}}><div style={{height:"100%",width:Math.max((Math.abs(item.change24h)/Math.max(...gainersLosers.map(x=>Math.abs(x.change24h)),1))*100,2)+"%",background:T.green,borderRadius:2}}/></div>
                    </div>
                    <div style={{textAlign:"right",minWidth:70}}>
                      <div style={{fontSize:13,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:T.green}}>▲ {Math.abs(item.change24h).toFixed(2)}%</div>
                      <div style={{fontSize:10,color:T.textMuted,fontFamily:"'JetBrains Mono',monospace"}}>{fmt(item.currentValue)}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{...st.card,padding:16}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:12}}>
                  <span style={{fontSize:16}}>📉</span>
                  <span style={{fontSize:13,fontWeight:600,color:T.red}}>En Çok Düşen</span>
                  <span style={{fontSize:10,color:T.textMuted}}>(24s)</span>
                </div>
                {topLosers.map((item,i)=>(
                  <div key={item.coinId} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:i<topLosers.length-1?`1px solid ${T.bgCardSolid}`:"none"}}>
                    <div style={{width:26,height:26,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,background:getMarketColor(getMarketType(item.coinId))+"18",color:getMarketColor(getMarketType(item.coinId))}}>{item.coin?.symbol?.charAt(0)||"?"}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:4}}>
                        <span style={{fontWeight:600,fontSize:12}}>{item.coin?.symbol}</span>
                        <span style={{fontSize:7,padding:"1px 3px",borderRadius:2,background:getMarketColor(getMarketType(item.coinId))+"15",color:getMarketColor(getMarketType(item.coinId)),fontWeight:700}}>{getMarketLabel(getMarketType(item.coinId))}</span>
                      </div>
                      <div style={{flex:1,height:3,background:T.border,borderRadius:2,overflow:"hidden",marginTop:3}}><div style={{height:"100%",width:Math.max((Math.abs(item.change24h)/Math.max(...gainersLosers.map(x=>Math.abs(x.change24h)),1))*100,2)+"%",background:T.red,borderRadius:2}}/></div>
                    </div>
                    <div style={{textAlign:"right",minWidth:70}}>
                      <div style={{fontSize:13,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:T.red}}>▼ {Math.abs(item.change24h).toFixed(2)}%</div>
                      <div style={{fontSize:10,color:T.textMuted,fontFamily:"'JetBrains Mono',monospace"}}>{fmt(item.currentValue)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dağılım + Tüm Varlıklar */}
          <div style={{display:"grid",gridTemplateColumns:allPData.length>0?"260px 1fr":"1fr",gap:18,marginBottom:20}}>
            {allPData.length>0&&<div style={st.card}>
              <h3 style={{fontSize:14,fontWeight:600,marginBottom:12}}>Dağılım</h3>
              <ResponsiveContainer width="100%" height={200}><PieChart><Pie data={allPieData.slice(0,12)} cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={2} dataKey="value" stroke="none">{allPieData.slice(0,12).map((e,i)=><Cell key={i} fill={e.color}/>)}</Pie><Tooltip formatter={v=>[fmt(v),""]} contentStyle={st.tt}/></PieChart></ResponsiveContainer>
              <div style={{marginTop:8,maxHeight:180,overflowY:"auto"}}>{allPieData.map((item,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 0",borderBottom:`1px solid ${T.bgCardSolid}`}}><span style={{width:8,height:8,borderRadius:2,background:item.color,flexShrink:0}}/><span style={{flex:1,fontSize:12,color:T.textSecondary}}>{item.name}</span><span style={{fontSize:11,fontFamily:"'JetBrains Mono',monospace",color:"#9333EA"}}>{allTotVal>0?((item.value/allTotVal)*100).toFixed(1):0}%</span></div>)}</div>
            </div>}
            <div style={st.card}>
              <h3 style={{fontSize:14,fontWeight:600,marginBottom:12}}>Tüm Varlıklar</h3>
              <div style={{overflowX:"auto"}}>
                {allPData.length===0?<div style={{textAlign:"center",padding:40,color:T.textMuted}}>Portföylere varlık ekleyin</div>:
                <table style={{width:"100%",borderCollapse:"collapse",tableLayout:"auto"}}><thead><tr>{["Varlık","Fiyat","24s","Değer","Ağırlık","K/Z"].map((h,i)=><th key={h} style={{...st.th,textAlign:i===0?"left":"right"}}>{h}</th>)}</tr></thead><tbody>
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
              {[{v:"list",l:"Aktif İşlemler",ic:"⚡"},{v:"add",l:"Yeni Trade",ic:"+"},{v:"analytics",l:"Analitik & Takvim",ic:"📊"},{v:"notes",l:"Notlar",ic:"📝"}].map(v=>
                <button key={v.v} onClick={()=>{setTradeView(v.v);if(v.v==="add"){resetNewTrade();setEditTrade(null);}}} style={{padding:"8px 16px",background:tradeView===v.v?"linear-gradient(135deg,#9333EA,#D4A017)":T.bgCard,border:`1px solid ${tradeView===v.v?T.accent+"44":T.border}`,color:tradeView===v.v?"#fff":T.textSecondary,fontSize:12,fontWeight:600,cursor:"pointer",borderRadius:8,fontFamily:"'Inter',sans-serif",display:"flex",alignItems:"center",gap:4}}>{v.ic} {v.l}</button>
              )}
            </div>
          </div>

          {/* ═══ TRADE LIST ═══ */}
          {tradeView==="list"&&<>
            {/* Kasa & Filtreler */}
            <div style={{display:"flex",gap:12,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>

              <div style={{flex:1,minWidth:150,display:"flex",alignItems:"center",gap:0,background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
                <input value={tradeSearch} onChange={e=>setTradeSearch(e.target.value)} placeholder="Sembol, not, etiket ara..." style={{flex:1,padding:"8px 12px",background:"transparent",border:"none",color:T.text,fontSize:13,outline:"none",fontFamily:"'Inter',sans-serif"}}/>
                <kbd onClick={()=>{setCmdOpen(true);setCmdQuery("");}} style={{padding:"4px 8px",margin:"0 6px",borderRadius:5,background:T.bgCard,border:`1px solid ${T.border}`,color:T.textMuted,fontSize:10,fontFamily:"'JetBrains Mono',monospace",cursor:"pointer",whiteSpace:"nowrap"}}>⌘K</kbd>
              </div>
              <div style={{display:"flex",gap:4}}>
                {[{f:"all",l:"Aktif"},{f:"closed",l:"Tamamlanan"},{f:"win",l:"Kazanç"},{f:"loss",l:"Kayıp"}].map(f=>
                  <button key={f.f} onClick={()=>setTradeFilter(f.f)} style={{padding:"6px 10px",background:tradeFilter===f.f?T.accentGlow:"transparent",border:`1px solid ${tradeFilter===f.f?T.accent+"33":"transparent"}`,color:tradeFilter===f.f?T.accent:T.textMuted,fontSize:11,fontWeight:600,cursor:"pointer",borderRadius:6,fontFamily:"'Inter',sans-serif"}}>{f.l}</button>
                )}
              </div>
            </div>

            {/* Trade Listesi */}
            {filteredTrades.length===0?
              <div style={{...st.card,padding:60,textAlign:"center"}}><div style={{fontSize:40,marginBottom:12}}>📈</div><div style={{fontSize:16,fontWeight:600,color:T.text,marginBottom:4}}>Henüz trade yok</div><div style={{fontSize:13,color:T.textMuted,marginBottom:16}}>İlk tradeni ekleyerek başla</div><button onClick={()=>{setTradeView("add");resetNewTrade();setEditTrade(null);}} style={{padding:"10px 24px",background:"linear-gradient(135deg,#9333EA,#D4A017)",border:"none",borderRadius:8,color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>İlk Tradeni Ekle</button></div>
            :
              <div style={{...st.card,padding:0,overflow:"hidden"}}><div style={{overflowX:"auto"}}>
                {bulkSelected.length>0&&(
                  <div style={{marginBottom:8,padding:"8px 14px",background:"rgba(239,68,68,.08)",border:`1px solid ${T.red}33`,borderRadius:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontSize:12,color:T.red,fontWeight:600}}>{bulkSelected.length} trade seçildi</span>
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={()=>{setTrades(prev=>prev.filter((_,i)=>!bulkSelected.includes(i)));setBulkSelected([]);showToast(`${bulkSelected.length} trade silindi`,"error");}}
                        style={{padding:"5px 14px",background:T.red,border:"none",borderRadius:6,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>✕ Sil</button>
                      <button onClick={()=>setBulkSelected([])} style={{padding:"5px 14px",background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:6,color:T.textMuted,fontSize:11,cursor:"pointer"}}>İptal</button>
                    </div>
                  </div>
                )}
                <table style={{width:"100%",borderCollapse:"collapse",tableLayout:"auto"}}><thead><tr>
                  <th style={{...st.th,padding:"10px 12px",width:40}}><input type="checkbox" onChange={e=>setBulkSelected(e.target.checked?filteredTrades.map((_,i)=>i):[])} checked={bulkSelected.length===filteredTrades.length&&filteredTrades.length>0} style={{cursor:"pointer",width:14,height:14}}/></th>
                  {[
                    {h:"Tarih",w:90},{h:"Sembol",w:140},{h:"Yön",w:70},
                    {h:"Giriş",w:90},{h:"Çıkış",w:90},{h:"SL",w:90},{h:"Miktar",w:80},
                    {h:"K/Z",w:90},{h:"Durum",w:120},{h:"Puan",w:60},{h:"",w:60}
                  ].map(({h,w})=><th key={h} style={{...st.th,textAlign:h===""?"center":"left",padding:"10px 12px",minWidth:w,whiteSpace:"nowrap"}}>{h}</th>)}
                </tr></thead><tbody>
                {filteredTrades.map((t,i)=>(
                  <tr key={t.id||i} style={{borderBottom:`1px solid ${T.border}`,background:bulkSelected.includes(i)?"rgba(147,51,234,.04)":"transparent"}}>
                    <td style={{padding:"10px 8px",width:32}}>
                      <input type="checkbox" checked={bulkSelected.includes(i)} onChange={e=>{setBulkSelected(prev=>e.target.checked?[...prev,i]:prev.filter(x=>x!==i));}} style={{cursor:"pointer",width:14,height:14}}/>
                    </td>
                    <td style={{padding:"10px 12px",whiteSpace:"nowrap"}}>
                      <div style={{fontSize:11,fontWeight:600,color:T.textSecondary,fontFamily:"'JetBrains Mono',monospace"}}>{t.entryDate?new Date(t.entryDate).toLocaleDateString("tr-TR",{day:"2-digit",month:"short",year:"2-digit"}):"—"}</div>
                      {t.exitDate&&<div style={{fontSize:10,color:T.textMuted,marginTop:1}}>{new Date(t.exitDate).toLocaleDateString("tr-TR",{day:"2-digit",month:"short"})}</div>}
                    </td>
                    <td style={{padding:"10px 12px"}}><div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:12,fontWeight:700,color:T.text,fontFamily:"'JetBrains Mono',monospace"}}>{t.symbol}</span><span style={{fontSize:9,padding:"1px 5px",borderRadius:3,background:t.market==="Kripto"?"#F7931A18":"#3b82f618",color:t.market==="Kripto"?"#F7931A":"#3b82f6",fontWeight:700}}>{t.market}</span></div><div style={{fontSize:10,color:T.textMuted}}>{t.exchange} • {t.leverage}</div></td>
                    <td style={{padding:"10px 12px"}}><span style={{fontSize:11,padding:"3px 8px",borderRadius:4,background:t.direction==="Long"?"#22C55E18":"#EF444418",color:t.direction==="Long"?"#22C55E":"#EF4444",fontWeight:700}}>{t.direction}</span></td>
                    <td style={{padding:"10px 12px",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:T.text}}>${parseFloat(t.entryPrice||0).toFixed(2)}</td>
                    <td style={{padding:"10px 12px",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:t.exitPrice?T.text:T.textMuted}}>{t.exitPrice?"$"+parseFloat(t.exitPrice).toFixed(2):"—"}</td>
                    <td style={{padding:"10px 12px",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:t.stopLoss?T.red:T.textMuted}}>{t.stopLoss?"$"+parseFloat(t.stopLoss).toFixed(2):"—"}</td>
                    <td style={{padding:"10px 12px",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:T.textSecondary}}>{t.amount?"$"+parseFloat(t.amount).toFixed(0):"—"}</td>
                    <td style={{padding:"10px 12px",fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:700,color:t.status==="Kapali"?(calcPnl(t)>0?T.green:T.red):T.textMuted}}>{t.status==="Kapali"?(calcPnl(t)>0?"+":"")+calcPnl(t).toFixed(2)+"$":"—"}</td>
                    <td style={{padding:"6px 12px",minWidth:120}}>
                      <div style={{display:"flex",background:T.bgInput,borderRadius:7,padding:2,gap:2,border:`1px solid ${T.border}`}}>
                        <button onClick={()=>{const u=[...trades];u[i]={...u[i],status:"Acik"};setTrades(u);}}
                          style={{flex:1,padding:"5px 8px",borderRadius:5,border:"none",fontSize:10,fontWeight:700,cursor:"pointer",transition:"all .15s",
                            background:t.status==="Acik"?"linear-gradient(135deg,#EAB308,#D97706)":"transparent",
                            color:t.status==="Acik"?"#0B0D15":T.textMuted}}>
                          Açık
                        </button>
                        <button onClick={()=>{const u=[...trades];u[i]={...u[i],status:"Kapali"};setTrades(u);}}
                          style={{flex:1,padding:"5px 8px",borderRadius:5,border:"none",fontSize:10,fontWeight:700,cursor:"pointer",transition:"all .15s",
                            background:t.status==="Kapali"?"linear-gradient(135deg,#6366f1,#8B5CF6)":"transparent",
                            color:t.status==="Kapali"?"#fff":T.textMuted}}>
                          Kapalı
                        </button>
                      </div>
                    </td>
                    <td style={{padding:"10px 12px",textAlign:"center"}}><span style={{fontSize:12,fontWeight:700,color:t.score>=7?T.green:t.score>=4?T.gold:T.red}}>{t.score}/10</span></td>
                    <td style={{padding:"10px 12px",textAlign:"center"}}><div style={{display:"flex",gap:4,justifyContent:"center"}}><button onClick={()=>{setNewTrade({...t});setEditTrade(i);setTradeView("add");}} style={{width:26,height:26,border:`1px solid ${T.borderLight}`,background:T.bgCardSolid,color:T.textSecondary,borderRadius:5,cursor:"pointer",fontSize:11,display:"flex",alignItems:"center",justifyContent:"center"}}>✎</button><button onClick={()=>deleteTrade(i)} style={{width:26,height:26,border:`1px solid ${T.red}33`,background:T.redGlow,color:T.red,borderRadius:5,cursor:"pointer",fontSize:11,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button></div></td>
                  </tr>
                ))}
                </tbody></table>
              </div></div>
            }
          </>}

          {/* ═══ ADD/EDIT TRADE ═══ */}
          {tradeView==="add"&&<div>
            {/* Draft restore banner */}
            {tradeDraft&&!newTrade.symbol&&!newTrade.entryPrice&&(
              <div style={{marginBottom:12,padding:"10px 16px",background:"rgba(212,160,23,.08)",border:`1px solid ${T.gold}33`,borderRadius:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:12,color:T.gold,fontWeight:600}}>💾 Kaydedilmemiş taslak — {tradeDraft.symbol||"boş"}</span>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={()=>{setNewTrade(tradeDraft);setTradeDraft(null);}}
                    style={{padding:"4px 12px",background:T.gold,border:"none",borderRadius:5,color:"#0B0D15",fontSize:11,fontWeight:700,cursor:"pointer"}}>Yükle</button>
                  <button onClick={()=>setTradeDraft(null)}
                    style={{padding:"4px 10px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:5,color:T.textMuted,fontSize:11,cursor:"pointer"}}>Sil</button>
                </div>
              </div>
            )}
            <div style={{display:"grid",gap:14}}>

              {/* Trade Bilgileri */}
              <div style={{...st.card,borderLeft:`3px solid ${T.accent}`}}>
                <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:14,display:"flex",alignItems:"center",gap:8}}>📈 Trade Bilgileri</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
                  <div style={{position:"relative"}}>
                    <div style={{fontSize:11,color:T.textMuted,marginBottom:6,fontWeight:500}}>Sembol</div>
                    <input value={newTrade.symbol}
                      onChange={e=>{
                        const v=e.target.value.toUpperCase();
                        setNewTrade(p=>({...p,symbol:v}));
                        if(v.length>=1){
                          const ql=v.toLowerCase().replace("/usdt","").replace("/","");
                          const r=knownCoins.filter(c=>c.symbol.toLowerCase().startsWith(ql)||c.name.toLowerCase().startsWith(ql)).slice(0,6);
                          setSymResults(r); setSymOpen(r.length>0);
                        } else { setSymOpen(false); }
                      }}
                      onBlur={()=>setTimeout(()=>setSymOpen(false),150)}
                      placeholder="BTC, ETH, SOL..."
                      style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${symOpen?T.accent+"66":T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace",transition:"border-color .2s"}}/>
                    {symOpen&&symResults.length>0&&(
                      <div style={{position:"absolute",top:"100%",left:0,right:0,marginTop:4,background:T.bgCardSolid,border:`1px solid ${T.borderLight}`,borderRadius:10,zIndex:100,boxShadow:"0 12px 40px rgba(0,0,0,.4)",maxHeight:220,overflowY:"auto"}}>
                        {symResults.map((coin,si)=>(
                          <div key={coin.id} onMouseDown={()=>{
                            setNewTrade(p=>({...p,symbol:coin.symbol+"/USDT"}));
                            setSymOpen(false);
                          }} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",cursor:"pointer",borderBottom:`1px solid ${T.border}`,transition:"background .15s"}}
                          onMouseEnter={e=>e.currentTarget.style.background=T.bgCardSolid+"cc"}
                          onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                            <div style={{width:28,height:28,borderRadius:7,background:T.accent+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:T.accent}}>{coin.symbol.charAt(0)}</div>
                            <div>
                              <div style={{fontSize:13,fontWeight:600,color:T.text}}>{coin.symbol}</div>
                              <div style={{fontSize:10,color:T.textMuted}}>{coin.name}</div>
                            </div>
                            {prices[coin.id]?.usd>0&&<div style={{marginLeft:"auto",fontSize:11,fontFamily:"'JetBrains Mono',monospace",color:T.textSecondary}}>${prices[coin.id].usd<1?prices[coin.id].usd.toFixed(4):prices[coin.id].usd.toFixed(2)}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:6,fontWeight:500}}>Piyasa Türü</div><select value={newTrade.market} onChange={e=>setNewTrade(p=>({...p,market:e.target.value}))} style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}}><option>Kripto</option><option>Forex</option><option>Hisse</option><option>Emtia</option></select></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:6,fontWeight:500}}>Borsa</div><select value={newTrade.exchange} onChange={e=>setNewTrade(p=>({...p,exchange:e.target.value}))} style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}}><option>Bybit</option><option>OKX</option><option>Dreamcash</option></select></div>
                  <div>
                    <div style={{fontSize:11,color:T.textMuted,marginBottom:6,fontWeight:500}}>Yön</div>
                    <div style={{display:"flex",gap:0,background:T.bgInput,borderRadius:10,padding:3,border:`1px solid ${T.border}`,position:"relative",overflow:"hidden"}}>
                      {/* sliding indicator */}
                      <div style={{
                        position:"absolute",top:3,bottom:3,
                        width:"calc(50% - 3px)",
                        left:newTrade.direction==="Long"?"3px":"calc(50%)",
                        borderRadius:7,
                        background:newTrade.direction==="Long"?"linear-gradient(135deg,#22C55E,#16A34A)":"linear-gradient(135deg,#EF4444,#DC2626)",
                        boxShadow:newTrade.direction==="Long"?"0 4px 16px rgba(34,197,94,.4)":"0 4px 16px rgba(239,68,68,.4)",
                        transition:"left .25s cubic-bezier(.22,1,.36,1), background .25s ease"
                      }}/>
                      <button onClick={()=>setNewTrade(p=>({...p,direction:"Long"}))}
                        style={{flex:1,padding:"11px",borderRadius:8,border:"none",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'Inter',sans-serif",
                          position:"relative",zIndex:1,background:"transparent",
                          color:newTrade.direction==="Long"?"#fff":T.textMuted,
                          transition:"color .2s ease",
                          display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{transition:"transform .25s",transform:newTrade.direction==="Long"?"scale(1.15)":"scale(1)"}}>
                          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
                        </svg>
                        Long
                      </button>
                      <button onClick={()=>setNewTrade(p=>({...p,direction:"Short"}))}
                        style={{flex:1,padding:"11px",borderRadius:8,border:"none",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'Inter',sans-serif",
                          position:"relative",zIndex:1,background:"transparent",
                          color:newTrade.direction==="Short"?"#fff":T.textMuted,
                          transition:"color .2s ease",
                          display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{transition:"transform .25s",transform:newTrade.direction==="Short"?"scale(1.15)":"scale(1)"}}>
                          <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>
                        </svg>
                        Short
                      </button>
                    </div>
                  </div>


                </div>
              </div>

              {/* R Hesabı — Risk Yönetimi */}
              <div style={{...st.card,borderLeft:`3px solid ${T.gold}`,background:`linear-gradient(135deg,rgba(212,160,23,.05),transparent)`}}>
                <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:34,height:34,borderRadius:10,background:`linear-gradient(135deg,${T.gold},#B8860B)`,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:`0 4px 12px rgba(212,160,23,.35)`}}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0B0D15" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                      </svg>
                    </div>
                    <span>R Hesabı — Pozisyon Boyutu</span>
                  </div>
                  <span style={{fontSize:10,color:T.textMuted,fontWeight:400}}>Entry + SL girince otomatik hesaplanır</span>
                </div>

                {/* 1R Ayarı */}
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:11,color:T.gold,marginBottom:8,fontWeight:700}}>1R = Her işlemde riske ettiğim tutar ($)</div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <div style={{display:"flex",alignItems:"center",gap:0,background:T.bgInput,border:`1px solid ${T.gold}55`,borderRadius:10,overflow:"hidden",flex:"0 0 auto"}}>
                      <button onClick={()=>setTradeR(r=>Math.max(1,r-10))} style={{padding:"12px 16px",background:"transparent",border:"none",color:T.gold,fontSize:18,cursor:"pointer",fontWeight:700}}>−</button>
                      <input type="number" value={tradeR} onChange={e=>setTradeR(parseFloat(e.target.value)||0)}
                        style={{width:90,padding:"12px 4px",background:"transparent",border:"none",color:T.gold,fontSize:18,fontWeight:800,outline:"none",fontFamily:"'JetBrains Mono',monospace",textAlign:"center"}}/>
                      <button onClick={()=>setTradeR(r=>r+10)} style={{padding:"12px 16px",background:"transparent",border:"none",color:T.gold,fontSize:18,cursor:"pointer",fontWeight:700}}>+</button>
                    </div>
                    <div style={{display:"flex",gap:6}}>
                      {[25,50,100,200,500,1000].map(r=>(
                        <button key={r} onClick={()=>setTradeR(r)}
                          style={{padding:"8px 12px",background:tradeR===r?T.goldGlow:T.bgInput,border:`1px solid ${tradeR===r?T.gold+"55":T.border}`,borderRadius:7,color:tradeR===r?T.gold:T.textMuted,fontSize:11,fontWeight:700,cursor:"pointer",transition:"all .15s"}}>
                          ${r}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* ANA HESAP BLOĞU */}
                {newTrade.entryPrice&&newTrade.stopLoss&&parseFloat(newTrade.entryPrice)>0&&parseFloat(newTrade.stopLoss)>0&&Math.abs(parseFloat(newTrade.entryPrice)-parseFloat(newTrade.stopLoss))>0
                  ? <div style={{background:`linear-gradient(135deg,rgba(212,160,23,.1),rgba(212,160,23,.04))`,border:`1px solid ${T.gold}44`,borderRadius:12,padding:18,marginBottom:14}}>
                      <div style={{textAlign:"center",background:"rgba(212,160,23,.12)",borderRadius:10,padding:"14px",border:`1px solid ${T.gold}44`,marginBottom:14}}>
                          <div style={{fontSize:11,color:T.gold,marginBottom:6,fontWeight:700,letterSpacing:.5}}>💰 GİRİLECEK POZİSYON</div>
                          <div style={{fontSize:32,fontWeight:800,fontFamily:"'JetBrains Mono',monospace",color:T.gold}}>
                            ${(tradeR/Math.abs(parseFloat(newTrade.entryPrice)-parseFloat(newTrade.stopLoss))*parseFloat(newTrade.entryPrice)).toFixed(0)}
                          </div>
                          <div style={{fontSize:11,color:T.textMuted,marginTop:4}}>1R=${tradeR} ile hesaplandı</div>
                      </div>
                      {/* Formül gösterimi */}
                      <div style={{padding:"8px 12px",background:T.bgInput,borderRadius:8,fontSize:11,color:T.textMuted,fontFamily:"'JetBrains Mono',monospace",display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                        <span style={{color:T.gold,fontWeight:700}}>1R=${tradeR}</span>
                        <span>÷</span>
                        <span style={{color:T.text}}>|{parseFloat(newTrade.entryPrice).toFixed(2)} − {parseFloat(newTrade.stopLoss).toFixed(2)}|</span>
                        <span>=</span>
                        <span style={{color:"#3b82f6",fontWeight:700}}>{(tradeR/Math.abs(parseFloat(newTrade.entryPrice)-parseFloat(newTrade.stopLoss))).toFixed(4)} adet</span>
                        <span>×</span>
                        <span style={{color:T.text}}>{parseFloat(newTrade.entryPrice).toFixed(2)}</span>
                        <span>=</span>
                        <span style={{color:T.gold,fontWeight:800}}>${(tradeR/Math.abs(parseFloat(newTrade.entryPrice)-parseFloat(newTrade.stopLoss))*parseFloat(newTrade.entryPrice)).toFixed(2)}</span>
                      </div>
                      {/* Piramit Öneri */}
                      <div style={{marginTop:12,padding:"14px",background:T.bgInput,borderRadius:10,border:`1px solid ${T.border}`}}>
                        {/* Başlık + Entry sayısı seçimi */}
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                          <div style={{fontSize:11,fontWeight:700,color:T.textSecondary,textTransform:"uppercase",letterSpacing:.5}}>📐 Piramit Dağılımı</div>
                          <div style={{display:"flex",gap:4,background:T.bg,borderRadius:8,padding:3,border:`1px solid ${T.border}`}}>
                            {[1,2,3].map(n=>(
                              <button key={n} onClick={()=>setEntryCount(n)}
                                style={{width:32,height:28,borderRadius:6,border:"none",fontSize:12,fontWeight:700,cursor:"pointer",transition:"all .15s",
                                  background:entryCount===n?T.gold:"transparent",
                                  color:entryCount===n?"#0B0D15":T.textMuted,
                                  boxShadow:entryCount===n?`0 2px 8px rgba(212,160,23,.3)`:"none"}}>
                                {n}
                              </button>
                            ))}
                            <span style={{fontSize:10,color:T.textMuted,padding:"0 6px",display:"flex",alignItems:"center"}}>entry</span>
                          </div>
                        </div>

                        {/* Görsel bar — horizontal stacked */}
                        <div style={{marginBottom:14}}>
                          <div style={{display:"flex",height:44,borderRadius:10,overflow:"hidden",marginBottom:8,boxShadow:"0 2px 12px rgba(0,0,0,.15)"}}>
                            {(entryCount===1?[[100,T.gold,"E1"]]
                              :entryCount===2?[[40,"#3b82f6","E1"],[60,"#8B5CF6","E2"]]
                              :[[20,"#3b82f6","E1"],[30,"#6366f1","E2"],[50,"#8B5CF6","E3"]]
                            ).map(([pct,clr,lbl],i)=>(
                              <div key={i} style={{width:pct+"%",background:`linear-gradient(135deg,${clr},${clr}cc)`,
                                display:"flex",alignItems:"center",justifyContent:"center",gap:4,
                                transition:"width .4s cubic-bezier(.22,1,.36,1)",
                                borderRight:i<(entryCount-1)?"2px solid rgba(255,255,255,.15)":"none",
                                boxShadow:`inset 0 1px 0 rgba(255,255,255,.2)`}}>
                                <span style={{fontSize:11,fontWeight:800,color:"rgba(255,255,255,.95)",textShadow:"0 1px 3px rgba(0,0,0,.3)"}}>{lbl}</span>
                                <span style={{fontSize:10,fontWeight:600,color:"rgba(255,255,255,.8)"}}>%{pct}</span>
                              </div>
                            ))}
                          </div>
                          <div style={{display:"flex",gap:8,justifyContent:"center"}}>
                            {(entryCount===1?[[100,T.gold,"E1"]]
                              :entryCount===2?[[40,"#3b82f6","E1"],[60,"#8B5CF6","E2"]]
                              :[[20,"#3b82f6","E1"],[30,"#6366f1","E2"],[50,"#8B5CF6","E3"]]
                            ).map(([pct,clr,lbl],i)=>(
                              <div key={i} style={{display:"flex",alignItems:"center",gap:4}}>
                                <div style={{width:8,height:8,borderRadius:2,background:clr,boxShadow:`0 0 6px ${clr}88`}}/>
                                <span style={{fontSize:10,color:T.textMuted,fontWeight:600}}>{lbl} %{pct}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Açıklama */}
                        <div style={{fontSize:11,color:T.textMuted,marginBottom:12,padding:"7px 10px",background:"rgba(212,160,23,.05)",borderRadius:7,border:`1px solid ${T.gold}22`,lineHeight:1.7}}>
                          {entryCount===1
                            ? <><span style={{color:T.gold,fontWeight:700}}>Tek giriş.</span> Tüm pozisyonu tek seferde aç. Sinyal kuvvetliyse ideal.</>
                            : entryCount===2
                            ? <><span style={{color:T.gold,fontWeight:700}}>2 kademeli giriş: %40 + %60.</span> Önce küçük test et, onay gelince büyü.</>
                            : <><span style={{color:T.gold,fontWeight:700}}>3 kademeli giriş: %20 + %30 + %50.</span> En temkinli yaklaşım. Her kademe doğrulanınca büyü.</>
                          }
                        </div>

                        {/* Dolar miktarları */}
                        <div style={{display:"grid",gap:6,marginBottom:12,gridTemplateColumns:entryCount===1?"1fr":entryCount===2?"1fr 1fr":"1fr 1fr 1fr"}}>
                          {(entryCount===1?[[100,T.gold]]
                            :entryCount===2?[[40,"#3b82f6"],[60,"#8B5CF6"]]
                            :[[20,"#3b82f6"],[30,"#6366f1"],[50,"#8B5CF6"]]
                          ).map(([pct,clr],i)=>(
                            <div key={i} style={{padding:"10px",background:T.bgInput,borderRadius:8,border:`1px solid ${clr}33`,textAlign:"center"}}>
                              <div style={{fontSize:10,color:clr,marginBottom:4,fontWeight:700}}>Entry {i+1}</div>
                              <div style={{fontSize:16,fontWeight:800,fontFamily:"'JetBrains Mono',monospace",color:T.gold}}>
                                ${(tradeR/Math.abs(parseFloat(newTrade.entryPrice)-parseFloat(newTrade.stopLoss))*parseFloat(newTrade.entryPrice)*pct/100).toFixed(0)}
                              </div>
                              <div style={{fontSize:10,color:T.textMuted,marginTop:2}}>%{pct}</div>
                            </div>
                          ))}
                        </div>

                        {/* Uygula butonu */}
                        <button onClick={()=>{
                          const totalPos=tradeR/Math.abs(parseFloat(newTrade.entryPrice)-parseFloat(newTrade.stopLoss))*parseFloat(newTrade.entryPrice);
                          const pcts=entryCount===1?[100]:entryCount===2?[40,60]:[20,30,50];
                          setNewTrade(p=>({...p,
                            amount:String(totalPos.toFixed(0)),
                            entry1Amount:String((totalPos*pcts[0]/100).toFixed(0)),
                            entry2Amount:pcts[1]?String((totalPos*pcts[1]/100).toFixed(0)):"",
                            entry3Amount:pcts[2]?String((totalPos*pcts[2]/100).toFixed(0)):"",
                            rAmount:String(tradeR)
                          }));
                        }} style={{width:"100%",padding:"11px",background:`linear-gradient(135deg,${T.gold},#B8860B)`,border:"none",borderRadius:8,color:"#0B0D15",fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"'Inter',sans-serif",boxShadow:`0 4px 16px rgba(212,160,23,.3)`,transition:"transform .15s"}}
                        onMouseEnter={e=>e.currentTarget.style.transform="scale(1.01)"}
                        onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
                          ↑ {entryCount} Entry ile Uygula
                        </button>
                      </div>
                    </div>
                  : <div style={{padding:"16px",background:T.bgInput,borderRadius:10,border:`1px solid ${T.border}`,textAlign:"center",color:T.textMuted,fontSize:13}}>
                      <div style={{fontSize:24,marginBottom:8}}>⬆</div>
                      Entry fiyatı ve Stop Loss gir → pozisyon boyutu otomatik hesaplanır
                    </div>
                }

                {/* R Tablosu */}
                {newTrade.entryPrice&&newTrade.stopLoss&&parseFloat(newTrade.entryPrice)>0&&parseFloat(newTrade.stopLoss)>0&&(
                  <div style={{padding:"10px 14px",background:T.bgInput,borderRadius:8,border:`1px solid ${T.border}`}}>
                    <div style={{fontSize:10,color:T.textMuted,marginBottom:8,fontWeight:600,textTransform:"uppercase",letterSpacing:.5}}>R Tablosu — Hedef Fiyatlar</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {[-2,-1,-0.5,0.5,1,1.5,2,3,5].map(mult=>(
                        <div key={mult} style={{flex:"1 1 80px",padding:"6px 8px",
                          background:mult<0?"rgba(239,68,68,.06)":"rgba(34,197,94,.06)",
                          border:`1px solid ${mult<0?T.red:T.green}22`,borderRadius:6,textAlign:"center"}}>
                          <div style={{fontSize:10,fontWeight:700,color:mult<0?T.red:T.green}}>{mult>0?"+":""}{mult}R</div>
                          <div style={{fontSize:11,fontFamily:"'JetBrains Mono',monospace",color:T.text,fontWeight:600}}>
                            ${(newTrade.direction==="Long"
                              ? parseFloat(newTrade.entryPrice)+Math.abs(parseFloat(newTrade.entryPrice)-parseFloat(newTrade.stopLoss))*mult
                              : parseFloat(newTrade.entryPrice)-Math.abs(parseFloat(newTrade.entryPrice)-parseFloat(newTrade.stopLoss))*mult
                            ).toFixed((parseFloat(newTrade.entryPrice)+Math.abs(parseFloat(newTrade.entryPrice)-parseFloat(newTrade.stopLoss))*mult)<10?4:2)}
                          </div>
                          <div style={{fontSize:10,color:mult<0?T.red+"aa":T.green+"aa"}}>{tradeR*mult>0?"+":""}{(tradeR*mult).toFixed(0)}$</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>

              {/* Entry 1 / 2 / 3 — Fiyat & Miktar yanyana */}
              <div style={{...st.card,borderLeft:`3px solid #3b82f6`}}>
                <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <span>💲 Entry Seviyeleri</span>
                  {newTrade.entryPrice&&<span style={{fontSize:12,color:"#9333EA",fontFamily:"'JetBrains Mono',monospace",fontWeight:700}}>Ort. Giriş: ${parseFloat(newTrade.entryPrice)<1?parseFloat(newTrade.entryPrice).toFixed(6):parseFloat(newTrade.entryPrice).toFixed(4)}</span>}
                </div>
                {/* Başlık satırı */}
                <div style={{display:"grid",gridTemplateColumns:"80px 1fr 1fr",gap:8,marginBottom:8}}>
                  <div/>
                  <div style={{fontSize:10,color:T.textMuted,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,paddingLeft:2}}>Fiyat ($)</div>
                  <div style={{fontSize:10,color:T.textMuted,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,paddingLeft:2}}>Miktar ($)</div>
                </div>
                {/* Entry 1 */}
                <div style={{display:"grid",gridTemplateColumns:"80px 1fr 1fr",gap:8,marginBottom:8,alignItems:"center"}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#3b82f6",display:"flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",background:"#3b82f6",display:"inline-block"}}/>Entry 1</div>
                  <input type="number" value={newTrade.entry1Price||""} onChange={e=>{const v=e.target.value;setNewTrade(p=>{const n={...p,entry1Price:v};const es=[[parseFloat(n.entry1Price||0),parseFloat(n.entry1Amount||0)],[parseFloat(n.entry2Price||0),parseFloat(n.entry2Amount||0)],[parseFloat(n.entry3Price||0),parseFloat(n.entry3Amount||0)]].filter(([p,a])=>p>0&&a>0);if(es.length>0){const ta=es.reduce((s,[,a])=>s+a,0);const tq=es.reduce((s,[p,a])=>s+a/p,0);n.entryPrice=(ta/tq).toFixed(ta/tq<1?6:4);n.amount=String(ta);}return n;});}} placeholder="0.00" style={{padding:"10px 12px",background:T.bgInput,border:`1px solid #3b82f633`,borderRadius:8,color:T.text,fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace",width:"100%"}}/>
                  <input type="number" value={newTrade.entry1Amount||""} onChange={e=>{const v=e.target.value;setNewTrade(p=>{const n={...p,entry1Amount:v};const es=[[parseFloat(n.entry1Price||0),parseFloat(n.entry1Amount||0)],[parseFloat(n.entry2Price||0),parseFloat(n.entry2Amount||0)],[parseFloat(n.entry3Price||0),parseFloat(n.entry3Amount||0)]].filter(([p,a])=>p>0&&a>0);if(es.length>0){const ta=es.reduce((s,[,a])=>s+a,0);const tq=es.reduce((s,[p,a])=>s+a/p,0);n.entryPrice=(ta/tq).toFixed(ta/tq<1?6:4);n.amount=String(ta);}return n;});}} placeholder="100" style={{padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace",width:"100%"}}/>
                </div>
                {/* Entry 2 */}
                <div style={{display:"grid",gridTemplateColumns:"80px 1fr 1fr",gap:8,marginBottom:8,alignItems:"center"}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#9333EA",display:"flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",background:"#9333EA",display:"inline-block"}}/>Entry 2</div>
                  <input type="number" value={newTrade.entry2Price||""} onChange={e=>{const v=e.target.value;setNewTrade(p=>{const n={...p,entry2Price:v};const es=[[parseFloat(n.entry1Price||0),parseFloat(n.entry1Amount||0)],[parseFloat(n.entry2Price||0),parseFloat(n.entry2Amount||0)],[parseFloat(n.entry3Price||0),parseFloat(n.entry3Amount||0)]].filter(([p,a])=>p>0&&a>0);if(es.length>0){const ta=es.reduce((s,[,a])=>s+a,0);const tq=es.reduce((s,[p,a])=>s+a/p,0);n.entryPrice=(ta/tq).toFixed(ta/tq<1?6:4);n.amount=String(ta);}return n;});}} placeholder="Opsiyonel" style={{padding:"10px 12px",background:T.bgInput,border:`1px solid #9333EA33`,borderRadius:8,color:T.text,fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace",width:"100%"}}/>
                  <input type="number" value={newTrade.entry2Amount||""} onChange={e=>{const v=e.target.value;setNewTrade(p=>{const n={...p,entry2Amount:v};const es=[[parseFloat(n.entry1Price||0),parseFloat(n.entry1Amount||0)],[parseFloat(n.entry2Price||0),parseFloat(n.entry2Amount||0)],[parseFloat(n.entry3Price||0),parseFloat(n.entry3Amount||0)]].filter(([p,a])=>p>0&&a>0);if(es.length>0){const ta=es.reduce((s,[,a])=>s+a,0);const tq=es.reduce((s,[p,a])=>s+a/p,0);n.entryPrice=(ta/tq).toFixed(ta/tq<1?6:4);n.amount=String(ta);}return n;});}} placeholder="Opsiyonel" style={{padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace",width:"100%"}}/>
                </div>
                {/* Entry 3 */}
                <div style={{display:"grid",gridTemplateColumns:"80px 1fr 1fr",gap:8,alignItems:"center"}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#F59E0B",display:"flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",background:"#F59E0B",display:"inline-block"}}/>Entry 3</div>
                  <input type="number" value={newTrade.entry3Price||""} onChange={e=>{const v=e.target.value;setNewTrade(p=>{const n={...p,entry3Price:v};const es=[[parseFloat(n.entry1Price||0),parseFloat(n.entry1Amount||0)],[parseFloat(n.entry2Price||0),parseFloat(n.entry2Amount||0)],[parseFloat(n.entry3Price||0),parseFloat(n.entry3Amount||0)]].filter(([p,a])=>p>0&&a>0);if(es.length>0){const ta=es.reduce((s,[,a])=>s+a,0);const tq=es.reduce((s,[p,a])=>s+a/p,0);n.entryPrice=(ta/tq).toFixed(ta/tq<1?6:4);n.amount=String(ta);}return n;});}} placeholder="Opsiyonel" style={{padding:"10px 12px",background:T.bgInput,border:`1px solid #F59E0B33`,borderRadius:8,color:T.text,fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace",width:"100%"}}/>
                  <input type="number" value={newTrade.entry3Amount||""} onChange={e=>{const v=e.target.value;setNewTrade(p=>{const n={...p,entry3Amount:v};const es=[[parseFloat(n.entry1Price||0),parseFloat(n.entry1Amount||0)],[parseFloat(n.entry2Price||0),parseFloat(n.entry2Amount||0)],[parseFloat(n.entry3Price||0),parseFloat(n.entry3Amount||0)]].filter(([p,a])=>p>0&&a>0);if(es.length>0){const ta=es.reduce((s,[,a])=>s+a,0);const tq=es.reduce((s,[p,a])=>s+a/p,0);n.entryPrice=(ta/tq).toFixed(ta/tq<1?6:4);n.amount=String(ta);}return n;});}} placeholder="Opsiyonel" style={{padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace",width:"100%"}}/>
                </div>
                {/* Özet */}
                {newTrade.entryPrice&&parseFloat(newTrade.entryPrice)>0&&(
                  <div style={{marginTop:12,padding:"10px 14px",background:`linear-gradient(135deg,#9333EA11,#3b82f611)`,borderRadius:8,border:"1px solid #9333EA22",display:"flex",gap:20,flexWrap:"wrap"}}>
                    <span style={{fontSize:11,color:T.textMuted}}>Toplam: <span style={{fontWeight:700,color:T.text,fontFamily:"'JetBrains Mono',monospace"}}>${parseFloat(newTrade.amount||0).toFixed(2)}</span></span>
                    <span style={{fontSize:11,color:T.textMuted}}>Ort. Giriş: <span style={{fontWeight:800,color:"#9333EA",fontFamily:"'JetBrains Mono',monospace"}}>${parseFloat(newTrade.entryPrice)<1?parseFloat(newTrade.entryPrice).toFixed(6):parseFloat(newTrade.entryPrice).toFixed(4)}</span></span>
                  </div>
                )}
              </div>

              {/* SL & TP + Çıkış — tek kart */}
              <div style={{...st.card,borderLeft:`3px solid #10b981`}}>
                <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:14,display:"flex",alignItems:"center",gap:8}}>🎯 Stop Loss & Take Profit</div>
                {/* Kolon başlıkları */}
                <div style={{display:"grid",gridTemplateColumns:"80px 1fr 1fr",gap:8,marginBottom:8}}>
                  <div/>
                  <div style={{fontSize:10,color:T.textMuted,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,paddingLeft:2}}>Fiyat ($)</div>
                  <div style={{fontSize:10,color:T.textMuted,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,paddingLeft:2}}>Miktar / %</div>
                </div>
                {/* Stop Loss */}
                <div style={{display:"grid",gridTemplateColumns:"80px 1fr 1fr",gap:8,marginBottom:8,alignItems:"center"}}>
                  <div style={{fontSize:12,fontWeight:700,color:T.red,display:"flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",background:T.red,display:"inline-block"}}/>SL</div>
                  <input type="number" value={newTrade.stopLoss} onChange={e=>setNewTrade(p=>({...p,stopLoss:e.target.value}))} placeholder="0.00" style={{padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.red}44`,borderRadius:8,color:T.red,fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace",width:"100%"}}/>
                  <div style={{padding:"10px 12px",background:"rgba(239,68,68,.05)",border:`1px solid ${T.red}22`,borderRadius:8,color:T.red,fontSize:12,fontFamily:"'JetBrains Mono',monospace",fontWeight:600}}>
                    {newTrade.stopLoss&&newTrade.entryPrice&&parseFloat(newTrade.entryPrice)>0?((parseFloat(newTrade.stopLoss)-parseFloat(newTrade.entryPrice))/parseFloat(newTrade.entryPrice)*100).toFixed(2)+"%":"—"}
                  </div>
                </div>
                {/* TP 1 */}
                <div style={{display:"grid",gridTemplateColumns:"80px 1fr 1fr",gap:8,marginBottom:8,alignItems:"center"}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#22C55E",display:"flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",background:"#22C55E",display:"inline-block"}}/>TP 1</div>
                  <input type="number" value={newTrade.tp1} onChange={e=>setNewTrade(p=>({...p,tp1:e.target.value}))} placeholder="0.00" style={{padding:"10px 12px",background:T.bgInput,border:`1px solid #22C55E44`,borderRadius:8,color:"#22C55E",fontSize:13,fontWeight:600,outline:"none",fontFamily:"'JetBrains Mono',monospace",width:"100%"}}/>
                  <input type="number" value={newTrade.tp1Amount||""} onChange={e=>setNewTrade(p=>({...p,tp1Amount:e.target.value}))} placeholder="Miktar" style={{padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace",width:"100%"}}/>
                </div>
                {/* TP 2 */}
                <div style={{display:"grid",gridTemplateColumns:"80px 1fr 1fr",gap:8,marginBottom:8,alignItems:"center"}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#10B981",display:"flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",background:"#10B981",display:"inline-block"}}/>TP 2</div>
                  <input type="number" value={newTrade.tp2} onChange={e=>setNewTrade(p=>({...p,tp2:e.target.value}))} placeholder="Opsiyonel" style={{padding:"10px 12px",background:T.bgInput,border:`1px solid #10B98133`,borderRadius:8,color:"#10B981",fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace",width:"100%"}}/>
                  <input type="number" value={newTrade.tp2Amount||""} onChange={e=>setNewTrade(p=>({...p,tp2Amount:e.target.value}))} placeholder="Miktar" style={{padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace",width:"100%"}}/>
                </div>
                {/* TP 3 */}
                <div style={{display:"grid",gridTemplateColumns:"80px 1fr 1fr",gap:8,marginBottom:12,alignItems:"center"}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#06B6D4",display:"flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",background:"#06B6D4",display:"inline-block"}}/>TP 3</div>
                  <input type="number" value={newTrade.tp3} onChange={e=>setNewTrade(p=>({...p,tp3:e.target.value}))} placeholder="Opsiyonel" style={{padding:"10px 12px",background:T.bgInput,border:`1px solid #06B6D433`,borderRadius:8,color:"#06B6D4",fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace",width:"100%"}}/>
                  <input type="number" value={newTrade.tp3Amount||""} onChange={e=>setNewTrade(p=>({...p,tp3Amount:e.target.value}))} placeholder="Miktar" style={{padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace",width:"100%"}}/>
                </div>
                {/* Çıkış Fiyatı — TP'ler + SL butonları ile */}
                <div style={{paddingTop:12,borderTop:`1px solid ${T.border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <div style={{fontSize:11,color:T.textMuted,fontWeight:700,textTransform:"uppercase",letterSpacing:.5}}>🚪 Çıkış Fiyatı</div>
                    <div style={{fontSize:10,color:T.textMuted}}>TP veya SL'ye tıkla → otomatik dolar</div>
                  </div>
                  <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
                    {/* SL Butonu */}
                    {newTrade.stopLoss&&parseFloat(newTrade.stopLoss)>0&&(
                      <button onClick={()=>setNewTrade(p=>({...p,exitPrice:parseFloat(p.stopLoss).toFixed(parseFloat(p.stopLoss)<1?6:4),status:"Kapali"}))}
                        style={{padding:"7px 14px",background:newTrade.exitPrice===String(parseFloat(newTrade.stopLoss).toFixed(parseFloat(newTrade.stopLoss)<1?6:4))?"rgba(239,68,68,.2)":"rgba(239,68,68,.06)",
                          border:`2px solid ${newTrade.exitPrice===String(parseFloat(newTrade.stopLoss).toFixed(parseFloat(newTrade.stopLoss)<1?6:4))?T.red:T.red+"44"}`,
                          borderRadius:8,color:T.red,fontSize:11,fontWeight:700,cursor:"pointer",transition:"all .15s",display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
                        <span>🛑 Stop</span>
                        <span style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace"}}>${parseFloat(newTrade.stopLoss).toFixed(2)}</span>
                      </button>
                    )}
                    {/* TP Butonları */}
                    {[{k:"tp1",l:"TP1",c:"#22C55E"},{k:"tp2",l:"TP2",c:"#10B981"},{k:"tp3",l:"TP3",c:"#06B6D4"}].filter(tp=>newTrade[tp.k]&&parseFloat(newTrade[tp.k])>0).map(tp=>(
                      <button key={tp.k} onClick={()=>setNewTrade(p=>({...p,exitPrice:parseFloat(p[tp.k]).toFixed(parseFloat(p[tp.k])<1?6:4),status:"Kapali"}))}
                        style={{padding:"7px 14px",background:newTrade.exitPrice===String(parseFloat(newTrade[tp.k]).toFixed(parseFloat(newTrade[tp.k])<1?6:4))?"rgba(34,197,94,.2)":"rgba(34,197,94,.06)",
                          border:`2px solid ${newTrade.exitPrice===String(parseFloat(newTrade[tp.k]).toFixed(parseFloat(newTrade[tp.k])<1?6:4))?tp.c:tp.c+"44"}`,
                          borderRadius:8,color:tp.c,fontSize:11,fontWeight:700,cursor:"pointer",transition:"all .15s",display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
                        <span>✓ {tp.l}</span>
                        <span style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace"}}>${parseFloat(newTrade[tp.k]).toFixed(2)}</span>
                      </button>
                    ))}
                    {/* TP Ortalaması */}
                    {[newTrade.tp1,newTrade.tp2,newTrade.tp3].filter(v=>parseFloat(v||0)>0).length>1&&(
                      <button onClick={()=>{
                        const tps=[parseFloat(newTrade.tp1||0),parseFloat(newTrade.tp2||0),parseFloat(newTrade.tp3||0)].filter(v=>v>0);
                        const tpAmts=[parseFloat(newTrade.tp1Amount||0),parseFloat(newTrade.tp2Amount||0),parseFloat(newTrade.tp3Amount||0)].filter((a,i)=>[parseFloat(newTrade.tp1||0),parseFloat(newTrade.tp2||0),parseFloat(newTrade.tp3||0)][i]>0&&a>0);
                        const avg=tpAmts.length===tps.length?tps.reduce((s,p,j)=>s+p*tpAmts[j],0)/tpAmts.reduce((s,a)=>s+a,0):tps.reduce((s,p)=>s+p,0)/tps.length;
                        setNewTrade(p=>({...p,exitPrice:avg.toFixed(avg<1?6:4),status:"Kapali"}));
                      }} style={{padding:"7px 14px",background:"rgba(147,51,234,.06)",border:"2px solid #9333EA44",borderRadius:8,color:T.accent,fontSize:11,fontWeight:700,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
                        <span>∑ Ortalama</span>
                        <span style={{fontSize:10,color:T.textMuted}}>Tüm TP'ler</span>
                      </button>
                    )}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <input type="number" value={newTrade.exitPrice} onChange={e=>setNewTrade(p=>({...p,exitPrice:e.target.value}))} placeholder="Manuel giriş..." style={{padding:"10px 12px",background:T.bgInput,border:`1px solid ${newTrade.exitPrice?T.accent+"44":T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace",transition:"border-color .2s",width:"100%"}}/>
                    {newTrade.exitPrice&&newTrade.entryPrice&&parseFloat(newTrade.entryPrice)>0&&(
                      <div style={{padding:"8px 12px",background:(newTrade.direction==="Long"?parseFloat(newTrade.exitPrice)>=parseFloat(newTrade.entryPrice):parseFloat(newTrade.exitPrice)<=parseFloat(newTrade.entryPrice))?"rgba(34,197,94,.08)":"rgba(239,68,68,.08)",border:`1px solid ${(newTrade.direction==="Long"?parseFloat(newTrade.exitPrice)>=parseFloat(newTrade.entryPrice):parseFloat(newTrade.exitPrice)<=parseFloat(newTrade.entryPrice))?"#22C55E":"#EF4444"}33`,borderRadius:8,display:"flex",gap:16,alignItems:"center"}}>
                        <div style={{display:"flex",flexDirection:"column",gap:2}}>
                          <div style={{fontSize:10,color:T.textMuted}}>K/Z</div>
                          <div style={{fontSize:16,fontWeight:800,fontFamily:"'JetBrains Mono',monospace",color:(newTrade.direction==="Long"?parseFloat(newTrade.exitPrice)>=parseFloat(newTrade.entryPrice):parseFloat(newTrade.exitPrice)<=parseFloat(newTrade.entryPrice))?"#22C55E":"#EF4444"}}>
                            {(newTrade.direction==="Long"?(parseFloat(newTrade.exitPrice)-parseFloat(newTrade.entryPrice))/parseFloat(newTrade.entryPrice)*parseFloat(newTrade.amount||0)*(parseFloat(newTrade.leverage)||1):(parseFloat(newTrade.entryPrice)-parseFloat(newTrade.exitPrice))/parseFloat(newTrade.entryPrice)*parseFloat(newTrade.amount||0)*(parseFloat(newTrade.leverage)||1))>=0?"+":""}
                            {Math.abs((newTrade.direction==="Long"?(parseFloat(newTrade.exitPrice)-parseFloat(newTrade.entryPrice))/parseFloat(newTrade.entryPrice)*parseFloat(newTrade.amount||0)*(parseFloat(newTrade.leverage)||1):(parseFloat(newTrade.entryPrice)-parseFloat(newTrade.exitPrice))/parseFloat(newTrade.entryPrice)*parseFloat(newTrade.amount||0)*(parseFloat(newTrade.leverage)||1))).toFixed(2)}$
                          </div>
                          <div style={{fontSize:11,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:(newTrade.direction==="Long"?parseFloat(newTrade.exitPrice)>=parseFloat(newTrade.entryPrice):parseFloat(newTrade.exitPrice)<=parseFloat(newTrade.entryPrice))?"#22C55E99":"#EF444499"}}>
                            {(newTrade.direction==="Long"?(parseFloat(newTrade.exitPrice)-parseFloat(newTrade.entryPrice))/parseFloat(newTrade.entryPrice)*100*(parseFloat(newTrade.leverage)||1):(parseFloat(newTrade.entryPrice)-parseFloat(newTrade.exitPrice))/parseFloat(newTrade.entryPrice)*100*(parseFloat(newTrade.leverage)||1))>=0?"+":""}
                            {Math.abs((newTrade.direction==="Long"?(parseFloat(newTrade.exitPrice)-parseFloat(newTrade.entryPrice))/parseFloat(newTrade.entryPrice)*100*(parseFloat(newTrade.leverage)||1):(parseFloat(newTrade.entryPrice)-parseFloat(newTrade.exitPrice))/parseFloat(newTrade.entryPrice)*100*(parseFloat(newTrade.leverage)||1))).toFixed(2)}%
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Tarihler + Notlar + Puanlama — BİRLEŞİK KART */}
              <div style={{...st.card,borderLeft:"3px solid #8B5CF6",padding:0,overflow:"hidden"}}>
                {/* Sekme başlıkları */}
                <div style={{display:"flex",borderBottom:`1px solid ${T.border}`,background:T.bgCardSolid+"aa"}}>
                  {[["dates","📅 Tarihler"],["notes","📝 Notlar"],["score","⭐ Puanlama"]].map(([k,l])=>(
                    <button key={k} onClick={()=>setNewTrade(p=>({...p,_tab:k}))}
                      style={{flex:1,padding:"12px 8px",border:"none",background:"transparent",fontSize:12,fontWeight:newTrade._tab===k||(!newTrade._tab&&k==="dates")?700:500,
                        color:newTrade._tab===k||(!newTrade._tab&&k==="dates")?T.accent:T.textMuted,
                        cursor:"pointer",borderBottom:`2px solid ${newTrade._tab===k||(!newTrade._tab&&k==="dates")?T.accent:"transparent"}`,
                        transition:"all .2s",fontFamily:"'Inter',sans-serif"}}>
                      {l}
                    </button>
                  ))}
                </div>
                <div style={{padding:20}}>
                  {/* Tarihler sekmesi */}
                  {(newTrade._tab==="dates"||!newTrade._tab)&&(
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,animation:"fadeUp .3s ease-out"}}>
                      <div><div style={{fontSize:11,color:T.textMuted,marginBottom:6,fontWeight:500}}>Giriş Tarihi</div><input type="datetime-local" value={newTrade.entryDate} onChange={e=>setNewTrade(p=>({...p,entryDate:e.target.value}))} style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}}/></div>
                      <div><div style={{fontSize:11,color:T.textMuted,marginBottom:6,fontWeight:500}}>Çıkış Tarihi</div><input type="datetime-local" value={newTrade.exitDate} onChange={e=>setNewTrade(p=>({...p,exitDate:e.target.value}))} style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}}/></div>
                      <div><div style={{fontSize:11,color:T.textMuted,marginBottom:6,fontWeight:500}}>Strateji</div><select value={newTrade.strategy} onChange={e=>setNewTrade(p=>({...p,strategy:e.target.value}))} style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}}><option value="">Seç...</option><option>Breakout</option><option>Pullback</option><option>Trend Following</option><option>Range</option><option>Scalp</option><option>Swing</option><option>News</option><option>Diğer</option></select></div>
                      <div><div style={{fontSize:11,color:T.textMuted,marginBottom:6,fontWeight:500}}>Etiketler</div><input value={newTrade.tags} onChange={e=>setNewTrade(p=>({...p,tags:e.target.value}))} placeholder="scalp, haber, kırılım" style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}}/></div>
                    </div>
                  )}
                  {/* Notlar sekmesi */}
                  {newTrade._tab==="notes"&&(
                    <div style={{animation:"fadeUp .3s ease-out"}}>
                      <div style={{marginBottom:12}}><div style={{fontSize:11,color:T.textMuted,marginBottom:6,fontWeight:500}}>📋 Notlar</div><textarea value={newTrade.notes} onChange={e=>setNewTrade(p=>({...p,notes:e.target.value}))} placeholder="Trade sebebi, piyasa koşulları, analiz..." rows={3} style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none",resize:"vertical",fontFamily:"'Inter',sans-serif"}}/></div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                        <div><div style={{fontSize:11,color:T.red,marginBottom:6,fontWeight:600}}>⚠ Hatalar</div><input value={newTrade.mistakes||""} onChange={e=>setNewTrade(p=>({...p,mistakes:e.target.value}))} placeholder="Yaptığın hatalar..." style={{width:"100%",padding:"10px 12px",background:"rgba(239,68,68,.04)",border:`1px solid ${T.red}22`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}}/></div>
                        <div><div style={{fontSize:11,color:T.green,marginBottom:6,fontWeight:600}}>💡 Öğrenilen Dersler</div><input value={newTrade.lessons} onChange={e=>setNewTrade(p=>({...p,lessons:e.target.value}))} placeholder="Bu tradeden ne öğrendin?" style={{width:"100%",padding:"10px 12px",background:"rgba(34,197,94,.04)",border:`1px solid ${T.green}22`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}}/></div>
                      </div>
                    </div>
                  )}
                  {/* Puanlama sekmesi */}
                  {newTrade._tab==="score"&&(
                    <div style={{animation:"fadeUp .3s ease-out"}}>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
                        <div>
                          <div style={{fontSize:11,color:T.textMuted,marginBottom:8,fontWeight:500}}>Genel Puan</div>
                          <div style={{display:"flex",gap:3}}>
                            {[1,2,3,4,5,6,7,8,9,10].map(n=>(
                              <button key={n} onClick={()=>setNewTrade(p=>({...p,score:n}))}
                                style={{flex:1,height:34,borderRadius:6,border:`1px solid ${n<=newTrade.score?T.accent+"66":T.border}`,
                                  background:n<=newTrade.score?`rgba(147,51,234,${0.08+n*0.015})`:T.bgInput,
                                  color:n<=newTrade.score?T.accent:T.textMuted,fontSize:11,fontWeight:700,cursor:"pointer",
                                  transition:"all .15s",transform:n===newTrade.score?"scale(1.1)":"scale(1)"}}>
                                {n}
                              </button>
                            ))}
                          </div>
                          <div style={{marginTop:6,fontSize:11,color:T.textMuted}}>
                            Seçilen: <span style={{color:newTrade.score>=7?T.green:newTrade.score>=4?T.gold:T.red,fontWeight:700}}>{newTrade.score}/10 {newTrade.score>=8?"🔥":newTrade.score>=6?"✓":newTrade.score>=4?"→":"✗"}</span>
                          </div>
                        </div>
                        <div>
                          <div style={{fontSize:11,color:T.textMuted,marginBottom:8,fontWeight:500}}>Setup Kalitesi</div>
                          <div style={{display:"flex",gap:6}}>
                            {[["A+","#22C55E"],["A","#9333EA"],["B","#EAB308"],["C","#EF4444"]].map(([q,clr])=>(
                              <button key={q} onClick={()=>setNewTrade(p=>({...p,setupQuality:q==="A+"?"A+ Mükemmel":q==="A"?"A İyi":q==="B"?"B Orta":"C Zayıf"}))}
                                style={{flex:1,padding:"10px 4px",borderRadius:8,border:`1px solid ${newTrade.setupQuality&&newTrade.setupQuality.startsWith(q)?clr+"66":T.border}`,
                                  background:newTrade.setupQuality&&newTrade.setupQuality.startsWith(q)?clr+"18":T.bgInput,
                                  color:newTrade.setupQuality&&newTrade.setupQuality.startsWith(q)?clr:T.textMuted,
                                  fontSize:13,fontWeight:700,cursor:"pointer",transition:"all .15s"}}>
                                {q}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div style={{fontSize:11,color:T.textMuted,marginBottom:8,fontWeight:500}}>Plana Uyuldu?</div>
                          <div style={{display:"flex",gap:8}}>
                            {[{v:true,l:"✓ Evet",c:T.green},{v:false,l:"✗ Hayır",c:T.red}].map(o=>(
                              <button key={String(o.v)} onClick={()=>setNewTrade(p=>({...p,followedPlan:o.v}))}
                                style={{flex:1,padding:"11px",borderRadius:8,border:`1px solid ${newTrade.followedPlan===o.v?o.c+"44":T.border}`,
                                  background:newTrade.followedPlan===o.v?o.c+"18":T.bgInput,
                                  color:newTrade.followedPlan===o.v?o.c:T.textMuted,
                                  fontSize:13,fontWeight:700,cursor:"pointer",transition:"all .2s",
                                  boxShadow:newTrade.followedPlan===o.v?`0 2px 12px ${o.c}22`:"none"}}>
                                {o.l}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div style={{fontSize:11,color:T.textMuted,marginBottom:8,fontWeight:500}}>Duygu Durumu</div>
                          <select value={newTrade.emotion} onChange={e=>setNewTrade(p=>({...p,emotion:e.target.value}))} style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}}>
                            <option value="">Seç...</option><option>Sakin</option><option>Heyecanlı</option><option>Korkulu</option><option>Açgözlü</option><option>Sabırsız</option><option>Kararsız</option><option>Güvenli</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 📸 Trade Görseli */}
              <div style={{...st.card,borderLeft:`3px solid #8B5CF6`}}>
                <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <span style={{display:"flex",alignItems:"center",gap:8}}>📸 Trade Görseli</span>
                  {!newTrade.screenshot&&(
                    <span style={{fontSize:11,color:T.textMuted,fontWeight:400}}>TradingView'den kopyala → Ctrl+V</span>
                  )}
                </div>
                {newTrade.screenshot
                  ? <div style={{position:"relative"}}>
                      <img src={newTrade.screenshot} alt="trade"
                        onClick={()=>setLightboxSrc(newTrade.screenshot)}
                        style={{width:"100%",maxHeight:400,objectFit:"contain",borderRadius:10,border:`1px solid ${T.border}`,background:T.bgCardSolid,cursor:"zoom-in",transition:"opacity .2s"}}
                        onMouseEnter={e=>e.target.style.opacity=".85"} onMouseLeave={e=>e.target.style.opacity="1"}/>
                      <button onClick={()=>setNewTrade(p=>({...p,screenshot:""}))}
                        style={{position:"absolute",top:8,right:8,width:28,height:28,borderRadius:6,background:"rgba(239,68,68,.85)",border:"none",color:"#fff",fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
                    </div>
                  : <div
                      tabIndex={0}
                      onFocus={()=>setScreenshotPasteActive(true)}
                      onBlur={()=>setScreenshotPasteActive(false)}
                      onPaste={e=>{
                        const items=e.clipboardData.items;
                        for(let i=0;i<items.length;i++){
                          if(items[i].type.startsWith("image/")){
                            const file=items[i].getAsFile();
                            const reader=new FileReader();
                            reader.onload=ev=>setNewTrade(p=>({...p,screenshot:ev.target.result}));
                            reader.readAsDataURL(file);
                            break;
                          }
                        }
                      }}
                      style={{
                        outline:"none",
                        display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,
                        padding:"32px 20px",borderRadius:10,
                        border:`2px dashed ${screenshotPasteActive?T.accent:T.border}`,
                        background:screenshotPasteActive?T.accentGlow:"transparent",
                        transition:"all .2s",cursor:"text"
                      }}
                      onClick={e=>e.currentTarget.focus()}>
                      <div style={{width:56,height:56,borderRadius:14,background:screenshotPasteActive?T.accentGlow:T.bgInput,border:`1px solid ${screenshotPasteActive?T.accent+"44":T.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,transition:"all .2s"}}>
                        {screenshotPasteActive?"📋":"📸"}
                      </div>
                      <div style={{textAlign:"center"}}>
                        <div style={{fontSize:14,fontWeight:700,color:screenshotPasteActive?T.accent:T.textSecondary,marginBottom:4,transition:"color .2s"}}>
                          {screenshotPasteActive?"Şimdi Ctrl+V ile yapıştır":"Buraya tıkla ve Ctrl+V"}
                        </div>
                        <div style={{fontSize:11,color:T.textMuted,lineHeight:1.6}}>
                          TradingView'de <kbd style={{padding:"1px 5px",borderRadius:3,background:T.bgInput,border:`1px solid ${T.border}`,fontSize:10,fontFamily:"'JetBrains Mono',monospace"}}>Alt+S</kbd> ile screenshot al
                          <br/>ardından bu alana tıkla ve <kbd style={{padding:"1px 5px",borderRadius:3,background:T.bgInput,border:`1px solid ${T.border}`,fontSize:10,fontFamily:"'JetBrains Mono',monospace"}}>Ctrl+V</kbd> ile yapıştır
                        </div>
                      </div>
                      {/* Dosya yükleme alternatifi */}
                      <label style={{fontSize:10,color:T.textMuted,cursor:"pointer",textDecoration:"underline",textUnderlineOffset:3}}>
                        veya dosyadan seç
                        <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{
                          const file=e.target.files[0];
                          if(!file) return;
                          const reader=new FileReader();
                          reader.onload=ev=>setNewTrade(p=>({...p,screenshot:ev.target.result}));
                          reader.readAsDataURL(file);
                        }}/>
                      </label>
                    </div>
                }
              </div>

              {/* Kaydet */}
              <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                <button onClick={()=>{resetNewTrade();setEditTrade(null);setTradeView("list");}} style={{padding:"12px 24px",background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:10,color:T.textMuted,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>İptal</button>
                <button onClick={saveTrade} style={{padding:"12px 32px",background:"linear-gradient(135deg,#9333EA,#D4A017)",border:"none",borderRadius:10,color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'Inter',sans-serif",boxShadow:"0 4px 20px rgba(147,51,234,.25)"}}>{editTrade!==null?"Güncelle":"Trade Kaydet"}</button>
              </div>
            </div>
          </div>}

          {/* ═══ ANALYTICS ═══ */}
          {tradeView==="analytics"&&<div style={{animation:"fadeUp .4s ease-out"}}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16}}>
              {[
                {label:"Toplam K/Z",val:(totalPnl>=0?"+":"")+"$"+totalPnl.toFixed(2),sub:winRate.toFixed(1)+"% kazanma",color:totalPnl>=0?T.green:T.red,bg:totalPnl>=0?"rgba(34,197,94,.08)":"rgba(239,68,68,.08)",icon:"💰"},
                {label:"Toplam Hacim",val:"$"+(tradeVolume>=1000?(tradeVolume/1000).toFixed(1)+"K":tradeVolume.toFixed(0)),sub:trades.length+" trade",color:"#3b82f6",bg:"rgba(59,130,246,.08)",icon:"📊"},
                {label:"Profit Factor",val:profitFactor.toFixed(2),sub:"R/Ö: "+(avgLoss>0?(avgWin/avgLoss).toFixed(2):"—"),color:T.accent,bg:"rgba(147,51,234,.08)",icon:"🎯"},
                {label:"Açık Pozisyon",val:String(openTrades.length),sub:"trade açık",color:T.gold,bg:"rgba(212,160,23,.08)",icon:"⚡"},
              ].map((k,i)=>(
                <div key={i} style={{...st.card,background:k.bg,border:`1px solid ${k.color}22`,padding:18}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                    <div style={{fontSize:11,color:T.textMuted}}>{k.label}</div>
                    <span style={{fontSize:18}}>{k.icon}</span>
                  </div>
                  <div style={{fontSize:22,fontWeight:800,fontFamily:"'JetBrains Mono',monospace",color:k.color,marginBottom:4}}>{k.val}</div>
                  <div style={{fontSize:11,color:T.textMuted}}>{k.sub}</div>
                </div>
              ))}
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

            {/* Detay İstatistikler */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
              {[
                {l:"En İyi Trade",v:"+$"+(closedTrades.length>0?Math.max(...closedTrades.map(t=>calcPnl(t))).toFixed(2):"0.00"),c:T.green},
                {l:"En Kötü Trade",v:"-$"+(closedTrades.length>0?Math.abs(Math.min(...closedTrades.map(t=>calcPnl(t)))).toFixed(2):"0.00"),c:T.red},
                {l:"Ort. Kazanç",v:"$"+avgWin.toFixed(2),c:T.green},
                {l:"Ort. Kayıp",v:"$"+avgLoss.toFixed(2),c:T.red},
                {l:"Max Drawdown",v:"$"+maxDrawdown.toFixed(2),c:T.red},
                {l:"Beklenti",v:"$"+(closedTrades.length>0?(totalPnl/closedTrades.length).toFixed(2):"0.00"),c:T.gold},
                {l:"Ort. Süre",v:avgDuration+"s",c:"#8B5CF6"},
                {l:"Toplam Hacim",v:"$"+(tradeVolume>=1000?(tradeVolume/1000).toFixed(1)+"K":tradeVolume.toFixed(0)),c:"#3b82f6"},
              ].map((k,i)=>(
                <div key={i} style={{...st.card,padding:14}}>
                  <div style={{fontSize:10,color:T.textMuted,marginBottom:4}}>{k.l}</div>
                  <div style={{fontSize:15,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:k.c}}>{k.v}</div>
                </div>
              ))}
            </div>
            {/* Long/Short + Piyasa */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
              <div style={{...st.card,padding:16}}>
                <div style={{fontSize:13,fontWeight:700,color:T.text,marginBottom:12}}>📐 Long / Short</div>
                <div style={{display:"flex",gap:12}}>
                  {[["Long",longCount,T.green],["Short",shortCount,T.red]].map(([l,n,clr])=>(
                    <div key={l} style={{flex:1,padding:14,background:clr+"0a",border:`1px solid ${clr}22`,borderRadius:10,textAlign:"center"}}>
                      <div style={{fontSize:11,color:clr,marginBottom:4,fontWeight:600}}>{l}</div>
                      <div style={{fontSize:24,fontWeight:800,fontFamily:"'JetBrains Mono',monospace",color:clr}}>{n}</div>
                      <div style={{fontSize:10,color:T.textMuted}}>{trades.length>0?(n/trades.length*100).toFixed(0):0}%</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{...st.card,padding:16}}>
                <div style={{fontSize:13,fontWeight:700,color:T.text,marginBottom:12}}>📊 Piyasa Dağılımı</div>
                {Object.entries(tradesByMarket).map(([m,cnt])=>(
                  <div key={m} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                    <span style={{fontSize:12,color:T.textSecondary,minWidth:60}}>{m}</span>
                    <div style={{flex:1,height:6,background:T.border,borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:(trades.length>0?cnt/trades.length*100:0)+"%",background:T.accent,borderRadius:3}}/></div>
                    <span style={{fontSize:11,fontFamily:"'JetBrains Mono',monospace",color:T.accent,minWidth:50,textAlign:"right"}}>{cnt} ({(trades.length>0?cnt/trades.length*100:0).toFixed(0)}%)</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Setup Tipi Başarı Oranı */}
            {trades.filter(t=>t.strategy&&t.strategy!=="").length>0&&(
              <div style={{...st.card,marginTop:14,padding:16}}>
                <div style={{fontSize:13,fontWeight:700,color:T.text,marginBottom:14}}>🎯 Setup Tipi Başarı Oranı</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:8}}>
                  {Object.entries(trades.filter(t=>t.strategy&&t.status==="Kapali").reduce((acc,t)=>{
                    const k=t.strategy;
                    if(!acc[k]) acc[k]={total:0,wins:0,pnl:0};
                    acc[k].total++;
                    if(calcPnl(t)>0) acc[k].wins++;
                    acc[k].pnl+=calcPnl(t);
                    return acc;
                  },{})).sort((a,b)=>b[1].total-a[1].total).map(([strat,d])=>(
                    <div key={strat} style={{padding:"10px 12px",background:T.bgInput,borderRadius:8,border:`1px solid ${d.wins/d.total>=0.6?T.green:d.wins/d.total>=0.4?T.gold:T.red}33`}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                        <span style={{fontSize:12,fontWeight:700,color:T.text}}>{strat}</span>
                        <span style={{fontSize:11,fontWeight:800,fontFamily:"'JetBrains Mono',monospace",color:d.wins/d.total>=0.6?T.green:d.wins/d.total>=0.4?T.gold:T.red}}>{(d.wins/d.total*100).toFixed(0)}%</span>
                      </div>
                      <div style={{height:4,background:T.border,borderRadius:2,marginBottom:6,overflow:"hidden"}}>
                        <div style={{height:"100%",width:(d.wins/d.total*100)+"%",background:d.wins/d.total>=0.6?T.green:d.wins/d.total>=0.4?T.gold:T.red,borderRadius:2,transition:"width .5s"}}/>
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:T.textMuted}}>
                        <span>{d.wins}W / {d.total-d.wins}L — {d.total} trade</span>
                        <span style={{color:d.pnl>=0?T.green:T.red,fontFamily:"'JetBrains Mono',monospace",fontWeight:600}}>{d.pnl>=0?"+":""}{d.pnl.toFixed(0)}$</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 📅 Takvim */}
            <div style={{marginTop:20,borderTop:`1px solid ${T.border}`,paddingTop:20}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div style={{fontSize:15,fontWeight:700,color:T.text}}>📅 Trade Takvimi</div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <button onClick={()=>setCalendarMonth(p=>p.m===0?{y:p.y-1,m:11}:{y:p.y,m:p.m-1})}
                    style={{width:28,height:28,borderRadius:6,border:`1px solid ${T.border}`,background:T.bgCard,color:T.text,cursor:"pointer",fontSize:13}}>‹</button>
                  <span style={{fontSize:13,fontWeight:700,color:T.text,minWidth:130,textAlign:"center"}}>
                    {["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"][calendarMonth.m]} {calendarMonth.y}
                  </span>
                  <button onClick={()=>setCalendarMonth(p=>p.m===11?{y:p.y+1,m:0}:{y:p.y,m:p.m+1})}
                    style={{width:28,height:28,borderRadius:6,border:`1px solid ${T.border}`,background:T.bgCard,color:T.text,cursor:"pointer",fontSize:13}}>›</button>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3,marginBottom:4}}>
                {["Pzt","Sal","Çar","Per","Cum","Cmt","Paz"].map(d=>(
                  <div key={d} style={{fontSize:10,fontWeight:700,color:T.textMuted,textAlign:"center",padding:"5px 0",textTransform:"uppercase",letterSpacing:.5}}>{d}</div>
                ))}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3}}>
                {calCells.map((day,ci)=>{
                  const dateStr=day?`${calY}-${String(calM+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`:"";
                  const dayTrades=day?trades.filter(t=>(t.entryDate||"").startsWith(dateStr)):[];
                  const dayPnl=dayTrades.filter(t=>t.status==="Kapali").reduce((s,t)=>s+calcPnl(t),0);
                  const openCnt=dayTrades.filter(t=>t.status==="Acik").length;
                  const closedCnt=dayTrades.filter(t=>t.status==="Kapali").length;
                  const isToday=day&&new Date().toISOString().startsWith(dateStr);
                  const hasWin=dayPnl>0;
                  const hasTrades=dayTrades.length>0;
                  return !day
                    ? <div key={ci} style={{height:80}}/>
                    : <div key={ci} style={{height:80,padding:"5px 7px",borderRadius:8,
                        border:`1px solid ${isToday?T.accent:hasTrades?(hasWin?T.green:dayPnl<0?T.red:T.border):T.border}`,
                        background:hasTrades?(hasWin?"rgba(34,197,94,.06)":dayPnl<0?"rgba(239,68,68,.06)":T.bgCard):T.bgCard,
                        boxShadow:isToday?`0 0 0 2px ${T.accent}44`:"none",transition:"all .15s"}}>
                      <div style={{fontSize:10,fontWeight:isToday?800:600,color:isToday?T.accent:T.textSecondary,marginBottom:3}}>{day}</div>
                      {hasTrades&&<div style={{display:"flex",flexDirection:"column",gap:2}}>
                        {closedCnt>0&&<div style={{fontSize:9,fontWeight:800,fontFamily:"'JetBrains Mono',monospace",color:hasWin?T.green:T.red}}>{dayPnl>=0?"+":""}{dayPnl.toFixed(0)}$</div>}
                        <div style={{display:"flex",gap:2}}>
                          {closedCnt>0&&<span style={{fontSize:8,padding:"1px 3px",borderRadius:2,background:hasWin?"rgba(34,197,94,.15)":"rgba(239,68,68,.15)",color:hasWin?T.green:T.red,fontWeight:700}}>{closedCnt}k</span>}
                          {openCnt>0&&<span style={{fontSize:8,padding:"1px 3px",borderRadius:2,background:"rgba(234,179,8,.15)",color:T.gold,fontWeight:700}}>{openCnt}a</span>}
                        </div>
                      </div>}
                    </div>;
                })}
              </div>
              {calMonthTrades.length>0&&(
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginTop:12}}>
                  {[
                    {l:"Ay K/Z",v:(calMonthPnl>=0?"+":"")+calMonthPnl.toFixed(0)+"$",c:calMonthPnl>=0?T.green:T.red},
                    {l:"Trade Sayısı",v:String(calMonthTrades.length),c:T.text},
                    {l:"Kazanma",v:calMonthClosed>0?(calMonthWins/calMonthClosed*100).toFixed(0)+"%":"—",c:T.accent},
                    {l:"Trade Günü",v:String(calTradeDays),c:T.gold},
                  ].map((k,i)=>(
                    <div key={i} style={{...st.card,padding:12,textAlign:"center"}}>
                      <div style={{fontSize:9,color:T.textMuted,marginBottom:3}}>{k.l}</div>
                      <div style={{fontSize:15,fontWeight:800,fontFamily:"'JetBrains Mono',monospace",color:k.c}}>{k.v}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>}

          {tradeView==="notes"&&<div style={{animation:"fadeUp .4s ease-out"}}>
            <div style={{marginBottom:20}}>
              <div style={{fontSize:20,fontWeight:700,color:T.text,marginBottom:4}}>📝 Trade Notları & Hatalar</div>
              <div style={{fontSize:13,color:T.textMuted}}>Tüm tradelerden çıkan notlar, hatalar ve dersler</div>
            </div>
            {trades.filter(t=>t.notes||t.mistakes||t.lessons).length===0
              ? <div style={{...st.card,padding:60,textAlign:"center"}}><div style={{fontSize:40,marginBottom:12}}>📝</div><div style={{fontSize:16,fontWeight:600,color:T.text,marginBottom:4}}>Henüz not yok</div><div style={{fontSize:13,color:T.textMuted}}>Trade eklerken not ve hata alanlarını doldur</div></div>
              : <div style={{display:"flex",flexDirection:"column",gap:12}}>
                {trades.filter(t=>t.notes||t.mistakes||t.lessons).map((t,i)=>(
                    <div key={t.id||i} style={{...st.card,padding:0,overflow:"hidden",borderLeft:`3px solid ${t.status==="Kapali"?(calcPnl(t)>0?T.green:T.red):T.gold}`}}>
                      {t.screenshot&&<div style={{height:180,overflow:"hidden",borderBottom:`1px solid ${T.border}`,position:"relative",cursor:"pointer"}} onClick={()=>window.open(t.screenshot,"_blank")}>
                        <img src={t.screenshot} alt=""
                          onClick={()=>setLightboxSrc(t.screenshot)}
                          style={{width:"100%",height:"100%",objectFit:"cover",cursor:"zoom-in",transition:"transform .2s"}}
                          onMouseEnter={e=>e.target.style.transform="scale(1.02)"} onMouseLeave={e=>e.target.style.transform="scale(1)"}/>
                        <div style={{position:"absolute",inset:0,background:"linear-gradient(to bottom,transparent 60%,rgba(0,0,0,.35))",pointerEvents:"none"}}/>
                        <div style={{position:"absolute",bottom:8,right:8,fontSize:10,padding:"3px 8px",borderRadius:4,background:"rgba(0,0,0,.6)",color:"#fff",pointerEvents:"none"}}>🔍 Büyüt</div>
                      </div>}
                      <div style={{padding:"12px 16px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:13,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:T.text}}>{t.symbol}</span>
                          <span style={{fontSize:9,padding:"2px 7px",borderRadius:3,background:t.direction==="Long"?"#22C55E18":"#EF444418",color:t.direction==="Long"?"#22C55E":"#EF4444",fontWeight:700}}>{t.direction}</span>
                          {t.emotion&&<span style={{fontSize:10,padding:"2px 7px",borderRadius:3,background:"#8B5CF618",color:"#8B5CF6"}}>{t.emotion}</span>}
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:12}}>
                          {t.entryDate&&<span style={{fontSize:11,color:T.textMuted,fontFamily:"'JetBrains Mono',monospace"}}>{new Date(t.entryDate).toLocaleDateString("tr-TR",{day:"2-digit",month:"short",year:"numeric"})}</span>}
                          {t.status==="Kapali"&&<span style={{fontSize:12,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:calcPnl(t)>0?T.green:T.red}}>{calcPnl(t)>0?"+":""}{calcPnl(t).toFixed(2)}$</span>}
                        </div>
                      </div>
                      <div style={{padding:"14px 16px",display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
                        {t.notes&&<div><div style={{fontSize:10,fontWeight:700,color:T.accent,textTransform:"uppercase",letterSpacing:.5,marginBottom:6}}>📋 Not</div><div style={{fontSize:12,color:T.textSecondary,lineHeight:1.6,background:T.bgInput,padding:"8px 10px",borderRadius:7,border:`1px solid ${T.border}`}}>{t.notes}</div></div>}
                        {t.mistakes&&<div><div style={{fontSize:10,fontWeight:700,color:T.red,textTransform:"uppercase",letterSpacing:.5,marginBottom:6}}>⚠ Hatalar</div><div style={{fontSize:12,color:T.textSecondary,lineHeight:1.6,background:"rgba(239,68,68,.04)",padding:"8px 10px",borderRadius:7,border:`1px solid ${T.red}22`}}>{t.mistakes}</div></div>}
                        {t.lessons&&<div><div style={{fontSize:10,fontWeight:700,color:T.green,textTransform:"uppercase",letterSpacing:.5,marginBottom:6}}>💡 Dersler</div><div style={{fontSize:12,color:T.textSecondary,lineHeight:1.6,background:"rgba(34,197,94,.04)",padding:"8px 10px",borderRadius:7,border:`1px solid ${T.green}22`}}>{t.lessons}</div></div>}
                      </div>
                      {t.score&&<div style={{padding:"8px 16px",borderTop:`1px solid ${T.border}`,display:"flex",gap:14,alignItems:"center",background:T.bgCardSolid+"80"}}>
                        <span style={{fontSize:10,color:T.textMuted}}>Puan:</span>
                        <span style={{fontSize:12,fontWeight:700,color:t.score>=7?T.green:t.score>=4?T.gold:T.red}}>{t.score}/10</span>
                        {t.followedPlan!==undefined&&<><span style={{fontSize:10,color:T.textMuted}}>Plan:</span><span style={{fontSize:11,fontWeight:700,color:t.followedPlan?T.green:T.red}}>{t.followedPlan?"✓":"✕"}</span></>}
                        <button onClick={()=>{setNewTrade({...t});setEditTrade(i);setTradeView("add");}} style={{marginLeft:"auto",padding:"4px 12px",background:T.bgCardSolid,border:`1px solid ${T.borderLight}`,borderRadius:5,color:T.textSecondary,fontSize:10,cursor:"pointer"}}>✎ Düzenle</button>
                      </div>}
                    </div>
                ))}
              </div>
            }
          </div>}
        </div>}



        {tab==="news"&&<div style={{animation:"fadeUp .4s ease-out"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
            <div>
              <div style={{fontSize:20,fontWeight:700,color:T.text}}>📰 Piyasa Haberleri</div>
              <div style={{fontSize:13,color:T.textMuted}}>CryptoPanic • CryptoCompare • Portföy Odaklı</div>
            </div>
            <button onClick={()=>fetchNews(newsFilter)} disabled={newsLoading}
              style={{padding:"8px 16px",background:T.bgCard,border:`1px solid ${T.border}`,color:T.accent,fontSize:12,fontWeight:600,cursor:"pointer",borderRadius:8,fontFamily:"'Inter',sans-serif",display:"flex",alignItems:"center",gap:6}}>
              {newsLoading?<span style={{animation:"spin 1s linear infinite",display:"inline-block"}}>◌</span>:"↻"} Yenile
            </button>
          </div>
          <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
            {[{v:"portfolio",l:"🎯 Portföyüm"},{v:"all",l:"🌐 Tümü"}].map(f=>(
              <button key={f.v} onClick={()=>setNewsFilter(f.v)}
                style={{padding:"7px 16px",background:newsFilter===f.v?"linear-gradient(135deg,#9333EA,#7C3AED)":T.bgCard,border:`1px solid ${newsFilter===f.v?"#9333EA44":T.border}`,color:newsFilter===f.v?"#fff":T.textSecondary,fontSize:12,fontWeight:600,cursor:"pointer",borderRadius:8,fontFamily:"'Inter',sans-serif",transition:"all .2s"}}>
                {f.l}
              </button>
            ))}
            {newsFilter==="portfolio"&&newsPortfolioCoins.length>0&&(
              <div style={{display:"flex",gap:4,flexWrap:"wrap",marginLeft:4}}>
                {newsPortfolioCoins.slice(0,12).map(s=>(
                  <span key={s} style={{fontSize:10,padding:"3px 8px",borderRadius:4,background:"#9333EA18",color:"#9333EA",fontWeight:700,fontFamily:"'JetBrains Mono',monospace"}}>{s}</span>
                ))}
              </div>
            )}
          </div>
          {!newsLoaded&&!newsLoading&&(
            <div style={{...st.card,padding:60,textAlign:"center"}}>
              <div style={{fontSize:48,marginBottom:16}}>📰</div>
              <div style={{fontSize:16,fontWeight:700,color:T.text,marginBottom:8}}>Haberleri Yükle</div>
              <div style={{fontSize:13,color:T.textMuted,marginBottom:20}}>Portföyündeki coinler: <span style={{color:"#9333EA",fontWeight:600}}>{newsPortfolioCoins.join(", ")||"—"}</span></div>
              <button onClick={()=>fetchNews("portfolio")} style={{padding:"12px 32px",background:"linear-gradient(135deg,#9333EA,#D4A017)",border:"none",borderRadius:10,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>🚀 Haberleri Yükle</button>
            </div>
          )}
          {newsLoading&&(
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:14}}>
              {[...Array(6)].map((_,i)=>(
                <div key={i} style={{...st.card,padding:16}}>
                  <div style={{height:150,background:T.border,borderRadius:8,marginBottom:12,animation:"skeletonPulse 1.5s infinite"}}/>
                  <div style={{height:13,background:T.border,borderRadius:4,marginBottom:8,width:"85%",animation:"skeletonPulse 1.5s infinite"}}/>
                  <div style={{height:11,background:T.border,borderRadius:4,width:"50%",animation:"skeletonPulse 1.5s infinite"}}/>
                </div>
              ))}
            </div>
          )}
          {newsLoaded&&!newsLoading&&(
            <div style={{fontSize:12,color:T.textMuted,marginBottom:12}}><span style={{color:T.textSecondary,fontWeight:600}}>{newsFiltered.length}</span> haber</div>
          )}
          {newsLoaded&&!newsLoading&&newsFiltered.length>0&&(
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:14}}>
              {newsFiltered.map((article,i)=>(
                <a key={article.id||i} href={article.url} target="_blank" rel="noopener noreferrer"
                  style={{textDecoration:"none",display:"block",...st.card,padding:0,overflow:"hidden",cursor:"pointer",
                    borderColor:article.isPortfolio?T.accent+"44":T.border,
                    transition:"transform .2s,border-color .2s,box-shadow .2s"}}
                  onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow="0 8px 32px rgba(0,0,0,.3)";e.currentTarget.style.borderColor=T.accent+"66";}}
                  onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="";e.currentTarget.style.borderColor=article.isPortfolio?T.accent+"44":T.border;}}>
                  {article.imageUrl?(
                    <div style={{height:150,overflow:"hidden",background:T.bgCardSolid,position:"relative"}}>
                      <img src={article.imageUrl} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{e.target.parentElement.style.display="none";}}/>
                      {article.isPortfolio&&<div style={{position:"absolute",top:8,right:8,fontSize:9,padding:"2px 7px",borderRadius:3,background:"rgba(147,51,234,.85)",color:"#fff",fontWeight:700}}>🎯 Portföy</div>}
                    </div>
                  ):(
                    <div style={{height:70,background:`linear-gradient(135deg,${T.accent}0d,${T.bgCardSolid})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,position:"relative"}}>
                      📰
                      {article.isPortfolio&&<div style={{position:"absolute",top:8,right:8,fontSize:9,padding:"2px 7px",borderRadius:3,background:"rgba(147,51,234,.85)",color:"#fff",fontWeight:700}}>🎯</div>}
                    </div>
                  )}
                  <div style={{padding:14}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <span style={{fontSize:10,fontWeight:700,color:T.accent,textTransform:"uppercase",letterSpacing:.5,maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{article.source}</span>
                      <span style={{fontSize:10,color:T.textMuted}}>{newsTimeAgo(article.publishedAt)}</span>
                    </div>
                    <div style={{fontSize:13,fontWeight:600,color:T.text,lineHeight:1.5,marginBottom:6,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{article.title}</div>
                    {article.body&&<div style={{fontSize:11,color:T.textMuted,lineHeight:1.6,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{article.body}</div>}
                  </div>
                </a>
              ))}
            </div>
          )}
          {newsLoaded&&!newsLoading&&newsFiltered.length===0&&(
            <div style={{...st.card,padding:48,textAlign:"center"}}>
              <div style={{fontSize:36,marginBottom:12}}>🔍</div>
              <div style={{fontSize:14,color:T.text,fontWeight:600,marginBottom:8}}>Portföy coinleri için haber bulunamadı</div>
              <button onClick={()=>setNewsFilter("all")} style={{padding:"8px 20px",background:T.accentGlow,border:`1px solid ${T.accent}44`,borderRadius:8,color:T.accent,fontSize:12,fontWeight:600,cursor:"pointer"}}>Tüm Haberlere Geç</button>
            </div>
          )}
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


      {/* 🔔 Toast Bildirimleri */}
      <div style={{position:"fixed",bottom:24,right:24,zIndex:10000,display:"flex",flexDirection:"column",gap:8,pointerEvents:"none"}}>
        {toasts.map(t=>(
          <div key={t.id} style={{
            padding:"12px 18px",borderRadius:10,fontSize:13,fontWeight:600,
            background:t.type==="error"?"#EF4444":t.type==="alert"?"#D4A017":"#22C55E",
            color:"#fff",boxShadow:"0 4px 20px rgba(0,0,0,.25)",
            animation:"slideInRight .3s cubic-bezier(.22,1,.36,1)",
            display:"flex",alignItems:"center",gap:8,maxWidth:320
          }}>
            <span>{t.type==="error"?"✕":t.type==="alert"?"🔔":"✓"}</span>
            {t.msg}
          </div>
        ))}
      </div>

      {/* ⌨️ Command Palette */}
      {cmdOpen&&(
        <div onClick={()=>setCmdOpen(false)} style={{position:"fixed",inset:0,zIndex:9998,background:"rgba(0,0,0,.5)",backdropFilter:"blur(4px)",display:"flex",alignItems:"flex-start",justifyContent:"center",paddingTop:"15vh"}}>
          <div onClick={e=>e.stopPropagation()} style={{width:"min(560px,90vw)",background:T.bgCardSolid,borderRadius:16,border:`1px solid ${T.borderLight}`,boxShadow:"0 24px 80px rgba(0,0,0,.5)",overflow:"hidden",animation:"fadeUp .2s ease-out"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"14px 18px",borderBottom:`1px solid ${T.border}`}}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input autoFocus value={cmdQuery} onChange={e=>setCmdQuery(e.target.value)}
                placeholder="Sekmeler, trade ekle, coin ara..."
                style={{flex:1,background:"transparent",border:"none",color:T.text,fontSize:15,outline:"none",fontFamily:"'Inter',sans-serif"}}/>
              <kbd style={{fontSize:10,padding:"2px 6px",borderRadius:4,background:T.bgInput,border:`1px solid ${T.border}`,color:T.textMuted}}>ESC</kbd>
            </div>
            <div style={{maxHeight:320,overflowY:"auto"}}>
              {[
                {icon:"⚡",label:"Aktif İşlemler",action:()=>{setTab("trade");setTradeView("list");setCmdOpen(false);}},
                {icon:"➕",label:"Yeni Trade",action:()=>{setTab("trade");setTradeView("add");resetNewTrade();setEditTrade(null);setCmdOpen(false);}},
                {icon:"📊",label:"Analitik & Takvim",action:()=>{setTab("trade");setTradeView("analytics");setCmdOpen(false);}},
                {icon:"🏠",label:"Dashboard",action:()=>{setTab("overview");setCmdOpen(false);}},
                {icon:"💼",label:"Portföy",action:()=>{setTab("portfolio");setCmdOpen(false);}},
                {icon:"📰",label:"Haberler",action:()=>{setTab("news");setCmdOpen(false);}},
                {icon:"🔔",label:"Fiyat Alarmları",action:()=>{setTab("portfolio");setCmdOpen(false);}},
              ].filter(item=>!cmdQuery||item.label.toLowerCase().includes(cmdQuery.toLowerCase())).map((item,i)=>(
                <div key={i} onClick={item.action}
                  style={{display:"flex",alignItems:"center",gap:12,padding:"12px 18px",cursor:"pointer",transition:"background .1s",borderBottom:`1px solid ${T.border}`}}
                  onMouseEnter={e=>e.currentTarget.style.background=T.accentGlow}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <span style={{fontSize:18,width:24,textAlign:"center"}}>{item.icon}</span>
                  <span style={{fontSize:13,color:T.text,fontWeight:500}}>{item.label}</span>
                </div>
              ))}
              {cmdQuery&&knownCoins.filter(c=>c.symbol.toLowerCase().includes(cmdQuery.toLowerCase())||c.name.toLowerCase().includes(cmdQuery.toLowerCase())).slice(0,5).map(coin=>(
                <div key={coin.id} onClick={()=>{setTab("trade");setTradeView("add");resetNewTrade();setNewTrade(p=>({...p,symbol:coin.symbol+"/USDT"}));setCmdOpen(false);}}
                  style={{display:"flex",alignItems:"center",gap:12,padding:"12px 18px",cursor:"pointer",transition:"background .1s"}}
                  onMouseEnter={e=>e.currentTarget.style.background=T.accentGlow}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <div style={{width:24,height:24,borderRadius:6,background:T.accent+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:T.accent}}>{coin.symbol.charAt(0)}</div>
                  <div>
                    <div style={{fontSize:13,color:T.text,fontWeight:600}}>{coin.symbol}</div>
                    <div style={{fontSize:10,color:T.textMuted}}>{coin.name}</div>
                  </div>
                  {prices[coin.id]?.usd&&<div style={{marginLeft:"auto",fontSize:12,fontFamily:"'JetBrains Mono',monospace",color:T.textSecondary}}>${prices[coin.id].usd<1?prices[coin.id].usd.toFixed(4):prices[coin.id].usd.toFixed(2)}</div>}
                </div>
              ))}
            </div>
            <div style={{padding:"8px 18px",borderTop:`1px solid ${T.border}`,display:"flex",gap:16}}>
              {[["↵","Seç"],["↑↓","Gezin"],["ESC","Kapat"]].map(([k,l])=>(
                <div key={k} style={{display:"flex",alignItems:"center",gap:4}}>
                  <kbd style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:T.bgInput,border:`1px solid ${T.border}`,color:T.textMuted,fontFamily:"'JetBrains Mono',monospace"}}>{k}</kbd>
                  <span style={{fontSize:10,color:T.textMuted}}>{l}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 🔍 Lightbox */}
      {lightboxSrc&&(
        <div onClick={()=>setLightboxSrc("")}
          style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,.92)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"zoom-out"}}>
          <img src={lightboxSrc} alt=""
            style={{maxWidth:"95vw",maxHeight:"93vh",objectFit:"contain",borderRadius:12,boxShadow:"0 20px 80px rgba(0,0,0,.8)"}}
            onClick={e=>e.stopPropagation()}/>
          <button onClick={()=>setLightboxSrc("")}
            style={{position:"fixed",top:20,right:24,width:38,height:38,borderRadius:10,background:"rgba(255,255,255,.12)",border:"1px solid rgba(255,255,255,.2)",color:"#fff",fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>
      )}
    </div>
  );
}

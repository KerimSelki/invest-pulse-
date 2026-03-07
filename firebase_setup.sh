#!/bin/bash
# Firebase entegrasyon script'i
# Bu script mevcut App.js'i Firebase ile entegre eder

cd ~/Downloads/invest-pulse || exit 1

echo "=== 1. firebase.js oluşturuluyor ==="
cat > src/firebase.js << 'FIREBASE_EOF'
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut, onAuthStateChanged, signInAnonymously, updateProfile } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBMVZE8a6PLfpuWclSKG8LtCpxQdLXS7Ac",
  authDomain: "invest-pulse-42016.firebaseapp.com",
  projectId: "invest-pulse-42016",
  storageBucket: "invest-pulse-42016.firebasestorage.app",
  messagingSenderId: "968723860951",
  appId: "1:968723860951:web:1de1d8e8f0d8cf7ddb0f92",
  measurementId: "G-781R7ZS1BC"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export const loginWithEmail = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const registerWithEmail = (email, password) => createUserWithEmailAndPassword(auth, email, password);
export const loginWithGoogle = () => signInWithPopup(auth, googleProvider);
export const loginAsGuest = () => signInAnonymously(auth);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email);
export const logoutUser = () => signOut(auth);
export const onAuthChange = (callback) => onAuthStateChanged(auth, callback);
export { updateProfile };

export const getUserData = async (uid) => {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() ? snap.data() : null;
  } catch (e) { console.error("getUserData:", e); return null; }
};

export const saveUserData = async (uid, data) => {
  try {
    await setDoc(doc(db, "users", uid), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
    return true;
  } catch (e) { console.error("saveUserData:", e); return false; }
};

export const savePortfolios = async (uid, portfolios, sections) => {
  try {
    await setDoc(doc(db, "users", uid), { portfolios, sections, updatedAt: new Date().toISOString() }, { merge: true });
    return true;
  } catch (e) { console.error("savePortfolios:", e); return false; }
};
FIREBASE_EOF
echo "firebase.js oluşturuldu"

echo "=== 2. package.json güncelleniyor ==="
# firebase dependency ekle
if ! grep -q '"firebase"' package.json; then
  sed -i '' 's/"jspdf-autotable": "^5.0.7",/"jspdf-autotable": "^5.0.7",\n    "firebase": "^11.0.0",/' package.json
  echo "firebase dependency eklendi"
else
  echo "firebase zaten var"
fi

echo "=== 3. App.js düzenleniyor ==="

# 3a. Firebase import ekle (satır 5'ten sonra)
if ! grep -q 'firebase' src/App.js; then
  sed -i '' '5a\
import { auth, loginWithEmail, registerWithEmail, loginWithGoogle, loginAsGuest, resetPassword, logoutUser, onAuthChange, getUserData, saveUserData, savePortfolios, updateProfile } from "./firebase";
' src/App.js
  echo "Firebase import eklendi"
fi

# 3b. AuthScreen'i tamamen değiştir
# Önce eski AuthScreen'in başlangıç ve bitiş satırlarını bul
AUTH_START=$(grep -n "const AuthScreen = " src/App.js | head -1 | cut -d: -f1)
# AuthScreen'den sonraki ilk "export default" veya "// ═══" bul
AUTH_END=$(awk "NR>$AUTH_START && /^};$/{print NR; exit}" src/App.js)

if [ -n "$AUTH_START" ] && [ -n "$AUTH_END" ]; then
  echo "AuthScreen: satır $AUTH_START - $AUTH_END"
  
  # Eski AuthScreen'i sil ve yenisini ekle
  sed -i '' "${AUTH_START},${AUTH_END}d" src/App.js
  
  # Yeni AuthScreen'i ekle
  sed -i '' "$((AUTH_START-1))r /dev/stdin" src/App.js << 'AUTHSCREEN_EOF'
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
AUTHSCREEN_EOF
  echo "AuthScreen değiştirildi"
else
  echo "HATA: AuthScreen bulunamadı!"
fi

# 3c. Main app'taki onLogin handler'ı değiştir
# Eski: onLogin={(user) => { setCurrentUser(user); setIsLoggedIn(true); }}
# Yeni: Firebase user objesi alacak
sed -i '' 's|onLogin={(user) => { setCurrentUser(user); setIsLoggedIn(true); }}|onLogin={async (user) => { const name = user.displayName || user.email?.split("@")[0] || (user.isAnonymous ? "Misafir" : "Kullanıcı"); setCurrentUser(name); setIsLoggedIn(true); if (!user.isAnonymous) { try { const data = await getUserData(user.uid); if (data \&\& data.portfolios) { setPortfolios(data.portfolios); if (data.sections) setSections(data.sections); } else { const lp = localStorage.getItem("ip_portfolios"); if (lp) { const p = JSON.parse(lp); setPortfolios(p); await savePortfolios(user.uid, p, sections); } } } catch(e) { console.error("Firestore load:", e); } } }}|' src/App.js

# 3d. Çıkış butonunu Firebase logout'a çevir
sed -i '' 's|onClick={()=>{setIsLoggedIn(false);setCurrentUser("");try{localStorage.removeItem("ip_session");}catch(e){}}}|onClick={async()=>{await logoutUser();setIsLoggedIn(false);setCurrentUser("");}}|' src/App.js

# 3e. localStorage portfolios save'den sonra Firestore'a da kaydet
# Bu basit tutulacak - sadece localStorage kullanmaya devam edecek
# Firebase sync login sırasında yapılacak

echo "=== 4. Git push ==="
git add .
git commit -m "Firebase auth: email, Google, misafir girisi"
git push

echo ""
echo "=== TAMAMLANDI ==="
echo "Vercel otomatik deploy edecek. 2 dakika bekle."
echo "Sonra siteyi aç ve 'Kayıt Ol' ile yeni hesap oluştur."

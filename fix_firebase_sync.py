#!/usr/bin/env python3
"""Firebase portfolio sync - portföy verilerini Firestore'a kaydet"""

with open('src/App.js', 'r') as f:
    code = f.read()

changes = 0

# 1. firebaseUser ve dataLoaded state ekle (isLoggedIn'den sonra)
if 'firebaseUser' not in code:
    old = 'const [isLoggedIn, setIsLoggedIn] = useState(false);'
    new = '''const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const firebaseUserRef = useRef(null);
  const dataLoadedRef = useRef(false);'''
    if old in code:
        code = code.replace(old, new)
        changes += 1
        print("1. firebaseUser state eklendi")
    else:
        print("1. HATA: isLoggedIn bulunamadi")
else:
    print("1. firebaseUser zaten var")

# 2. onLogin handler'ı güncelle - Firestore'dan veri yükle
old_login = 'onLogin={async (user) => { const name = user.displayName || user.email?.split("@")[0] || (user.isAnonymous ? "Misafir" : "Kullanici"); setCurrentUser(name); setIsLoggedIn(true);'
if old_login in code:
    new_login = '''onLogin={async (user) => { const name = user.displayName || user.email?.split("@")[0] || (user.isAnonymous ? "Misafir" : "Kullanici"); setCurrentUser(name); setFirebaseUser(user); firebaseUserRef.current = user;'''
    code = code.replace(old_login, new_login)
    
    # isAnonymous bloğunun sonuna dataLoaded ekle
    old_end = '} catch(e) { console.error("Firestore:", e); } } }} />;'
    new_end = '} catch(e) { console.error("Firestore:", e); } } setDataLoaded(true); dataLoadedRef.current = true; setIsLoggedIn(true); }} />;'
    if old_end in code:
        # Eski setIsLoggedIn(true)'yu kaldır
        code = code.replace('setCurrentUser(name); setFirebaseUser(user); firebaseUserRef.current = user; setIsLoggedIn(true);', 
                           'setCurrentUser(name); setFirebaseUser(user); firebaseUserRef.current = user;')
        code = code.replace(old_end, new_end)
        changes += 1
        print("2. onLogin handler guncellendi")
    else:
        print("2. UYARI: onLogin sonu bulunamadi, manuel duzeltme gerekebilir")
else:
    # Eski format dene
    old_login2 = 'onLogin={(user) => { setCurrentUser(user); setIsLoggedIn(true); }}'
    if old_login2 in code:
        new_login2 = '''onLogin={async (user) => { const name = user.displayName || user.email?.split("@")[0] || (user.isAnonymous ? "Misafir" : "Kullanici"); setCurrentUser(name); setFirebaseUser(user); firebaseUserRef.current = user; if (!user.isAnonymous) { try { const data = await getUserData(user.uid); if (data && data.portfolios) { setPortfolios(data.portfolios); if (data.sections) setSections(data.sections); } else { const lp = localStorage.getItem("ip_portfolios"); if (lp) { const p = JSON.parse(lp); setPortfolios(p); await savePortfolios(user.uid, p, sections); } } } catch(e) { console.error("Firestore:", e); } } setDataLoaded(true); dataLoadedRef.current = true; setIsLoggedIn(true); }}'''
        code = code.replace(old_login2, new_login2)
        changes += 1
        print("2. onLogin handler (eski format) guncellendi")
    else:
        print("2. onLogin handler bulunamadi - mevcut kontrol ediliyor")

# 3. Portfolios save'e Firestore sync ekle
old_save = 'try { localStorage.setItem("ip_portfolios", JSON.stringify(portfolios)); } catch(e) {}'
if old_save in code and 'savePortfolios(firebaseUserRef' not in code:
    new_save = '''try { localStorage.setItem("ip_portfolios", JSON.stringify(portfolios)); } catch(e) {}
    const fu = firebaseUserRef.current;
    if (fu && !fu.isAnonymous && dataLoadedRef.current) { savePortfolios(fu.uid, portfolios, sections); }'''
    code = code.replace(old_save, new_save, 1)  # sadece ilk match
    changes += 1
    print("3. Portfolios Firestore sync eklendi")
else:
    print("3. Portfolios sync zaten var veya bulunamadi")

# 4. Sections save'e Firestore sync ekle
old_sec = 'try { localStorage.setItem("ip_sections", JSON.stringify(sections)); } catch(e) {}'
if old_sec in code and 'savePortfolios(firebaseUserRef' in code:
    new_sec = '''try { localStorage.setItem("ip_sections", JSON.stringify(sections)); } catch(e) {}
    const fu2 = firebaseUserRef.current;
    if (fu2 && !fu2.isAnonymous && dataLoadedRef.current) { savePortfolios(fu2.uid, portfolios, sections); }'''
    code = code.replace(old_sec, new_sec, 1)
    changes += 1
    print("4. Sections Firestore sync eklendi")
else:
    print("4. Sections sync atlanıyor")

# 5. Refs sync useEffect ekle (firebaseUser ve dataLoaded ref'leri)
if 'firebaseUserRef.current = firebaseUser' not in code and 'firebaseUserRef' in code:
    # useRef'lerin sync'ini portfolios useEffect'inden önce ekle
    old_port_effect = '}, [portfolios]);'
    if old_port_effect in code:
        # Zaten ref'ler onLogin'de set ediliyor, ek useEffect gerekmez
        print("5. Refs zaten onLogin'de set ediliyor")
    else:
        print("5. Portfolios useEffect bulunamadi")
else:
    print("5. Ref sync zaten var veya gerekmiyor")

# 6. Logout'u güncelle
old_logout = 'setIsLoggedIn(false);setCurrentUser("");try{localStorage.removeItem("ip_session");}catch(e){}'
if old_logout in code:
    new_logout = 'logoutUser();setIsLoggedIn(false);setCurrentUser("");setFirebaseUser(null);firebaseUserRef.current=null;setDataLoaded(false);dataLoadedRef.current=false'
    code = code.replace(old_logout, new_logout)
    changes += 1
    print("6. Logout guncellendi")
else:
    print("6. Logout zaten guncel veya bulunamadi")

with open('src/App.js', 'w') as f:
    f.write(code)

print(f"\n=== {changes} degisiklik yapildi ===")
if changes > 0:
    print("Simdi: git add . && git commit -m 'Firebase portfolio sync' && git push")
else:
    print("Degisiklik yok!")

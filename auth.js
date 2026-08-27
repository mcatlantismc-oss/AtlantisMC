/* Atlantis MC — FINAL auth.js
   One persistent session across pages.
   Profile drawer, profile editor, logout confirmation, email/password auth,
   OTP, Google OAuth, and Supabase Storage profile images.
*/
(() => {
  'use strict';

  const cfg = window.ATLANTIS_SUPABASE || {};
  const LOGIN_EDGE = String(window.ATLANTIS_EDGE_URL || '').replace(/\/+$/, '');
  const RECOVERY_EDGE = String(window.ATLANTIS_RECOVERY_URL || '').replace(/\/+$/, '');
  const NAME_RE = /^[A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü0-9]{2,15}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  let client = null;
  let currentUser = null;
  let currentProfile = null;
  let booted = false;
  let otpTimer = null;
  let selectedAvatarFile = null;
  let removeAvatar = false;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[ch]));

  function getClient(){
    if (client) return Promise.resolve(client);
    return window.atlantisAuthReady || Promise.resolve(null);
  }

  function roleLabel(role){
    return role === 'admin' ? 'Yönetici' : role === 'moderator' ? 'Moderatör' : 'Oyuncu';
  }

  function formatLastSeen(value){
    if (!value) return 'Son görülme bilinmiyor';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'Son görülme bilinmiyor';
    if (Date.now() - d.getTime() < 5 * 60 * 1000) return 'Çevrimiçi';
    return `Son görülme: ${d.toLocaleString('tr-TR',{dateStyle:'medium',timeStyle:'short'})}`;
  }

  function getAvatar(profile,user){
    return profile?.avatar_url || user?.user_metadata?.avatar_url || '';
  }

  function avatarMarkup(profile,user,size=58){
    const url=getAvatar(profile,user);
    const name=profile?.username || user?.user_metadata?.username || 'A';
    return url
      ? `<img src="${esc(url)}" alt="" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:50%;display:block;">`
      : `<span class="avatar-fallback" style="width:${size}px;height:${size}px">${esc(name.charAt(0).toLocaleUpperCase('tr-TR') || 'A')}</span>`;
  }

  window.atlantisAuthReady = new Promise(resolve => {
    const start = () => {
      if (!window.supabase || !cfg.url || !cfg.publishableKey) return resolve(null);
      client = window.supabase.createClient(cfg.url,cfg.publishableKey,{
        auth:{
          persistSession:true,
          autoRefreshToken:true,
          detectSessionInUrl:true,
          flowType:'pkce'
        }
      });
      window.atlantisSupabase=client;
      resolve(client);
    };
    if(window.supabase) start();
    else window.addEventListener('supabase-ready',start,{once:true});
  });

  async function getProfile(user=currentUser){
    if(!client||!user) return null;
    const {data,error}=await client.from('profiles').select('*').eq('id',user.id).maybeSingle();
    if(error){console.warn('[Atlantis] profile read',error);return null;}
    return data || null;
  }

  function ensureNavButton(){
    const nav=document.querySelector('.site-nav');
    if(!nav || document.getElementById('auth-nav-button')) return;
    const button=document.createElement('a');
    button.id='auth-nav-button';
    button.href='#';
    button.className='auth-nav-button';
    button.textContent='Giriş Yap';
    nav.appendChild(button);
  }

  async function updateNav(){
    ensureNavButton();
    const button=document.getElementById('auth-nav-button');
    if(!button) return;

    if(!currentUser){
      currentProfile=null;
      button.textContent='Giriş Yap';
      button.onclick=e=>{e.preventDefault();openAuth('login');};
      return;
    }

    currentProfile=await getProfile(currentUser);
    const username=currentProfile?.username || currentUser.user_metadata?.username || 'Profil';
    button.textContent=`👤 ${username}`;
    button.onclick=e=>{
      e.preventDefault();
      openOwnDrawer();
    };
  }

  function bindMenu(){
    document.querySelectorAll('.menu-toggle').forEach(button=>{
      if(button.dataset.atlantisBound) return;
      button.dataset.atlantisBound='1';
      button.addEventListener('click',()=>{
        const header=button.closest('.site-header');
        const open=!header?.classList.contains('menu-open');
        header?.classList.toggle('menu-open',open);
        button.classList.toggle('is-open',open);
        button.setAttribute('aria-expanded',String(open));
      });
    });

    if(!document.body.dataset.atlantisMenuOutside){
      document.body.dataset.atlantisMenuOutside='1';
      document.addEventListener('click',event=>{
        const header=document.querySelector('.site-header');
        if(!header?.classList.contains('menu-open')) return;
        if(event.target.closest('.site-header')) return;
        header.classList.remove('menu-open');
        document.querySelectorAll('.menu-toggle').forEach(b=>{
          b.classList.remove('is-open');
          b.setAttribute('aria-expanded','false');
        });
      });
    }
  }

  function ensureAuthModal(){
    if(document.getElementById('auth-modal')) return;
    const modal=document.createElement('div');
    modal.id='auth-modal';
    modal.className='auth-modal';
    modal.hidden=true;
    modal.innerHTML=`
      <div class="auth-backdrop"></div>
      <section class="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button class="auth-close" type="button">×</button>
        <div class="auth-brand">⚔️</div>
        <span class="section-label">ATLANTİS MC</span>
        <h2 id="auth-title">Giriş Yap</h2>
        <p class="auth-subtitle" id="auth-subtitle">Hesabına giriş yap ve Atlantis topluluğuna katıl.</p>

        <div class="auth-tabs">
          <button type="button" data-auth-tab="login" class="is-active">Giriş Yap</button>
          <button type="button" data-auth-tab="signup">Kayıt Ol</button>
        </div>

        <form id="auth-login-form" class="auth-form">
          <label>Kullanıcı adı veya e-posta
            <input name="identifier" autocomplete="username" required placeholder="OyuncuAdı veya eposta@gmail.com">
          </label>
          <label>Şifre
            <input name="password" type="password" autocomplete="current-password" required placeholder="Şifren">
          </label>
          <button class="primary-button wide" type="submit">Giriş Yap</button>
          <button class="google-button" id="google-login" type="button"><b>G</b> Google ile giriş yap</button>
          <button class="link-button" id="forgot-password" type="button">Şifremi unuttum</button>
        </form>

        <form id="auth-signup-form" class="auth-form" hidden>
          <label>Kullanıcı adı
            <input name="username" required minlength="3" maxlength="16" placeholder="AtlantisOyuncu">
          </label>
          <small>3–16 karakter; boşluk ve özel sembol yok.</small>
          <label>E-posta
            <input name="email" type="email" autocomplete="email" required placeholder="ornek@gmail.com">
          </label>
          <label>Şifre
            <input name="password" type="password" autocomplete="new-password" minlength="8" required placeholder="En az 8 karakter">
          </label>
          <button class="primary-button wide" type="submit">Kayıt Ol</button>
          <button class="google-button" id="google-signup" type="button"><b>G</b> Google ile kayıt ol</button>
        </form>

        <form id="auth-forgot-form" class="auth-form" hidden>
          <label>E-posta
            <input name="email" type="email" autocomplete="email" required placeholder="ornek@gmail.com">
          </label>
          <button class="primary-button wide" type="submit">Kod Gönder</button>
          <button class="link-button" type="button" data-back-login>Girişe dön</button>
        </form>

        <form id="auth-otp-form" class="auth-form" hidden>
          <div class="otp-info" id="otp-info"></div>
          <label>6 haneli kod
            <input name="token" maxlength="6" inputmode="numeric" autocomplete="one-time-code" required placeholder="123456">
          </label>
          <div class="otp-toolbar">
            <span id="otp-countdown"></span>
            <button class="otp-resend" id="otp-resend" type="button">Kodu tekrar gönder</button>
          </div>
          <button class="primary-button wide" type="submit">Kodu Doğrula</button>
          <button class="link-button" type="button" data-back-login>Girişe dön</button>
        </form>

        <form id="auth-reset-form" class="auth-form" hidden>
          <label>Yeni şifre
            <input name="password" type="password" minlength="8" required autocomplete="new-password">
          </label>
          <label>Yeni şifre tekrar
            <input name="password2" type="password" minlength="8" required autocomplete="new-password">
          </label>
          <button class="primary-button wide" type="submit">Şifreyi Değiştir</button>
        </form>

        <div class="auth-message" id="auth-message"></div>
      </section>`;
    document.body.appendChild(modal);

    modal.querySelector('.auth-backdrop').onclick=closeAuth;
    modal.querySelector('.auth-close').onclick=closeAuth;
    modal.querySelectorAll('[data-auth-tab]').forEach(b=>b.onclick=()=>openAuth(b.dataset.authTab));
    modal.querySelectorAll('[data-back-login]').forEach(b=>b.onclick=()=>openAuth('login'));
    modal.querySelector('#forgot-password').onclick=()=>openAuth('forgot');
    modal.querySelector('#google-login').onclick=googleLogin;
    modal.querySelector('#google-signup').onclick=googleLogin;
    modal.querySelector('#auth-login-form').onsubmit=login;
    modal.querySelector('#auth-signup-form').onsubmit=signup;
    modal.querySelector('#auth-forgot-form').onsubmit=forgotPassword;
    modal.querySelector('#auth-otp-form').onsubmit=verifyOtp;
    modal.querySelector('#auth-reset-form').onsubmit=resetPassword;
    modal.querySelector('#otp-resend').onclick=resendOtp;
  }

  function setAuthView(view){
    const map={
      login:['Giriş Yap','Hesabına giriş yap ve Atlantis topluluğuna katıl.'],
      signup:['Kayıt Ol','Atlantis hesabını oluştur.'],
      forgot:['Şifremi Unuttum','E-posta adresine doğrulama kodu gönderelim.'],
      otp:['Kodu Doğrula','E-posta kutundaki 6 haneli kodu gir.'],
      reset:['Yeni Şifre','Hesabın için yeni bir şifre belirle.']
    };
    ['login','signup','forgot','otp','reset'].forEach(name=>{
      const form=document.getElementById(`auth-${name}-form`);
      if(form)form.hidden=name!==view;
    });
    const tabs=document.querySelector('.auth-tabs');
    if(tabs)tabs.hidden=!['login','signup'].includes(view);
    const [title,sub]=map[view]||map.login;
    document.getElementById('auth-title').textContent=title;
    document.getElementById('auth-subtitle').textContent=sub;
    document.querySelectorAll('[data-auth-tab]').forEach(b=>b.classList.toggle('is-active',b.dataset.authTab===view));
    setAuthMessage('');
  }

  function setAuthMessage(text,kind=''){
    const el=document.getElementById('auth-message');
    if(el){el.textContent=text;el.className='auth-message'+(kind?' '+kind:'');}
  }

  function openAuth(view='login'){
    ensureAuthModal();
    const modal=document.getElementById('auth-modal');
    modal.hidden=false;
    document.body.classList.add('auth-open');
    setAuthView(view);
    setTimeout(()=>modal.querySelector('.auth-form:not([hidden]) input')?.focus(),30);
  }

  function closeAuth(){
    const modal=document.getElementById('auth-modal');
    if(modal)modal.hidden=true;
    document.body.classList.remove('auth-open');
    if(otpTimer)clearInterval(otpTimer);
    otpTimer=null;
  }

  async function afterLogin(session){
    currentUser=session?.user||null;
    window.atlantisAuthSession=session||null;
    if(currentUser)currentProfile=await getProfile(currentUser);
    await updateNav();
    closeAuth();
    window.dispatchEvent(new CustomEvent('atlantis-auth-login',{detail:{user:currentUser,session}}));
  }

  async function login(event){
    event.preventDefault();
    const form=event.currentTarget;
    const identifier=String(form.elements.identifier.value||'').trim();
    const password=String(form.elements.password.value||'');
    const button=form.querySelector('button[type=submit]');
    button.disabled=true;button.textContent='Giriş yapılıyor...';

    try{
      if(!client)throw new Error('Supabase bağlantısı kurulamadı.');
      if(EMAIL_RE.test(identifier)){
        const {data,error}=await client.auth.signInWithPassword({email:identifier.toLowerCase(),password});
        if(error)throw new Error('E-posta veya şifre hatalı.');
        await afterLogin(data.session);
      }else{
        if(!LOGIN_EDGE)throw new Error('Kullanıcı adıyla giriş servisi yapılandırılmamış.');
        const response=await fetch(LOGIN_EDGE,{
          method:'POST',
          headers:{'Content-Type':'application/json',apikey:cfg.publishableKey},
          body:JSON.stringify({username:identifier,password})
        });
        const result=await response.json().catch(()=>({}));
        if(!response.ok||!result.session)throw new Error(result.error||'Kullanıcı adı veya şifre hatalı.');
        const {error}=await client.auth.setSession({
          access_token:result.session.access_token,
          refresh_token:result.session.refresh_token
        });
        if(error)throw error;
        await afterLogin(result.session);
      }
    }catch(error){
      setAuthMessage(error?.message||'Giriş başarısız.','error');
    }finally{
      button.disabled=false;button.textContent='Giriş Yap';
    }
  }

  async function signup(event){
    event.preventDefault();
    const form=event.currentTarget;
    const username=String(form.elements.username.value||'').trim();
    const email=String(form.elements.email.value||'').trim().toLowerCase();
    const password=String(form.elements.password.value||'');

    if(!NAME_RE.test(username)){setAuthMessage('Kullanıcı adı 3–16 karakter olmalı.','error');return;}
    if(!EMAIL_RE.test(email)){setAuthMessage('Geçerli bir e-posta adresi gir.','error');return;}
    if(password.length<8){setAuthMessage('Şifre en az 8 karakter olmalı.','error');return;}

    const button=form.querySelector('button[type=submit]');
    button.disabled=true;button.textContent='Hesap oluşturuluyor...';

    try{
      const {data:existing}=await client.from('profiles').select('id').ilike('username',username).maybeSingle();
      if(existing)throw new Error('Bu kullanıcı adı zaten kullanılıyor.');

      const {data,error}=await client.auth.signUp({
        email,password,
        options:{
          data:{username},
          emailRedirectTo:window.location.origin+window.location.pathname
        }
      });
      if(error)throw error;

      window.atlantisPendingEmail=email;
      window.atlantisPendingUsername=username;

      if(data.session)await afterLogin(data.session);
      else{
        setAuthView('otp');
        document.getElementById('otp-info').textContent=`${email} adresine doğrulama kodu gönderildi.`;
        setAuthMessage('E-posta kutunu kontrol et.','success');
      }
    }catch(error){
      setAuthMessage(error?.message||'Kayıt başarısız.','error');
    }finally{
      button.disabled=false;button.textContent='Kayıt Ol';
    }
  }

  async function googleLogin(){
    if(!client)return;
    const {error}=await client.auth.signInWithOAuth({
      provider:'google',
      options:{
        redirectTo:window.location.origin+window.location.pathname,
        queryParams:{prompt:'select_account'}
      }
    });
    if(error)setAuthMessage(
      String(error.message||'').toLowerCase().includes('provider')
        ? 'Google girişi Supabase üzerinde etkin değil.'
        : error.message,
      'error'
    );
  }

  async function forgotPassword(event){
    event.preventDefault();
    const email=String(event.currentTarget.elements.email.value||'').trim().toLowerCase();
    if(!EMAIL_RE.test(email)){setAuthMessage('Geçerli bir e-posta adresi gir.','error');return;}

    try{
      if(RECOVERY_EDGE){
        const response=await fetch(RECOVERY_EDGE,{
          method:'POST',
          headers:{'Content-Type':'application/json',apikey:cfg.publishableKey},
          body:JSON.stringify({email})
        });
        const result=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(result.error||'Kod gönderilemedi.');
      }else{
        const {error}=await client.auth.resetPasswordForEmail(email,{
          redirectTo:window.location.origin+window.location.pathname
        });
        if(error)throw error;
      }
      window.atlantisPendingEmail=email;
      window.atlantisOtpMode='recovery';
      setAuthView('otp');
      document.getElementById('otp-info').textContent=`${email} adresine 6 haneli doğrulama kodu gönderildi.`;
      setAuthMessage('Kod gönderildi.','success');
    }catch(error){
      setAuthMessage(error?.message||'Kod gönderilemedi.','error');
    }
  }

  async function verifyOtp(event){
    event.preventDefault();
    const token=String(event.currentTarget.elements.token.value||'').replace(/\D/g,'');
    const email=String(window.atlantisPendingEmail||'').trim().toLowerCase();
    if(!/^\d{6}$/.test(token)){setAuthMessage('6 haneli kodu gir.','error');return;}

    try{
      const type=window.atlantisOtpMode==='recovery'?'recovery':'email';
      const {data,error}=await client.auth.verifyOtp({email,token,type});
      if(error)throw error;
      if(type==='recovery'){
        setAuthView('reset');
        setAuthMessage('Kod doğrulandı. Yeni şifreni belirle.','success');
      }else{
        if(window.atlantisPendingUsername){
          const {error:usernameError}=await client.rpc('set_my_username',{new_username:window.atlantisPendingUsername});
          if(usernameError)throw usernameError;
        }
        await afterLogin(data.session);
      }
    }catch(error){
      setAuthMessage(error?.message||'Kod doğrulanamadı.','error');
    }
  }

  async function resendOtp(){
    const email=String(window.atlantisPendingEmail||'').trim().toLowerCase();
    if(!EMAIL_RE.test(email))return;
    try{
      if(window.atlantisOtpMode==='recovery'){
        const {error}=await client.auth.resetPasswordForEmail(email,{
          redirectTo:window.location.origin+window.location.pathname
        });
        if(error)throw error;
      }else{
        const {error}=await client.auth.resend({type:'signup',email});
        if(error)throw error;
      }
      setAuthMessage('Kod tekrar gönderildi.','success');
    }catch(error){
      setAuthMessage(error?.message||'Kod tekrar gönderilemedi.','error');
    }
  }

  async function resetPassword(event){
    event.preventDefault();
    const p=String(event.currentTarget.elements.password.value||'');
    const p2=String(event.currentTarget.elements.password2.value||'');
    if(p.length<8){setAuthMessage('Şifre en az 8 karakter olmalı.','error');return;}
    if(p!==p2){setAuthMessage('Şifreler aynı değil.','error');return;}

    try{
      const {error}=await client.auth.updateUser({password:p});
      if(error)throw error;
      setAuthMessage('Şifren başarıyla değiştirildi.','success');
      setTimeout(closeAuth,700);
    }catch(error){
      setAuthMessage(error?.message||'Şifre değiştirilemedi.','error');
    }
  }

  function closeDrawer(){
    document.getElementById('account-drawer')?.remove();
    document.body.classList.remove('drawer-open');
  }

  function openUserDrawer(profile,user=null,isOwn=false){
    closeDrawer();

    const name=profile?.username||user?.user_metadata?.username||'Oyuncu';
    const role=profile?.site_role||'user';
    const avatar=getAvatar(profile,user);
    const online=profile?.last_seen && Date.now()-new Date(profile.last_seen).getTime()<5*60*1000;

    const aside=document.createElement('aside');
    aside.id='account-drawer';
    aside.className='account-drawer';
    aside.innerHTML=`
      <div class="account-drawer-backdrop"></div>
      <section class="account-drawer-panel">
        <div class="account-drawer-head">
          <div class="account-drawer-avatar">${avatarMarkup(profile,user,62)}</div>
          <div class="account-drawer-title">
            <span class="section-label">ATLANTİS PROFİLİ</span>
            <h2>${esc(name)}</h2>
            <span class="role-chip role-${esc(role)}">${esc(roleLabel(role))}</span>
          </div>
          <button class="account-drawer-close" type="button">×</button>
        </div>

        <div class="account-drawer-body">
          <div class="account-status-card">
            <span>Durum</span>
            <strong class="${online?'status-online':''}">${esc(formatLastSeen(profile?.last_seen))}</strong>
          </div>

          <div class="account-profile-about">
            <span>Hakkında</span>
            <p>${esc(profile?.bio||'Henüz bir açıklama eklenmemiş.')}</p>
          </div>

          ${
            isOwn
            ? `
              <button class="account-menu-item" data-action="info" type="button"><span>👤</span><span><b>Hesap Bilgileri</b><small>E-posta, üyelik ve hesap durumu</small></span></button>
              <button class="account-menu-item" data-action="profile" type="button"><span>✏️</span><span><b>Profili Düzenle</b><small>Profil fotoğrafı ve açıklama</small></span></button>
              <button class="account-menu-item" data-action="password" type="button"><span>🔑</span><span><b>Şifre Değiştir</b><small>Hesap güvenliği</small></span></button>
              <button class="account-menu-item" data-action="email" type="button"><span>📧</span><span><b>E-posta Değiştir</b><small>Yeni e-posta adresi</small></span></button>
              <a class="account-menu-item" href="sohbet.html"><span>💬</span><span><b>Sohbete Git</b><small>Canlı Atlantis sohbeti</small></span></a>
              ${(role==='admin'||role==='moderator')?`<a class="account-menu-item" href="moderasyon.html"><span>🛡️</span><span><b>Moderasyon</b><small>Yönetim paneli</small></span></a>`:''}
              <div class="account-drawer-separator"></div>
              <button class="account-menu-item account-menu-danger" data-action="logout" type="button"><span>↪</span><span><b>Çıkış Yap</b><small>Bu cihazdaki Atlantis oturumunu kapat</small></span></button>
            `
            : `
              <button class="account-menu-item" data-action="message" type="button"><span>💬</span><span><b>Mesaj Gönder</b><small>Özel mesaj sistemi için hazır</small></span></button>
              ${online?`<div class="profile-online-note">● Şu anda Atlantis'te çevrimiçi</div>`:''}
            `
          }
        </div>
      </section>`;

    document.body.appendChild(aside);
    document.body.classList.add('drawer-open');

    aside.querySelector('.account-drawer-backdrop').onclick=closeDrawer;
    aside.querySelector('.account-drawer-close').onclick=closeDrawer;

    aside.querySelector('[data-action="info"]')?.addEventListener('click',showAccountInfo);
    aside.querySelector('[data-action="profile"]')?.addEventListener('click',()=>{closeDrawer();openProfileEditor();});
    aside.querySelector('[data-action="password"]')?.addEventListener('click',()=>{closeDrawer();openAuth('reset');});
    aside.querySelector('[data-action="email"]')?.addEventListener('click',changeEmail);
    aside.querySelector('[data-action="logout"]')?.addEventListener('click',confirmLogout);
    aside.querySelector('[data-action="message"]')?.addEventListener('click',()=>alert('Özel mesaj sistemi sonraki aşamada etkinleştirilebilir.'));
  }

  function openOwnDrawer(){
    if(!currentUser){openAuth('login');return;}
    openUserDrawer(currentProfile||{},currentUser,true);
  }

  function showAccountInfo(){
    closeDrawer();
    const overlay=document.createElement('div');
    overlay.className='auth-modal';
    overlay.innerHTML=`
      <div class="auth-backdrop"></div>
      <section class="auth-dialog account-info-dialog">
        <button class="auth-close" type="button">×</button>
        <div class="auth-brand">👤</div>
        <span class="section-label">ATLANTİS MC</span>
        <h2>Hesap Bilgileri</h2>
        <div class="account-info-profile">
          ${avatarMarkup(currentProfile,currentUser,88)}
          <strong>${esc(currentProfile?.username||currentUser?.user_metadata?.username||'Oyuncu')}</strong>
          <span class="role-chip role-${esc(currentProfile?.site_role||'user')}">${esc(roleLabel(currentProfile?.site_role||'user'))}</span>
        </div>
        <div class="account-info-grid">
          <div><span>E-posta</span><strong>${esc(currentUser?.email||'')}</strong></div>
          <div><span>Üyelik</span><strong>${currentUser?.created_at?new Date(currentUser.created_at).toLocaleDateString('tr-TR'):''}</strong></div>
          <div class="account-info-full"><span>Hakkında</span><strong>${esc(currentProfile?.bio||'Henüz açıklama eklenmemiş.')}</strong></div>
          <div class="account-info-full"><span>Durum</span><strong>${esc(formatLastSeen(currentProfile?.last_seen))}</strong></div>
        </div>
      </section>`;
    document.body.appendChild(overlay);
    const close=()=>overlay.remove();
    overlay.querySelector('.auth-close').onclick=close;
    overlay.querySelector('.auth-backdrop').onclick=close;
  }

  async function changeEmail(){
    const email=String(prompt('Yeni e-posta adresin:')||'').trim().toLowerCase();
    if(!email)return;
    if(!EMAIL_RE.test(email)){alert('Geçerli bir e-posta adresi gir.');return;}
    const {error}=await client.auth.updateUser({email});
    alert(error?.message||'Yeni e-posta adresine doğrulama gönderildi.');
  }

  async function confirmLogout(){
    closeDrawer();
    const ok=confirm('Atlantis MC hesabından çıkış yapmak istediğine emin misin?');
    if(!ok)return;
    const {error}=await client.auth.signOut();
    if(error){alert(error.message||'Çıkış yapılamadı.');return;}
    currentUser=null;currentProfile=null;window.atlantisAuthSession=null;
    await updateNav();
    window.dispatchEvent(new CustomEvent('atlantis-auth-logout'));
  }

  async function openProfileEditor(){
    if(!currentUser)return;
    const profile=currentProfile||{};
    selectedAvatarFile=null;
    removeAvatar=false;

    const overlay=document.createElement('div');
    overlay.className='auth-modal';
    overlay.id='profile-editor-modal';

    overlay.innerHTML=`
      <div class="auth-backdrop"></div>
      <section class="auth-dialog profile-editor-dialog">
        <button class="auth-close" type="button">×</button>
        <div class="auth-brand">👤</div>
        <span class="section-label">ATLANTİS MC</span>
        <h2>Profili Düzenle</h2>
        <div id="profile-editor-preview" class="profile-editor-avatar"></div>

        <label class="file-button">📷 Profil fotoğrafı seç
          <input id="profile-editor-file" type="file" accept="image/png,image/jpeg,image/webp" hidden>
        </label>

        <button id="profile-editor-remove" class="ghost-button wide" type="button">Fotoğrafı kaldır</button>

        <label class="profile-field-label">Kullanıcı adı
          <input value="${esc(profile.username||currentUser.user_metadata?.username||'')}" disabled>
        </label>

        <label class="profile-field-label">Hakkında
          <textarea id="profile-editor-bio" rows="4" maxlength="180" placeholder="Kendinden biraz bahset...">${esc(profile.bio||'')}</textarea>
        </label>

        <button id="profile-editor-save" class="primary-button wide" type="button">Kaydet</button>
        <div id="profile-editor-message" class="auth-message"></div>
      </section>`;

    document.body.appendChild(overlay);

    const preview=overlay.querySelector('#profile-editor-preview');
    const oldAvatar=getAvatar(profile,currentUser);

    const renderPreview=()=>{
      if(removeAvatar){
        preview.innerHTML=`<span class="avatar-fallback" style="width:96px;height:96px">${esc((profile.username||'A').charAt(0).toLocaleUpperCase('tr-TR'))}</span>`;
      }else if(selectedAvatarFile){
        const reader=new FileReader();
        reader.onload=()=>preview.innerHTML=`<img src="${esc(reader.result)}" alt="" style="width:96px;height:96px;object-fit:cover;border-radius:50%">`;
        reader.readAsDataURL(selectedAvatarFile);
      }else if(oldAvatar){
        preview.innerHTML=`<img src="${esc(oldAvatar)}" alt="" style="width:96px;height:96px;object-fit:cover;border-radius:50%">`;
      }else{
        preview.innerHTML=`<span class="avatar-fallback" style="width:96px;height:96px">${esc((profile.username||'A').charAt(0).toLocaleUpperCase('tr-TR'))}</span>`;
      }
    };
    renderPreview();

    overlay.querySelector('#profile-editor-file').onchange=e=>{
      const file=e.target.files?.[0];
      if(!file)return;
      if(file.size>2*1024*1024){setEditorMessage('Fotoğraf 2 MB altında olmalı.','error');return;}
      if(!/^image\/(png|jpeg|webp)$/.test(file.type)){setEditorMessage('PNG, JPG veya WebP seç.','error');return;}
      selectedAvatarFile=file;
      removeAvatar=false;
      renderPreview();
    };

    overlay.querySelector('#profile-editor-remove').onclick=()=>{
      selectedAvatarFile=null;
      removeAvatar=true;
      renderPreview();
    };

    const close=()=>overlay.remove();
    overlay.querySelector('.auth-close').onclick=close;
    overlay.querySelector('.auth-backdrop').onclick=close;

    overlay.querySelector('#profile-editor-save').onclick=async()=>{
      const button=overlay.querySelector('#profile-editor-save');
      button.disabled=true;button.textContent='Kaydediliyor...';
      try{
        let avatarUrl=oldAvatar||null;

        if(removeAvatar){
          avatarUrl=null;
        }else if(selectedAvatarFile){
          const ext=selectedAvatarFile.type==='image/png'?'png':selectedAvatarFile.type==='image/webp'?'webp':'jpg';
          const path=`${currentUser.id}/avatar.${ext}`;
          const {error:uploadError}=await client.storage.from('avatars').upload(path,selectedAvatarFile,{
            upsert:true,
            contentType:selectedAvatarFile.type,
            cacheControl:'3600'
          });
          if(uploadError)throw uploadError;
          const {data:urlData}=client.storage.from('avatars').getPublicUrl(path);
          avatarUrl=`${urlData.publicUrl}?v=${Date.now()}`;
        }

        const bio=String(overlay.querySelector('#profile-editor-bio').value||'').trim();

        const {data,error}=await client.rpc('update_my_profile',{
          new_avatar_url:avatarUrl,
          new_bio:bio
        });
        if(error)throw error;

        currentProfile=data||{...profile,bio,avatar_url:avatarUrl};
        await updateNav();
        window.dispatchEvent(new CustomEvent('atlantis-profile-updated',{detail:{profile:currentProfile}}));
        setEditorMessage('Profil güncellendi.','success');
        setTimeout(close,700);
      }catch(error){
        console.error('[Atlantis] profile save',error);
        setEditorMessage(error?.message||'Profil güncellenemedi.','error');
      }finally{
        button.disabled=false;button.textContent='Kaydet';
      }
    };

    function setEditorMessage(text,kind){
      const m=overlay.querySelector('#profile-editor-message');
      m.textContent=text;m.className='auth-message '+kind;
    }
  }

  window.openAtlantisAuth=openAuth;
  window.closeAtlantisAuth=closeAuth;
  window.atlantisGetClient=getClient;
  window.atlantisGetProfile=getProfile;
  window.openAtlantisUserDrawer=profile=>openUserDrawer(profile,null,false);

  async function init(){
    if(booted)return;
    booted=true;
    ensureAuthModal();
    ensureNavButton();
    bindMenu();

    client=await window.atlantisAuthReady;
    if(!client)return;

    const {data:{session}}=await client.auth.getSession();
    currentUser=session?.user||null;
    window.atlantisAuthSession=session||null;
    if(currentUser)currentProfile=await getProfile(currentUser);
    await updateNav();

    client.auth.onAuthStateChange((event,next)=>{
      setTimeout(async()=>{
        currentUser=next?.user||null;
        window.atlantisAuthSession=next||null;
        currentProfile=currentUser?await getProfile(currentUser):null;
        await updateNav();
        window.dispatchEvent(new CustomEvent(
          currentUser?'atlantis-auth-login':'atlantis-auth-logout',
          {detail:{user:currentUser,session:next||null,event}}
        ));
      },0);
    });

    setInterval(async()=>{
      if(currentUser){
        try{await client.rpc('touch_my_last_seen');}catch{}
      }
    },60000);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();

  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){
      closeAuth();
      closeDrawer();
      document.getElementById('account-info-modal')?.remove();
      document.getElementById('profile-editor-modal')?.remove();
    }
  });
})();

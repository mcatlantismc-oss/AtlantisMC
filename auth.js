/* Atlantis MC — FINAL FINAL auth.js */
(() => {
  'use strict';

  const cfg = window.ATLANTIS_SUPABASE || {};
  const edgeLogin = String(window.ATLANTIS_EDGE_URL || '').replace(/\/+$/,'');
  const edgeRecovery = String(window.ATLANTIS_RECOVERY_URL || '').replace(/\/+$/,'');

  const NAME_REGEX=/^[A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü0-9]{2,15}$/;
  const EMAIL_REGEX=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  let client=null;
  let currentUser=null;
  let currentProfile=null;
  let booted=false;
  let menuBound=false;
  let drawerEl=null;

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[c]));

  function createClient(){
    if(client) return client;
    if(!window.supabase || !cfg.url || !cfg.publishableKey) return null;
    client=window.supabase.createClient(cfg.url,cfg.publishableKey,{
      auth:{
        persistSession:true,
        autoRefreshToken:true,
        detectSessionInUrl:true,
        flowType:'pkce'
      }
    });
    window.atlantisSupabase=client;
    return client;
  }

  window.atlantisAuthReady=new Promise(resolve=>{
    const ready=()=>{
      const c=createClient();
      resolve(c);
    };
    if(window.supabase) ready();
    else window.addEventListener('supabase-ready',ready,{once:true});
  });

  async function getClient(){
    if(client) return client;
    return await window.atlantisAuthReady;
  }

  async function getProfile(user=currentUser){
    const c=await getClient();
    if(!c||!user) return null;
    const {data,error}=await c.from('profiles').select('*').eq('id',user.id).maybeSingle();
    if(error){ console.warn('[Atlantis] profile read',error); return null; }
    return data||null;
  }

  function roleLabel(role){
    return role==='admin'?'Yönetici':role==='moderator'?'Moderatör':'Oyuncu';
  }

  function formatLastSeen(value){
    if(!value) return 'Son görülme bilinmiyor';
    const d=new Date(value);
    if(Number.isNaN(d.getTime())) return 'Son görülme bilinmiyor';
    return Date.now()-d.getTime()<5*60*1000
      ? 'Çevrimiçi'
      : `Son görülme: ${d.toLocaleString('tr-TR',{dateStyle:'medium',timeStyle:'short'})}`;
  }

  function avatarMarkup(profile,user,size=58){
    const url=profile?.avatar_url||user?.user_metadata?.avatar_url||'';
    if(url) return `<img src="${esc(url)}" alt="" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:50%;display:block;">`;
    const name=profile?.username||user?.user_metadata?.username||'A';
    return `<span style="width:${size}px;height:${size}px;border-radius:50%;display:grid;place-items:center;background:rgba(88,199,255,.1);border:1px solid var(--line);color:var(--accent2);font-size:${Math.max(19,size/2.5)}px;font-weight:900">${esc(name.charAt(0).toLocaleUpperCase('tr-TR')||'A')}</span>`;
  }

  function ensureNavButton(){
    const nav=document.querySelector('.site-nav');
    if(!nav || document.getElementById('auth-nav-button')) return;
    const a=document.createElement('a');
    a.id='auth-nav-button';
    a.href='#';
    a.className='auth-nav-button';
    a.textContent='Giriş Yap';
    nav.appendChild(a);
  }

  async function updateNav(){
    ensureNavButton();
    const button=document.getElementById('auth-nav-button');
    if(!button) return;

    if(!currentUser){
      button.textContent='Giriş Yap';
      button.onclick=e=>{e.preventDefault();openAuth('login');};
      currentProfile=null;
      return;
    }

    currentProfile=await getProfile(currentUser);
    const name=currentProfile?.username||currentUser.user_metadata?.username||'Profil';

    button.textContent=`👤 ${name}`;
    button.onclick=e=>{
      e.preventDefault();
      openOwnDrawer();
    };
  }

  function bindGlobalMenu(){
    if(menuBound) return;
    menuBound=true;

    document.querySelectorAll('.menu-toggle').forEach(button=>{
      button.addEventListener('click',()=>{
        const header=button.closest('.site-header');
        const open=!header?.classList.contains('menu-open');
        header?.classList.toggle('menu-open',open);
        button.setAttribute('aria-expanded',String(open));
        button.setAttribute('aria-label',open?'Menüyü kapat':'Menüyü aç');
        button.classList.toggle('is-open',open);
      });
    });

    document.addEventListener('click',event=>{
      const header=document.querySelector('.site-header');
      if(!header||!header.classList.contains('menu-open')) return;
      if(event.target.closest('.site-header')) return;
      header.classList.remove('menu-open');
      document.querySelectorAll('.menu-toggle').forEach(b=>{
        b.classList.remove('is-open');
        b.setAttribute('aria-expanded','false');
        b.setAttribute('aria-label','Menüyü aç');
      });
    });
  }

  function openOwnDrawer(){
    if(!currentUser){ openAuth('login'); return; }
    openUserDrawer(currentProfile||{},currentUser,true);
  }

  function closeDrawer(){
    drawerEl?.remove();
    drawerEl=null;
    document.body.classList.remove('drawer-open');
  }

  function drawerButton(icon,title,desc,action,extra=''){
    return `<button type="button" class="account-menu-item ${extra}" data-action="${action}"><span>${icon}</span><span><b>${title}</b><small>${desc}</small></span></button>`;
  }

  function openUserDrawer(profile,user,isOwn=false){
    closeDrawer();

    const username=profile?.username||user?.user_metadata?.username||'Oyuncu';
    const role=profile?.site_role||'user';
    const avatar=profile?.avatar_url||user?.user_metadata?.avatar_url||'';
    const bio=profile?.bio||'Henüz bir açıklama eklenmemiş.';
    const online=profile?.last_seen && Date.now()-new Date(profile.last_seen).getTime()<5*60*1000;

    drawerEl=document.createElement('aside');
    drawerEl.className='account-drawer';
    drawerEl.innerHTML=`
      <div class="account-drawer-backdrop"></div>
      <section class="account-drawer-panel">
        <div class="account-drawer-head">
          <div class="account-drawer-avatar">${avatarMarkup(profile,user,58)}</div>
          <div class="account-drawer-title">
            <span class="section-label">ATLANTİS MC</span>
            <h2>${esc(username)}</h2>
            <span class="role-chip role-${esc(role)}">${esc(roleLabel(role))}</span>
          </div>
          <button class="account-drawer-close" type="button" aria-label="Kapat">×</button>
        </div>

        <div class="account-drawer-body">
          <div class="account-status-card">
            <span>Durum</span>
            <strong class="${online?'status-online':''}">${esc(formatLastSeen(profile?.last_seen))}</strong>
          </div>

          <div class="account-profile-about">
            <span>Hakkında</span>
            <p>${esc(bio)}</p>
          </div>

          ${
            isOwn
            ? `
              ${drawerButton('👤','Hesap Bilgileri','E-posta, üyelik ve profil','info')}
              ${drawerButton('✏️','Profili Düzenle','Fotoğraf ve açıklama','profile')}
              ${drawerButton('🔑','Şifre Değiştir','Hesap güvenliği','password')}
              ${drawerButton('📧','E-posta Değiştir','Yeni e-posta adresi','email')}
              <a class="account-menu-item" href="sohbet.html"><span>💬</span><span><b>Sohbete Git</b><small>Canlı Atlantis sohbeti</small></span></a>
              ${
                role==='admin'||role==='moderator'
                ? `<a class="account-menu-item" href="moderasyon.html"><span>🛡️</span><span><b>Moderasyon</b><small>Yönetim paneli</small></span></a>`
                : ''
              }
              <div class="account-drawer-separator"></div>
              ${drawerButton('↪','Çıkış Yap','Hesabından güvenli şekilde çık','logout','account-menu-danger')}
            `
            : `
              <button class="account-menu-item" type="button" data-action="dm-coming"><span>💬</span><span><b>Mesaj Gönder</b><small>Özel mesaj sistemi sonraki aşamada</small></span></button>
            `
          }
        </div>
      </section>
    `;

    document.body.appendChild(drawerEl);
    document.body.classList.add('drawer-open');

    drawerEl.querySelector('.account-drawer-backdrop').onclick=closeDrawer;
    drawerEl.querySelector('.account-drawer-close').onclick=closeDrawer;

    drawerEl.querySelector('[data-action="info"]')?.addEventListener('click',()=>showAccountInfo());
    drawerEl.querySelector('[data-action="profile"]')?.addEventListener('click',()=>{
      closeDrawer();
      openProfileEditor();
    });
    drawerEl.querySelector('[data-action="password"]')?.addEventListener('click',()=>{
      closeDrawer();
      openAuth('reset');
    });
    drawerEl.querySelector('[data-action="email"]')?.addEventListener('click',changeEmail);
    drawerEl.querySelector('[data-action="logout"]')?.addEventListener('click',confirmLogout);
    drawerEl.querySelector('[data-action="dm-coming"]')?.addEventListener('click',()=>{
      toast('Özel mesaj sistemi sonraki aşamada eklenebilir.');
    });
  }

  function showAccountInfo(){
    closeDrawer();
    const old=document.getElementById('account-info-modal'); old?.remove();

    const profile=currentProfile||{};
    const user=currentUser;
    const overlay=document.createElement('div');
    overlay.id='account-info-modal';
    overlay.className='auth-modal';
    overlay.innerHTML=`
      <div class="auth-backdrop"></div>
      <section class="auth-dialog account-info-dialog">
        <button class="auth-close" type="button">×</button>
        <div class="auth-brand">👤</div>
        <span class="section-label">ATLANTİS MC</span>
        <h2>Hesap Bilgileri</h2>
        <div class="account-info-profile">
          ${avatarMarkup(profile,user,88)}
          <strong>${esc(profile.username||user?.user_metadata?.username||'Oyuncu')}</strong>
          <span class="role-chip role-${esc(profile.site_role||'user')}">${esc(roleLabel(profile.site_role||'user'))}</span>
        </div>
        <div class="account-info-grid">
          <div><span>E-posta</span><strong>${esc(user?.email||'Bilinmiyor')}</strong></div>
          <div><span>Üyelik</span><strong>${user?.created_at?new Date(user.created_at).toLocaleDateString('tr-TR'):'Bilinmiyor'}</strong></div>
          <div class="account-info-full"><span>Hakkında</span><strong>${esc(profile.bio||'Henüz açıklama eklenmemiş.')}</strong></div>
          <div class="account-info-full"><span>Durum</span><strong>${esc(formatLastSeen(profile.last_seen))}</strong></div>
        </div>
      </section>
    `;
    document.body.appendChild(overlay);
    const close=()=>overlay.remove();
    overlay.querySelector('.auth-close').onclick=close;
    overlay.querySelector('.auth-backdrop').onclick=close;
  }

  function openProfileEditor(){
    if(!currentUser){openAuth('login');return;}

    const profile=currentProfile||{};
    const old=document.getElementById('profile-editor-modal'); old?.remove();
    let avatar=profile.avatar_url||currentUser.user_metadata?.avatar_url||'';

    const overlay=document.createElement('div');
    overlay.id='profile-editor-modal';
    overlay.className='auth-modal';
    overlay.innerHTML=`
      <div class="auth-backdrop"></div>
      <section class="auth-dialog profile-editor-dialog">
        <button class="auth-close" type="button">×</button>
        <div class="auth-brand">👤</div>
        <span class="section-label">ATLANTİS MC</span>
        <h2>Profili Düzenle</h2>

        <div id="profile-avatar-preview" class="profile-editor-avatar"></div>

        <label class="file-button">
          📷 Profil fotoğrafı seç
          <input id="profile-avatar-file" type="file" accept="image/jpeg,image/png,image/webp" hidden>
        </label>

        <button class="ghost-button wide" id="profile-avatar-remove" type="button">
          Fotoğrafı kaldır
        </button>

        <label class="profile-field-label">
          Kullanıcı adı
          <input value="${esc(profile.username||currentUser.user_metadata?.username||'')}" disabled>
        </label>

        <label class="profile-field-label">
          Hakkında
          <textarea id="profile-bio-input" rows="4" maxlength="180"
            placeholder="Kendinden biraz bahset...">${esc(profile.bio||'')}</textarea>
        </label>

        <button class="primary-button wide" id="profile-editor-save" type="button">
          Kaydet
        </button>

        <div class="auth-message" id="profile-editor-message"></div>
      </section>
    `;
    document.body.appendChild(overlay);

    const preview=overlay.querySelector('#profile-avatar-preview');

    const render=()=>{
      const name=profile.username||currentUser.user_metadata?.username||'A';
      preview.innerHTML=avatar
        ? `<img src="${esc(avatar)}" alt="" style="width:96px;height:96px;object-fit:cover;border-radius:50%;">`
        : `<span style="width:96px;height:96px;border-radius:50%;display:grid;place-items:center;background:rgba(88,199,255,.1);border:1px solid var(--line);color:var(--accent2);font-size:34px;font-weight:900">${esc(name.charAt(0).toLocaleUpperCase('tr-TR')||'A')}</span>`;
    };
    render();

    overlay.querySelector('#profile-avatar-file').onchange=e=>{
      const file=e.target.files?.[0];
      if(!file)return;
      if(file.size>700*1024){
        setEditorMessage('Profil fotoğrafı 700 KB altında olmalı.','error');
        return;
      }
      const reader=new FileReader();
      reader.onload=()=>{avatar=String(reader.result||'');render();};
      reader.readAsDataURL(file);
    };

    overlay.querySelector('#profile-avatar-remove').onclick=()=>{
      avatar=''; render();
    };

    overlay.querySelector('.auth-close').onclick=()=>overlay.remove();
    overlay.querySelector('.auth-backdrop').onclick=()=>overlay.remove();

    overlay.querySelector('#profile-editor-save').onclick=async()=>{
      const btn=overlay.querySelector('#profile-editor-save');
      const bio=String(overlay.querySelector('#profile-bio-input')?.value||'').trim();
      btn.disabled=true; btn.textContent='Kaydediliyor...';

      try{
        const c=await getClient();
        const {data,error}=await c.rpc('update_my_profile',{
          new_avatar_url:avatar||null,
          new_bio:bio
        });
        if(error) throw error;

        currentProfile=data||{...(currentProfile||{}),bio,avatar_url:avatar||null};
        await updateNav();
        setEditorMessage('Profil güncellendi.','success');
        setTimeout(()=>overlay.remove(),650);
      }catch(error){
        console.error('[Atlantis] profile update',error);
        setEditorMessage(error?.message||'Profil güncellenemedi.','error');
      }finally{
        btn.disabled=false; btn.textContent='Kaydet';
      }
    };

    function setEditorMessage(text,kind){
      const m=overlay.querySelector('#profile-editor-message');
      m.textContent=text;
      m.className='auth-message '+kind;
    }
  }

  async function changeEmail(){
    const value=window.prompt('Yeni e-posta adresin:');
    if(!value)return;
    const email=value.trim().toLowerCase();
    if(!EMAIL_REGEX.test(email)){window.alert('Geçerli bir e-posta adresi gir.');return;}
    const c=await getClient();
    if(!c)return;
    const {error}=await c.auth.updateUser({email});
    window.alert(error?.message||'Yeni e-posta adresine doğrulama gönderildi.');
  }

  async function confirmLogout(){
    closeDrawer();
    const ok=window.confirm('Atlantis MC hesabından çıkış yapmak istediğine emin misin?');
    if(!ok)return;
    await signOut();
  }

  async function signOut(){
    const c=await getClient();
    if(c){
      const {error}=await c.auth.signOut();
      if(error){window.alert(error.message||'Çıkış yapılamadı.');return;}
    }
    currentUser=null;
    currentProfile=null;
    window.atlantisAuthSession=null;
    await updateNav();
    window.dispatchEvent(new CustomEvent('atlantis-auth-logout'));
  }

  function setAuthView(view){
    const views=['login','signup','forgot','otp','reset'];
    views.forEach(v=>{
      const f=document.getElementById(`auth-${v}-form`);
      if(f)f.hidden=v!==view;
    });
    const tabs=document.querySelector('.auth-tabs');
    if(tabs)tabs.hidden=!['login','signup'].includes(view);
    const title=document.getElementById('auth-title');
    const subtitle=document.getElementById('auth-subtitle');
    const data={
      login:['Giriş Yap','Hesabına giriş yap ve Atlantis topluluğuna katıl.'],
      signup:['Kayıt Ol','Atlantis hesabını oluştur.'],
      forgot:['Şifremi Unuttum','E-posta adresine doğrulama kodu gönderelim.'],
      otp:['Kodu Doğrula','E-posta kutundaki 6 haneli kodu gir.'],
      reset:['Yeni Şifre','Hesabın için yeni bir şifre belirle.']
    }[view]||['Giriş Yap',''];
    if(title)title.textContent=data[0];
    if(subtitle)subtitle.textContent=data[1];
    document.querySelectorAll('[data-auth-tab]').forEach(b=>{
      b.classList.toggle('is-active',b.dataset.authTab===view);
    });
    setAuthMessage('');
  }

  function setAuthMessage(text,kind=''){
    const el=document.getElementById('auth-message');
    if(el){el.textContent=text;el.className='auth-message'+(kind?' '+kind:'');}
  }

  function ensureAuthModal(){
    if(document.getElementById('auth-modal'))return;

    const modal=document.createElement('div');
    modal.id='auth-modal';
    modal.className='auth-modal';
    modal.hidden=true;
    modal.innerHTML=`
      <div class="auth-backdrop"></div>
      <section class="auth-dialog">
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
            <input name="identifier" required autocomplete="username" placeholder="OyuncuAdı veya eposta@gmail.com">
          </label>
          <label>Şifre
            <input name="password" type="password" required autocomplete="current-password" placeholder="Şifren">
          </label>
          <button class="primary-button wide" type="submit">Giriş Yap</button>
          <button class="google-button" id="google-login" type="button">G <span>Google ile giriş yap</span></button>
          <button class="link-button" id="forgot-password" type="button">Şifremi unuttum</button>
        </form>

        <form id="auth-signup-form" class="auth-form" hidden>
          <label>Kullanıcı adı
            <input name="username" required minlength="3" maxlength="16" placeholder="AtlantisOyuncu">
          </label>
          <label>E-posta
            <input name="email" type="email" required autocomplete="email" placeholder="ornek@gmail.com">
          </label>
          <label>Şifre
            <input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="En az 8 karakter">
          </label>
          <button class="primary-button wide" type="submit">Kayıt Ol</button>
          <button class="google-button" id="google-signup" type="button">G <span>Google ile kayıt ol</span></button>
        </form>

        <form id="auth-forgot-form" class="auth-form" hidden>
          <label>E-posta
            <input name="email" type="email" required placeholder="ornek@gmail.com">
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
            <button id="otp-resend" class="otp-resend" type="button">Kodu tekrar gönder</button>
          </div>
          <button class="primary-button wide" type="submit">Kodu Doğrula</button>
          <button class="link-button" type="button" data-back-login>Girişe dön</button>
        </form>

        <form id="auth-reset-form" class="auth-form" hidden>
          <label>Yeni şifre
            <input name="password" type="password" required minlength="8" autocomplete="new-password">
          </label>
          <label>Yeni şifre tekrar
            <input name="password2" type="password" required minlength="8" autocomplete="new-password">
          </label>
          <button class="primary-button wide" type="submit">Şifreyi Değiştir</button>
        </form>

        <div id="auth-message" class="auth-message"></div>
      </section>
    `;

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
    modal.querySelector('#auth-forgot-form').onsubmit=forgot;
    modal.querySelector('#auth-otp-form').onsubmit=verifyOtp;
    modal.querySelector('#auth-reset-form').onsubmit=resetPassword;
    modal.querySelector('#otp-resend').onclick=resendOtp;
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
  }

  async function login(event){
    event.preventDefault();
    const form=event.currentTarget;
    const identifier=String(form.elements.identifier.value||'').trim();
    const password=String(form.elements.password.value||'');
    const button=form.querySelector('button[type=submit]');
    button.disabled=true; button.textContent='Giriş yapılıyor...';

    try{
      const c=await getClient();
      if(!c)throw new Error('Supabase bağlantısı kurulamadı.');

      if(EMAIL_REGEX.test(identifier)){
        const {data,error}=await c.auth.signInWithPassword({email:identifier.toLowerCase(),password});
        if(error)throw new Error('E-posta veya şifre hatalı.');
        await afterLogin(data.session);
      }else{
        const url=edgeLogin || '';
        if(!url)throw new Error('Kullanıcı adıyla giriş servisi bulunamadı. E-posta ile giriş yapabilirsin.');
        const response=await fetch(url,{
          method:'POST',
          headers:{'Content-Type':'application/json',apikey:cfg.publishableKey},
          body:JSON.stringify({username:identifier,password})
        });
        const result=await response.json().catch(()=>({}));
        if(!response.ok||!result.session)throw new Error(result.error||'Kullanıcı adı veya şifre hatalı.');
        const {error}=await c.auth.setSession({
          access_token:result.session.access_token,
          refresh_token:result.session.refresh_token
        });
        if(error)throw error;
        await afterLogin(result.session);
      }
    }catch(error){
      setAuthMessage(error?.message||'Giriş başarısız.','error');
    }finally{
      button.disabled=false; button.textContent='Giriş Yap';
    }
  }

  async function signup(event){
    event.preventDefault();
    const form=event.currentTarget;
    const username=String(form.elements.username.value||'').trim();
    const email=String(form.elements.email.value||'').trim().toLowerCase();
    const password=String(form.elements.password.value||'');

    if(!NAME_REGEX.test(username)){setAuthMessage('Kullanıcı adı 3–16 karakter olmalı.','error');return;}
    if(!EMAIL_REGEX.test(email)){setAuthMessage('Geçerli bir e-posta adresi gir.','error');return;}
    if(password.length<8){setAuthMessage('Şifre en az 8 karakter olmalı.','error');return;}

    const button=form.querySelector('button[type=submit]');
    button.disabled=true; button.textContent='Hesap oluşturuluyor...';

    try{
      const c=await getClient();
      const {data:existing}=await c.from('profiles').select('id').ilike('username',username).maybeSingle();
      if(existing)throw new Error('Bu kullanıcı adı zaten kullanılıyor.');

      const {data,error}=await c.auth.signUp({
        email,password,
        options:{
          data:{username},
          emailRedirectTo:window.location.origin+window.location.pathname
        }
      });
      if(error)throw error;

      window.atlantisPendingEmail=email;
      window.atlantisPendingUsername=username;

      if(data.session){
        await afterLogin(data.session);
      }else{
        setAuthView('otp');
        document.getElementById('otp-info').textContent=`${email} adresine doğrulama kodu gönderildi.`;
        setAuthMessage('E-posta kutunu kontrol et.','success');
      }
    }catch(error){
      setAuthMessage(error?.message||'Kayıt başarısız.','error');
    }finally{
      button.disabled=false; button.textContent='Kayıt Ol';
    }
  }

  async function googleLogin(){
    const c=await getClient();
    if(!c)return;
    const {error}=await c.auth.signInWithOAuth({
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

  async function forgot(event){
    event.preventDefault();
    const email=String(event.currentTarget.elements.email.value||'').trim().toLowerCase();
    if(!EMAIL_REGEX.test(email)){setAuthMessage('Geçerli bir e-posta adresi gir.','error');return;}

    try{
      const c=await getClient();
      if(edgeRecovery){
        const response=await fetch(edgeRecovery,{
          method:'POST',
          headers:{'Content-Type':'application/json',apikey:cfg.publishableKey},
          body:JSON.stringify({email})
        });
        const result=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(result.error||'Kod gönderilemedi.');
      }else{
        const {error}=await c.auth.resetPasswordForEmail(email,{
          redirectTo:window.location.origin+window.location.pathname
        });
        if(error)throw error;
      }
      window.atlantisPendingEmail=email;
      window.atlantisOtpMode='recovery';
      setAuthView('otp');
      document.getElementById('otp-info').textContent=`${email} adresine doğrulama kodu gönderildi.`;
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
      const c=await getClient();
      const type=window.atlantisOtpMode==='recovery'?'recovery':'email';
      const {data,error}=await c.auth.verifyOtp({email,token,type});
      if(error)throw error;

      if(type==='recovery'){
        setAuthView('reset');
      }else{
        if(window.atlantisPendingUsername){
          await c.rpc('set_my_username',{new_username:window.atlantisPendingUsername});
        }
        await afterLogin(data.session);
      }
    }catch(error){
      setAuthMessage('Kod hatalı veya süresi dolmuş.','error');
    }
  }

  async function resendOtp(){
    const email=String(window.atlantisPendingEmail||'').trim().toLowerCase();
    if(!EMAIL_REGEX.test(email))return;
    const c=await getClient();
    if(!c)return;

    try{
      if(window.atlantisOtpMode==='recovery'){
        const {error}=await c.auth.resetPasswordForEmail(email,{
          redirectTo:window.location.origin+window.location.pathname
        });
        if(error)throw error;
      }else{
        const {error}=await c.auth.resend({type:'signup',email});
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
      const c=await getClient();
      const {error}=await c.auth.updateUser({password:p});
      if(error)throw error;
      setAuthMessage('Şifren başarıyla değiştirildi.','success');
      setTimeout(closeAuth,700);
    }catch(error){
      setAuthMessage(error?.message||'Şifre değiştirilemedi.','error');
    }
  }

  async function afterLogin(session){
    if(!session?.user)return;
    currentUser=session.user;
    window.atlantisAuthSession=session;
    await updateNav();
    closeAuth();
    window.dispatchEvent(new CustomEvent('atlantis-auth-login',{detail:{user:currentUser,session}}));
  }

  function toast(text){
    let el=document.getElementById('atlantis-global-toast');
    if(!el){
      el=document.createElement('div');
      el.id='atlantis-global-toast';
      el.className='chat-toast';
      document.body.appendChild(el);
    }
    el.textContent=text;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer=setTimeout(()=>el.classList.remove('show'),2400);
  }

  async function init(){
    if(booted)return;
    booted=true;
    ensureAuthModal();
    ensureNavButton();
    bindGlobalMenu();

    const c=await getClient();
    if(!c)return;

    const {data:{session}}=await c.auth.getSession();
    currentUser=session?.user||null;
    window.atlantisAuthSession=session||null;

    await updateNav();

    c.auth.onAuthStateChange((event,next)=>{
      setTimeout(async()=>{
        currentUser=next?.user||null;
        window.atlantisAuthSession=next||null;
        if(currentUser)currentProfile=await getProfile(currentUser);
        else currentProfile=null;
        await updateNav();
        window.dispatchEvent(new CustomEvent(
          currentUser?'atlantis-auth-login':'atlantis-auth-logout',
          {detail:{user:currentUser,session:next||null}}
        ));
      },0);
    });

    // Keep last_seen fresh.
    setInterval(async()=>{
      if(currentUser){
        try{await c.rpc('touch_my_last_seen');}catch{}
      }
    },60000);
  }

  // Public API for chat and other pages.
  window.openAtlantisAuth=openAuth;
  window.closeAtlantisAuth=closeAuth;
  window.atlantisGetClient=getClient;
  window.atlantisGetProfile=getProfile;
  window.openAtlantisUserDrawer=(profile)=>openUserDrawer(profile,null,false);
  window.atlantisToast=toast;

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',init,{once:true});
  }else{
    init();
  }

  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){
      closeDrawer();
      closeAuth();
      document.getElementById('account-info-modal')?.remove();
      document.getElementById('profile-editor-modal')?.remove();
    }
  });
})();

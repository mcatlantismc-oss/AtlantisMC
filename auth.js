/* Atlantis MC — FINAL AUTH FIX
   Replaces the previous auth(5).js.
   Fixes:
   - profile button opening login + profile menu at the same time
   - mobile hamburger menu
   - profile drawer/edit actions
   - logout confirmation
   - persistent Supabase session
   - profile refresh after saving
*/
(() => {
  'use strict';

  const cfg = window.ATLANTIS_SUPABASE || {};
  const LOGIN_EDGE = String(window.ATLANTIS_EDGE_URL || '').replace(/\/+$/, '');
  const RECOVERY_EDGE = String(window.ATLANTIS_RECOVERY_URL || '').replace(/\/+$/, '');
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const NAME_RE = /^[A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü0-9]{2,15}$/;

  let client = null;
  let sessionUser = null;
  let profile = null;
  let initialized = false;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[ch]));

  function setGlobalProfile(user, data) {
    sessionUser = user || null;
    profile = data || null;
    window.atlantisAuthSession = user ? { ...(window.atlantisAuthSession || {}), user } : null;
    window.atlantisCurrentProfile = data || {};
  }

  function getRoleName(role) {
    return role === 'admin' ? 'Yönetici' : role === 'moderator' ? 'Moderatör' : 'Oyuncu';
  }

  async function getProfile(user = sessionUser) {
    if (!client || !user) return null;
    const { data, error } = await client.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) {
      console.warn('[Atlantis Auth] profile read:', error);
      return null;
    }
    return data || null;
  }

  async function refreshIdentity() {
    if (!client) return null;
    const { data: { session } } = await client.auth.getSession();
    const user = session?.user || null;
    const p = user ? await getProfile(user) : null;
    setGlobalProfile(user, p);
    return { user, profile: p };
  }

  function ensureNavButton() {
    const nav = document.querySelector('.site-nav');
    if (!nav) return null;

    let btn = document.getElementById('auth-nav-button');

    if (!btn) {
      btn = document.createElement('a');
      btn.id = 'auth-nav-button';
      btn.href = '#';
      btn.className = 'auth-nav-button';
      btn.textContent = 'Giriş Yap';
      nav.appendChild(btn);
    }

    /* IMPORTANT: clone removes old anonymous click listeners from older auth versions. */
    if (btn.dataset.atlantisFinalBound !== '1') {
      const clean = btn.cloneNode(true);
      btn.replaceWith(clean);
      btn = clean;
      btn.dataset.atlantisFinalBound = '1';
      btn.onclick = event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (sessionUser) openProfileDrawer(profile || {});
        else openAuth('login');
      };
    }

    return btn;
  }

  function updateNav() {
    const btn = ensureNavButton();
    if (!btn) return;

    if (!sessionUser) {
      btn.textContent = 'Giriş Yap';
      return;
    }

    const username = String(profile?.username || sessionUser.user_metadata?.username || 'Profil').trim();
    const avatar = String(profile?.avatar_url || sessionUser.user_metadata?.avatar_url || '');
    btn.innerHTML = avatar
      ? `<img class="auth-nav-avatar" src="${esc(avatar)}" alt=""><span>${esc(username)}</span>`
      : `👤 <span>${esc(username)}</span>`;
  }

  function bindHamburger() {
    document.querySelectorAll('.menu-toggle').forEach(original => {
      if (original.dataset.atlantisFinalBound === '1') return;

      const toggle = original.cloneNode(true);
      original.replaceWith(toggle);
      toggle.dataset.atlantisFinalBound = '1';

      toggle.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();

        const header = toggle.closest('.site-header');
        const open = !document.body.classList.contains('menu-open');

        document.body.classList.toggle('menu-open', open);
        header?.classList.toggle('menu-open', open);
        toggle.classList.toggle('is-open', open);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Menüyü kapat' : 'Menüyü aç');
      });

      const nav = toggle.closest('.site-header')?.querySelector('.site-nav');
      nav?.addEventListener('click', event => {
        const link = event.target.closest('a');
        if (!link) return;
        document.body.classList.remove('menu-open');
        toggle.closest('.site-header')?.classList.remove('menu-open');
        toggle.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  function closeDrawer() {
    document.getElementById('atlantis-account-drawer')?.remove();
    document.body.classList.remove('drawer-open');
  }

  function openProfileDrawer(p, own = true) {
    closeDrawer();

    const name = String(p?.username || sessionUser?.user_metadata?.username || 'Oyuncu');
    const role = p?.site_role || 'user';
    const avatar = p?.avatar_url || sessionUser?.user_metadata?.avatar_url || '';
    const bio = p?.bio || 'Henüz bir açıklama eklenmemiş.';
    const online = p?.last_seen && !Number.isNaN(new Date(p.last_seen).getTime()) &&
      (Date.now() - new Date(p.last_seen).getTime() < 5 * 60 * 1000);

    const drawer = document.createElement('aside');
    drawer.id = 'atlantis-account-drawer';
    drawer.className = 'account-drawer';
    drawer.innerHTML = `
      <div class="account-drawer-backdrop"></div>
      <section class="account-drawer-panel">
        <div class="account-drawer-head">
          <div class="account-drawer-avatar">
            ${avatar
              ? `<img src="${esc(avatar)}" alt="">`
              : `<span class="avatar-fallback">${esc(name.charAt(0).toLocaleUpperCase('tr-TR') || 'A')}</span>`}
          </div>
          <div class="account-drawer-title">
            <span class="section-label">ATLANTİS PROFİLİ</span>
            <h2>${esc(name)}</h2>
            <span class="role-chip role-${esc(role)}">${esc(getRoleName(role))}</span>
          </div>
          <button type="button" class="account-drawer-close" aria-label="Kapat">×</button>
        </div>

        <div class="account-drawer-body">
          <div class="account-status-card">
            <span>Durum</span>
            <strong class="${online ? 'status-online' : ''}">${online ? 'Çevrimiçi' : 'Son görülme bilinmiyor'}</strong>
          </div>

          <div class="account-profile-about">
            <span>Hakkında</span>
            <p>${esc(bio)}</p>
          </div>

          ${own ? `
            <button class="account-menu-item" type="button" data-account="info"><span>👤</span><span><b>Hesap Bilgileri</b><small>E-posta ve üyelik bilgileri</small></span></button>
            <button class="account-menu-item" type="button" data-account="edit"><span>✏️</span><span><b>Profili Düzenle</b><small>Profil fotoğrafı ve açıklama</small></span></button>
            <button class="account-menu-item" type="button" data-account="password"><span>🔑</span><span><b>Şifre Değiştir</b><small>Hesap güvenliği</small></span></button>
            <button class="account-menu-item" type="button" data-account="email"><span>📧</span><span><b>E-posta Değiştir</b><small>Yeni e-posta adresi</small></span></button>
            <a class="account-menu-item" href="sohbet.html"><span>💬</span><span><b>Sohbete Git</b><small>Canlı Atlantis sohbeti</small></span></a>
            ${(role === 'admin' || role === 'moderator') ? '<a class="account-menu-item" href="moderasyon.html"><span>🛡️</span><span><b>Moderasyon</b><small>Yönetim paneli</small></span></a>' : ''}
            <div class="account-drawer-separator"></div>
            <button class="account-menu-item account-menu-danger" type="button" data-account="logout"><span>↪</span><span><b>Çıkış Yap</b><small>Bu cihazdaki oturumu kapat</small></span></button>
          ` : `
            <div class="profile-online-note">${online ? '● Şu anda Atlantis\'te çevrimiçi' : 'Profil bilgileri'}</div>
          `}
        </div>
      </section>
    `;

    document.body.appendChild(drawer);
    document.body.classList.add('drawer-open');

    drawer.querySelector('.account-drawer-backdrop').onclick = closeDrawer;
    drawer.querySelector('.account-drawer-close').onclick = closeDrawer;

    drawer.querySelector('[data-account="info"]')?.addEventListener('click', showAccountInfo);
    drawer.querySelector('[data-account="edit"]')?.addEventListener('click', async () => {
      closeDrawer();
      await openEditProfile();
    });
    drawer.querySelector('[data-account="password"]')?.addEventListener('click', () => {
      closeDrawer();
      openAuth('reset');
    });
    drawer.querySelector('[data-account="email"]')?.addEventListener('click', changeEmail);
    drawer.querySelector('[data-account="logout"]')?.addEventListener('click', confirmLogout);
  }

  function showAccountInfo() {
    closeDrawer();
    const old = document.getElementById('atlantis-account-info');
    old?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'atlantis-account-info';
    overlay.className = 'auth-modal';
    overlay.innerHTML = `
      <div class="auth-backdrop"></div>
      <section class="auth-dialog">
        <button class="auth-close" type="button">×</button>
        <div class="auth-brand">👤</div>
        <span class="section-label">ATLANTİS MC</span>
        <h2>Hesap Bilgileri</h2>
        <div class="account-info-profile">
          ${profile?.avatar_url ? `<img src="${esc(profile.avatar_url)}" alt="" class="account-info-avatar">` : `<span class="avatar-fallback account-info-avatar">A</span>`}
          <strong>${esc(profile?.username || sessionUser?.email || 'Oyuncu')}</strong>
          <span class="role-chip role-${esc(profile?.site_role || 'user')}">${esc(getRoleName(profile?.site_role || 'user'))}</span>
        </div>
        <div class="account-info-grid">
          <div><span>E-posta</span><strong>${esc(sessionUser?.email || '')}</strong></div>
          <div><span>Üyelik</span><strong>${sessionUser?.created_at ? esc(new Date(sessionUser.created_at).toLocaleDateString('tr-TR')) : ''}</strong></div>
          <div class="account-info-full"><span>Hakkında</span><strong>${esc(profile?.bio || 'Henüz açıklama eklenmemiş.')}</strong></div>
        </div>
      </section>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.auth-close').onclick = close;
    overlay.querySelector('.auth-backdrop').onclick = close;
  }

  async function changeEmail() {
    closeDrawer();
    if (!sessionUser) return;
    const next = String(prompt('Yeni e-posta adresin:') || '').trim().toLowerCase();
    if (!next) return;
    if (!EMAIL_RE.test(next)) {
      alert('Geçerli bir e-posta adresi gir.');
      return;
    }
    const { error } = await client.auth.updateUser({ email: next });
    alert(error ? (error.message || 'E-posta değiştirilemedi.') : 'Yeni e-posta adresine doğrulama gönderildi.');
  }

  async function confirmLogout() {
    if (!client || !sessionUser) return;
    if (!confirm('Atlantis MC hesabından çıkış yapmak istediğine emin misin?')) return;
    const { error } = await client.auth.signOut();
    if (error) {
      alert(error.message || 'Çıkış yapılamadı.');
      return;
    }
    closeDrawer();
    setGlobalProfile(null, null);
    updateNav();
    window.dispatchEvent(new CustomEvent('atlantis-auth-logout'));
  }

  async function openEditProfile() {
    if (!client || !sessionUser) {
      openAuth('login');
      return;
    }

    const old = document.getElementById('atlantis-profile-edit');
    old?.remove();

    const current = await getProfile(sessionUser) || profile || {};
    profile = current;
    window.atlantisCurrentProfile = current;

    const username = String(current.username || sessionUser.user_metadata?.username || '');
    const bio = String(current.bio || '');
    const avatar = String(current.avatar_url || sessionUser.user_metadata?.avatar_url || '');

    const overlay = document.createElement('div');
    overlay.id = 'atlantis-profile-edit';
    overlay.className = 'auth-modal';
    overlay.innerHTML = `
      <div class="auth-backdrop"></div>
      <section class="auth-dialog profile-editor-dialog">
        <button class="auth-close" type="button">×</button>
        <div class="auth-brand">👤</div>
        <span class="section-label">ATLANTİS MC</span>
        <h2>Profili Düzenle</h2>

        <div class="profile-editor-preview" id="profile-editor-preview">
          ${avatar ? `<img src="${esc(avatar)}" alt="">` : `<span class="avatar-fallback">${esc(username.charAt(0).toLocaleUpperCase('tr-TR') || 'A')}</span>`}
        </div>

        <label class="file-button">📷 Profil fotoğrafı seç
          <input id="profile-avatar-file" type="file" accept="image/jpeg,image/png,image/webp" hidden>
        </label>
        <button class="ghost-button wide" id="profile-avatar-remove" type="button">Fotoğrafı kaldır</button>

        <label class="profile-field-label">Kullanıcı adı
          <input value="${esc(username)}" disabled>
        </label>

        <label class="profile-field-label">Hakkında
          <textarea id="profile-edit-bio" rows="4" maxlength="180" placeholder="Kendinden biraz bahset...">${esc(bio)}</textarea>
        </label>

        <button class="primary-button wide" id="profile-edit-save" type="button">Kaydet</button>
        <div class="auth-message" id="profile-edit-message"></div>
      </section>
    `;

    document.body.appendChild(overlay);

    let chosenData = avatar || '';
    let removed = false;

    const preview = () => {
      const el = overlay.querySelector('#profile-editor-preview');
      el.innerHTML = chosenData && !removed
        ? `<img src="${esc(chosenData)}" alt="">`
        : `<span class="avatar-fallback">${esc(username.charAt(0).toLocaleUpperCase('tr-TR') || 'A')}</span>`;
    };

    overlay.querySelector('#profile-avatar-file').onchange = event => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 2 * 1024 * 1024) {
        setEditMessage('JPG, PNG veya WebP ve en fazla 2 MB seç.', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        chosenData = String(reader.result || '');
        removed = false;
        preview();
      };
      reader.readAsDataURL(file);
    };

    overlay.querySelector('#profile-avatar-remove').onclick = () => {
      chosenData = '';
      removed = true;
      preview();
    };

    overlay.querySelector('.auth-close').onclick = () => overlay.remove();
    overlay.querySelector('.auth-backdrop').onclick = () => overlay.remove();

    overlay.querySelector('#profile-edit-save').onclick = async () => {
      const button = overlay.querySelector('#profile-edit-save');
      button.disabled = true;
      button.textContent = 'Kaydediliyor...';

      try {
        const bioValue = String(overlay.querySelector('#profile-edit-bio').value || '').trim();

        const { data, error } = await client.rpc('update_my_profile', {
          new_avatar_url: removed ? null : (chosenData || null),
          new_bio: bioValue
        });

        if (error) throw error;

        profile = data || { ...current, avatar_url: removed ? null : chosenData || null, bio: bioValue };
        window.atlantisCurrentProfile = profile;
        updateNav();

        /* Update profile images with a fresh cache-busting version. */
        document.querySelectorAll('.auth-nav-avatar').forEach(img => {
          const base = String(profile.avatar_url || '');
          if (base) img.src = base.includes('?') ? `${base}&v=${Date.now()}` : `${base}?v=${Date.now()}`;
        });

        window.dispatchEvent(new CustomEvent('atlantis-profile-updated', { detail: { profile } }));
        setEditMessage('Profil başarıyla güncellendi.', 'success');
        setTimeout(() => overlay.remove(), 650);
      } catch (error) {
        console.error('[Atlantis Auth] profile update:', error);
        setEditMessage(error?.message || 'Profil güncellenemedi.', 'error');
      } finally {
        button.disabled = false;
        button.textContent = 'Kaydet';
      }
    };

    function setEditMessage(text, kind) {
      const el = overlay.querySelector('#profile-edit-message');
      el.textContent = text;
      el.className = `auth-message ${kind || ''}`;
    }
  }

  function ensureAuthModal() {
    if (document.getElementById('auth-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'auth-modal';
    modal.className = 'auth-modal';
    modal.hidden = true;
    modal.innerHTML = `
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
            <input name="username" minlength="3" maxlength="16" required placeholder="AtlantisOyuncu">
          </label>
          <label>E-posta
            <input name="email" type="email" required placeholder="ornek@gmail.com">
          </label>
          <label>Şifre
            <input name="password" type="password" minlength="8" required placeholder="En az 8 karakter">
          </label>
          <button class="primary-button wide" type="submit">Kayıt Ol</button>
          <button class="google-button" id="google-signup" type="button"><b>G</b> Google ile kayıt ol</button>
        </form>

        <form id="auth-forgot-form" class="auth-form" hidden>
          <label>E-posta
            <input name="email" type="email" required placeholder="ornek@gmail.com">
          </label>
          <button class="primary-button wide" type="submit">Kod/bağlantı gönder</button>
          <button class="link-button" type="button" data-back-login>Girişe dön</button>
        </form>

        <form id="auth-reset-form" class="auth-form" hidden>
          <label>Yeni şifre
            <input name="password" type="password" minlength="8" required>
          </label>
          <label>Yeni şifre tekrar
            <input name="password2" type="password" minlength="8" required>
          </label>
          <button class="primary-button wide" type="submit">Şifreyi Değiştir</button>
        </form>

        <div class="auth-message" id="auth-message"></div>
      </section>
    `;

    document.body.appendChild(modal);

    modal.querySelector('.auth-close').onclick = closeAuth;
    modal.querySelector('.auth-backdrop').onclick = closeAuth;
    modal.querySelectorAll('[data-auth-tab]').forEach(btn => btn.onclick = () => openAuth(btn.dataset.authTab));
    modal.querySelectorAll('[data-back-login]').forEach(btn => btn.onclick = () => openAuth('login'));
    modal.querySelector('#forgot-password').onclick = () => openAuth('forgot');
    modal.querySelector('#google-login').onclick = googleLogin;
    modal.querySelector('#google-signup').onclick = googleLogin;
    modal.querySelector('#auth-login-form').onsubmit = login;
    modal.querySelector('#auth-signup-form').onsubmit = signup;
    modal.querySelector('#auth-forgot-form').onsubmit = forgot;
    modal.querySelector('#auth-reset-form').onsubmit = resetPassword;
  }

  function setAuthMessage(text, kind='') {
    const el = document.getElementById('auth-message');
    if (el) {
      el.textContent = text;
      el.className = `auth-message ${kind}`;
    }
  }

  function showAuthForm(name) {
    ['login','signup','forgot','reset'].forEach(n => {
      const form = document.getElementById(`auth-${n}-form`);
      if (form) form.hidden = n !== name;
    });
    const tabs = document.querySelector('.auth-tabs');
    if (tabs) tabs.hidden = !['login','signup'].includes(name);
    const labels = {
      login:['Giriş Yap','Hesabına giriş yap ve Atlantis topluluğuna katıl.'],
      signup:['Kayıt Ol','Atlantis hesabını oluştur.'],
      forgot:['Şifremi Unuttum','E-posta adresine şifre yenileme isteği gönder.'],
      reset:['Yeni Şifre','Yeni şifreni belirle.']
    };
    const value = labels[name] || labels.login;
    document.getElementById('auth-title').textContent = value[0];
    document.getElementById('auth-subtitle').textContent = value[1];
    setAuthMessage('');
  }

  function openAuth(name='login') {
    ensureAuthModal();
    const modal = document.getElementById('auth-modal');
    modal.hidden = false;
    document.body.classList.add('auth-open');
    showAuthForm(name);
    setTimeout(() => modal.querySelector('.auth-form:not([hidden]) input')?.focus(), 30);
  }

  function closeAuth() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.hidden = true;
    document.body.classList.remove('auth-open');
  }

  async function login(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const identifier = String(form.elements.identifier.value || '').trim();
    const password = String(form.elements.password.value || '');

    try {
      if (EMAIL_RE.test(identifier)) {
        const { data, error } = await client.auth.signInWithPassword({
          email: identifier.toLowerCase(), password
        });
        if (error) throw new Error('E-posta veya şifre hatalı.');
        await finishLogin(data.session);
        return;
      }

      if (!LOGIN_EDGE) throw new Error('Kullanıcı adıyla giriş servisi yapılandırılmamış.');
      const response = await fetch(LOGIN_EDGE, {
        method:'POST',
        headers:{'Content-Type':'application/json', apikey:cfg.publishableKey},
        body:JSON.stringify({username:identifier,password})
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.session) throw new Error(result.error || 'Kullanıcı adı veya şifre hatalı.');

      const { error } = await client.auth.setSession({
        access_token:result.session.access_token,
        refresh_token:result.session.refresh_token
      });
      if (error) throw error;
      await finishLogin(result.session);
    } catch (error) {
      setAuthMessage(error?.message || 'Giriş başarısız.', 'error');
    }
  }

  async function signup(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const username = String(form.elements.username.value || '').trim();
    const email = String(form.elements.email.value || '').trim().toLowerCase();
    const password = String(form.elements.password.value || '');

    if (!NAME_RE.test(username)) return setAuthMessage('Kullanıcı adı 3–16 karakter olmalı.', 'error');
    if (!EMAIL_RE.test(email)) return setAuthMessage('Geçerli bir e-posta adresi gir.', 'error');
    if (password.length < 8) return setAuthMessage('Şifre en az 8 karakter olmalı.', 'error');

    try {
      const { data: taken } = await client.from('profiles').select('id').ilike('username', username).maybeSingle();
      if (taken) throw new Error('Bu kullanıcı adı zaten kullanılıyor.');

      const { data, error } = await client.auth.signUp({
        email, password, options:{
          data:{username},
          emailRedirectTo:window.location.origin + window.location.pathname
        }
      });
      if (error) throw error;

      if (data.session) {
        await client.rpc('set_my_username',{new_username:username});
        await finishLogin(data.session);
      } else {
        setAuthMessage('Hesabın oluşturuldu. E-posta doğrulamasını tamamla.', 'success');
      }
    } catch (error) {
      setAuthMessage(error?.message || 'Kayıt başarısız.', 'error');
    }
  }

  async function googleLogin() {
    const { error } = await client.auth.signInWithOAuth({
      provider:'google',
      options:{
        redirectTo:window.location.origin + window.location.pathname,
        queryParams:{prompt:'select_account'}
      }
    });
    if (error) setAuthMessage(error.message || 'Google girişi başarısız.', 'error');
  }

  async function forgot(event) {
    event.preventDefault();
    const email = String(event.currentTarget.elements.email.value || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return setAuthMessage('Geçerli bir e-posta adresi gir.', 'error');

    try {
      if (RECOVERY_EDGE) {
        const response = await fetch(RECOVERY_EDGE,{
          method:'POST',
          headers:{'Content-Type':'application/json',apikey:cfg.publishableKey},
          body:JSON.stringify({email})
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'İstek gönderilemedi.');
      } else {
        const { error } = await client.auth.resetPasswordForEmail(email,{
          redirectTo:window.location.origin + window.location.pathname
        });
        if (error) throw error;
      }
      setAuthMessage('Şifre yenileme bağlantısı/kodu gönderildi.', 'success');
    } catch (error) {
      setAuthMessage(error?.message || 'İstek gönderilemedi.', 'error');
    }
  }

  async function resetPassword(event) {
    event.preventDefault();
    const p = String(event.currentTarget.elements.password.value || '');
    const p2 = String(event.currentTarget.elements.password2.value || '');
    if (p.length < 8) return setAuthMessage('Şifre en az 8 karakter olmalı.', 'error');
    if (p !== p2) return setAuthMessage('Şifreler aynı değil.', 'error');

    const { error } = await client.auth.updateUser({password:p});
    if (error) setAuthMessage(error.message || 'Şifre değiştirilemedi.', 'error');
    else {
      setAuthMessage('Şifren başarıyla değiştirildi.', 'success');
      setTimeout(closeAuth,700);
    }
  }

  async function finishLogin(sess) {
    const p = await getProfile(sess.user);
    setGlobalProfile(sess.user,p);
    if (!p?.username && sess.user.user_metadata?.username) {
      try {
        await client.rpc('set_my_username',{new_username:sess.user.user_metadata.username});
        profile = await getProfile(sess.user) || p;
      } catch {}
    }
    updateNav();
    closeAuth();
    window.dispatchEvent(new CustomEvent('atlantis-auth-login',{
      detail:{user:sessionUser,session:sess}
    }));
  }

  async function init() {
    if (initialized) return;
    initialized = true;

    ensureAuthModal();
    bindHamburger();

    client = await window.atlantisAuthReady;
    if (!client) return;

    await refreshIdentity();
    updateNav();

    client.auth.onAuthStateChange((event, sess) => {
      setTimeout(async () => {
        if (sess?.user) {
          const p = await getProfile(sess.user);
          setGlobalProfile(sess.user,p);
        } else {
          setGlobalProfile(null,null);
        }
        updateNav();
        window.dispatchEvent(new CustomEvent(sess?.user ? 'atlantis-auth-login' : 'atlantis-auth-logout',{
          detail:{user:sessionUser,session:sess||null,event}
        }));
      },0);
    });
  }

  window.atlantisAuthReady = new Promise(resolve => {
    const start = () => {
      if (!window.supabase || !cfg.url || !cfg.publishableKey) return resolve(null);
      const c = window.supabase.createClient(cfg.url,cfg.publishableKey,{
        auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}
      });
      window.atlantisSupabase = c;
      resolve(c);
    };
    if (window.supabase) start();
    else window.addEventListener('supabase-ready',start,{once:true});
  });

  window.atlantisGetClient = async () => client || await window.atlantisAuthReady;
  window.atlantisGetProfile = getProfile;
  window.openAtlantisAuth = openAuth;
  window.closeAtlantisAuth = closeAuth;
  window.openAtlantisUserDrawer = p => openProfileDrawer(p,false);
  window.openAtlantisProfileCard = p => openProfileDrawer(p,false);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();

  document.addEventListener('keydown',event => {
    if (event.key !== 'Escape') return;
    closeDrawer();
    closeAuth();
    document.getElementById('atlantis-account-info')?.remove();
    document.getElementById('atlantis-profile-edit')?.remove();
  });
})();


/* Atlantis MC — global visual system loaded by auth.js on modern pages. */
(() => {
  'use strict';
  const id='atlantis-auth-visual-style';
  function init(){
    if(!document.getElementById(id)){
      const style=document.createElement('style');
      style.id=id;
      style.textContent=`
        body{transition:opacity .22s ease,transform .22s ease}
        .reveal{will-change:opacity,transform}
        .reveal.in-view{animation:atlantisGlobalRise .55s cubic-bezier(.2,.8,.2,1) both}
        @keyframes atlantisGlobalRise{from{opacity:0;transform:translateY(20px) scale(.987)}to{opacity:1;transform:none}}
        .site-nav a{transition:transform .18s ease,background .2s ease,border-color .2s ease,color .2s ease}
        .site-nav a:hover{transform:translateY(-2px)}
        .menu-toggle span{transition:transform .2s ease,opacity .18s ease}
        .menu-toggle.is-open{transform:rotate(90deg);transition:transform .25s ease}
        body.atlantis-page-leaving{opacity:0;transform:translateY(-7px);pointer-events:none}
        @media(prefers-reduced-motion:reduce){body,.site-nav a,.menu-toggle{transition:none!important}.reveal.in-view{animation:none!important}}
      `;
      document.head.appendChild(style);
    }
    const els=[...document.querySelectorAll('.reveal')];
    if('IntersectionObserver' in window){
      const io=new IntersectionObserver(entries=>entries.forEach(entry=>{
        if(entry.isIntersecting){
          entry.target.style.animationDelay=`${Math.min(8,els.indexOf(entry.target))*70}ms`;
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        }
      }),{threshold:.12});
      els.forEach(el=>io.observe(el));
    }else els.forEach(el=>el.classList.add('in-view'));
    if(!document.body.dataset.atlantisPageMotion){
      document.body.dataset.atlantisPageMotion='1';
      document.addEventListener('click',e=>{
        const a=e.target.closest('a[href]');
        if(!a||a.target==='_blank'||a.hasAttribute('download'))return;
        const href=a.getAttribute('href')||'';
        if(href.startsWith('#')||href.startsWith('http')||href.startsWith('mailto:')||href.startsWith('javascript:'))return;
        e.preventDefault();
        document.body.classList.add('atlantis-page-leaving');
        window.setTimeout(()=>{window.location.href=a.href},220);
      });
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

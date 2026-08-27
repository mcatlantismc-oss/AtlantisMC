/* Atlantis MC — FINAL auth.js
   Persistent Supabase session, profile drawer, account actions, Google login,
   email OTP/password recovery, and profile editing.
*/
(() => {
  'use strict';

  const cfg = window.ATLANTIS_SUPABASE || {};
  const LOGIN_EDGE =
    String(window.ATLANTIS_EDGE_URL || '').replace(/\/+$/, '');
  const RECOVERY_EDGE =
    String(window.ATLANTIS_RECOVERY_URL || '').replace(/\/+$/, '');

  const NAME_REGEX =
    /^[A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü0-9]{2,15}$/;

  const EMAIL_REGEX =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const state = {
    client: null,
    user: null,
    profile: null,
    ready: false,
    authListenerBound: false
  };

  const esc = value =>
    String(value ?? '').replace(
      /[&<>"']/g,
      ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      }[ch])
    );

  function configured() {
    return Boolean(
      cfg.url &&
      cfg.publishableKey &&
      !String(cfg.url).includes('YOUR_PROJECT') &&
      !String(cfg.publishableKey).includes('YOUR_')
    );
  }

  function buildClient() {
    if (state.client) return state.client;
    if (!configured() || !window.supabase) return null;

    state.client = window.supabase.createClient(
      cfg.url,
      cfg.publishableKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: 'pkce'
        }
      }
    );

    window.atlantisSupabase = state.client;
    return state.client;
  }

  window.atlantisAuthReady = new Promise(resolve => {
    const start = () => {
      const client = buildClient();
      resolve(client);
    };

    if (window.supabase) {
      start();
    } else {
      window.addEventListener('supabase-ready', start, { once: true });
    }
  });

  async function getClient() {
    if (state.client) return state.client;
    return await window.atlantisAuthReady;
  }

  function setMessage(text, kind = '') {
    const el = document.getElementById('auth-message');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'auth-message' + (kind ? ` ${kind}` : '');
  }

  function setForm(name) {
    const names = ['login', 'signup', 'forgot', 'otp', 'reset'];
    for (const item of names) {
      const form = document.getElementById(`auth-${item}-form`);
      if (form) form.hidden = item !== name;
    }

    const tabs = document.querySelector('.auth-tabs');
    if (tabs) tabs.hidden = !['login', 'signup'].includes(name);

    const title = document.getElementById('auth-title');
    const subtitle = document.getElementById('auth-subtitle');

    const map = {
      login: ['Giriş Yap', 'Hesabına giriş yap ve Atlantis topluluğuna katıl.'],
      signup: ['Kayıt Ol', 'Atlantis hesabını oluştur.'],
      forgot: ['Şifremi Unuttum', 'E-posta adresine doğrulama kodu gönderelim.'],
      otp: ['Kodu Doğrula', 'E-posta kutundaki 6 haneli kodu gir.'],
      reset: ['Yeni Şifre', 'Hesabın için yeni bir şifre belirle.']
    };

    const current = map[name] || map.login;
    if (title) title.textContent = current[0];
    if (subtitle) subtitle.textContent = current[1];

    document.querySelectorAll('[data-auth-tab]').forEach(button => {
      button.classList.toggle(
        'is-active',
        button.dataset.authTab === name
      );
    });

    setMessage('');
  }

  function ensureModal() {
    if (document.getElementById('auth-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'auth-modal';
    modal.className = 'auth-modal';
    modal.hidden = true;

    modal.innerHTML = `
      <div class="auth-backdrop"></div>
      <section class="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button class="auth-close" type="button" aria-label="Kapat">×</button>
        <div class="auth-brand">⚔️</div>
        <span class="section-label">ATLANTİS MC</span>
        <h2 id="auth-title">Giriş Yap</h2>
        <p class="auth-subtitle" id="auth-subtitle">
          Hesabına giriş yap ve Atlantis topluluğuna katıl.
        </p>

        <div class="auth-tabs">
          <button data-auth-tab="login" class="is-active" type="button">Giriş Yap</button>
          <button data-auth-tab="signup" type="button">Kayıt Ol</button>
        </div>

        <form id="auth-login-form" class="auth-form">
          <label>
            Kullanıcı adı veya e-posta
            <input name="identifier" required maxlength="120" autocomplete="username"
                   placeholder="OyuncuAdı veya eposta@gmail.com">
          </label>

          <label>
            Şifre
            <div class="auth-password-wrap">
              <input name="password" type="password" required minlength="8"
                     autocomplete="current-password" placeholder="Şifren">
              <button type="button" class="auth-password-toggle" data-toggle-password>Göster</button>
            </div>
          </label>

          <button class="primary-button wide" type="submit">Giriş Yap</button>

          <button class="google-button" id="google-login" type="button">
            <span class="google-mark">G</span>
            Google ile giriş yap
          </button>

          <button class="link-button" id="forgot-password" type="button">
            Şifremi unuttum
          </button>
        </form>

        <form id="auth-signup-form" class="auth-form" hidden>
          <label>
            Kullanıcı adı
            <input name="username" required minlength="3" maxlength="16"
                   pattern="[A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü0-9]{2,15}"
                   autocomplete="username" placeholder="AtlantisOyuncu">
          </label>
          <small>3–16 karakter; boşluk ve özel sembol yok.</small>

          <label>
            E-posta
            <input name="email" type="email" required autocomplete="email"
                   placeholder="ornek@gmail.com">
          </label>

          <label>
            Şifre
            <div class="auth-password-wrap">
              <input name="password" type="password" required minlength="8"
                     autocomplete="new-password" placeholder="En az 8 karakter">
              <button type="button" class="auth-password-toggle" data-toggle-password>Göster</button>
            </div>
          </label>

          <button class="primary-button wide" type="submit">Kayıt Ol</button>

          <button class="google-button" id="google-signup" type="button">
            <span class="google-mark">G</span>
            Google ile kayıt ol
          </button>
        </form>

        <form id="auth-forgot-form" class="auth-form" hidden>
          <label>
            E-posta
            <input name="email" type="email" required autocomplete="email"
                   placeholder="ornek@gmail.com">
          </label>

          <button class="primary-button wide" type="submit">Kod Gönder</button>

          <button class="link-button" data-back-login type="button">Girişe dön</button>
        </form>

        <form id="auth-otp-form" class="auth-form" hidden>
          <div class="otp-info" id="otp-info"></div>

          <label>
            6 haneli kod
            <input name="token" class="otp-input" inputmode="numeric"
                   autocomplete="one-time-code" maxlength="6"
                   pattern="[0-9]{6}" required placeholder="123456">
          </label>

          <div class="otp-toolbar">
            <span id="otp-countdown"></span>
            <button id="otp-resend" class="otp-resend" type="button">
              Kodu tekrar gönder
            </button>
          </div>

          <button class="primary-button wide" type="submit">Kodu Doğrula</button>
          <button class="link-button" data-back-login type="button">Girişe dön</button>
        </form>

        <form id="auth-reset-form" class="auth-form" hidden>
          <label>
            Yeni şifre
            <div class="auth-password-wrap">
              <input name="password" type="password" required minlength="8"
                     autocomplete="new-password">
              <button type="button" class="auth-password-toggle" data-toggle-password>Göster</button>
            </div>
          </label>

          <label>
            Yeni şifre tekrar
            <div class="auth-password-wrap">
              <input name="password2" type="password" required minlength="8"
                     autocomplete="new-password">
              <button type="button" class="auth-password-toggle" data-toggle-password>Göster</button>
            </div>
          </label>

          <button class="primary-button wide" type="submit">Şifreyi Değiştir</button>
        </form>

        <div id="auth-message" class="auth-message" role="status" aria-live="polite"></div>
      </section>
    `;

    document.body.appendChild(modal);

    modal.querySelector('.auth-backdrop').onclick = closeAuth;
    modal.querySelector('.auth-close').onclick = closeAuth;

    modal.querySelectorAll('[data-auth-tab]').forEach(button => {
      button.onclick = () => openAuth(button.dataset.authTab);
    });

    modal.querySelectorAll('[data-back-login]').forEach(button => {
      button.onclick = () => openAuth('login');
    });

    modal.querySelectorAll('[data-toggle-password]').forEach(button => {
      button.onclick = () => {
        const input =
          button.closest('.auth-password-wrap')?.querySelector('input');

        if (!input) return;

        const visible = input.type === 'text';
        input.type = visible ? 'password' : 'text';
        button.textContent = visible ? 'Göster' : 'Gizle';
      };
    });

    modal.querySelector('#auth-login-form').onsubmit = login;
    modal.querySelector('#auth-signup-form').onsubmit = signup;
    modal.querySelector('#auth-forgot-form').onsubmit = forgot;
    modal.querySelector('#auth-otp-form').onsubmit = verifyOtp;
    modal.querySelector('#auth-reset-form').onsubmit = resetPassword;

    modal.querySelector('#google-login').onclick = googleLogin;
    modal.querySelector('#google-signup').onclick = googleLogin;
    modal.querySelector('#forgot-password').onclick = () => openAuth('forgot');
    modal.querySelector('#otp-resend').onclick = resendOtp;
  }

  function openAuth(mode = 'login') {
    ensureModal();

    const modal = document.getElementById('auth-modal');
    if (!modal) return;

    modal.hidden = false;
    document.body.classList.add('auth-open');
    setForm(mode);

    window.setTimeout(() => {
      modal.querySelector('.auth-form:not([hidden]) input')?.focus();
    }, 40);
  }

  function closeAuth() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.hidden = true;
    document.body.classList.remove('auth-open');
    clearOtpState();
  }

  function clearOtpState() {
    window.atlantisPendingEmail = '';
    window.atlantisPendingUsername = '';
    window.atlantisOtpMode = '';
    if (state.otpTimer) clearInterval(state.otpTimer);
    state.otpTimer = null;
  }

  function cacheSession(session) {
    state.user = session?.user || null;
    window.atlantisAuthSession = session || null;
  }

  async function getProfile(user = state.user) {
    const client = await getClient();
    if (!client || !user) return null;

    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      console.warn('[Atlantis Auth] profile read:', error);
      return null;
    }

    return data || null;
  }

  async function updateNav(user) {
    ensureNavButton();

    const button = document.getElementById('auth-nav-button');
    if (!button) return;

    if (!user) {
      button.textContent = 'Giriş Yap';
      button.onclick = event => {
        event.preventDefault();
        openAuth('login');
      };
      state.profile = null;
      return;
    }

    const profile = await getProfile(user);
    state.profile = profile;

    const username =
      profile?.username ||
      user.user_metadata?.username ||
      '';

    if (!username) {
      // Never force a modal just because profile data is incomplete.
      button.textContent = 'Profil';
      button.onclick = event => {
        event.preventDefault();
        openDrawer(user, profile);
      };
      return;
    }

    button.textContent = `👤 ${username}`;
    button.onclick = event => {
      event.preventDefault();
      openDrawer(user, state.profile || {});
    };
  }

  function ensureNavButton() {
    const nav = document.querySelector('.site-nav');
    if (!nav) return;

    let button = document.getElementById('auth-nav-button');
    if (!button) {
      button = document.createElement('a');
      button.id = 'auth-nav-button';
      button.href = '#';
      button.className = 'auth-nav-button';
      button.textContent = 'Giriş Yap';
      nav.appendChild(button);
    }
  }

  function profileAvatar(profile, user, size = 56) {
    const url =
      profile?.avatar_url ||
      user?.user_metadata?.avatar_url ||
      '';

    if (url) {
      return `<img src="${esc(url)}" alt="" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:50%;display:block;">`;
    }

    const username =
      profile?.username ||
      user?.user_metadata?.username ||
      'A';

    return `
      <span style="
        width:${size}px;height:${size}px;border-radius:50%;
        display:grid;place-items:center;
        background:rgba(88,199,255,.10);
        border:1px solid rgba(121,210,255,.22);
        color:var(--accent2);
        font-weight:900;font-size:${Math.max(18, Math.round(size / 2.6))}px;
      ">
        ${esc(username.charAt(0).toLocaleUpperCase('tr-TR') || 'A')}
      </span>
    `;
  }

  function formatRole(role) {
    if (role === 'admin') return 'Yönetici';
    if (role === 'moderator') return 'Moderatör';
    return 'Oyuncu';
  }

  function formatLastSeen(lastSeen) {
    if (!lastSeen) return 'Henüz görülmedi';

    const date = new Date(lastSeen);
    if (Number.isNaN(date.getTime())) return 'Bilinmiyor';

    const age = Date.now() - date.getTime();
    if (age < 5 * 60 * 1000) return 'Çevrimiçi';

    return `Son görülme: ${date.toLocaleString('tr-TR', {
      dateStyle: 'medium',
      timeStyle: 'short'
    })}`;
  }

  function closeDrawer() {
    document.getElementById('account-drawer')?.remove();
    document.body.classList.remove('drawer-open');
  }

  function openDrawer(user, profile) {
    closeDrawer();

    const username =
      profile?.username ||
      user?.user_metadata?.username ||
      'Oyuncu';

    const role =
      profile?.site_role || 'user';

    const drawer = document.createElement('aside');
    drawer.id = 'account-drawer';
    drawer.className = 'account-drawer';

    drawer.innerHTML = `
      <div class="account-drawer-backdrop"></div>
      <section class="account-drawer-panel">
        <div class="account-drawer-head">
          <div class="account-drawer-avatar">
            ${profileAvatar(profile, user, 58)}
          </div>
          <div class="account-drawer-title">
            <span class="section-label">ATLANTİS MC</span>
            <h2>${esc(username)}</h2>
            <span class="role-chip role-${esc(role)}">${esc(formatRole(role))}</span>
          </div>
          <button class="account-drawer-close" type="button" aria-label="Kapat">×</button>
        </div>

        <div class="account-drawer-body">
          <div class="account-status-card">
            <span>Durum</span>
            <strong>${esc(formatLastSeen(profile?.last_seen))}</strong>
          </div>

          <button class="account-menu-item" type="button" data-drawer="info">
            <span>👤</span><span><b>Hesap Bilgileri</b><small>E-posta, üyelik ve profil</small></span>
          </button>

          <button class="account-menu-item" type="button" data-drawer="profile">
            <span>✏️</span><span><b>Profili Düzenle</b><small>Fotoğraf ve açıklama</small></span>
          </button>

          <button class="account-menu-item" type="button" data-drawer="password">
            <span>🔑</span><span><b>Şifre Değiştir</b><small>Hesap güvenliği</small></span>
          </button>

          <button class="account-menu-item" type="button" data-drawer="email">
            <span>📧</span><span><b>E-posta Değiştir</b><small>Yeni e-posta adresi</small></span>
          </button>

          <a class="account-menu-item" href="sohbet.html">
            <span>💬</span><span><b>Sohbete Git</b><small>Canlı Atlantis sohbeti</small></span>
          </a>

          ${
            role === 'admin' || role === 'moderator'
              ? `<a class="account-menu-item" href="moderasyon.html">
                   <span>🛡️</span><span><b>Moderasyon</b><small>Yönetim paneli</small></span>
                 </a>`
              : ''
          }

          <div class="account-drawer-separator"></div>

          <button class="account-menu-item account-menu-danger" type="button" data-drawer="switch">
            <span>🔄</span><span><b>Hesap Değiştir</b><small>Mevcut oturumu kapatıp giriş ekranını aç</small></span>
          </button>

          <button class="account-menu-item account-menu-danger" type="button" data-drawer="logout">
            <span>↪</span><span><b>Çıkış Yap</b><small>Bu cihazdaki Atlantis oturumunu kapat</small></span>
          </button>
        </div>
      </section>
    `;

    document.body.appendChild(drawer);
    document.body.classList.add('drawer-open');

    drawer.querySelector('.account-drawer-backdrop').onclick = closeDrawer;
    drawer.querySelector('.account-drawer-close').onclick = closeDrawer;

    drawer.querySelector('[data-drawer="info"]').onclick = () => {
      showAccountInfo(user, profile);
    };

    drawer.querySelector('[data-drawer="profile"]').onclick = () => {
      closeDrawer();
      openProfileEditor(user, profile);
    };

    drawer.querySelector('[data-drawer="password"]').onclick = () => {
      closeDrawer();
      openAuth('reset');
    };

    drawer.querySelector('[data-drawer="email"]').onclick = async () => {
      const value = window.prompt('Yeni e-posta adresin:');
      if (!value) return;

      const email = value.trim().toLowerCase();
      if (!EMAIL_REGEX.test(email)) {
        window.alert('Geçerli bir e-posta adresi gir.');
        return;
      }

      const client = await getClient();
      if (!client || !user) return;

      const { error } = await client.auth.updateUser({ email });

      if (error) {
        window.alert(error.message || 'E-posta değiştirilemedi.');
      } else {
        window.alert('Yeni e-posta adresine doğrulama gönderildi.');
      }
    };

    drawer.querySelector('[data-drawer="switch"]').onclick = async () => {
      await signOut(false);
      openAuth('login');
    };

    drawer.querySelector('[data-drawer="logout"]').onclick = async () => {
      await signOut(true);
    };
  }

  function showAccountInfo(user, profile) {
    closeDrawer();

    const old = document.getElementById('account-info-modal');
    if (old) old.remove();

    const username =
      profile?.username ||
      user?.user_metadata?.username ||
      'Oyuncu';

    const overlay = document.createElement('div');
    overlay.id = 'account-info-modal';
    overlay.className = 'auth-modal';

    overlay.innerHTML = `
      <div class="auth-backdrop"></div>
      <section class="auth-dialog">
        <button class="auth-close" type="button" id="account-info-close">×</button>
        <div class="auth-brand">👤</div>
        <span class="section-label">ATLANTİS MC</span>
        <h2>Hesap Bilgileri</h2>

        <div class="account-info-profile">
          ${profileAvatar(profile, user, 88)}
          <strong>${esc(username)}</strong>
          <span class="role-chip role-${esc(profile?.site_role || 'user')}">
            ${esc(formatRole(profile?.site_role || 'user'))}
          </span>
        </div>

        <div class="account-info-grid">
          <div><span>E-posta</span><strong>${esc(user?.email || 'Bilinmiyor')}</strong></div>
          <div><span>Üyelik</span><strong>${
            profile?.created_at || user?.created_at
              ? new Date(profile?.created_at || user.created_at).toLocaleDateString('tr-TR')
              : 'Bilinmiyor'
          }</strong></div>
          <div class="account-info-full"><span>Hakkında</span><strong>${
            esc(profile?.bio || 'Henüz açıklama eklenmemiş.')
          }</strong></div>
          <div class="account-info-full"><span>Son görülme</span><strong>${
            esc(formatLastSeen(profile?.last_seen))
          }</strong></div>
        </div>
      </section>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#account-info-close').onclick = () => overlay.remove();
    overlay.querySelector('.auth-backdrop').onclick = () => overlay.remove();
  }

  async function openProfileEditor(user, profile) {
    const old = document.getElementById('profile-editor-modal');
    if (old) old.remove();

    let avatar = profile?.avatar_url || user?.user_metadata?.avatar_url || '';

    const overlay = document.createElement('div');
    overlay.id = 'profile-editor-modal';
    overlay.className = 'auth-modal';

    const username =
      profile?.username ||
      user?.user_metadata?.username ||
      'Oyuncu';

    overlay.innerHTML = `
      <div class="auth-backdrop"></div>
      <section class="auth-dialog">
        <button class="auth-close" type="button" id="profile-editor-close">×</button>
        <div class="auth-brand">👤</div>
        <span class="section-label">ATLANTİS MC</span>
        <h2>Profili Düzenle</h2>

        <div id="profile-avatar-preview" class="profile-editor-avatar">
          ${profileAvatar(profile, user, 96)}
        </div>

        <label class="file-button">
          📷 Profil fotoğrafı seç
          <input id="profile-avatar-file" type="file" accept="image/png,image/jpeg,image/webp" hidden>
        </label>

        <button id="profile-avatar-remove" class="ghost-button wide" type="button">
          Fotoğrafı kaldır
        </button>

        <label class="profile-field-label">
          Kullanıcı adı
          <input value="${esc(username)}" disabled>
        </label>

        <label class="profile-field-label">
          Hakkında
          <textarea id="profile-bio-input" maxlength="180" rows="4"
                    placeholder="Kendinden biraz bahset...">${esc(profile?.bio || '')}</textarea>
        </label>

        <button id="profile-editor-save" class="primary-button wide" type="button">
          Kaydet
        </button>

        <div id="profile-editor-message" class="auth-message"></div>
      </section>
    `;

    document.body.appendChild(overlay);

    const preview = overlay.querySelector('#profile-avatar-preview');

    function renderAvatarPreview() {
      preview.innerHTML =
        avatar
          ? `<img src="${esc(avatar)}" alt="" style="width:96px;height:96px;border-radius:50%;object-fit:cover;">`
          : `<span style="
                width:96px;height:96px;border-radius:50%;
                display:grid;place-items:center;
                background:rgba(88,199,255,.10);
                border:1px solid rgba(121,210,255,.22);
                color:var(--accent2);font-size:34px;font-weight:900;
              ">${esc(username.charAt(0).toLocaleUpperCase('tr-TR') || 'A')}</span>`;
    }

    renderAvatarPreview();

    overlay.querySelector('#profile-avatar-file').onchange = event => {
      const file = event.target.files?.[0];
      if (!file) return;

      if (file.size > 700 * 1024) {
        setEditorMessage('Profil fotoğrafı 700 KB altında olmalı.', 'error');
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        avatar = String(reader.result || '');
        renderAvatarPreview();
      };
      reader.readAsDataURL(file);
    };

    overlay.querySelector('#profile-avatar-remove').onclick = () => {
      avatar = '';
      renderAvatarPreview();
    };

    overlay.querySelector('#profile-editor-close').onclick = () => overlay.remove();
    overlay.querySelector('.auth-backdrop').onclick = () => overlay.remove();

    overlay.querySelector('#profile-editor-save').onclick = async () => {
      const button = overlay.querySelector('#profile-editor-save');
      button.disabled = true;
      button.textContent = 'Kaydediliyor...';

      const bio =
        String(
          overlay.querySelector('#profile-bio-input')?.value || ''
        ).trim();

      try {
        const client = await getClient();
        if (!client || !user) throw new Error('Giriş yapmalısın.');

        const { data, error } = await client.rpc('update_my_profile', {
          new_bio: bio,
          new_avatar_url: avatar || null
        });

        if (error) throw error;

        state.profile = data || {
          ...(state.profile || {}),
          bio,
          avatar_url: avatar || null
        };

        await updateNav(user);
        setEditorMessage('Profil güncellendi.', 'success');

        setTimeout(() => overlay.remove(), 600);
      } catch (error) {
        console.error('[Atlantis Auth] profile update:', error);
        setEditorMessage(
          error?.message || 'Profil güncellenemedi.',
          'error'
        );
      } finally {
        button.disabled = false;
        button.textContent = 'Kaydet';
      }
    };

    function setEditorMessage(text, kind = '') {
      const message =
        overlay.querySelector('#profile-editor-message');
      if (!message) return;
      message.textContent = text;
      message.className = 'auth-message' + (kind ? ` ${kind}` : '');
    }

    overlay.querySelector(
      '#profile-editor-close'
    );
  }

  async function signOut(redirect = false) {
    const client = await getClient();

    if (client) {
      const { error } = await client.auth.signOut();
      if (error) {
        console.error('[Atlantis Auth] signOut:', error);
        return false;
      }
    }

    state.user = null;
    state.profile = null;
    window.atlantisAuthSession = null;
    closeDrawer();
    await updateNav(null);

    window.dispatchEvent(new CustomEvent('atlantis-auth-logout'));

    if (redirect) {
      window.location.href = 'index.html';
    }

    return true;
  }

  async function login(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const identifier =
      String(form.elements.identifier.value || '').trim();
    const password =
      String(form.elements.password.value || '');

    if (!identifier || !password) return;

    const button = form.querySelector('button[type="submit"]');
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = 'Giriş yapılıyor...';

    try {
      const client = await getClient();
      if (!client) throw new Error('Supabase bağlantısı kurulamadı.');

      if (EMAIL_REGEX.test(identifier)) {
        const { data, error } =
          await client.auth.signInWithPassword({
            email: identifier.toLowerCase(),
            password
          });

        if (error) throw new Error('E-posta veya şifre hatalı.');
        if (!data?.session) throw new Error('Oturum oluşturulamadı.');

        await afterLogin(data.session);
        return;
      }

      const endpoint =
        LOGIN_EDGE.endsWith('/login-with-identifier')
          ? LOGIN_EDGE
          : `${LOGIN_EDGE}/login-with-identifier`;

      if (!endpoint || endpoint === '/login-with-identifier') {
        throw new Error(
          'Kullanıcı adı ile giriş servisi yapılandırılmamış. E-posta ile giriş yapabilirsin.'
        );
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: cfg.publishableKey
        },
        body: JSON.stringify({
          username: identifier,
          password
        })
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result?.session) {
        throw new Error(
          result?.error || 'Kullanıcı adı veya şifre hatalı.'
        );
      }

      const { error } = await client.auth.setSession({
        access_token: result.session.access_token,
        refresh_token: result.session.refresh_token
      });

      if (error) throw error;

      await afterLogin(result.session);
    } catch (error) {
      console.error('[Atlantis Auth] login:', error);
      setMessage(error?.message || 'Giriş başarısız.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  }

  async function signup(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const username = String(form.elements.username.value || '').trim();
    const email =
      String(form.elements.email.value || '').trim().toLowerCase();
    const password = String(form.elements.password.value || '');

    if (!NAME_REGEX.test(username)) {
      setMessage('Kullanıcı adı 3–16 karakter olmalı.', 'error');
      return;
    }

    if (!EMAIL_REGEX.test(email)) {
      setMessage('Geçerli bir e-posta adresi gir.', 'error');
      return;
    }

    if (password.length < 8) {
      setMessage('Şifre en az 8 karakter olmalı.', 'error');
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Hesap oluşturuluyor...';

    try {
      const client = await getClient();
      if (!client) throw new Error('Supabase bağlantısı kurulamadı.');

      const { data: existing } =
        await client
          .from('profiles')
          .select('id')
          .ilike('username', username)
          .maybeSingle();

      if (existing) {
        throw new Error('Bu kullanıcı adı zaten kullanılıyor.');
      }

      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: { username },
          emailRedirectTo:
            window.location.origin + window.location.pathname
        }
      });

      if (error) {
        const lower = String(error.message || '').toLowerCase();

        if (lower.includes('already') || lower.includes('registered')) {
          throw new Error('Bu e-posta adresi zaten kayıtlı.');
        }

        throw new Error(error.message || 'Kayıt oluşturulamadı.');
      }

      if (!data?.user) throw new Error('Hesap oluşturulamadı.');

      window.atlantisPendingEmail = email;
      window.atlantisPendingUsername = username;
      window.atlantisOtpMode = 'signup';

      if (data.session) {
        await afterLogin(data.session);
        return;
      }

      setForm('otp');

      const info = document.getElementById('otp-info');
      if (info) {
        info.textContent =
          `${email} adresine doğrulama kodu gönderildi.`;
      }

      startOtpTimer();
      setMessage('E-posta kutunu kontrol et.', 'success');
    } catch (error) {
      console.error('[Atlantis Auth] signup:', error);
      setMessage(error?.message || 'Kayıt başarısız.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Kayıt Ol';
    }
  }

  async function googleLogin() {
    const client = await getClient();

    if (!client) {
      setMessage('Supabase bağlantısı kurulamadı.', 'error');
      return;
    }

    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo:
          window.location.origin + window.location.pathname,
        queryParams: {
          prompt: 'select_account'
        }
      }
    });

    if (error) {
      setMessage(
        String(error.message || '').toLowerCase().includes('provider')
          ? 'Google girişi Supabase üzerinde etkin değil.'
          : error.message,
        'error'
      );
    }
  }

  async function forgot(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const email =
      String(form.elements.email.value || '').trim().toLowerCase();

    if (!EMAIL_REGEX.test(email)) {
      setMessage('Geçerli bir e-posta adresi gir.', 'error');
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Gönderiliyor...';

    try {
      const client = await getClient();
      if (!client) throw new Error('Supabase bağlantısı kurulamadı.');

      if (RECOVERY_EDGE) {
        const response = await fetch(RECOVERY_EDGE, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: cfg.publishableKey
          },
          body: JSON.stringify({ email })
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(result.error || 'Kod gönderilemedi.');
        }
      } else {
        const { error } =
          await client.auth.resetPasswordForEmail(email, {
            redirectTo:
              window.location.origin + window.location.pathname
          });

        if (error) throw error;
      }

      window.atlantisPendingEmail = email;
      window.atlantisOtpMode = 'recovery';
      setForm('otp');

      const info = document.getElementById('otp-info');
      if (info) {
        info.textContent =
          `${email} adresine 6 haneli doğrulama kodu gönderildi.`;
      }

      startOtpTimer();
      setMessage('Kod e-posta adresine gönderildi.', 'success');
    } catch (error) {
      console.error('[Atlantis Auth] forgot:', error);
      setMessage(error?.message || 'Kod gönderilemedi.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Kod Gönder';
    }
  }

  function startOtpTimer() {
    if (state.otpTimer) clearInterval(state.otpTimer);

    let seconds = 60;
    const button = document.getElementById('otp-resend');
    const label = document.getElementById('otp-countdown');

    if (button) button.disabled = true;

    const tick = () => {
      if (label) {
        label.textContent = seconds > 0 ? `${seconds} sn` : '';
      }

      if (seconds <= 0) {
        clearInterval(state.otpTimer);
        state.otpTimer = null;
        if (button) button.disabled = false;
        return;
      }

      seconds--;
    };

    tick();
    state.otpTimer = setInterval(tick, 1000);
  }

  async function resendOtp() {
    const email =
      String(window.atlantisPendingEmail || '').trim().toLowerCase();

    if (!EMAIL_REGEX.test(email)) {
      setMessage('E-posta adresi bulunamadı.', 'error');
      return;
    }

    const client = await getClient();
    if (!client) return;

    const button = document.getElementById('otp-resend');
    if (button) {
      button.disabled = true;
      button.textContent = 'Gönderiliyor...';
    }

    try {
      if (window.atlantisOtpMode === 'signup') {
        const { error } = await client.auth.resend({
          type: 'signup',
          email
        });

        if (error) throw error;
      } else {
        const { error } =
          await client.auth.resetPasswordForEmail(email, {
            redirectTo:
              window.location.origin + window.location.pathname
          });

        if (error) throw error;
      }

      setMessage('Kod tekrar gönderildi.', 'success');
      startOtpTimer();
    } catch (error) {
      setMessage(error?.message || 'Kod tekrar gönderilemedi.', 'error');
      if (button) {
        button.disabled = false;
        button.textContent = 'Kodu tekrar gönder';
      }
    }
  }

  async function verifyOtp(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const token =
      String(form.elements.token.value || '').replace(/\D/g, '');
    const email =
      String(window.atlantisPendingEmail || '').trim().toLowerCase();

    if (!/^\d{6}$/.test(token)) {
      setMessage('6 haneli kodu eksiksiz gir.', 'error');
      return;
    }

    if (!EMAIL_REGEX.test(email)) {
      setMessage('Doğrulama oturumunun süresi dolmuş.', 'error');
      openAuth('login');
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Doğrulanıyor...';

    try {
      const client = await getClient();
      if (!client) throw new Error('Supabase bağlantısı kurulamadı.');

      const type =
        window.atlantisOtpMode === 'recovery'
          ? 'recovery'
          : 'email';

      const { data, error } = await client.auth.verifyOtp({
        email,
        token,
        type
      });

      if (error) {
        throw new Error('Kod hatalı veya süresi dolmuş.');
      }

      if (type === 'recovery') {
        setForm('reset');
        setMessage('Kod doğrulandı. Yeni şifreni belirle.', 'success');
        return;
      }

      if (!data?.session || !data?.user) {
        throw new Error('E-posta doğrulandı fakat oturum alınamadı.');
      }

      if (window.atlantisPendingUsername) {
        await client.rpc('set_my_username', {
          new_username: window.atlantisPendingUsername
        });
      }

      await afterLogin(data.session);
    } catch (error) {
      console.error('[Atlantis Auth] verifyOtp:', error);
      setMessage(error?.message || 'Kod doğrulanamadı.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Kodu Doğrula';
    }
  }

  async function resetPassword(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const password = String(form.elements.password.value || '');
    const password2 = String(form.elements.password2.value || '');

    if (password.length < 8) {
      setMessage('Yeni şifre en az 8 karakter olmalı.', 'error');
      return;
    }

    if (password !== password2) {
      setMessage('Şifreler aynı değil.', 'error');
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Kaydediliyor...';

    try {
      const client = await getClient();
      if (!client) throw new Error('Supabase bağlantısı kurulamadı.');

      const { error } =
        await client.auth.updateUser({ password });

      if (error) throw error;

      setMessage('Şifren başarıyla değiştirildi.', 'success');

      setTimeout(async () => {
        const { data } = await client.auth.getSession();
        if (data?.session) {
          await afterLogin(data.session);
        } else {
          closeAuth();
        }
      }, 700);
    } catch (error) {
      console.error('[Atlantis Auth] reset:', error);
      setMessage(error?.message || 'Şifre değiştirilemedi.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Şifreyi Değiştir';
    }
  }

  async function afterLogin(session) {
    cacheSession(session);

    clearOtpState();

    await updateNav(session.user);
    closeAuth();

    window.dispatchEvent(
      new CustomEvent('atlantis-auth-login', {
        detail: {
          user: session.user,
          session
        }
      })
    );
  }

  async function init() {
    ensureModal();
    ensureNavButton();

    const client = await getClient();

    if (!client) {
      state.ready = true;
      return;
    }

    const { data: sessionData } =
      await client.auth.getSession();

    cacheSession(sessionData?.session || null);

    await updateNav(
      sessionData?.session?.user || null
    );

    if (!state.authListenerBound) {
      state.authListenerBound = true;

      client.auth.onAuthStateChange((event, session) => {
        window.setTimeout(async () => {
          cacheSession(session || null);
          await updateNav(session?.user || null);

          window.dispatchEvent(
            new CustomEvent(
              session
                ? 'atlantis-auth-login'
                : 'atlantis-auth-logout',
              {
                detail: {
                  user: session?.user || null,
                  session: session || null
                }
              }
            )
          );
        }, 0);
      });
    }

    state.ready = true;
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeAuth();
      closeDrawer();
      document
        .getElementById('account-info-modal')
        ?.remove();
      document
        .getElementById('profile-editor-modal')
        ?.remove();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.openAtlantisAuth = openAuth;
  window.closeAtlantisAuth = closeAuth;
  window.atlantisGetClient = getClient;
  window.atlantisGetProfile = getProfile;
  window.atlantisOpenAccountDrawer = () => {
    if (state.user) {
      openDrawer(
        state.user,
        state.profile || {}
      );
    } else {
      openAuth('login');
    }
  };
})();

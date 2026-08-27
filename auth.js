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

  function formatLastSeen(value) {
    if (!value) return 'Henüz aktiflik bilgisi yok';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Henüz aktiflik bilgisi yok';
    const diff = Date.now() - date.getTime();
    if (diff < 2 * 60 * 1000) return 'Şu anda çevrimiçi';
    if (diff < 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / 60000))} dk önce aktifti`;
    if (diff < 24 * 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / 3600000))} saat önce aktifti`;
    return date.toLocaleString('tr-TR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  }

  function openProfileDrawer(p, own = true) {
    closeDrawer();

    const isOwn = !!own;
    const name = String(p?.username || sessionUser?.user_metadata?.username || (isOwn ? 'Oyuncu' : 'Atlantis Oyuncusu'));
    const role = p?.site_role || 'user';
    const avatar = p?.avatar_url || (isOwn ? sessionUser?.user_metadata?.avatar_url : '') || '';
    const bio = p?.bio || 'Henüz bir açıklama eklenmemiş.';
    const lastSeen = p?.last_seen || (isOwn && sessionUser ? new Date().toISOString() : null);
    const lastSeenDate = lastSeen ? new Date(lastSeen) : null;
    const validLastSeen = !!lastSeenDate && !Number.isNaN(lastSeenDate.getTime());
    const online = validLastSeen && (Date.now() - lastSeenDate.getTime() < 2 * 60 * 1000);
    const statusState = !validLastSeen ? 'unknown' : online ? 'online' : 'offline';
    const statusLabel = statusState === 'online' ? 'Aktif' : statusState === 'offline' ? 'Çevrimdışı' : 'Bilinmiyor';
    const roleName = getRoleName(role);

    const drawer = document.createElement('aside');
    drawer.id = 'atlantis-account-drawer';
    drawer.className = `account-drawer ${isOwn ? 'is-own' : 'is-public'} motion-enter`;
    drawer.innerHTML = `
      <div class="account-drawer-backdrop"></div>
      <section class="account-drawer-panel" role="dialog" aria-modal="true" aria-label="${esc(name)} profil">
        <div class="account-drawer-head">
          <div class="account-drawer-avatar">
            ${avatar ? `<img src="${esc(avatar)}" alt="${esc(name)}" loading="lazy">` : `<span class="avatar-fallback">${esc(name.charAt(0).toLocaleUpperCase('tr-TR') || 'A')}</span>`}
          </div>
          <div class="account-drawer-title">
            <span class="section-label">${isOwn ? 'ATLANTİS HESABI' : 'OYUNCU PROFİLİ'}</span>
            <h2 class="role-name-${esc(role)}">${esc(name)}</h2>
            <span class="role-chip role-${esc(role)}">${esc(roleName)}</span>
          </div>
          <button type="button" class="account-drawer-close" aria-label="Kapat">×</button>
        </div>

        <div class="account-drawer-body">
          <div class="account-status-card">
            <span>Son aktif</span>
            <div class="profile-activity-wrap">
              <span class="activity-pill activity-${statusState}">
                <i class="activity-dot" aria-hidden="true"></i>
                <strong>${statusLabel}</strong>
              </span>
              <small class="activity-detail">${esc(statusState === 'online' ? 'Şu anda aktif' : statusState === 'offline' ? formatLastSeen(lastSeen) : 'Aktiflik bilgisi alınamadı')}</small>
            </div>
          </div>

          <div class="account-profile-about">
            <span>Hakkında</span>
            <p>${esc(bio)}</p>
          </div>

          ${isOwn ? `
            <button class="account-menu-item" type="button" data-account="info"><span>👤</span><span><b>Hesap Bilgileri</b><small>E-posta ve üyelik bilgileri</small></span></button>
            <button class="account-menu-item" type="button" data-account="edit"><span>✏️</span><span><b>Profili Düzenle</b><small>Profil fotoğrafı ve açıklama</small></span></button>
            <button class="account-menu-item" type="button" data-account="password"><span>🔑</span><span><b>Şifre Değiştir</b><small>Hesap güvenliği</small></span></button>
            <button class="account-menu-item" type="button" data-account="email"><span>📧</span><span><b>E-posta Değiştir</b><small>Yeni adres + doğrulama kodu</small></span></button>
            ${(role === 'admin' || role === 'moderator') ? '<a class="account-menu-item" href="moderasyon.html"><span>🛡️</span><span><b>Moderasyon</b><small>Yönetim paneli</small></span></a>' : ''}
            <a class="account-menu-item" href="sohbet.html"><span>💬</span><span><b>Sohbete Git</b><small>Canlı Atlantis sohbeti</small></span></a>
            <div class="account-drawer-separator"></div>
            <button class="account-menu-item account-menu-danger" type="button" data-account="logout"><span>↪</span><span><b>Çıkış Yap</b><small>Bu cihazdaki oturumu kapat</small></span></button>
          ` : `
            <div class="public-profile-actions">
              <button class="account-menu-item" type="button" data-public-profile-close><span>✓</span><span><b>Profili Kapat</b><small>Bu pencereyi kapat</small></span></button>
            </div>
          `}
        </div>
      </section>`;

    document.body.appendChild(drawer);
    document.body.classList.add('drawer-open');
    requestAnimationFrame(() => drawer.classList.add('is-visible'));

    const activityTimer = window.setInterval(async () => {
      if (!document.body.contains(drawer)) {
        window.clearInterval(activityTimer);
        return;
      }
      if (!p?.id || isOwn) {
        if (isOwn && profile) {
          profile.last_seen = new Date().toISOString();
          const pill = drawer.querySelector('.activity-pill');
          const detail = drawer.querySelector('.activity-detail');
          if (pill) pill.className = 'activity-pill activity-online';
          if (pill?.querySelector('strong')) pill.querySelector('strong').textContent = 'Aktif';
          if (detail) detail.textContent = 'Şu anda aktif';
        }
        return;
      }
      try {
        const {data} = await client.from('profiles').select('last_seen').eq('id',p.id).maybeSingle();
        if (!data) return;
        const d = data.last_seen ? new Date(data.last_seen) : null;
        const valid = !!d && !Number.isNaN(d.getTime());
        const onlineNow = valid && (Date.now() - d.getTime() < 2 * 60 * 1000);
        const state = !valid ? 'unknown' : onlineNow ? 'online' : 'offline';
        const label = onlineNow ? 'Aktif' : state === 'offline' ? 'Çevrimdışı' : 'Bilinmiyor';
        const pill = drawer.querySelector('.activity-pill');
        const detail = drawer.querySelector('.activity-detail');
        if (pill) pill.className = `activity-pill activity-${state}`;
        if (pill?.querySelector('strong')) pill.querySelector('strong').textContent = label;
        if (detail) detail.textContent = onlineNow ? 'Şu anda aktif' : state === 'offline' ? formatLastSeen(data.last_seen) : 'Aktiflik bilgisi alınamadı';
      } catch {}
    }, 15_000);

    const close = () => {
      window.clearInterval(activityTimer);
      drawer.classList.remove('is-visible');
      setTimeout(closeDrawer,100);
    };
    drawer.querySelector('.account-drawer-backdrop').onclick = close;
    drawer.querySelector('.account-drawer-close').onclick = close;
    drawer.querySelector('[data-public-profile-close]')?.addEventListener('click',close);

    drawer.querySelector('[data-account="info"]')?.addEventListener('click', () => { closeDrawer(); showAccountInfo(); });
    drawer.querySelector('[data-account="edit"]')?.addEventListener('click', async () => { closeDrawer(); await openEditProfile(); });
    drawer.querySelector('[data-account="password"]')?.addEventListener('click', () => { closeDrawer(); openPasswordChangeModal(); });
    drawer.querySelector('[data-account="email"]')?.addEventListener('click', () => { closeDrawer(); openEmailChangeModal(); });
    drawer.querySelector('[data-account="logout"]')?.addEventListener('click', confirmLogout);
  }

  function showAccountInfo() {
    closeDrawer();
    const old = document.getElementById('atlantis-account-info');
    old?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'atlantis-account-info';
    overlay.className = 'auth-modal motion-enter';
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

  function makeActionModal(id, title, subtitle, innerHtml) {
    document.getElementById(id)?.remove();
    const overlay = document.createElement('div');
    overlay.id = id;
    overlay.className = 'auth-modal';
    overlay.innerHTML = `
      <div class="auth-backdrop"></div>
      <section class="auth-dialog account-action-dialog">
        <button class="auth-close" type="button" aria-label="Kapat">×</button>
        <div class="auth-brand">⚔️</div>
        <span class="section-label">ATLANTİS MC</span>
        <h2>${esc(title)}</h2>
        <p class="auth-subtitle">${esc(subtitle)}</p>
        <div class="account-action-content">${innerHtml}</div>
      </section>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.auth-close').onclick = close;
    overlay.querySelector('.auth-backdrop').onclick = close;
    return overlay;
  }


  function passwordStrength(password) {
    const p = String(password || '');
    let score = 0;
    if (p.length >= 8) score++;
    if (p.length >= 12) score++;
    if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score++;
    if (/\d/.test(p)) score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;
    if (/(.)\1\1/.test(p)) score--;
    score = Math.max(0, Math.min(4, score));
    const labels = [
      ['Güvensiz', '0%'],
      ['Zayıf', '25%'],
      ['Orta', '50%'],
      ['Güçlü', '75%'],
      ['Çok güçlü', '100%']
    ];
    return { score, label: labels[score][0], percent: labels[score][1] };
  }

  function bindPasswordStrength(input, meter) {
    if (!input || !meter) return;
    const update = () => {
      const { score, label, percent } = passwordStrength(input.value);
      meter.dataset.level = String(score);
      meter.querySelector('[data-strength-label]').textContent = label;
      meter.querySelector('[data-strength-fill]').style.width = percent;
    };
    input.addEventListener('input', update);
    update();
  }

  function makePasswordMeter(id) {
    return `
      <div class="password-strength" id="${id}" aria-live="polite">
        <div class="password-strength-head">
          <span>Şifre güvenliği</span>
          <strong data-strength-label>Güvensiz</strong>
        </div>
        <div class="password-strength-track"><i data-strength-fill></i></div>
        <div class="password-strength-hints">
          <span>8+ karakter</span><span>Büyük/küçük harf</span><span>Rakam</span><span>Sembol</span>
        </div>
      </div>`;
  }

  function openPasswordChangeModal() {
    if (!client || !sessionUser) {
      openAuth('login');
      return;
    }

    const overlay = makeActionModal(
      'atlantis-password-change',
      'Şifre Değiştir',
      'Önce mevcut şifreni doğrula, sonra yeni şifreni belirle.',
      `
        <form id="password-change-form" class="auth-form">
          <label>Mevcut şifre
            <input name="currentPassword" type="password" autocomplete="current-password" required placeholder="Mevcut şifren">
          </label>
          <label>Yeni şifre
            <input id="change-new-password" name="newPassword" type="password" autocomplete="new-password" minlength="8" required placeholder="Güçlü bir şifre oluştur">
          </label>
          ${makePasswordMeter('change-password-strength')}
          <label>Yeni şifre tekrar
            <input name="newPassword2" type="password" autocomplete="new-password" minlength="8" required placeholder="Yeni şifre tekrar">
          </label>
          <button class="primary-button wide" type="submit">Şifreyi Güncelle</button>
          <div class="auth-message" data-action-message></div>
        </form>
      `
    );

    const form = overlay.querySelector('#password-change-form');
    bindPasswordStrength(form.querySelector('#change-new-password'), form.querySelector('#change-password-strength'));
    form.onsubmit = async event => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      const message = form.querySelector('[data-action-message]');
      const currentPassword = String(form.elements.currentPassword.value || '');
      const newPassword = String(form.elements.newPassword.value || '');
      const newPassword2 = String(form.elements.newPassword2.value || '');

      if (passwordStrength(newPassword).score < 2) {
        message.textContent = 'Bu şifre çok zayıf. En az 8 karakter, büyük/küçük harf ve rakam kullan.';
        message.className = 'auth-message error';
        return;
      }
      if (newPassword !== newPassword2) {
        message.textContent = 'Yeni şifreler aynı değil.';
        message.className = 'auth-message error';
        return;
      }

      button.disabled = true;
      button.textContent = 'Doğrulanıyor...';

      try {
        if (!sessionUser.email) throw new Error('Hesabında doğrulanabilir bir e-posta yok.');
        const { error: verifyError } = await client.auth.signInWithPassword({
          email: sessionUser.email,
          password: currentPassword
        });
        if (verifyError) throw new Error('Mevcut şifre yanlış.');

        button.textContent = 'Güncelleniyor...';
        const { error } = await client.auth.updateUser({ password: newPassword });
        if (error) throw error;

        message.textContent = 'Şifren başarıyla değiştirildi.';
        message.className = 'auth-message success';
        setTimeout(() => overlay.remove(), 850);
      } catch (error) {
        message.textContent = error?.message || 'Şifre değiştirilemedi.';
        message.className = 'auth-message error';
      } finally {
        button.disabled = false;
        button.textContent = 'Şifreyi Güncelle';
      }
    };
  }

  async function openEmailChangeModal() {
    if (!client || !sessionUser) {
      openAuth('login');
      return;
    }

    const emailEdge = String(window.ATLANTIS_EMAIL_CHANGE_URL || '').replace(/\/+$/, '');
    const currentEmail = String(sessionUser.email || '').trim().toLowerCase();

    const overlay = makeActionModal(
      'atlantis-email-change',
      'E-posta Değiştir',
      'Yeni adresi ve mevcut şifreni doğrula. Kod yeni adresine gönderilecek.',
      `
        <div class="email-change-step" data-email-step="start">
          <form id="email-change-request-form" class="auth-form">
            <label>Yeni e-posta
              <input name="newEmail" type="email" autocomplete="email" required placeholder="yeniadres@gmail.com">
            </label>
            <label>Mevcut şifre
              <input name="password" type="password" autocomplete="current-password" required placeholder="Mevcut şifren">
            </label>
            <button class="primary-button wide" type="submit">Doğrulama Kodu Gönder</button>
            <small class="form-hint">Kod 10 dakika geçerlidir.</small>
            <div class="auth-message" data-email-message></div>
          </form>
        </div>

        <div class="email-change-step" data-email-step="verify" hidden>
          <div class="otp-info">
            <strong>6 haneli kodunu gir</strong>
            <span data-email-target></span>
          </div>
          <form id="email-change-verify-form" class="auth-form">
            <label>Doğrulama kodu
              <input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required placeholder="000000">
            </label>
            <button class="primary-button wide" type="submit">E-postayı Onayla</button>
            <button class="link-button" type="button" data-email-back>← Yeni adresi tekrar gir</button>
            <div class="auth-message" data-email-message></div>
          </form>
        </div>
      `
    );

    const requestWrap = overlay.querySelector('[data-email-step="start"]');
    const verifyWrap = overlay.querySelector('[data-email-step="verify"]');
    const requestForm = overlay.querySelector('#email-change-request-form');
    const verifyForm = overlay.querySelector('#email-change-verify-form');

    if (!emailEdge) {
      requestWrap.innerHTML = `
        <div class="action-unavailable">
          <strong>6 haneli kod servisi hazır değil.</strong>
          <p>Supabase Edge Function kurulmadan e-posta değişikliği doğrulama kodu gönderilemez.</p>
          <button class="secondary-button wide" type="button" data-email-fallback>Supabase doğrulama e-postasını kullan</button>
          <div class="auth-message" data-email-message></div>
        </div>`;
      requestWrap.querySelector('[data-email-fallback]').onclick = async () => {
        const next = String(prompt('Yeni e-posta adresin:') || '').trim().toLowerCase();
        if (!EMAIL_RE.test(next)) return;
        if (next === currentEmail) return;
        const password = String(prompt('Mevcut şifren:') || '');
        try {
          const { error: verifyError } = await client.auth.signInWithPassword({email: currentEmail,password});
          if (verifyError) throw new Error('Mevcut şifre yanlış.');
          const { error } = await client.auth.updateUser({email: next});
          requestWrap.querySelector('[data-email-message]').textContent =
            error ? error.message : 'Yeni adresine doğrulama e-postası gönderildi.';
          requestWrap.querySelector('[data-email-message]').className =
            `auth-message ${error ? 'error' : 'success'}`;
        } catch (error) {
          const m=requestWrap.querySelector('[data-email-message]');
          m.textContent=error?.message || 'E-posta değiştirilemedi.';
          m.className='auth-message error';
        }
      };
      return;
    }

    let pendingEmail = '';

    requestForm.onsubmit = async event => {
      event.preventDefault();
      const button = requestForm.querySelector('button[type="submit"]');
      const message = requestForm.querySelector('[data-email-message]');
      const newEmail = String(requestForm.elements.newEmail.value || '').trim().toLowerCase();
      const password = String(requestForm.elements.password.value || '');

      if (!EMAIL_RE.test(newEmail)) {
        message.textContent = 'Geçerli bir e-posta adresi gir.';
        message.className = 'auth-message error';
        return;
      }
      if (newEmail === currentEmail) {
        message.textContent = 'Yeni e-posta mevcut adresinle aynı.';
        message.className = 'auth-message error';
        return;
      }

      button.disabled = true;
      button.textContent = 'Doğrulanıyor...';

      try {
        const { error: verifyError } = await client.auth.signInWithPassword({
          email: currentEmail,
          password
        });
        if (verifyError) throw new Error('Mevcut şifre yanlış.');

        const { data: { session } } = await client.auth.getSession();
        const response = await fetch(emailEdge, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: cfg.publishableKey,
            Authorization: `Bearer ${session?.access_token || ''}`
          },
          body: JSON.stringify({ action: 'request', newEmail })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Doğrulama kodu gönderilemedi.');

        pendingEmail = newEmail;
        requestWrap.hidden = true;
        verifyWrap.hidden = false;
        verifyWrap.querySelector('[data-email-target]').textContent = ` ${newEmail}`;
        verifyWrap.querySelector('input[name="code"]').focus();
      } catch (error) {
        message.textContent = error?.message || 'Doğrulama kodu gönderilemedi.';
        message.className = 'auth-message error';
      } finally {
        button.disabled = false;
        button.textContent = 'Doğrulama Kodu Gönder';
      }
    };

    verifyForm.onsubmit = async event => {
      event.preventDefault();
      const button = verifyForm.querySelector('button[type="submit"]');
      const message = verifyForm.querySelector('[data-email-message]');
      const code = String(verifyForm.elements.code.value || '').trim();

      if (!/^\d{6}$/.test(code)) {
        message.textContent = '6 haneli kodu doğru gir.';
        message.className = 'auth-message error';
        return;
      }

      button.disabled = true;
      button.textContent = 'Onaylanıyor...';

      try {
        const { data: { session } } = await client.auth.getSession();
        const response = await fetch(emailEdge, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: cfg.publishableKey,
            Authorization: `Bearer ${session?.access_token || ''}`
          },
          body: JSON.stringify({ action: 'verify', code })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Kod doğrulanamadı.');

        message.textContent = 'E-posta adresin başarıyla değiştirildi.';
        message.className = 'auth-message success';

        await client.auth.getSession();
        const refreshed = await client.auth.getUser();
        sessionUser = refreshed.data?.user || sessionUser;
        profile = await getProfile(sessionUser) || profile;
        setGlobalProfile(sessionUser, profile);
        updateNav();
        window.dispatchEvent(new CustomEvent('atlantis-email-updated', {
          detail: { email: sessionUser?.email || '' }
        }));
        setTimeout(() => overlay.remove(), 950);
      } catch (error) {
        message.textContent = error?.message || 'Kod doğrulanamadı.';
        message.className = 'auth-message error';
      } finally {
        button.disabled = false;
        button.textContent = 'E-postayı Onayla';
      }
    };

    overlay.querySelector('[data-email-back]').onclick = () => {
      verifyWrap.hidden = true;
      requestWrap.hidden = false;
      requestForm.elements.newEmail.focus();
    };
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

  async function uploadAvatarToStorage(file) {
    if (!client || !sessionUser || !file) return null;
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${sessionUser.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await client.storage.from('avatars').upload(path, file, {
      cacheControl: '3600',
      upsert: true,
      contentType: file.type
    });
    if (error) throw error;
    const { data } = client.storage.from('avatars').getPublicUrl(path);
    return data?.publicUrl || null;
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
    let selectedFile = null;
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
      selectedFile = file;
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
      selectedFile = null;
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

        let finalAvatarUrl = removed ? null : (avatar || null);
        if (!removed && selectedFile) {
          button.textContent = 'Fotoğraf yükleniyor...';
          finalAvatarUrl = await uploadAvatarToStorage(selectedFile);
        }

        button.textContent = 'Profil kaydediliyor...';
        const { data, error } = await client.rpc('update_my_profile', {
          new_avatar_url: finalAvatarUrl,
          new_bio: bioValue
        });

        if (error) throw error;

        profile = data || { ...current, avatar_url: finalAvatarUrl, bio: bioValue };
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
            <input id="signup-password" name="password" type="password" minlength="8" required placeholder="Güçlü bir şifre oluştur">
          </label>
          ${makePasswordMeter('signup-password-strength')}
          <button class="primary-button wide" type="submit">Kayıt Ol</button>
          <button class="google-button" id="google-signup" type="button"><b>G</b> Google ile kayıt ol</button>
        </form>

        <form id="auth-signup-verify-form" class="auth-form" hidden>
          <div class="otp-info">
            <strong>6 haneli e-posta doğrulama kodu</strong>
            <span>Kod e-posta adresine gönderildi. 10 dakika içinde kullan.</span>
          </div>
          <label>Doğrulama kodu
            <input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required placeholder="000000">
          </label>
          <button class="primary-button wide" type="submit">Kodu Doğrula</button>
          <button class="link-button" type="button" data-resend-signup-code>Kodu tekrar gönder</button>
          <button class="link-button" type="button" data-back-signup>← Kayıta dön</button>
        </form>

        <form id="auth-forgot-form" class="auth-form" hidden>
          <label>E-posta
            <input name="email" type="email" autocomplete="email" required placeholder="ornek@gmail.com">
          </label>

          <div class="recovery-code-wrap" hidden>
            <label>6 haneli doğrulama kodu
              <input
                name="code"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="6"
                pattern="[0-9]{6}"
                placeholder="000000"
              >
            </label>
            <small class="form-help">Kod e-posta adresine gönderildi. 10 dakika içinde kullan.</small>
          </div>

          <button class="primary-button wide" id="recovery-action" type="submit">6 Haneli Kod Gönder</button>
          <button class="link-button" type="button" data-back-login>Girişe dön</button>
        </form>

        <form id="auth-reset-form" class="auth-form" hidden>
          <label>Yeni şifre
            <input id="reset-password" name="password" type="password" minlength="8" required placeholder="Güçlü bir şifre oluştur">
          </label>
          ${makePasswordMeter('reset-password-strength')}
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
    bindPasswordStrength(modal.querySelector('#signup-password'), modal.querySelector('#signup-password-strength'));
    bindPasswordStrength(modal.querySelector('#reset-password'), modal.querySelector('#reset-password-strength'));

    modal.querySelector('#auth-login-form').onsubmit = login;
    modal.querySelector('#auth-signup-form').onsubmit = signup;
    modal.querySelector('#auth-signup-verify-form').onsubmit = verifySignupCode;
    modal.querySelector('[data-resend-signup-code]').onclick = resendSignupCode;
    modal.querySelector('[data-back-signup]').onclick = () => openAuth('signup');
    modal.querySelector('#auth-forgot-form').onsubmit = forgot;
    modal.querySelector('#auth-forgot-form [name="code"]')?.addEventListener('input', event => {
      event.target.value = String(event.target.value || '').replace(/\D/g, '').slice(0, 6);
    });
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
    ['login','signup','signup-verify','forgot','reset'].forEach(n => {
      const form = document.getElementById(`auth-${n}-form`);
      if (form) form.hidden = n !== name;
    });
    const tabs = document.querySelector('.auth-tabs');
    if (tabs) {
      tabs.hidden = !['login','signup'].includes(name);
      tabs.querySelectorAll('[data-auth-tab]').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.authTab === name);
        btn.setAttribute('aria-selected', String(btn.dataset.authTab === name));
      });
    }
    const labels = {
      login:['Giriş Yap','Hesabına giriş yap ve Atlantis topluluğuna katıl.'],
      signup:['Kayıt Ol','Atlantis hesabını oluştur.'],
      'signup-verify':['E-posta Doğrula','E-posta adresine gelen 6 haneli kodu gir.'],
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

  let signupPending = { email:'', username:'' };

  async function signup(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const username = String(form.elements.username.value || '').trim();
    const email = String(form.elements.email.value || '').trim().toLowerCase();
    const password = String(form.elements.password.value || '');

    if (!NAME_RE.test(username)) return setAuthMessage('Kullanıcı adı 3–16 karakter olmalı.', 'error');
    if (!EMAIL_RE.test(email)) return setAuthMessage('Geçerli bir e-posta adresi gir.', 'error');
    if (passwordStrength(password).score < 2) return setAuthMessage('Şifre çok zayıf. En az 8 karakter, büyük/küçük harf ve rakam kullan.', 'error');

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

      signupPending = { email, username };

      if (data.session) {
        await client.rpc('set_my_username',{new_username:username});
        await finishLogin(data.session);
      } else {
        showAuthForm('signup-verify');
        setAuthMessage('6 haneli doğrulama kodu e-posta adresine gönderildi.', 'success');
        setTimeout(() => document.querySelector('#auth-signup-verify-form [name="code"]')?.focus(), 50);
      }
    } catch (error) {
      setAuthMessage(error?.message || 'Kayıt başarısız.', 'error');
    }
  }

  async function verifySignupCode(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const code = String(form.elements.code.value || '').replace(/\D/g,'').slice(0,6);
    if (!/^\d{6}$/.test(code) || !signupPending.email) {
      return setAuthMessage('6 haneli doğrulama kodunu gir.', 'error');
    }

    try {
      const { data, error } = await client.auth.verifyOtp({
        email: signupPending.email,
        token: code,
        type: 'signup'
      });
      if (error || !data?.session) throw new Error('Kod geçersiz veya süresi dolmuş.');
      if (signupPending.username) {
        await client.rpc('set_my_username',{new_username:signupPending.username});
      }
      await finishLogin(data.session);
      signupPending = {email:'',username:''};
    } catch (error) {
      setAuthMessage(error?.message || 'E-posta doğrulanamadı.', 'error');
    }
  }

  async function resendSignupCode() {
    if (!signupPending.email) return setAuthMessage('Önce kayıt formunu doldur.', 'error');
    try {
      const { error } = await client.auth.resend({type:'signup',email:signupPending.email});
      if (error) throw error;
      setAuthMessage('Yeni doğrulama kodu gönderildi.', 'success');
    } catch (error) {
      setAuthMessage(error?.message || 'Kod tekrar gönderilemedi.', 'error');
    }
  }

  async function googleLogin() {
    if (!client) return setAuthMessage('Supabase bağlantısı hazır değil.', 'error');
    const { error } = await client.auth.signInWithOAuth({
      provider:'google',
      options:{
        redirectTo:window.location.origin + window.location.pathname,
        queryParams:{prompt:'select_account',access_type:'offline'},
        skipBrowserRedirect:false
      }
    });
    if (error) {
      const msg = String(error.message || 'Google girişi başarısız.');
      setAuthMessage(msg.toLowerCase().includes('provider') || msg.toLowerCase().includes('disabled')
        ? 'Google ile giriş için Supabase > Authentication > Providers > Google bölümünü etkinleştir.'
        : msg,'error');
    }
  }

  async function forgot(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(form.elements.email.value || '').trim().toLowerCase();
    const codeWrap = form.querySelector('.recovery-code-wrap');
    const codeInput = form.elements.code;
    const action = form.querySelector('#recovery-action');

    if (!EMAIL_RE.test(email)) {
      return setAuthMessage('Geçerli bir e-posta adresi gir.', 'error');
    }

    const codeVisible = !codeWrap.hidden;

    try {
      if (!codeVisible) {
        if (RECOVERY_EDGE) {
          const response = await fetch(RECOVERY_EDGE, {
            method:'POST',
            headers:{
              'Content-Type':'application/json',
              apikey:cfg.publishableKey
            },
            body:JSON.stringify({email})
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || 'Doğrulama kodu gönderilemedi.');
        } else {
          const { error } = await client.auth.resetPasswordForEmail(email, {
            redirectTo:window.location.origin + window.location.pathname
          });
          if (error) throw error;
        }

        codeWrap.hidden = false;
        codeInput.required = true;
        action.textContent = 'Kodu Doğrula';
        setAuthMessage('6 haneli kod e-posta adresine gönderildi. Kodunu aşağıya gir.', 'success');
        setTimeout(() => codeInput.focus(), 50);
        return;
      }

      const code = String(codeInput.value || '').replace(/\D/g, '');
      if (!/^\d{6}$/.test(code)) {
        return setAuthMessage('6 haneli doğrulama kodunu gir.', 'error');
      }

      const { data, error } = await client.auth.verifyOtp({
        email,
        token: code,
        type: 'recovery'
      });

      if (error) throw new Error('Kod geçersiz veya süresi dolmuş.');
      if (!data?.session) throw new Error('Doğrulama tamamlandı ancak oturum oluşturulamadı.');

      await openAuth('reset');
      setAuthMessage('Kod doğrulandı. Şimdi yeni şifreni belirleyebilirsin.', 'success');
    } catch (error) {
      setAuthMessage(error?.message || 'Şifre yenileme işlemi başarısız.', 'error');
    }
  }

  async function resetPassword(event) {
    event.preventDefault();
    const p = String(event.currentTarget.elements.password.value || '');
    const p2 = String(event.currentTarget.elements.password2.value || '');
    if (passwordStrength(p).score < 2) return setAuthMessage('Şifre çok zayıf. En az 8 karakter, büyük/küçük harf ve rakam kullan.', 'error');
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
    if (p?.banned_until && new Date(p.banned_until).getTime() > Date.now()) {
      await client.auth.signOut();
      const until = new Date(p.banned_until).toLocaleString('tr-TR',{dateStyle:'medium',timeStyle:'short'});
      setAuthMessage(`Bu hesap ${until} tarihine kadar yasaklı.`, 'error');
      return;
    }
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

    const identity = await refreshIdentity();
    const activeBan = identity?.profile?.banned_until && new Date(identity.profile.banned_until).getTime() > Date.now();
    if (activeBan) {
      await client.auth.signOut();
      setGlobalProfile(null,null);
      setAuthMessage(`Bu hesap ${new Date(identity.profile.banned_until).toLocaleString('tr-TR',{dateStyle:'medium',timeStyle:'short'})} tarihine kadar yasaklı.`, 'error');
    }
    if (sessionUser) {
      client.rpc('touch_my_last_seen')
        .then(({error}) => {
          if (!error && profile) profile.last_seen = new Date().toISOString();
        })
        .catch(() => {});
    }
    updateNav();
    clearInterval(window.__atlantisLastSeenTimer);
    window.__atlantisLastSeenTimer = setInterval(() => {
      if (!sessionUser) return;
      client.rpc('touch_my_last_seen')
        .then(({error}) => {
          if (!error && profile) {
            profile.last_seen = new Date().toISOString();
            window.atlantisCurrentProfile = profile;
          }
        })
        .catch(() => {});
    }, 60_000);

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



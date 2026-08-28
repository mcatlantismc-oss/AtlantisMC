/* Atlantis MC — Moderasyon Paneli (FINAL) */
(() => {
  'use strict';

  let client = null;
  let me = null;
  let myProfile = null;
  let initialized = false;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[ch]));

  const roleText = role => role === 'admin' ? 'Yönetici' : role === 'moderator' ? 'Moderatör' : 'Oyuncu';

  const MUTE_OPTIONS = [
    {value:0, label:'Susturmayı kaldır'},
    {value:300, label:'5 dakika'},
    {value:600, label:'10 dakika'},
    {value:1200, label:'20 dakika'},
    {value:1800, label:'30 dakika'},
    {value:2700, label:'45 dakika'},
    {value:3600, label:'1 saat'},
    {value:7200, label:'2 saat'},
    {value:10800, label:'3 saat'},
    {value:86400, label:'1 gün'},
    {value:259200, label:'3 gün'},
    {value:432000, label:'5 gün'},
    {value:-1, label:'Kalıcı'}
  ];

  const canActOn = (targetRole) => {
    const actor = String(myProfile?.site_role || 'user');
    const target = String(targetRole || 'user');
    if (!['admin','moderator'].includes(actor)) return false;
    if (target === 'admin') return false;
    if (actor === 'moderator' && target === 'moderator') return false;
    return true;
  };

  const muteOptionsHtml = () => MUTE_OPTIONS.map(o => `<option value="${o.value}">${o.label}</option>`).join('');

  async function withTimeout(promise, ms, message='İşlem zaman aşımına uğradı.') {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve(promise),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), ms);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function getClient() {
    if (client?.auth) return client;
    const started = Date.now();
    while (Date.now() - started < 12000) {
      try {
        if (window.atlantisGetClient) {
          const resolved = await withTimeout(window.atlantisGetClient(), 3000, 'Supabase bağlantısı zaman aşımına uğradı.');
          if (resolved?.auth) {
            client = resolved;
            window.atlantisSupabase = resolved;
            return client;
          }
        }
        if (window.atlantisSupabase?.auth) {
          client = window.atlantisSupabase;
          return client;
        }
      } catch {}
      await new Promise(resolve => setTimeout(resolve,150));
    }
    return client;
  }

  async function waitForAuthenticatedIdentity() {
    const started = Date.now();
    while (Date.now() - started < 10000) {
      const shellUser = window.atlantisAuthSession?.user || null;
      const shellProfile = window.atlantisCurrentProfile?.id ? window.atlantisCurrentProfile : null;
      if (shellUser && shellProfile?.site_role) return {user:shellUser, profile:shellProfile};

      try {
        const {data:{session}} = await withTimeout(client.auth.getSession(),2500,'Oturum bilgisi alınamadı.');
        if (session?.user) {
          const own = await selectOwnProfile(session.user.id);
          if (own?.data?.site_role) return {user:session.user, profile:own.data};
        }
      } catch {}
      await new Promise(resolve => setTimeout(resolve,250));
    }
    return null;
  }


  async function resolveIdentityRobustly() {
    const started = Date.now();
    while (Date.now() - started < 9000) {
      const shellUser = window.atlantisAuthSession?.user || null;
      const shellProfile = window.atlantisCurrentProfile?.id ? {
        ...window.atlantisCurrentProfile,
        site_role: String(window.atlantisCurrentProfile.site_role || '').trim().toLowerCase()
      } : null;
      if (shellUser && shellProfile?.site_role) {
        return {user:shellUser, profile:shellProfile};
      }

      try {
        const {data:{session} = {}} = await withTimeout(client.auth.getSession(),2500,'Oturum bilgisi alınamadı.');
        const user = session?.user || null;
        if (user) {
          const directProfile = await selectOwnProfile(user.id);
          const profile = directProfile?.data || null;
          if (profile?.site_role) return {user, profile};
          if (window.atlantisCurrentProfile?.id === user.id && window.atlantisCurrentProfile?.site_role) {
            return {user, profile:window.atlantisCurrentProfile};
          }
        }
      } catch (error) {
        console.warn('[Atlantis Moderation] identity retry:', error);
      }
      await new Promise(resolve => setTimeout(resolve,180));
    }
    return null;
  }

  async function selectOwnProfile(userId) {
    if (!client || !userId) return {data:null,error:new Error('Profil bağlantısı hazır değil.')};

    const full = await withTimeout(
      client.from('profiles')
        .select('id,username,site_role,bio,avatar_url,last_seen,created_at,muted_until,banned_until,ban_reason')
        .eq('id', userId).maybeSingle(),
      7000,
      'Profil bilgisi okunamadı.'
    ).catch(error => ({data:null,error}));

    if (!full.error && full.data) return full;

    if (full.error) {
      console.warn('[Atlantis Moderation] full profile query failed; using fallback:', full.error);
    }

    const fallback = await withTimeout(
      client.from('profiles')
        .select('id,username,site_role,bio,avatar_url,last_seen,created_at,muted_until')
        .eq('id', userId).maybeSingle(),
      7000,
      'Profil bilgisi okunamadı.'
    ).catch(error => ({data:null,error}));

    // auth.js already resolved the session/profile on the shell. Use that
    // profile as a last-resort source of truth for the current user's role.
    if ((!fallback.data || fallback.error) && window.atlantisCurrentProfile?.id === userId) {
      return {
        data: {
          ...window.atlantisCurrentProfile,
          id: userId
        },
        error: null
      };
    }
    return fallback;
  }

  async function selectProfiles() {
    const full = await client.from('profiles')
      .select('id,username,site_role,bio,avatar_url,last_seen,created_at,muted_until,banned_until,ban_reason')
      .order('created_at',{ascending:false}).limit(200);
    if (!full.error) return full;
    console.warn('[Atlantis Moderation] user query fallback:', full.error);
    return client.from('profiles')
      .select('id,username,site_role,bio,avatar_url,last_seen,created_at,muted_until')
      .order('created_at',{ascending:false}).limit(200);
  }

  async function init() {
    if (initialized) return;
    initialized = true;

    client = await getClient();
    if (!client) return showDenied('Supabase bağlantısı kurulamadı.');

    const identity = await resolveIdentityRobustly();
    me = identity?.user || null;
    if (!me) return showDenied('Bu paneli görmek için giriş yapmalısın.');

    const resolvedProfile = identity?.profile || null;
    if (!resolvedProfile) return showDenied('Profil bulunamadı.');

    resolvedProfile.site_role = String(resolvedProfile.site_role || '').trim().toLowerCase();
    myProfile = resolvedProfile;

    if (!['admin','moderator'].includes(resolvedProfile.site_role)) {
      return showDenied('Bu panel yalnızca moderatör ve yöneticilere açıktır.');
    }

    document.body.classList.add('mod-authorized');
    document.getElementById('moderation-loading')?.setAttribute('hidden','');
    document.getElementById('moderation-app')?.removeAttribute('hidden');
    document.getElementById('moderation-denied')?.setAttribute('hidden','');

    const roleEl = document.getElementById('mod-role');
    if (roleEl) roleEl.textContent = resolvedProfile.site_role === 'admin' ? 'Kurucu' : 'Moderatör';

    bindControls();
    await Promise.all([loadUsers(), loadChatLock()]);
  }

  function showDenied(text) {
    document.getElementById('moderation-loading')?.remove();
    const panel = document.getElementById('moderation-denied');
    if (panel) {
      panel.hidden = false;
      panel.querySelector('[data-denied-text]').textContent = text;
    }
    document.getElementById('moderation-app')?.setAttribute('hidden','');
  }

  function bindControls() {
    document.getElementById('mod-refresh')?.addEventListener('click', () =>
      Promise.all([loadUsers(), loadChatLock()])
    );
    document.getElementById('mod-chat-lock')?.addEventListener('click', toggleChatLock);
    document.getElementById('mod-chat-clear')?.addEventListener('click', clearChat);
  }

  async function loadChatLock() {
    const button = document.getElementById('mod-chat-lock');
    const state = document.getElementById('mod-chat-lock-state');
    if (!button || !state) return;
    const { data, error } = await client.rpc('is_chat_locked');
    if (error) {
      state.textContent = 'Kilit durumu okunamadı.';
      return;
    }
    const locked = !!data;
    state.textContent = locked ? 'Kilitli — yalnızca moderatörler ve yöneticiler yazabilir.' : 'Açık — herkes yazabilir.';
    state.dataset.locked = String(locked);
    button.textContent = locked ? 'Sohbeti Aç' : 'Sohbeti Kilitle';
    button.classList.add('danger-button');
    button.classList.toggle('is-locked', locked);
  }

  async function toggleChatLock() {
    const state = document.getElementById('mod-chat-lock-state');
    const currentlyLocked = state?.dataset.locked === 'true';
    const { error } = await client.rpc('moderation_set_chat_lock',{lock_chat:!currentlyLocked});
    if (error) return alert(error.message || 'Sohbet kilidi değiştirilemedi.');
    await loadChatLock();
  }

  function openModerationClearConfirm(onConfirm) {
    document.getElementById('mod-clear-confirm')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'mod-clear-confirm';
    overlay.className = 'chat-action-modal';
    overlay.innerHTML = `
      <div class="chat-action-backdrop"></div>
      <section class="chat-action-dialog mod-clear-dialog" role="dialog" aria-modal="true" aria-label="Sohbeti Temizle">
        <button type="button" class="chat-action-close" aria-label="Kapat">×</button>
        <div class="chat-action-icon">💬</div>
        <span class="section-label">ATLANTİS SOHBETİ</span>
        <h2>SOHBETİ TEMİZLE</h2>
        <p>Bu işlem sohbet geçmişindeki tüm mesajları kalıcı olarak kaldırır.</p>
        <div class="chat-action-content">
          <div class="chat-clear-warning">
            <div class="chat-clear-warning-icon">!</div>
            <div>
              <strong>Tüm sohbet geçmişi silinecek.</strong>
              <p>Bu işlem geri alınamaz. Sohbeti temizlemek istediğine emin misin?</p>
            </div>
          </div>
          <div class="chat-delete-actions">
            <button type="button" class="secondary-button" data-mod-clear-cancel>Vazgeç</button>
            <button type="button" class="danger-button chat-clear-confirm" data-mod-clear-confirm>Temizle</button>
          </div>
          <div class="auth-message" data-mod-clear-error></div>
        </div>
      </section>`;
    document.body.appendChild(overlay);
    const close=()=>overlay.remove();
    overlay.querySelector('.chat-action-close').onclick=close;
    overlay.querySelector('.chat-action-backdrop').onclick=close;
    overlay.querySelector('[data-mod-clear-cancel]').onclick=close;
    overlay.querySelector('[data-mod-clear-confirm]').onclick=async event=>{
      const btn=event.currentTarget;
      btn.disabled=true; btn.textContent='Temizleniyor…';
      try { await onConfirm(); close(); }
      catch(error){
        btn.disabled=false; btn.textContent='Temizle';
        const box=overlay.querySelector('[data-mod-clear-error]');
        box.textContent=error?.message || 'Sohbet temizlenemedi.';
        box.className='auth-message error';
      }
    };
    return overlay;
  }

  async function clearMessagesViaRpcOrFilteredDelete() {
    const rpc = await client.rpc('moderation_clear_chat');
    if (!rpc.error) return Number(rpc.data) || 0;

    // Fallback for projects where the previous RPC still contains
    // an unsafe DELETE without a WHERE clause.
    const fallback = await client.from('messages')
      .delete()
      .not('id','is',null)
      .select('id');
    if (fallback.error) throw rpc.error;
    return Array.isArray(fallback.data) ? fallback.data.length : 0;
  }

  async function clearChat() {
    const role = String(myProfile?.site_role || '').trim().toLowerCase();
    if (!me || !['admin','moderator'].includes(role) || !client) {
      return;
    }

    const button = document.getElementById('mod-chat-clear');
    if (!button || button.disabled) return;

    openModerationClearConfirm(async () => {
      const old = button.textContent;
      button.disabled = true;
      button.textContent = 'Temizleniyor…';
      try {
        const count = await clearMessagesViaRpcOrFilteredDelete();
        await loadUsers();
        return count;
      } finally {
        button.disabled = false;
        button.textContent = old;
      }
    });
  }

  const targetRoleCache = new Map();

  async function getTargetRole(userId) {
    if (!userId) return 'user';
    if (targetRoleCache.has(userId)) return targetRoleCache.get(userId);
    const {data,error} = await client.from('profiles').select('id,site_role').eq('id',userId).maybeSingle();
    if (error || !data) return null;
    const role = String(data.site_role || 'user').trim().toLowerCase();
    targetRoleCache.set(userId, role);
    return role;
  }

  async function canDeleteMessage(msg) {
    const actorRole = String(myProfile?.site_role || 'user').trim().toLowerCase();
    if (!['admin','moderator'].includes(actorRole)) return false;
    if (!msg?.user_id) return true;
    if (String(msg.user_id) === String(me?.id || '')) return true;
    const targetRole = await getTargetRole(msg.user_id);
    if (!targetRole) return false;
    return actorRole === 'admin' || targetRole === 'user';
  }

  async function loadUsers() {
    const box = document.getElementById('mod-users');
    if (!box) return;
    box.innerHTML = '<div class="empty-panel">Kullanıcılar yükleniyor...</div>';

    const {data,error} = await selectProfiles();

    if (error) {
      box.innerHTML = `<div class="empty-panel">Kullanıcılar alınamadı: ${esc(error.message)}</div>`;
      return;
    }

    box.innerHTML = '';
    if (!data?.length) {
      box.innerHTML = '<div class="empty-panel">Kullanıcı bulunamadı.</div>';
      return;
    }

    data.forEach(user => renderUser(user,box));
  }

  function renderUser(user, box) {
    const activeBan = user.banned_until && new Date(user.banned_until).getTime() > Date.now();
    const activeMute = user.muted_until && new Date(user.muted_until).getTime() > Date.now();
    const targetCanAct = user.id !== me.id && canActOn(user.site_role);
    const row = document.createElement('article');
    row.className = 'mod-item user-row reveal';
    row.innerHTML = `
      <div class="mod-main mod-user-main">
        <div class="mod-user-head">
          ${user.avatar_url ? `<img src="${esc(user.avatar_url)}" alt="" loading="lazy">` : `<span class="avatar-fallback">${esc((user.username||'A').charAt(0).toLocaleUpperCase('tr-TR'))}</span>`}
          <div><strong>${esc(user.username || 'İsimsiz')}</strong><span class="role-chip role-${esc(user.site_role || 'user')}">${esc(roleText(user.site_role))}</span></div>
        </div>
        <p class="muted-small">${esc(user.last_seen ? formatLastSeen(user.last_seen) : 'Son görülme bilinmiyor')}</p>
        ${activeMute ? `<p class="mute-chip">Susturma aktif: ${esc(formatDate(user.muted_until))}</p>` : ''}
        ${activeBan ? `<p class="ban-chip">Site banı: ${esc(formatDate(user.banned_until))}${user.ban_reason ? ` — ${esc(user.ban_reason)}` : ''}</p>` : ''}
      </div>
      <div class="mod-actions">
        ${targetCanAct ? `
          <select data-mute aria-label="${esc(user.username || 'Kullanıcı')} susturma süresi">${muteOptionsHtml()}</select>
          <input class="mod-custom-duration" data-mute-custom type="number" min="1" step="1" placeholder="Özel dakika" aria-label="Özel susturma süresi dakika">
          <button class="secondary-button" type="button" data-apply-mute>Uygula</button>
          <select data-ban aria-label="${esc(user.username || 'Kullanıcı')} ban süresi">
            <option value="0">Site banını kaldır</option>
            <option value="3600">1 saat</option>
            <option value="86400">1 gün</option>
            <option value="604800">7 gün</option>
            <option value="2592000">30 gün</option>
          </select>
          <button class="danger-button" type="button" data-apply-ban>Ban</button>`
          : user.id === me.id ? '<span class="state-pill">Sen</span>'
          : '<span class="state-pill">Bu kullanıcıya işlem yetkin yok</span>'}
        ${myProfile.site_role === 'admin' && user.id !== me.id && user.site_role !== 'admin' ? `<select data-role aria-label="${esc(user.username || 'Kullanıcı')} rolü"><option value="user">Oyuncu</option><option value="moderator">Moderatör</option></select><button class="secondary-button" type="button" data-apply-role>Rolü Kaydet</button>` : ''}
      </div>`;

    const roleSelect = row.querySelector('[data-role]');
    if (roleSelect) roleSelect.value = user.site_role || 'user';

    row.querySelector('[data-apply-mute]')?.addEventListener('click', async () => {
      const selected = Number(row.querySelector('[data-mute]')?.value ?? 0);
      const customMinutes = Number(row.querySelector('[data-mute-custom]')?.value ?? 0);
      const seconds = customMinutes > 0 ? Math.floor(customMinutes * 60) : selected;
      if (!Number.isFinite(seconds) || seconds < -1) return alert('Geçerli bir susturma süresi seç.');
      const {error} = await client.rpc('moderation_set_mute',{target_user_id:user.id,duration_seconds:seconds});
      if(error){alert(error.message || 'Susturma başarısız.');return;}
      await loadUsers();
    });

    row.querySelector('[data-apply-ban]')?.addEventListener('click',async()=>{
      const seconds=Number(row.querySelector('[data-ban]').value);
      const reason = seconds ? 'Sohbet moderasyonu' : '';
      const {error}=await client.rpc('moderation_set_ban',{target_user_id:user.id,duration_seconds:seconds,reason});
      if(error){alert(error.message || 'Ban işlemi başarısız.');return;}
      await loadUsers();
    });

    row.querySelector('[data-apply-role]')?.addEventListener('click',async()=>{
      const newRole=row.querySelector('[data-role]').value;
      const {error}=await client.rpc('admin_set_role',{target_user_id:user.id,new_role:newRole});
      if(error){alert(error.message || 'Rol değiştirilemedi.');return;}
      await loadUsers();
    });

    box.appendChild(row);
    requestAnimationFrame(()=>row.classList.add('in-view'));
  }


  function formatDate(v){ const d=new Date(v); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('tr-TR',{dateStyle:'medium',timeStyle:'short'}); }
  function formatLastSeen(v){ const d=new Date(v); if(Number.isNaN(d.getTime())) return '—'; return Date.now()-d.getTime()<300000 ? 'Çevrimiçi' : `Son görülme ${formatDate(v)}`; }

  /* Re-run for the SPA-lite navigation in script.js: coming back to the
     moderation page after visiting another page needs a fresh init since
     the panel's DOM was replaced along with the rest of <main>. */
  window.addEventListener('atlantis:content-swapped', event => {
    const page = event.detail?.page;
    if (page === 'moderation' && document.getElementById('moderation-app')) {
      initialized = false;
      document.body.classList.remove('mod-authorized');
      init();
    }
  });

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();

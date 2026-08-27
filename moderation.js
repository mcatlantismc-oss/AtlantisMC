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

  async function getClient() {
    return client || await window.atlantisGetClient?.();
  }

  async function init() {
    if (initialized) return;
    initialized = true;
    client = await getClient();
    if (!client) return showDenied('Supabase bağlantısı kurulamadı.');

    const { data:{session} } = await client.auth.getSession();
    me = session?.user || null;
    if (!me) return showDenied('Bu paneli görmek için giriş yapmalısın.');

    const { data:profile, error } = await client.from('profiles')
      .select('id,username,site_role,bio,avatar_url,last_seen,created_at,muted_until,banned_until,ban_reason')
      .eq('id',me.id).maybeSingle();
    if (error || !profile) return showDenied('Profil bulunamadı.');
    myProfile = profile;

    if (!['admin','moderator'].includes(profile.site_role)) {
      return showDenied('Bu panel yalnızca moderatör ve yöneticilere açıktır.');
    }

    document.body.classList.add('mod-authorized');
    const roleEl = document.getElementById('mod-role');
    if (roleEl) roleEl.textContent = roleText(profile.site_role);

    bindControls();
    await Promise.all([loadMessages(), loadUsers(), loadChatLock()]);
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
      Promise.all([loadMessages(), loadUsers(), loadChatLock()])
    );
    document.getElementById('mod-chat-lock')?.addEventListener('click', toggleChatLock);
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
    button.classList.toggle('danger-button', !locked);
  }

  async function toggleChatLock() {
    const state = document.getElementById('mod-chat-lock-state');
    const currentlyLocked = state?.dataset.locked === 'true';
    const { error } = await client.rpc('moderation_set_chat_lock',{lock_chat:!currentlyLocked});
    if (error) return alert(error.message || 'Sohbet kilidi değiştirilemedi.');
    await loadChatLock();
  }

  async function loadMessages() {
    const box = document.getElementById('mod-messages');
    if (!box) return;
    box.innerHTML = '<div class="empty-panel">Mesajlar yükleniyor...</div>';

    const {data,error} = await client.from('messages')
      .select('id,user_id,username,message,created_at,edited_at,avatar_url')
      .order('created_at',{ascending:false}).limit(150);

    if (error) {
      box.innerHTML = `<div class="empty-panel">Mesajlar alınamadı: ${esc(error.message)}</div>`;
      return;
    }

    box.innerHTML = '';
    if (!data?.length) {
      box.innerHTML = '<div class="empty-panel">Henüz mesaj yok.</div>';
      return;
    }

    for (const msg of data) {
      const row = document.createElement('article');
      row.className = 'mod-item reveal';
      row.dataset.messageId = msg.id;
      row.innerHTML = `
        <div class="mod-main">
          <div class="mod-meta">
            <strong>${esc(msg.username || 'Anonim')}</strong>
            ${msg.user_id ? '' : '<span class="chat-guest-badge">Misafir</span>'}
            <time>${esc(formatDate(msg.created_at))}</time>
          </div>
          <p>${esc(msg.message)}</p>
        </div>
        <div class="mod-actions">
          <button class="danger-button" type="button" data-delete-message>Mesajı Sil</button>

        </div>`;
      row.querySelector('[data-delete-message]').onclick = async () => {
        const {error:delError} = await client.rpc('moderation_delete_message',{target_message_id:msg.id});
        if (delError) { alert(delError.message || 'Mesaj silinemedi.'); return; }
        row.classList.add('chat-message-out');
        setTimeout(()=>row.remove(),180);
      };
      box.appendChild(row);
      requestAnimationFrame(() => row.classList.add('in-view'));
    }
  }

  async function loadUsers() {
    const box = document.getElementById('mod-users');
    if (!box) return;
    box.innerHTML = '<div class="empty-panel">Kullanıcılar yükleniyor...</div>';

    const {data,error} = await client.from('profiles')
      .select('id,username,site_role,bio,avatar_url,last_seen,created_at,muted_until,banned_until,ban_reason')
      .order('created_at',{ascending:false}).limit(200);

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
    const row = document.createElement('article');
    row.className = 'mod-item user-row reveal';
    row.innerHTML = `
      <div class="mod-main mod-user-main">
        <div class="mod-user-head">
          ${user.avatar_url ? `<img src="${esc(user.avatar_url)}" alt="">` : `<span class="avatar-fallback">${esc((user.username||'A').charAt(0).toLocaleUpperCase('tr-TR'))}</span>`}
          <div><strong>${esc(user.username || 'İsimsiz')}</strong><span class="role-chip role-${esc(user.site_role)}">${esc(roleText(user.site_role))}</span></div>
        </div>
        <p class="muted-small">${esc(user.last_seen ? formatLastSeen(user.last_seen) : 'Son görülme bilinmiyor')}</p>
        ${activeMute ? `<p class="mute-chip">Susturma aktif: ${esc(formatDate(user.muted_until))}</p>` : ''}
        ${activeBan ? `<p class="ban-chip">Site banı: ${esc(formatDate(user.banned_until))}${user.ban_reason ? ` — ${esc(user.ban_reason)}` : ''}</p>` : ''}
      </div>
      <div class="mod-actions">
        ${user.id !== me.id ? `
          <select data-mute>
            <option value="0">Susturmayı kaldır</option>
            <option value="300">5 dakika</option><option value="1800">30 dakika</option><option value="3600">1 saat</option><option value="86400">1 gün</option>
          </select><button class="secondary-button" type="button" data-apply-mute>Uygula</button>
          <select data-ban>
            <option value="0">Site banını kaldır</option><option value="3600">1 saat</option><option value="86400">1 gün</option><option value="604800">7 gün</option><option value="2592000">30 gün</option>
          </select><button class="danger-button" type="button" data-apply-ban>Ban</button>` : '<span class="state-pill">Sen</span>'}
        ${myProfile.site_role === 'admin' && user.id !== me.id ? `<select data-role><option value="user">Oyuncu</option><option value="moderator">Moderatör</option><option value="admin">Yönetici</option></select><button class="secondary-button" type="button" data-apply-role>Rolü Kaydet</button>` : ''}
      </div>`;

    const roleSelect = row.querySelector('[data-role]');
    if (roleSelect) roleSelect.value = user.site_role;

    row.querySelector('[data-apply-mute]')?.addEventListener('click',async()=>{
      const seconds=Number(row.querySelector('[data-mute]').value);
      const {error}=await client.rpc('moderation_set_mute',{target_user_id:user.id,duration_seconds:seconds});
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

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();

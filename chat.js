/* Atlantis MC — Chat experience
   Fast loading, bottom-anchored history, live messages, profiles,
   edit/delete dialogs, realtime, presence and typing.
*/
(() => {
  'use strict';

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[ch]));

  function withTimeout(promise, ms, label='İşlem zaman aşımına uğradı.') {
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms))
    ]);
  }

  let client = null;
  let currentUser = null;
  let currentProfile = {};
  let chatLocked = false;
  let chatLockChannelActive = false;
  let chatChannel = null;
  let presenceChannel = null;
  let initialized = false;
  let initialLoaded = false;
  let lastSent = 0;
  let typingTimer = null;
  let lastTypingSent = 0;
  let presenceHeartbeat = null;
  let muteCountdownTimer = null;
  let profileRefreshTimer = null;
  const profileCache = new Map();
  let blockedUsers = new Set();
  let blockedUserIds = new Set();

  try {
    blockedUsers = new Set(JSON.parse(localStorage.getItem('atlantis-chat-blocked-users') || '[]'));
  } catch {}

  async function init() {
    if (initialized) return;
    initialized = true;

    const box = document.getElementById('chat-messages');
    const form = document.getElementById('chat-form');
    const input = document.getElementById('chat-input');
    if (!box || !form || !input) return;

    client = await withTimeout(window.atlantisGetClient?.(), 8000, 'Supabase bağlantısı zaman aşımına uğradı.').catch(() => null);
    if (!client && window.supabase && window.ATLANTIS_SUPABASE?.url && window.ATLANTIS_SUPABASE?.publishableKey) {
      client = window.supabase.createClient(window.ATLANTIS_SUPABASE.url, window.ATLANTIS_SUPABASE.publishableKey, {
        auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}
      });
      window.atlantisSupabase = client;
    }
    if (!client) {
      setError('Supabase bağlantısı kurulamadı.');
      return;
    }

    await readIdentity();
    await withTimeout(loadBlockedUsers(), 5000, 'Engel listesi alınamadı.').catch(() => { blockedUserIds = new Set(); });
    blockedUsers = new Set(blockedUserIds);
    await loadChatLockState();
    ensureTypingUI();
    setupChatControls();
    bindAuthEvents();
    setupComposer();
    updateComposer();
    startMuteClock();
    startProfileRefresh();
    await syncMessages({initial:true});
    subscribeChat();
    subscribePresence();
    startPresenceHeartbeat();
    touchLastSeen();
    updateComposer();
  }

  async function readIdentity() {
    const { data:{ session } } = await withTimeout(client.auth.getSession(), 8000, 'Oturum bilgisi alınamadı.');
    currentUser = session?.user || null;
    currentProfile = {};

    if (currentUser) {
      const { data } = await withTimeout(
        client.from('profiles')
          .select('id,username,avatar_url,bio,site_role,muted_until,last_seen,created_at,updated_at')
          .eq('id',currentUser.id)
          .maybeSingle(),
        8000,
        'Profil bilgisi alınamadı.'
      ).catch(() => ({data:null}));
      currentProfile = data || {};
      if (data?.id) profileCache.set(data.id,data);
    }
  }

  function bindAuthEvents() {
    window.addEventListener('atlantis-auth-login', async () => {
      await refreshIdentityOnly();
      await loadChatLockState();
      await withTimeout(loadBlockedUsers(), 5000, 'Engel listesi alınamadı.').catch(() => { blockedUserIds = new Set(); });
      blockedUsers = new Set(blockedUserIds);
      await syncMessages({initial:false});
      subscribeChat();
      subscribePresence();
      touchLastSeen();
      startMuteClock();
      startProfileRefresh();
      updateComposer();
    });

    window.addEventListener('atlantis-auth-logout', async () => {
      currentUser = null;
      currentProfile = {};
      chatLocked = false;
      profileCache.clear();
      blockedUsers.clear();
      blockedUserIds.clear();
      clearInterval(muteCountdownTimer); muteCountdownTimer = null;
      clearInterval(profileRefreshTimer); profileRefreshTimer = null;
      try { if (chatChannel) await client.removeChannel(chatChannel); } catch {}
      try { if (presenceChannel) await client.removeChannel(presenceChannel); } catch {}
      chatChannel = null;
      presenceChannel = null;
      await syncMessages({initial:false});
      subscribePresence();
      setupChatControls();
      updateComposer();
    });

    window.addEventListener('atlantis-profile-updated', async event => {
      currentProfile = event.detail?.profile || currentProfile;
      if (currentProfile?.id) profileCache.set(currentProfile.id,currentProfile);
      setupChatControls();
      updateComposer();
      await syncMessages({initial:false});
      subscribePresence();
    });
  }

  async function refreshIdentityOnly() {
    await readIdentity();
  }

  function renderLoading() {
    const box = document.getElementById('chat-messages');
    if (!box) return;
    box.classList.add('chat-initial-loading');
    box.setAttribute('aria-busy','true');
  }

  async function fetchMessages() {
    const request = client.from('messages')
      .select('id,user_id,username,message,created_at,edited_at,avatar_url')
      .order('created_at',{ascending:false})
      .limit(300);
    let result;
    try {
      result = await Promise.race([
        request,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Sohbet sunucusundan yanıt alınamadı.')), 12000))
      ]);
    } catch (error) {
      return { data:null, error };
    }
    if (!result.error && Array.isArray(result.data)) result.data.reverse();

    if (result.error) {
      console.warn('[Atlantis Chat] full message select failed:',result.error);
      result = await client.from('messages')
        .select('id,user_id,username,message,created_at')
        .order('created_at',{ascending:false})
        .limit(300);
      if (!result.error && Array.isArray(result.data)) result.data.reverse();
    }
    return result;
  }

  async function syncMessages({initial=false}={}) {
    const box = document.getElementById('chat-messages');
    if (!box) return;

    if (initial && !initialLoaded) {
      box.classList.add('chat-initial-loading');
      box.setAttribute('aria-busy','true');
    }

    const result = await fetchMessages();
    if (result.error) {
      console.error('[Atlantis Chat] messages:',result.error);
      box.removeAttribute('aria-busy');
      box.classList.remove('chat-initial-loading');
      if (initial || !box.querySelector('.chat-message')) {
        box.innerHTML = `
          <div class="chat-empty chat-error">
            <span>Sohbet mesajları yüklenemedi.</span>
            <button class="chat-retry-button" type="button">Tekrar Dene</button>
          </div>`;
        box.querySelector('.chat-retry-button')?.addEventListener('click',()=>syncMessages({initial:false}));
      } else {
        toast('Sohbet güncellenemedi; mevcut mesajlar korunuyor.');
      }
      return;
    }

    const rows = result.data || [];
    const ids = [...new Set(rows.map(m => m.user_id).filter(Boolean))];
    await preloadProfiles(ids);

    if (initial || !initialLoaded) {
      box.innerHTML = '';
      if (!rows.length) {
        box.innerHTML = '<div class="chat-empty">Henüz mesaj yok. İlk mesajı sen yaz.</div>';
      } else {
        rows.forEach(row => addMessage(row,{animate:false}));
      }
      initialLoaded = true;
      box.scrollTop = box.scrollHeight;
      requestAnimationFrame(() => {
        box.scrollTop = box.scrollHeight;
        box.removeAttribute('aria-busy');
        box.classList.remove('chat-initial-loading');
      });
      return;
    }

    const existing = new Map(
      [...box.querySelectorAll('.chat-message')].map(el => [String(el.dataset.messageId),el])
    );
    const serverIds = new Set(rows.map(row => String(row.id)));

    rows.forEach(row => {
      const el = existing.get(String(row.id));
      if (el) updateMessageElement(el,row);
      else addMessage(row,{animate:true});
    });

    existing.forEach((el,id) => {
      if (!serverIds.has(id)) {
        el.classList.add('chat-message-out');
        setTimeout(() => el.remove(),180);
      }
    });

    if (!rows.length && !box.querySelector('.chat-message')) {
      box.innerHTML = '<div class="chat-empty">Henüz mesaj yok. İlk mesajı sen yaz.</div>';
    } else {
      box.querySelector('.chat-empty')?.remove();
    }
  }

  async function preloadProfiles(ids) {
    const missing = ids.filter(id => !profileCache.has(id));
    if (!missing.length) return;

    const { data,error } = await withTimeout(
      client.from('profiles')
        .select('id,username,avatar_url,bio,site_role,last_seen,created_at')
        .in('id',missing),
      8000,
      'Profil listesi alınamadı.'
    ).catch(error => ({data:null,error}));

    if (error) {
      console.warn('[Atlantis Chat] profile preload:',error);
      return;
    }
    (data || []).forEach(p => profileCache.set(p.id,p));
  }


  async function loadBlockedUsers() {
    blockedUserIds = new Set();
    if (!currentUser) return;
    const { data, error } = await withTimeout(
      client.from('user_blocks')
        .select('blocked_user_id')
        .eq('user_id', currentUser.id),
      5000,
      'Engel listesi alınamadı.'
    ).catch(error => ({data:null,error}));
    if (!error) {
      blockedUserIds = new Set((data || []).map(row => String(row.blocked_user_id)));
    }
  }

  function displayName(message) {
    if (!message.user_id) return 'Anonim';
    return String(
      profileCache.get(message.user_id)?.username ||
      message.username ||
      'Oyuncu'
    );
  }

  function avatarUrl(message) {
    if (message.user_id) {
      if (message.user_id === currentUser?.id && currentProfile?.avatar_url) {
        return String(currentProfile.avatar_url);
      }
      const current = profileCache.get(message.user_id);
      if (current?.avatar_url) return String(current.avatar_url);
    }
    return String(message.avatar_url || '');
  }

  function formatMentions(text) {
    return esc(text).replace(
      /(^|[^A-Za-z0-9ÇĞİÖŞÜçğıöşü_])@([A-Za-zÇĞİÖŞÜçğıöşü0-9]{3,16})/g,
      '$1<span class="chat-mention">@$2</span>'
    );
  }

  function messageTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '--:--' : date.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});
  }

  function targetRoleForMessage(message) {
    if (!message?.user_id) return 'user';
    return String(profileCache.get(message.user_id)?.site_role || 'unknown').trim().toLowerCase();
  }

  function canDeleteMessage(message) {
    if (!currentUser || !message) return false;
    const myRole = String(currentProfile?.site_role || 'user').trim().toLowerCase();
    const own = String(message.user_id || '') === String(currentUser.id || '');
    if (own) return true;
    if (!['admin','moderator'].includes(myRole)) return false;
    const targetRole = targetRoleForMessage(message);
    if (targetRole === 'unknown') return false;
    if (myRole === 'admin') return true;
    return targetRole === 'user';
  }

  function buildMessageHtml(message) {
    const userId = String(message.user_id || '');
    if (userId && blockedUserIds.has(userId) && userId !== String(currentUser?.id || '')) return;
    const name = displayName(message);
    const avatar = avatarUrl(message);
    const initial = name.trim().charAt(0).toLocaleUpperCase('tr-TR') || 'A';
    const mine = userId && userId === String(currentUser?.id || '');
    const role = userId ? (profileCache.get(userId)?.site_role || 'user') : 'guest';
    const myRole = String(currentProfile?.site_role || 'user').trim().toLowerCase();
    const canModerate = ['admin','moderator'].includes(myRole);
    const canDelete = canDeleteMessage(message);
    const edited = message.edited_at ? ' · düzenlendi' : '';

    return `
      <button type="button" class="chat-avatar chat-avatar-button" ${userId ? '' : 'disabled'} aria-label="${esc(name)} profili">
        ${avatar ? `<img src="${esc(avatar)}" alt="" loading="lazy">` : `<span>${esc(initial)}</span>`}
      </button>
      <div class="chat-message-body">
        <div class="chat-meta">
          <button type="button" class="chat-user-button ${userId ? `role-name-${esc(role)}` : 'role-name-guest'}" ${userId ? '' : 'disabled'}>${esc(name)}</button>
          ${userId ? `<span class="chat-role-badge role-${esc(role)}">${esc(role === 'admin' ? 'Yönetici' : role === 'moderator' ? 'Moderatör' : 'Oyuncu')}</span>` : '<span class="chat-guest-badge role-name-guest">Misafir</span>'}
          <time datetime="${esc(message.created_at || '')}">${esc(messageTime(message.created_at))}${esc(edited)}</time>
        </div>
        <p class="chat-message-text">${formatMentions(message.message)}</p>
        ${(mine || canDelete || (canModerate && userId && userId !== String(currentUser?.id || '') && targetRoleForMessage(message) !== 'unknown')) ? `
          <div class="chat-message-actions" aria-label="Mesaj işlemleri">
            ${mine ? '<button type="button" class="chat-edit-action" data-chat-edit>✎ Düzenle</button>' : ''}
            ${canDelete ? '<button type="button" class="chat-delete-action" data-chat-delete>× Sil</button>' : ''}
            ${canModerate && userId && userId !== String(currentUser?.id || '') ? '<button type="button" class="chat-moderate-action" data-chat-moderate>🛡 Yönet</button>' : ''}
          </div>` : ''}
      </div>`;
  }

  function attachMessageEvents(item, message) {
    const userId = String(message.user_id || '');
    const name = displayName(message);
    if (userId) {
      item.querySelector('.chat-avatar-button')?.addEventListener('click',()=>openUserProfile(userId,name));
      item.querySelector('.chat-user-button')?.addEventListener('click',()=>openUserProfile(userId,name));
    }
    item.querySelector('[data-chat-edit]')?.addEventListener('click',()=>editMessage(message));
    item.querySelector('[data-chat-delete]')?.addEventListener('click',()=>deleteMessage(message));
    item.querySelector('[data-chat-moderate]')?.addEventListener('click',()=>openModerationActions(message));
  }

  function addMessage(message,{animate=true}={}) {
    const box = document.getElementById('chat-messages');
    if (!box || message?.id == null) return null;

    const id = `chat-message-${message.id}`;
    const existing = document.getElementById(id);
    if (existing) {
      updateMessageElement(existing,message);
      return existing;
    }

    const userId = String(message.user_id || '');
    if (userId && userId !== String(currentUser?.id || '') && blockedUsers.has(userId)) return null;

    const item = document.createElement('article');
    item.id = id;
    item.dataset.messageId = String(message.id);
    item.dataset.userId = userId;
    item.className = `chat-message${animate ? ' chat-message-enter' : ' is-visible'}`;
    item.innerHTML = buildMessageHtml(message);
    box.appendChild(item);
    attachMessageEvents(item,message);

    if (animate) requestAnimationFrame(() => item.classList.add('is-visible'));
    return item;
  }

  function updateMessageElement(item,message) {
    const wasNearBottom = isNearBottom();
    item.innerHTML = buildMessageHtml(message);
    item.dataset.userId = String(message.user_id || '');
    attachMessageEvents(item,message);
    if (wasNearBottom) requestAnimationFrame(() => scrollToBottom(false));
  }

  function isNearBottom() {
    const box = document.getElementById('chat-messages');
    if (!box) return true;
    return box.scrollHeight - box.scrollTop - box.clientHeight < 140;
  }

  function scrollToBottom(smooth=true) {
    const box = document.getElementById('chat-messages');
    if (!box) return;
    box.scrollTo({top:box.scrollHeight,behavior:smooth ? 'smooth' : 'auto'});
  }

  async function openUserProfile(userId,fallbackName) {
    if (!userId) return;
    let p = profileCache.get(userId);
    if (!p) {
      const { data,error } = await client.from('profiles')
        .select('id,username,avatar_url,bio,site_role,last_seen,created_at')
        .eq('id',userId)
        .maybeSingle();
      if (error) console.warn('[Atlantis Chat] profile:',error);
      p = data || {id:userId,username:fallbackName,last_seen:null};
      profileCache.set(userId,p);
    }
    window.openAtlantisUserDrawer?.(p);
  }

  function subscribeChat() {
    if (chatChannel) {
      try { client.removeChannel(chatChannel); } catch {}
    }

    chatChannel = client.channel('atlantis-chat-final');
    chatChannel
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},async payload => {
        const id = payload.new?.user_id;
        const senderBlocked = !!(id && blockedUserIds.has(String(id)) && String(id) !== String(currentUser?.id || ''));
        if (id) await preloadProfiles([id]);
        const nearBottom = isNearBottom();
        if (!senderBlocked) addMessage(payload.new,{animate:true});
        if (!senderBlocked && nearBottom) requestAnimationFrame(() => scrollToBottom(true));
        if (!senderBlocked && payload.new?.user_id !== currentUser?.id) {
          const myName = String(currentProfile?.username || currentUser?.user_metadata?.username || '').trim();
          const bodyText = String(payload.new?.message || '');
          const escapedName = myName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const mentioned = !!(
            myName &&
            new RegExp(`(^|[^A-Za-z0-9ÇĞİÖŞÜçğıöşü_])@${escapedName}(?=$|[^A-Za-z0-9ÇĞİÖŞÜçğıöşü_])`, 'iu').test(bodyText)
          );
          const incoming = document.getElementById(`chat-message-${payload.new?.id}`);
          if (mentioned) incoming?.classList.add('is-mentioned');
          handleIncomingAlert(payload.new, mentioned);
        }
      })
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'messages'},payload => {
        const item = document.getElementById(`chat-message-${payload.new.id}`);
        if (item) updateMessageElement(item,payload.new);
        else addMessage(payload.new,{animate:true});
      })
      .on('postgres_changes',{event:'DELETE',schema:'public',table:'messages'},payload => {
        const item = document.getElementById(`chat-message-${payload.old.id}`);
        if (!item) return;
        item.classList.add('chat-message-out');
        setTimeout(()=>item.remove(),180);
      })
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'chat_settings',filter:'id=eq.1'},payload => {
        chatLocked = !!payload.new?.chat_locked;
        updateComposer();
        updateChatControls();
      })
      .on('broadcast',{event:'typing'},payload => {
        if (payload.payload?.presence_key === presenceKey()) return;
        if (payload.payload?.typing) showTyping(payload.payload.username || 'Birisi');
        else hideTyping();
      })
      .subscribe();
  }

  function presenceKey() {
    if (currentUser?.id) return currentUser.id;
    let key = localStorage.getItem('atlantis-anon-presence');
    if (!key) {
      key = `anon-${window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
      localStorage.setItem('atlantis-anon-presence',key);
    }
    return key;
  }

  function subscribePresence() {
    if (presenceChannel) {
      try { client.removeChannel(presenceChannel); } catch {}
    }

    const key = presenceKey();
    const name = currentUser
      ? String(currentProfile.username || currentUser.user_metadata?.username || 'Oyuncu')
      : 'Anonim';

    presenceChannel = client.channel('atlantis-chat-presence-final',{config:{presence:{key}}});
    const render = () => {
      const state = presenceChannel.presenceState();
      const keys = new Set();
      Object.values(state).flat().forEach(entry => {
        const k = entry?.presence_key || entry?.user_id || entry?.username || 'anon';
        keys.add(k);
      });
      const count = document.getElementById('online-count');
      if (count) count.textContent = `${keys.size} ${keys.size === 1 ? 'kişi' : 'kişi'} sohbeti açık`;
    };

    presenceChannel
      .on('presence',{event:'sync'},render)
      .on('presence',{event:'join'},render)
      .on('presence',{event:'leave'},render)
      .subscribe(async status => {
        if (status !== 'SUBSCRIBED') return;
        await presenceChannel.track({
          presence_key:key,
          user_id:currentUser?.id || null,
          username:name,
          avatar_url:currentProfile.avatar_url || null
        });
        render();
      });
  }

  function startPresenceHeartbeat() {
    clearInterval(presenceHeartbeat);
    presenceHeartbeat = setInterval(() => {
      touchLastSeen();
      if (presenceChannel) {
        presenceChannel.track({
          presence_key:presenceKey(),
          user_id:currentUser?.id || null,
          username:currentUser ? String(currentProfile.username || currentUser.user_metadata?.username || 'Oyuncu') : 'Anonim',
          avatar_url:currentProfile.avatar_url || null
        }).catch(()=>{});
      }
    },60_000);
  }

  function formatRemaining(seconds) {
    const total = Math.max(0, Math.ceil(Number(seconds) || 0));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (days > 0) return `${days} gün ${hours} saat ${minutes} dk ${secs} sn`;
    if (hours > 0) return `${hours} saat ${minutes} dk ${secs} sn`;
    if (minutes > 0) return `${minutes} dk ${secs} sn`;
    return `${secs} sn`;
  }

  function getMuteRemainingSeconds() {
    const until = currentProfile?.muted_until
      ? new Date(currentProfile.muted_until).getTime()
      : 0;
    if (!until || Number.isNaN(until)) return 0;
    return Math.max(0, (until - Date.now()) / 1000);
  }

  function startMuteClock() {
    clearInterval(muteCountdownTimer);
    muteCountdownTimer = setInterval(() => {
      updateComposer();
    }, 1000);
    updateComposer();
  }

  async function refreshOwnProfileState() {
    if (!client || !currentUser) return;
    try {
      const { data, error } = await withTimeout(
        client.from('profiles')
          .select('id,username,avatar_url,bio,site_role,muted_until,last_seen,created_at,updated_at')
          .eq('id', currentUser.id)
          .maybeSingle(),
        5000,
        'Profil yenileme zaman aşımına uğradı.'
      );
      if (!error && data) {
        currentProfile = data;
        profileCache.set(data.id, data);
        updateComposer();
      }
    } catch {}
  }

  function startProfileRefresh() {
    clearInterval(profileRefreshTimer);
    if (!currentUser) return;
    profileRefreshTimer = setInterval(refreshOwnProfileState, 5000);
  }

  function setupComposer() {
    const form = document.getElementById('chat-form');
    const input = document.getElementById('chat-input');
    const button = form?.querySelector('button');
    if (!form || !input || !button || form.dataset.atlantisFinalBound === '1') return;
    form.dataset.atlantisFinalBound = '1';

    input.addEventListener('input',() => {
      if (!canWriteToChat()) return;
      broadcastTyping(true);
      clearTimeout(typingTimer);
      typingTimer = setTimeout(()=>broadcastTyping(false),900);
    });
    input.addEventListener('blur',()=>broadcastTyping(false));

    form.onsubmit = async event => {
      event.preventDefault();
      if (!canWriteToChat()) {
        toast(chatLocked ? 'Sohbet şu anda yalnızca moderatörler ve yöneticiler için açık.' : 'Şu anda mesaj gönderemezsin.');
        return;
      }
      const text = input.value.trim();
      if (!text) return;
      if (text.length > 300) return toast('Mesaj en fazla 300 karakter olabilir.');

      const remaining = 3000 - (Date.now() - lastSent);
      if (remaining > 0) return toast(`Yeni mesaj için ${Math.ceil(remaining / 1000)} saniye bekle.`);

      const wasNearBottom = isNearBottom();
      button.disabled = true;
      button.classList.add('is-sending');
      const oldText = button.textContent;
      button.textContent = 'Gönderiliyor…';

      try {
        let result;
        if (!currentUser) {
          throw new Error('Mesaj yazabilmek için giriş yapmalısın!');
        }
        result = await client.rpc('send_chat_message',{p_message:text});
        if (result.error) throw result.error;

        input.value = '';
        lastSent = Date.now();
        broadcastTyping(false);

        const returned = result.data && typeof result.data === 'object' && result.data.id != null
          ? result.data
          : null;
        if (returned) {
          if (returned.user_id) await preloadProfiles([returned.user_id]);
          addMessage(returned,{animate:true});
          if (wasNearBottom) requestAnimationFrame(() => scrollToBottom(true));
        } else {
          await syncMessages({initial:false});
          if (wasNearBottom) requestAnimationFrame(() => scrollToBottom(true));
        }
      } catch (error) {
        console.error('[Atlantis Chat] send:',error);
        toast(error?.message || 'Mesaj gönderilemedi.');
      } finally {
        button.disabled = false;
        button.classList.remove('is-sending');
        button.textContent = oldText;
        input.focus({preventScroll:true});
      }
    };
  }

  function canWriteToChat() {
    if (!currentUser) return false;
    if (!chatLocked) return true;
    return ['admin','moderator'].includes(String(currentProfile?.site_role || '').trim().toLowerCase());
  }

  function updateComposer() {
    const input = document.getElementById('chat-input');
    const button = document.querySelector('#chat-form button');
    const form = document.getElementById('chat-form');
    if (!input) return;

    const role = String(currentProfile?.site_role || '').trim().toLowerCase();
    const muteRemaining = getMuteRemainingSeconds();
    const muted = muteRemaining > 0;
    const lockedForUser = !!chatLocked && !['admin','moderator'].includes(role);
    const anonymous = !currentUser;
    const disabled = anonymous || muted || lockedForUser;

    input.disabled = disabled;
    if (button && !button.classList.contains('is-sending')) button.disabled = disabled;

    if (anonymous) {
      input.placeholder = 'Mesaj yazabilmek için giriş yapmalısın!';
    } else if (muted) {
      input.placeholder = `Geçici olarak susturuldun — ${formatRemaining(muteRemaining)} kaldı.`;
    } else if (lockedForUser) {
      input.placeholder = 'Sohbet kilitli — yalnızca moderatörler ve yöneticiler yazabilir.';
    } else {
      input.placeholder = 'Mesajını yaz…';
    }

    if (form) {
      form.setAttribute('aria-disabled', String(disabled));
      form.classList.toggle('chat-form-locked', !!(lockedForUser || anonymous || muted));

      let status = document.getElementById('chat-lock-status');
      const statusText = anonymous
        ? '🔒 Mesaj göndermek için giriş yapmalısın.'
        : muted
          ? `🔇 Geçici olarak susturuldun — ${formatRemaining(muteRemaining)} kaldı.`
          : lockedForUser
            ? '🔒 Sohbet kilitli — yalnızca moderatörler ve yöneticiler mesaj gönderebilir.'
            : '';

      if (statusText) {
        if (!status) {
          status = document.createElement('div');
          status.id = 'chat-lock-status';
          status.className = 'chat-lock-banner';
          form.parentNode?.insertBefore(status, form);
        }
        status.textContent = statusText;
        status.classList.toggle('is-muted', muted);
        status.classList.toggle('is-anonymous', anonymous);
        status.classList.toggle('is-locked', lockedForUser);
      } else {
        status?.remove();
      }
    }

    if (muteRemaining <= 0 && currentProfile?.muted_until) {
      // Clear an expired local timestamp so the input re-enables immediately.
      currentProfile = {...currentProfile, muted_until:null};
    }
  }


  async function loadChatLockState() {
    try {
      const { data, error } = await client.rpc('is_chat_locked');
      if (error) throw error;
      chatLocked = !!data;
    } catch (error) {
      console.warn('[Atlantis Chat] chat lock state:', error);
      chatLocked = false;
    }
    updateComposer();
    updateChatControls();
  }



  async function broadcastTyping(typing) {
    if (!chatChannel) return;
    const now = Date.now();
    if (typing && now - lastTypingSent < 700) return;
    lastTypingSent = now;
    try {
      await chatChannel.send({type:'broadcast',event:'typing',payload:{
        presence_key:presenceKey(),
        username:currentUser ? String(currentProfile.username || currentUser.user_metadata?.username || 'Oyuncu') : 'Anonim',
        typing:!!typing
      }});
    } catch {}
  }

  function ensureTypingUI() {
    const panel = document.querySelector('.chat-panel');
    const form = document.getElementById('chat-form');
    if (!panel || !form || document.getElementById('chat-typing')) return;
    const el = document.createElement('div');
    el.id = 'chat-typing';
    el.className = 'chat-typing';
    panel.insertBefore(el,form);
  }

  function showTyping(name) {
    const el = document.getElementById('chat-typing');
    if (el) el.innerHTML = `<span>${esc(name)} yazıyor</span><i></i><i></i><i></i>`;
  }
  function hideTyping() {
    const el = document.getElementById('chat-typing');
    if (el) el.textContent = '';
  }

  function openChatDialog({title,subtitle,content,onClose}) {
    document.getElementById('chat-action-modal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'chat-action-modal';
    overlay.className = 'chat-action-modal';
    overlay.innerHTML = `
      <div class="chat-action-backdrop"></div>
      <section class="chat-action-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <button type="button" class="chat-action-close" aria-label="Kapat">×</button>
        <div class="chat-action-icon">💬</div>
        <span class="section-label">ATLANTİS SOHBETİ</span>
        <h2>${esc(title)}</h2>
        <p>${esc(subtitle)}</p>
        <div class="chat-action-content">${content}</div>
      </section>`;
    document.body.appendChild(overlay);
    const close = () => { overlay.remove(); onClose?.(); };
    overlay.querySelector('.chat-action-close').onclick = close;
    overlay.querySelector('.chat-action-backdrop').onclick = close;
    return overlay;
  }

  async function editMessage(message) {
    if (!currentUser || String(message.user_id) !== String(currentUser.id)) return;
    const overlay = openChatDialog({
      title:'Mesajı Düzenle',
      subtitle:'Mesajını güncelle ve tekrar sohbete gönder.',
      content:`
        <form id="chat-edit-form" class="auth-form">
          <label>Mesajın
            <textarea name="message" maxlength="300" rows="5" required>${esc(message.message || '')}</textarea>
          </label>
          <div class="chat-editor-counter"><span data-chat-count>0</span>/300</div>
          <button class="primary-button wide" type="submit">Değişiklikleri Kaydet</button>
          <div class="auth-message" data-chat-message></div>
        </form>`
    });

    const form = overlay.querySelector('#chat-edit-form');
    const input = form.elements.message;
    const counter = form.querySelector('[data-chat-count]');
    const updateCounter = () => { counter.textContent = String(input.value.length); };
    input.addEventListener('input',updateCounter);
    updateCounter();
    requestAnimationFrame(() => input.focus());

    form.onsubmit = async event => {
      event.preventDefault();
      const next = input.value.trim();
      const messageBox = form.querySelector('[data-chat-message]');
      if (!next || next.length > 300) {
        messageBox.textContent = 'Mesaj 1–300 karakter olmalı.';
        messageBox.className = 'auth-message error';
        return;
      }

      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = 'Kaydediliyor…';
      try {
        const { error } = await client.from('messages')
          .update({message:next,edited_at:new Date().toISOString()})
          .eq('id',message.id)
          .eq('user_id',currentUser.id);
        if (error) throw error;

        const el = document.getElementById(`chat-message-${message.id}`);
        if (el) updateMessageElement(el,{...message,message:next,edited_at:new Date().toISOString()});
        overlay.remove();
        toast('Mesaj güncellendi.');
      } catch (error) {
        messageBox.textContent = error?.message || 'Mesaj düzenlenemedi.';
        messageBox.className = 'auth-message error';
      } finally {
        button.disabled = false;
        button.textContent = 'Değişiklikleri Kaydet';
      }
    };
  }

  async function deleteMessage(message) {
    if (!currentUser || !canDeleteMessage(message)) return;
    const own = String(message.user_id || '') === String(currentUser.id);
    const overlay = openChatDialog({
      title:'Mesajı Sil',
      subtitle:'Bu işlem mesajı sohbetten kaldırır.',
      content:`
        <div class="chat-delete-preview">“${esc(message.message || '')}”</div>
        <div class="chat-delete-actions">
          <button type="button" class="secondary-button" data-delete-cancel>Vazgeç</button>
          <button type="button" class="danger-button" data-delete-confirm>Mesajı Sil</button>
        </div>`
    });
    overlay.querySelector('[data-delete-cancel]').onclick = () => overlay.remove();
    overlay.querySelector('[data-delete-confirm]').onclick = async event => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Siliniyor…';
      try {
        let result;
        if (own) {
          result = await client.from('messages').delete().eq('id',message.id).eq('user_id',currentUser.id);
        } else {
          result = await client.rpc('moderation_delete_message_v2',{target_message_id:String(message.id)});
          if (result.error && /schema cache|could not find the function|not found/i.test(String(result.error.message || ''))) {
            result = await client.from('messages').delete().eq('id',message.id);
          }
        }
        const { error } = result;
        if (error) throw error;
        const el = document.getElementById(`chat-message-${message.id}`);
        el?.classList.add('chat-message-out');
        setTimeout(()=>el?.remove(),180);
        overlay.remove();
        toast('Mesaj silindi.');
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Mesajı Sil';
        toast(error?.message || 'Mesaj silinemedi.');
      }
    };
  }

  async function openModerationActions(message) {
    if (!currentUser || !['admin','moderator'].includes(String(currentProfile?.site_role || '')) || !message.user_id) return;
    const target = profileCache.get(message.user_id) || {};
    const targetRole = String(target.site_role || 'user');
    const actorRole = String(currentProfile?.site_role || 'user');
    if (String(message.user_id) === String(currentUser.id)) return;
    const canAct = targetRole !== 'admin' && !(actorRole === 'moderator' && targetRole === 'moderator');
    const name = displayName(message);
    const muteOptions = [
      [0,'Susturmayı kaldır'],[300,'5 dk'],[600,'10 dk'],[1200,'20 dk'],[1800,'30 dk'],
      [2700,'45 dk'],[3600,'1 saat'],[7200,'2 saat'],[10800,'3 saat'],[86400,'1 gün'],
      [259200,'3 gün'],[432000,'5 gün'],[-1,'Kalıcı']
    ].map(([value,label]) => `<option value="${value}">${label}</option>`).join('');
    const overlay = openChatDialog({
      title:'Kullanıcıyı Yönet',
      subtitle: canAct ? `${name} için moderasyon işlemi seç.` : `${name} için işlem yapma yetkin yok.`,
      content:`<div class="chat-mod-grid">
        ${canAct ? `
          <button type="button" class="danger-button" data-mod-delete>Mesajı Sil</button>
          <select data-mod-mute aria-label="Susturma süresi">${muteOptions}</select>
          <input class="mod-custom-duration" data-mod-custom type="number" min="1" step="1" placeholder="Özel dakika" aria-label="Özel susturma süresi dakika">
          <button type="button" class="secondary-button" data-mod-apply>Uygula</button>
          <button type="button" class="danger-button" data-mod-ban>1 saat site banı</button>
          <button type="button" class="secondary-button" data-mod-unmute>Susturmayı kaldır</button>` : '<div class="empty-panel">Bu kullanıcı moderatör/yönetici hiyerarşisinde korunuyor.</div>'}
      </div><div class="auth-message" data-mod-message></div>`
    });
    const msgBox=overlay.querySelector('[data-mod-message]');
    const run=async(action)=>{
      try{
        if(action.type==='delete'){
          let result = await client.rpc('moderation_delete_message_v2',{target_message_id:String(message.id)});
          if (result.error && /schema cache|could not find the function|not found/i.test(String(result.error.message || ''))) {
            result = await client.from('messages').delete().eq('id',message.id);
          }
          if(result.error) throw result.error;
        }
        if(action.type==='mute'){ const {error}=await client.rpc('moderation_set_mute',{target_user_id:message.user_id,duration_seconds:action.seconds}); if(error) throw error; }
        if(action.type==='ban'){ const {error}=await client.rpc('moderation_set_ban',{target_user_id:message.user_id,duration_seconds:action.seconds,reason:'Sohbet moderasyonu'}); if(error) throw error; }
        msgBox.textContent=action.ok; msgBox.className='auth-message success';
        if(action.type==='delete'){document.getElementById(`chat-message-${message.id}`)?.remove();}
        setTimeout(()=>overlay.remove(),400);
      }catch(e){msgBox.textContent=e?.message||'İşlem başarısız.'; msgBox.className='auth-message error';}
    };
    overlay.querySelector('[data-mod-delete]')?.addEventListener('click',()=>run({type:'delete',ok:'Mesaj silindi.'}));
    overlay.querySelector('[data-mod-apply]')?.addEventListener('click',()=>{
      const selected=Number(overlay.querySelector('[data-mod-mute]')?.value ?? 0);
      const customMinutes=Number(overlay.querySelector('[data-mod-custom]')?.value ?? 0);
      const seconds=customMinutes>0 ? Math.floor(customMinutes*60) : selected;
      if(!Number.isFinite(seconds) || seconds < -1){msgBox.textContent='Geçerli bir süre seç.';msgBox.className='auth-message error';return;}
      run({type:'mute',seconds,ok:seconds===0?'Susturma kaldırıldı.':seconds===-1?'Kullanıcı kalıcı susturuldu.':'Kullanıcı susturuldu.'});
    });
    overlay.querySelector('[data-mod-ban]')?.addEventListener('click',()=>run({type:'ban',seconds:3600,ok:'Kullanıcı 1 saat siteye banlandı.'}));
    overlay.querySelector('[data-mod-unmute]')?.addEventListener('click',()=>run({type:'mute',seconds:0,ok:'Susturma kaldırıldı.'}));
  }


  function setupChatControls() {
    const head = document.querySelector('.chat-head');
    if (!head) return;

    let tools = document.getElementById('chat-tools');
    if (!tools) {
      tools = document.createElement('div');
      tools.id = 'chat-tools';
      tools.className = 'chat-tools';
      tools.setAttribute('aria-label','Sohbet araçları');
      head.appendChild(tools);
    }

    if (!tools.querySelector('#chat-sound')) {
      const soundButton = document.createElement('button');
      soundButton.id = 'chat-sound';
      soundButton.className = 'ghost-button chat-tool-button';
      soundButton.type = 'button';
      soundButton.setAttribute('aria-pressed','false');
      soundButton.textContent = 'Etiket Sesi Kapalı';
      tools.appendChild(soundButton);
    }

    const role = String(currentProfile?.site_role || '').trim().toLowerCase();
    const canModerate = !!currentUser && ['admin','moderator'].includes(role);

    let clearButton = document.getElementById('chat-clear');
    if (canModerate && !clearButton) {
      clearButton = document.createElement('button');
      clearButton.id = 'chat-clear';
      clearButton.className = 'danger-button chat-tool-button chat-clear-button';
      clearButton.type = 'button';
      clearButton.textContent = 'Sohbeti Temizle';
      clearButton.title = 'Sohbetteki tüm mesajları temizle';
      clearButton.addEventListener('click', clearChat);
      tools.appendChild(clearButton);
    } else if (!canModerate) {
      clearButton?.remove();
    }

    let lockButton = document.getElementById('chat-lock');
    if (canModerate && !lockButton) {
      lockButton = document.createElement('button');
      lockButton.id = 'chat-lock';
      lockButton.className = 'danger-button chat-tool-button chat-lock-toggle';
      lockButton.type = 'button';
      lockButton.addEventListener('click', toggleChatLock);
      tools.appendChild(lockButton);
    } else if (!canModerate) {
      lockButton?.remove();
    }

    const sound = document.getElementById('chat-sound');
    if (sound && sound.dataset.bound !== '1') {
      sound.dataset.bound = '1';
      sound.addEventListener('click', () => {
        const enabled = localStorage.getItem('atlantis-chat-sound') === '1';
        const next = !enabled;
        localStorage.setItem('atlantis-chat-sound', next ? '1' : '0');
        if (next) {
          ensureAudioReady();
          playSound(true, false);
        }
        updateChatControls();
      });
    }

    updateChatControls();
  }

  function updateLockButton(button) {
    if (!button) return;
    button.textContent = chatLocked ? 'Sohbeti Aç' : 'Sohbeti Kilitle';
    button.classList.toggle('is-locked', !!chatLocked);
    button.setAttribute('aria-pressed', String(!!chatLocked));
  }

  async function toggleChatLock() {
    const role = String(currentProfile?.site_role || '').trim().toLowerCase();
    if (!currentUser || !['admin','moderator'].includes(role) || !client) return;
    const button = document.getElementById('chat-lock');
    const nextLocked = !chatLocked;
    button?.classList.add('is-working');
    try {
      const {error} = await client.rpc('moderation_set_chat_lock',{lock_chat:nextLocked});
      if (error) throw error;
      chatLocked = nextLocked;
      updateComposer();
      updateChatControls();
      toast(nextLocked ? 'Sohbet kilitlendi.' : 'Sohbet tekrar açıldı.','success');
    } catch(error) {
      toast(error?.message || 'Sohbet kilidi değiştirilemedi.','error');
    } finally {
      button?.classList.remove('is-working');
    }
  }

  function updateChatControls() {
    const s = document.getElementById('chat-sound');
    const clearButton = document.getElementById('chat-clear');
    const lockButton = document.getElementById('chat-lock');
    const role = String(currentProfile?.site_role || '').trim().toLowerCase();
    const canModerate = !!currentUser && ['admin','moderator'].includes(role);
    const soundEnabled = localStorage.getItem('atlantis-chat-sound') === '1';

    if (s) {
      s.textContent = soundEnabled ? 'Etiket Sesi Açık' : 'Etiket Sesi Kapalı';
      s.setAttribute('aria-pressed', String(soundEnabled));
      s.classList.toggle('is-enabled', soundEnabled);
      s.classList.toggle('is-disabled', !soundEnabled);
    }
    if (clearButton) {
      clearButton.hidden = !canModerate;
      clearButton.disabled = !canModerate;
    }
    if (lockButton) {
      lockButton.hidden = !canModerate;
      lockButton.disabled = !canModerate;
      updateLockButton(lockButton);
    }
  }

  function openClearChatConfirm(onConfirm) {
    const overlay = openChatDialog({
      title:'Sohbeti Temizle',
      subtitle:'Bu işlem sohbet geçmişindeki tüm mesajları kalıcı olarak kaldırır.',
      content:`
        <div class="chat-clear-warning">
          <div class="chat-clear-warning-icon">!</div>
          <div>
            <strong>Tüm sohbet geçmişi silinecek.</strong>
            <p>Bu işlem geri alınamaz. Sohbeti temizlemek istediğine emin misin?</p>
          </div>
        </div>
        <div class="chat-delete-actions">
          <button type="button" class="secondary-button" data-clear-cancel>Vazgeç</button>
          <button type="button" class="danger-button chat-clear-confirm" data-clear-confirm>Temizle</button>
        </div>`
    });
    overlay.querySelector('[data-clear-cancel]').onclick = () => overlay.remove();
    overlay.querySelector('[data-clear-confirm]').onclick = async event => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Temizleniyor…';
      try {
        await onConfirm();
        overlay.remove();
      } catch(error) {
        button.disabled = false;
        button.textContent = 'Temizle';
        let box = overlay.querySelector('[data-clear-error]');
        if (!box) {
          box = document.createElement('div');
          box.dataset.clearError = '1';
          box.className = 'auth-message error';
          overlay.querySelector('.chat-action-content')?.appendChild(box);
        }
        box.textContent = error?.message || 'Sohbet temizlenemedi.';
      }
    };
    return overlay;
  }

  async function clearChat() {
    const role = String(currentProfile?.site_role || '').trim().toLowerCase();
    if (!currentUser || !['admin','moderator'].includes(role) || !client) {
      return toast('Sohbet temizleme yetkin yok.','error');
    }

    const button = document.getElementById('chat-clear');
    if (!button || button.disabled) return;

    openClearChatConfirm(async () => {
      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = 'Temizleniyor…';
      try {
        let count = 0;
        const rpc = await client.rpc('moderation_clear_chat');
        if (!rpc.error) {
          count = Number(rpc.data) || 0;
        } else {
          const fallback = await client.from('messages')
            .delete()
            .not('id','is',null)
            .select('id');
          if (fallback.error) throw rpc.error;
          count = Array.isArray(fallback.data) ? fallback.data.length : 0;
        }
        await syncMessages({initial:false});
        toast(`${count} mesaj temizlendi.`,'success');
      } finally {
        button.disabled = false;
        button.textContent = originalText;
        updateChatControls();
      }
    });
  }


  let audioContext = null;
  function ensureAudioReady() {
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume().catch(()=>{});
      return audioContext;
    } catch {
      return null;
    }
  }

  function playSound(gesture=false, mention=false) {
    try {
      const ctx = ensureAudioReady();
      if (!ctx || ctx.state !== 'running') {
        if (gesture && ctx?.resume) ctx.resume().catch(()=>{});
        return;
      }
      const now = ctx.currentTime;
      // A short, bright "dı-dı-dıt" style sound. Noticeably louder than the old signal.
      const notes = mention ? [784,988,1175] : [659,784];
      notes.forEach((freq,i)=>{
        const osc=ctx.createOscillator();
        const gain=ctx.createGain();
        osc.type = mention ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freq, now + i*(mention ? .095 : .07));
        const start = now + i*(mention ? .095 : .07);
        const end = start + (mention ? .18 : .14);
        gain.gain.setValueAtTime(.0001,start);
        gain.gain.exponentialRampToValueAtTime(mention ? .24 : .17,start+.012);
        gain.gain.exponentialRampToValueAtTime(.0001,end);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(end+.015);
      });
    } catch {}
  }

  // Browsers suspend audio until a user gesture. Unlock it once the user interacts.
  ['pointerdown','touchstart','keydown'].forEach(type => {
    window.addEventListener(type, () => {
      if (localStorage.getItem('atlantis-chat-sound') === '1') ensureAudioReady();
    }, {passive:true});
  });

  function handleIncomingAlert(message, mentioned=false) {
    // Etiket sesi yalnızca kullanıcı gerçekten @ile etiketlendiyse çalışır.
    // Tarayıcı bildirimleri kaldırıldı; yalnızca etiket sesi kullanılabilir.
    if (mentioned && localStorage.getItem('atlantis-chat-sound') === '1') {
      playSound(false,true);
    }
  }

  function touchLastSeen() {
    if (!currentUser) return;
    client.rpc('touch_my_last_seen').catch(()=>{});
  }

  function setError(text) {
    const box = document.getElementById('chat-messages');
    if (box) box.innerHTML = `<div class="chat-empty chat-error">${esc(text)}</div>`;
  }

  function toast(text, type='info') {
    if (window.atlantisToast && type === 'info') {
      window.atlantisToast(text);
      return;
    }
    let el = document.getElementById('atlantis-chat-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'atlantis-chat-toast';
      el.className = 'chat-toast';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.remove('is-success','is-error');
    if (type === 'success') el.classList.add('is-success');
    if (type === 'error') el.classList.add('is-error');
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(()=>el.classList.remove('show','is-success','is-error'),2600);
  }

  async function refreshChat() {
    try {
      await readIdentity();
      await withTimeout(loadBlockedUsers(), 5000, 'Engel listesi alınamadı.').catch(() => { blockedUserIds = new Set(); });
      blockedUsers = new Set(blockedUserIds);
      await syncMessages({initial:false});
    } catch (error) {
      console.error('[Atlantis Chat] refresh:', error);
    }
  }

  window.atlantisReloadChat = refreshChat;

  /* Teardown for the SPA-lite navigation in script.js: when the user leaves
     the chat page without a full reload, drop realtime channels/timers so
     they don't keep running (and eating battery/CPU) in the background. */
  function teardown(){
    try { if (chatChannel) client?.removeChannel(chatChannel); } catch {}
    try { if (presenceChannel) client?.removeChannel(presenceChannel); } catch {}
    chatChannel = null;
    presenceChannel = null;
    clearInterval(presenceHeartbeat);
    presenceHeartbeat = null;
    clearTimeout(typingTimer);
    typingTimer = null;
    clearInterval(muteCountdownTimer); muteCountdownTimer = null;
    clearInterval(profileRefreshTimer); profileRefreshTimer = null;
    initialized = false;
    initialLoaded = false;
  }
  window.atlantisChatTeardown = teardown;

  window.addEventListener('atlantis:content-swapped', event => {
    const page = event.detail?.page;
    const box = document.getElementById('chat-messages');
    if (page === 'chat' && box) {
      teardown();
      init();
    } else if (chatChannel || presenceChannel || initialized) {
      teardown();
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();

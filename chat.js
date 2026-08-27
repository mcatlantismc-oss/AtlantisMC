/* Atlantis MC — Chat experience
   Fast loading, bottom-anchored history, live messages, profiles,
   edit/delete dialogs, realtime, presence and typing.
*/
(() => {
  'use strict';

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[ch]));

  let client = null;
  let currentUser = null;
  let currentProfile = {};
  let chatChannel = null;
  let presenceChannel = null;
  let initialized = false;
  let initialLoaded = false;
  let lastSent = 0;
  let typingTimer = null;
  let lastTypingSent = 0;
  let presenceHeartbeat = null;
  const profileCache = new Map();
  let blockedUsers = new Set();

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

    client = await window.atlantisGetClient?.();
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
    ensureTypingUI();
    setupNotificationControls();
    bindAuthEvents();
    setupComposer();
    await syncMessages({initial:true});
    subscribeChat();
    subscribePresence();
    startPresenceHeartbeat();
    touchLastSeen();
    updateComposer();
  }

  async function readIdentity() {
    const { data:{ session } } = await client.auth.getSession();
    currentUser = session?.user || null;
    currentProfile = {};

    if (currentUser) {
      const { data } = await client.from('profiles')
        .select('id,username,avatar_url,bio,site_role,muted_until,last_seen,created_at,updated_at')
        .eq('id',currentUser.id)
        .maybeSingle();
      currentProfile = data || {};
      if (data?.id) profileCache.set(data.id,data);
    }
  }

  function bindAuthEvents() {
    window.addEventListener('atlantis-auth-login', async () => {
      await refreshIdentityOnly();
      await syncMessages({initial:false});
      subscribeChat();
      subscribePresence();
      touchLastSeen();
      updateComposer();
    });

    window.addEventListener('atlantis-auth-logout', async () => {
      currentUser = null;
      currentProfile = {};
      profileCache.clear();
      try { if (chatChannel) await client.removeChannel(chatChannel); } catch {}
      try { if (presenceChannel) await client.removeChannel(presenceChannel); } catch {}
      chatChannel = null;
      presenceChannel = null;
      await syncMessages({initial:false});
      subscribePresence();
      updateComposer();
    });

    window.addEventListener('atlantis-profile-updated', async event => {
      currentProfile = event.detail?.profile || currentProfile;
      if (currentProfile?.id) profileCache.set(currentProfile.id,currentProfile);
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
    let result = await client.from('messages')
      .select('id,user_id,username,message,created_at,edited_at,avatar_url')
      .order('created_at',{ascending:false})
      .limit(300);
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

    const { data,error } = await client.from('profiles')
      .select('id,username,avatar_url,bio,site_role,last_seen,created_at')
      .in('id',missing);

    if (error) {
      console.warn('[Atlantis Chat] profile preload:',error);
      return;
    }
    (data || []).forEach(p => profileCache.set(p.id,p));
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

  function buildMessageHtml(message) {
    const userId = String(message.user_id || '');
    const name = displayName(message);
    const avatar = avatarUrl(message);
    const initial = name.trim().charAt(0).toLocaleUpperCase('tr-TR') || 'A';
    const mine = userId && userId === String(currentUser?.id || '');
    const role = userId ? (profileCache.get(userId)?.site_role || 'user') : 'guest';
    const myRole = currentProfile?.site_role || 'user';
    const canModerate = myRole === 'admin' || myRole === 'moderator';
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
        ${mine || canModerate ? `
          <div class="chat-message-actions" aria-label="Mesaj işlemleri">
            ${mine ? '<button type="button" class="chat-edit-action" data-chat-edit>✎ Düzenle</button>' : ''}
            ${mine || canModerate ? '<button type="button" class="chat-delete-action" data-chat-delete>× Sil</button>' : ''}
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
        if (id) await preloadProfiles([id]);
        const nearBottom = isNearBottom();
        addMessage(payload.new,{animate:true});
        if (nearBottom) requestAnimationFrame(() => scrollToBottom(true));
        if (payload.new?.user_id !== currentUser?.id) {
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

  function setupComposer() {
    const form = document.getElementById('chat-form');
    const input = document.getElementById('chat-input');
    const button = form?.querySelector('button');
    if (!form || !input || !button || form.dataset.atlantisFinalBound === '1') return;
    form.dataset.atlantisFinalBound = '1';

    input.addEventListener('input',() => {
      broadcastTyping(true);
      clearTimeout(typingTimer);
      typingTimer = setTimeout(()=>broadcastTyping(false),900);
    });
    input.addEventListener('blur',()=>broadcastTyping(false));

    form.onsubmit = async event => {
      event.preventDefault();
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
        if (currentUser) {
          result = await client.rpc('send_chat_message',{p_message:text});
        } else {
          result = await client.rpc('send_anonymous_chat_message',{p_message:text});
          if (result.error && String(result.error.message || '').toLowerCase().includes('schema cache')) {
            result = await client.from('messages').insert({user_id:null,username:'Anonim',message:text,avatar_url:null}).select('id,user_id,username,message,created_at,edited_at,avatar_url').single();
          }
        }
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

  function updateComposer() {
    const input = document.getElementById('chat-input');
    const button = document.querySelector('#chat-form button');
    if (!input) return;

    const muted = currentProfile?.muted_until && new Date(currentProfile.muted_until) > new Date();
    input.disabled = !!muted;
    if (button && !button.classList.contains('is-sending')) button.disabled = !!muted;
    input.placeholder = muted ? 'Sohbet kullanımın geçici olarak kısıtlandı.' : currentUser ? 'Mesajını yaz…' : 'Anonim olarak mesajını yaz…';
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
    if (!currentUser) return;
    const own = String(message.user_id) === String(currentUser.id);
    const canModerate = ['admin','moderator'].includes(String(currentProfile?.site_role || ''));
    if (!own && !canModerate) return;
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
        const result = own
          ? await client.from('messages').delete().eq('id',message.id).eq('user_id',currentUser.id)
          : await client.rpc('moderation_delete_message',{target_message_id:message.id});
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
    const name = displayName(message);
    const overlay = openChatDialog({
      title:'Kullanıcıyı Yönet',
      subtitle:`${name} için moderasyon işlemi seç.`,
      content:`<div class="chat-mod-grid">
        <button type="button" class="danger-button" data-mod-delete>Mesajı Sil</button>
        <button type="button" class="secondary-button" data-mod-mute>5 dk sustur</button>
        <button type="button" class="secondary-button" data-mod-mute30>30 dk sustur</button>
        <button type="button" class="secondary-button" data-mod-mute1h>1 saat sustur</button>
        <button type="button" class="danger-button" data-mod-ban>1 saat site banı</button>
        <button type="button" class="secondary-button" data-mod-unmute>Yasağı / susturmayı kaldır</button>
      </div><div class="auth-message" data-mod-message></div>`
    });
    const msgBox=overlay.querySelector('[data-mod-message]');
    const run=async(action)=>{
      try{
        if(action.type==='delete'){ const {error}=await client.rpc('moderation_delete_message',{target_message_id:message.id}); if(error) throw error; }
        if(action.type==='mute'){ const {error}=await client.rpc('moderation_set_mute',{target_user_id:message.user_id,duration_seconds:action.seconds}); if(error) throw error; }
        if(action.type==='ban'){ const {error}=await client.rpc('moderation_set_ban',{target_user_id:message.user_id,duration_seconds:action.seconds,reason:'Sohbet moderasyonu'}); if(error) throw error; }
        msgBox.textContent=action.ok; msgBox.className='auth-message success';
        if(action.type==='delete'){document.getElementById(`chat-message-${message.id}`)?.remove();}
        setTimeout(()=>overlay.remove(),500);
      }catch(e){msgBox.textContent=e?.message||'İşlem başarısız.'; msgBox.className='auth-message error';}
    };
    overlay.querySelector('[data-mod-delete]').onclick=()=>run({type:'delete',ok:'Mesaj silindi.'});
    overlay.querySelector('[data-mod-mute]').onclick=()=>run({type:'mute',seconds:300,ok:'Kullanıcı 5 dakika susturuldu.'});
    overlay.querySelector('[data-mod-mute30]').onclick=()=>run({type:'mute',seconds:1800,ok:'Kullanıcı 30 dakika susturuldu.'});
    overlay.querySelector('[data-mod-mute1h]').onclick=()=>run({type:'mute',seconds:3600,ok:'Kullanıcı 1 saat susturuldu.'});
    overlay.querySelector('[data-mod-ban]').onclick=()=>run({type:'ban',seconds:3600,ok:'Kullanıcı 1 saat siteye banlandı.'});
    overlay.querySelector('[data-mod-unmute]').onclick=()=>run({type:'mute',seconds:0,ok:'Susturma kaldırıldı.'});
  }

  function setupNotificationControls() {
    const head = document.querySelector('.chat-head');
    if (!head || document.getElementById('chat-tools')) return;
    const tools = document.createElement('div');
    tools.id = 'chat-tools';
    tools.className = 'chat-tools';
    tools.innerHTML = `<button id="chat-notify" class="ghost-button" type="button" aria-pressed="false">Bildirimler Kapalı</button><button id="chat-sound" class="ghost-button" type="button" aria-pressed="false">Etiket Sesi Kapalı</button>${['admin','moderator'].includes(String(currentProfile?.site_role||'')) ? '<button id="chat-lock" class="ghost-button" type="button">Sohbet Kilidi</button>' : ''}`;
    head.appendChild(tools);

    document.getElementById('chat-notify').onclick = async () => {
      if (!('Notification' in window)) return toast('Bu tarayıcı bildirimleri desteklemiyor.');
      const permission = Notification.permission;
      if (permission === 'granted') {
        const next = localStorage.getItem('atlantis-chat-notifications') !== '1';
        localStorage.setItem('atlantis-chat-notifications', next ? '1' : '0');
        updateNotificationControls();
        return;
      }
      if (permission === 'denied') {
        localStorage.setItem('atlantis-chat-notifications','0');
        updateNotificationControls();
        toast('Bildirim izni tarayıcıdan kapalı. Site ayarlarından izin verebilirsin.');
        return;
      }
      const result = await Notification.requestPermission();
      localStorage.setItem('atlantis-chat-notifications', result === 'granted' ? '1' : '0');
      updateNotificationControls();
    };
    document.getElementById('chat-sound').onclick = () => {
      const enabled = localStorage.getItem('atlantis-chat-sound') === '1';
      const next = !enabled;
      localStorage.setItem('atlantis-chat-sound', next ? '1' : '0');
      if (next) {
        // Kullanıcı butona bastığı için tarayıcının ses kilidini açabiliriz.
        // Açarken bir kez kısa test sesi çalar; sonraki sesler yalnızca gerçek etiketlerde gelir.
        ensureAudioReady();
        playSound(true, false);
      }
      updateNotificationControls();
    };
    document.getElementById('chat-lock')?.addEventListener('click', async () => {
      const { data: locked, error } = await client.rpc('is_chat_locked');
      if (error) return toast(error.message || 'Kilit durumu alınamadı.');
      const result = await client.rpc('moderation_set_chat_lock',{lock_chat:!locked});
      if (result.error) return toast(result.error.message || 'Kilit değiştirilemedi.');
      toast(locked ? 'Sohbet açıldı.' : 'Sohbet kilitlendi.');
      updateComposer();
      updateNotificationControls();
    });
    updateNotificationControls();
  }

  function updateNotificationControls() {
    const n = document.getElementById('chat-notify');
    const s = document.getElementById('chat-sound');
    const notificationSupported = 'Notification' in window;
    const permission = notificationSupported ? Notification.permission : 'denied';
    const notificationEnabled = permission === 'granted' && localStorage.getItem('atlantis-chat-notifications') === '1';
    const soundEnabled = localStorage.getItem('atlantis-chat-sound') === '1';

    if (n) {
      n.textContent = notificationEnabled ? 'Bildirimler Açık' : 'Bildirimler Kapalı';
      n.setAttribute('aria-pressed',String(notificationEnabled));
      n.classList.toggle('is-enabled',notificationEnabled);
      n.classList.toggle('is-disabled',!notificationEnabled);
    }
    if (s) {
      s.textContent = soundEnabled ? 'Etiket Sesi Açık' : 'Etiket Sesi Kapalı';
      s.setAttribute('aria-pressed',String(soundEnabled));
      s.classList.toggle('is-enabled',soundEnabled);
      s.classList.toggle('is-disabled',!soundEnabled);
    }
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
    if (mentioned && localStorage.getItem('atlantis-chat-sound') === '1') {
      playSound(false,true);
    }

    // Tarayıcı bildirimi sesle karıştırılmaz; bildirim ayarı açıksa yeni mesajlar için
    // yalnızca sekme arka plandayken gösterilir.
    if (
      document.hidden &&
      localStorage.getItem('atlantis-chat-notifications') === '1' &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      new Notification(`Atlantis MC — ${message.username || 'Anonim'}`, {
        body: String(message.message || ''),
        tag: `atlantis-${message.id}`
      });
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

  function toast(text) {
    if (window.atlantisToast) {
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
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(()=>el.classList.remove('show'),2400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();

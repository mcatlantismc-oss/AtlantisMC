/* Atlantis MC — FINAL CHAT FIX
   Anonymous + logged-in messages, reliable loading fallback,
   realtime, presence, typing, profiles, edit/delete.
*/
(() => {
  'use strict';

  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[c]));

  let client = null;
  let currentUser = null;
  let currentProfile = {};
  let chatChannel = null;
  let presenceChannel = null;
  let initialized = false;
  let lastSent = 0;
  let typingTimer = null;
  let lastTypingSent = 0;
  let profileCache = new Map();
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
      client = window.supabase.createClient(
        window.ATLANTIS_SUPABASE.url,
        window.ATLANTIS_SUPABASE.publishableKey,
        { auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'} }
      );
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
    await refreshChat();
    updateComposer();
  }

  async function readIdentity() {
    const { data: { session } } = await client.auth.getSession();
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

  async function refreshChat() {
    await readIdentity();
    await loadMessages();
    subscribeChat();
    subscribePresence();
    setupComposer();
    updateComposer();
    touchLastSeen();
  }

  function bindAuthEvents() {
    window.addEventListener('atlantis-auth-login',() => {
      setTimeout(refreshChat,50);
    });
    window.addEventListener('atlantis-auth-logout',() => {
      currentUser = null;
      currentProfile = {};
      try { chatChannel && client.removeChannel(chatChannel); } catch {}
      try { presenceChannel && client.removeChannel(presenceChannel); } catch {}
      updateComposer();
      loadMessages();
      subscribePresence();
    });
    window.addEventListener('atlantis-profile-updated',event => {
      currentProfile = event.detail?.profile || currentProfile;
      if (currentProfile?.id) profileCache.set(currentProfile.id,currentProfile);
      updateComposer();
      loadMessages();
    });
  }

  async function loadMessages() {
    const box = document.getElementById('chat-messages');
    if (!box) return;

    box.innerHTML = '<div class="chat-empty chat-loading"><span class="loading-pulse"></span> Mesajlar yükleniyor...</div>';

    let result = await client.from('messages')
      .select('id,user_id,username,message,created_at,edited_at,avatar_url')
      .order('created_at',{ascending:true})
      .limit(200);

    /* Fallback for a brief PostgREST schema-cache mismatch. */
    if (result.error) {
      console.warn('[Atlantis Chat] full message select failed:',result.error);
      result = await client.from('messages')
        .select('id,user_id,username,message,created_at')
        .order('created_at',{ascending:true})
        .limit(200);
    }

    if (result.error) {
      console.error('[Atlantis Chat] messages:',result.error);
      const box = document.getElementById('chat-messages');
      if (box) {
        box.innerHTML = `
          <div class="chat-empty chat-error">
            <span>Sohbet mesajları yüklenemedi.</span>
            <button class="chat-retry-button" type="button">Tekrar Dene</button>
          </div>`;
        box.querySelector('.chat-retry-button')?.addEventListener('click', loadMessages);
      }
      return;
    }

    const rows = result.data || [];
    const ids = [...new Set(rows.map(m=>m.user_id).filter(Boolean))];
    await preloadProfiles(ids);

    box.innerHTML = '';
    if (!rows.length) {
      box.innerHTML = '<div class="chat-empty">Henüz mesaj yok. İlk mesajı sen yaz.</div>';
      return;
    }

    rows.forEach((row,index) => addMessage(row,false,index));
    requestAnimationFrame(() => {
      box.scrollTop = box.scrollHeight;
    });
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
    /* Always prefer the current profile avatar over the snapshot stored
       on an older message. This makes profile-photo changes appear on
       existing chat messages after refresh. */
    if (message.user_id) {
      if (message.user_id === currentUser?.id && currentProfile?.avatar_url) {
        return String(currentProfile.avatar_url);
      }
      const current = profileCache.get(message.user_id);
      if (current?.avatar_url) {
        return String(current.avatar_url);
      }
    }
    return String(message.avatar_url || '');
  }

  function formatMentions(text) {
    return esc(text).replace(
      /@([A-Za-zÇĞİÖŞÜçğıöşü0-9]{3,16})/g,
      '<span class="chat-mention">@$1</span>'
    );
  }

  function addMessage(message,animate=true,stagger=0) {
    const box = document.getElementById('chat-messages');
    if (!box || message?.id == null) return;

    const id = `chat-message-${message.id}`;
    if (document.getElementById(id)) return;

    const userId = String(message.user_id || '');
    if (userId && userId !== String(currentUser?.id || '') && blockedUsers.has(userId)) return;

    const name = displayName(message);
    const avatar = avatarUrl(message);
    const initial = name.trim().charAt(0).toLocaleUpperCase('tr-TR') || 'O';
    const date = new Date(message.created_at);
    const time = Number.isNaN(date.getTime()) ? '--:--' :
      date.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});

    const item = document.createElement('article');
    item.id = id;
    item.className = `chat-message chat-message-enter${animate ? '' : ' is-visible'}`;
    item.dataset.userId = userId;
    item.dataset.username = name;

    item.innerHTML = `
      <button type="button" class="chat-avatar chat-avatar-button"
        ${userId ? '' : 'disabled'} aria-label="${esc(name)} profili">
        ${avatar ? `<img src="${esc(avatar)}" alt="">` : `<span>${esc(initial)}</span>`}
      </button>
      <div class="chat-message-body">
        <div class="chat-meta">
          <button type="button" class="chat-user-button" ${userId ? '' : 'disabled'}>${esc(name)}</button>
          ${!userId ? '<span class="chat-guest-badge">Misafir</span>' : ''}
          <time datetime="${esc(message.created_at || '')}">${esc(time)}${message.edited_at ? ' · düzenlendi' : ''}</time>
        </div>
        <p class="chat-message-text">${formatMentions(message.message)}</p>
        ${userId && userId === String(currentUser?.id || '') ? `
          <div class="chat-message-actions">
            <button type="button" data-chat-edit>Düzenle</button>
            <button type="button" data-chat-delete>Sil</button>
          </div>` : ''}
      </div>
    `;

    box.appendChild(item);

    if (userId) {
      item.querySelector('.chat-avatar-button').onclick = () => openUserProfile(userId,name);
      item.querySelector('.chat-user-button').onclick = () => openUserProfile(userId,name);
    }

    item.querySelector('[data-chat-edit]')?.addEventListener('click',()=>editMessage(message));
    item.querySelector('[data-chat-delete]')?.addEventListener('click',()=>deleteMessage(message));

    if (animate) {
      setTimeout(() => {
        requestAnimationFrame(() => item.classList.add('is-visible'));
      }, Math.min(stagger * 18, 280));
      const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 180;
      if (nearBottom) box.scrollTo({top:box.scrollHeight,behavior:'smooth'});
    }
  }

  async function openUserProfile(userId,fallbackName) {
    if (!userId) return;

    let p = profileCache.get(userId);
    if (!p) {
      const { data } = await client.from('profiles')
        .select('id,username,avatar_url,bio,site_role,last_seen,created_at')
        .eq('id',userId)
        .maybeSingle();
      p = data || {id:userId,username:fallbackName};
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
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},payload=>{
        const id = payload.new?.user_id;
        const ready = id ? preloadProfiles([id]) : Promise.resolve();
        ready.then(() => {
          addMessage(payload.new,true);
          if (document.hidden && payload.new?.user_id !== currentUser?.id) notify(payload.new);
        });
      })
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'messages'},payload=>{
        document.getElementById(`chat-message-${payload.new.id}`)?.remove();
        addMessage(payload.new,true);
      })
      .on('postgres_changes',{event:'DELETE',schema:'public',table:'messages'},payload=>{
        const el = document.getElementById(`chat-message-${payload.old.id}`);
        el?.classList.add('chat-message-out');
        setTimeout(()=>el?.remove(),180);
      })
      .on('broadcast',{event:'typing'},payload=>{
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

    presenceChannel = client.channel('atlantis-chat-presence-final',{
      config:{presence:{key}}
    });

    const render = () => {
      const state = presenceChannel.presenceState();
      const keys = new Set();
      Object.values(state).flat().forEach(entry=>{
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
      .subscribe(async status=>{
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({
            presence_key:key,
            user_id:currentUser?.id || null,
            username:name,
            avatar_url:currentProfile.avatar_url || null
          });
          render();
        }
      });
  }

  function setupComposer() {
    const form = document.getElementById('chat-form');
    const input = document.getElementById('chat-input');
    const button = form?.querySelector('button');
    if (!form || !input || form.dataset.atlantisFinalBound === '1') {
      if (form && input && button) updateComposer();
      return;
    }

    form.dataset.atlantisFinalBound = '1';

    input.addEventListener('input',()=>{
      broadcastTyping(true);
      clearTimeout(typingTimer);
      typingTimer = setTimeout(()=>broadcastTyping(false),900);
    });

    input.addEventListener('blur',()=>broadcastTyping(false));

    form.onsubmit = async event => {
      event.preventDefault();

      const text = input.value.trim();
      if (!text) return;
      if (text.length > 300) {
        toast('Mesaj en fazla 300 karakter olabilir.');
        return;
      }

      const remaining = 3000 - (Date.now() - lastSent);
      if (remaining > 0) {
        toast(`Yeni mesaj için ${Math.ceil(remaining / 1000)} saniye bekle.`);
        return;
      }

      button.disabled = true;
      const oldText = button.textContent;
      button.textContent = 'Gönderiliyor...';

      try {
        let result;

        if (currentUser) {
          result = await client.rpc('send_chat_message',{p_message:text});
        } else {
          result = await client.rpc('send_anonymous_chat_message',{p_message:text});

          /* Fallback if PostgREST still has the new RPC cached incorrectly. */
          if (result.error && String(result.error.message || '').toLowerCase().includes('schema cache')) {
            result = await client.from('messages').insert({
              user_id:null,
              username:'Anonim',
              message:text,
              avatar_url:null
            });
          }
        }

        if (result.error) throw result.error;

        input.value = '';
        lastSent = Date.now();
        broadcastTyping(false);

        /* Do not depend on realtime for the sender's own UI. */
        await loadMessages();
      } catch (error) {
        console.error('[Atlantis Chat] send:',error);
        toast(error?.message || 'Mesaj gönderilemedi.');
      } finally {
        button.disabled = false;
        button.textContent = oldText;
      }
    };
  }

  function updateComposer() {
    const input = document.getElementById('chat-input');
    const button = document.querySelector('#chat-form button');
    if (!input) return;

    const muted = currentProfile?.muted_until &&
      new Date(currentProfile.muted_until) > new Date();

    input.disabled = !!muted;
    if (button) button.disabled = !!muted;
    input.placeholder = muted
      ? 'Sohbet kullanımın geçici olarak kısıtlandı.'
      : currentUser
        ? 'Mesajını yaz...'
        : 'Anonim olarak mesajını yaz...';
  }

  async function broadcastTyping(typing) {
    if (!chatChannel) return;

    const now = Date.now();
    if (typing && now - lastTypingSent < 700) return;
    lastTypingSent = now;

    try {
      await chatChannel.send({
        type:'broadcast',
        event:'typing',
        payload:{
          presence_key:presenceKey(),
          username:currentUser
            ? String(currentProfile.username || currentUser.user_metadata?.username || 'Oyuncu')
            : 'Anonim',
          typing:!!typing
        }
      });
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

  async function editMessage(message) {
    if (!currentUser) return;
    const next = prompt('Mesajını düzenle:',String(message.message || ''));
    if (next === null) return;

    const clean = next.trim();
    if (!clean || clean.length > 300) {
      toast('Mesaj 1–300 karakter olmalı.');
      return;
    }

    const { error } = await client.from('messages')
      .update({message:clean,edited_at:new Date().toISOString()})
      .eq('id',message.id)
      .eq('user_id',currentUser.id);

    if (error) toast(error.message || 'Mesaj düzenlenemedi.');
    else await loadMessages();
  }

  async function deleteMessage(message) {
    if (!currentUser) return;
    if (!confirm('Bu mesajı silmek istediğine emin misin?')) return;

    const { error } = await client.from('messages')
      .delete()
      .eq('id',message.id)
      .eq('user_id',currentUser.id);

    if (error) toast(error.message || 'Mesaj silinemedi.');
    else await loadMessages();
  }

  function setupNotificationControls() {
    const head = document.querySelector('.chat-head');
    if (!head || document.getElementById('chat-tools')) return;

    const tools = document.createElement('div');
    tools.id = 'chat-tools';
    tools.className = 'chat-tools';
    tools.innerHTML = `
      <button id="chat-notify" class="ghost-button" type="button">Bildirimleri Aç</button>
      <button id="chat-sound" class="ghost-button" type="button">Ses Aç</button>`;
    head.appendChild(tools);

    document.getElementById('chat-notify').onclick = async () => {
      if (!('Notification' in window)) {
        toast('Bu tarayıcı bildirimleri desteklemiyor.');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        localStorage.setItem('atlantis-chat-notifications','1');
        toast('Bildirimler açıldı.');
      }
      updateNotificationControls();
    };

    document.getElementById('chat-sound').onclick = () => {
      localStorage.setItem('atlantis-chat-sound','1');
      playSound(true);
      updateNotificationControls();
    };

    updateNotificationControls();
  }

  function updateNotificationControls() {
    const n = document.getElementById('chat-notify');
    const s = document.getElementById('chat-sound');
    if (n) n.textContent = ('Notification' in window && Notification.permission === 'granted') ? 'Bildirimler Açık' : 'Bildirimleri Aç';
    if (s) s.textContent = localStorage.getItem('atlantis-chat-sound') === '1' ? 'Ses Açık' : 'Ses Aç';
  }

  let audioContext = null;
  function playSound(gesture) {
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended' && gesture) audioContext.resume();
      if (audioContext.state !== 'running') return;
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(.0001,audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(.04,audioContext.currentTime+.01);
      gain.gain.exponentialRampToValueAtTime(.0001,audioContext.currentTime+.12);
      osc.connect(gain); gain.connect(audioContext.destination);
      osc.start(); osc.stop(audioContext.currentTime+.13);
    } catch {}
  }

  function notify(message) {
    if (localStorage.getItem('atlantis-chat-sound') === '1') playSound(false);
    if (
      document.hidden &&
      localStorage.getItem('atlantis-chat-notifications') === '1' &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      new Notification(`Atlantis MC — ${message.username || 'Anonim'}`,{
        body:String(message.message || ''),
        tag:`atlantis-${message.id}`
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

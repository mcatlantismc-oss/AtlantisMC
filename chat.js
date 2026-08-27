/* Atlantis MC — FINAL chat.js
   Public anonymous chat + authenticated nicknames/profiles + realtime +
   message edit/delete for authenticated authors.
*/
(() => {
  'use strict';

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

  let client = null;
  let currentUser = null;
  let currentProfile = null;
  let chatChannel = null;
  let presenceChannel = null;
  let typingTimer = null;
  let lastTypingSent = 0;
  let lastSentAt = 0;
  let notificationSound = false;
  let chatInitialized = false;
  let presenceKey = '';

  function anonymousKey() {
    const key = 'atlantis-anon-presence-key';

    let value = localStorage.getItem(key);

    if (!value) {
      const random =
        crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      value = `anon-${random}`;
      localStorage.setItem(key, value);
    }

    return value;
  }

  function escapeJson(value) {
    return esc(value);
  }

  async function init() {
    if (chatInitialized) return;
    chatInitialized = true;

    const box = document.getElementById('chat-messages');
    const form = document.getElementById('chat-form');
    const input = document.getElementById('chat-input');

    if (!box || !form || !input) return;

    client = await window.atlantisGetClient?.();

    if (!client) {
      renderChatError(box, 'Sohbet bağlantısı kurulamadı.');
      return;
    }

    const { data: sessionData } =
      await client.auth.getSession();

    currentUser = sessionData?.session?.user || null;

    if (currentUser) {
      const { data: profile } =
        await client
          .from('profiles')
          .select('*')
          .eq('id', currentUser.id)
          .maybeSingle();

      currentProfile = profile || {};
    }

    setupToolbar();
    setupComposer(form, input);
    setupAuthReactions();

    await loadMessages();
    subscribeRealtime();
    subscribePresence();

    updateComposerForCurrentUser();
    await touchLastSeen();

    window.setInterval(
      () => {
        touchLastSeen();
      },
      60000
    );
  }

  function renderChatError(box, message) {
    box.innerHTML =
      `<div class="chat-empty">${esc(message)}</div>`;
  }

  function setupAuthReactions() {
    window.addEventListener(
      'atlantis-auth-login',
      async event => {
        currentUser = event.detail?.user || null;

        if (currentUser) {
          const { data: profile } =
            await client
              .from('profiles')
              .select('*')
              .eq('id', currentUser.id)
              .maybeSingle();

          currentProfile = profile || {};
        }

        updateComposerForCurrentUser();
        await touchLastSeen();
      }
    );

    window.addEventListener(
      'atlantis-auth-logout',
      () => {
        currentUser = null;
        currentProfile = null;
        updateComposerForCurrentUser();
      }
    );
  }

  function setupToolbar() {
    const head = document.querySelector('.chat-head');
    if (!head || document.getElementById('chat-tools')) return;

    const tools = document.createElement('div');
    tools.id = 'chat-tools';
    tools.className = 'chat-tools';

    tools.innerHTML = `
      <button id="chat-notify" class="ghost-button" type="button">
        Bildirimler
      </button>
      <button id="chat-sound" class="ghost-button" type="button">
        Ses
      </button>
    `;

    head.appendChild(tools);

    document.getElementById('chat-notify').onclick =
      async () => {
        if (!('Notification' in window)) {
          toast('Bu tarayıcı bildirimleri desteklemiyor.');
          return;
        }

        const permission =
          await Notification.requestPermission();

        if (permission === 'granted') {
          localStorage.setItem(
            'atlantis-chat-notifications',
            '1'
          );
          toast('Bildirimler açıldı.');
        } else {
          toast('Bildirim izni verilmedi.');
        }
      };

    document.getElementById('chat-sound').onclick =
      () => {
        notificationSound = !notificationSound;

        localStorage.setItem(
          'atlantis-chat-sound',
          notificationSound ? '1' : '0'
        );

        updateToolbarText();

        if (notificationSound) {
          playSound(true);
          toast('Mesaj sesi açıldı.');
        }
      };

    notificationSound =
      localStorage.getItem('atlantis-chat-sound') === '1';

    updateToolbarText();
  }

  function updateToolbarText() {
    const notify = document.getElementById('chat-notify');
    const sound = document.getElementById('chat-sound');

    if (notify) {
      notify.textContent =
        'Notification' in window &&
        Notification.permission === 'granted'
          ? 'Bildirimler Açık'
          : 'Bildirimleri Aç';
    }

    if (sound) {
      sound.textContent =
        notificationSound
          ? 'Ses Açık'
          : 'Ses Aç';
    }
  }

  function setupComposer(form, input) {
    form.onsubmit = async event => {
      event.preventDefault();

      const text = input.value.trim();

      if (!text) return;

      if (text.length > 300) {
        toast('Mesaj en fazla 300 karakter olabilir.');
        return;
      }

      const now = Date.now();

      if (now - lastSentAt < 3000) {
        toast(
          `Yeni mesaj için ${Math.ceil(
            (3000 - (now - lastSentAt)) / 1000
          )} saniye bekle.`
        );
        return;
      }

      const button =
        form.querySelector('button[type="submit"]');

      if (button) {
        button.disabled = true;
        button.textContent = 'Gönderiliyor...';
      }

      try {
        if (currentUser) {
          const { data, error } =
            await client.rpc(
              'send_chat_message',
              {
                p_message: text
              }
            );

          if (error) throw error;

          if (data?.muted_until) {
            disableComposer(
              'Sohbet kullanımın geçici olarak kısıtlandı.'
            );
          }
        } else {
          // Public RPC: server assigns "Anonim" and null user_id.
          const { error } =
            await client.rpc(
              'send_anonymous_chat_message',
              {
                p_message: text
              }
            );

          if (error) throw error;
        }

        input.value = '';
        lastSentAt = Date.now();
        broadcastTyping(false);
      } catch (error) {
        console.error('[Atlantis Chat] send:', error);
        toast(
          error?.message ||
          'Mesaj gönderilemedi.'
        );
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = 'Gönder';
        }
      }
    };

    input.addEventListener('input', () => {
      broadcastTyping(true);

      clearTimeout(typingTimer);

      typingTimer =
        setTimeout(
          () => broadcastTyping(false),
          900
        );
    });

    input.addEventListener(
      'blur',
      () => broadcastTyping(false)
    );

    updateComposerForCurrentUser();
  }

  function updateComposerForCurrentUser() {
    const input = document.getElementById('chat-input');
    const button =
      document.querySelector('#chat-form button');

    if (!input) return;

    // Anonymous chat is intentionally enabled.
    input.disabled = false;

    if (button) {
      button.disabled = false;
    }

    input.placeholder =
      currentUser
        ? 'Mesajını yaz...'
        : 'Anonim olarak mesajını yaz...';
  }

  function disableComposer(text) {
    const input = document.getElementById('chat-input');
    const button =
      document.querySelector('#chat-form button');

    if (input) {
      input.disabled = true;
      input.placeholder = text;
    }

    if (button) button.disabled = true;
  }

  async function loadMessages() {
    const box = document.getElementById('chat-messages');
    if (!box) return;

    const { data, error } =
      await client
        .from('messages')
        .select(
          'id,user_id,username,message,created_at,edited_at,avatar_url'
        )
        .order(
          'created_at',
          { ascending: true }
        )
        .limit(150);

    if (error) {
      renderChatError(
        box,
        'Sohbet mesajları alınamadı.'
      );
      console.error('[Atlantis Chat] load:', error);
      return;
    }

    box.innerHTML = '';

    (data || []).forEach(renderMessage);

    box.scrollTop = box.scrollHeight;
  }

  function renderMessage(message) {
    const box =
      document.getElementById('chat-messages');

    if (!box) return;

    const id =
      `chat-message-${message.id}`;

    if (document.getElementById(id)) return;

    const anonymous =
      !message.user_id ||
      message.username === 'Anonim';

    const username =
      anonymous
        ? 'Anonim'
        : (
            message.username ||
            'Oyuncu'
          );

    const time =
      new Date(message.created_at);

    const dateText =
      Number.isNaN(time.getTime())
        ? ''
        : time.toLocaleTimeString(
            'tr-TR',
            {
              hour: '2-digit',
              minute: '2-digit'
            }
          );

    const initial =
      anonymous
        ? 'A'
        : (
            username
              .charAt(0)
              .toLocaleUpperCase('tr-TR') ||
            'O'
          );

    const article =
      document.createElement('article');

    article.className =
      'chat-message';

    article.id = id;

    article.dataset.userId =
      message.user_id || '';

    article.innerHTML = `
      <button
        type="button"
        class="chat-avatar chat-avatar-button"
        ${anonymous ? 'disabled' : ''}
        aria-label="${anonymous ? 'Anonim kullanıcı' : 'Profili görüntüle'}"
      >
        ${
          message.avatar_url && !anonymous
            ? `<img src="${escapeJson(message.avatar_url)}" alt="">`
            : `<span>${esc(initial)}</span>`
        }
      </button>

      <div class="chat-message-body">
        <div class="chat-meta">
          ${
            anonymous
              ? `<span class="chat-user-anonymous">Anonim</span>`
              : `<button class="chat-user-button" type="button">${esc(username)}</button>`
          }
          <time>${esc(dateText)}</time>
          ${
            message.edited_at
              ? `<span class="chat-edited">düzenlendi</span>`
              : ''
          }
        </div>

        <p class="chat-message-text">${esc(message.message)}</p>

        ${
          currentUser &&
          message.user_id === currentUser.id
            ? `
              <div class="chat-message-actions">
                <button type="button" data-chat-edit>Düzenle</button>
                <button type="button" data-chat-delete>Sil</button>
              </div>
            `
            : ''
        }
      </div>
    `;

    box.appendChild(article);

    if (
      !anonymous &&
      message.user_id
    ) {
      article
        .querySelector('.chat-avatar-button')
        ?.addEventListener(
          'click',
          () => openProfile(
            message.user_id,
            username
          )
        );

      article
        .querySelector('.chat-user-button')
        ?.addEventListener(
          'click',
          () => openProfile(
            message.user_id,
            username
          )
        );
    }

    article
      .querySelector('[data-chat-edit]')
      ?.addEventListener(
        'click',
        () => editMessage(message)
      );

    article
      .querySelector('[data-chat-delete]')
      ?.addEventListener(
        'click',
        () => deleteMessage(message)
      );

    if (
      currentUser &&
      message.user_id &&
      message.user_id !== currentUser.id
    ) {
      maybeNotify(message);
    }
  }

  async function openProfile(
    userId,
    fallbackUsername
  ) {
    if (!userId) return;

    const { data: profile } =
      await client
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

    if (!profile) {
      toast(`${fallbackUsername || 'Kullanıcı'} profili bulunamadı.`);
      return;
    }

    if (
      window.openAtlantisProfileCard
    ) {
      window.openAtlantisProfileCard(
        profile,
        null,
        false
      );
      return;
    }

    showLocalProfile(profile);
  }

  function showLocalProfile(profile) {
    const old =
      document.getElementById('chat-profile-modal');

    if (old) old.remove();

    const overlay =
      document.createElement('div');

    overlay.id =
      'chat-profile-modal';

    overlay.className =
      'auth-modal';

    overlay.innerHTML = `
      <div class="auth-backdrop"></div>
      <section class="auth-dialog">
        <button class="auth-close" type="button">×</button>

        <div class="account-info-profile">
          ${
            profile.avatar_url
              ? `<img src="${esc(profile.avatar_url)}" alt="" style="width:88px;height:88px;border-radius:50%;object-fit:cover;">`
              : `<span class="profile-fallback-large">${
                  esc(
                    (profile.username || 'O')
                      .charAt(0)
                      .toLocaleUpperCase('tr-TR')
                  )
                }</span>`
          }

          <h2>${esc(profile.username || 'Oyuncu')}</h2>

          <span class="role-chip role-${esc(profile.site_role || 'user')}">
            ${esc(profile.site_role === 'admin'
              ? 'Yönetici'
              : profile.site_role === 'moderator'
                ? 'Moderatör'
                : 'Oyuncu')}
          </span>
        </div>

        <div class="atlantis-profile-bio">
          ${esc(profile.bio || 'Henüz açıklama eklenmemiş.')}
        </div>

        <div class="account-status-card">
          <span>Durum</span>
          <strong>${esc(
            profile.last_seen &&
            Date.now() - new Date(profile.last_seen).getTime() < 5 * 60 * 1000
              ? 'Çevrimiçi'
              : 'Çevrimdışı'
          )}</strong>
        </div>
      </section>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('.auth-close').onclick =
      () => overlay.remove();

    overlay.querySelector('.auth-backdrop').onclick =
      () => overlay.remove();
  }

  function subscribeRealtime() {
    if (chatChannel) {
      chatChannel.unsubscribe();
    }

    chatChannel =
      client
        .channel('atlantis-chat-public')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages'
          },
          payload => renderMessage(payload.new)
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'messages'
          },
          payload => {
            document
              .getElementById(
                `chat-message-${payload.new.id}`
              )
              ?.remove();

            renderMessage(payload.new);
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'DELETE',
            schema: 'public',
            table: 'messages'
          },
          payload => {
            document
              .getElementById(
                `chat-message-${payload.old.id}`
              )
              ?.remove();
          }
        )
        .on(
          'broadcast',
          { event: 'typing' },
          payload => {
            const sender =
              payload.payload;

            if (
              sender?.key === presenceKey
            ) {
              return;
            }

            if (sender?.typing) {
              showTyping(
                sender.username || 'Anonim'
              );
            } else {
              hideTyping();
            }
          }
        )
        .subscribe();
  }

  function subscribePresence() {
    if (presenceChannel) {
      presenceChannel.unsubscribe();
    }

    presenceKey =
      currentUser?.id ||
      anonymousKey();

    const username =
      currentUser
        ? (
            currentProfile?.username ||
            currentUser.user_metadata?.username ||
            'Oyuncu'
          )
        : 'Anonim';

    presenceChannel =
      client.channel(
        'atlantis-chat-presence',
        {
          config: {
            presence: {
              key: presenceKey
            }
          }
        }
      );

    const render = () => {
      const state =
        presenceChannel.presenceState();

      const names = new Set();

      Object.values(state)
        .flat()
        .forEach(entry => {
          names.add(
            entry?.username ||
            'Anonim'
          );
        });

      const count =
        document.getElementById(
          'online-count'
        );

      if (count) {
        count.textContent =
          `${names.size} kişi sohbeti açık`;
      }
    };

    presenceChannel
      .on(
        'presence',
        { event: 'sync' },
        render
      )
      .on(
        'presence',
        { event: 'join' },
        render
      )
      .on(
        'presence',
        { event: 'leave' },
        render
      )
      .subscribe(
        async status => {
          if (
            status === 'SUBSCRIBED'
          ) {
            await presenceChannel.track({
              username,
              key: presenceKey
            });

            render();
          }
        }
      );
  }

  async function broadcastTyping(
    typing
  ) {
    const now = Date.now();

    if (
      typing &&
      now - lastTypingSent < 650
    ) {
      return;
    }

    lastTypingSent = now;

    try {
      await chatChannel?.send({
        type: 'broadcast',
        event: 'typing',
        payload: {
          key: presenceKey,
          username: currentUser
            ? (
                currentProfile?.username ||
                currentUser.user_metadata?.username ||
                'Oyuncu'
              )
            : 'Anonim',
          typing
        }
      });
    } catch {
      // Typing indicator is optional.
    }
  }

  function showTyping(name) {
    let el =
      document.getElementById(
        'chat-typing'
      );

    if (!el) {
      const panel =
        document.querySelector('.chat-panel');

      if (!panel) return;

      el =
        document.createElement('div');

      el.id =
        'chat-typing';

      el.className =
        'chat-typing';

      panel.insertBefore(
        el,
        document.getElementById('chat-form')
      );
    }

    el.innerHTML =
      `<span>${esc(name)} yazıyor</span><i></i><i></i><i></i>`;
  }

  function hideTyping() {
    const el =
      document.getElementById(
        'chat-typing'
      );

    if (el) el.textContent = '';
  }

  async function editMessage(message) {
    if (!currentUser) {
      toast('Düzenlemek için giriş yapmalısın.');
      return;
    }

    const next =
      window.prompt(
        'Mesajını düzenle:',
        message.message
      );

    if (next === null) return;

    const value = next.trim();

    if (!value || value.length > 300) {
      toast('Mesaj 1-300 karakter olmalı.');
      return;
    }

    const { error } =
      await client
        .from('messages')
        .update({
          message: value,
          edited_at: new Date().toISOString()
        })
        .eq('id', message.id)
        .eq('user_id', currentUser.id);

    if (error) {
      toast(error.message || 'Mesaj düzenlenemedi.');
    }
  }

  async function deleteMessage(message) {
    if (!currentUser) return;

    if (
      !window.confirm(
        'Bu mesajı silmek istediğine emin misin?'
      )
    ) {
      return;
    }

    const { error } =
      await client
        .from('messages')
        .delete()
        .eq('id', message.id)
        .eq('user_id', currentUser.id);

    if (error) {
      toast(error.message || 'Mesaj silinemedi.');
      return;
    }

    document
      .getElementById(
        `chat-message-${message.id}`
      )
      ?.remove();
  }

  async function touchLastSeen() {
    if (!currentUser || !client) return;

    try {
      await client.rpc(
        'touch_my_last_seen'
      );
    } catch {
      // Non-critical.
    }
  }

  function maybeNotify(message) {
    if (
      !document.hidden
    ) {
      if (notificationSound) {
        playSound(false);
      }
      return;
    }

    if (
      localStorage.getItem(
        'atlantis-chat-notifications'
      ) === '1' &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      const n =
        new Notification(
          `Atlantis MC — ${message.username || 'Anonim'}`,
          {
            body: message.message,
            tag: `atlantis-message-${message.id}`
          }
        );

      n.onclick = () => {
        window.focus();
        n.close();
      };
    }

    if (notificationSound) {
      playSound(false);
    }
  }

  let audioContext = null;

  function playSound(fromGesture) {
    try {
      if (!audioContext) {
        audioContext =
          new (
            window.AudioContext ||
            window.webkitAudioContext
          )();
      }

      if (
        audioContext.state === 'suspended' &&
        fromGesture
      ) {
        audioContext.resume();
      }

      if (
        audioContext.state !== 'running'
      ) {
        return;
      }

      const osc =
        audioContext.createOscillator();

      const gain =
        audioContext.createGain();

      osc.type = 'sine';
      osc.frequency.value = 880;

      gain.gain.setValueAtTime(
        0.0001,
        audioContext.currentTime
      );

      gain.gain.exponentialRampToValueAtTime(
        0.045,
        audioContext.currentTime + 0.01
      );

      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        audioContext.currentTime + 0.12
      );

      osc.connect(gain);
      gain.connect(
        audioContext.destination
      );

      osc.start();

      osc.stop(
        audioContext.currentTime + 0.13
      );
    } catch {
      // Non-critical.
    }
  }

  function toast(text) {
    let el =
      document.getElementById(
        'chat-toast'
      );

    if (!el) {
      el =
        document.createElement(
          'div'
        );

      el.id =
        'chat-toast';

      el.className =
        'chat-toast';

      document.body.appendChild(el);
    }

    el.textContent = text;

    el.classList.add('show');

    clearTimeout(el._timer);

    el._timer =
      setTimeout(
        () =>
          el.classList.remove('show'),
        2200
      );
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      init,
      { once: true }
    );
  } else {
    init();
  }
})();

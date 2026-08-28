/* AtlantisMC — Sosyal profil özellikleri
 * Favori arkadaş + kişisel not + kullanıcı engelleme.
 *
 * Bu dosya mevcut chat.js'e bağımlı olmadan çalışacak şekilde yazılmıştır.
 * sohbet.html içinde chat.js'den SONRA yükleyebilirsin:
 * <script src="atlantis-social-features.js?v=20260828"></script>
 *
 * Güvenlik: kişisel not/favori/engelleme verilerinin gerçek gizliliği
 * Supabase RLS ile sağlanır. RLS SQL dosyasını da çalıştırmadan production'a alma.
 */
(() => {
  'use strict';

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[ch]));

  const MUTE_OPTIONS = [
    {value:0,label:'Susturmayı kaldır'},
    {value:300,label:'5 dakika'}, {value:600,label:'10 dakika'}, {value:1200,label:'20 dakika'},
    {value:1800,label:'30 dakika'}, {value:2700,label:'45 dakika'}, {value:3600,label:'1 saat'},
    {value:7200,label:'2 saat'}, {value:10800,label:'3 saat'}, {value:86400,label:'1 gün'},
    {value:259200,label:'3 gün'}, {value:432000,label:'5 gün'}, {value:-1,label:'Kalıcı'}
  ];

  const canModerateTarget = (myRole,targetRole) => {
    if (!['admin','moderator'].includes(String(myRole || ''))) return false;
    if (String(targetRole || 'user') === 'admin') return false;
    if (String(myRole) === 'moderator' && String(targetRole || 'user') === 'moderator') return false;
    return true;
  };

  const toast = (message) => {
    let el = document.getElementById('atlantis-social-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'atlantis-social-toast';
      el.className = 'atlantis-social-toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('is-visible'), 2200);
  };

  async function getClient() {
    try {
      if (window.atlantisSupabase?.auth) return window.atlantisSupabase;
      if (typeof window.atlantisGetClient === 'function') {
        const resolved = await window.atlantisGetClient();
        if (resolved?.auth) { window.atlantisSupabase = resolved; return resolved; }
      }
      if (window.atlantisAuthReady) {
        const resolved = await window.atlantisAuthReady;
        if (resolved?.auth) { window.atlantisSupabase = resolved; return resolved; }
      }
    } catch (error) {
      console.error('[Atlantis Social] Supabase client:', error);
    }
    return null;
  }

  async function getCurrentUser(client) {
    const { data: { session } } = await client.auth.getSession();
    return session?.user || null;
  }

  async function fetchProfile(client, userId, fallbackName='Oyuncu') {
    const full = await client
      .from('profiles')
      .select('id,username,avatar_url,bio,site_role,last_seen,created_at,muted_until')
      .eq('id', userId)
      .maybeSingle();
    if (!full.error) return full.data || { id:userId, username:fallbackName, avatar_url:null, bio:'', site_role:'user' };

    console.warn('[Atlantis Social] profile fallback:', full.error);
    const fallback = await client
      .from('profiles')
      .select('id,username,avatar_url,bio,site_role,last_seen,created_at')
      .eq('id', userId)
      .maybeSingle();
    return fallback.data || { id:userId, username:fallbackName, avatar_url:null, bio:'', site_role:'user' };
  }

  async function getState(client, me, targetId) {
    const [favRes, noteRes, blockRes] = await Promise.all([
      client.from('user_favorites').select('favorite_user_id').eq('user_id', me.id).eq('favorite_user_id', targetId).maybeSingle(),
      client.from('user_private_notes').select('note').eq('user_id', me.id).eq('target_user_id', targetId).maybeSingle(),
      client.from('user_blocks').select('blocked_user_id').eq('user_id', me.id).eq('blocked_user_id', targetId).maybeSingle()
    ]);
    const firstError = favRes.error || noteRes.error || blockRes.error;
    if (firstError) console.warn('[Atlantis Social] state query:', firstError);
    return {
      favorite: !!favRes.data,
      note: noteRes.data?.note || '',
      blocked: !!blockRes.data
    };
  }

  async function toggleFavorite(client, me, targetId, active) {
    if (active) {
      const { error } = await client.from('user_favorites')
        .delete()
        .eq('user_id', me.id)
        .eq('favorite_user_id', targetId);
      if (error) throw error;
      return false;
    }

    const { error } = await client.from('user_favorites')
      .insert({ user_id:me.id, favorite_user_id:targetId });
    if (error) throw error;
    return true;
  }

  async function saveNote(client, me, targetId, note) {
    const clean = String(note || '').trim();
    if (clean.length > 500) throw new Error('Kişisel not en fazla 500 karakter olabilir.');

    if (!clean) {
      const { error } = await client.from('user_private_notes')
        .delete()
        .eq('user_id', me.id)
        .eq('target_user_id', targetId);
      if (error) throw error;
      return;
    }

    const { error } = await client.from('user_private_notes')
      .upsert({
        user_id:me.id,
        target_user_id:targetId,
        note:clean,
        updated_at:new Date().toISOString()
      }, { onConflict:'user_id,target_user_id' });

    if (error) throw error;
  }

  async function setMute(client, me, targetId, seconds) {
    const { error } = await client.rpc('moderation_set_mute', {
      target_user_id: targetId,
      duration_seconds: seconds
    });
    if (error) throw error;
    return seconds;
  }

  async function toggleBlock(client, me, targetId, active) {
    if (active) {
      const { error } = await client.from('user_blocks')
        .delete()
        .eq('user_id', me.id)
        .eq('blocked_user_id', targetId);
      if (error) throw error;
      return false;
    }

    const { error } = await client.from('user_blocks')
      .insert({ user_id:me.id, blocked_user_id:targetId });
    if (error) throw error;
    return true;
  }

  function applyBlockedMessages(targetId, hidden) {
    document.querySelectorAll('.chat-message').forEach((item) => {
      if (String(item.dataset.userId || '') !== String(targetId)) return;
      item.style.display = hidden ? 'none' : '';
    });
  }

  function renderOverlay(profile, state, me, client) {
    if (!client?.auth || !me?.id || !profile?.id) return toast('Profil bağlantısı hazır değil.');
    document.getElementById('atlantis-social-profile')?.remove();

    const role = profile.site_role || 'user';
    const roleLabel = role === 'admin' ? 'Yönetici' : role === 'moderator' ? 'Moderatör' : 'Oyuncu';
    const avatar = profile.avatar_url
      ? `<img src="${esc(profile.avatar_url)}" alt="" class="atlantis-social-avatar-img">`
      : `<span>${esc(String(profile.username || 'O').trim().charAt(0).toLocaleUpperCase('tr-TR') || 'O')}</span>`;

    const overlay = document.createElement('div');
    overlay.id = 'atlantis-social-profile';
    overlay.className = 'atlantis-social-overlay';
    overlay.innerHTML = `
      <section class="atlantis-social-card" role="dialog" aria-modal="true">
        <button type="button" class="atlantis-social-close" aria-label="Profili kapat">×</button>

        <div class="atlantis-social-hero">
          <div class="atlantis-social-avatar">${avatar}</div>
          <div class="atlantis-social-title">
            <span class="atlantis-social-kicker">OYUNCU PROFİLİ</span>
            <h2>${esc(profile.username || 'Oyuncu')}</h2>
            <span class="atlantis-social-role role-${esc(role)}">${esc(roleLabel)}</span>
          </div>
        </div>

        <div class="atlantis-social-status">
          <span>SON AKTİF</span>
          <strong>${profile.last_seen ? new Date(profile.last_seen).toLocaleString('tr-TR',{dateStyle:'medium',timeStyle:'short'}) : 'Bilinmiyor'}</strong>
        </div>

        <div class="atlantis-social-bio">
          <span>HAKKINDA</span>
          <p>${esc(profile.bio || 'Henüz bir açıklama eklenmemiş.')}</p>
        </div>

        <div class="atlantis-social-actions">
          <button type="button" id="atlantis-favorite-btn" class="atlantis-social-action">
            <span>${state.favorite ? '★' : '☆'}</span>
            <b>${state.favorite ? 'Favorilerden çıkar' : 'Favori arkadaş yap'}</b>
            <small>${state.favorite ? 'Sohbette adının yanında yıldız görünür.' : 'Sadece senin favori listen.'}</small>
          </button>

          <div class="atlantis-social-note-wrap">
            <label for="atlantis-private-note">📝 Kişisel Not</label>
            <textarea id="atlantis-private-note" maxlength="500" placeholder="Sadece sen görebilirsin...">${esc(state.note)}</textarea>
            <small>Bu notu yalnızca sen görebilirsin.</small>
            <button type="button" id="atlantis-save-note" class="atlantis-social-small">Notu kaydet</button>
          </div>

          <button type="button" id="atlantis-block-btn" class="atlantis-social-action atlantis-social-danger">
            <span>🚫</span>
            <b>${state.blocked ? 'Engeli kaldır' : 'Kullanıcıyı engelle'}</b>
            <small>${state.blocked ? 'Bu kişinin mesajları tekrar görünür.' : 'Engellediğinde bu kişinin sohbet mesajlarını sen görmezsin.'}</small>
          </button>

          ${canModerateTarget(profile._myRole || '', role) ? `
            <div class="atlantis-social-note-wrap atlantis-social-moderation-wrap">
              <label for="atlantis-profile-mute">🛡️ Moderasyon · Susturma</label>
              <div class="atlantis-social-mute-row">
                <select id="atlantis-profile-mute">${MUTE_OPTIONS.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}</select>
                <input id="atlantis-profile-mute-custom" type="number" min="1" step="1" placeholder="Özel dakika" aria-label="Özel susturma süresi dakika">
                <button type="button" id="atlantis-profile-mute-apply" class="atlantis-social-small">Uygula</button>
              </div>
              <small>Moderatörler başka moderatörleri/yöneticileri susturamaz. Yöneticiler moderatörleri susturabilir.</small>
            </div>` : ''}
        </div>

        <button type="button" class="atlantis-social-closewide">✓ Profili Kapat</button>
      </section>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('is-visible'));

    const close = () => {
      overlay.classList.remove('is-visible');
      setTimeout(() => overlay.remove(), 120);
    };

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    overlay.querySelector('.atlantis-social-close')?.addEventListener('click', close);
    overlay.querySelector('.atlantis-social-closewide')?.addEventListener('click', close);

    overlay.querySelector('#atlantis-favorite-btn')?.addEventListener('click', async () => {
      try {
        const next = await toggleFavorite(client, me, profile.id, state.favorite);
        state.favorite = next;
        const btn = overlay.querySelector('#atlantis-favorite-btn');
        if (btn) {
          btn.querySelector('span').textContent = next ? '★' : '☆';
          btn.querySelector('b').textContent = next ? 'Favorilerden çıkar' : 'Favori arkadaş yap';
        }
        toast(next ? '⭐ Favorilere eklendi.' : 'Favorilerden çıkarıldı.');
        window.dispatchEvent(new CustomEvent('atlantis-favorite-changed', {detail:{userId:profile.id, favorite:next}}));
      } catch (error) {
        toast(`Favori işlemi tamamlanamadı${error?.message ? ': ' + error.message : '.'}`);
        console.error(error);
      }
    });

    overlay.querySelector('#atlantis-save-note')?.addEventListener('click', async () => {
      try {
        const note = overlay.querySelector('#atlantis-private-note')?.value || '';
        await saveNote(client, me, profile.id, note);
        state.note = note.trim();
        toast('📝 Kişisel not kaydedildi.');
      } catch (error) {
        toast(error?.message || 'Kişisel not kaydedilemedi.');
        console.error(error);
      }
    });

    overlay.querySelector('#atlantis-block-btn')?.addEventListener('click', async () => {
      try {
        const next = await toggleBlock(client, me, profile.id, state.blocked);
        state.blocked = next;
        applyBlockedMessages(profile.id, next);
        const btn = overlay.querySelector('#atlantis-block-btn');
        if (btn) {
          btn.querySelector('b').textContent = next ? 'Engeli kaldır' : 'Kullanıcıyı engelle';
          btn.querySelector('small').textContent = next
            ? 'Bu kişinin mesajları tekrar görünür.'
            : 'Engellediğinde bu kişinin sohbet mesajlarını sen görmezsin.';
        }
        toast(next ? '🚫 Kullanıcı engellendi.' : 'Kullanıcının engeli kaldırıldı.');
        if (typeof window.atlantisReloadChat === 'function') window.atlantisReloadChat();
      } catch (error) {
        toast(`Engelleme kaydedilemedi${error?.message ? ': ' + error.message : '.'}`);
        console.error(error);
      }
    });

    overlay.querySelector('#atlantis-profile-mute-apply')?.addEventListener('click', async () => {
      const myRole = String(profile._myRole || 'user');
      if (!canModerateTarget(myRole, role)) {
        toast('Bu kullanıcıya susturma uygulayamazsın.');
        return;
      }
      try {
        const selected = Number(overlay.querySelector('#atlantis-profile-mute')?.value ?? 0);
        const customMinutes = Number(overlay.querySelector('#atlantis-profile-mute-custom')?.value ?? 0);
        const seconds = customMinutes > 0 ? Math.floor(customMinutes * 60) : selected;
        if (!Number.isFinite(seconds) || seconds < -1) throw new Error('Geçerli bir süre seç.');
        await setMute(client, me, profile.id, seconds);
        toast(seconds === 0 ? 'Susturma kaldırıldı.' : seconds === -1 ? 'Kullanıcı kalıcı susturuldu.' : 'Kullanıcı susturuldu.');
      } catch (error) {
        toast(error?.message || 'Susturma uygulanamadı.');
        console.error(error);
      }
    });
  }

  async function openFromTarget(target) {
    const userTarget = target.closest('[data-user-id]');
    const userId = userTarget?.dataset.userId ||
                   target.closest('.chat-message')?.dataset.userId;
    if (!userId) return;

    const client = await getClient();
    if (!client) return;

    const me = await getCurrentUser(client);
    if (!me) {
      toast('Profilleri görmek için giriş yapmalısın.');
      return;
    }

    const name =
      userTarget?.dataset.username ||
      target.closest('.chat-message')?.dataset.username ||
      userTarget?.querySelector('.community-user-copy strong')?.textContent ||
      'Oyuncu';

    try {
      const [profile, state] = await Promise.all([
        fetchProfile(client, userId, name),
        getState(client, me, userId)
      ]);

      profile._myRole = String(
        window.atlantisCurrentProfile?.site_role ||
        window.atlantisAuthSession?.profile?.site_role ||
        'user'
      );

      renderOverlay(profile, state, me, client);
    } catch (error) {
      toast('Profil bilgileri alınamadı.');
      console.error(error);
    }
  }

  // Capture-phase interception: existing chat handlers can stay unchanged.
  document.addEventListener('click', (event) => {
    const avatar = event.target.closest('.chat-avatar-button');
    const chatUser = event.target.closest('.chat-user-button');
    const communityUser = event.target.closest('.community-user-card[data-user-id]');
    const target = avatar || chatUser || communityUser;
    if (!target) return;

    if (target.disabled || target.matches('a')) return;

    event.stopImmediatePropagation();
    event.preventDefault();
    openFromTarget(target);
  }, true);

  // Reuse the same full-featured profile drawer from chat on the
  // Users / Blocked Users pages.
  window.openAtlantisSocialProfile = async (profileData) => {
    const client = await getClient();
    if (!client || !profileData?.id) return false;

    const me = await getCurrentUser(client);
    if (!me) {
      toast('Profilleri görmek için giriş yapmalısın.');
      return false;
    }

    try {
      const fresh = await fetchProfile(client, profileData.id, profileData.username || 'Oyuncu');
      const state = await getState(client, me, profileData.id);

      fresh._myRole = String(
        window.atlantisCurrentProfile?.site_role ||
        window.atlantisAuthSession?.profile?.site_role ||
        'user'
      );

      renderOverlay(fresh, state, me, client);
      return true;
    } catch (error) {
      toast('Profil bilgileri alınamadı.');
      console.error(error);
      return false;
    }
  };

  // Render local favorite star beside chat usernames after favorite changes.
  function addStarToMessage(messageItem, favoriteIds) {
    const id = String(messageItem.dataset.userId || '');
    const meta = messageItem.querySelector('.chat-meta');
    if (!meta || !id) return;
    meta.querySelector('.atlantis-favorite-star')?.remove();
    if (favoriteIds.has(id)) {
      const star = document.createElement('span');
      star.className = 'atlantis-favorite-star';
      star.textContent = '★';
      star.title = 'Favori arkadaş';
      meta.querySelector('.chat-user-button')?.after(star);
    }
  }

  // Favorite ids are fetched once (and again only when they actually change),
  // never re-fetched from Supabase on every incoming chat message — the old
  // implementation queried the network and re-scanned the whole message list
  // on every single DOM mutation of #chat-messages, which is what caused
  // stutter during an active chat.
  let favoriteIds = new Set();
  let favoritesReady = false;
  let chatObserver = null;

  async function loadFavoriteIds(force) {
    if (favoritesReady && !force) return favoriteIds;
    try {
      const client = await getClient();
      if (!client) return favoriteIds;
      const me = await getCurrentUser(client);
      if (!me) { favoriteIds = new Set(); favoritesReady = true; return favoriteIds; }
      const { data, error } = await client.from('user_favorites')
        .select('favorite_user_id')
        .eq('user_id', me.id);
      if (!error) {
        favoriteIds = new Set((data || []).map(row => String(row.favorite_user_id)));
        favoritesReady = true;
      }
    } catch (error) {
      console.error('[Atlantis Social] favorites:', error);
    }
    return favoriteIds;
  }

  function applyStarsTo(nodes) {
    nodes.forEach(node => {
      if (node.nodeType !== 1) return;
      if (node.classList?.contains('chat-message')) addStarToMessage(node, favoriteIds);
    });
  }

  function watchChatMessages() {
    chatObserver?.disconnect();
    const box = document.getElementById('chat-messages');
    if (!box) { chatObserver = null; return; }
    // Only the newly added message nodes are touched per mutation batch —
    // no network call and no re-scan of the whole (up to 300-row) list.
    chatObserver = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length) applyStarsTo(mutation.addedNodes);
      }
    });
    chatObserver.observe(box, {childList:true});
    applyStarsTo(box.querySelectorAll('.chat-message'));
  }

  async function boot() {
    await loadFavoriteIds();
    watchChatMessages();
  }

  window.addEventListener('atlantis-favorite-changed', async () => {
    await loadFavoriteIds(true);
    document.querySelectorAll('.chat-message').forEach(item => addStarToMessage(item, favoriteIds));
  });

  // Re-attach after the SPA-lite navigation in script.js swaps <main>: the
  // old #chat-messages node (and its observer) is gone with it.
  window.addEventListener('atlantis:content-swapped', () => {
    if (document.getElementById('chat-messages')) {
      document.querySelectorAll('.chat-message').forEach(item => addStarToMessage(item, favoriteIds));
      watchChatMessages();
    } else if (chatObserver) {
      chatObserver.disconnect();
      chatObserver = null;
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, {once:true});
  } else {
    boot();
  }
})();

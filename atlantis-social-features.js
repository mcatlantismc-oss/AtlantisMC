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
    const { data } = await client
      .from('profiles')
      .select('id,username,avatar_url,bio,site_role,last_seen,created_at')
      .eq('id', userId)
      .maybeSingle();

    return data || { id:userId, username:fallbackName, avatar_url:null, bio:'', site_role:'user' };
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

  function renderOverlay(profile, state, me) {
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
  }

  async function openFromTarget(target) {
    const userId = target.closest('[data-user-id]')?.dataset.userId ||
                   target.closest('.chat-message')?.dataset.userId;
    if (!userId) return;

    const client = await getClient();
    if (!client) return;
    const me = await getCurrentUser(client);
    if (!me || me.id === userId) return;

    const name = target.closest('.chat-message')?.dataset.username || 'Oyuncu';
    try {
      const [profile, state] = await Promise.all([
        fetchProfile(client, userId, name),
        getState(client, me, userId)
      ]);
      renderOverlay(profile, state, me);
    } catch (error) {
      toast('Profil bilgileri alınamadı.');
      console.error(error);
    }
  }

  // Capture-phase interception: existing chat handlers can stay unchanged.
  document.addEventListener('click', (event) => {
    const avatar = event.target.closest('.chat-avatar-button');
    const user = event.target.closest('.chat-user-button');
    const target = avatar || user;
    if (!target) return;
    if (target.disabled) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    openFromTarget(target);
  }, true);

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

  async function refreshFavoriteStars() {
    const client = await getClient();
    if (!client) return;
    const me = await getCurrentUser(client);
    if (!me) return;
    const { data, error } = await client.from('user_favorites')
      .select('favorite_user_id')
      .eq('user_id', me.id);

    if (error) return;
    const ids = new Set((data || []).map(row => String(row.favorite_user_id)));
    document.querySelectorAll('.chat-message').forEach(item => addStarToMessage(item, ids));
  }

  function boot() {
    refreshFavoriteStars().catch(() => {});
    const observer = new MutationObserver(() => refreshFavoriteStars());
    const box = document.getElementById('chat-messages');
    if (box) observer.observe(box, {childList:true});
    window.addEventListener('atlantis-favorite-changed', refreshFavoriteStars);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, {once:true});
  } else {
    boot();
  }
})();

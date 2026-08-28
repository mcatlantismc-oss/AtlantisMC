(() => {
  'use strict';

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[c]));

  function roleText(r) {
    return r === 'admin' ? 'Yönetici' : r === 'moderator' ? 'Moderatör' : 'Oyuncu';
  }

  async function clientReady() {
    return window.atlantisGetClient ? window.atlantisGetClient() : window.atlantisSupabase;
  }

  function toast(message, isError = false) {
    let el = document.getElementById('atlantis-blocked-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'atlantis-blocked-toast';
      el.className = 'chat-toast';
      document.body.appendChild(el);
    }

    el.textContent = message;
    el.classList.toggle('is-error', isError);
    el.classList.add('show');

    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  async function load() {
    const box = document.getElementById('blocked-list');
    if (!box) return;

    box.innerHTML = '<div class="empty-panel">Engel listesi yükleniyor...</div>';

    try {
      const c = await clientReady();
      const u = window.atlantisAuthSession?.user;

      if (!c || !u) {
        box.innerHTML = '<div class="empty-panel">Engellenenleri görmek için giriş yapmalısın.</div>';
        return;
      }

      const { data: blocks, error: bErr } = await c
        .from('user_blocks')
        .select('blocked_user_id')
        .eq('user_id', u.id);

      if (bErr) throw bErr;

      const ids = (blocks || []).map(x => x.blocked_user_id).filter(Boolean);

      if (!ids.length) {
        box.innerHTML = '<div class="empty-panel">Henüz engellediğin bir kullanıcı yok.</div>';
        return;
      }

      const { data: profiles, error: pErr } = await c
        .from('profiles')
        .select('id,username,avatar_url,bio,site_role,last_seen,created_at')
        .in('id', ids);

      if (pErr) throw pErr;

      box.innerHTML = (profiles || []).map(p => {
        const name = String(p.username || 'Oyuncu');
        const initial = name.charAt(0).toLocaleUpperCase('tr-TR') || 'A';
        const avatar = p.avatar_url
          ? `<img src="${esc(p.avatar_url)}" alt="" loading="lazy">`
          : `<span>${esc(initial)}</span>`;

        return `
          <article
            class="community-user-card is-blocked"
            data-user-id="${esc(p.id)}"
            data-username="${esc(name)}"
          >
            <span class="community-avatar">${avatar}</span>

            <span class="community-user-copy">
              <strong>${esc(name)}</strong>
              <span class="role-chip role-${esc(p.site_role || 'user')}">
                ${esc(roleText(String(p.site_role || 'user')))}
              </span>
              <small>Bu kullanıcı engellendi.</small>
            </span>

            <span class="community-user-actions">
              <button
                type="button"
                class="secondary-button"
                data-profile="${esc(p.id)}"
              >
                Profili Gör
              </button>

              <button
                type="button"
                class="danger-button unblock-btn"
                data-unblock="${esc(p.id)}"
              >
                Engeli Kaldır
              </button>
            </span>
          </article>
        `;
      }).join('') || '<div class="empty-panel">Engellenen kullanıcıların profilleri bulunamadı.</div>';

      box.querySelectorAll('[data-profile]').forEach(btn => {
        btn.addEventListener('click', async event => {
          event.stopPropagation();

          const card = btn.closest('[data-user-id]');
          const userId = card?.dataset.userId;
          if (!userId) return;

          const p = (profiles || []).find(x => String(x.id) === String(userId));
          if (!p) return;

          if (window.openAtlantisSocialProfile) {
            await window.openAtlantisSocialProfile(p);
          }
        });
      });

      box.querySelectorAll('[data-unblock]').forEach(btn => {
        btn.addEventListener('click', async event => {
          event.stopPropagation();

          const targetId = btn.dataset.unblock;
          btn.disabled = true;
          btn.textContent = 'Kaldırılıyor…';

          try {
            const { error } = await c
              .from('user_blocks')
              .delete()
              .eq('user_id', u.id)
              .eq('blocked_user_id', targetId);

            if (error) throw error;

            toast('Engel kaldırıldı.');
            await load();
          } catch (error) {
            btn.disabled = false;
            btn.textContent = 'Engeli Kaldır';
            toast(error?.message || 'Engel kaldırılamadı.', true);
          }
        });
      });

      box.querySelectorAll('.community-user-card[data-user-id]').forEach(card => {
        card.addEventListener('click', async event => {
          if (event.target.closest('button')) return;
          if (window.openAtlantisSocialProfile) {
            const p = (profiles || []).find(x => String(x.id) === String(card.dataset.userId));
            if (p) await window.openAtlantisSocialProfile(p);
          }
        });
      });

    } catch (e) {
      box.innerHTML = `<div class="empty-panel">Engel listesi alınamadı: ${esc(e.message)}</div>`;
    }
  }

  document.getElementById('blocked-refresh')?.addEventListener('click', load);
  window.addEventListener('atlantis-auth-login', load);
  window.addEventListener('atlantis-auth-logout', load);
  window.addEventListener('supabase-ready', load);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load, { once: true });
  } else {
    load();
  }
})();

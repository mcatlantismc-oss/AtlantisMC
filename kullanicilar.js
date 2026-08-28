(() => {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  let all = [];
  async function clientReady(){ return window.atlantisGetClient ? window.atlantisGetClient() : window.atlantisSupabase; }
  function roleText(r){ return r==='admin'?'Yönetici':r==='moderator'?'Moderatör':'Oyuncu'; }
  function render(){
    const q = String(document.getElementById('users-search')?.value || '').trim().toLocaleLowerCase('tr-TR');
    const box = document.getElementById('users-list');
    const rows = all.filter(p => String(p.username||'').toLocaleLowerCase('tr-TR').includes(q));
    if (!rows.length){ box.innerHTML='<div class="empty-panel">Kullanıcı bulunamadı.</div>'; return; }
    box.innerHTML = rows.map(p => {
      const name=String(p.username||'Oyuncu'), initial=name.charAt(0).toLocaleUpperCase('tr-TR')||'A';
      const avatar=p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="" loading="lazy">` : `<span>${esc(initial)}</span>`;
      const role=String(p.site_role||'user');
      return `<button type="button" class="community-user-card" data-user-id="${esc(p.id)}">
        <span class="community-avatar">${avatar}</span>
        <span class="community-user-copy"><strong>${esc(name)}</strong><span class="role-chip role-${esc(role)}">${esc(roleText(role))}</span><small>${p.bio ? esc(p.bio) : 'Profilini görüntüle'}</small></span>
      </button>`;
    }).join('');
    box.querySelectorAll('[data-user-id]').forEach(btn => btn.addEventListener('click', () => {
      const p = all.find(x => String(x.id)===String(btn.dataset.userId));
      if (p) window.openAtlantisUserDrawer?.(p);
    }));
  }
  async function load(){
    const box=document.getElementById('users-list'); box.innerHTML='<div class="empty-panel">Kullanıcılar yükleniyor...</div>';
    try{
      const c=await clientReady(); if(!c) throw new Error('Supabase bağlantısı hazır değil.');
      const {data,error}=await c.from('profiles').select('id,username,avatar_url,bio,site_role,last_seen,created_at').order('created_at',{ascending:true});
      if(error) throw error; all=data||[]; render();
    }catch(e){ box.innerHTML=`<div class="empty-panel">Kullanıcılar alınamadı: ${esc(e.message)}</div>`; }
  }
  document.getElementById('users-search')?.addEventListener('input',render);
  document.getElementById('users-refresh')?.addEventListener('click',load);
  window.addEventListener('atlantis-auth-login',load);
  window.addEventListener('supabase-ready',load);
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',load,{once:true}); else load();
})();
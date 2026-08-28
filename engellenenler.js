(() => {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  async function clientReady(){ return window.atlantisGetClient ? window.atlantisGetClient() : window.atlantisSupabase; }
  function roleText(r){ return r==='admin'?'Yönetici':r==='moderator'?'Moderatör':'Oyuncu'; }
  async function load(){
    const box=document.getElementById('blocked-list'); box.innerHTML='<div class="empty-panel">Engel listesi yükleniyor...</div>';
    try{
      const c=await clientReady(); const u=window.atlantisAuthSession?.user;
      if(!c || !u){ box.innerHTML='<div class="empty-panel">Engellenenleri görmek için giriş yapmalısın.</div>'; return; }
      const {data:blocks,error:bErr}=await c.from('user_blocks').select('blocked_user_id').eq('user_id',u.id);
      if(bErr) throw bErr;
      const ids=(blocks||[]).map(x=>x.blocked_user_id).filter(Boolean);
      if(!ids.length){ box.innerHTML='<div class="empty-panel">Henüz engellediğin bir kullanıcı yok.</div>'; return; }
      const {data:profiles,error:pErr}=await c.from('profiles').select('id,username,avatar_url,bio,site_role').in('id',ids);
      if(pErr) throw pErr;
      box.innerHTML=(profiles||[]).map(p=>{
        const name=String(p.username||'Oyuncu'), initial=name.charAt(0).toLocaleUpperCase('tr-TR')||'A';
        const av=p.avatar_url?`<img src="${esc(p.avatar_url)}" alt="" loading="lazy">`:`<span>${esc(initial)}</span>`;
        return `<div class="community-user-card is-blocked"><span class="community-avatar">${av}</span><span class="community-user-copy"><strong>${esc(name)}</strong><span class="role-chip role-${esc(p.site_role||'user')}">${esc(roleText(String(p.site_role||'user')))}</span><small>Bu kullanıcı engellendi.</small></span><span class="community-user-actions"><button type="button" class="secondary-button" data-profile="${esc(p.id)}">Profili Gör</button><button type="button" class="danger-button unblock-btn" data-unblock="${esc(p.id)}">Engeli Kaldır</button></span></div>`;
      }).join('') || '<div class="empty-panel">Engellenen kullanıcıların profilleri bulunamadı.</div>';
      box.querySelectorAll('[data-profile]').forEach(btn=>btn.addEventListener('click', async()=>{
        const {data}=await c.from('profiles').select('id,username,avatar_url,bio,site_role,last_seen,created_at').eq('id',btn.dataset.profile).maybeSingle();
        if(data) window.openAtlantisUserDrawer?.(data);
      }));
      box.querySelectorAll('[data-unblock]').forEach(btn=>btn.addEventListener('click', async()=>{
        btn.disabled=true; btn.textContent='Kaldırılıyor…';
        const {error}=await c.from('user_blocks').delete().eq('user_id',u.id).eq('blocked_user_id',btn.dataset.unblock);
        if(error){ btn.disabled=false; btn.textContent='Engeli Kaldır'; 
          const n=document.createElement('div'); n.className='chat-toast is-error show'; n.textContent=error.message||'Engel kaldırılamadı.'; document.body.appendChild(n); setTimeout(()=>n.remove(),2600); return; }
        load();
      }));
    }catch(e){ box.innerHTML=`<div class="empty-panel">Engel listesi alınamadı: ${esc(e.message)}</div>`; }
  }
  document.getElementById('blocked-refresh')?.addEventListener('click',load);
  window.addEventListener('atlantis-auth-login',load); window.addEventListener('atlantis-auth-logout',load); window.addEventListener('supabase-ready',load);
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',load,{once:true}); else load();
})();
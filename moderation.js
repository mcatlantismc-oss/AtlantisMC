(function(){
  'use strict';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  async function init(){
    const app=document.getElementById('moderation-app');
    const s=await window.atlantisAuthReady;
    if(!app)return;
    if(!s){app.innerHTML='<div class="empty-panel">Supabase bağlantısı yapılandırılmamış.</div>';return;}
    const {data:{session}}=await s.auth.getSession();
    if(!session){app.innerHTML='<div class="empty-panel">Bu paneli görmek için <button class="link-button" id="mod-login">Giriş Yap</button>.</div>';document.getElementById('mod-login')?.addEventListener('click',()=>window.openAtlantisAuth?.('login'));return;}
    const {data:me}=await s.from('profiles').select('username,site_role').eq('id',session.user.id).maybeSingle();
    if(!me || !['moderator','admin'].includes(me.site_role)){
      app.innerHTML='<div class="empty-panel">Bu sayfaya erişim yetkin yok.</div>';return;
    }
    renderPanel(app,me.site_role);
    await refreshMessages(s);
    await refreshUsers(s,me.site_role);
    attachRealtime(s);
  }

  function renderPanel(app,role){
    app.innerHTML=`<div class="moderation-grid"><section class="panel-inner"><div class="panel-head"><div><span class="section-label">Chat</span><h2>Mesajlar</h2></div><button class="ghost-button" id="mod-refresh">Yenile</button></div><div id="mod-messages" class="mod-list"><div class="moderation-loading">Yükleniyor...</div></div></section><section class="panel-inner"><div class="panel-head"><div><span class="section-label">Kullanıcılar</span><h2>Roller &amp; susturma</h2></div></div><div id="mod-users" class="mod-list"><div class="moderation-loading">Yükleniyor...</div></div></section></div>`;
    document.getElementById('mod-refresh').onclick=async()=>{const s=window.atlantisSupabase;await refreshMessages(s);await refreshUsers(s,role);};
  }

  async function refreshMessages(s){
    const box=document.getElementById('mod-messages');if(!box)return;
    const {data,error}=await s.from('messages').select('id,user_id,username,message,created_at').order('created_at',{ascending:false}).limit(100);
    if(error){box.innerHTML='<div class="empty-panel">Mesajlar alınamadı.</div>';return;}
    box.innerHTML=(data||[]).map(m=>`<article class="mod-item"><div><strong>${esc(m.username)}</strong><time>${new Date(m.created_at).toLocaleString('tr-TR')}</time><p>${esc(m.message)}</p></div><button class="danger-button" data-delete-message="${m.id}" type="button">Sil</button></article>`).join('') || '<div class="empty-panel">Henüz mesaj yok.</div>';
    box.querySelectorAll('[data-delete-message]').forEach(btn=>btn.onclick=async()=>{
      const {error}=await s.rpc('moderation_delete_message',{target_message_id:Number(btn.dataset.deleteMessage)});
      if(error){alert('Mesaj silinemedi.');return;}await refreshMessages(s);
    });
  }

  async function refreshUsers(s,role){
    const box=document.getElementById('mod-users');if(!box)return;
    const {data,error}=await s.from('profiles').select('id,username,site_role,muted_until').not('username','is',null).order('username',{ascending:true}).limit(200);
    if(error){box.innerHTML='<div class="empty-panel">Kullanıcılar alınamadı.</div>';return;}
    box.innerHTML=(data||[]).map(u=>{
      const muted=u.muted_until && new Date(u.muted_until)>new Date();
      const actions=`<select data-role-select="${u.id}" ${role==='admin'?'':'disabled'}><option value="user" ${u.site_role==='user'?'selected':''}>Oyuncu</option><option value="moderator" ${u.site_role==='moderator'?'selected':''}>Moderatör</option><option value="admin" ${u.site_role==='admin'?'selected':''}>Yönetici</option></select><button class="ghost-button" data-mute="${u.id}" data-unmute="${muted}" type="button">${muted?'Susturmayı kaldır':'5 dk sustur'}</button>`;
      return `<article class="mod-item user-row"><div><strong>${esc(u.username)}</strong><span class="role-chip role-${esc(u.site_role)}">${u.site_role==='admin'?'Yönetici':u.site_role==='moderator'?'Moderatör':'Oyuncu'}</span>${muted?'<span class="mute-chip">Susturulmuş</span>':''}</div><div class="mod-actions">${actions}</div></article>`;
    }).join('') || '<div class="empty-panel">Kullanıcı yok.</div>';

    box.querySelectorAll('[data-role-select]').forEach(sel=>sel.onchange=async()=>{
      const {error}=await s.rpc('admin_set_role',{target_user_id:sel.dataset.roleSelect,new_role:sel.value});
      if(error){alert('Rol değiştirilemedi.');await refreshUsers(s,role);}
    });
    box.querySelectorAll('[data-mute]').forEach(btn=>btn.onclick=async()=>{
      const seconds=btn.dataset.unmute==='true'?0:300;
      const {error}=await s.rpc('moderation_set_mute',{target_user_id:btn.dataset.mute,duration_seconds:seconds});
      if(error){alert('Susturma işlemi başarısız.');return;}await refreshUsers(s,role);
    });
  }

  function attachRealtime(s){
    s.channel('moderation-live').on('postgres_changes',{event:'*',schema:'public',table:'messages'},()=>refreshMessages(s)).subscribe();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

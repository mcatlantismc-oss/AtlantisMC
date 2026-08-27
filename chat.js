(function(){
  'use strict';

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const NOTIFY_KEY = 'atlantis-chat-notifications';
  const BLOCK_KEY = 'atlantis-chat-blocked-users';
  const ANON_KEY = 'atlantis-chat-anonymous-id';

  let currentUser = null;
  let currentProfile = {};
  let client = null;
  let chatChannel = null;
  let presenceChannel = null;
  let lastSent = 0;
  let lastTypingSent = 0;
  let typingTimer = null;
  let audioContext = null;
  let profileCache = new Map();
  let blockedUsers = new Set();

  try{ blockedUsers = new Set(JSON.parse(localStorage.getItem(BLOCK_KEY)||'[]')); }catch{}

  function saveBlocked(){ localStorage.setItem(BLOCK_KEY, JSON.stringify([...blockedUsers])); }

  function anonymousId(){
    let id = localStorage.getItem(ANON_KEY);
    if(!id){
      id = (crypto?.randomUUID?.() || ('anon-' + Math.random().toString(36).slice(2) + Date.now()));
      localStorage.setItem(ANON_KEY, id);
    }
    return id;
  }

  async function init(){
    client = await window.atlantisAuthReady;
    const box = document.getElementById('chat-messages');
    const form = document.getElementById('chat-form');
    const input = document.getElementById('chat-input');
    const send = form?.querySelector('button');
    if(!box || !form || !input) return;

    addNotificationControls();
    ensureTypingUI();

    if(!client){
      setChatError('Sohbet sistemi yapılandırılamadı.');
      return;
    }

    const {data:{session}} = await client.auth.getSession();
    currentUser = session?.user || null;

    if(currentUser){
      const {data: profile} = await client.from('profiles').select('id,username,avatar_url,bio,site_role,muted_until,last_seen,created_at,updated_at').eq('id', currentUser.id).maybeSingle();
      currentProfile = profile || {};
      if(profile?.id) profileCache.set(profile.id, profile);
    }else{
      currentProfile = {};
    }

    const username = currentUser
      ? String(currentProfile.username || currentUser.user_metadata?.username || 'Oyuncu').trim()
      : 'Anonim';

    const muted = currentProfile.muted_until && new Date(currentProfile.muted_until) > new Date();
    input.disabled = !!muted;
    if(send) send.disabled = !!muted;
    if(muted) input.placeholder = 'Sohbet kullanımın geçici olarak kısıtlandı.';

    await loadMessages();
    subscribeChat();
    subscribePresence(username);
    setupComposer(username);
    updateNotificationButton();
    touchLastSeen();

    window.addEventListener('atlantis-profile-updated', async event => {
      currentProfile = event.detail?.profile || currentProfile;
      if(currentProfile?.id) profileCache.set(currentProfile.id, currentProfile);
      await refreshChatAvatars();
    });
    window.addEventListener('atlantis-auth-logout', () => window.location.reload());
    window.addEventListener('atlantis-auth-login', () => window.setTimeout(() => window.location.reload(), 120));
  }

  function setChatError(text){
    const box = document.getElementById('chat-messages');
    if(box) box.innerHTML = `<div class="chat-empty chat-error">${esc(text)}</div>`;
  }

  async function loadMessages(){
    const box = document.getElementById('chat-messages');
    if(!box) return;
    box.innerHTML = '<div class="chat-empty chat-loading"><span class="loading-pulse"></span> Mesajlar yükleniyor...</div>';

    const {data,error} = await client
      .from('messages')
      .select('id,user_id,username,message,created_at,edited_at,avatar_url')
      .order('created_at',{ascending:true})
      .limit(100);

    if(error){
      console.error('[Atlantis Chat] loadMessages:', error);
      setChatError('Sohbet mesajları yüklenemedi.');
      return;
    }

    const ids = [...new Set((data||[]).map(m=>m.user_id).filter(Boolean))];
    await preloadProfiles(ids);

    box.innerHTML = '';
    (data||[]).forEach(addMessage);
    requestAnimationFrame(()=>{ box.scrollTop = box.scrollHeight; });
  }

  async function preloadProfiles(ids){
    const missing = ids.filter(id => !profileCache.has(id));
    if(!missing.length) return;
    const {data,error} = await client.from('profiles').select('id,username,avatar_url,bio,site_role,muted_until,last_seen,created_at').in('id',missing);
    if(error){ console.warn('[Atlantis Chat] profiles:', error); return; }
    (data||[]).forEach(p=>profileCache.set(p.id,p));
  }

  function displayName(message){
    if(!message.user_id) return 'Anonim';
    return String(profileCache.get(message.user_id)?.username || message.username || 'Oyuncu');
  }

  function avatarUrl(message){
    if(message.avatar_url) return String(message.avatar_url);
    if(message.user_id && message.user_id === currentUser?.id) return String(currentProfile.avatar_url || '');
    return String(profileCache.get(message.user_id)?.avatar_url || '');
  }

  function addMessage(message){
    const box = document.getElementById('chat-messages');
    if(!box || !message?.id) return;
    if(document.getElementById('chat-message-'+message.id)) return;

    const userId = String(message.user_id || '');
    if(userId && userId !== currentUser?.id && blockedUsers.has(userId)) return;

    const name = displayName(message);
    const avatar = avatarUrl(message);
    const initial = name.trim().charAt(0).toLocaleUpperCase('tr-TR') || 'O';
    const created = new Date(message.created_at);
    const time = Number.isNaN(created.getTime()) ? '--:--' : created.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});
    const edited = !!message.edited_at;

    const item = document.createElement('article');
    item.className = 'chat-message chat-message-enter';
    item.id = 'chat-message-'+message.id;
    item.dataset.userId = userId;
    item.dataset.username = name;

    const canOpenProfile = !!userId;
    item.innerHTML = `
      <button class="chat-avatar chat-avatar-button" type="button" ${canOpenProfile?'':'disabled'} aria-label="${esc(name)} profili">
        ${avatar ? `<img src="${esc(avatar)}" alt="${esc(name)}">` : `<span>${esc(initial)}</span>`}
      </button>
      <div class="chat-message-body">
        <div class="chat-meta">
          <button class="chat-user-button" type="button" ${canOpenProfile?'':'disabled'}>${esc(name)}</button>
          ${!userId ? '<span class="chat-guest-badge">Misafir</span>' : ''}
          <time datetime="${esc(message.created_at)}">${esc(time)}${edited?' · düzenlendi':''}</time>
        </div>
        <p class="chat-message-text">${formatMentions(message.message)}</p>
        ${message.user_id && message.user_id === currentUser?.id ? `
          <div class="chat-message-actions">
            <button type="button" data-chat-edit>Düzenle</button>
            <button type="button" data-chat-delete>Sil</button>
          </div>` : ''}
      </div>`;

    box.appendChild(item);
    requestAnimationFrame(()=>item.classList.add('is-visible'));

    if(canOpenProfile){
      item.querySelector('.chat-avatar-button')?.addEventListener('click',()=>openUserProfile(userId,name));
      item.querySelector('.chat-user-button')?.addEventListener('click',()=>openUserProfile(userId,name));
    }
    item.querySelector('[data-chat-edit]')?.addEventListener('click',()=>editOwnMessage(message,item));
    item.querySelector('[data-chat-delete]')?.addEventListener('click',()=>deleteOwnMessage(message,item));

    if(currentUser && userId !== currentUser.id) maybeNotify(message);
  }

  function formatMentions(text){
    return esc(text).replace(/@([A-Za-zÇĞİÖŞÜçğıöşü0-9]{3,16})/g,'<span class="chat-mention">@$1</span>');
  }

  function replaceMessage(message){
    document.getElementById('chat-message-'+message.id)?.remove();
    addMessage(message);
  }

  function removeMessage(message){ document.getElementById('chat-message-'+message.id)?.remove(); }

  function subscribeChat(){
    if(chatChannel) client.removeChannel(chatChannel);
    chatChannel = client.channel('atlantis-chat-messages-v2');
    chatChannel
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},payload=>{
        preloadProfiles(payload.new?.user_id ? [payload.new.user_id] : []).then(()=>addMessage(payload.new));
      })
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'messages'},payload=>replaceMessage(payload.new))
      .on('postgres_changes',{event:'DELETE',schema:'public',table:'messages'},payload=>removeMessage(payload.old))
      .on('broadcast',{event:'typing'},payload=>{
        if(payload.payload?.presence_key === presenceKey()) return;
        const name = payload.payload?.username || 'Birisi';
        if(payload.payload?.typing) showTyping(name); else hideTyping(name);
      })
      .subscribe();
  }

  function presenceKey(){ return currentUser?.id || anonymousId(); }

  function subscribePresence(username){
    const count = document.getElementById('online-count');
    if(presenceChannel) client.removeChannel(presenceChannel);

    presenceChannel = client.channel('atlantis-chat-presence-v2',{config:{presence:{key:presenceKey()}}});
    const render = () => {
      const state = presenceChannel.presenceState();
      const keys = new Set();
      Object.values(state).flat().forEach(entry=>{
        const k = entry?.presence_key || entry?.user_id || entry?.username || Math.random();
        keys.add(k);
      });
      if(count) count.textContent = keys.size + ' kişi sohbeti açık';
    };

    presenceChannel.on('presence',{event:'sync'},render).on('presence',{event:'join'},render).on('presence',{event:'leave'},render);
    presenceChannel.subscribe(async status=>{
      if(status === 'SUBSCRIBED'){
        await presenceChannel.track({presence_key:presenceKey(),user_id:currentUser?.id||null,username:currentUser?username:'Anonim'});
        render();
      }
    });
  }

  function setupComposer(username){
    const form = document.getElementById('chat-form');
    const input = document.getElementById('chat-input');
    const button = form?.querySelector('button');
    if(!form || !input) return;

    input.disabled = false;
    if(button) button.disabled = false;

    input.addEventListener('input',()=>{
      broadcastTyping(username,true);
      clearTimeout(typingTimer);
      typingTimer = setTimeout(()=>broadcastTyping(username,false),900);
    });
    input.addEventListener('blur',()=>broadcastTyping(username,false));

    form.onsubmit = async event => {
      event.preventDefault();
      const now = Date.now();
      const remaining = 3000 - (now-lastSent);
      if(remaining > 0){ toast('Yeni mesaj için '+Math.ceil(remaining/1000)+' saniye bekle.'); return; }
      const text = input.value.trim();
      if(!text) return;
      if(text.length > 300){ toast('Mesaj en fazla 300 karakter olabilir.'); return; }
      if(button) button.disabled = true;

      try{
        const {data,error} = await client.rpc('send_chat_message',{p_message:text});
        if(error) throw error;
        input.value = '';
        lastSent = Date.now();
        broadcastTyping(username,false);
        if(data?.message) addMessage(data.message);
      }catch(error){
        console.error('[Atlantis Chat] send:',error);
        toast(error?.message || 'Mesaj gönderilemedi.');
      }finally{
        if(button) button.disabled = false;
      }
    };
  }

  async function broadcastTyping(username,typing){
    if(!chatChannel) return;
    const now = Date.now();
    if(typing && now-lastTypingSent < 700) return;
    lastTypingSent = now;
    try{ await chatChannel.send({type:'broadcast',event:'typing',payload:{presence_key:presenceKey(),username,typing:!!typing}}); }catch{}
  }

  function ensureTypingUI(){
    const panel = document.querySelector('.chat-panel');
    const form = document.getElementById('chat-form');
    if(!panel || !form || document.getElementById('chat-typing')) return;
    const el = document.createElement('div');
    el.id = 'chat-typing';
    el.className = 'chat-typing';
    panel.insertBefore(el,form);
  }

  function showTyping(name){
    const el = document.getElementById('chat-typing');
    if(el) el.innerHTML = `<span>${esc(name)} yazıyor</span><i></i><i></i><i></i>`;
  }
  function hideTyping(){ const el=document.getElementById('chat-typing'); if(el) el.textContent=''; }

  async function openUserProfile(userId,fallbackName){
    if(!userId) return;
    if(userId === currentUser?.id){
      await window.openAtlantisProfileCard?.(fallbackName,currentProfile.site_role||'user',currentProfile);
      return;
    }
    let profile = profileCache.get(userId);
    if(!profile){
      const {data} = await client.from('profiles').select('id,username,avatar_url,bio,site_role,last_seen,created_at').eq('id',userId).maybeSingle();
      profile = data || {id:userId,username:fallbackName};
      profileCache.set(userId,profile);
    }
    const name = String(profile.username || fallbackName || 'Oyuncu');
    const avatar = String(profile.avatar_url || '');
    const role = profile.site_role || 'user';
    const roleLabel = role==='admin'?'Yönetici':role==='moderator'?'Moderatör':'Oyuncu';
    const overlay = document.createElement('div');
    overlay.id = 'atlantis-chat-profile-card';
    overlay.className = 'atlantis-profile-card-overlay';
    const avatarHtml = avatar ? `<img src="${esc(avatar)}" alt="${esc(name)}" class="atlantis-profile-avatar-image">` : `<span class="atlantis-profile-avatar-letter">${esc(name.charAt(0).toLocaleUpperCase('tr-TR')||'O')}</span>`;
    const lastSeen = profile.last_seen ? new Date(profile.last_seen).toLocaleString('tr-TR',{dateStyle:'medium',timeStyle:'short'}) : 'Henüz görülmedi';
    const createdAt = profile.created_at ? new Date(profile.created_at).toLocaleDateString('tr-TR') : 'Bilinmiyor';
    const blocked = blockedUsers.has(String(userId));
    overlay.innerHTML = `
      <div class="atlantis-profile-card atlantis-rich-profile profile-editor-animated">
        <button class="atlantis-profile-card-close" type="button">×</button>
        <div class="atlantis-profile-hero"><div class="atlantis-profile-big-avatar">${avatarHtml}</div><div><h3>${esc(name)}</h3><span class="role-chip role-${esc(role)}">${esc(roleLabel)}</span><div class="atlantis-online-badge"><i></i> Topluluk profili</div></div></div>
        <div class="atlantis-profile-bio">${esc(profile.bio || 'Henüz bir açıklama eklenmemiş.')}</div>
        <div class="atlantis-profile-meta"><div><span>Üyelik</span><strong>${esc(createdAt)}</strong></div><div><span>Son görülme</span><strong>${esc(lastSeen)}</strong></div></div>
        <button class="ghost-button" id="chat-block-user" type="button">${blocked?'Engeli kaldır':'Kullanıcıyı engelle'}</button>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(()=>overlay.classList.add('is-visible'));
    overlay.querySelector('.atlantis-profile-card-close')?.addEventListener('click',()=>overlay.remove());
    overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
    overlay.querySelector('#chat-block-user')?.addEventListener('click',()=>{
      if(blockedUsers.has(String(userId))) blockedUsers.delete(String(userId)); else blockedUsers.add(String(userId));
      saveBlocked();
      document.querySelectorAll(`.chat-message[data-user-id="${CSS.escape(String(userId))}"]`).forEach(el=>el.style.display=blockedUsers.has(String(userId))?'none':'');
      overlay.remove();
      toast(blockedUsers.has(String(userId))?'Kullanıcı engellendi.':'Kullanıcının engeli kaldırıldı.');
    });
  }

  async function editOwnMessage(message,item){
    const next = window.prompt('Mesajını düzenle:',String(message.message||''));
    if(next === null) return;
    const clean = next.trim();
    if(!clean || clean.length > 300){ toast('Mesaj 1–300 karakter olmalı.'); return; }
    const {data,error} = await client.rpc('edit_my_chat_message',{p_message_id:message.id,p_message:clean});
    if(error){ toast(error.message || 'Mesaj düzenlenemedi.'); return; }
    if(data?.message) replaceMessage(data.message); else replaceMessage({...message,message:clean,edited_at:new Date().toISOString()});
  }

  async function deleteOwnMessage(message,item){
    if(!window.confirm('Bu mesajı silmek istediğine emin misin?')) return;
    const {error} = await client.rpc('delete_my_chat_message',{p_message_id:message.id});
    if(error){ toast(error.message || 'Mesaj silinemedi.'); return; }
    item.remove();
    toast('Mesaj silindi.');
  }

  async function refreshChatAvatars(){
    document.querySelectorAll('.chat-message').forEach(el=>{
      const id = el.dataset.userId;
      if(!id) return;
      const message = {id:el.id.replace('chat-message-',''),user_id:id};
      const avatar = avatarUrl(message);
      const button = el.querySelector('.chat-avatar-button');
      const name = el.dataset.username || 'Oyuncu';
      if(button){ button.innerHTML = avatar ? `<img src="${esc(avatar)}" alt="${esc(name)}">` : `<span>${esc(name.charAt(0).toLocaleUpperCase('tr-TR')||'O')}</span>`; }
    });
  }

  function addNotificationControls(){
    const head = document.querySelector('.chat-head');
    if(!head || document.getElementById('chat-tools')) return;
    const tools = document.createElement('div');
    tools.id = 'chat-tools';
    tools.className = 'chat-tools';
    tools.innerHTML = '<button class="ghost-button" id="chat-notify" type="button">Bildirimleri Aç</button><button class="ghost-button" id="chat-sound" type="button">Ses Aç</button>';
    head.appendChild(tools);
    document.getElementById('chat-notify').onclick = async()=>{
      if(!('Notification' in window)){ toast('Bu tarayıcı bildirimleri desteklemiyor.'); return; }
      const permission = await Notification.requestPermission();
      if(permission==='granted'){ localStorage.setItem(NOTIFY_KEY,'1'); toast('Bildirimler açıldı.'); } else toast('Bildirim izni verilmedi.');
      updateNotificationButton();
    };
    document.getElementById('chat-sound').onclick = ()=>{
      playNotificationSound(true);
      localStorage.setItem('atlantis-chat-sound','1');
      toast('Mesaj sesi açıldı.');
      updateNotificationButton();
    };
  }

  function updateNotificationButton(){
    const notify = document.getElementById('chat-notify');
    const sound = document.getElementById('chat-sound');
    if(notify) notify.textContent = ('Notification' in window && Notification.permission==='granted') ? 'Bildirimler Açık' : 'Bildirimleri Aç';
    if(sound) sound.textContent = localStorage.getItem('atlantis-chat-sound')==='1' ? 'Ses Açık' : 'Ses Aç';
  }

  function maybeNotify(message){
    const name = displayName(message);
    const text = String(message.message||'');
    if(localStorage.getItem('atlantis-chat-sound')==='1') playNotificationSound(false);
    if(localStorage.getItem(NOTIFY_KEY)==='1' && 'Notification' in window && Notification.permission==='granted' && document.hidden){
      const n = new Notification('Atlantis MC — Yeni mesaj',{body:name+': '+text,tag:'atlantis-chat'});
      n.onclick=()=>{ window.focus(); n.close(); };
    }else toast('💬 '+name+' yeni bir mesaj gönderdi.');
  }

  function playNotificationSound(fromGesture){
    if(!audioContext){ try{audioContext=new (window.AudioContext||window.webkitAudioContext)();}catch{return;} }
    if(audioContext.state==='suspended' && fromGesture) audioContext.resume();
    if(audioContext.state!=='running') return;
    const osc=audioContext.createOscillator(); const gain=audioContext.createGain();
    osc.type='sine'; osc.frequency.value=880;
    gain.gain.setValueAtTime(0.0001,audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.045,audioContext.currentTime+0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001,audioContext.currentTime+0.12);
    osc.connect(gain); gain.connect(audioContext.destination); osc.start(); osc.stop(audioContext.currentTime+0.13);
  }

  function touchLastSeen(){
    if(!currentUser) return;
    client.rpc('touch_my_last_seen').catch(()=>{});
    window.setInterval(()=>client.rpc('touch_my_last_seen').catch(()=>{}),60000);
  }

  function toast(text){
    let el=document.getElementById('chat-toast');
    if(!el){el=document.createElement('div');el.id='chat-toast';el.className='chat-toast';document.body.appendChild(el);}
    el.textContent=text; el.classList.add('show'); clearTimeout(el._timer); el._timer=setTimeout(()=>el.classList.remove('show'),2400);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();

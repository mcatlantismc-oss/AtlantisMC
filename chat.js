(function(){
  'use strict';

  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[c]));

  let lastSent=0;
  let currentUser=null;
  let currentProfile=null;
  let chatChannel=null;
  let presenceChannel=null;
  let audioContext=null;
  let typingTimer=null;
  let lastTypingSent=0;
  let lastSeenTimer=null;

  const NOTIFY_KEY='atlantis-chat-notifications';
  const SOUND_KEY='atlantis-chat-sound';
  const BLOCK_KEY='atlantis-chat-blocked-users';

  let blockedUsers=new Set();
  try{
    blockedUsers=new Set(
      JSON.parse(
        localStorage.getItem(BLOCK_KEY)||'[]'
      )
    );
  }catch{}

  function saveBlocked(){
    try{
      localStorage.setItem(
        BLOCK_KEY,
        JSON.stringify([...blockedUsers])
      );
    }catch{}
  }

  async function getClient(){
    return await window.atlantisAuthReady;
  }

  async function readSession(s){
    const {data:{session}}=
      await s.auth.getSession();
    return session?.user || null;
  }

  async function loadCurrentProfile(s,user){
    if(!s||!user) return null;

    try{
      const {data,error}=await s
        .from('profiles')
        .select('*')
        .eq('id',user.id)
        .maybeSingle();

      if(error) throw error;
      return data || null;
    }catch(error){
      console.error(
        '[Atlantis Chat] profile:',
        error
      );
      return null;
    }
  }

  function showSignedOut(box){
    box.innerHTML=
      '<div class="chat-empty">Sohbete katılmak için <button class="link-button" id="chat-login">Giriş Yap</button>.</div>';

    document.getElementById('chat-login')?.addEventListener(
      'click',
      ()=>window.openAtlantisAuth?.('login')
    );
  }

  async function init(){
    const s=await getClient();
    const box=document.getElementById('chat-messages');
    const form=document.getElementById('chat-form');
    const input=document.getElementById('chat-input');

    if(!box||!form||!input) return;

    addNotificationControls();
    ensureTypingUI();

    if(!s){
      box.innerHTML='<div class="chat-empty">Sohbet sistemi yapılandırılmamış.</div>';
      return;
    }

    await refreshChat(s);

    s.auth.onAuthStateChange((event,session)=>{
      setTimeout(async()=>{
        if(session?.user){
          await refreshChat(s);
        }else{
          stopRealtime();
          currentUser=null;
          currentProfile=null;
          input.disabled=true;
          form.querySelector('button')?.setAttribute('disabled','');
          showSignedOut(box);
        }
      },0);
    });

    window.addEventListener(
      'atlantis-auth-login',
      ()=>setTimeout(()=>refreshChat(s),0),
      {passive:true}
    );

    window.addEventListener(
      'atlantis-auth-logout',
      ()=>{
        stopRealtime();
        currentUser=null;
        currentProfile=null;
        input.disabled=true;
        form.querySelector('button')?.setAttribute('disabled','');
        showSignedOut(box);
      },
      {passive:true}
    );
  }

  async function refreshChat(s){
    const box=document.getElementById('chat-messages');
    const form=document.getElementById('chat-form');
    const input=document.getElementById('chat-input');
    const send=form?.querySelector('button');

    if(!box||!form||!input) return;

    currentUser=await readSession(s);

    if(!currentUser){
      stopRealtime();
      currentProfile=null;
      input.disabled=true;
      if(send)send.disabled=true;
      showSignedOut(box);
      return;
    }

    currentProfile=
      await loadCurrentProfile(s,currentUser) || {};

    const username=
      currentProfile.username ||
      currentUser.user_metadata?.username ||
      '';

    if(!username){
      box.innerHTML=
        '<div class="chat-empty">Kullanıcı profili yüklenemedi. Ana menüdeki hesap bölümünden profilini kontrol et.</div>';
      input.disabled=true;
      if(send)send.disabled=true;
      return;
    }

    const muted=
      currentProfile.muted_until &&
      new Date(currentProfile.muted_until)>new Date();

    input.disabled=Boolean(muted);
    if(send)send.disabled=Boolean(muted);
    if(!muted){
      input.placeholder='Mesajını yaz...';
    }

    await loadMessages(s);
    subscribeChat(s);
    subscribePresence(s,username);
    setupComposer(s,username);
    updateNotificationButton();
    await updateLastSeen(s);

    clearInterval(lastSeenTimer);
    lastSeenTimer=setInterval(
      ()=>updateLastSeen(s),
      60000
    );
  }

  function stopRealtime(){
    try{chatChannel?.unsubscribe();}catch{}
    try{presenceChannel?.unsubscribe();}catch{}
    chatChannel=null;
    presenceChannel=null;
    clearInterval(lastSeenTimer);
    lastSeenTimer=null;
  }

  async function updateLastSeen(s){
    try{
      if(currentUser){
        await s.rpc('touch_my_last_seen');
      }
    }catch(error){
      console.debug('[Atlantis Chat] last_seen:',error);
    }
  }

  async function loadMessages(s){
    const box=document.getElementById('chat-messages');
    const {data,error}=await s
      .from('messages')
      .select('*')
      .order('created_at',{ascending:true})
      .limit(100);

    if(error){
      box.innerHTML='<div class="chat-empty">Sohbet mesajları alınamadı.</div>';
      return;
    }

    box.innerHTML='';
    (data||[]).forEach(addMessage);
    box.scrollTop=box.scrollHeight;
  }

  function formatMessageText(text){
    return esc(text).replace(
      /@([A-Za-zÇĞİÖŞÜçğıöşü0-9]{3,16})/g,
      '<span class="chat-mention">@$1</span>'
    );
  }

  function addMessage(message){
    const box=document.getElementById('chat-messages');
    if(!box) return;

    const userId=String(message.user_id||'');

    if(
      userId!==String(currentUser?.id||'') &&
      blockedUsers.has(userId)
    ) return;

    const existing=document.getElementById(
      'chat-message-'+message.id
    );
    if(existing) existing.remove();

    const username=String(message.username||'Oyuncu');
    const initial=username.trim()
      .charAt(0)
      .toLocaleUpperCase('tr-TR')||'O';

    const time=new Date(message.created_at)
      .toLocaleTimeString('tr-TR',{
        hour:'2-digit',minute:'2-digit'
      });

    const edited=message.edited_at;
    const avatar=message.avatar_url||'';

    const item=document.createElement('article');
    item.className='chat-message';
    item.id='chat-message-'+message.id;
    item.dataset.userId=userId;

    item.innerHTML=`
      <button type="button" class="chat-avatar chat-avatar-button" title="Profili görüntüle">
        ${avatar
          ? `<img src="${esc(avatar)}" alt="${esc(username)}">`
          : `<span>${esc(initial)}</span>`}
      </button>
      <div class="chat-message-body">
        <div class="chat-meta">
          <button type="button" class="chat-user-button">${esc(username)}</button>
          <time>${esc(time)}${edited?' • düzenlendi':''}</time>
        </div>
        <p>${formatMessageText(message.message)}</p>
        ${userId===String(currentUser?.id||'')?`
          <div class="chat-message-actions">
            <button type="button" data-chat-edit>Düzenle</button>
            <button type="button" data-chat-delete>Sil</button>
          </div>`:''}
      </div>
    `;

    box.appendChild(item);

    item.querySelector('.chat-avatar-button')?.addEventListener(
      'click',()=>openUserProfile(message.user_id,username)
    );

    item.querySelector('.chat-user-button')?.addEventListener(
      'click',()=>openUserProfile(message.user_id,username)
    );

    item.querySelector('[data-chat-edit]')?.addEventListener(
      'click',()=>editOwnMessage(message)
    );

    item.querySelector('[data-chat-delete]')?.addEventListener(
      'click',()=>deleteOwnMessage(message)
    );

    const boxEl=box;
    boxEl.scrollTop=boxEl.scrollHeight;
  }

  async function openUserProfile(userId,fallbackUsername){
    const s=await getClient();
    if(!s||!userId) return;

    let profile=null;

    if(String(userId)===String(currentUser?.id||'')){
      profile=currentProfile;
    }else{
      const {data}=await s
        .from('profiles')
        .select('*')
        .eq('id',userId)
        .maybeSingle();
      profile=data||{};
    }

    const full={
      ...(profile||{}),
      username:profile?.username||fallbackUsername||'Oyuncu'
    };

    window.openAtlantisProfileCard?.(
      full,
      userId===currentUser?.id?currentUser:null,
      userId===currentUser?.id
    );
  }

  function subscribeChat(s){
    try{chatChannel?.unsubscribe();}catch{}

    chatChannel=s.channel('atlantis-chat-messages')
      .on('postgres_changes',{
        event:'INSERT',schema:'public',table:'messages'
      },payload=>addMessage(payload.new))
      .on('postgres_changes',{
        event:'UPDATE',schema:'public',table:'messages'
      },payload=>addMessage(payload.new))
      .on('postgres_changes',{
        event:'DELETE',schema:'public',table:'messages'
      },payload=>{
        document.getElementById(
          'chat-message-'+payload.old.id
        )?.remove();
      })
      .on('broadcast',{event:'typing'},payload=>{
        if(payload.payload?.user_id===currentUser?.id)return;
        if(payload.payload?.typing){
          showTyping(payload.payload.username||'Birisi');
        }else{
          hideTyping();
        }
      })
      .subscribe();
  }

  function subscribePresence(s,username){
    const count=document.getElementById('online-count');
    try{presenceChannel?.unsubscribe();}catch{}

    presenceChannel=s.channel(
      'atlantis-chat-presence',
      {config:{presence:{key:currentUser.id}}}
    );

    const render=()=>{
      const state=presenceChannel.presenceState();
      const users=new Set();
      Object.values(state).flat().forEach(entry=>{
        users.add(entry.username||entry.user_id);
      });
      if(count){
        count.textContent=
          `${users.size} oyuncu sohbeti açık`;
      }
    };

    presenceChannel
      .on('presence',{event:'sync'},render)
      .on('presence',{event:'join'},render)
      .on('presence',{event:'leave'},render)
      .subscribe(async status=>{
        if(status==='SUBSCRIBED'){
          await presenceChannel.track({
            username,
            user_id:currentUser.id,
            avatar_url:currentProfile?.avatar_url||''
          });
          render();
        }
      });
  }

  function setupComposer(s,username){
    const form=document.getElementById('chat-form');
    const input=document.getElementById('chat-input');
    const button=form?.querySelector('button');
    if(!form||!input)return;

    input.oninput=()=>{
      broadcastTyping(username,true);
      clearTimeout(typingTimer);
      typingTimer=setTimeout(
        ()=>broadcastTyping(username,false),900
      );
    };

    input.onblur=()=>broadcastTyping(username,false);

    form.onsubmit=async event=>{
      event.preventDefault();

      const remaining=3000-(Date.now()-lastSent);
      if(remaining>0){
        toast(
          'Yeni mesaj için '+
          Math.ceil(remaining/1000)+
          ' saniye bekle.'
        );
        return;
      }

      const text=input.value.trim();
      if(!text)return;
      if(text.length>300){
        toast('Mesaj en fazla 300 karakter olabilir.');
        return;
      }

      if(button)button.disabled=true;

      const {data,error}=await s.rpc(
        'send_chat_message',
        {p_message:text}
      );

      if(error){
        toast(error.message||'Mesaj gönderilemedi.');
        if(button)button.disabled=false;
        return;
      }

      input.value='';
      lastSent=Date.now();
      broadcastTyping(username,false);

      if(button)button.disabled=false;

      if(data?.muted_until){
        disableComposer('Sohbet kullanımın kısıtlandı.');
      }
    };
  }

  async function broadcastTyping(username,typing){
    const now=Date.now();
    if(typing&&now-lastTypingSent<700)return;
    lastTypingSent=now;

    try{
      await chatChannel?.send({
        type:'broadcast',
        event:'typing',
        payload:{
          user_id:currentUser?.id,
          username,
          typing:Boolean(typing)
        }
      });
    }catch{}
  }

  function ensureTypingUI(){
    const panel=document.querySelector('.chat-panel');
    if(!panel||document.getElementById('chat-typing'))return;

    const el=document.createElement('div');
    el.id='chat-typing';
    el.className='chat-typing';
    el.setAttribute('aria-live','polite');
    panel.insertBefore(
      el,
      document.getElementById('chat-form')
    );
  }

  function showTyping(name){
    const el=document.getElementById('chat-typing');
    if(el){
      el.innerHTML=
        `<span>${esc(name)} yazıyor</span><i></i><i></i><i></i>`;
    }
  }

  function hideTyping(){
    const el=document.getElementById('chat-typing');
    if(el)el.textContent='';
  }

  async function editOwnMessage(message){
    const next=window.prompt(
      'Mesajını düzenle:',
      String(message.message||'')
    );
    if(next===null)return;

    const text=next.trim();
    if(!text||text.length>300){
      toast('Mesaj 1-300 karakter olmalı.');
      return;
    }

    const s=await getClient();
    if(!s)return;

    const {error}=await s
      .from('messages')
      .update({
        message:text,
        edited_at:new Date().toISOString()
      })
      .eq('id',message.id)
      .eq('user_id',currentUser.id);

    if(error){
      toast(error.message||'Mesaj düzenlenemedi.');
      return;
    }

    toast('Mesaj düzenlendi.');
  }

  async function deleteOwnMessage(message){
    if(!window.confirm('Bu mesajı silmek istediğine emin misin?'))return;

    const s=await getClient();
    if(!s)return;

    const {error}=await s
      .from('messages')
      .delete()
      .eq('id',message.id)
      .eq('user_id',currentUser.id);

    if(error){
      toast(error.message||'Mesaj silinemedi.');
      return;
    }

    document.getElementById(
      'chat-message-'+message.id
    )?.remove();

    toast('Mesaj silindi.');
  }

  function disableComposer(text){
    const input=document.getElementById('chat-input');
    const button=document.querySelector('#chat-form button');
    if(input){
      input.disabled=true;
      input.placeholder=text||'Sohbet kullanılamıyor';
    }
    if(button)button.disabled=true;
  }

  function addNotificationControls(){
    const head=document.querySelector('.chat-head');
    if(!head||document.getElementById('chat-tools'))return;

    const tools=document.createElement('div');
    tools.id='chat-tools';
    tools.className='chat-tools';
    tools.innerHTML=
      '<button class="ghost-button" id="chat-notify" type="button">Bildirimler</button>'+
      '<button class="ghost-button" id="chat-sound" type="button">Ses</button>';

    head.appendChild(tools);

    document.getElementById('chat-notify').onclick=async()=>{
      if(!('Notification' in window)){
        toast('Bu tarayıcı bildirimleri desteklemiyor.');
        return;
      }
      const permission=await Notification.requestPermission();
      if(permission==='granted'){
        localStorage.setItem(NOTIFY_KEY,'1');
        toast('Bildirimler açıldı.');
      }else{
        toast('Bildirim izni verilmedi.');
      }
      updateNotificationButton();
    };

    document.getElementById('chat-sound').onclick=()=>{
      playNotificationSound(true);
      localStorage.setItem(SOUND_KEY,'1');
      toast('Mesaj sesi açıldı.');
      updateNotificationButton();
    };

    updateNotificationButton();
  }

  function updateNotificationButton(){
    const notify=document.getElementById('chat-notify');
    const sound=document.getElementById('chat-sound');
    if(notify){
      notify.textContent=
        ('Notification' in window&&Notification.permission==='granted')
          ? 'Bildirimler Açık'
          : 'Bildirimleri Aç';
    }
    if(sound){
      sound.textContent=
        localStorage.getItem(SOUND_KEY)==='1'
          ? 'Ses Açık'
          : 'Ses Aç';
    }
  }

  function maybeNotify(message){
    const soundEnabled=
      localStorage.getItem(SOUND_KEY)==='1';

    if(soundEnabled)playNotificationSound(false);

    if(
      localStorage.getItem(NOTIFY_KEY)==='1'&&
      'Notification' in window&&
      Notification.permission==='granted'&&
      document.hidden
    ){
      const n=new Notification(
        'Atlantis MC — Yeni mesaj',
        {
          body:
            message.username+': '+message.message,
          tag:'atlantis-chat'
        }
      );
      n.onclick=()=>{
        window.focus();
        n.close();
      };
    }
  }

  function playNotificationSound(fromGesture){
    if(!audioContext){
      try{
        audioContext=new(
          window.AudioContext||
          window.webkitAudioContext
        )();
      }catch{
        return;
      }
    }

    if(
      audioContext.state==='suspended'&&
      fromGesture
    )audioContext.resume();

    if(audioContext.state!=='running')return;

    const osc=audioContext.createOscillator();
    const gain=audioContext.createGain();
    osc.type='sine';
    osc.frequency.value=880;
    gain.gain.setValueAtTime(
      0.0001,
      audioContext.currentTime
    );
    gain.gain.exponentialRampToValueAtTime(
      0.045,
      audioContext.currentTime+0.01
    );
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      audioContext.currentTime+0.12
    );
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime+0.13);
  }

  function toast(text){
    let el=document.getElementById('chat-toast');
    if(!el){
      el=document.createElement('div');
      el.id='chat-toast';
      el.className='chat-toast';
      document.body.appendChild(el);
    }

    el.textContent=text;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer=setTimeout(
      ()=>el.classList.remove('show'),
      2200
    );
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',init,{once:true});
  }else{
    init();
  }
})();

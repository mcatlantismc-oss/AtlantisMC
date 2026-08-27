/* Atlantis MC — FINAL chat.js */
(() => {
  'use strict';

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[c]));

  let client=null;
  let currentUser=null;
  let currentProfile=null;
  let realtime=null;
  let presence=null;
  let presenceKey='';
  let typingTimer=null;
  let lastTyping=0;
  let lastSend=0;
  let initialized=false;

  async function init(){
    if(initialized)return;
    initialized=true;

    const box=document.getElementById('chat-messages');
    const form=document.getElementById('chat-form');
    const input=document.getElementById('chat-input');
    if(!box||!form||!input)return;

    client=await window.atlantisGetClient?.();
    if(!client){
      setChatStatus('Sohbet bağlantısı kurulamadı.');
      return;
    }

    await refreshSession();
    setupToolbar();
    setupComposer(form,input);
    setupAuthListeners();
    await loadMessages();
    subscribeRealtime();
    subscribePresence();
  }

  async function refreshSession(){
    const {data:{session}}=await client.auth.getSession();
    currentUser=session?.user||null;

    if(currentUser){
      const {data}=await client
        .from('profiles')
        .select('*')
        .eq('id',currentUser.id)
        .maybeSingle();
      currentProfile=data||{};
    }else{
      currentProfile=null;
    }

    updateComposer();
  }

  function setupAuthListeners(){
    window.addEventListener('atlantis-auth-login',async e=>{
      currentUser=e.detail?.user||null;
      if(currentUser){
        const {data}=await client
          .from('profiles')
          .select('*')
          .eq('id',currentUser.id)
          .maybeSingle();
        currentProfile=data||{};
      }
      updateComposer();
      subscribePresence();
    });

    window.addEventListener('atlantis-auth-logout',()=>{
      currentUser=null;
      currentProfile=null;
      updateComposer();
      subscribePresence();
    });
  }

  function updateComposer(){
    const input=document.getElementById('chat-input');
    const button=document.querySelector('#chat-form button[type="submit"]');
    if(!input)return;
    input.disabled=false;
    if(button)button.disabled=false;
    input.placeholder=currentUser
      ? 'Mesajını yaz...'
      : 'Anonim olarak mesajını yaz...';
  }

  async function loadMessages(){
    const box=document.getElementById('chat-messages');
    const {data,error}=await client
      .from('messages')
      .select('id,user_id,username,message,created_at,edited_at,avatar_url')
      .order('created_at',{ascending:true})
      .limit(200);

    if(error){
      setChatStatus('Sohbet mesajları alınamadı.');
      console.error('[Atlantis Chat] load',error);
      return;
    }

    box.innerHTML='';
    for(const item of data||[])renderMessage(item,false);
    box.scrollTop=box.scrollHeight;
  }

  function setChatStatus(text){
    const box=document.getElementById('chat-messages');
    if(box)box.innerHTML=`<div class="chat-empty">${esc(text)}</div>`;
  }

  function setupComposer(form,input){
    form.onsubmit=async event=>{
      event.preventDefault();
      const text=input.value.trim();
      if(!text)return;

      if(text.length>300){
        toast('Mesaj en fazla 300 karakter olabilir.');
        return;
      }

      const wait=3000-(Date.now()-lastSend);
      if(wait>0){
        toast(`Yeni mesaj için ${Math.ceil(wait/1000)} saniye bekle.`);
        return;
      }

      const button=form.querySelector('button[type="submit"]');
      button.disabled=true;
      button.textContent='Gönderiliyor...';

      try{
        const rpc=currentUser
          ? 'send_chat_message'
          : 'send_anonymous_chat_message';

        const {error}=await client.rpc(rpc,{p_message:text});
        if(error)throw error;

        input.value='';
        lastSend=Date.now();
        broadcastTyping(false);
      }catch(error){
        console.error('[Atlantis Chat] send',error);
        toast(error?.message||'Mesaj gönderilemedi.');
      }finally{
        button.disabled=false;
        button.textContent='Gönder';
      }
    };

    input.addEventListener('input',()=>{
      broadcastTyping(true);
      clearTimeout(typingTimer);
      typingTimer=setTimeout(()=>broadcastTyping(false),900);
    });

    input.addEventListener('blur',()=>broadcastTyping(false));
  }

  function renderMessage(message,animate=true){
    const box=document.getElementById('chat-messages');
    if(!box)return;

    const id=`chat-message-${message.id}`;
    if(document.getElementById(id)){
      return;
    }

    const anonymous=!message.user_id || message.username==='Anonim';
    const username=anonymous?'Anonim':(message.username||'Oyuncu');
    const time=new Date(message.created_at);
    const dateText=Number.isNaN(time.getTime())
      ? ''
      : time.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});

    const item=document.createElement('article');
    item.id=id;
    item.className='chat-message'+(animate?' chat-message-in':'');
    item.dataset.userId=message.user_id||'';

    const initial=username.charAt(0).toLocaleUpperCase('tr-TR')||'A';

    item.innerHTML=`
      <button
        type="button"
        class="chat-avatar chat-avatar-button"
        ${anonymous?'disabled':''}
        aria-label="${anonymous?'Anonim kullanıcı':'Profili görüntüle'}"
      >
        ${
          message.avatar_url&&!anonymous
            ? `<img src="${esc(message.avatar_url)}" alt="">`
            : `<span>${esc(initial)}</span>`
        }
      </button>

      <div class="chat-message-body">
        <div class="chat-meta">
          ${
            anonymous
              ? `<button type="button" class="chat-user-button chat-user-anonymous">Anonim</button>`
              : `<button type="button" class="chat-user-button">${esc(username)}</button>`
          }
          ${
            anonymous
              ? `<span class="anonymous-badge">Misafir</span>`
              : ''
          }
          <time>${esc(dateText)}</time>
          ${message.edited_at?'<span class="chat-edited">düzenlendi</span>':''}
        </div>

        <p class="chat-message-text">${esc(message.message)}</p>

        ${
          currentUser &&
          message.user_id===currentUser.id
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

    box.appendChild(item);

    if(!anonymous && message.user_id){
      item.querySelector('.chat-avatar-button').onclick=()=>openProfile(message.user_id,username);
      item.querySelector('.chat-user-button').onclick=()=>openProfile(message.user_id,username);
    }

    item.querySelector('[data-chat-edit]')?.addEventListener(
      'click',
      ()=>editMessage(message)
    );

    item.querySelector('[data-chat-delete]')?.addEventListener(
      'click',
      ()=>deleteMessage(message)
    );

    if(animate){
      requestAnimationFrame(()=>{
        requestAnimationFrame(()=>{
          item.classList.add('is-visible');
        });
      });
    }
  }

  async function openProfile(userId,fallback){
    const {data}=await client
      .from('profiles')
      .select('*')
      .eq('id',userId)
      .maybeSingle();

    if(!data){
      toast(`${fallback||'Kullanıcı'} profili bulunamadı.`);
      return;
    }

    if(window.openAtlantisUserDrawer){
      window.openAtlantisUserDrawer(data);
    }
  }

  function subscribeRealtime(){
    realtime?.unsubscribe();

    realtime=client
      .channel('atlantis-chat-messages')
      .on('postgres_changes',{
        event:'INSERT',
        schema:'public',
        table:'messages'
      },payload=>{
        renderMessage(payload.new,true);
        const box=document.getElementById('chat-messages');
        box.scrollTo({
          top:box.scrollHeight,
          behavior:'smooth'
        });
      })
      .on('postgres_changes',{
        event:'UPDATE',
        schema:'public',
        table:'messages'
      },payload=>{
        const old=document.getElementById(`chat-message-${payload.new.id}`);
        old?.remove();
        renderMessage(payload.new,true);
      })
      .on('postgres_changes',{
        event:'DELETE',
        schema:'public',
        table:'messages'
      },payload=>{
        const old=document.getElementById(`chat-message-${payload.old.id}`);
        old?.classList.add('chat-message-out');
        setTimeout(()=>old?.remove(),180);
      })
      .on('broadcast',{event:'typing'},payload=>{
        if(payload.payload?.key===presenceKey)return;
        if(payload.payload?.typing)showTyping(payload.payload.username||'Anonim');
        else hideTyping();
      })
      .subscribe();
  }

  function subscribePresence(){
    presence?.unsubscribe();

    presenceKey=currentUser?.id||getAnonKey();

    const name=currentUser
      ? currentProfile?.username||currentUser.user_metadata?.username||'Oyuncu'
      : 'Anonim';

    presence=client.channel(
      'atlantis-chat-presence',
      {config:{presence:{key:presenceKey}}}
    );

    const update=()=>{
      const state=presence.presenceState();
      const unique=new Map();

      Object.values(state).flat().forEach(entry=>{
        const key=entry.key||entry.username||Math.random().toString();
        unique.set(key,entry);
      });

      const count=document.getElementById('online-count');
      if(count){
        count.textContent=
          `${unique.size} ${unique.size===1?'kişi':'kişi'} sohbeti açık`;
      }
    };

    presence
      .on('presence',{event:'sync'},update)
      .on('presence',{event:'join'},update)
      .on('presence',{event:'leave'},update)
      .subscribe(async status=>{
        if(status==='SUBSCRIBED'){
          await presence.track({
            key:presenceKey,
            username:name,
            avatar_url:currentProfile?.avatar_url||''
          });
          update();
        }
      });
  }

  function getAnonKey(){
    const key='atlantis-anonymous-chat-key';
    let value=localStorage.getItem(key);
    if(!value){
      value=`anon-${crypto?.randomUUID?.()||Date.now()+'-'+Math.random().toString(36).slice(2)}`;
      localStorage.setItem(key,value);
    }
    return value;
  }

  async function broadcastTyping(typing){
    if(!chatChannelReady())return;

    if(typing && Date.now()-lastTyping<650)return;
    lastTyping=Date.now();

    try{
      await realtime.send({
        type:'broadcast',
        event:'typing',
        payload:{
          key:presenceKey,
          username:currentUser
            ? currentProfile?.username||currentUser.user_metadata?.username||'Oyuncu'
            : 'Anonim',
          typing
        }
      });
    }catch{}
  }

  function chatChannelReady(){
    return Boolean(realtime && presenceKey);
  }

  function showTyping(name){
    let el=document.getElementById('chat-typing');
    if(!el){
      const panel=document.querySelector('.chat-panel');
      if(!panel)return;
      el=document.createElement('div');
      el.id='chat-typing';
      el.className='chat-typing';
      panel.insertBefore(el,document.getElementById('chat-form'));
    }
    el.innerHTML=`<span>${esc(name)} yazıyor</span><i></i><i></i><i></i>`;
  }

  function hideTyping(){
    const el=document.getElementById('chat-typing');
    if(el)el.textContent='';
  }

  async function editMessage(message){
    if(!currentUser)return;

    const text=window.prompt('Mesajını düzenle:',message.message);
    if(text===null)return;

    const value=text.trim();
    if(!value||value.length>300){
      toast('Mesaj 1-300 karakter olmalı.');
      return;
    }

    const {error}=await client
      .from('messages')
      .update({
        message:value,
        edited_at:new Date().toISOString()
      })
      .eq('id',message.id)
      .eq('user_id',currentUser.id);

    if(error)toast(error.message||'Mesaj düzenlenemedi.');
  }

  async function deleteMessage(message){
    if(!currentUser)return;

    if(!window.confirm('Bu mesajı silmek istediğine emin misin?')){
      return;
    }

    const {error}=await client
      .from('messages')
      .delete()
      .eq('id',message.id)
      .eq('user_id',currentUser.id);

    if(error)toast(error.message||'Mesaj silinemedi.');
  }

  function setupToolbar(){
    const head=document.querySelector('.chat-head');
    if(!head || document.getElementById('chat-tools'))return;

    const tools=document.createElement('div');
    tools.id='chat-tools';
    tools.className='chat-tools';
    tools.innerHTML=`
      <button id="chat-notify" class="ghost-button" type="button">Bildirimleri Aç</button>
      <button id="chat-sound" class="ghost-button" type="button">Ses Aç</button>
    `;
    head.appendChild(tools);

    const soundKey='atlantis-chat-sound';
    let sound=localStorage.getItem(soundKey)==='1';

    const update=()=>{
      const n=document.getElementById('chat-notify');
      const s=document.getElementById('chat-sound');
      if(n)n.textContent=
        'Notification' in window &&
        Notification.permission==='granted'
          ? 'Bildirimler Açık'
          : 'Bildirimleri Aç';
      if(s)s.textContent=sound?'Ses Açık':'Ses Aç';
    };

    document.getElementById('chat-notify').onclick=async()=>{
      if(!('Notification' in window)){
        toast('Tarayıcı bildirimleri desteklemiyor.');
        return;
      }
      const permission=await Notification.requestPermission();
      if(permission==='granted'){
        localStorage.setItem('atlantis-chat-notifications','1');
        toast('Bildirimler açıldı.');
      }
      update();
    };

    document.getElementById('chat-sound').onclick=()=>{
      sound=!sound;
      localStorage.setItem(soundKey,sound?'1':'0');
      update();
      if(sound)playSound(true);
    };

    update();

    window.atlantisPlayChatNotification=message=>{
      if(sound)playSound(false);

      if(
        document.hidden &&
        localStorage.getItem('atlantis-chat-notifications')==='1' &&
        'Notification' in window &&
        Notification.permission==='granted'
      ){
        new Notification(
          `Atlantis MC — ${message.username||'Anonim'}`,
          {body:message.message}
        );
      }
    };
  }

  let audio=null;
  function playSound(fromGesture){
    try{
      audio ||= new (window.AudioContext||window.webkitAudioContext)();
      if(audio.state==='suspended'&&fromGesture)audio.resume();
      if(audio.state!=='running')return;

      const osc=audio.createOscillator();
      const gain=audio.createGain();
      osc.frequency.value=880;
      gain.gain.setValueAtTime(.0001,audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(.04,audio.currentTime+.01);
      gain.gain.exponentialRampToValueAtTime(.0001,audio.currentTime+.12);
      osc.connect(gain); gain.connect(audio.destination);
      osc.start(); osc.stop(audio.currentTime+.13);
    }catch{}
  }

  function toast(text){
    if(window.atlantisToast)window.atlantisToast(text);
    else{
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
      el._timer=setTimeout(()=>el.classList.remove('show'),2400);
    }
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',init,{once:true});
  }else{
    init();
  }
})();

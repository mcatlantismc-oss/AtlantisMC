/* Atlantis MC — FINAL chat.js
   Public anonymous chat + authenticated profiles + realtime + presence.
*/
(() => {
  'use strict';

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[c]));

  let client=null;
  let currentUser=null;
  let currentProfile=null;
  let chatChannel=null;
  let presenceChannel=null;
  let initialized=false;
  let lastSent=0;
  let lastTyping=0;
  let typingTimer=null;

  async function init(){
    if(initialized)return;
    initialized=true;

    const box=document.getElementById('chat-messages');
    const form=document.getElementById('chat-form');
    const input=document.getElementById('chat-input');

    if(!box||!form||!input)return;

    client=await window.atlantisGetClient?.();
    if(!client){
      box.innerHTML='<div class="chat-empty">Sohbet bağlantısı kurulamadı.</div>';
      return;
    }

    setupToolbar();
    setupComposer(form,input);
    setupAuthListeners();

    await refreshIdentity();
    await loadMessages();
    subscribeMessages();
    subscribePresence();
    updateComposer();
  }

  async function refreshIdentity(){
    const {data:{session}}=await client.auth.getSession();
    currentUser=session?.user||null;

    if(currentUser){
      const {data}=await client.from('profiles').select('*').eq('id',currentUser.id).maybeSingle();
      currentProfile=data||{};
    }else{
      currentProfile=null;
    }
  }

  function setupAuthListeners(){
    client.auth.onAuthStateChange(()=>{
      setTimeout(async()=>{
        await refreshIdentity();
        updateComposer();
        subscribePresence();
      },0);
    });

    window.addEventListener('atlantis-profile-updated',async event=>{
      currentProfile=event.detail?.profile||currentProfile||{};
      updateComposer();
      subscribePresence();
      // Refresh existing message avatar/nick data.
      await loadMessages();
    });
  }

  async function loadMessages(){
    const box=document.getElementById('chat-messages');
    if(!box)return;

    const {data,error}=await client
      .from('messages')
      .select('id,user_id,username,message,created_at,edited_at,avatar_url')
      .order('created_at',{ascending:true})
      .limit(200);

    if(error){
      console.error('[Atlantis Chat] load messages',error);
      box.innerHTML='<div class="chat-empty">Sohbet mesajları alınamadı.</div>';
      return;
    }

    box.innerHTML='';
    (data||[]).forEach(m=>renderMessage(m,false));
    box.scrollTop=box.scrollHeight;
  }

  function renderMessage(message,animate=true){
    const box=document.getElementById('chat-messages');
    if(!box)return;

    const id=`chat-message-${message.id}`;
    if(document.getElementById(id))return;

    const anonymous=!message.user_id || message.username==='Anonim';
    const username=anonymous?'Anonim':(message.username||'Oyuncu');
    const time=new Date(message.created_at);
    const timeText=Number.isNaN(time.getTime())?'':time.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});
    const initial=username.charAt(0).toLocaleUpperCase('tr-TR')||'A';

    const item=document.createElement('article');
    item.id=id;
    item.className='chat-message'+(animate?' chat-message-in':'');
    item.dataset.userId=message.user_id||'';

    item.innerHTML=`
      <button type="button" class="chat-avatar chat-avatar-button" ${anonymous?'disabled':''} aria-label="${anonymous?'Anonim kullanıcı':'Profili görüntüle'}">
        ${
          !anonymous && message.avatar_url
          ? `<img src="${esc(message.avatar_url)}" alt="">`
          : `<span>${esc(initial)}</span>`
        }
      </button>
      <div class="chat-message-body">
        <div class="chat-meta">
          <button type="button" class="chat-user-button ${anonymous?'chat-user-anonymous':''}">
            ${esc(username)}
          </button>
          ${anonymous?'<span class="anonymous-badge">Misafir</span>':''}
          <time>${esc(timeText)}</time>
          ${message.edited_at?'<span class="chat-edited">düzenlendi</span>':''}
        </div>
        <p class="chat-message-text">${formatText(message.message)}</p>
        ${
          currentUser && message.user_id===currentUser.id
          ? `<div class="chat-message-actions">
               <button type="button" data-edit>Düzenle</button>
               <button type="button" data-delete>Sil</button>
             </div>`
          : ''
        }
      </div>
    `;

    box.appendChild(item);

    if(!anonymous&&message.user_id){
      item.querySelector('.chat-avatar-button').onclick=()=>openProfile(message.user_id,username);
      item.querySelector('.chat-user-button').onclick=()=>openProfile(message.user_id,username);
    }

    item.querySelector('[data-edit]')?.addEventListener('click',()=>editMessage(message));
    item.querySelector('[data-delete]')?.addEventListener('click',()=>deleteMessage(message));

    if(animate){
      requestAnimationFrame(()=>requestAnimationFrame(()=>item.classList.add('is-visible')));
      box.scrollTo({top:box.scrollHeight,behavior:'smooth'});
    }
  }

  function formatText(text){
    return esc(text).replace(/@([A-Za-zÇĞİÖŞÜçğıöşü0-9]{3,16})/g,'<span class="chat-mention">@$1</span>');
  }

  async function openProfile(userId,fallback){
    const {data}=await client.from('profiles').select('*').eq('id',userId).maybeSingle();
    if(window.openAtlantisUserDrawer){
      window.openAtlantisUserDrawer({...data,username:data?.username||fallback||'Oyuncu'});
    }
  }

  function subscribeMessages(){
    chatChannel?.unsubscribe?.();

    chatChannel=client.channel('atlantis-chat-messages')
      .on('postgres_changes',{
        event:'INSERT',schema:'public',table:'messages'
      },payload=>{
        renderMessage(payload.new,true);
        notifyNewMessage(payload.new);
      })
      .on('postgres_changes',{
        event:'UPDATE',schema:'public',table:'messages'
      },payload=>{
        const old=document.getElementById(`chat-message-${payload.new.id}`);
        old?.remove();
        renderMessage(payload.new,true);
      })
      .on('postgres_changes',{
        event:'DELETE',schema:'public',table:'messages'
      },payload=>{
        const old=document.getElementById(`chat-message-${payload.old.id}`);
        old?.classList.add('chat-message-out');
        setTimeout(()=>old?.remove(),180);
      })
      .on('broadcast',{event:'typing'},payload=>{
        if(payload.payload?.key===presenceKey())return;
        if(payload.payload?.typing)showTyping(payload.payload.username||'Anonim');
        else hideTyping();
      })
      .subscribe();
  }

  function presenceKey(){
    if(currentUser?.id)return currentUser.id;
    let key=localStorage.getItem('atlantis-anon-presence');
    if(!key){
      key='anon-'+(window.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem('atlantis-anon-presence',key);
    }
    return key;
  }

  function subscribePresence(){
    presenceChannel?.unsubscribe?.();

    const key=presenceKey();
    const username=currentUser
      ? currentProfile?.username||currentUser.user_metadata?.username||'Oyuncu'
      : 'Anonim';

    presenceChannel=client.channel('atlantis-chat-presence',{
      config:{presence:{key}}
    });

    const render=()=>{
      const state=presenceChannel.presenceState();
      const people=new Set();
      Object.values(state).flat().forEach(entry=>{
        people.add(entry?.key||entry?.username||'anon');
      });
      const el=document.getElementById('online-count');
      if(el)el.textContent=`${people.size} ${people.size===1?'kişi':'kişi'} sohbeti açık`;
    };

    presenceChannel
      .on('presence',{event:'sync'},render)
      .on('presence',{event:'join'},render)
      .on('presence',{event:'leave'},render)
      .subscribe(async status=>{
        if(status==='SUBSCRIBED'){
          await presenceChannel.track({
            key,
            username,
            user_id:currentUser?.id||null,
            avatar_url:currentProfile?.avatar_url||null
          });
          render();
        }
      });
  }

  function setupComposer(form,input){
    form.onsubmit=async e=>{
      e.preventDefault();
      const text=input.value.trim();
      if(!text)return;
      if(text.length>300){toast('Mesaj en fazla 300 karakter olabilir.');return;}

      const wait=3000-(Date.now()-lastSent);
      if(wait>0){toast(`Yeni mesaj için ${Math.ceil(wait/1000)} saniye bekle.`);return;}

      const button=form.querySelector('button[type=submit]');
      button.disabled=true;button.textContent='Gönderiliyor...';

      try{
        const rpc=currentUser?'send_chat_message':'send_anonymous_chat_message';
        const {error}=await client.rpc(rpc,{p_message:text});
        if(error)throw error;
        input.value='';
        lastSent=Date.now();
        broadcastTyping(false);
      }catch(error){
        console.error('[Atlantis Chat] send',error);
        toast(error?.message||'Mesaj gönderilemedi.');
      }finally{
        button.disabled=false;button.textContent='Gönder';
      }
    };

    input.addEventListener('input',()=>{
      broadcastTyping(true);
      clearTimeout(typingTimer);
      typingTimer=setTimeout(()=>broadcastTyping(false),900);
    });
    input.addEventListener('blur',()=>broadcastTyping(false));
  }

  function updateComposer(){
    const input=document.getElementById('chat-input');
    const button=document.querySelector('#chat-form button[type=submit]');
    if(!input)return;
    input.disabled=false;
    if(button)button.disabled=false;
    input.placeholder=currentUser?'Mesajını yaz...':'Anonim olarak mesajını yaz...';
  }

  async function broadcastTyping(typing){
    try{
      await chatChannel?.send({
        type:'broadcast',
        event:'typing',
        payload:{
          key:presenceKey(),
          username:currentUser
            ? currentProfile?.username||currentUser.user_metadata?.username||'Oyuncu'
            : 'Anonim',
          typing
        }
      });
    }catch{}
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
    const next=prompt('Mesajını düzenle:',message.message||'');
    if(next===null)return;
    const value=next.trim();
    if(!value||value.length>300){toast('Mesaj 1-300 karakter olmalı.');return;}

    const {error}=await client.from('messages').update({
      message:value,
      edited_at:new Date().toISOString()
    }).eq('id',message.id).eq('user_id',currentUser.id);

    if(error)toast(error.message||'Mesaj düzenlenemedi.');
  }

  async function deleteMessage(message){
    if(!currentUser)return;
    if(!confirm('Bu mesajı silmek istediğine emin misin?'))return;

    const {error}=await client.from('messages')
      .delete().eq('id',message.id).eq('user_id',currentUser.id);

    if(error)toast(error.message||'Mesaj silinemedi.');
  }

  function setupToolbar(){
    const head=document.querySelector('.chat-head');
    if(!head||document.getElementById('chat-tools'))return;

    const tools=document.createElement('div');
    tools.id='chat-tools';
    tools.className='chat-tools';
    tools.innerHTML=`
      <button id="chat-notify" class="ghost-button" type="button">Bildirimleri Aç</button>
      <button id="chat-sound" class="ghost-button" type="button">Ses Aç</button>`;
    head.appendChild(tools);

    let sound=localStorage.getItem('atlantis-chat-sound')==='1';

    const update=()=>{
      const notify=document.getElementById('chat-notify');
      const snd=document.getElementById('chat-sound');
      if(notify)notify.textContent=('Notification'in window&&Notification.permission==='granted')?'Bildirimler Açık':'Bildirimleri Aç';
      if(snd)snd.textContent=sound?'Ses Açık':'Ses Aç';
    };

    document.getElementById('chat-notify').onclick=async()=>{
      if(!('Notification'in window)){toast('Tarayıcı bildirimleri desteklemiyor.');return;}
      const permission=await Notification.requestPermission();
      if(permission==='granted'){
        localStorage.setItem('atlantis-chat-notifications','1');
        toast('Bildirimler açıldı.');
      }
      update();
    };

    document.getElementById('chat-sound').onclick=()=>{
      sound=!sound;
      localStorage.setItem('atlantis-chat-sound',sound?'1':'0');
      update();
      if(sound)playSound(true);
    };

    update();
  }

  let audioCtx=null;
  function playSound(gesture){
    try{
      audioCtx ||= new (window.AudioContext||window.webkitAudioContext)();
      if(audioCtx.state==='suspended'&&gesture)audioCtx.resume();
      if(audioCtx.state!=='running')return;
      const o=audioCtx.createOscillator();
      const g=audioCtx.createGain();
      o.frequency.value=880;
      g.gain.setValueAtTime(.0001,audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(.04,audioCtx.currentTime+.01);
      g.gain.exponentialRampToValueAtTime(.0001,audioCtx.currentTime+.12);
      o.connect(g);g.connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+.13);
    }catch{}
  }

  function notifyNewMessage(message){
    if(message.user_id===currentUser?.id)return;
    if(localStorage.getItem('atlantis-chat-sound')==='1')playSound(false);

    if(
      document.hidden &&
      localStorage.getItem('atlantis-chat-notifications')==='1' &&
      'Notification'in window &&
      Notification.permission==='granted'
    ){
      new Notification(`Atlantis MC — ${message.username||'Anonim'}`,{
        body:message.message,
        tag:`atlantis-${message.id}`
      });
    }
  }

  function toast(text){
    if(window.atlantisToast){window.atlantisToast(text);return;}
    let el=document.getElementById('chat-toast');
    if(!el){
      el=document.createElement('div');
      el.id='chat-toast';el.className='chat-toast';
      document.body.appendChild(el);
    }
    el.textContent=text;el.classList.add('show');
    clearTimeout(el._timer);
    el._timer=setTimeout(()=>el.classList.remove('show'),2400);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();

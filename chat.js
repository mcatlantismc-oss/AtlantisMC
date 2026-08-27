(function(){
  'use strict';

  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  let lastSent=0;
  let currentUser=null;
  let chatChannel=null;
  let presenceChannel=null;
  let audioContext=null;
  const NOTIFY_KEY='atlantis-chat-notifications';

  async function init(){
    const s=await window.atlantisAuthReady;
    const box=document.getElementById('chat-messages');
    const form=document.getElementById('chat-form');
    const input=document.getElementById('chat-input');
    const send=form?.querySelector('button');
    if(!box||!form||!input)return;
    addNotificationControls();
    if(!s){box.innerHTML='<div class="chat-empty">Sohbet sistemi henüz yapılandırılmamış.</div>';return;}

    const {data:{session}}=await s.auth.getSession();
    currentUser=session?.user||null;
    if(!currentUser){
      box.innerHTML='<div class="chat-empty">Sohbete katılmak için <button class="link-button" id="chat-login">Giriş Yap</button>.</div>';
      document.getElementById('chat-login')?.addEventListener('click',()=>window.openAtlantisAuth?.('login'));
      return;
    }

    const {data:profile}=await s.from('profiles').select('username,site_role,muted_until').eq('id',currentUser.id).maybeSingle();
    if(!profile?.username){
      box.innerHTML='<div class="chat-empty">Sohbete yazmak için önce Atlantis kullanıcı adını belirlemelisin.</div>';
      window.openAtlantisAuth?.('complete');
      return;
    }

    const muted=profile.muted_until && new Date(profile.muted_until)>new Date();
    if(muted){
      disableComposer('Sohbet kullanımın geçici olarak kısıtlandı.');
    }else{
      input.disabled=false;
      if(send)send.disabled=false;
    }

    await loadMessages(s);
    subscribeChat(s);
    subscribePresence(s,profile.username);
    setupComposer(s,profile.username);
    updateNotificationButton();
  }

  async function loadMessages(s){
    const box=document.getElementById('chat-messages');
    const {data,error}=await s.from('messages').select('id,user_id,username,message,created_at').order('created_at',{ascending:true}).limit(100);
    if(error){box.innerHTML='<div class="chat-empty">Sohbet mesajları alınamadı.</div>';return;}
    box.innerHTML='';
    (data||[]).forEach(addMessage);
    box.scrollTop=box.scrollHeight;
  }

  function addMessage(message){
    const box=document.getElementById('chat-messages');
    if(!box)return;
    if(document.getElementById('chat-message-'+message.id))return;
    const item=document.createElement('article');
    item.className='chat-message';
    item.id='chat-message-'+message.id;
    const initial=String(message.username||'O').trim().charAt(0).toLocaleUpperCase('tr-TR')||'O';
    const time=new Date(message.created_at).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});
    item.innerHTML=`<div class="chat-avatar" aria-hidden="true">${esc(initial)}</div><div class="chat-message-body"><div class="chat-meta"><strong>${esc(message.username)}</strong><time>${time}</time></div><p>${esc(message.message)}</p></div>`;
    box.appendChild(item);
    box.scrollTop=box.scrollHeight;

    if(currentUser && message.user_id!==currentUser.id){
      maybeNotify(message);
    }
  }

  function subscribeChat(s){
    if(chatChannel)chatChannel.unsubscribe();
    chatChannel=s.channel('atlantis-chat-messages')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},payload=>addMessage(payload.new))
      .subscribe();
  }

  function subscribePresence(s,username){
    const count=document.getElementById('online-count');
    if(presenceChannel)presenceChannel.unsubscribe();
    presenceChannel=s.channel('atlantis-chat-presence',{config:{presence:{key:currentUser.id}}});
    const render=()=>{
      const state=presenceChannel.presenceState();
      const users=new Set();
      Object.values(state).flat().forEach(entry=>users.add(entry.username||entry.user_id));
      if(count)count.textContent=users.size+' oyuncu sohbeti açık';
    };
    presenceChannel.on('presence',{event:'sync'},render).on('presence',{event:'join'},render).on('presence',{event:'leave'},render);
    presenceChannel.subscribe(async status=>{
      if(status==='SUBSCRIBED')await presenceChannel.track({username,user_id:currentUser.id});
    });
  }

  function setupComposer(s,username){
    const form=document.getElementById('chat-form');
    const input=document.getElementById('chat-input');
    const button=form?.querySelector('button');
    if(!form||!input)return;
    form.onsubmit=async event=>{
      event.preventDefault();
      const now=Date.now();
      const remaining=3000-(now-lastSent);
      if(remaining>0){toast('Yeni mesaj için '+Math.ceil(remaining/1000)+' saniye bekle.');return;}
      const text=input.value.trim();
      if(!text)return;
      if(text.length>300){toast('Mesaj en fazla 300 karakter olabilir.');return;}
      if(button)button.disabled=true;
      const {data,error}=await s.rpc('send_chat_message',{p_message:text});
      if(error){toast(error.message||'Mesaj gönderilemedi.');if(button)button.disabled=false;return;}
      input.value='';
      lastSent=Date.now();
      if(button)button.disabled=false;
      if(data?.muted_until)disableComposer('Sohbet kullanımın kısıtlandı.');
    };
  }

  function disableComposer(text){
    const input=document.getElementById('chat-input');
    const button=document.querySelector('#chat-form button');
    if(input){input.disabled=true;input.placeholder=text||'Sohbet kullanılamıyor';}
    if(button)button.disabled=true;
  }

  function addNotificationControls(){
    const head=document.querySelector('.chat-head');
    if(!head || document.getElementById('chat-tools'))return;
    const tools=document.createElement('div');tools.id='chat-tools';tools.className='chat-tools';
    tools.innerHTML='<button class="ghost-button" id="chat-notify" type="button">Bildirimler</button><button class="ghost-button" id="chat-sound" type="button">Ses</button>';
    head.appendChild(tools);
    document.getElementById('chat-notify').onclick=async()=>{
      if(!('Notification' in window)){toast('Bu tarayıcı bildirimleri desteklemiyor.');return;}
      const permission=await Notification.requestPermission();
      if(permission==='granted'){
        localStorage.setItem(NOTIFY_KEY,'1');
        toast('Bildirimler açıldı.');
      }else toast('Bildirim izni verilmedi.');
      updateNotificationButton();
    };
    document.getElementById('chat-sound').onclick=()=>{playNotificationSound(true);localStorage.setItem('atlantis-chat-sound','1');toast('Mesaj sesi açıldı.');};
  }

  function updateNotificationButton(){
    const notify=document.getElementById('chat-notify');
    const sound=document.getElementById('chat-sound');
    if(notify){notify.textContent=('Notification' in window && Notification.permission==='granted')?'Bildirimler Açık':'Bildirimleri Aç';}
    if(sound){sound.textContent=localStorage.getItem('atlantis-chat-sound')==='1'?'Ses Açık':'Ses Aç';}
  }

  function maybeNotify(message){
    const soundEnabled=localStorage.getItem('atlantis-chat-sound')==='1';
    if(soundEnabled)playNotificationSound(false);
    if(localStorage.getItem(NOTIFY_KEY)==='1' && 'Notification' in window && Notification.permission==='granted' && document.hidden){
      const n=new Notification('Atlantis MC — Yeni mesaj',{body:message.username+': '+message.message,tag:'atlantis-chat'});
      n.onclick=()=>{window.focus();n.close();};
    }else{
      toast('💬 '+message.username+' yeni bir mesaj gönderdi.');
    }
  }

  function playNotificationSound(fromGesture){
    if(!audioContext){
      try{audioContext=new (window.AudioContext||window.webkitAudioContext)();}catch(e){return;}
    }
    if(audioContext.state==='suspended' && fromGesture)audioContext.resume();
    if(audioContext.state!=='running')return;
    const osc=audioContext.createOscillator();
    const gain=audioContext.createGain();
    osc.type='sine'; osc.frequency.value=880;
    gain.gain.setValueAtTime(0.0001,audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.045,audioContext.currentTime+0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001,audioContext.currentTime+0.12);
    osc.connect(gain);gain.connect(audioContext.destination);osc.start();osc.stop(audioContext.currentTime+0.13);
  }

  function toast(text){
    let el=document.getElementById('chat-toast');
    if(!el){el=document.createElement('div');el.id='chat-toast';el.className='chat-toast';document.body.appendChild(el);}
    el.textContent=text;el.classList.add('show');clearTimeout(el._timer);el._timer=setTimeout(()=>el.classList.remove('show'),2200);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

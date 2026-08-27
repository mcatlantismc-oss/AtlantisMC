(function(){
  'use strict';

  const body = document.body;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Global scroll reveal. */
  const reveals = document.querySelectorAll('.reveal');
  if (reveals.length) {
    if (reducedMotion || !('IntersectionObserver' in window)) {
      reveals.forEach(el => el.classList.add('in-view'));
    } else {
      const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const siblings=[...reveals];
          const index=Math.max(0,siblings.indexOf(entry.target));
          entry.target.style.animationDelay=`${Math.min(8,index)*60}ms`;
          entry.target.classList.add('in-view');
          obs.unobserve(entry.target);
        });
      }, {rootMargin:'0px 0px -8% 0px', threshold:0.06});
      reveals.forEach(el => observer.observe(el));
    }
  }

  /* Smooth page-to-page transition. */
  if (!reducedMotion && !body.dataset.atlantisPageLinks) {
    body.dataset.atlantisPageLinks='1';
    document.addEventListener('click', function(e){
      const a=e.target.closest('a[href]');
      if(!a || e.defaultPrevented || a.target==='_blank' || a.hasAttribute('download')) return;
      const href=a.getAttribute('href') || '';
      if(href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:') ||
         href.startsWith('tel:') || href.startsWith('javascript:')) return;
      if(a.dataset.atlantisTransitioning) return;
      a.dataset.atlantisTransitioning='1';
      e.preventDefault();
      body.classList.add('atlantis-page-leaving');
      window.setTimeout(()=>{ window.location.href=a.href; },220);
    }, false);
  }

  /* Clipboard button. */
  const copyBtn = document.getElementById('copy-ip');
  const ipEl = document.getElementById('server-ip');
  if (copyBtn && ipEl) {
    copyBtn.addEventListener('click', async function(){
      const ip=ipEl.textContent.trim();
      const original=copyBtn.textContent;
      try{
        await navigator.clipboard.writeText(ip);
        copyBtn.textContent='Kopyalandı ✓';
      }catch{
        window.prompt('Sunucu adresini kopyala:', ip);
      }
      window.setTimeout(()=>{copyBtn.textContent=original;},1600);
    });
  }

  if (body.dataset.page === 'home') {
    loadServerStatus();
    window.setInterval(loadServerStatus,60000);
  }

  async function loadServerStatus(){
    const dot=document.getElementById('status-dot');
    const sub=document.getElementById('status-sub');
    const players=document.getElementById('status-players');
    const pill=document.getElementById('status-pill');
    if(!dot||!sub||!players||!pill)return;
    dot.classList.add('is-loading');
    dot.classList.remove('off');
    sub.textContent='Sunucu durumu kontrol ediliyor';
    pill.textContent='Kontrol ediliyor';
    players.textContent='Oyuncu sayısı yükleniyor...';

    const controller=new AbortController();
    const timeout=window.setTimeout(()=>controller.abort(),5000);
    try{
      const response=await fetch('https://api.mcstatus.io/v2/status/java/oyna.atlantismc.online',{
        signal:controller.signal,cache:'no-store'
      });
      if(!response.ok)throw new Error('HTTP '+response.status);
      const data=await response.json();
      if(data.online){
        dot.classList.remove('is-loading','off');
        sub.textContent='Sunucu Aktif';
        pill.textContent='Çevrimiçi';
        const online=data.players&&Number.isFinite(data.players.online)?data.players.online:0;
        const max=data.players&&Number.isFinite(data.players.max)?data.players.max:1000;
        players.textContent=`Oyuncu Sayısı: ${online} / ${max}`;
      }else setOfflineState();
    }catch{ setUnknownState(); }
    finally{ window.clearTimeout(timeout); }
  }

  function setOfflineState(){
    const dot=document.getElementById('status-dot');
    const sub=document.getElementById('status-sub');
    const players=document.getElementById('status-players');
    const pill=document.getElementById('status-pill');
    if(!dot||!sub||!players||!pill)return;
    dot.classList.remove('is-loading');dot.classList.add('off');
    sub.textContent='Sunucu Kapalı';pill.textContent='Çevrimdışı';
    players.textContent='Şu anda çevrimiçi oyuncu yok';
  }
  function setUnknownState(){
    const dot=document.getElementById('status-dot');
    const sub=document.getElementById('status-sub');
    const players=document.getElementById('status-players');
    const pill=document.getElementById('status-pill');
    if(!dot||!sub||!players||!pill)return;
    dot.classList.remove('is-loading','off');
    sub.textContent='Durum alınamadı';pill.textContent='Bilinmiyor';
    players.textContent='Sunucu durum servisine şu anda ulaşılamıyor';
  }

  requestAnimationFrame(()=>body.classList.add('atlantis-page-ready'));
})();
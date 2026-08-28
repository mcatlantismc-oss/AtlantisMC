(function(){
  'use strict';

  const body = document.body;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MAIN_SELECTOR = 'main.content';

  /* ---------------------------------------------------------------------
     Scroll reveal — reusable so freshly swapped-in content (see the
     navigation engine below) gets the same entrance treatment as a full
     page load, without creating a brand new IntersectionObserver each time.
  --------------------------------------------------------------------- */
  let revealObserver = null;
  let revealIndex = 0;

  function setupReveals(root){
    const scope = root || document;
    const reveals = scope.querySelectorAll('.reveal:not([data-reveal-bound])');
    if (!reveals.length) return;

    if (reducedMotion || !('IntersectionObserver' in window)) {
      reveals.forEach(el => { el.dataset.revealBound='1'; el.classList.add('in-view'); });
      return;
    }

    if (!revealObserver) {
      revealObserver = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('in-view');
          obs.unobserve(entry.target);
        });
      }, {rootMargin:'0px 0px -8% 0px', threshold:0.06});
    }

    reveals.forEach(el => {
      el.dataset.revealBound='1';
      el.style.animationDelay = `${Math.min(4, revealIndex++) * 8}ms`;
      revealObserver.observe(el);
    });
  }

  setupReveals(document);

  /* ---------------------------------------------------------------------
     Lightweight same-origin navigation:
     - Header, hamburger and account controls live outside <main class="content">
       and are never touched, so they never disappear/reload between pages.
     - Only the <main> content is fetched and swapped, so it feels instant.
     - Falls back to a normal browser navigation on any failure, unsupported
       browser, or a page that doesn't share the same <main class="content">
       shell — so this can never leave the site in a broken state.
  --------------------------------------------------------------------- */
  const navSupported = 'fetch' in window && 'DOMParser' in window && window.history?.pushState;
  let homeStatusTimer = null;
  let navToken = 0;

  function samePage(url){
    return url.pathname === location.pathname && url.search === location.search;
  }

  function updateActiveNav(pathname){
    const file = pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.site-nav a[href]').forEach(link => {
      let linkPath;
      try { linkPath = new URL(link.getAttribute('href'), location.href).pathname.split('/').pop() || 'index.html'; }
      catch { return; }
      link.classList.toggle('active', linkPath === file);
    });
  }

  async function loadPageScripts(doc){
    const existing = new Set(
      [...document.scripts].map(s => (s.getAttribute('src') || '').split('?')[0]).filter(Boolean)
    );

    // Dynamic scripts must be loaded strictly one-by-one. Merely setting
    // async=false is not sufficient for dynamically inserted scripts with
    // defer attributes, and was the source of the auth/moderation race.
    for (const scriptEl of doc.querySelectorAll('script[src]')) {
      const src = scriptEl.getAttribute('src');
      if (!src) continue;
      const clean = src.split('?')[0];
      if (existing.has(clean)) continue;
      existing.add(clean);

      await new Promise(resolve => {
        const tag = document.createElement('script');
        [...scriptEl.attributes].forEach(attr => {
          if (attr.name === 'async' || attr.name === 'defer') return;
          tag.setAttribute(attr.name, attr.value);
        });
        tag.async = false;
        const done = () => resolve();
        tag.addEventListener('load', done, {once:true});
        tag.addEventListener('error', done, {once:true});
        document.body.appendChild(tag);
      });
    }
  }

  function stopHomeStatus(){
    if (homeStatusTimer) { window.clearInterval(homeStatusTimer); homeStatusTimer = null; }
  }

  function startHomeStatusIfNeeded(){
    stopHomeStatus();
    if (body.dataset.page !== 'home') return;
    loadServerStatus();
    homeStatusTimer = window.setInterval(loadServerStatus, 60000);
  }

  async function swapTo(url, {push=true}={}){
    const myToken = ++navToken;
    const currentMain = document.querySelector(MAIN_SELECTOR);
    if (!currentMain) return false;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 7000);
    let html;
    try {
      const res = await fetch(url.href, {signal:controller.signal, credentials:'same-origin'});
      if (!res.ok) throw new Error('HTTP '+res.status);
      html = await res.text();
    } catch {
      return false;
    } finally {
      window.clearTimeout(timeout);
    }
    if (myToken !== navToken) return true; // a newer navigation took over

    let doc;
    try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch { return false; }
    const newMain = doc.querySelector(MAIN_SELECTOR);
    if (!newMain) return false;

    const applySwap = () => {
      currentMain.replaceWith(newMain);
      if (doc.title) document.title = doc.title;
      if (doc.body?.dataset.page !== undefined) body.dataset.page = doc.body.dataset.page || '';
      updateActiveNav(url.pathname);
      if (url.hash) {
        document.getElementById(url.hash.slice(1))?.scrollIntoView({block:'start'});
      } else {
        window.scrollTo(0,0);
      }
    };

    if (!reducedMotion && document.startViewTransition) {
      await document.startViewTransition(applySwap).finished.catch(()=>{});
    } else {
      applySwap();
    }

    if (push) history.pushState({atlantisSpa:true}, '', url.href);

    await loadPageScripts(doc);
    setupReveals(newMain);
    startHomeStatusIfNeeded();
    window.dispatchEvent(new CustomEvent('atlantis:content-swapped', {detail:{page: body.dataset.page || ''}}));
    return true;
  }

  if (!body.dataset.atlantisPageLinks) {
    body.dataset.atlantisPageLinks='1';
    history.scrollRestoration = 'manual';

    // Prefetch local pages so common navigation feels immediate after the first visit.
    const prefetchLocalPages = () => {
      const seen = new Set();
      document.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href') || '';
        if (!href || href.startsWith('#') || href.startsWith('http') ||
            href.startsWith('mailto:') || href.startsWith('tel:') ||
            href.startsWith('javascript:') || a.hasAttribute('download')) return;
        try {
          const url = new URL(href, location.href);
          if (url.origin !== location.origin || seen.has(url.href)) return;
          seen.add(url.href);
          if (seen.size > 8) return;
          const link = document.createElement('link');
          link.rel = 'prefetch';
          link.as = 'document';
          link.href = url.href;
          document.head.appendChild(link);
        } catch {}
      });
    };
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(prefetchLocalPages,{timeout:900});
    } else {
      window.setTimeout(prefetchLocalPages,80);
    }

    document.addEventListener('click', function(e){
      const a=e.target.closest('a[href]');
      if(!a || e.defaultPrevented || a.target==='_blank' || a.hasAttribute('download')) return;
      const href=a.getAttribute('href') || '';
      if(href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:') ||
         href.startsWith('tel:') || href.startsWith('javascript:')) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      let url;
      try {
        url = new URL(a.href, location.href);
        if (url.origin !== location.origin) return;
      } catch { return; }

      if (!navSupported) return; // plain navigation, exactly as before

      e.preventDefault();
      if (samePage(url)) {
        if (url.hash) document.getElementById(url.hash.slice(1))?.scrollIntoView({block:'start'});
        return;
      }

      swapTo(url).then(ok => { if (!ok) window.location.href = a.href; });
    }, false);

    if (navSupported) {
      window.addEventListener('popstate', () => {
        swapTo(new URL(location.href), {push:false}).then(ok => { if (!ok) location.reload(); });
      });
    }
  }

  /* Clipboard button — delegated so it keeps working after a swap brings
     a fresh #copy-ip / #server-ip pair onto the page. */
  document.addEventListener('click', function(e){
    const copyBtn = e.target.closest('#copy-ip');
    if (!copyBtn) return;
    const ipEl = document.getElementById('server-ip');
    if (!ipEl) return;
    const ip = ipEl.textContent.trim();
    const original = copyBtn.textContent;
    (navigator.clipboard?.writeText(ip) || Promise.reject())
      .then(() => { copyBtn.textContent='Kopyalandı ✓'; })
      .catch(() => { window.prompt('Sunucu adresini kopyala:', ip); })
      .finally(() => { window.setTimeout(()=>{copyBtn.textContent=original;},1600); });
  });

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

  startHomeStatusIfNeeded();

  requestAnimationFrame(()=>body.classList.add('atlantis-page-ready'));
})();

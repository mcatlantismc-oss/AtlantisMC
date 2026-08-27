/* Atlantis MC — global page/menu animation enhancer.
   Include this after script.js on every HTML page for consistent transitions. */
(() => {
  'use strict';
  const styleId='atlantis-global-motion';
  const css=`
    html{scroll-behavior:smooth}
    body.atlantis-page-ready{animation:atlantisPageIn .42s ease both}
    @keyframes atlantisPageIn{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}
    .reveal{will-change:opacity,transform}
    .reveal.in-view{animation:atlantisRise .52s cubic-bezier(.2,.8,.2,1) both}
    @keyframes atlantisRise{from{opacity:0;transform:translateY(22px) scale(.985)}to{opacity:1;transform:none}}
    .site-nav a,.primary-button,.secondary-button,.ghost-button,.danger-button,.menu-toggle{transition:transform .18s ease,opacity .18s ease,background .2s ease,border-color .2s ease,box-shadow .2s ease}
    .site-nav a:hover{transform:translateY(-2px)}
    .menu-toggle.is-open{transform:rotate(90deg)}
    body.atlantis-page-leaving{opacity:0;transform:translateY(-7px);transition:opacity .22s ease,transform .22s ease}
    .atlantis-link-loading{pointer-events:none}
    @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.reveal.in-view{animation:none!important}.atlantis-page-ready{animation:none!important}.site-nav a,.primary-button,.secondary-button,.ghost-button,.danger-button,.menu-toggle{transition:none!important}}
  `;
  function inject(){
    if(!document.getElementById(styleId)){
      const s=document.createElement('style');s.id=styleId;s.textContent=css;document.head.appendChild(s);
    }
  }
  function setup(){
    inject();
    requestAnimationFrame(()=>document.body.classList.add('atlantis-page-ready'));

    const reveals=[...document.querySelectorAll('.reveal')];
    if('IntersectionObserver' in window){
      const io=new IntersectionObserver(entries=>entries.forEach(entry=>{
        if(entry.isIntersecting){
          const i=reveals.indexOf(entry.target);
          entry.target.style.animationDelay=`${Math.max(0,Math.min(i,8))*70}ms`;
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        }
      }),{threshold:.12});
      reveals.forEach(el=>io.observe(el));
    }else reveals.forEach(el=>el.classList.add('in-view'));

    document.addEventListener('click',e=>{
      const a=e.target.closest('a[href]');
      if(!a||a.target==='_blank'||a.hasAttribute('download'))return;
      const href=a.getAttribute('href')||'';
      if(href.startsWith('#')||href.startsWith('http')||href.startsWith('mailto:')||href.startsWith('javascript:'))return;
      if(a.dataset.motionBound)return;
      e.preventDefault();
      a.classList.add('atlantis-link-loading');
      document.body.classList.add('atlantis-page-leaving');
      setTimeout(()=>{window.location.href=a.href},220);
    },{capture:false});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
})();

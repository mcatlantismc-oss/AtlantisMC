/* Atlantis MC — global page transition + scroll reveal */
(() => {
  'use strict';
  const STYLE_ID='atlantis-global-motion-v2';

  function inject(){
    if(document.getElementById(STYLE_ID))return;
    const s=document.createElement('style');
    s.id=STYLE_ID;
    s.textContent=`
      body.atlantis-page-ready{animation:atlantisPageIn .42s ease both}
      @keyframes atlantisPageIn{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}
      .reveal{will-change:opacity,transform}
      .reveal.in-view{animation:atlantisRise .52s cubic-bezier(.2,.8,.2,1) both}
      @keyframes atlantisRise{from{opacity:0;transform:translateY(22px) scale(.985)}to{opacity:1;transform:none}}
      body.atlantis-page-leaving{opacity:0;transform:translateY(-7px);transition:opacity .22s ease,transform .22s ease}
      .atlantis-link-loading{pointer-events:none}
    `;
    document.head.appendChild(s);
  }

  function reveal(){
    const all=[...document.querySelectorAll('.reveal')];
    if(!('IntersectionObserver' in window)){
      all.forEach(el=>el.classList.add('in-view')); return;
    }
    const io=new IntersectionObserver(entries=>{
      entries.forEach(entry=>{
        if(!entry.isIntersecting)return;
        const i=all.indexOf(entry.target);
        entry.target.style.animationDelay=`${Math.max(0,Math.min(i,8))*65}ms`;
        entry.target.classList.add('in-view');
        io.unobserve(entry.target);
      });
    },{threshold:.12});
    all.forEach(el=>io.observe(el));
  }

  function links(){
    document.addEventListener('click',e=>{
      const a=e.target.closest('a[href]');
      if(!a||e.defaultPrevented||a.target==='_blank'||a.hasAttribute('download'))return;
      const href=a.getAttribute('href')||'';
      if(href.startsWith('#')||href.startsWith('http')||href.startsWith('mailto:')||href.startsWith('tel:')||href.startsWith('javascript:'))return;
      if(a.dataset.atlantisMotionBound)return;
      a.dataset.atlantisMotionBound='1';
      e.preventDefault();
      a.classList.add('atlantis-link-loading');
      document.body.classList.add('atlantis-page-leaving');
      setTimeout(()=>{window.location.href=a.href},220);
    });
  }

  function setup(){
    inject();
    requestAnimationFrame(()=>document.body.classList.add('atlantis-page-ready'));
    reveal();
    links();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});
  else setup();
})();

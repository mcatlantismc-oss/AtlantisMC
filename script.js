/* ============================================================
   ATLANTIS MC — script.js
   ============================================================ */

/* ===== 1. Constellation canvas — sayfalar arası sabit ===== */
(function(){
  const canvas = document.getElementById('bg-canvas');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  let w, h, points, animId;

  const COLORS = [
    [58,169,255],
    [127,216,255],
    [100,130,255],
    [224,177,92]
  ];
  const COUNT      = 65;
  const LINK_DIST  = 125;
  const MAX_LINKS  = 3;
  const SPEED      = 0.26;
  const STORE_KEY  = 'atl_constellation';

  /* -- Kayıt & Yükleme -- */
  function save(){
    if(!points || !w || !h) return;
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({
        w, h,
        pts: points.map(p => ({
          x: +(p.x.toFixed(2)), y: +(p.y.toFixed(2)),
          vx: +(p.vx.toFixed(4)), vy: +(p.vy.toFixed(4)),
          r: p.r, ci: p.ci
        }))
      }));
    } catch(e){}
  }

  function load(nw, nh){
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      if(!raw) return null;
      const data = JSON.parse(raw);
      if(!data.pts || data.pts.length < 10) return null;
      const sx = nw / data.w, sy = nh / data.h;
      return data.pts.map(p => ({
        x: p.x * sx, y: p.y * sy,
        vx: p.vx, vy: p.vy,
        r: p.r,
        ci: p.ci,
        c: COLORS[p.ci] || COLORS[0]
      }));
    } catch(e){ return null; }
  }

  function create(nw, nh){
    return Array.from({length: COUNT}, () => {
      const ci = Math.floor(Math.random() * COLORS.length);
      return {
        x:  Math.random() * nw,
        y:  Math.random() * nh,
        vx: (Math.random() - 0.5) * SPEED * 2,
        vy: (Math.random() - 0.5) * SPEED * 2,
        r:  Math.random() * 1.3 + 0.7,
        ci, c: COLORS[ci]
      };
    });
  }

  function init(){
    w = canvas.width  = window.innerWidth;
    h = canvas.height = window.innerHeight;
    points = load(w, h) || create(w, h);
  }

  /* -- Render -- */
  let frame = 0;
  function step(){
    ctx.clearRect(0, 0, w, h);

    for(const p of points){
      p.x += p.vx; p.y += p.vy;
      if(p.x < 0 || p.x > w) p.vx *= -1;
      if(p.y < 0 || p.y > h) p.vy *= -1;
    }

    // Çizgiler — açık mavi, parlak
    for(let i = 0; i < points.length; i++){
      let links = 0;
      for(let j = i+1; j < points.length; j++){
        if(links >= MAX_LINKS) break;
        const a = points[i], b = points[j];
        const dx = a.x-b.x, dy = a.y-b.y;
        const d  = Math.sqrt(dx*dx+dy*dy);
        if(d < LINK_DIST){
          // Açık, parlak mavi çizgiler
          const op = 0.95 * (1 - d / LINK_DIST);
          ctx.strokeStyle = `rgba(100,210,255,${op.toFixed(3)})`;
          ctx.lineWidth   = 1.4;
          ctx.shadowColor = 'rgba(80,200,255,0.6)';
          ctx.shadowBlur  = 6;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          links++;
        }
      }
    }

    ctx.shadowBlur = 0;

    // Noktalar — parlak glow
    for(const p of points){
      const [r,g,b] = p.c;
      ctx.fillStyle   = `rgba(${r},${g},${b},1)`;
      ctx.shadowColor = `rgba(${r},${g},${b},0.9)`;
      ctx.shadowBlur  = 10;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    // Her 90 frame'de kaydet
    if(++frame % 90 === 0) save();
    animId = requestAnimationFrame(step);
  }

  window.addEventListener('resize', ()=>{
    cancelAnimationFrame(animId);
    save();
    init();
    step();
  });

  init();
  step();

  /* -- Sayfa geçişinde: önce kaydet, sonra git -- */
  document.addEventListener('DOMContentLoaded', ()=>{
    document.querySelectorAll('a[href]').forEach(link => {
      const href = link.getAttribute('href');
      if(href && !href.startsWith('http') && !href.startsWith('#') &&
         !href.startsWith('javascript') && link.target !== '_blank'){
        link.addEventListener('click', function(e){
          e.preventDefault();
          const dest = this.href;
          // Önce kaydet
          save();
          // Sonra fade çıkış ve geçiş
          document.body.style.transition = 'opacity 0.22s ease';
          document.body.style.opacity = '0';
          setTimeout(()=>{ window.location.href = dest; }, 230);
        });
      }
    });
  });
})();

/* ===== 2. IP kopyala ===== */
function copyIP(){
  const ipEl = document.getElementById('server-ip');
  if(!ipEl) return;
  const ip  = ipEl.textContent.trim();
  const btn = document.querySelector('.copy-btn');
  navigator.clipboard.writeText(ip).then(()=>{
    const orig = btn.textContent;
    btn.textContent = '✅ Kopyalandı!';
    btn.style.background = 'linear-gradient(135deg,#57e08c,#2db869)';
    setTimeout(()=>{ btn.textContent = orig; btn.style.background=''; }, 1800);
  }).catch(()=>{ alert('IP: '+ip); });
}

/* ===== 3. Sunucu durumu ===== */
async function loadServerStatus(){
  const dot = document.getElementById('status-dot');
  const sub = document.getElementById('status-sub');
  const pl  = document.getElementById('status-players');
  if(!dot) return;

  // İki API dene, hangisi çalışırsa onu kullan
  const apis = [
    {
      url: 'https://api.mcstatus.io/v2/status/java/atlantis.minecraft.party',
      parse: d => ({
        online: d.online,
        players: d.players?.online ?? 0,
        max: d.players?.max ?? 1000
      })
    },
    {
      url: 'https://api.mcsrvstat.us/3/atlantis.minecraft.party',
      parse: d => ({
        online: d.online,
        players: d.players?.online ?? 0,
        max: d.players?.max ?? 1000
      })
    }
  ];

  for(const api of apis){
    try{
      const res  = await fetch(api.url, {signal: AbortSignal.timeout(5000)});
      const data = await res.json();
      const info = api.parse(data);
      if(info.online){
        dot.classList.remove('off');
        sub.textContent = 'Sunucu Aktif';
        pl.textContent  = `Oyuncu Sayısı: ${info.players} / ${info.max}`;
      } else {
        dot.classList.add('off');
        sub.textContent = 'Sunucu Kapalı';
        pl.textContent  = '';
      }
      return; // Başarılı, çık
    } catch(e){
      continue; // Sonraki API'yi dene
    }
  }

  // İkisi de olmadı — sunucu aktif varsay
  dot.classList.remove('off');
  sub.textContent = 'Sunucu Aktif';
  pl.textContent  = 'Oyuncu Sayısı: 0 / 1000';
}
loadServerStatus();
setInterval(loadServerStatus, 60000);

/* ===== 4. Scroll reveal (staggered) ===== */
(function(){
  const cards = document.querySelectorAll('.card');
  if(!cards.length) return;
  const obs = new IntersectionObserver(entries=>{
    entries.forEach(e=>{
      if(e.isIntersecting){
        setTimeout(()=> e.target.classList.add('in-view'),
          +(e.target.dataset.delay||0));
        obs.unobserve(e.target);
      }
    });
  },{threshold:0.1});
  cards.forEach((c,i)=>{ c.dataset.delay=i*130; obs.observe(c); });
})();

/* ===== 5. Kart hover glow ===== */
(function(){
  document.addEventListener('DOMContentLoaded', ()=>{
    document.querySelectorAll('.card').forEach(card=>{
      card.addEventListener('mousemove', e=>{
        const rect = card.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width  * 100).toFixed(1);
        const y = ((e.clientY - rect.top)  / rect.height * 100).toFixed(1);
        card.style.setProperty('--mx', x+'%');
        card.style.setProperty('--my', y+'%');
        card.classList.add('glow-active');
      });
      card.addEventListener('mouseleave', ()=>{
        card.classList.remove('glow-active');
      });
    });
  });
})();
     

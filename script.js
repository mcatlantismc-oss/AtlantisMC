/* ===== Sayfa geçiş animasyonu ===== */
(function(){
  document.addEventListener('DOMContentLoaded', function(){
    // Sayfa tıklamada çıkış animasyonu
    document.querySelectorAll('a[href]').forEach(link => {
      const href = link.getAttribute('href');
      if(
        href &&
        !href.startsWith('http') &&
        !href.startsWith('#') &&
        !href.startsWith('javascript') &&
        link.target !== '_blank'
      ){
        link.addEventListener('click', function(e){
          e.preventDefault();
          const dest = this.href;
          document.body.style.transition = 'opacity 0.22s ease';
          document.body.style.opacity = '0';
          setTimeout(()=>{ window.location.href = dest; }, 230);
        });
      }
    });
  });
})();

/* ===== Constellation canvas — sayfadan sayfaya sabit ===== */
(function(){
  const canvas = document.getElementById('bg-canvas');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  let w, h, points;
  let animId;

  // Renkler
  const colors = [
    [58,169,255],   // mavi
    [127,216,255],  // açık cyan
    [120,140,255],  // periwinkle
    [224,177,92]    // altın
  ];

  // Nokta sayısı — daha az, daha temiz
  const TARGET_COUNT = 70;
  // Bağlantı mesafesi — kısaltıldı, iç içe geçme azalır
  const LINK_DIST = 130;
  // Her nokta max kaç bağlantı yapabilir
  const MAX_LINKS_PER_NODE = 3;

  /* -- sessionStorage'dan noktaları yükle ya da yeni oluştur -- */
  function loadOrCreatePoints(w, h){
    try {
      const saved = sessionStorage.getItem('atl_pts');
      if(saved){
        const data = JSON.parse(saved);
        // Ekran boyutu değiştiyse normalize et
        const scaleX = w / (data.w || w);
        const scaleY = h / (data.h || h);
        return data.pts.map(p => ({
          x:  p.x * scaleX,
          y:  p.y * scaleY,
          vx: p.vx,
          vy: p.vy,
          r:  p.r,
          c:  p.c
        }));
      }
    } catch(e){}
    // Yoksa yeni oluştur
    return Array.from({length: TARGET_COUNT}, () => ({
      x:  Math.random() * w,
      y:  Math.random() * h,
      vx: (Math.random() - 0.5) * 0.28,
      vy: (Math.random() - 0.5) * 0.28,
      r:  Math.random() * 1.4 + 0.7,
      c:  colors[Math.floor(Math.random() * colors.length)]
    }));
  }

  /* -- Noktaları sessionStorage'a kaydet -- */
  let saveTimer;
  function savePoints(){
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        sessionStorage.setItem('atl_pts', JSON.stringify({
          w, h,
          pts: points.map(p => ({
            x: p.x, y: p.y,
            vx: p.vx, vy: p.vy,
            r: p.r, c: p.c
          }))
        }));
      } catch(e){}
    }, 800);
  }

  function resize(){
    const newW = window.innerWidth;
    const newH = window.innerHeight;
    if(w === newW && h === newH) return;
    w = canvas.width  = newW;
    h = canvas.height = newH;
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    if(!points){
      points = loadOrCreatePoints(w, h);
    }
  }

  function step(){
    ctx.clearRect(0, 0, w, h);

    // Hareket
    for(const p of points){
      p.x += p.vx;
      p.y += p.vy;
      if(p.x < 0 || p.x > w) p.vx *= -1;
      if(p.y < 0 || p.y > h) p.vy *= -1;
    }

    // Çizgiler — her nokta max MAX_LINKS_PER_NODE bağlantı yapar
    for(let i = 0; i < points.length; i++){
      let linkCount = 0;
      for(let j = i + 1; j < points.length; j++){
        if(linkCount >= MAX_LINKS_PER_NODE) break;
        const a = points[i], b = points[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if(dist < LINK_DIST){
          const op = 0.45 * (1 - dist / LINK_DIST);
          ctx.strokeStyle = `rgba(110,195,255,${op.toFixed(3)})`;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          linkCount++;
        }
      }
    }

    // Noktalar
    for(const p of points){
      const [r,g,b] = p.c;
      ctx.fillStyle   = `rgba(${r},${g},${b},0.9)`;
      ctx.shadowColor = `rgba(${r},${g},${b},0.7)`;
      ctx.shadowBlur  = 7;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    // Her 120 frame'de bir kaydet (~2 sn)
    if(!step._frame) step._frame = 0;
    if(++step._frame % 120 === 0) savePoints();

    animId = requestAnimationFrame(step);
  }

  // Sayfa kapatılırken kaydet
  window.addEventListener('beforeunload', savePoints);
  window.addEventListener('pagehide', savePoints);

  window.addEventListener('resize', () => {
    cancelAnimationFrame(animId);
    resize();
    animId = requestAnimationFrame(step);
  });

  resize();
  step();
})();

/* ===== IP kopyala ===== */
function copyIP(){
  const ipEl = document.getElementById('server-ip');
  if(!ipEl) return;
  const ip = ipEl.textContent.trim();
  const btn = document.querySelector('.copy-btn');
  navigator.clipboard.writeText(ip).then(()=>{
    const original = btn.textContent;
    btn.textContent = '✅ Kopyalandı!';
    btn.style.background = 'linear-gradient(135deg,#57e08c,#2db869)';
    setTimeout(()=>{
      btn.textContent = original;
      btn.style.background = '';
    }, 1800);
  }).catch(()=>{
    alert('IP: ' + ip);
  });
}

/* ===== Sunucu durumu ===== */
async function loadServerStatus(){
  const dot     = document.getElementById('status-dot');
  const sub     = document.getElementById('status-sub');
  const players = document.getElementById('status-players');
  if(!dot) return;
  try{
    const res  = await fetch('https://api.mcsrvstat.us/3/atlantis.minecraft.party');
    const data = await res.json();
    if(data.online){
      dot.classList.remove('off');
      sub.textContent = 'Sunucu Aktif';
      const online = data.players?.online ?? 0;
      const max    = data.players?.max    ?? 1000;
      players.textContent = `Oyuncu Sayısı: ${online} / ${max}`;
    } else {
      dot.classList.add('off');
      sub.textContent = 'Sunucu Kapalı';
      players.textContent = '';
    }
  } catch(e){
    dot.classList.remove('off');
    sub.textContent = 'Sunucu Aktif';
    players.textContent = 'Oyuncu Sayısı: 0 / 1000';
  }
}
loadServerStatus();
setInterval(loadServerStatus, 60000);

/* ===== Scroll ile kart reveal (staggered) ===== */
(function(){
  const cards = document.querySelectorAll('.card');
  if(!cards.length) return;
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if(e.isIntersecting){
        const delay = e.target.dataset.delay || 0;
        setTimeout(() => {
          e.target.classList.add('in-view');
        }, delay);
        obs.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });
  cards.forEach((c, i) => {
    c.dataset.delay = i * 130;
    obs.observe(c);
  });
})();

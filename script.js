/* ===== Sayfa geçiş animasyonu ===== */
(function(){
  // Tüm içeriği page-wrapper'a sar (body'nin doğrudan çocukları hariç canvas)
  document.addEventListener('DOMContentLoaded', function(){
    const wrapper = document.querySelector('.page-wrapper');
    if(wrapper){
      wrapper.classList.add('loaded');
    }

    // Sayfa tıklamada çıkış animasyonu
    document.querySelectorAll('a[href]').forEach(link => {
      const href = link.getAttribute('href');
      // Sadece aynı sitedeki linkler, yeni sekme açmayanlar
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
          document.body.style.transition = 'opacity 0.25s ease';
          document.body.style.opacity = '0';
          setTimeout(()=>{ window.location.href = dest; }, 260);
        });
      }
    });
  });
})();

/* ===== Constellation canvas arka planı ===== */
(function(){
  const canvas = document.getElementById('bg-canvas');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  let w, h, points;

  const colors = [
    [58,169,255],   // accent blue
    [127,216,255],  // light cyan
    [120,140,255],  // periwinkle
    [224,177,92]    // gold spark
  ];

  function resize(){
    w = canvas.width  = window.innerWidth;
    h = canvas.height = window.innerHeight;
    const count = Math.min(200, Math.floor((w * h) / 8000));
    points = Array.from({length: count}, () => ({
      x:  Math.random() * w,
      y:  Math.random() * h,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      r:  Math.random() * 1.6 + 0.8,
      c:  colors[Math.floor(Math.random() * colors.length)]
    }));
  }

  function step(){
    ctx.clearRect(0, 0, w, h);

    // Nokta hareketleri
    for(const p of points){
      p.x += p.vx;
      p.y += p.vy;
      if(p.x < 0 || p.x > w) p.vx *= -1;
      if(p.y < 0 || p.y > h) p.vy *= -1;
    }

    // Çizgiler
    for(let i = 0; i < points.length; i++){
      for(let j = i + 1; j < points.length; j++){
        const a = points[i], b = points[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if(dist < 180){
          const op = 0.55 * (1 - dist / 180);
          ctx.strokeStyle = `rgba(110,195,255,${op})`;
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    // Noktalar (parlaklıkla)
    for(const p of points){
      const [r,g,b] = p.c;
      ctx.fillStyle   = `rgba(${r},${g},${b},0.95)`;
      ctx.shadowColor = `rgba(${r},${g},${b},0.8)`;
      ctx.shadowBlur  = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    requestAnimationFrame(step);
  }

  window.addEventListener('resize', resize);
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
    entries.forEach((e, i) => {
      if(e.isIntersecting){
        // Her kart için biraz farklı gecikme
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

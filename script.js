/* ===== Constellation background ===== */
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

  function pageHeight(){
    return Math.max(document.body.scrollHeight, window.innerHeight);
  }

  function resize(){
    w = canvas.width = window.innerWidth;
    h = canvas.height = pageHeight();
    canvas.style.height = h + 'px';
    const count = Math.min(260, Math.floor((w*h)/7000));
    points = Array.from({length:count}, ()=>({
      x: Math.random()*w,
      y: Math.random()*h,
      vx: (Math.random()-0.5)*0.3,
      vy: (Math.random()-0.5)*0.3,
      r: Math.random()*1.6 + 1,
      c: colors[Math.floor(Math.random()*colors.length)]
    }));
  }

  function step(){
    ctx.clearRect(0,0,w,h);
    for(const p of points){
      p.x += p.vx; p.y += p.vy;
      if(p.x<0||p.x>w) p.vx*=-1;
      if(p.y<0||p.y>h) p.vy*=-1;
    }
    for(let i=0;i<points.length;i++){
      for(let j=i+1;j<points.length;j++){
        const a=points[i], b=points[j];
        const dx=a.x-b.x, dy=a.y-b.y;
        const dist=Math.sqrt(dx*dx+dy*dy);
        if(dist<200){
          const op = 0.5*(1-dist/200);
          ctx.strokeStyle = `rgba(110,195,255,${op})`;
          ctx.lineWidth=1.1;
          ctx.beginPath();
          ctx.moveTo(a.x,a.y);
          ctx.lineTo(b.x,b.y);
          ctx.stroke();
        }
      }
    }
    for(const p of points){
      const [r,g,b] = p.c;
      ctx.fillStyle=`rgba(${r},${g},${b},1)`;
      ctx.shadowColor=`rgba(${r},${g},${b},0.95)`;
      ctx.shadowBlur=9;
      ctx.beginPath();
      ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fill();
    }
    ctx.shadowBlur=0;
    requestAnimationFrame(step);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('load', resize);
  resize();
  step();

  // Recheck page height after content settles (fonts/images loading)
  setTimeout(resize, 600);
  setTimeout(resize, 1500);
})();

/* ===== IP copy ===== */
function copyIP(){
  const ipEl = document.getElementById('server-ip');
  if(!ipEl) return;
  const ip = ipEl.textContent.trim();
  const btn = document.querySelector('.copy-btn');
  navigator.clipboard.writeText(ip).then(()=>{
    const original = btn.textContent;
    btn.textContent = '✅ Kopyalandı';
    setTimeout(()=>{ btn.textContent = original; }, 1800);
  }).catch(()=>{
    alert('IP: ' + ip);
  });
}

/* ===== Live server status ===== */
async function loadServerStatus(){
  const dot = document.getElementById('status-dot');
  const sub = document.getElementById('status-sub');
  const players = document.getElementById('status-players');
  if(!dot) return;
  dot.classList.remove('off');
  sub.textContent = 'Sunucu Aktif';
  try{
    const res = await fetch('https://api.mcsrvstat.us/3/atlantis.minecraft.party');
    const data = await res.json();
    const online = data.players?.online ?? 0;
    const max = data.players?.max ?? 1000;
    players.textContent = `Oyuncu Sayısı: ${online} / ${max}`;
  }catch(e){
    players.textContent = 'Oyuncu Sayısı: 0 / 1000';
  }
}
loadServerStatus();
setInterval(loadServerStatus, 60000);

/* ===== Reveal cards on scroll ===== */
(function(){
  const cards = document.querySelectorAll('.card');
  if(!cards.length) return;
  const obs = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{
      if(e.isIntersecting){
        e.target.classList.add('in-view');
        obs.unobserve(e.target);
      }
    });
  }, {threshold:0.15});
  cards.forEach(c=>obs.observe(c));
})();
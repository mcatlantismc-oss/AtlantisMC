/* ===== Constellation background ===== */
(function(){
  const canvas = document.getElementById('bg-canvas');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  let w, h, points;

  function resize(){
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    const count = Math.min(80, Math.floor((w*h)/22000));
    points = Array.from({length:count}, ()=>({
      x: Math.random()*w,
      y: Math.random()*h,
      vx: (Math.random()-0.5)*0.25,
      vy: (Math.random()-0.5)*0.25
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
        if(dist<140){
          ctx.strokeStyle = `rgba(58,169,255,${0.18*(1-dist/140)})`;
          ctx.lineWidth=1;
          ctx.beginPath();
          ctx.moveTo(a.x,a.y);
          ctx.lineTo(b.x,b.y);
          ctx.stroke();
        }
      }
    }
    for(const p of points){
      ctx.fillStyle='rgba(127,216,255,0.7)';
      ctx.beginPath();
      ctx.arc(p.x,p.y,1.6,0,Math.PI*2);
      ctx.fill();
    }
    requestAnimationFrame(step);
  }

  window.addEventListener('resize', resize);
  resize();
  step();
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
  try{
    const res = await fetch('https://api.mcsrvstat.us/3/atlantis.minecraft.party');
    const data = await res.json();
    if(data.online){
      dot.classList.remove('off');
      sub.textContent = 'Sunucu Aktif';
      const online = data.players?.online ?? 0;
      const max = data.players?.max ?? 1000;
      players.textContent = `Oyuncu Sayısı: ${online} / ${max}`;
    } else {
      dot.classList.add('off');
      sub.textContent = 'Sunucu Şu An Kapalı';
      players.textContent = 'Oyuncu Sayısı: Sunucu Kapalı / 1000';
    }
  }catch(e){
    dot.classList.add('off');
    sub.textContent = 'Durum bilgisi alınamadı';
    players.textContent = '';
  }
}
loadServerStatus();
setInterval(loadServerStatus, 60000);
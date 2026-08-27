# Atlantis MC — Optimize Edilmiş Site

Bu paket, mevcut Atlantis MC sitesinin tasarımı korunarak daha sade, modern ve performans odaklı bir sürümüdür.

## Ne değişti?
- Sürekli çalışan 65 parçalı canvas animasyonu kaldırıldı.
- Her frame'de yapılan çok sayıda çizgi mesafesi hesabı kaldırıldı.
- Mouse hareketinde sürekli `getBoundingClientRect()` + style güncellemesi kaldırıldı.
- Arka plan animasyonları ve ağır blur/backdrop-filter kullanımı kaldırıldı.
- Sunucu durum sorgusu yalnızca ana sayfada ve 60 saniyede bir çalışıyor.
- Durum API'sinde yanlış domain yerine `oyna.atlantismc.online` kullanılıyor.
- Başarısız API isteğinde artık site yanlışlıkla "Sunucu Aktif" göstermiyor.
- Mobil menü eklendi.
- Sayfa geçişleri ve scroll animasyonları hafifletildi.
- Var olan ana bilgiler korunarak ana sayfa, oy verme, haberler, hakkımızda ve iletişim sayfaları tek bir görsel sistemde yenilendi.
- Büyük görsel efektleri yerine statik, düşük maliyetli network dokusu kullanıldı.
- `prefers-reduced-motion` desteği eklendi.

# Keşfet performans ölçümü

**Expo Go ile ÖLÇME.** Geliştirme modu (`__DEV__`) ve Expo Go sonuçları yanıltıcıdır; yalnız release build'de ölç.

1. **Build (bayrak açık, release):** `eas.json` içindeki `preview` profili release APK üretir (`distribution: internal`).
   - Bulut: EAS `preview` ortamına `EXPO_PUBLIC_PERF_TRACE=1` değişkenini ekle (`eas env:create`; komut sürüme göre değişebilir, doğrula), sonra `eas build --platform android --profile preview`.
   - Yerel: `EXPO_PUBLIC_PERF_TRACE=1 npx expo run:android --variant release`. `eas.json`'a bayrak yazıp commit etme.
   - Bayrak yoksa trace kapalıdır ve maliyeti yoktur. `EXPO_PUBLIC_*` derleme anında gömülür; bayrağı değiştirince yeniden build al.
2. **Hazırlık:** Aynı cihaz, aynı hesap, şarj/güç tasarrufu kapalı, ağ sabit. Her senaryodan önce uygulamayı kapatıp aç.
3. **Senaryolar** (her biri en az 3 tekrar):
   - Soğuk açılış: uygulamayı öldür, aç, ilk kart gelene kadar bekle.
   - 30 kart normal kaydırma (yaklaşık 1 kaydırma / 2 sn).
   - 30 kart hızlı kaydırma (≥3 kaydırma/sn).
   - Geri alma: 10 kartı geç, 10 kez geri al.
   - Profil kaydı sonrası: Stil Stüdyosu'nda tercih değiştir, kaydet, Keşfet'e dön, 10 kart kaydır.
4. **Özeti okuma:** Profil sekmesinde "Profil" başlığına uzun bas. Uyarı kutusu etiket başına `n`, medyan, p95 ve maks (ms) gösterir; aynı özet konsola da yazılır. Her senaryodan sonra oku, ekran görüntüsü al.
   Etiketler: `feed_fetch_total`, `feed_edge_rank`, `feed_local_rank`, `cache_read` (+ `cache_read_timeout` sayısı), `combo_compute`, `combo_ready_before_swipe_yes/no`, `swipe_to_next_ready`, `js_long_task`, `session_hydrate` (oturum senkronu bitene kadar; feed bunu bekler), `catalog_load` (öneri kataloğu toplam süre), `catalog_load_pages` (okunan sayfa sayısı; değer ms değil adettir).
5. **Notlar:** Tampon son ~500 kayıtla sınırlı; özet uygulama kapanınca sıfırlanır, bu yüzden her senaryoyu ayrı oturumda ölç. `js_long_task` zamanlayıcı sapmasından tahmin edilir (>50 ms geç tetiklenen 50 ms'lik zamanlayıcı); Hermes'te gerçek "longtask" API'si yok.
6. **Raporla:** cihaz modeli + OS, build profili, commit, senaryo başına tablo (etiket, n, medyan, p95, maks), `combo_ready_before_swipe` evet/hayır oranı, `cache_read_timeout` sayısı, `js_long_task` sayısı ve en uzun değer, hızlı kaydırmada karttan sonra boş/yüklenen kombin gözlemin.

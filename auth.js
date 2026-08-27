/* Atlantis MC — güvenli hesap, Google, e-posta OTP ve rol arayüzü */
(function(){
  'use strict';

  const cfg = window.ATLANTIS_SUPABASE || {};
  const configuredEdgeUrl = String(window.ATLANTIS_EDGE_URL || '').replace(/\/+$/, '');

  const NAME_REGEX =
    /^[A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü0-9]{2,15}$/;

  const EMAIL_REGEX =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const noConfig =
    !cfg.url ||
    cfg.url.includes('YOUR_PROJECT') ||
    !cfg.publishableKey ||
    cfg.publishableKey.includes('YOUR_');

  if(noConfig){
    window.atlantisAuthReady = Promise.resolve(null);
    return;
  }

  function boot(){
    if(!window.supabase) return null;

    const client = window.supabase.createClient(
      cfg.url,
      cfg.publishableKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    );

    window.atlantisSupabase = client;
    return client;
  }

  window.atlantisAuthReady = new Promise(resolve => {
    if(window.supabase){
      resolve(boot());
    }else{
      window.addEventListener(
        'supabase-ready',
        () => resolve(boot()),
        {once:true}
      );
    }
  });

  const esc = value =>
    String(value ?? '').replace(
      /[&<>"']/g,
      ch => ({
        '&':'&amp;',
        '<':'&lt;',
        '>':'&gt;',
        '"':'&quot;',
        "'":'&#039;'
      }[ch])
    );

  /*
   * Edge Function adresini otomatik tamamlar.
   *
   * Desteklenen iki format:
   *
   * https://PROJECT.supabase.co/functions/v1
   *
   * veya
   *
   * https://PROJECT.supabase.co/functions/v1/login-with-identifier
   */
  function getLoginEndpoint(){
    if(!configuredEdgeUrl) return '';

    if(
      configuredEdgeUrl.endsWith(
        '/login-with-identifier'
      )
    ){
      return configuredEdgeUrl;
    }

    return configuredEdgeUrl +
      '/login-with-identifier';
  }

  /*
   * Bazı CSS dosyaları HTML'in [hidden] özelliğini
   * yanlışlıkla geçersiz kılabiliyor.
   *
   * Bu kural formların yalnızca seçilenini
   * göstermeyi garanti eder.
   */
  function injectVisibilityFix(){
    if(
      document.getElementById(
        'atlantis-auth-visibility-fix'
      )
    ){
      return;
    }

    const style =
      document.createElement('style');

    style.id =
      'atlantis-auth-visibility-fix';

    style.textContent = `
      #auth-modal[hidden],
      #auth-modal .auth-form[hidden] {
        display: none !important;
      }

      #auth-modal .auth-form:not([hidden]) {
        display: grid;
      }

      #auth-modal .auth-tabs[hidden] {
        display: none !important;
      }
    `;

    document.head.appendChild(style);
  }

  function ensureUI(){
    if(
      document.getElementById('auth-modal')
    ){
      return;
    }

    injectVisibilityFix();

    const nav =
      document.querySelector('.site-nav');

    if(
      nav &&
      !document.getElementById(
        'auth-nav-button'
      )
    ){
      const btn =
        document.createElement('a');

      btn.href = '#';
      btn.className =
        'auth-nav-button';
      btn.id =
        'auth-nav-button';
      btn.textContent =
        'Giriş Yap';

      btn.addEventListener(
        'click',
        e => {
          e.preventDefault();
          openAuth('login');
        }
      );

      nav.appendChild(btn);
    }

    const modal =
      document.createElement('div');

    modal.id =
      'auth-modal';

    modal.className =
      'auth-modal';

    modal.hidden = true;

    modal.innerHTML = `
      <div class="auth-backdrop"></div>

      <section
        class="auth-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
      >

        <button
          class="auth-close"
          type="button"
          aria-label="Kapat"
        >×</button>

        <div class="auth-brand">
          ⚔️
        </div>

        <span class="section-label">
          ATLANTİS MC
        </span>

        <h2 id="auth-title">
          Giriş Yap
        </h2>

        <p
          class="auth-subtitle"
          id="auth-subtitle"
        >
          Hesabına giriş yap ve Atlantis
          sohbetine katıl.
        </p>

        <div class="auth-tabs">
          <button
            data-auth-tab="login"
            class="is-active"
            type="button"
          >
            Giriş Yap
          </button>

          <button
            data-auth-tab="signup"
            type="button"
          >
            Kayıt Ol
          </button>
        </div>

        <form
          id="auth-login-form"
          class="auth-form"
        >

          <label>
            Kullanıcı adı veya e-posta

            <input
              name="identifier"
              autocomplete="username"
              required
              maxlength="120"
              placeholder="OyuncuAdı veya eposta@gmail.com"
            >
          </label>

          <label>
            Şifre

            <input
              name="password"
              type="password"
              autocomplete="current-password"
              required
              minlength="8"
              placeholder="Şifren"
            >
          </label>

          <button
            class="primary-button wide"
            type="submit"
          >
            Giriş Yap
          </button>

          <button
            class="google-button"
            id="google-login"
            type="button"
          >
            <span class="google-mark">
              G
            </span>

            Google ile giriş yap
          </button>

          <button
            class="link-button"
            id="forgot-password"
            type="button"
          >
            Şifremi unuttum
          </button>

        </form>

        <form
          id="auth-signup-form"
          class="auth-form"
          hidden
        >

          <label>
            Kullanıcı adı

            <input
              name="username"
              autocomplete="username"
              required
              minlength="3"
              maxlength="16"
              pattern="[A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü0-9]{2,15}"
              placeholder="AtlantisOyuncu"
            >
          </label>

          <small>
            3–16 karakter. Boşluk ve özel sembol yok;
            Türkçe/İngilizce harf ve rakam kullanılabilir.
          </small>

          <label>
            E-posta

            <input
              name="email"
              type="email"
              autocomplete="email"
              required
              placeholder="ornek@gmail.com"
            >
          </label>

          <label>
            Şifre

            <input
              name="password"
              type="password"
              autocomplete="new-password"
              required
              minlength="8"
              placeholder="En az 8 karakter"
            >
          </label>

          <button
            class="primary-button wide"
            type="submit"
          >
            Kayıt Ol
          </button>

          <button
            class="google-button"
            id="google-signup"
            type="button"
          >
            <span class="google-mark">
              G
            </span>

            Google ile kayıt ol
          </button>

        </form>

        <form
          id="auth-forgot-form"
          class="auth-form"
          hidden
        >

          <label>
            Gmail / E-posta

            <input
              name="email"
              type="email"
              autocomplete="email"
              required
              placeholder="ornek@gmail.com"
            >
          </label>

          <button
            class="primary-button wide"
            type="submit"
          >
            Kod Gönder
          </button>

          <button
            class="link-button"
            data-back-login
            type="button"
          >
            Girişe dön
          </button>

        </form>

        <form
          id="auth-otp-form"
          class="auth-form"
          hidden
        >

          <div
            class="otp-info"
            id="otp-info"
          ></div>

          <label>
            6 haneli kod

            <input
              name="token"
              inputmode="numeric"
              autocomplete="one-time-code"
              pattern="[0-9]{6}"
              maxlength="6"
              required
              placeholder="123456"
            >
          </label>

          <button
            class="primary-button wide"
            type="submit"
          >
            Kodu Doğrula
          </button>

          <button
            class="link-button"
            data-back-login
            type="button"
          >
            Girişe dön
          </button>

        </form>

        <form
          id="auth-reset-form"
          class="auth-form"
          hidden
        >

          <label>
            Yeni şifre

            <input
              name="password"
              type="password"
              autocomplete="new-password"
              minlength="8"
              required
              placeholder="Yeni şifre"
            >
          </label>

          <label>
            Yeni şifre tekrar

            <input
              name="password2"
              type="password"
              autocomplete="new-password"
              minlength="8"
              required
              placeholder="Yeni şifre tekrar"
            >
          </label>

          <button
            class="primary-button wide"
            type="submit"
          >
            Şifreyi Değiştir
          </button>

        </form>

        <form
          id="auth-complete-form"
          class="auth-form"
          hidden
        >

          <label>
            Atlantis kullanıcı adı

            <input
              name="username"
              autocomplete="username"
              required
              minlength="3"
              maxlength="16"
              pattern="[A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü0-9]{2,15}"
              placeholder="AtlantisOyuncu"
            >
          </label>

          <small>
            Bu ad sohbette görünen adın olacak.
            3–16 karakter; boşluk ve özel sembol yok.
          </small>

          <button
            class="primary-button wide"
            type="submit"
          >
            Kullanıcı Adımı Kaydet
          </button>

        </form>

        <div
          class="auth-message"
          id="auth-message"
          role="status"
        ></div>

      </section>
    `;

    document.body.appendChild(modal);

    modal.querySelector(
      '.auth-backdrop'
    ).onclick = closeAuth;

    modal.querySelector(
      '.auth-close'
    ).onclick = closeAuth;

    modal.querySelectorAll(
      '[data-auth-tab]'
    ).forEach(button => {
      button.onclick = () =>
        openAuth(
          button.dataset.authTab
        );
    });

    modal.querySelectorAll(
      '[data-back-login]'
    ).forEach(button => {
      button.onclick = () =>
        openAuth('login');
    });

    modal.querySelector(
      '#forgot-password'
    ).onclick = () =>
      openAuth('forgot');

    modal.querySelector(
      '#google-login'
    ).onclick = googleLogin;

    modal.querySelector(
      '#google-signup'
    ).onclick = googleLogin;

    modal.querySelector(
      '#auth-login-form'
    ).onsubmit = login;

    modal.querySelector(
      '#auth-signup-form'
    ).onsubmit = signup;

    modal.querySelector(
      '#auth-forgot-form'
    ).onsubmit = forgot;

    modal.querySelector(
      '#auth-otp-form'
    ).onsubmit = verifyOtp;

    modal.querySelector(
      '#auth-reset-form'
    ).onsubmit = resetPassword;

    modal.querySelector(
      '#auth-complete-form'
    ).onsubmit = completeProfile;
  }

  function setMessage(
    message,
    kind=''
  ){
    const el =
      document.getElementById(
        'auth-message'
      );

    if(!el) return;

    el.textContent =
      message || '';

    el.className =
      'auth-message ' + kind;
  }

  function showForm(name){
    const forms = [
      'login',
      'signup',
      'forgot',
      'otp',
      'reset',
      'complete'
    ];

    forms.forEach(formName => {
      const form =
        document.getElementById(
          'auth-' +
          formName +
          '-form'
        );

      if(form){
        form.hidden =
          formName !== name;
      }
    });

    const tabs =
      document.querySelector(
        '.auth-tabs'
      );

    if(tabs){
      tabs.hidden =
        !['login','signup']
          .includes(name);
    }

    const map = {
      login: [
        'Giriş Yap',
        'Hesabına giriş yap ve Atlantis sohbetine katıl.'
      ],

      signup: [
        'Kayıt Ol',
        'Kullanıcı adını oluştur ve topluluğa katıl.'
      ],

      forgot: [
        'Şifremi Unuttum',
        'E-posta adresine 6 haneli doğrulama kodu gönderelim.'
      ],

      otp: [
        'Kodu Doğrula',
        'E-posta kutundaki 6 haneli kodu gir.'
      ],

      reset: [
        'Yeni Şifre',
        'Hesabın için yeni bir şifre belirle.'
      ],

      complete: [
        'Kullanıcı Adın',
        'Sohbette görünecek kullanıcı adını belirle.'
      ]
    };

    const title =
      document.getElementById(
        'auth-title'
      );

    const subtitle =
      document.getElementById(
        'auth-subtitle'
      );

    if(title){
      title.textContent =
        map[name][0];
    }

    if(subtitle){
      subtitle.textContent =
        map[name][1];
    }

    document.querySelectorAll(
      '[data-auth-tab]'
    ).forEach(button => {
      button.classList.toggle(
        'is-active',
        button.dataset.authTab === name
      );
    });

    setMessage('');
  }

  function openAuth(
    name='login'
  ){
    ensureUI();

    const modal =
      document.getElementById(
        'auth-modal'
      );

    if(!modal) return;

    modal.hidden = false;

    document.body.classList.add(
      'auth-open'
    );

    showForm(name);

    window.setTimeout(() => {
      modal
        .querySelector(
          '.auth-form:not([hidden]) input:not([type=hidden]):not([disabled])'
        )
        ?.focus();
    }, 50);
  }

  function closeAuth(){
    const modal =
      document.getElementById(
        'auth-modal'
      );

    if(modal){
      modal.hidden = true;

      document.body.classList.remove(
        'auth-open'
      );
    }
  }

  window.openAtlantisAuth =
    openAuth;

  async function getClient(){
    return await window.atlantisAuthReady;
  }

  async function googleLogin(){
    const s =
      await getClient();

    if(!s){
      return setMessage(
        'Supabase bağlantısı hazır değil.',
        'error'
      );
    }

    const {error} =
      await s.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: location.href
        }
      });

    if(error){
      setMessage(
        'Google girişi başlatılamadı.',
        'error'
      );
    }
  }

  async function login(event){
    event.preventDefault();

    const s =
      await getClient();

    if(!s){
      return setMessage(
        'Supabase bağlantısı hazır değil.',
        'error'
      );
    }

    const data =
      new FormData(
        event.currentTarget
      );

    const identifier =
      String(
        data.get('identifier') || ''
      ).trim();

    const password =
      String(
        data.get('password') || ''
      );

    if(!identifier || !password){
      return setMessage(
        'Bilgilerini eksiksiz doldur.',
        'error'
      );
    }

    if(identifier.includes('@')){
      const {
        data: result,
        error
      } =
        await s.auth.signInWithPassword({
          email:
            identifier.toLowerCase(),
          password
        });

      if(error){
        return setMessage(
          'E-posta veya şifre hatalı.',
          'error'
        );
      }

      closeAuth();

      await updateNav(
        result.user
      );

      return;
    }

    const loginEndpoint =
      getLoginEndpoint();

    if(!loginEndpoint){
      return setMessage(
        'Kullanıcı adıyla giriş servisi yapılandırılmamış.',
        'error'
      );
    }

    try{
      const response =
        await fetch(
          loginEndpoint,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',

              'apikey':
                cfg.publishableKey
            },

            body:
              JSON.stringify({
                username:
                  identifier,
                password
              })
          }
        );

      const result =
        await response
          .json()
          .catch(
            () => ({})
          );

      if(!response.ok){
        throw new Error(
          result.error ||
          'Giriş başarısız.'
        );
      }

      if(!result.session){
        throw new Error(
          'Geçerli bir oturum alınamadı.'
        );
      }

      const {error} =
        await s.auth.setSession(
          result.session
        );

      if(error){
        throw error;
      }

      closeAuth();

      await updateNav(
        result.session.user
      );

    }catch(error){
      setMessage(
        error.message ||
        'Giriş başarısız.',
        'error'
      );
    }
  }
    async function signup(event){
    event.preventDefault();

    const s =
      await getClient();

    if(!s){
      return setMessage(
        'Supabase bağlantısı hazır değil.',
        'error'
      );
    }

    const data =
      new FormData(
        event.currentTarget
      );

    const username =
      String(
        data.get('username') || ''
      ).trim();

    const email =
      String(
        data.get('email') || ''
      )
        .trim()
        .toLowerCase();

    const password =
      String(
        data.get('password') || ''
      );

    if(!NAME_REGEX.test(username)){
      return setMessage(
        'Kullanıcı adı 3–16 karakter olmalı; sadece Türkçe/İngilizce harf ve rakam kullanabilirsin.',
        'error'
      );
    }

    if(!EMAIL_REGEX.test(email)){
      return setMessage(
        'Geçerli bir e-posta adresi gir.',
        'error'
      );
    }

    if(password.length < 8){
      return setMessage(
        'Şifre en az 8 karakter olmalı.',
        'error'
      );
    }

    try{
      const {
        data: existing,
        error: lookupError
      } =
        await s
          .from('profiles')
          .select('id')
          .eq(
            'username',
            username
          )
          .maybeSingle();

      if(lookupError){
        console.error(
          'Kullanıcı adı kontrolü:',
          lookupError
        );
      }

      if(existing){
        return setMessage(
          'Bu kullanıcı adı zaten alınmış.',
          'error'
        );
      }

      const {
        data: result,
        error
      } =
        await s.auth.signUp({
          email,
          password,

          options: {
            data: {
              username
            }
          }
        });

      if(error){
        return setMessage(
          error.message ||
          'Kayıt başarısız.',
          'error'
        );
      }

      window.atlantisPendingEmail =
        email;

      window.atlantisPendingUsername =
        username;

      window.atlantisOtpMode =
        'signup';

      /*
       * E-posta doğrulaması açıksa
       * Supabase hemen session oluşturmaz.
       */
      if(!result.session){
        showForm('otp');

        const info =
          document.getElementById(
            'otp-info'
          );

        if(info){
          info.textContent =
            email +
            ' adresine doğrulama kodu gönderildi.';
        }

        setMessage(
          'E-posta kutunu kontrol et.',
          'success'
        );

        return;
      }

      await saveProfile(
        result.user,
        username
      );

      closeAuth();

      await updateNav(
        result.user
      );

    }catch(error){
      console.error(
        'Kayıt hatası:',
        error
      );

      setMessage(
        'Kayıt sırasında bir hata oluştu.',
        'error'
      );
    }
  }

  async function forgot(event){
    event.preventDefault();

    const s =
      await getClient();

    if(!s){
      return setMessage(
        'Supabase bağlantısı hazır değil.',
        'error'
      );
    }

    const email =
      String(
        new FormData(
          event.currentTarget
        ).get('email') || ''
      )
        .trim()
        .toLowerCase();

    if(!EMAIL_REGEX.test(email)){
      return setMessage(
        'Geçerli bir e-posta adresi gir.',
        'error'
      );
    }

    const {
      error
    } =
      await s.auth.resetPasswordForEmail(
        email,
        {
          redirectTo:
            location.href
        }
      );

    if(error){
      return setMessage(
        'Kod gönderilemedi. E-posta ayarlarını veya adresini kontrol et.',
        'error'
      );
    }

    window.atlantisPendingEmail =
      email;

    window.atlantisOtpMode =
      'recovery';

    showForm('otp');

    const info =
      document.getElementById(
        'otp-info'
      );

    if(info){
      info.textContent =
        email +
        ' adresine şifre sıfırlama doğrulaması gönderildi.';
    }

    setMessage(
      'Gmail/e-posta kutunu kontrol et.',
      'success'
    );
  }

  async function verifyOtp(event){
    event.preventDefault();

    const s =
      await getClient();

    if(!s){
      return setMessage(
        'Supabase bağlantısı hazır değil.',
        'error'
      );
    }

    const token =
      String(
        new FormData(
          event.currentTarget
        ).get('token') || ''
      ).trim();

    const email =
      String(
        window.atlantisPendingEmail ||
        ''
      )
        .trim()
        .toLowerCase();

    if(
      !email ||
      !/^\d{6}$/.test(token)
    ){
      return setMessage(
        '6 haneli kodu doğru gir.',
        'error'
      );
    }

    const type =
      window.atlantisOtpMode ===
      'recovery'
        ? 'recovery'
        : 'email';

    const {
      data,
      error
    } =
      await s.auth.verifyOtp({
        email,
        token,
        type
      });

    if(error){
      return setMessage(
        'Kod hatalı veya süresi dolmuş.',
        'error'
      );
    }

    /*
     * Şifre sıfırlama kodu başarılıysa
     * yeni şifre ekranına geç.
     */
    if(type === 'recovery'){
      showForm('reset');

      setMessage(
        'Kod doğrulandı. Yeni şifreni belirle.',
        'success'
      );

      return;
    }

    if(!data.user){
      return setMessage(
        'Hesap doğrulandı fakat kullanıcı bilgisi alınamadı.',
        'error'
      );
    }

    await saveProfile(
      data.user,
      window.atlantisPendingUsername
    );

    closeAuth();

    await updateNav(
      data.user
    );
  }

  async function resetPassword(event){
    event.preventDefault();

    const s =
      await getClient();

    if(!s){
      return setMessage(
        'Supabase bağlantısı hazır değil.',
        'error'
      );
    }

    const data =
      new FormData(
        event.currentTarget
      );

    const password =
      String(
        data.get('password') || ''
      );

    const password2 =
      String(
        data.get('password2') || ''
      );

    if(password.length < 8){
      return setMessage(
        'Şifre en az 8 karakter olmalı.',
        'error'
      );
    }

    if(password !== password2){
      return setMessage(
        'Şifreler eşleşmiyor.',
        'error'
      );
    }

    const {
      error
    } =
      await s.auth.updateUser({
        password
      });

    if(error){
      return setMessage(
        'Şifre değiştirilemedi.',
        'error'
      );
    }

    setMessage(
      'Şifren başarıyla değiştirildi.',
      'success'
    );

    window.setTimeout(
      () => closeAuth(),
      900
    );
  }

  async function completeProfile(event){
    event.preventDefault();

    const s =
      await getClient();

    if(!s){
      return setMessage(
        'Supabase bağlantısı hazır değil.',
        'error'
      );
    }

    const {
      data: {
        session
      }
    } =
      await s.auth.getSession();

    if(!session){
      openAuth('login');
      return;
    }

    const username =
      String(
        new FormData(
          event.currentTarget
        ).get('username') || ''
      ).trim();

    if(!NAME_REGEX.test(username)){
      return setMessage(
        'Kullanıcı adı 3–16 karakter olmalı; boşluk ve özel sembol yok.',
        'error'
      );
    }

    const {
      data: existing
    } =
      await s
        .from('profiles')
        .select('id')
        .eq(
          'username',
          username
        )
        .maybeSingle();

    if(
      existing &&
      existing.id !== session.user.id
    ){
      return setMessage(
        'Bu kullanıcı adı zaten alınmış.',
        'error'
      );
    }

    const {
      error
    } =
      await s.rpc(
        'set_my_username',
        {
          new_username:
            username
        }
      );

    if(error){
      return setMessage(
        'Kullanıcı adı kaydedilemedi. Bu ad alınmış olabilir.',
        'error'
      );
    }

    closeAuth();

    await updateNav(
      session.user
    );
  }

  async function saveProfile(
    user,
    username
  ){
    if(
      !user ||
      !username ||
      !window.atlantisSupabase
    ){
      return;
    }

    const cleanUsername =
      String(username).trim();

    if(
      !NAME_REGEX.test(
        cleanUsername
      )
    ){
      return;
    }

    const {
      error
    } =
      await window
        .atlantisSupabase
        .rpc(
          'set_my_username',
          {
            new_username:
              cleanUsername
          }
        );

    if(error){
      console.error(
        'Profil kaydedilemedi:',
        error
      );
    }
  }

  async function getProfile(user){
    const s =
      window.atlantisSupabase;

    if(!s || !user){
      return null;
    }

    const {
      data,
      error
    } =
      await s
        .from('profiles')
        .select(
          'username,site_role,muted_until'
        )
        .eq(
          'id',
          user.id
        )
        .maybeSingle();

    if(error){
      console.error(
        'Profil alınamadı:',
        error
      );

      return null;
    }

    return data || null;
  }

  async function updateNav(user){
    ensureUI();

    const btn =
      document.getElementById(
        'auth-nav-button'
      );

    if(!btn) return;

    if(!user){
      btn.textContent =
        'Giriş Yap';

      btn.onclick = e => {
        e.preventDefault();
        openAuth('login');
      };

      return;
    }

    const profile =
      await getProfile(user);

    const username =
      profile?.username ||
      user.user_metadata?.username ||
      '';

    const role =
      profile?.site_role ||
      'user';

    if(!username){
      btn.textContent =
        '👤 Kullanıcı Adı';

      btn.onclick = e => {
        e.preventDefault();
        openAuth('complete');
      };

      if(
        !window.atlantisProfilePrompted
      ){
        window.atlantisProfilePrompted =
          true;

        window.setTimeout(
          () =>
            openAuth(
              'complete'
            ),
          250
        );
      }

      return;
    }

    btn.textContent =
      '👤 ' + username;

    btn.onclick = e => {
      e.preventDefault();

      openProfileMenu(
        username,
        role
      );
    };
  }

  function openProfileMenu(
    username,
    role
  ){
    const old =
      document.getElementById(
        'profile-pop'
      );

    if(old){
      old.remove();
    }

    const roleLabel =
      role === 'admin'
        ? 'Yönetici'
        : role === 'moderator'
          ? 'Moderatör'
          : 'Oyuncu';

    const p =
      document.createElement(
        'div'
      );

    p.id =
      'profile-pop';

    p.className =
      'profile-pop';

    p.innerHTML = `
      <strong>
        ${esc(username)}
      </strong>

      <span
        class="role-chip role-${esc(role)}"
      >
        ${roleLabel}
      </span>

      <a href="sohbet.html">
        Sohbete Git
      </a>

      ${
        role !== 'user'
          ? `
            <a href="moderasyon.html">
              Moderasyon Paneli
            </a>
          `
          : ''
      }

      <button
        id="logout-btn"
        type="button"
      >
        Çıkış Yap
      </button>
    `;

    document.body.appendChild(p);

    p.querySelector(
      '#logout-btn'
    ).onclick = async () => {

      if(
        window.atlantisSupabase
      ){
        await window
          .atlantisSupabase
          .auth
          .signOut();
      }

      p.remove();

      await updateNav(
        null
      );
    };

    window.setTimeout(
      () => {

        const close =
          e => {

            if(
              !p.contains(
                e.target
              ) &&
              e.target.id !==
                'auth-nav-button'
            ){
              p.remove();

              document.removeEventListener(
                'click',
                close
              );
            }
          };

        document.addEventListener(
          'click',
          close
        );

      },
      0
    );
  }
    function closeProfileMenu(){
    const pop =
      document.getElementById(
        'profile-pop'
      );

    if(pop){
      pop.remove();
    }
  }

  async function initAuth(){
    ensureUI();

    const s =
      await getClient();

    if(!s){
      return;
    }

    const {
      data: {
        session
      }
    } =
      await s.auth.getSession();

    await updateNav(
      session?.user || null
    );

    s.auth.onAuthStateChange(
      async (
        event,
        newSession
      ) => {

        /*
         * Supabase callback sırasında
         * ağır işlemleri doğrudan event
         * callback'inde çalıştırmıyoruz.
         */
        window.setTimeout(
          async () => {

            await updateNav(
              newSession?.user ||
              null
            );

          },
          0
        );
      }
    );
  }

  /*
   * Modal açılırken ESC ile kapat.
   */
  document.addEventListener(
    'keydown',
    event => {

      if(
        event.key !== 'Escape'
      ){
        return;
      }

      const modal =
        document.getElementById(
          'auth-modal'
        );

      if(
        modal &&
        !modal.hidden
      ){
        closeAuth();
      }
    }
  );

  /*
   * Sayfa hazır olduğunda başlat.
   */
  if(
    document.readyState ===
    'loading'
  ){
    document.addEventListener(
      'DOMContentLoaded',
      initAuth,
      {once:true}
    );
  }else{
    initAuth();
  }

})();

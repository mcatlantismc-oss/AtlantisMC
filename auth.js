/* Atlantis MC — hesap, Google, e-posta OTP, profil ve rol arayüzü */
(function(){
  'use strict';

  const cfg = window.ATLANTIS_SUPABASE || {};
  const configuredEdgeUrl =
    String(window.ATLANTIS_EDGE_URL || '').replace(/\/+$/, '');

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

  let clientPromise = null;
  let resendTimer = null;
  let resendSeconds = 0;

  function boot(){
    if(!window.supabase) return null;

    const client =
      window.supabase.createClient(
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
      #auth-modal .auth-form[hidden],
      #auth-modal .auth-tabs[hidden] {
        display: none !important;
      }

      #auth-modal .auth-form:not([hidden]) {
        display: grid;
      }

      #auth-modal .auth-helper {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: -2px;
      }

      #auth-modal .auth-password-wrap {
        position: relative;
      }

      #auth-modal .auth-password-wrap input {
        padding-right: 82px;
      }

      #auth-modal .auth-password-toggle {
        position: absolute;
        right: 10px;
        bottom: 10px;
        border: 0;
        background: transparent;
        color: #9fdcff;
        font: inherit;
        font-size: 12px;
        font-weight: 800;
        cursor: pointer;
        padding: 7px 8px;
      }

      #auth-modal .password-strength {
        height: 5px;
        border-radius: 999px;
        background: rgba(255,255,255,.08);
        overflow: hidden;
        margin-top: -3px;
      }

      #auth-modal .password-strength > span {
        display: block;
        width: 0;
        height: 100%;
        border-radius: inherit;
        transition: width .2s ease;
      }

      #auth-modal .otp-input {
        text-align: center;
        letter-spacing: .45em;
        padding-left: .45em;
        font-weight: 800;
        font-size: 24px;
      }

      #auth-modal .otp-toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        margin-top: -4px;
      }

      #auth-modal .otp-resend {
        border: 0;
        background: transparent;
        color: #87d5ff;
        font: inherit;
        font-size: 13px;
        font-weight: 800;
        cursor: pointer;
        padding: 4px 0;
      }

      #auth-modal .otp-resend:disabled {
        opacity: .45;
        cursor: default;
      }

      #auth-modal .auth-badge {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        align-self: center;
        margin: 0 auto 10px;
        padding: 7px 11px;
        border: 1px solid rgba(112,205,255,.22);
        border-radius: 999px;
        background: rgba(52,146,205,.08);
        color: #a9dfff;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: .08em;
        text-transform: uppercase;
      }

      #auth-modal .auth-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #70d5ff;
        box-shadow: 0 0 12px rgba(112,213,255,.85);
      }
    `;

    document.head.appendChild(style);
  }

  function ensureUI(){
    if(
      document.getElementById(
        'auth-modal'
      )
    ){
      return;
    }

    injectVisibilityFix();

    const nav =
      document.querySelector(
        '.site-nav'
      );

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

            <div class="auth-password-wrap">
              <input
                name="password"
                type="password"
                autocomplete="current-password"
                required
                minlength="8"
                placeholder="Şifren"
              >

              <button
                type="button"
                class="auth-password-toggle"
                data-toggle-password
              >
                Göster
              </button>
            </div>
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

            <div class="auth-password-wrap">
              <input
                name="password"
                type="password"
                autocomplete="new-password"
                required
                minlength="8"
                placeholder="En az 8 karakter"
              >

              <button
                type="button"
                class="auth-password-toggle"
                data-toggle-password
              >
                Göster
              </button>
            </div>
          </label>

          <div
            class="password-strength"
            aria-hidden="true"
          >
            <span></span>
          </div>

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

          <div class="auth-badge">
            <span class="auth-dot"></span>
            Atlantis MC Güvenli Kurtarma
          </div>

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
              class="otp-input"
              inputmode="numeric"
              autocomplete="one-time-code"
              pattern="[0-9]{6}"
              maxlength="6"
              required
              placeholder="123456"
            >
          </label>

          <div class="otp-toolbar">
            <span
              id="otp-countdown"
            ></span>

            <button
              type="button"
              class="otp-resend"
              id="otp-resend"
            >
              Kodu tekrar gönder
            </button>
          </div>

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

            <div class="auth-password-wrap">
              <input
                name="password"
                type="password"
                autocomplete="new-password"
                minlength="8"
                required
                placeholder="Yeni şifre"
              >

              <button
                type="button"
                class="auth-password-toggle"
                data-toggle-password
              >
                Göster
              </button>
            </div>
          </label>

          <label>
            Yeni şifre tekrar

            <div class="auth-password-wrap">
              <input
                name="password2"
                type="password"
                autocomplete="new-password"
                minlength="8"
                required
                placeholder="Yeni şifre tekrar"
              >

              <button
                type="button"
                class="auth-password-toggle"
                data-toggle-password
              >
                Göster
              </button>
            </div>
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
          aria-live="polite"
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

    modal.querySelectorAll(
      '[data-toggle-password]'
    ).forEach(button => {
      button.onclick = () => {
        const input =
          button
            .closest('.auth-password-wrap')
            ?.querySelector('input');

        if(!input) return;

        const visible =
          input.type === 'text';

        input.type =
          visible
            ? 'password'
            : 'text';

        button.textContent =
          visible
            ? 'Göster'
            : 'Gizle';
      };
    });

    const signupPassword =
      modal.querySelector(
        '#auth-signup-form input[name="password"]'
      );

    const strengthBar =
      modal.querySelector(
        '.password-strength > span'
      );

    if(
      signupPassword &&
      strengthBar
    ){
      signupPassword.addEventListener(
        'input',
        () => {
          const value =
            signupPassword.value;

          let score = 0;

          if(value.length >= 8){
            score++;
          }

          if(value.length >= 12){
            score++;
          }

          if(/[A-ZÇĞİÖŞÜ]/.test(value)){
            score++;
          }

          if(/[0-9]/.test(value)){
            score++;
          }

          if(
            /[^A-Za-zÇĞİÖŞÜçğıöşü0-9]/.test(value)
          ){
            score++;
          }

          strengthBar.style.width =
            Math.min(
              100,
              score * 20
            ) + '%';
        }
      );
    }

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

    modal.querySelector(
      '#otp-resend'
    ).onclick = resendOtp;
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

  function startResendTimer(){
    clearInterval(
      resendTimer
    );

    resendSeconds = 60;

    const button =
      document.getElementById(
        'otp-resend'
      );

    const countdown =
      document.getElementById(
        'otp-countdown'
      );

    if(button){
      button.disabled = true;
    }

    const tick = () => {
      if(countdown){
        countdown.textContent =
          resendSeconds > 0
            ? `${resendSeconds} sn`
            : '';
      }

      if(
        resendSeconds <= 0
      ){
        clearInterval(
          resendTimer
        );

        if(button){
          button.disabled = false;
        }

        if(countdown){
          countdown.textContent = '';
        }

        return;
      }

      resendSeconds--;
    };

    tick();

    resendTimer =
      setInterval(
        tick,
        1000
      );
  }

  function stopResendTimer(){
    clearInterval(
      resendTimer
    );

    resendTimer = null;

    const button =
      document.getElementById(
        'otp-resend'
      );

    const countdown =
      document.getElementById(
        'otp-countdown'
      );

    if(button){
      button.disabled = false;
    }

    if(countdown){
      countdown.textContent = '';
    }
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

    if(name !== 'otp'){
      stopResendTimer();
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

    stopResendTimer();
  }

  window.openAtlantisAuth =
    openAuth;

  async function getClient(){
    if(clientPromise){
      return clientPromise;
    }

    clientPromise =
      window.atlantisAuthReady;

    return await clientPromise;
  }
    async function login(event){
    event.preventDefault();

    const form =
      event.currentTarget;

    const identifier =
      String(
        form.elements.identifier.value || ''
      ).trim();

    const password =
      String(
        form.elements.password.value || ''
      );

    if(!identifier || !password){
      setMessage(
        'Kullanıcı adı/e-posta ve şifre gerekli.',
        'error'
      );
      return;
    }

    const button =
      form.querySelector(
        'button[type="submit"]'
      );

    const oldText =
      button?.textContent || 'Giriş Yap';

    if(button){
      button.disabled = true;
      button.textContent =
        'Giriş yapılıyor...';
    }

    try{
      const client =
        await getClient();

      if(!client){
        throw new Error(
          'Supabase bağlantısı kurulamadı.'
        );
      }

      if(
        EMAIL_REGEX.test(identifier)
      ){
        const {
          data,
          error
        } =
          await client.auth.signInWithPassword({
            email: identifier,
            password
          });

        if(error){
          throw new Error(
            'E-posta veya şifre hatalı.'
          );
        }

        if(!data?.session){
          throw new Error(
            'Oturum oluşturulamadı.'
          );
        }

        await afterLogin(
          data.session
        );

        return;
      }

      const endpoint =
        getLoginEndpoint();

      if(!endpoint){
        throw new Error(
          'Giriş servisi yapılandırılmamış.'
        );
      }

      const response =
        await fetch(
          endpoint,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',

              'apikey':
                cfg.publishableKey
            },

            body: JSON.stringify({
              username: identifier,
              password
            })
          }
        );

      let result = null;

      try{
        result =
          await response.json();
      }catch{
        result = null;
      }

      if(
        !response.ok ||
        !result?.session
      ){
        throw new Error(
          result?.error ||
          'Kullanıcı adı veya şifre hatalı.'
        );
      }

      const {
        error
      } =
        await client.auth.setSession({
          access_token:
            result.session.access_token,

          refresh_token:
            result.session.refresh_token
        });

      if(error){
        throw error;
      }

      await afterLogin(
        result.session
      );

    }catch(error){
      console.error(
        '[Atlantis Auth] login:',
        error
      );

      setMessage(
        error?.message ||
        'Giriş başarısız.',
        'error'
      );

    }finally{
      if(button){
        button.disabled = false;
        button.textContent =
          oldText;
      }
    }
  }

  async function signup(event){
    event.preventDefault();

    const form =
      event.currentTarget;

    const username =
      String(
        form.elements.username.value || ''
      ).trim();

    const email =
      String(
        form.elements.email.value || ''
      )
      .trim()
      .toLowerCase();

    const password =
      String(
        form.elements.password.value || ''
      );

    if(
      !NAME_REGEX.test(username)
    ){
      setMessage(
        'Kullanıcı adı 3–16 karakter olmalı; ilk karakter harf olmalı ve boşluk/özel sembol içermemeli.',
        'error'
      );
      return;
    }

    if(
      !EMAIL_REGEX.test(email)
    ){
      setMessage(
        'Geçerli bir e-posta adresi gir.',
        'error'
      );
      return;
    }

    if(
      password.length < 8
    ){
      setMessage(
        'Şifre en az 8 karakter olmalı.',
        'error'
      );
      return;
    }

    const button =
      form.querySelector(
        'button[type="submit"]'
      );

    const oldText =
      button?.textContent || 'Kayıt Ol';

    if(button){
      button.disabled = true;
      button.textContent =
        'Hesap oluşturuluyor...';
    }

    try{
      const client =
        await getClient();

      if(!client){
        throw new Error(
          'Supabase bağlantısı kurulamadı.'
        );
      }

      const {
        data: existing,
        error: profileError
      } =
        await client
          .from('profiles')
          .select('id')
          .ilike(
            'username',
            username
          )
          .maybeSingle();

      if(profileError){
        console.warn(
          '[Atlantis Auth] profile check:',
          profileError
        );
      }

      if(existing){
        throw new Error(
          'Bu kullanıcı adı zaten kullanılıyor.'
        );
      }

      const {
        data,
        error
      } =
        await client.auth.signUp({
          email,
          password,

          options: {
            emailRedirectTo:
              window.location.origin +
              window.location.pathname
          }
        });

      if(error){
        const msg =
          String(
            error.message || ''
          ).toLowerCase();

        if(
          msg.includes('already') ||
          msg.includes('registered')
        ){
          throw new Error(
            'Bu e-posta adresi zaten kayıtlı.'
          );
        }

        throw new Error(
          'Kayıt oluşturulamadı. Bilgilerini kontrol et.'
        );
      }

      if(!data?.user){
        throw new Error(
          'Hesap oluşturulamadı.'
        );
      }

      window.atlantisPendingEmail =
        email;

      window.atlantisPendingUsername =
        username;

      window.atlantisOtpMode =
        'signup';

      if(data.session){
        await saveProfile(
          data.user,
          username
        );

        await afterLogin(
          data.session
        );

        return;
      }

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

    }catch(error){
      console.error(
        '[Atlantis Auth] signup:',
        error
      );

      setMessage(
        error?.message ||
        'Kayıt sırasında bir hata oluştu.',
        'error'
      );

    }finally{
      if(button){
        button.disabled = false;
        button.textContent =
          oldText;
      }
    }
  }

  async function googleLogin(){
    try{
      const client =
        await getClient();

      if(!client){
        throw new Error(
          'Supabase bağlantısı kurulamadı.'
        );
      }

      setMessage(
        'Google giriş sayfası açılıyor...',
        'info'
      );

      const redirectTo =
        window.location.origin +
        window.location.pathname;

      const {
        error
      } =
        await client.auth.signInWithOAuth({
          provider: 'google',

          options: {
            redirectTo,

            queryParams: {
              access_type: 'offline',
              prompt: 'select_account'
            }
          }
        });

      if(error){
        const message =
          String(
            error.message || ''
          );

        if(
          message
            .toLowerCase()
            .includes('provider')
        ){
          throw new Error(
            'Google girişi Supabase üzerinde henüz etkinleştirilmemiş.'
          );
        }

        throw error;
      }

    }catch(error){
      console.error(
        '[Atlantis Auth] google:',
        error
      );

      setMessage(
        error?.message ||
        'Google ile giriş başlatılamadı.',
        'error'
      );
    }
  }

  async function forgot(event){
    event.preventDefault();

    const form =
      event.currentTarget;

    const email =
      String(
        form.elements.email.value || ''
      )
      .trim()
      .toLowerCase();

    if(
      !EMAIL_REGEX.test(email)
    ){
      setMessage(
        'Geçerli bir e-posta adresi gir.',
        'error'
      );
      return;
    }

    const button =
      form.querySelector(
        'button[type="submit"]'
      );

    const oldText =
      button?.textContent || 'Kod Gönder';

    if(button){
      button.disabled = true;
      button.textContent =
        'Kontrol ediliyor...';
    }

    try{
      const client =
        await getClient();

      if(!client){
        throw new Error(
          'Supabase bağlantısı kurulamadı.'
        );
      }

      /*
       * Kullanıcı gerçekten var mı diye
       * güvenli şekilde Edge Function üzerinden
       * kontrol edeceğiz.
       *
       * Function hazır değilse fallback olarak
       * standart Supabase recovery isteği yapılır.
       */
      const recoveryEndpoint =
        window.ATLANTIS_RECOVERY_URL || '';

      if(recoveryEndpoint){
        const response =
          await fetch(
            recoveryEndpoint,
            {
              method: 'POST',

              headers: {
                'Content-Type':
                  'application/json',

                apikey:
                  cfg.publishableKey
              },

              body: JSON.stringify({
                email
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
            'Bu e-posta adresi kayıtlı değil.'
          );
        }
      }else{
        const {
          error
        } =
          await client.auth.resetPasswordForEmail(
            email,
            {
              redirectTo:
                window.location.origin +
                window.location.pathname
            }
          );

        if(error){
          throw new Error(
            'Şifre sıfırlama işlemi başlatılamadı.'
          );
        }
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
          ' adresine 6 haneli doğrulama kodu gönderildi.';
      }

      startResendTimer();

      setMessage(
        'Kod e-posta adresine gönderildi.',
        'success'
      );

    }catch(error){
      console.error(
        '[Atlantis Auth] recovery:',
        error
      );

      setMessage(
        error?.message ||
        'Kod gönderilemedi.',
        'error'
      );

    }finally{
      if(button){
        button.disabled = false;
        button.textContent =
          oldText;
      }
    }
  }  async function verifyOtp(event){
    event.preventDefault();

    const form =
      event.currentTarget;

    const token =
      String(
        form.elements.token.value || ''
      ).replace(/\D/g, '');

    const email =
      String(
        window.atlantisPendingEmail || ''
      )
      .trim()
      .toLowerCase();

    if(!email){
      setMessage(
        'Doğrulama oturumunun süresi dolmuş. Baştan başla.',
        'error'
      );
      showForm('login');
      return;
    }

    if(!/^\d{6}$/.test(token)){
      setMessage(
        '6 haneli doğrulama kodunu eksiksiz gir.',
        'error'
      );
      return;
    }

    const button =
      form.querySelector(
        'button[type="submit"]'
      );

    const oldText =
      button?.textContent ||
      'Kodu Doğrula';

    if(button){
      button.disabled = true;
      button.textContent =
        'Doğrulanıyor...';
    }

    try{
      const client =
        await getClient();

      if(!client){
        throw new Error(
          'Supabase bağlantısı kurulamadı.'
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
        await client.auth.verifyOtp({
          email,
          token,
          type
        });

      if(error){
        throw new Error(
          'Kod hatalı veya süresi dolmuş.'
        );
      }

      if(
        type === 'recovery'
      ){
        showForm('reset');

        setMessage(
          'Kod doğrulandı. Şimdi yeni şifreni belirle.',
          'success'
        );

        return;
      }

      if(!data?.user){
        throw new Error(
          'Hesap doğrulandı fakat kullanıcı bilgisi alınamadı.'
        );
      }

      const username =
        window.atlantisPendingUsername;

      if(username){
        await saveProfile(
          data.user,
          username
        );
      }

      if(data.session){
        await afterLogin(
          data.session
        );
      }else{
        closeAuth();
      }

    }catch(error){
      console.error(
        '[Atlantis Auth] verifyOtp:',
        error
      );

      setMessage(
        error?.message ||
        'Kod doğrulanamadı.',
        'error'
      );

    }finally{
      if(button){
        button.disabled = false;
        button.textContent =
          oldText;
      }
    }
  }

  async function resendOtp(){
    if(
      resendSeconds > 0
    ){
      return;
    }

    const email =
      String(
        window.atlantisPendingEmail || ''
      )
      .trim()
      .toLowerCase();

    if(
      !EMAIL_REGEX.test(email)
    ){
      setMessage(
        'E-posta adresi bulunamadı.',
        'error'
      );
      return;
    }

    const button =
      document.getElementById(
        'otp-resend'
      );

    if(button){
      button.disabled = true;
      button.textContent =
        'Gönderiliyor...';
    }

    try{
      const client =
        await getClient();

      if(!client){
        throw new Error(
          'Supabase bağlantısı kurulamadı.'
        );
      }

      /*
       * Kayıt doğrulama kodu
       */
      if(
        window.atlantisOtpMode ===
        'signup'
      ){
        const {
          error
        } =
          await client.auth.resend({
            type: 'signup',
            email
          });

        if(error){
          throw error;
        }

      /*
       * Şifre kurtarma kodu
       */
      }else{
        const {
          error
        } =
          await client.auth.resetPasswordForEmail(
            email,
            {
              redirectTo:
                window.location.origin +
                window.location.pathname
            }
          );

        if(error){
          throw error;
        }
      }

      setMessage(
        'Yeni doğrulama kodu gönderildi.',
        'success'
      );

      startResendTimer();

    }catch(error){
      console.error(
        '[Atlantis Auth] resendOtp:',
        error
      );

      setMessage(
        'Kod tekrar gönderilemedi. Biraz sonra tekrar dene.',
        'error'
      );

      if(button){
        button.disabled = false;
        button.textContent =
          'Kodu tekrar gönder';
      }
    }
  }

  async function resetPassword(event){
    event.preventDefault();

    const form =
      event.currentTarget;

    const password =
      String(
        form.elements.password.value || ''
      );

    const password2 =
      String(
        form.elements.password2.value || ''
      );

    if(
      password.length < 8
    ){
      setMessage(
        'Yeni şifre en az 8 karakter olmalı.',
        'error'
      );
      return;
    }

    if(password !== password2){
      setMessage(
        'Şifreler aynı değil.',
        'error'
      );
      return;
    }

    const button =
      form.querySelector(
        'button[type="submit"]'
      );

    const oldText =
      button?.textContent ||
      'Şifreyi Değiştir';

    if(button){
      button.disabled = true;
      button.textContent =
        'Kaydediliyor...';
    }

    try{
      const client =
        await getClient();

      if(!client){
        throw new Error(
          'Supabase bağlantısı kurulamadı.'
        );
      }

      const {
        error
      } =
        await client.auth.updateUser({
          password
        });

      if(error){
        throw error;
      }

      setMessage(
        'Şifren başarıyla değiştirildi.',
        'success'
      );

      window.setTimeout(
        async () => {
          const {
            data
          } =
            await client.auth.getSession();

          if(data?.session){
            await afterLogin(
              data.session
            );
          }else{
            closeAuth();
          }
        },
        800
      );

    }catch(error){
      console.error(
        '[Atlantis Auth] resetPassword:',
        error
      );

      setMessage(
        'Şifre değiştirilemedi. Tekrar dene.',
        'error'
      );

    }finally{
      if(button){
        button.disabled = false;
        button.textContent =
          oldText;
      }
    }
  }

  async function completeProfile(event){
    event.preventDefault();

    const form =
      event.currentTarget;

    const username =
      String(
        form.elements.username.value || ''
      ).trim();

    if(
      !NAME_REGEX.test(username)
    ){
      setMessage(
        'Kullanıcı adı 3–16 karakter olmalı; ilk karakter harf olmalı ve boşluk/özel sembol içermemeli.',
        'error'
      );
      return;
    }

    const button =
      form.querySelector(
        'button[type="submit"]'
      );

    const oldText =
      button?.textContent ||
      'Kullanıcı Adımı Kaydet';

    if(button){
      button.disabled = true;
      button.textContent =
        'Kontrol ediliyor...';
    }

    try{
      const client =
        await getClient();

      if(!client){
        throw new Error(
          'Supabase bağlantısı kurulamadı.'
        );
      }

      const {
        data: {
          session
        }
      } =
        await client.auth.getSession();

      if(!session?.user){
        showForm('login');

        throw new Error(
          'Oturum bulunamadı. Tekrar giriş yap.'
        );
      }

      const {
        data: existing,
        error: checkError
      } =
        await client
          .from('profiles')
          .select('id')
          .ilike(
            'username',
            username
          )
          .maybeSingle();

      if(checkError){
        console.warn(
          '[Atlantis Auth] username check:',
          checkError
        );
      }

      if(
        existing &&
        existing.id !==
          session.user.id
      ){
        throw new Error(
          'Bu kullanıcı adı zaten alınmış.'
        );
      }

      await saveProfile(
        session.user,
        username
      );

      closeAuth();

      await updateNav(
        session.user
      );

    }catch(error){
      console.error(
        '[Atlantis Auth] completeProfile:',
        error
      );

      setMessage(
        error?.message ||
        'Kullanıcı adı kaydedilemedi.',
        'error'
      );

    }finally{
      if(button){
        button.disabled = false;
        button.textContent =
          oldText;
      }
    }
  }

  async function saveProfile(
    user,
    username
  ){
    if(
      !user ||
      !window.atlantisSupabase
    ){
      return;
    }

    const cleanUsername =
      String(
        username || ''
      ).trim();

    if(
      !NAME_REGEX.test(
        cleanUsername
      )
    ){
      throw new Error(
        'Geçersiz kullanıcı adı.'
      );
    }

    /*
     * RPC kullanıyoruz.
     * Böylece kullanıcı kendi profilini
     * kontrollü şekilde değiştirebilir.
     */
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
        '[Atlantis Auth] saveProfile:',
        error
      );

      throw new Error(
        'Bu kullanıcı adı kullanılamıyor.'
      );
    }
  }

  async function getProfile(user){
    const client =
      window.atlantisSupabase;

    if(
      !client ||
      !user
    ){
      return null;
    }

    const {
      data,
      error
    } =
      await client
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
        '[Atlantis Auth] getProfile:',
        error
      );

      return null;
    }

    return data || null;
  }

  async function afterLogin(
    session
  ){
    if(!session?.user){
      throw new Error(
        'Geçerli oturum bulunamadı.'
      );
    }

    window.atlantisAuthSession =
      session;

    await updateNav(
      session.user
    );

    closeAuth();

    /*
     * Sayfanın diğer scriptlerine
     * giriş olayını bildiriyoruz.
     */
    window.dispatchEvent(
      new CustomEvent(
        'atlantis-auth-login',
        {
          detail: {
            user:
              session.user,
            session
          }
        }
      )
    );
  }

  async function updateNav(
    user
  ){
    ensureUI();

    const btn =
      document.getElementById(
        'auth-nav-button'
      );

    if(!btn){
      return;
    }

    if(!user){
      btn.textContent =
        'Giriş Yap';

      btn.onclick = event => {
        event.preventDefault();
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

      btn.onclick = event => {
        event.preventDefault();
        openAuth('complete');
      };

      if(
        !window.atlantisProfilePrompted
      ){
        window.atlantisProfilePrompted =
          true;

        window.setTimeout(
          () => openAuth('complete'),
          250
        );
      }

      return;
    }

    btn.textContent =
      '👤 ' + username;

    btn.onclick = event => {
      event.preventDefault();

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

    const pop =
      document.createElement(
        'div'
      );

    pop.id =
      'profile-pop';

    pop.className =
      'profile-pop';

    pop.innerHTML = `
      <div class="profile-pop-head">
        <span class="profile-pop-avatar">
          👤
        </span>

        <div>
          <strong>
            ${esc(username)}
          </strong>

          <span
            class="role-chip role-${esc(role)}"
          >
            ${roleLabel}
          </span>
        </div>
      </div>

      <div class="profile-pop-divider"></div>

      <a href="sohbet.html">
        <span>💬</span>
        Sohbete Git
      </a>

      ${
        role === 'admin' ||
        role === 'moderator'
          ? `
            <a href="moderasyon.html">
              <span>🛡️</span>
              Moderasyon Paneli
            </a>
          `
          : ''
      }

      <button
        id="logout-btn"
        type="button"
      >
        <span>↪</span>
        Çıkış Yap
      </button>
    `;

    document.body.appendChild(
      pop
    );

    const logout =
      pop.querySelector(
        '#logout-btn'
      );

    if(logout){
      logout.onclick =
        async () => {

          logout.disabled = true;
          logout.textContent =
            'Çıkış yapılıyor...';

          try{
            const client =
              await getClient();

            if(client){
              await client.auth.signOut();
            }

            window.atlantisAuthSession =
              null;

            closeProfileMenu();

            await updateNav(
              null
            );

            window.dispatchEvent(
              new CustomEvent(
                'atlantis-auth-logout'
              )
            );

          }catch(error){
            console.error(
              '[Atlantis Auth] logout:',
              error
            );

            logout.disabled =
              false;

            logout.innerHTML =
              '<span>↪</span> Çıkış Yap';
          }
        };
    }

    /*
     * Menü dışına tıklanınca kapat.
     */
    window.setTimeout(
      () => {

        const outsideClick =
          event => {

            const target =
              event.target;

            if(
              !pop.contains(target) &&
              target.id !==
                'auth-nav-button'
            ){
              closeProfileMenu();

              document.removeEventListener(
                'click',
                outsideClick
              );
            }
          };

        document.addEventListener(
          'click',
          outsideClick
        );

        pop._outsideClick =
          outsideClick;

      },
      0
    );
  }

  function closeProfileMenu(){
    const pop =
      document.getElementById(
        'profile-pop'
      );

    if(!pop){
      return;
    }

    if(
      pop._outsideClick
    ){
      document.removeEventListener(
        'click',
        pop._outsideClick
      );
    }

    pop.remove();
  }

  function clearPendingAuth(){
    window.atlantisPendingEmail =
      null;

    window.atlantisPendingUsername =
      null;

    window.atlantisOtpMode =
      null;

    stopResendTimer();
  }

  function closeAuth(){
    const modal =
      document.getElementById(
        'auth-modal'
      );

    if(modal){
      modal.hidden = true;
    }

    document.body.classList.remove(
      'auth-open'
    );

    clearPendingAuth();
  }

  /*
   * Supabase OAuth dönüşünü kontrol ediyoruz.
   *
   * Kullanıcı Google'dan döndüğünde veya
   * e-posta doğrulaması yaptığında Supabase
   * session'ı otomatik olarak oluşturur.
   */
  async function handleAuthCallback(){
    try{
      const client =
        await getClient();

      if(!client){
        return;
      }

      const {
        data: {
          session
        }
      } =
        await client.auth.getSession();

      if(session?.user){
        window.atlantisAuthSession =
          session;

        await updateNav(
          session.user
        );
      }

      /*
       * URL'de Supabase'in auth parametreleri
       * kaldıysa bunları temizliyoruz.
       *
       * Böylece kullanıcı adres çubuğunda
       * uzun token/parametreler görmez.
       */
      const url =
        new URL(
          window.location.href
        );

      const hasAuthParams =
        url.searchParams.has(
          'code'
        ) ||
        url.searchParams.has(
          'token_hash'
        ) ||
        url.searchParams.has(
          'type'
        ) ||
        url.hash.includes(
          'access_token='
        ) ||
        url.hash.includes(
          'refresh_token='
        );

      if(hasAuthParams){
        url.searchParams.delete(
          'code'
        );

        url.searchParams.delete(
          'token_hash'
        );

        url.searchParams.delete(
          'type'
        );

        window.history.replaceState(
          {},
          document.title,
          url.pathname +
          url.search +
          url.hash
        );
      }

    }catch(error){
      console.error(
        '[Atlantis Auth] callback:',
        error
      );
    }
  }

  async function initAuth(){
    ensureUI();

    const client =
      await getClient();

    if(!client){
      console.warn(
        '[Atlantis Auth] Supabase client bulunamadı.'
      );

      return;
    }

    /*
     * Mevcut oturumu yükle.
     */
    const {
      data: {
        session
      }
    } =
      await client.auth.getSession();

    if(session?.user){
      window.atlantisAuthSession =
        session;
    }

    await updateNav(
      session?.user || null
    );

    await handleAuthCallback();

    /*
     * Auth değişikliklerini dinle.
     */
    client.auth.onAuthStateChange(
      (
        event,
        newSession
      ) => {

        /*
         * Supabase callback içinde
         * ağır işlemleri doğrudan çalıştırmıyoruz.
         */
        window.setTimeout(
          async () => {

            if(newSession){
              window.atlantisAuthSession =
                newSession;
            }else{
              window.atlantisAuthSession =
                null;
            }

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
   * ESC ile modalı kapat.
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

      closeProfileMenu();
    }
  );

  /*
   * Modal açıkken arka planda sayfanın
   * kaydırılmasını engelle.
   */
  const bodyObserver =
    new MutationObserver(
      () => {

        const modal =
          document.getElementById(
            'auth-modal'
          );

        if(
          modal &&
          !modal.hidden
        ){
          document.body.classList.add(
            'auth-open'
          );
        }
      }
    );

  /*
   * DOM hazır olduğunda başlat.
   */
  if(
    document.readyState ===
    'loading'
  ){

    document.addEventListener(
      'DOMContentLoaded',
      () => {

        bodyObserver.observe(
          document.body,
          {
            childList: true,
            subtree: true
          }
        );

        initAuth();

      },
      {
        once: true
      }
    );

  }else{

    bodyObserver.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );

    initAuth();
  }

  /*
   * Dışarıdan kullanmak istersen:
   *
   * window.openAtlantisAuth('login')
   * window.openAtlantisAuth('signup')
   * window.openAtlantisAuth('forgot')
   */
  window.openAtlantisAuth =
    openAuth;

  window.closeAtlantisAuth =
    closeAuth;

})();

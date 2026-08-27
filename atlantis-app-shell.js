/* AtlantisMC — persistent app shell
   Keeps the header/account/menu alive while the content below changes.
   Uses History API + fetch when possible; falls back to normal navigation.
*/
(() => {
  'use strict';

  const body = document.body;
  const shellHeader = document.querySelector('.site-header');
  const main = document.querySelector('main.content');
  const footer = document.querySelector('.site-footer');

  if (!shellHeader || !main) return;

  // Mark shell elements so page renderer never replaces them.
  shellHeader.dataset.atlantisShell = 'header';
  if (footer) footer.dataset.atlantisShell = 'footer';

  let navigating = false;
  const currentPath = () => location.pathname.replace(/\/+$/, '') || '/';

  const localTarget = (href) => {
    try {
      const url = new URL(href, location.href);
      if (url.origin !== location.origin) return null;
      if (url.hash) return null;
      return url;
    } catch {
      return null;
    }
  };

  function closeMenusForNavigation() {
    body.classList.remove('menu-open', 'drawer-open', 'auth-open');
    document.querySelector('.site-header')?.classList.remove('menu-open');
    const t = document.querySelector('.menu-toggle');
    if (t) {
      t.classList.remove('is-open');
      t.setAttribute('aria-expanded', 'false');
    }
  }

  function setActiveNav(path) {
    document.querySelectorAll('.site-nav a').forEach(a => {
      const url = localTarget(a.href);
      if (!url) return;
      const active = url.pathname.replace(/\/+$/, '') === path;
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  async function fetchPage(url) {
    const response = await fetch(url.href, { credentials:'same-origin', cache:'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  }

  function extract(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const nextMain = doc.querySelector('main.content');
    const nextTitle = doc.querySelector('title')?.textContent || document.title;
    if (!nextMain) throw new Error('No main content');
    return { nextMain, nextTitle };
  }

  function restartReveals() {
    document.querySelectorAll('.reveal').forEach((el, i) => {
      el.classList.remove('in-view');
      el.style.animationDelay = `${Math.min(i,8) * 45}ms`;
    });
    requestAnimationFrame(() => {
      document.querySelectorAll('.reveal').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight * .95) el.classList.add('in-view');
      });
    });
  }

  async function navigate(href, push = true) {
    if (navigating) return;
    const url = localTarget(href);
    if (!url) {
      location.href = href;
      return;
    }
    if (url.pathname.replace(/\/+$/, '') === currentPath()) {
      closeMenusForNavigation();
      return;
    }

    navigating = true;
    closeMenusForNavigation();

    try {
      const html = await fetchPage(url);
      const { nextMain, nextTitle } = extract(html);

      // Freeze current scroll only for the content swap; do not animate the shell.
      main.classList.add('shell-content-switching');

      // Make the swap immediate. The 120 Hz feel comes from not waiting on a
      // fade-out animation. A tiny opacity settle happens after DOM replacement.
      main.replaceWith(nextMain);
      const newMain = document.querySelector('main.content');
      newMain.classList.add('shell-content-enter');
      requestAnimationFrame(() => newMain.classList.add('shell-content-visible'));

      document.title = nextTitle;
      if (push) history.pushState({ atlantisShell: true }, '', url.href);
      setActiveNav(url.pathname.replace(/\/+$/, '') || '/');
      window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });

      // Rebind/notify page scripts.
      window.dispatchEvent(new CustomEvent('atlantis-content-changed', {
        detail: { url: url.href }
      }));

      // Give newly swapped HTML its page-local scripts only through events.
      setTimeout(restartReveals, 0);
    } catch (error) {
      console.warn('[Atlantis Shell] falling back to normal navigation', error);
      location.href = url.href;
    } finally {
      navigating = false;
    }
  }

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented) return;
    if (link.target === '_blank' || link.hasAttribute('download')) return;
    const href = link.getAttribute('href') || '';
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;

    const url = localTarget(link.href);
    if (!url) return;

    event.preventDefault();
    navigate(url.href, true);
  }, true);

  window.addEventListener('popstate', () => navigate(location.href, false));

  // Prefetch local nav targets on idle so clicks feel instant.
  const prefetch = () => {
    document.querySelectorAll('.site-nav a[href]').forEach(a => {
      const url = localTarget(a.href);
      if (!url || url.pathname.replace(/\/+$/, '') === currentPath()) return;
      fetch(url.href, { credentials:'same-origin', cache:'force-cache' }).catch(() => {});
    });
  };
  if ('requestIdleCallback' in window) requestIdleCallback(prefetch, { timeout: 1200 });
  else setTimeout(prefetch, 700);
})();

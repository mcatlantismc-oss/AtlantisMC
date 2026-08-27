/* Atlantis MC — final visual motion layer.
   Navigation/reveal logic is owned by script.js to avoid duplicate click handlers. */
(() => {
  'use strict';

  function setup() {
    document.body.classList.add('atlantis-motion-ready');

    const modalObserver = new MutationObserver(() => {
      document.querySelectorAll('.auth-modal:not([data-motion-ready])').forEach(modal => {
        modal.dataset.motionReady = '1';
        modal.classList.add('motion-enter');
      });
      document.querySelectorAll('.account-drawer:not([data-motion-ready])').forEach(drawer => {
        drawer.dataset.motionReady = '1';
        drawer.classList.add('motion-enter');
      });
    });

    modalObserver.observe(document.body, { childList: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup, { once: true });
  } else {
    setup();
  }
})();

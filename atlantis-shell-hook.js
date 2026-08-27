/* AtlantisMC — content change hook
   Re-runs light page-local effects after SPA-style main swap.
*/
(() => {
  'use strict';
  function refresh() {
    document.querySelectorAll('.reveal').forEach((el, i) => {
      if (el.getBoundingClientRect().top < innerHeight * .95) {
        el.classList.add('in-view');
      }
    });
  }
  window.addEventListener('atlantis-content-changed', () => setTimeout(refresh, 0));
})();

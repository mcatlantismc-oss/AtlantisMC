/* Atlantis MC — final visual motion layer.
   Navigation/reveal logic is owned by script.js to avoid duplicate click handlers. */
(() => {
  'use strict';

  function markReady(el) {
    if (el.dataset.motionReady) return;
    el.dataset.motionReady = '1';
    el.classList.add('motion-enter');
  }

  function setup() {
    document.body.classList.add('atlantis-motion-ready');

    // Only the nodes actually added in each mutation batch are inspected —
    // no full-document querySelectorAll scans on every DOM change.
    const modalObserver = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          if (node.matches?.('.auth-modal, .account-drawer')) markReady(node);
          node.querySelectorAll?.('.auth-modal:not([data-motion-ready]), .account-drawer:not([data-motion-ready])')
            .forEach(markReady);
        });
      }
    });

    modalObserver.observe(document.body, { childList: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup, { once: true });
  } else {
    setup();
  }
})();

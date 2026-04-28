/* =========================================================
   Investment Tools — Shared client-side behaviour
   - Mobile dropdown taps (desktop hover is CSS-only via .nav-item:hover)
   - Reveal curtain on pages that include .reveal-curtain
   - IntersectionObserver fade-in for [data-fade-in] sections
   No-ops cleanly when target elements are absent.
   ========================================================= */
(function () {
  'use strict';

  function initMobileDropdowns() {
    var navItems = document.querySelectorAll('.nav-item');
    if (!navItems.length) return;

    var isTouchOrNarrow = function () {
      return window.matchMedia('(hover: none)').matches || window.innerWidth < 800;
    };

    navItems.forEach(function (item) {
      var link = item.querySelector('.nav-link');
      if (!link) return;
      link.addEventListener('click', function (e) {
        if (!isTouchOrNarrow()) return;
        e.preventDefault();
        var wasOpen = item.classList.contains('open');
        navItems.forEach(function (n) { n.classList.remove('open'); });
        if (!wasOpen) item.classList.add('open');
      });
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.nav-item')) {
        navItems.forEach(function (n) { n.classList.remove('open'); });
      }
    });
  }

  function initCurtainReveal() {
    var curtain = document.querySelector('.reveal-curtain');
    if (!curtain) return;

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion) {
      document.body.classList.add('revealed');
      curtain.parentNode && curtain.parentNode.removeChild(curtain);
      return;
    }

    var done = false;

    var finish = function () {
      if (done) return;
      done = true;
      curtain.style.transition = 'opacity 2400ms ease-out';
      curtain.style.opacity = '0';
      document.body.classList.add('revealed');
      setTimeout(function () {
        if (curtain && curtain.parentNode) curtain.parentNode.removeChild(curtain);
      }, 2700);
    };

    // Click / keypress anywhere skips the reveal. Capture phase so the curtain
    // intercepts before the click reaches whatever was beneath it (the curtain
    // itself has pointer-events:none, so the original click still goes through).
    var skip = function () {
      if (done) return;
      done = true;
      curtain.style.transition = 'opacity 200ms ease-out';
      curtain.style.opacity = '0';
      document.body.classList.add('revealed');
      setTimeout(function () {
        if (curtain && curtain.parentNode) curtain.parentNode.removeChild(curtain);
      }, 250);
      document.removeEventListener('click', skip, true);
      document.removeEventListener('keydown', skip, true);
    };

    document.addEventListener('click', skip, true);
    document.addEventListener('keydown', skip, true);

    // Wait two frames so the initial opacity:1 commits before we transition.
    var start = function () {
      requestAnimationFrame(function () {
        requestAnimationFrame(finish);
      });
    };

    if (document.readyState === 'complete') {
      start();
    } else {
      window.addEventListener('load', start);
    }
  }

  function initFadeIn() {
    var targets = document.querySelectorAll('[data-fade-in]');
    if (!targets.length || !('IntersectionObserver' in window)) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -10% 0px' });

    targets.forEach(function (t) { observer.observe(t); });
  }

  // Custom dropdown widget — replaces native <select> for editorial styling.
  // Markup contract:
  //   <div class="dropdown-field" data-target-select="myId">
  //     <button class="dropdown-trigger" type="button" aria-expanded="false">
  //       <span class="dropdown-label">Visible label</span>
  //       <svg class="dropdown-chevron" ...></svg>
  //     </button>
  //     <ul class="dropdown-menu" role="listbox">
  //       <li class="dropdown-option selected" data-value="x">Label</li>
  //     </ul>
  //   </div>
  //   <select id="myId" hidden><option value="x">Label</option></select>
  // The hidden <select> stays the source of truth — getElementById('myId').value
  // and the change event still work as before.
  function initCustomDropdowns() {
    var fields = document.querySelectorAll('.dropdown-field');
    if (!fields.length) return;

    fields.forEach(function (field) {
      if (field.dataset.cdInit === '1') return;
      field.dataset.cdInit = '1';

      var trigger = field.querySelector('.dropdown-trigger');
      var menu = field.querySelector('.dropdown-menu');
      var label = field.querySelector('.dropdown-label');
      if (!trigger || !menu || !label) return;

      var targetId = field.getAttribute('data-target-select');
      var target = targetId ? document.getElementById(targetId) : null;

      trigger.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var willOpen = !field.classList.contains('open');
        document.querySelectorAll('.dropdown-field.open').forEach(function (f) {
          if (f !== field) {
            f.classList.remove('open');
            var t = f.querySelector('.dropdown-trigger');
            if (t) t.setAttribute('aria-expanded', 'false');
          }
        });
        field.classList.toggle('open', willOpen);
        trigger.setAttribute('aria-expanded', String(willOpen));
      });

      menu.addEventListener('click', function (e) {
        var opt = e.target.closest('.dropdown-option');
        if (!opt) return;
        var value = opt.getAttribute('data-value');
        label.textContent = opt.textContent.trim();
        menu.querySelectorAll('.dropdown-option').forEach(function (o) {
          o.classList.toggle('selected', o === opt);
        });
        if (target) {
          target.value = value;
          target.dispatchEvent(new Event('change', { bubbles: true }));
        }
        field.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
      });
    });

    // One global click-outside handler — installed once per page.
    if (!document.body.dataset.cdOutsideInstalled) {
      document.body.dataset.cdOutsideInstalled = '1';
      document.addEventListener('click', function (e) {
        if (e.target.closest('.dropdown-field')) return;
        document.querySelectorAll('.dropdown-field.open').forEach(function (f) {
          f.classList.remove('open');
          var t = f.querySelector('.dropdown-trigger');
          if (t) t.setAttribute('aria-expanded', 'false');
        });
      });
    }
  }

  // Public: re-run dropdown init for any newly-rendered .dropdown-field elements.
  // Idempotent — fields with cdInit='1' are skipped, so calling repeatedly is safe.
  // Call after dynamically inserting .dropdown-field markup (e.g. rendered template lists).
  window.initCustomDropdowns = initCustomDropdowns;

  // Public helper: sync custom-dropdown UI from the underlying <select>'s value.
  // Call after programmatically changing the select (e.g. loading saved state).
  window.syncCustomDropdown = function (selectId) {
    var select = document.getElementById(selectId);
    if (!select) return;
    var field = document.querySelector('.dropdown-field[data-target-select="' + selectId + '"]');
    if (!field) return;
    var value = select.value;
    var opt = field.querySelector('.dropdown-option[data-value="' + value + '"]');
    if (!opt) return;
    var label = field.querySelector('.dropdown-label');
    if (label) label.textContent = opt.textContent.trim();
    field.querySelectorAll('.dropdown-option').forEach(function (o) {
      o.classList.toggle('selected', o === opt);
    });
  };

  function init() {
    initMobileDropdowns();
    initCurtainReveal();
    initFadeIn();
    initCustomDropdowns();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

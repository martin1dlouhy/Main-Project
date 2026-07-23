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

    var closeAll = function () {
      navItems.forEach(function (n) {
        n.classList.remove('open');
        var l = n.querySelector('.nav-link');
        if (l) l.setAttribute('aria-expanded', 'false');
      });
    };

    navItems.forEach(function (item) {
      var link = item.querySelector('.nav-link');
      if (!link) return;

      // Přímý link bez dropdownu (např. Dashboard) — žádné toggle handlery,
      // klik i Enter musí navigovat nativně na všech zařízeních.
      if (!item.querySelector('.dropdown')) return;

      // Klávesnicová dostupnost: <a> bez href není fokusovatelný — doplnit programově.
      // Desktop hover zůstává beze změny; klávesnice dostává Enter/šipku/Escape.
      if (!link.hasAttribute('href')) {
        link.setAttribute('tabindex', '0');
        link.setAttribute('role', 'button');
      }
      if (item.querySelector('.dropdown')) {
        link.setAttribute('aria-haspopup', 'true');
        link.setAttribute('aria-expanded', 'false');
      }

      link.addEventListener('click', function (e) {
        if (!isTouchOrNarrow()) return;
        e.preventDefault();
        var wasOpen = item.classList.contains('open');
        closeAll();
        if (!wasOpen) {
          item.classList.add('open');
          link.setAttribute('aria-expanded', 'true');
        }
      });

      link.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault();
          var wasOpen = item.classList.contains('open');
          closeAll();
          if (!wasOpen) {
            item.classList.add('open');
            link.setAttribute('aria-expanded', 'true');
            var first = item.querySelector('.dd-item');
            if (first) first.focus();
          }
        } else if (e.key === 'Escape') {
          closeAll();
          link.blur();
        }
      });

      // Escape uvnitř rozbaleného menu — zavřít a vrátit fokus na odkaz sekce
      item.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && e.target.closest('.dropdown')) {
          closeAll();
          link.focus();
        }
      });
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.nav-item')) {
        closeAll();
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

      // A11y: options jsou fokusovatelné programově (roving focus) a nesou aria-selected
      var getOptions = function () {
        return Array.prototype.slice.call(menu.querySelectorAll('.dropdown-option'));
      };
      var syncOptionA11y = function () {
        getOptions().forEach(function (o) {
          o.tabIndex = -1;
          o.setAttribute('aria-selected', o.classList.contains('selected') ? 'true' : 'false');
        });
      };
      syncOptionA11y();

      var openField = function (focusSelected) {
        document.querySelectorAll('.dropdown-field.open').forEach(function (f) {
          if (f !== field) {
            f.classList.remove('open');
            var t = f.querySelector('.dropdown-trigger');
            if (t) t.setAttribute('aria-expanded', 'false');
          }
        });
        field.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
        if (focusSelected) {
          var sel = menu.querySelector('.dropdown-option.selected') || getOptions()[0];
          if (sel) sel.focus();
        }
      };
      var closeField = function (refocusTrigger) {
        field.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
        if (refocusTrigger) trigger.focus();
      };

      trigger.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (field.classList.contains('open')) {
          closeField(false);
        } else {
          openField(false);
        }
      });

      // Klávesnice na triggeru: šipka dolů/nahoru otevře a fokusuje vybranou volbu, Escape zavře
      trigger.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          openField(true);
        } else if (e.key === 'Escape') {
          closeField(false);
        }
      });

      var selectOption = function (opt) {
        var value = opt.getAttribute('data-value');
        label.textContent = opt.textContent.trim();
        menu.querySelectorAll('.dropdown-option').forEach(function (o) {
          o.classList.toggle('selected', o === opt);
        });
        syncOptionA11y();
        if (target) {
          target.value = value;
          target.dispatchEvent(new Event('change', { bubbles: true }));
        }
        closeField(false);
      };

      menu.addEventListener('click', function (e) {
        var opt = e.target.closest('.dropdown-option');
        if (!opt) return;
        selectOption(opt);
      });

      // Klávesnice v menu: šipky = pohyb, Enter/mezerník = výběr, Escape = zavřít, Home/End = kraje
      menu.addEventListener('keydown', function (e) {
        var opts = getOptions();
        var idx = opts.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          var next = opts[Math.min(idx + 1, opts.length - 1)];
          if (next) next.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          var prev = opts[Math.max(idx - 1, 0)];
          if (prev) prev.focus();
        } else if (e.key === 'Home') {
          e.preventDefault();
          if (opts[0]) opts[0].focus();
        } else if (e.key === 'End') {
          e.preventDefault();
          if (opts[opts.length - 1]) opts[opts.length - 1].focus();
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (idx > -1) {
            selectOption(opts[idx]);
            trigger.focus();
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeField(true);
        } else if (e.key === 'Tab') {
          closeField(false);
        }
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

  // Public: convert native <select> elements into editorial .dropdown-field widgets.
  //
  // Use case: legacy apps with many native <select class="form-select"> that we don't want to
  // rewrite by hand. This walks the matching selects, generates a sibling .dropdown-field markup
  // (button trigger + <ul> with options), and hides the original <select> as a data store.
  // Idempotent — selects already converted are skipped.
  //
  // Each <select> MUST have an `id` (otherwise it's skipped — without id we can't bind the
  // dropdown-field's `data-target-select`).
  //
  // After conversion, initCustomDropdowns() runs once to wire up the new widgets.
  window.convertSelectsToDropdowns = function (selector) {
    var nodes = document.querySelectorAll(selector || 'select.form-select');
    nodes.forEach(function (sel) {
      if (!sel.id) return;
      if (sel.hidden) return; // already converted
      // Skip if a sibling .dropdown-field already targets this select
      if (document.querySelector('.dropdown-field[data-target-select="' + sel.id + '"]')) {
        sel.hidden = true; return;
      }

      var current = sel.options[sel.selectedIndex];
      var currentValue = sel.value;
      var currentLabel = current ? current.textContent.trim() : '';

      var field = document.createElement('div');
      field.className = 'dropdown-field';
      field.setAttribute('data-target-select', sel.id);

      var trigger = document.createElement('button');
      trigger.className = 'dropdown-trigger';
      trigger.type = 'button';
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.innerHTML =
        '<span class="dropdown-label"></span>' +
        '<svg class="dropdown-chevron" viewBox="0 0 11 7" fill="none">' +
          '<path d="M1 1l4.5 4.5L10 1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
        '</svg>';
      trigger.querySelector('.dropdown-label').textContent = currentLabel;

      var menu = document.createElement('ul');
      menu.className = 'dropdown-menu';
      menu.setAttribute('role', 'listbox');

      Array.from(sel.options).forEach(function (opt) {
        var li = document.createElement('li');
        li.className = 'dropdown-option';
        if (opt.value === currentValue) li.classList.add('selected');
        li.setAttribute('data-value', opt.value);
        li.setAttribute('role', 'option');
        li.textContent = opt.textContent;
        menu.appendChild(li);
      });

      field.appendChild(trigger);
      field.appendChild(menu);
      sel.parentNode.insertBefore(field, sel);
      sel.hidden = true;
    });
    initCustomDropdowns();
  };

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
      o.setAttribute('aria-selected', o === opt ? 'true' : 'false');
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

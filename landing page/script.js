/* ==========================================================================
   Loyl Landing — interactions
   Vanilla JS · IntersectionObserver · zero dependencies
   ========================================================================== */
(function () {
  "use strict";

  /* If we got here, script.js booted — cancel the "un-hide everything"
     failsafe that index.html arms in <head>. */
  if (window.__loylFailsafe) {
    clearTimeout(window.__loylFailsafe);
    window.__loylFailsafe = null;
  }

  try {
    init();
  } catch (err) {
    /* Never leave the page invisible because an animation helper failed. */
    document.documentElement.classList.remove("js");
    if (window.console) console.error("[loyl]", err);
  }

  function init() {
    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var $ = function (s, c) { return (c || document).querySelector(s); };
    var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
    var hasIO = "IntersectionObserver" in window;

    /* ---------- 1. Scroll reveal (IO + scroll fallback) ---------- */
    var revealables = $$("[data-reveal]");
    var pending = revealables.slice();

    function show(el) {
      el.classList.add("is-in");
      var i = pending.indexOf(el);
      if (i > -1) pending.splice(i, 1);
    }

    function showAll() {
      pending.slice().forEach(show);
      detachFallback();
    }

    if (reduced || !hasIO) {
      showAll();
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            show(e.target);
            io.unobserve(e.target);
            if (!pending.length) detachFallback();
          }
        });
      }, { rootMargin: "0px 0px -6% 0px", threshold: 0.08 });

      revealables.forEach(function (el) { io.observe(el); });

      /* Safety net: if the observer never fires (headless capture, odd
         engines, restored scroll), a throttled scroll sweep reveals
         anything already above the fold. Removed once nothing is left. */
      var ticking = false;
      function sweep() {
        ticking = false;
        var limit = window.innerHeight * 0.94;
        pending.slice().forEach(function (el) {
          if (el.getBoundingClientRect().top < limit) {
            show(el);
            io.unobserve(el);
          }
        });
        if (!pending.length) detachFallback();
      }
      function onScroll() {
        if (!ticking) { ticking = true; requestAnimationFrame(sweep); }
      }
      function detachFallback() {
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
      }
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll, { passive: true });
      requestAnimationFrame(sweep);

      // Hero blob lives at the top of the document — show it immediately.
      var blob = $(".hero-blob");
      if (blob) requestAnimationFrame(function () { show(blob); io.unobserve(blob); });
    }

    /* ---------- 2. Count-up metrics ---------- */
    var counters = $$("[data-count]");

    function countUp(el) {
      var target = parseFloat(el.getAttribute("data-count")) || 0;
      var suffix = el.getAttribute("data-suffix") || "";
      if (reduced) { el.textContent = target + suffix; return; }

      var dur = 1300;
      var start = null;
      function frame(ts) {
        if (start === null) start = ts;
        var p = Math.min((ts - start) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
        el.textContent = Math.round(target * eased) + suffix;
        if (p < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }

    if (counters.length) {
      if (reduced || !hasIO) {
        counters.forEach(countUp);
      } else {
        var cio = new IntersectionObserver(function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) { countUp(e.target); cio.unobserve(e.target); }
          });
        }, { threshold: 0.5 });
        counters.forEach(function (el) { cio.observe(el); });
      }
    }

    /* ---------- 3. Progress bar fill ---------- */
    var bars = $$(".bar");
    if (bars.length) {
      if (reduced || !hasIO) {
        bars.forEach(function (b) { b.classList.add("is-in"); });
      } else {
        var bio = new IntersectionObserver(function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) { e.target.classList.add("is-in"); bio.unobserve(e.target); }
          });
        }, { threshold: 0.6 });
        bars.forEach(function (b) { bio.observe(b); });
      }
    }

    /* ---------- 4. Sticky nav shadow ---------- */
    var nav = $(".nav");
    var stuckState = false;
    function onScrollNav() {
      var stuck = window.scrollY > 8;
      if (stuck !== stuckState) {
        stuckState = stuck;
        nav.classList.toggle("is-stuck", stuck);
      }
    }

    /* ---------- 5. Hero parallax (desktop only) ---------- */
    var pills = $$(".float-pill");
    var stack = $(".device-stack");
    var canParallax = window.matchMedia("(min-width: 1024px)").matches && !reduced;
       var tickingP = false;

    function parallax() {
      tickingP = false;
      var y = window.scrollY;
      if (y > 900) return;
      var p = y * 0.06;
      pills.forEach(function (el, i) {
        el.style.translate = "0 " + (p * (i + 1) * 0.45).toFixed(2) + "px";
      });
      if (stack) stack.style.translate = "0 " + (-y * 0.035).toFixed(2) + "px";
    }

    function onScroll() {
      onScrollNav();
      if (canParallax && !tickingP) {
        tickingP = true;
        requestAnimationFrame(parallax);
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScrollNav();

    /* ---------- 6. Mobile menu ---------- */
    var burger = $("#burger");
    var menu = $("#mobileMenu");

    function closeMenu() {
      burger.classList.remove("is-open");
      menu.classList.remove("is-open");
      burger.setAttribute("aria-expanded", "false");
    }

    if (burger && menu) {
      burger.addEventListener("click", function () {
        var open = !menu.classList.contains("is-open");
        menu.classList.toggle("is-open", open);
        burger.classList.toggle("is-open", open);
        burger.setAttribute("aria-expanded", String(open));
      });
      $$("a", menu).forEach(function (a) { a.addEventListener("click", closeMenu); });
      window.addEventListener("resize", function () {
        if (window.innerWidth >= 900) closeMenu();
      });
    }

    /* ---------- 7. FAQ accordion ---------- */
    var faqItems = $$(".faq-item");
    faqItems.forEach(function (item) {
      var btn = $(".faq-q", item);
      if (!btn) return;
      btn.addEventListener("click", function () {
        var isOpen = item.classList.contains("is-open");
        faqItems.forEach(function (other) {
          other.classList.remove("is-open");
          var b = $(".faq-q", other);
          if (b) b.setAttribute("aria-expanded", "false");
        });
        if (!isOpen) {
          item.classList.add("is-open");
          btn.setAttribute("aria-expanded", "true");
        }
      });
    });

    /* ---------- 8. Smooth anchor scroll with sticky-nav offset ---------- */
    $$('a[href^="#"]').forEach(function (link) {
      link.addEventListener("click", function (ev) {
        var id = link.getAttribute("href");
        if (!id || id === "#") return;
        var target = document.querySelector(id);
        if (!target) return;
        ev.preventDefault();
        var offset = (nav ? nav.offsetHeight : 0) + 12;
        var top = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top: Math.max(top, 0), behavior: reduced ? "auto" : "smooth" });
        history.replaceState(null, "", id);
      });
    });
  }
})();

/**
 * TrackLight Analytics — embed script
 * Usage: <script src="https://yourserver.com/tracklight.js?id=SITE_ID"></script>
 *
 * Tracks: pageviews, clicks, scroll depth, form starts/completes,
 *         rage clicks, session duration, heatmap data
 */
(function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────────
  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var src = script ? script.src : '';
  var params = {};
  var qs = src.split('?')[1] || '';
  qs.split('&').forEach(function (p) {
    var kv = p.split('=');
    if (kv[0]) params[kv[0]] = decodeURIComponent(kv[1] || '');
  });

  var SITE_ID = params.id || 'demo';
  var API = (src.split('/tracklight.js')[0]) || window.location.origin;
  var COLLECT = API + '/api/collect';
  var HEATMAP_API = API + '/api/heatmap';

  // ── Visitor / Session IDs ─────────────────────────────────────────────────
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function getOrSet(key, fn) {
    try {
      var v = localStorage.getItem(key);
      if (!v) { v = fn(); localStorage.setItem(key, v); }
      return v;
    } catch (e) { return fn(); }
  }

  var visitorId = getOrSet('_tl_vid', uuid);
  var sessionId = (function () {
    try {
      var s = sessionStorage.getItem('_tl_sid');
      if (!s) { s = uuid(); sessionStorage.setItem('_tl_sid', s); }
      return s;
    } catch (e) { return uuid(); }
  })();

  // ── Send ──────────────────────────────────────────────────────────────────
  function send(endpoint, data) {
    var payload = JSON.stringify(data);
    if (navigator.sendBeacon) {
      var blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(endpoint, blob);
    } else {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', endpoint, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(payload);
    }
  }

  function track(type, extra) {
    var data = Object.assign({
      siteId: SITE_ID,
      type: type,
      url: window.location.href,
      referrer: document.referrer,
      sessionId: sessionId,
      visitorId: visitorId,
      duration: Math.round((Date.now() - startTime) / 1000),
      scrollDepth: maxScroll,
      meta: {}
    }, extra || {});
    send(COLLECT, data);
  }

  // ── Scroll depth ──────────────────────────────────────────────────────────
  var maxScroll = 0;
  var startTime = Date.now();

  function onScroll() {
    var doc = document.documentElement;
    var scrolled = doc.scrollTop || document.body.scrollTop;
    var total = doc.scrollHeight - doc.clientHeight;
    if (total > 0) {
      maxScroll = Math.max(maxScroll, Math.round((scrolled / total) * 100));
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  // ── Pageview ──────────────────────────────────────────────────────────────
  track('pageview');

  // ── Page exit / duration ─────────────────────────────────────────────────
  window.addEventListener('beforeunload', function () {
    track('pageleave');
  });

  // ── Heatmap clicks ────────────────────────────────────────────────────────
  var heatmapBuffer = [];
  var heatmapTimer = null;

  document.addEventListener('click', function (e) {
    var rect = document.documentElement.getBoundingClientRect();
    var x = Math.round(((e.clientX - rect.left) / (rect.right - rect.left)) * 100);
    var y = Math.round(((e.clientY + window.scrollY) / document.documentElement.scrollHeight) * 100);

    heatmapBuffer.push({ x: x, y: y, type: 'click' });

    clearTimeout(heatmapTimer);
    heatmapTimer = setTimeout(function () {
      if (!heatmapBuffer.length) return;
      heatmapBuffer.forEach(function (pt) {
        send(HEATMAP_API, {
          siteId: SITE_ID,
          url: window.location.href,
          x: pt.x,
          y: pt.y,
          type: pt.type
        });
      });
      heatmapBuffer = [];
    }, 2000);
  });

  // ── Rage click detection ──────────────────────────────────────────────────
  var clickLog = [];
  document.addEventListener('click', function (e) {
    var now = Date.now();
    clickLog.push({ t: now, x: e.clientX, y: e.clientY });
    clickLog = clickLog.filter(function (c) { return now - c.t < 1000; });
    if (clickLog.length >= 4) {
      var dx = clickLog[clickLog.length - 1].x - clickLog[0].x;
      var dy = clickLog[clickLog.length - 1].y - clickLog[0].y;
      if (Math.sqrt(dx * dx + dy * dy) < 40) {
        track('rage_click', { rageClick: true });
        clickLog = [];
      }
    }
  });

  // ── Form tracking ─────────────────────────────────────────────────────────
  document.addEventListener('focusin', function (e) {
    var el = e.target;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      var form = el.closest('form');
      if (form && !form._tlStarted) {
        form._tlStarted = true;
        track('form_start', { meta: { formId: form.id || form.action || '' } });
      }
    }
  });

  document.addEventListener('submit', function (e) {
    var form = e.target;
    track('form_complete', { meta: { formId: form.id || form.action || '' } });
    track('conversion');
  });

  // ── Outbound link tracking ────────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a');
    if (!a) return;
    var href = a.href || '';
    if (href.startsWith('tel:')) {
      track('phone_click', { meta: { phone: href } });
    } else if (href.startsWith('mailto:')) {
      track('email_click', { meta: { email: href } });
    } else if (href && !href.includes(window.location.hostname)) {
      track('outbound_click', { meta: { url: href } });
    }
  });

  // ── SPA support (pushState navigation) ────────────────────────────────────
  var lastUrl = window.location.href;
  var _pushState = history.pushState;
  history.pushState = function () {
    _pushState.apply(history, arguments);
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      maxScroll = 0;
      startTime = Date.now();
      track('pageview');
    }
  };
  window.addEventListener('popstate', function () {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      track('pageview');
    }
  });

  // ── Expose manual API for custom events ───────────────────────────────────
  window.TrackLight = {
    track: function (eventName, meta) {
      track(eventName, { meta: meta || {} });
    },
    identify: function (userId, traits) {
      track('identify', { meta: { userId: userId, traits: traits || {} } });
    }
  };

})();

/**
 * TrackLight Analytics — embed script
 * Usage: <script src="https://yourserver.com/tracklight.js?id=SITE_ID" async></script>
 *
 * Tracks: pageviews, scroll depth, form starts/completes, rage clicks,
 *         session duration, click heatmap, phone/email/outbound clicks.
 * Privacy: no cookies, no personal data, anonymous visitor ID in localStorage.
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
  (src.split('?')[1] || '').split('&').forEach(function (p) {
    var kv = p.split('=');
    if (kv[0]) params[kv[0]] = decodeURIComponent(kv[1] || '');
  });

  var SITE_ID = params.id || 'demo';
  var API_BASE = src.split('/tracklight.js')[0] || window.location.origin;
  var COLLECT = API_BASE + '/api/collect';
  var HEATMAP_API = API_BASE + '/api/heatmap';

  // Skip tracking on localhost preview (optional override via ?track=1)
  if (params.track !== '1' &&
      (location.hostname === 'localhost' || location.hostname === '127.0.0.1') &&
      !API_BASE.includes('localhost')) {
    return;
  }

  // ── IDs ───────────────────────────────────────────────────────────────────
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function getStored(storage, key, fn) {
    try {
      var v = storage.getItem(key);
      if (!v) { v = fn(); storage.setItem(key, v); }
      return v;
    } catch (e) { return fn(); }
  }

  var visitorId = getStored(localStorage, '_tl_vid', uuid);
  var sessionId = getStored(sessionStorage, '_tl_sid', uuid);

  // ── Send (sendBeacon preferred — survives page unload) ────────────────────
  function send(endpoint, data) {
    try {
      var payload = JSON.stringify(data);
      if (navigator.sendBeacon) {
        var blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(endpoint, blob);
        return;
      }
      var xhr = new XMLHttpRequest();
      xhr.open('POST', endpoint, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(payload);
    } catch (e) {}
  }

  var startTime = Date.now();
  var maxScroll = 0;

  function currentDuration() {
    return Math.round((Date.now() - startTime) / 1000);
  }

  function track(type, extra) {
    var data = {
      siteId: SITE_ID,
      type: type,
      url: window.location.href,
      referrer: document.referrer,
      sessionId: sessionId,
      visitorId: visitorId,
      duration: currentDuration(),
      scrollDepth: maxScroll
    };
    if (extra) {
      for (var k in extra) if (extra.hasOwnProperty(k)) data[k] = extra[k];
    }
    if (!data.meta) data.meta = {};
    send(COLLECT, data);
  }

  // ── Scroll depth ──────────────────────────────────────────────────────────
  function onScroll() {
    var doc = document.documentElement;
    var scrolled = doc.scrollTop || document.body.scrollTop;
    var total = (doc.scrollHeight || 0) - (doc.clientHeight || 0);
    if (total > 0) {
      var pct = Math.min(100, Math.round((scrolled / total) * 100));
      if (pct > maxScroll) maxScroll = pct;
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  // ── Pageview ──────────────────────────────────────────────────────────────
  track('pageview');

  // ── Page exit ─────────────────────────────────────────────────────────────
  function sendExit() {
    track('pageleave');
  }
  window.addEventListener('pagehide', sendExit);
  window.addEventListener('beforeunload', sendExit);

  // Periodic heartbeat so duration is captured even if exit fires late
  setInterval(function () {
    if (!document.hidden) track('heartbeat');
  }, 30000);

  // ── Heatmap clicks (buffered) ─────────────────────────────────────────────
  var heatmapBuffer = [];
  function flushHeatmap() {
    if (!heatmapBuffer.length) return;
    var buf = heatmapBuffer;
    heatmapBuffer = [];
    buf.forEach(function (pt) {
      send(HEATMAP_API, {
        siteId: SITE_ID,
        url: window.location.href,
        x: pt.x, y: pt.y, type: pt.type
      });
    });
  }
  setInterval(flushHeatmap, 3000);
  window.addEventListener('pagehide', flushHeatmap);

  document.addEventListener('click', function (e) {
    var docEl = document.documentElement;
    var rect = docEl.getBoundingClientRect();
    var w = rect.right - rect.left;
    var h = docEl.scrollHeight;
    if (w <= 0 || h <= 0) return;
    var x = Math.round(((e.clientX - rect.left) / w) * 100);
    var y = Math.round(((e.clientY + window.scrollY) / h) * 100);
    if (x < 0 || x > 100 || y < 0 || y > 100) return;
    heatmapBuffer.push({ x: x, y: y, type: 'click' });
  });

  // ── Rage click ────────────────────────────────────────────────────────────
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
    if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT')) return;
    var form = el.closest && el.closest('form');
    if (form && !form._tlStarted) {
      form._tlStarted = true;
      track('form_start', { meta: { formId: form.id || form.name || form.action || '' } });
    }
  });

  document.addEventListener('submit', function (e) {
    var form = e.target;
    track('form_complete', { meta: { formId: form.id || form.name || form.action || '' } });
    track('conversion');
  });

  // ── Link tracking ─────────────────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a');
    if (!a) return;
    var href = a.href || '';
    if (!href) return;
    if (href.indexOf('tel:') === 0) {
      track('phone_click', { meta: { phone: href } });
    } else if (href.indexOf('mailto:') === 0) {
      track('email_click', { meta: { email: href } });
    } else if (href.indexOf('http') === 0 && href.indexOf(window.location.hostname) === -1) {
      track('outbound_click', { meta: { url: href } });
    }
  });

  // ── SPA navigation (pushState) ───────────────────────────────────────────
  var lastUrl = window.location.href;
  function spaCheck() {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      maxScroll = 0;
      startTime = Date.now();
      track('pageview');
    }
  }
  var _push = history.pushState;
  history.pushState = function () { _push.apply(history, arguments); spaCheck(); };
  var _replace = history.replaceState;
  history.replaceState = function () { _replace.apply(history, arguments); spaCheck(); };
  window.addEventListener('popstate', spaCheck);

  // ── Public API ────────────────────────────────────────────────────────────
  window.TrackLight = {
    track: function (eventName, meta) { track(eventName, { meta: meta || {} }); },
    identify: function (userId, traits) { track('identify', { meta: { userId: userId, traits: traits || {} } }); }
  };

})();

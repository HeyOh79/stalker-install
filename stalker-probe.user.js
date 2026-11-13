/* ==UserScript==
// @name         Stalker Probe (диагностика OOM)
// @namespace    local.stalker-assistant
// @version      0.1.261113.1053
// @description  Только самописец памяти: если vk.ru падает и с этим скриптом — проблема не в ассистенте. Журнал: localStorage['stalkerMemLog']
// @match        https://vk.com/*
// @match        https://vk.ru/*
// @run-at       document-start
// @grant        none
// @noframes
// ==UserScript==*/

(function () {
  'use strict';
  if (window.__stalkerMemRecorder) return;
  window.__stalkerMemRecorder = true;
  var MEMLOG_KEY = 'stalkerMemLog';
  var MEMLOG_CAP = 360;
  var SPIKE_WINDOW = 30;
  var SPIKE_MB = 50;
  var SPIKE_THROTTLE_MS = 60000;
  var ERR_THROTTLE_MS = 30000;
  var SAMPLE_MS = 3000;
  var RESOURCE_BUFFER_CAP = 5000;
  var log = loadLog();
  var samples = [];
  var lastSpikeAt = 0;
  var errSeen = {};
  var requestBase = 0;
  var transferBaseMB = 0;
  try { performance.setResourceTimingBufferSize(RESOURCE_BUFFER_CAP); } catch (e) {}

  function push(entry) {
    try {
      log.push(entry);
      if (log.length > MEMLOG_CAP) log.splice(0, log.length - MEMLOG_CAP);
      localStorage.setItem(MEMLOG_KEY, JSON.stringify(log));
    } catch (e) {}
  }

  function recordError(kind, message) {
    try {
      var key = kind + '|' + String(message).slice(0, 120);
      var last = errSeen[key] || 0;
      if (Date.now() - last < ERR_THROTTLE_MS) return;
      errSeen[key] = Date.now();
      push({ t: Date.now(), k: 'err', msg: (kind + ': ' + String(message)).slice(0, 400) });
    } catch (e) {}
  }

  function sample() {
    try {
      var used, total;
      var mem = performance.memory;
      if (mem) {
        used = Math.round(mem.usedJSHeapSize / 1048576);
        total = Math.round(mem.totalJSHeapSize / 1048576);
      }
      var dom = document.getElementsByTagName('*').length;
      var requests = requestBase;
      var transferMB = transferBaseMB;
      try {
        var res = performance.getEntriesByType('resource');
        requests += res.length;
        var buf = 0;
        for (var i = 0; i < res.length; i++) buf += (res[i] && res[i].transferSize) || 0;
        transferMB += Math.round(buf / 1048576);
        if (res.length >= RESOURCE_BUFFER_CAP - 100) {
          requestBase = requests;
          transferBaseMB = transferMB;
          performance.clearResourceTimings();
        }
      } catch (e) {}
      var entry = { t: Date.now(), k: 's', u: used, tot: total, dom: dom, req: requests, xfer: transferMB };
      samples.push(entry);
      if (samples.length > SPIKE_WINDOW) samples.shift();
      push(entry);
      var valid = samples.filter(function (s) { return typeof s.u === 'number'; });
      if (valid.length >= 2) {
        var delta = valid[valid.length - 1].u - valid[0].u;
        if (delta >= SPIKE_MB && Date.now() - lastSpikeAt > SPIKE_THROTTLE_MS) {
          lastSpikeAt = Date.now();
          push({ t: Date.now(), k: 'spike', d: Math.round(delta), u: used, dom: dom, req: requests, xfer: transferMB });
          console.warn('[Stalker Probe] ⚠ память +' + Math.round(delta) + ' МБ за ~90с (куча ' + used + ' МБ, DOM ' + dom + ', запросов ' + requests + ', принято ' + transferMB + ' МБ)');
        }
      }
    } catch (e) {}
  }

  function loadLog() {
    try {
      var raw = localStorage.getItem(MEMLOG_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(function (e) { return e && typeof e.t === 'number'; }) : [];
    } catch (e) { return []; }
  }

  push({ t: Date.now(), k: 'init', msg: 'probe 0.1.261113.1053 @ ' + location.host });
  console.info('[Stalker Probe] v0.1.261113.1053 started');
  window.addEventListener('error', function (e) {
    recordError('error', (e && e.message || '') + ' @' + (e && e.filename || '') + ':' + (e && e.lineno || ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    recordError('rejection', r && r.message ? r.message : String(r));
  });
  window.__stalkerMemNote = function (kind, msg) {
    push({ t: Date.now(), k: 'note', msg: (kind + ' ' + (msg || '')).slice(0, 300) });
  };
  setInterval(sample, SAMPLE_MS);
  sample();
})();


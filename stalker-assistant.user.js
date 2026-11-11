/* ==UserScript==
// @name         Stalker Assistant
// @namespace    local.stalker-assistant
// @version      0.3.261111.1403
// @description  Сбор событий, клавиатур и решений в игре «Сталкер» (VK)
// @match        https://vk.com/*
// @match        https://vk.ru/*
// @run-at       document-start
// @grant        none
// @noframes
// @updateURL    https://raw.githubusercontent.com/HeyOh79/stalker-install/main/stalker-assistant.user.js
// @downloadURL  https://raw.githubusercontent.com/HeyOh79/stalker-install/main/stalker-assistant.user.js
// ==/UserScript==*/
"use strict";
(() => {
  // src/core/guards.ts
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function pick(obj, ...keys) {
    for (const key of keys) {
      const value = obj[key];
      if (value !== void 0 && value !== null) return value;
    }
    return void 0;
  }
  function asNumber(value) {
    if (value === null || value === void 0 || value === "") return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }
  function asString(value) {
    return typeof value === "string" ? value : "";
  }
  function asBoolean(value) {
    return value === true || value === 1 || value === "1";
  }
  function rawPayload(value) {
    if (value === null || value === void 0) return null;
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }

  // src/core/payload.ts
  function base64ToUtf8(input) {
    const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }
  function decodePayload(payload) {
    if (payload === null || payload === void 0 || payload === "") return null;
    if (typeof payload === "object") return payload;
    if (typeof payload !== "string") return payload;
    const value = payload.trim();
    if (value.startsWith("{") || value.startsWith("[")) {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    try {
      const decoded = base64ToUtf8(value);
      try {
        return JSON.parse(decoded);
      } catch {
        return decoded;
      }
    } catch {
      return value;
    }
  }

  // src/core/keyboard.ts
  function normalizeButton(button) {
    if (!isRecord(button)) return null;
    const action = isRecord(button.action) ? button.action : button;
    const payload = rawPayload(pick(action, "payload") ?? pick(button, "payload"));
    const link = pick(action, "link") ?? pick(button, "link");
    return {
      text: asString(pick(action, "label", "text") ?? pick(button, "text")),
      type: asString(pick(action, "type") ?? pick(button, "type")) || "text",
      payloadRaw: payload,
      payload: decodePayload(payload),
      link: typeof link === "string" ? link : null,
      color: typeof button.color === "string" ? button.color : null
    };
  }
  function normalizeKeyboard(input) {
    if (input === null || input === void 0 || input === "") return null;
    let keyboard = input;
    if (typeof input === "string") {
      try {
        keyboard = JSON.parse(input);
      } catch {
        return null;
      }
    }
    if (!isRecord(keyboard) || !Array.isArray(keyboard.buttons)) return null;
    const rows = keyboard.buttons.map((row) => (Array.isArray(row) ? row : [row]).map(normalizeButton).filter((button) => button !== null)).filter((row) => row.length > 0);
    if (rows.length === 0) return null;
    return {
      inline: asBoolean(keyboard.inline),
      oneTime: asBoolean(keyboard.one_time ?? keyboard.oneTime),
      buttons: rows
    };
  }
  var flatButtonsCache = /* @__PURE__ */ new WeakMap();
  function flattenButtons(keyboard) {
    if (!keyboard) return [];
    const cached = flatButtonsCache.get(keyboard);
    if (cached !== void 0) return cached;
    const flat = keyboard.buttons.flat();
    flatButtonsCache.set(keyboard, flat);
    return flat;
  }
  function findButtonByPayload(keyboard, payloadRawValue) {
    const buttons = flattenButtons(keyboard);
    const exact = buttons.find((button) => button.payloadRaw === payloadRawValue);
    if (exact) return exact;
    const decoded = decodePayload(payloadRawValue);
    if (decoded && typeof decoded === "object") {
      const target = JSON.stringify(decoded);
      return buttons.find((button) => button.payload && typeof button.payload === "object" && JSON.stringify(button.payload) === target) ?? null;
    }
    return null;
  }
  function comparableButtonText(value) {
    return value.replace(/^Загружается(?:\.\.\.|…)\s*/u, "").trim().toLowerCase();
  }
  var labelCache = /* @__PURE__ */ new WeakMap();
  function labelsOf(button) {
    const cached = labelCache.get(button);
    if (cached !== void 0) return cached;
    const labels = {
      exact: button.text.trim().toLowerCase(),
      comparable: comparableButtonText(button.text)
    };
    labelCache.set(button, labels);
    return labels;
  }
  function findButtonByTextMatch(keyboard, text) {
    const target = text.trim().toLowerCase();
    if (!target) return null;
    let fallback = null;
    for (const button of flattenButtons(keyboard)) {
      const labels = labelsOf(button);
      if (labels.exact === target) return { button, exact: true };
      if (!fallback && labels.comparable === target) {
        fallback = { button, exact: false };
      }
    }
    return fallback;
  }
  function keyboardFingerprint(keyboard) {
    if (!keyboard) return "";
    return JSON.stringify(keyboard.buttons.map((row) => row.map((button) => comparableButtonText(button.text))));
  }
  function keyboardsEqual(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    return keyboardFingerprint(a) === keyboardFingerprint(b);
  }

  // src/core/traps.ts
  var ALL_COLORS = ["positive", "negative", "primary", "secondary"];
  var COLOR_WORDS = {
    \u0437\u0435\u043B\u0435\u043D: "positive",
    \u043A\u0440\u0430\u0441\u043D: "negative",
    \u0441\u0438\u043D: "primary",
    \u0431\u0435\u043B: "secondary",
    \u0441\u0435\u0440: "secondary"
  };
  var COLOR_TASK_RE = /по\s+цвету|смотри\s+только\s+на\s+цвет|цвет\s+кноп|надписи\s+вр[уа]т|(?:красн|зелен|син|бел|сер)[а-яё]*[ую]\s+кнопк|кнопк[а-яё]*,?\s*которая\s+не/iu;
  var COLOR_WORD_RE = /(зелен|красн|син|бел|сер)/gu;
  var QUOTED_SPAN_RE = /«[^»]*»/gu;
  function parseColorInstruction(text) {
    const normalized = text.toLowerCase().replace(/ё/gu, "\u0435");
    if (!COLOR_TASK_RE.test(normalized)) return null;
    const clean = normalized.replace(QUOTED_SPAN_RE, " ");
    const allowed = /* @__PURE__ */ new Set();
    const excluded = /* @__PURE__ */ new Set();
    for (const clause of clean.split(/[.!?;,]+/u)) {
      for (const match of clause.matchAll(COLOR_WORD_RE)) {
        const color = COLOR_WORDS[match[1] ?? ""];
        if (!color) continue;
        const index = match.index ?? 0;
        const before = clause.slice(0, index);
        const negated = before.lastIndexOf("\u043D\u0435") >= 0;
        if (negated) excluded.add(color);
        else allowed.add(color);
      }
    }
    if (allowed.size === 0 && excluded.size === 0) return null;
    if (allowed.size === 0) {
      return new Set(ALL_COLORS.filter((color) => !excluded.has(color)));
    }
    return new Set([...allowed].filter((color) => !excluded.has(color)));
  }

  // src/core/auto.ts
  var DEFAULT_AUTO_DELAYS = {
    fishing: 1200,
    battle: 2e3,
    // 2.2 с: на 1.2 с ВК успевал выдавать капчу за два поля подряд
    // (лог 07.11 вечера — 2 капчи за две аномалии).
    anomaly: 2200,
    other: 2500,
    explore: 5e3
  };
  var AUTO_DELAY_LABELS = {
    fishing: "\u0420\u044B\u0431\u0430\u043B\u043A\u0430 (\u043D\u0430\u0434\u043F\u0438\u0441\u044C/\u0446\u0432\u0435\u0442/\u0437\u043D\u0430\u0447\u043E\u043A), \u0441\u0435\u043A",
    battle: "\u0411\u043E\u0439: \u0440\u043E\u0442\u0430\u0446\u0438\u044F, \u0441\u0435\u043A",
    anomaly: "\u0410\u043D\u043E\u043C\u0430\u043B\u0438\u044F (\u0431\u043E\u043B\u0442/\u0445\u043E\u0434), \u0441\u0435\u043A",
    other: "\u041F\u0440\u043E\u0447\u0435\u0435 (\u043B\u0435\u0447\u0435\u043D\u0438\u0435 \u0438 \u0434\u0440.), \u0441\u0435\u043A",
    explore: "\u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0435\u043D\u0438\u0435 (\u0438\u0441\u0441\u043B\u0435\u0434\u043E\u0432\u0430\u0442\u044C, \u0437\u0430\u043A\u0438\u043D\u0443\u0442\u044C \u0443\u0434\u043E\u0447\u043A\u0443/\u0435\u0449\u0451), \u0441\u0435\u043A"
  };
  var DELAY_KEYS = ["fishing", "battle", "anomaly", "other", "explore"];
  var AUTO_MIN_INTERVAL_MS = 1e3;
  var AUTO_SAME_BUTTON_COOLDOWN_MS = 4e3;
  function sameButtonCooldownDelay(reason, plannedDelayMs, lastClickAt, now, cooldownMs = AUTO_SAME_BUTTON_COOLDOWN_MS) {
    if (reason === "continue" || lastClickAt === null || lastClickAt === void 0) return plannedDelayMs;
    return Math.max(plannedDelayMs, lastClickAt + cooldownMs - now);
  }
  var MANUAL_TAKEOVER_MS = 3e4;
  var OWN_CLICK_MATCH_WINDOW_MS = 3e3;
  function isManualAction(source, text, lastAutoButton, lastAutoClickAt, now) {
    const cleaned = text.replace(/^Загружается(?:\.\.\.|…)\s*/u, "").trim().toLowerCase();
    if (source === "ws") return true;
    if (!cleaned) return false;
    const recentOwnClick = lastAutoButton !== null && now - lastAutoClickAt <= OWN_CLICK_MATCH_WINDOW_MS;
    if (recentOwnClick && lastAutoButton !== null && lastAutoButton.replace(/^Загружается(?:\.\.\.|…)\s*/u, "").trim().toLowerCase() === cleaned) {
      return false;
    }
    if (recentOwnClick && /^\{[^}]*\}$/u.test(cleaned)) {
      return false;
    }
    return true;
  }
  var AUTO_SAME_CLICK_LIMIT = 3;
  var AUTO_REPEAT_PAUSE_MS = 3e4;
  function nextClickStreak(prev, button) {
    if (prev !== null && prev.button === button) return { button, count: prev.count + 1 };
    return { button, count: 1 };
  }
  function keepEarliestPlanAt(prev, next, delayMs, now) {
    const same = prev.timerActive && prev.plan !== null && prev.plan.detached === next.detached && prev.plan.reason === next.reason && prev.plan.button === next.button;
    if (!same || prev.plan === null) {
      return { at: now + Math.max(0, delayMs), reused: false };
    }
    return { at: Math.min(prev.plan.at, now + Math.max(0, delayMs)), reused: true };
  }
  var CONTINUE_BUTTON_TEXTS = [
    "\u{1F441} \u0438\u0441\u0441\u043B\u0435\u0434\u043E\u0432\u0430\u0442\u044C",
    "\u0438\u0441\u0441\u043B\u0435\u0434\u043E\u0432\u0430\u0442\u044C",
    "\u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C \u0438\u0441\u0441\u043B\u0435\u0434\u043E\u0432\u0430\u043D\u0438\u044F",
    "\u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C \u043F\u043E\u0438\u0441\u043A",
    "\u0437\u0430\u043A\u0438\u043D\u0443\u0442\u044C \u0443\u0434\u043E\u0447\u043A\u0443",
    "\u0437\u0430\u043A\u0438\u043D\u0443\u0442\u044C \u0435\u0449\u0451",
    "\u0442\u044F\u043D\u0443\u0442\u044C"
  ];
  function comparable(value) {
    return value.replace(/^Загружается(?:\.\.\.|…)\s*/u, "").trim().toLowerCase();
  }
  function trimLoadingPrefix(value) {
    return value.replace(/^Загружается(?:\.\.\.|…)\s*/u, "").trim();
  }
  function isContinueButtonText(text) {
    return CONTINUE_BUTTON_TEXTS.includes(comparable(text));
  }
  function isContinueButton(button) {
    return isContinueButtonText(button.text);
  }
  function adviceDelay(kind, delays) {
    if (kind === "label" || kind === "color" || kind === "icon") return delays.fishing;
    if (kind === "battle") return delays.battle;
    if (kind === "anomaly") return delays.anomaly;
    if (kind === "rest") return delays.other;
    return delays.other;
  }
  function nextAutoAction(keyboard, context) {
    if (!keyboard) return null;
    if (context.advice?.hold) return null;
    if (context.manualChoice) {
      const target = comparable(context.manualChoice);
      const button = flattenButtons(keyboard).find((candidate) => comparable(candidate.text) === target);
      if (button) {
        return { button, delayMs: 0, reason: "manual" };
      }
    }
    if (context.advice?.button) {
      const target = comparable(context.advice.button.text);
      const button = flattenButtons(keyboard).find((candidate) => comparable(candidate.text) === target);
      if (button) {
        return {
          button,
          delayMs: adviceDelay(context.advice.kind, context.delays),
          reason: "advice"
        };
      }
    }
    const rule = findForkRule(context.forkRules ?? [], forkSignature(keyboard));
    if (rule?.choice) {
      const target = comparable(rule.choice);
      const flat = flattenButtons(keyboard);
      const button = flat.find((candidate) => comparable(candidate.text) === target) ?? flat.find((candidate) => choiceMatchesButton(rule.choice ?? "", candidate.text));
      if (button) {
        return { button, delayMs: context.delays.other, reason: "rule" };
      }
    }
    const continueButton = flattenButtons(keyboard).find(isContinueButton);
    if (continueButton) {
      return { button: continueButton, delayMs: context.delays.explore, reason: "continue" };
    }
    return null;
  }

  // src/core/forks.ts
  function comparableButtonText2(text) {
    return text.replace(/^Загружается(?:\.\.\.|…)\s*/u, "").trim().toLowerCase();
  }
  var NAVIGATION_BUTTON_TEXTS = /* @__PURE__ */ new Set([
    "\u0443\u0439\u0442\u0438",
    "\u0438\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u044C",
    "\u0447\u0430\u0442 \u0438\u0433\u0440\u043E\u043A\u043E\u0432",
    "\u043E\u0431\u0449\u0438\u0439 \u0447\u0430\u0442",
    "\u0447\u0430\u0442 \u0442\u043E\u0440\u0433\u043E\u0432\u043B\u0438",
    "\u043F\u0440\u043E\u0444\u0438\u043B\u044C",
    "\u0441\u0430\u0434\u043E\u043A",
    "\u043D\u0430\u0437\u0430\u0434",
    "\u0432\u0435\u0440\u043D\u0443\u0442\u044C\u0441\u044F",
    "\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F"
  ]);
  function navigationText(text) {
    return comparableButtonText2(text).replace(/^[\p{S}\p{P}\p{M}\p{C}\s]+/u, "").trim();
  }
  function isNavigationButton(text) {
    const normalized = navigationText(text);
    return normalized.length > 0 && NAVIGATION_BUTTON_TEXTS.has(normalized);
  }
  function isForkKeyboard(keyboard) {
    if (!keyboard) return false;
    const buttons = flattenButtons(keyboard).filter((button) => comparableButtonText2(button.text).length > 0);
    if (buttons.length === 0) return false;
    return buttons.some((button) => !isContinueButton(button) && !isNavigationButton(button.text));
  }
  function isNavigationForkRule(rule) {
    return rule.buttons.length > 0 && rule.buttons.every((text) => isNavigationButton(text));
  }
  function normalizeButtonLabel(text) {
    return comparableButtonText2(text).replace(/^[\p{S}\p{P}\p{M}\p{C}\s]+/u, "").replace(/[\p{S}\p{P}\p{M}\p{C}\s]/gu, "").trim();
  }
  function forkSignature(keyboard) {
    if (!keyboard) return null;
    const texts = [...new Set(flattenButtons(keyboard).filter((button) => !isContinueButton(button)).map((button) => normalizeButtonLabel(button.text)).filter((text) => text.length > 0))];
    if (texts.length === 0) return null;
    return [...texts].sort().join("|");
  }
  function aggressiveSignatureOfButtons(buttons) {
    return [...new Set(buttons.filter((button) => !isContinueButtonText(button)).map((button) => normalizeButtonLabel(button)).filter((text) => text.length > 0))].sort().join("|");
  }
  function mergeDuplicateForkRules(rules) {
    const groups = /* @__PURE__ */ new Map();
    for (const rule of rules) {
      const key = aggressiveSignatureOfButtons(rule.buttons);
      if (!key) continue;
      const list = groups.get(key) ?? [];
      list.push(rule);
      groups.set(key, list);
    }
    const out = [];
    for (const [key, list] of groups) {
      const withChoice = list.filter((rule) => rule.choice !== null).sort((a, b) => b.ts - a.ts)[0] ?? null;
      const newest = [...list].sort((a, b) => b.ts - a.ts)[0];
      if (!newest) continue;
      const representative = withChoice ?? newest;
      out.push({
        signature: key,
        buttons: representative.buttons,
        choice: representative.choice,
        ts: newest.ts,
        count: list.reduce((sum, rule) => sum + rule.count, 0)
      });
    }
    return out.sort((a, b) => b.ts - a.ts);
  }
  function choiceMatchesButton(choice, buttonText) {
    const a = normalizeButtonLabel(choice);
    const b = normalizeButtonLabel(buttonText);
    if (a.length === 0 || b.length === 0) return false;
    if (a.length < 3 || b.length < 3) return a === b;
    return a === b || a.startsWith(b) || b.startsWith(a);
  }
  function findForkRule(rules, signature) {
    if (!signature) return null;
    return rules.find((rule) => rule.signature === signature) ?? null;
  }
  function upsertForkRule(rules, signature, buttons, ts) {
    const existing = rules.find((rule2) => rule2.signature === signature);
    if (existing) {
      const rule2 = { ...existing, buttons, ts, count: existing.count + 1 };
      return {
        rules: rules.map((item) => item.signature === signature ? rule2 : item),
        rule: rule2,
        changed: true
      };
    }
    const rule = { signature, buttons, choice: null, ts, count: 1 };
    return { rules: [...rules, rule], rule, changed: true };
  }
  function applyForkChoice(rules, signature, choice) {
    return rules.map((rule) => rule.signature === signature ? { ...rule, choice } : rule);
  }
  function matchChoiceButton(buttons, decisionText) {
    const target = comparableButtonText2(decisionText);
    if (!target) return null;
    return buttons.find((button) => comparableButtonText2(button) === target) ?? buttons.find((button) => choiceMatchesButton(decisionText, button)) ?? null;
  }
  function removeForkRule(rules, signature) {
    return rules.filter((rule) => rule.signature !== signature);
  }
  function describeFork(rule) {
    return rule.buttons.slice(0, 3).join(" / ") + (rule.buttons.length > 3 ? " / \u2026" : "");
  }
  var INLINE_FRESHNESS_EPSILON_MS = 1e3;
  function isForkResolvedByDecision(inline, decisionText) {
    if (!inline?.keyboard || !decisionText.trim()) return false;
    return findButtonByTextMatch(inline.keyboard, decisionText) !== null;
  }
  function isStaleDomInline(source, cmid, lastBotCmid) {
    return source === "dom" && cmid !== null && cmid < lastBotCmid;
  }
  function pickForkKeyboard(inline, composer, lastBotMessageTs) {
    if (!inline) return composer;
    if (!composer) return inline;
    const eventOpen = lastBotMessageTs <= inline.ts + INLINE_FRESHNESS_EPSILON_MS;
    const inlineNewerThanBackground = inline.ts >= composer.ts;
    if (eventOpen || inlineNewerThanBackground) return inline;
    return composer;
  }

  // src/core/anomaly.ts
  var emptyCell = () => ({ signal: null, scouted: null, total: null, revealed: {}, passes: {} });
  var DELTA = {
    \u0441\u0435\u0432\u0435\u0440: [0, -1],
    \u044E\u0433: [0, 1],
    \u0437\u0430\u043F\u0430\u0434: [-1, 0],
    \u0432\u043E\u0441\u0442\u043E\u043A: [1, 0]
  };
  var OPPOSITE = {
    \u0441\u0435\u0432\u0435\u0440: "\u044E\u0433",
    \u044E\u0433: "\u0441\u0435\u0432\u0435\u0440",
    \u0437\u0430\u043F\u0430\u0434: "\u0432\u043E\u0441\u0442\u043E\u043A",
    \u0432\u043E\u0441\u0442\u043E\u043A: "\u0437\u0430\u043F\u0430\u0434"
  };
  var DIRECTIONS = ["\u0441\u0435\u0432\u0435\u0440", "\u044E\u0433", "\u0437\u0430\u043F\u0430\u0434", "\u0432\u043E\u0441\u0442\u043E\u043A"];
  var cellKey = (x, y) => `${x},${y}`;
  var SIGNAL_RE = /(?:Сила сигнала|Сигнал):\s*(\d+)/u;
  var SIGNAL_SILENCE_RE = /Сигнал:\s*тишина/u;
  var SIGNAL_EMPTY_RE = /Сигнал:\s*пусто/u;
  var TREND_UP_RE = /крепнет\s*\(\+/u;
  var TREND_DOWN_RE = /слабеет\s*\(\s*[−-]/u;
  var SCOUTED_RE = /Разведано направлений:\s*(\d+)\s*\/\s*(\d+)/u;
  var SCOUTED_NEW_RE = /разведано\s+(\d+)\s+из\s+(\d+)/iu;
  var BOLTS_RE = /У вас\s+(\d+)\s+болт/u;
  var NO_BOLTS_RE = /Болтов нет/u;
  var CAME_FROM_RE = /пришли с\s+(Севера|Юга|Запада|Востока)/iu;
  var BOLT_FAIL_RE = /новых проходов нет/u;
  var BOLT_OK_RE = /найден(?:ы)?\s+проход/u;
  var BOUNCE_RE = /выставил вас туда, откуда пришли/u;
  var ARTIFACTS_LEFT_RE = /Осталось в аномалии:\s*(\d+)/u;
  var DEAF_RE = /стрелку водит|Детектор хрипит|аномалия «глухая»/iu;
  var FLAVOR_PASS_RE = /^(Север|Юг|Запад|Восток)\s+—/u;
  var CAME_FROM_MAP = {
    \u0441\u0435\u0432\u0435\u0440\u0430: "\u0441\u0435\u0432\u0435\u0440",
    \u044E\u0433\u0430: "\u044E\u0433",
    \u0437\u0430\u043F\u0430\u0434\u0430: "\u0437\u0430\u043F\u0430\u0434",
    \u0432\u043E\u0441\u0442\u043E\u043A\u0430: "\u0432\u043E\u0441\u0442\u043E\u043A"
  };
  var ANOMALY_MAX_SIGNAL = 100;
  var ARTIFACT_HERE_RE = /Детектор трещит:\s*АРТЕФАКТ прямо здесь/u;
  var ARTIFACT_PICKED_RE = /Подобран\s+(?:обузданный\s+|проклятый\s+)?артефакт/u;
  var ANOMALY_ENTERED_RE = /Перед глазами аномалия/u;
  var ANOMALY_LEFT_RE = /Вы вышли из аномалии|Зона запомнит ваши следы/u;
  var ANOMALY_DEATH_RE = /вы погибли/u;
  var LEAVE_CONFIRM_RE = /Точно уйти\?/u;
  function isLeaveConfirmText(text) {
    return LEAVE_CONFIRM_RE.test(text);
  }
  function isArtifactHereText(text) {
    return ARTIFACT_HERE_RE.test(text);
  }
  function isArtifactPickedText(text) {
    return ARTIFACT_PICKED_RE.test(text);
  }
  function anomalyResetReason(text) {
    if (ANOMALY_ENTERED_RE.test(text)) return "enter";
    if (ARTIFACT_PICKED_RE.test(text)) return "picked";
    if (ANOMALY_DEATH_RE.test(text)) return "left";
    if (ANOMALY_LEFT_RE.test(text)) return "left";
    return null;
  }
  function isAnomalyFieldText(text) {
    return /Сигнал:|Сила сигнала|[Рр]азведано|пришли с\s+(Севера|Юга|Запада|Востока)|на краю аномалии/u.test(text);
  }
  function updateAnomalyState(state, text, cmid = null) {
    if (state !== null && cmid !== null && cmid < state.lastCmid) return state;
    const next = {
      signal: state?.signal ?? null,
      trend: state?.trend ?? null,
      silence: state?.silence ?? false,
      fieldEmpty: state?.fieldEmpty ?? false,
      deaf: state?.deaf ?? false,
      artifactsLeft: state?.artifactsLeft ?? null,
      lastMove: state?.lastMove ?? null,
      cameFrom: state?.cameFrom ?? null,
      bolts: state?.bolts ?? null,
      boltFails: state?.boltFails ?? 0,
      x: state?.x ?? 0,
      y: state?.y ?? 0,
      cells: state?.cells ?? {},
      pendingMove: state?.pendingMove ?? null,
      lastCmid: Math.max(state?.lastCmid ?? 0, cmid ?? 0)
    };
    if (DEAF_RE.test(text)) next.deaf = true;
    next.trend = TREND_UP_RE.test(text) ? "up" : TREND_DOWN_RE.test(text) ? "down" : null;
    if (BOUNCE_RE.test(text)) {
      next.pendingMove = null;
      next.trend = null;
    }
    const came = !BOUNCE_RE.test(text) ? CAME_FROM_RE.exec(text) : null;
    const from = came ? CAME_FROM_MAP[(came[1] ?? "").toLowerCase()] ?? null : null;
    const move = from !== null && next.pendingMove !== null && from === OPPOSITE[next.pendingMove] ? next.pendingMove : null;
    if (move !== null) {
      const fromCell = next.cells[cellKey(next.x, next.y)] ?? emptyCell();
      fromCell.revealed[move] = true;
      fromCell.passes[move] = next.trend === "up" || next.trend === "down" ? next.trend : "unknown";
      const [dx, dy] = DELTA[move];
      next.x += dx;
      next.y += dy;
      next.lastMove = move;
      next.pendingMove = null;
      next.boltFails = 0;
    }
    if (from !== null) next.cameFrom = from;
    const key = cellKey(next.x, next.y);
    const cell = next.cells[key] ?? emptyCell();
    next.cells[key] = cell;
    const signal = SIGNAL_RE.exec(text);
    if (signal) {
      cell.signal = Number(signal[1]);
      next.signal = cell.signal;
      next.silence = false;
    }
    if (SIGNAL_SILENCE_RE.test(text)) next.silence = true;
    if (SIGNAL_EMPTY_RE.test(text)) next.fieldEmpty = true;
    const scouted = SCOUTED_RE.exec(text) ?? SCOUTED_NEW_RE.exec(text);
    if (scouted) {
      cell.scouted = Number(scouted[1]);
      cell.total = Number(scouted[2]);
    }
    const bolts = BOLTS_RE.exec(text);
    if (bolts) next.bolts = Number(bolts[1]);
    if (NO_BOLTS_RE.test(text)) next.bolts = 0;
    if (BOLT_OK_RE.test(text)) next.boltFails = 0;
    if (BOLT_FAIL_RE.test(text)) next.boltFails += 1;
    if (BOLT_OK_RE.test(text)) {
      const m = /найден(?:ы)?\s+проход(?:ы)?\s+на\s+([^.\n]+)/iu.exec(text);
      if (m) {
        for (const direction of DIRECTIONS) {
          if ((m[1] ?? "").includes(direction)) cell.revealed[direction] = true;
        }
      }
    }
    for (const line of text.split("\n")) {
      const flavor = FLAVOR_PASS_RE.exec(line.trim());
      if (flavor) {
        const direction = (flavor[1] ?? "").toLowerCase();
        if (DIRECTIONS.includes(direction)) cell.revealed[direction] = true;
      }
    }
    const left = ARTIFACTS_LEFT_RE.exec(text);
    if (left) next.artifactsLeft = Number(left[1]);
    if (ARTIFACT_PICKED_RE.test(text)) {
      next.signal = null;
      next.trend = null;
      next.silence = false;
      for (const record of Object.values(next.cells)) {
        for (const direction of DIRECTIONS) {
          const outcome = record.passes[direction];
          if (outcome === "up" || outcome === "down") record.passes[direction] = "untried";
        }
      }
    }
    return next;
  }
  function markAnomalyMove(state, direction) {
    return { ...state, pendingMove: direction };
  }
  function directionFromButtonText(text) {
    const normalized = text.replace(/^Загружается(?:\.\.\.|…)\s*/u, "").replace(/^[\p{S}\p{P}\p{M}\p{C}\s]+/u, "").trim().toLowerCase();
    return DIRECTIONS.includes(normalized) ? normalized : null;
  }
  function directionButtons(keyboard) {
    const texts = flattenButtons(keyboard).map((button) => comparableButtonText2(button.text));
    return DIRECTIONS.filter((direction) => texts.some((text) => text.includes(direction)));
  }
  function frontierCells(state) {
    const out = [];
    for (const [key, cell] of Object.entries(state.cells)) {
      const unscouted = cell.scouted !== null && cell.total !== null && cell.scouted < cell.total;
      const untried = DIRECTIONS.some((direction) => cell.revealed[direction] && (cell.passes[direction] ?? "untried") === "untried");
      if (unscouted || untried) {
        const coords = key.split(",");
        const x = Number(coords[0]);
        const y = Number(coords[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y });
      }
    }
    return out;
  }
  function stepToNearestFrontier(state) {
    const start = cellKey(state.x, state.y);
    const targets = frontierCells(state).filter((cell) => cellKey(cell.x, cell.y) !== start);
    if (targets.length === 0) return null;
    const targetKeys = new Set(targets.map((cell) => cellKey(cell.x, cell.y)));
    const visited = /* @__PURE__ */ new Set([start]);
    let queue = [[start, "\u0441\u0435\u0432\u0435\u0440"]];
    while (queue.length > 0) {
      const nextQueue = [];
      for (const [key, firstStep] of queue) {
        const coords = key.split(",");
        const cx = Number(coords[0]);
        const cy = Number(coords[1]);
        const cell = state.cells[key];
        if (!Number.isFinite(cx) || !Number.isFinite(cy) || cell === void 0) continue;
        for (const direction of DIRECTIONS) {
          if (!cell.revealed[direction]) continue;
          const [dx, dy] = DELTA[direction];
          const nKey = cellKey(cx + dx, cy + dy);
          if (visited.has(nKey)) continue;
          const neighbor = state.cells[nKey];
          if (neighbor === void 0) continue;
          const step = key === start ? direction : firstStep;
          if (targetKeys.has(nKey)) return step;
          visited.add(nKey);
          nextQueue.push([nKey, step]);
        }
      }
      queue = nextQueue;
    }
    return null;
  }
  function anomalyNextMove(state, keyboard) {
    const texts = flattenButtons(keyboard).map((button) => comparableButtonText2(button.text));
    const has = (needle) => texts.some((text) => text.includes(needle));
    const canBolt = has("\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u0431\u043E\u043B\u0442");
    const canExit = has("\u0432\u044B\u0439\u0442\u0438 \u0438\u0437 \u0430\u043D\u043E\u043C\u0430\u043B\u0438\u0438");
    if (!canBolt && !canExit) return null;
    if (state?.fieldEmpty) return canExit ? { kind: "exit" } : null;
    if (has("\u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C \u043F\u043E\u0438\u0441\u043A")) return null;
    if (!state?.deaf && (state?.signal ?? 0) >= ANOMALY_MAX_SIGNAL) return null;
    if (has("\u043E\u0431\u044B\u0441\u043A\u0430\u0442\u044C")) return { kind: "search" };
    const directions = directionButtons(keyboard);
    const cell = state !== null ? state.cells[cellKey(state.x, state.y)] ?? emptyCell() : emptyCell();
    if (state !== null && (state.trend === "down" || state.silence)) {
      const back = state.cameFrom;
      if (back !== null && directions.includes(back)) return { kind: "move", direction: back, why: "back" };
    }
    const partial = state === null || cell.scouted === null || cell.total === null || cell.scouted < cell.total;
    const knowBolts = state?.bolts !== null && state?.bolts !== void 0;
    if (canBolt && partial && (state?.boltFails ?? 0) < 2 && (!knowBolts || (state?.bolts ?? 0) > 0)) {
      return { kind: "bolt" };
    }
    const untried = directions.filter((direction) => (cell.passes[direction] ?? "untried") === "untried");
    if (untried.length > 0) {
      const targetVisited = (direction) => {
        if (state === null) return false;
        const [dx, dy] = DELTA[direction];
        return state.cells[cellKey(state.x + dx, state.y + dy)] !== void 0;
      };
      let target = null;
      if (state?.trend === "up" && state.lastMove !== null && untried.includes(state.lastMove)) {
        target = state.lastMove;
      }
      if (target === null) {
        const fresh = untried.filter((direction) => !targetVisited(direction));
        const pool = fresh.length > 0 ? fresh : untried;
        target = pool[0] ?? null;
      }
      if (target !== null) {
        return { kind: "move", direction: target, why: state?.trend === "up" && target === state.lastMove ? "course" : "explore" };
      }
    }
    if (state !== null) {
      const step = stepToNearestFrontier(state);
      if (step !== null && directions.includes(step)) {
        return { kind: "move", direction: step, why: "frontier" };
      }
    }
    const climbing = DIRECTIONS.filter((direction) => directions.includes(direction) && cell.passes[direction] === "up");
    if (climbing.length > 0) {
      const last = state?.lastMove ?? null;
      const target = last !== null && climbing.includes(last) ? last : climbing[0];
      if (target !== void 0) return { kind: "move", direction: target, why: "course" };
    }
    if (directions.length === 0) {
      const anyFrontier = state !== null && frontierCells(state).length > 0;
      return canExit && !anyFrontier ? { kind: "exit" } : null;
    }
    return null;
  }
  var ANOMALY_HP_GUARD_PERCENT = 25;
  var HEALTH_RATIO_RE = /Здоровье:\s*(\d+)\s*\/\s*(\d+)/u;
  function healthPercentFrom(text) {
    const match = HEALTH_RATIO_RE.exec(text);
    if (!match) return null;
    const current = Number(match[1]);
    const max = Number(match[2]);
    if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) return null;
    return Math.round(current / max * 100);
  }
  function restoreAnomalyState(entries) {
    let state = null;
    let lastBoundary = null;
    for (const entry of entries) {
      if (entry.isDecision) {
        const direction = directionFromButtonText(entry.text);
        if (direction !== null && state !== null) state = markAnomalyMove(state, direction);
        continue;
      }
      const boundary = anomalyResetReason(entry.text);
      if (boundary !== null) {
        state = null;
        lastBoundary = boundary;
        continue;
      }
      if (isAnomalyFieldText(entry.text)) {
        state = updateAnomalyState(state, entry.text, entry.cmid ?? null);
      }
    }
    if (state === null || lastBoundary === "picked" || lastBoundary === "left") return null;
    return state;
  }
  var ENTRY_TYPE_RE = /Перед глазами аномалия:\s*([^\n]+)/iu;
  var BONUS_LIMIT_RE = /Доп\. лимит\s*\((\d+)\)/iu;
  function entryAnomalyName(text) {
    const match = ENTRY_TYPE_RE.exec(text);
    const name = match?.[1]?.trim();
    return name ? name : null;
  }
  function bonusLimitFrom(text) {
    const match = BONUS_LIMIT_RE.exec(text);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  }

  // src/core/events.ts
  var DEFAULT_EVENT_RULES = { anomaly: "enter", rift: "ask", helicopter: "wait", caches: "wait" };
  var ANOMALY_EVENT_ACTIONS = ["enter", "skip", "ask"];
  var RIFT_EVENT_ACTIONS = ["activate", "skip", "ask"];
  var HELICOPTER_EVENT_ACTIONS = ["wait", "skip", "ask"];
  var CACHE_EVENT_ACTIONS = ["wait", "skip"];
  function isAnomalyEventAction(value) {
    return ANOMALY_EVENT_ACTIONS.includes(value);
  }
  function isRiftEventAction(value) {
    return RIFT_EVENT_ACTIONS.includes(value);
  }
  function isHelicopterEventAction(value) {
    return HELICOPTER_EVENT_ACTIONS.includes(value);
  }
  function isCacheEventAction(value) {
    return CACHE_EVENT_ACTIONS.includes(value);
  }
  var EVENT_RULE_LABELS = {
    anomaly: {
      title: "\u0410\u043D\u043E\u043C\u0430\u043B\u0438\u044F",
      hint: "\u042D\u043A\u0440\u0430\u043D \xAB\u041E\u0441\u043C\u043E\u0442\u0440\u0435\u0442\u044C \u0430\u043D\u043E\u043C\u0430\u043B\u0438\u044E\xBB: \u0437\u0430\u0445\u043E\u0434\u0438\u0442\u044C \u0437\u0430 \u0430\u0440\u0442\u0435\u0444\u0430\u043A\u0442\u043E\u043C \u0438\u043B\u0438 \u043E\u0431\u0445\u043E\u0434\u0438\u0442\u044C.",
      actions: { enter: "\u0417\u0430\u0445\u043E\u0434\u0438\u0442\u044C", skip: "\u041E\u0431\u0445\u043E\u0434\u0438\u0442\u044C", ask: "\u0421\u043F\u0440\u0430\u0448\u0438\u0432\u0430\u0442\u044C" }
    },
    rift: {
      title: "\u0420\u0430\u0437\u043B\u043E\u043C",
      hint: "\u042D\u043A\u0440\u0430\u043D \xAB\u0410\u043A\u0442\u0438\u0432\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0440\u0430\u0437\u043B\u043E\u043C\xBB: \u043F\u043E\u043F\u044B\u0442\u043A\u0430 \u0434\u043E\u0441\u0442\u0430\u0442\u044C \u0430\u0440\u0442\u0435\u0444\u0430\u043A\u0442 \u0442\u0440\u0430\u0442\u0438\u0442 \u043F\u043E\u0434\u0445\u043E\u0434\u044B \u0434\u0435\u0442\u0435\u043A\u0442\u043E\u0440\u0430.",
      actions: { activate: "\u0410\u043A\u0442\u0438\u0432\u0438\u0440\u043E\u0432\u0430\u0442\u044C", skip: "\u041E\u0431\u0445\u043E\u0434\u0438\u0442\u044C", ask: "\u0421\u043F\u0440\u0430\u0448\u0438\u0432\u0430\u0442\u044C" }
    },
    helicopter: {
      title: "\u0412\u0435\u0440\u0442\u043E\u043B\u0451\u0442",
      hint: "\u041E\u0431\u044B\u0441\u043A \u0432\u0435\u0440\u0442\u043E\u043B\u0451\u0442\u0430 \u0438\u0434\u0451\u0442 \u0441\u0430\u043C (~4:40 \u0437\u0430 \u043F\u043E\u0434\u0445\u043E\u0434): \u0436\u0434\u0430\u0442\u044C \u0434\u043E\u0431\u044B\u0447\u0438 \u0438\u043B\u0438 \u043F\u0440\u0435\u0440\u0432\u0430\u0442\u044C \u0438 \u0438\u0434\u0442\u0438 \u0434\u0430\u043B\u044C\u0448\u0435.",
      actions: { wait: "\u0416\u0434\u0430\u0442\u044C", skip: "\u041E\u0431\u0445\u043E\u0434\u0438\u0442\u044C", ask: "\u0421\u043F\u0440\u0430\u0448\u0438\u0432\u0430\u0442\u044C" }
    },
    caches: {
      title: "\u0421\u0445\u0440\u043E\u043D\u044B",
      hint: "\u041E\u0431\u044B\u0441\u043A \u0441\u0445\u0440\u043E\u043D\u0430 \u0438\u0434\u0451\u0442 \u0441\u0430\u043C (10\u201316 \u043C\u0438\u043D): \u0436\u0434\u0430\u0442\u044C \u0434\u043E\u0431\u044B\u0447\u0438 \u0438\u043B\u0438 \u043F\u0440\u0435\u0440\u0432\u0430\u0442\u044C \u0438 \u0438\u0434\u0442\u0438 \u0434\u0430\u043B\u044C\u0448\u0435.",
      actions: { wait: "\u0416\u0434\u0430\u0442\u044C", skip: "\u041F\u0440\u043E\u043F\u0443\u0441\u043A\u0430\u0442\u044C" }
    }
  };
  var RIFT_TEXT_RE = /(?:Вы обнаружили Разлом|перед вами Разлом)/u;
  var HELICOPTER_TEXT_RE = /военный вертол[её]т/u;
  var HELICOPTER_DURATION_RE = /каждый по\s*(\d+)\s*мин(?:\s*(\d+)\s*с)?/iu;
  var CACHE_TEXT_RE = /Обыск займ[её]т/u;
  var CACHE_DURATION_RE = /Обыск займ[её]т\s*(\d+)\s*мин(?:\s*(\d+)\s*с)?/iu;
  function isRiftText(text) {
    return RIFT_TEXT_RE.test(text);
  }
  function isHelicopterText(text) {
    return HELICOPTER_TEXT_RE.test(text);
  }
  var HELICOPTER_WAIT_SLACK_MS = 9e4;
  function helicopterApproachMs(text) {
    const match = HELICOPTER_DURATION_RE.exec(text);
    if (match === null) return 5 * 6e4 + HELICOPTER_WAIT_SLACK_MS;
    const minutes = Number(match[1] ?? 0);
    const seconds = Number(match[2] ?? 0);
    return (minutes * 60 + seconds) * 1e3 + HELICOPTER_WAIT_SLACK_MS;
  }
  function isCacheSearchText(text) {
    return CACHE_TEXT_RE.test(text) && !isHelicopterText(text);
  }
  var CACHE_WAIT_SLACK_MS = 9e4;
  function cacheSearchMs(text) {
    const match = CACHE_DURATION_RE.exec(text);
    if (match === null) return 15 * 6e4 + CACHE_WAIT_SLACK_MS;
    const minutes = Number(match[1] ?? 0);
    const seconds = Number(match[2] ?? 0);
    return (minutes * 60 + seconds) * 1e3 + CACHE_WAIT_SLACK_MS;
  }

  // src/core/battle.ts
  function normalizeRotationRule(item) {
    if (typeof item === "string") {
      const button = item.trim();
      if (!button) return null;
      return {
        button,
        hpBelow: null,
        groupOnly: false,
        oncePerBattle: false,
        onKill: false,
        notFullHp: false,
        disabled: false
      };
    }
    if (!item || typeof item !== "object") return null;
    const raw = item;
    if (typeof raw.button !== "string" || !raw.button.trim()) return null;
    const hp = typeof raw.hpBelow === "number" && Number.isFinite(raw.hpBelow) ? Math.round(Math.min(100, Math.max(1, raw.hpBelow))) : null;
    return {
      button: raw.button.trim(),
      hpBelow: hp !== null && hp > 0 ? hp : null,
      groupOnly: raw.groupOnly === true,
      oncePerBattle: raw.oncePerBattle === true,
      onKill: raw.onKill === true,
      notFullHp: raw.notFullHp === true,
      disabled: raw.disabled === true
    };
  }
  function migrateBattleRotation(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const item of raw) {
      const rule = normalizeRotationRule(item);
      if (!rule) continue;
      const key = rule.button.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(rule);
    }
    return out;
  }
  var KILL_ESTIMATE_MARGIN = 0.8;
  var TARGET_RE = /🎯\s*Цель:\s*❤\s*([^:\n]+):\s*(\d+)\/(\d+)/u;
  var ENEMY_LINE_RE = /^❤\s*([^:\n]+):\s*(\d+)\/(\d+)/mu;
  var ROSTER_LINE_RE = /^\s*(?:►\s*)?(\d+)\.\s*(.+?)\s*—\s*\[[■□]*\]\s*(\d+)\/(\d+)\s*HP$/gmu;
  var ENEMY_COUNT_RE = /Всего врагов:\s*\((\d+)\)/u;
  var PLAYER_HP_RE = /(?:💊\s*Здоровье|❤\s*HP):\s*(\d+)\/(\d+)/u;
  var ACTIONS_MENU_RE = /Действия в бою/u;
  var EPOS_CHARGES_RE = /Гранатомёт\s*«Эпос»:\s*(?:(\d+)\s*из\s*\d+\s*за\s*бой|через)/u;
  var CONC_VALUE_RE = /Концентрация:\s*(\d+)\s*\/\s*\d+/u;
  var CONC_ARROW_RE = /Концентрация:\s*\d+\s*→\s*(\d+)/u;
  var HIT_RE = /^⚔\s*(?:Крит!\s*)?([^:\n]{2,40}):\s*(\d+)\s*▴\s*урона по\s+/gmu;
  var KILLED_RE = /☠\s*Убиты?:\s*([^\n]+)/u;
  var SLOT_RE = /\((\d+)\)/gu;
  function isBattleFlowText(text) {
    return /Атака врага|Ваша атака|▴ урона по|Промах:|🎯\s*Цель:|Концентрация:\s*\d|☠\s*Убит|повержены|Действия в бою/u.test(text);
  }
  function emptyState() {
    return {
      target: null,
      player: null,
      concentration: null,
      enemies: [],
      enemyCount: null,
      enemiesAlive: null,
      multiEnemy: false,
      usedButtons: [],
      expandTried: false,
      menuButtons: [],
      skillDamage: {},
      lastCmid: 0
    };
  }
  function updateBattleState(state, text, cmid = null) {
    if (state !== null && cmid !== null && cmid < state.lastCmid) return state;
    const next = state ? { ...state, skillDamage: { ...state.skillDamage } } : emptyState();
    if (cmid !== null && cmid > next.lastCmid) next.lastCmid = cmid;
    const target = TARGET_RE.exec(text);
    if (target) {
      next.target = { name: (target[1] ?? "").trim(), hp: Number(target[2]), maxHp: Number(target[3]) };
    } else {
      const enemy = ENEMY_LINE_RE.exec(text);
      if (enemy) {
        next.target = { name: (enemy[1] ?? "").trim(), hp: Number(enemy[2]), maxHp: Number(enemy[3]) };
      }
    }
    const player = PLAYER_HP_RE.exec(text);
    if (player) next.player = { hp: Number(player[1]), maxHp: Number(player[2]) };
    const arrow = CONC_ARROW_RE.exec(text);
    if (arrow) next.concentration = Number(arrow[1]);
    else {
      const conc = CONC_VALUE_RE.exec(text);
      if (conc) next.concentration = Number(conc[1]);
    }
    for (const hit of text.matchAll(HIT_RE)) {
      const skill = comparableButtonText2(hit[1] ?? "");
      const damage = Number(hit[2]);
      if (skill && Number.isFinite(damage)) {
        next.skillDamage[skill] = Math.max(next.skillDamage[skill] ?? 0, damage);
      }
    }
    const killed = KILLED_RE.exec(text);
    if (killed) {
      const names = (killed[1] ?? "").split(",").filter((name) => name.trim().length > 0);
      if (names.length >= 2) next.multiEnemy = true;
      if (names.length > 0 && next.enemiesAlive !== null) {
        next.enemiesAlive = Math.max(0, next.enemiesAlive - names.length);
      }
    }
    for (const line of text.split("\n")) {
      if (!/^[⚔🐾★]/u.test(line)) continue;
      for (const slot of line.matchAll(SLOT_RE)) {
        const index = Number(slot[1]);
        if (Number.isFinite(index) && index >= 2) next.multiEnemy = true;
      }
    }
    const count = ENEMY_COUNT_RE.exec(text);
    if (count) {
      next.enemyCount = Number(count[1]);
      next.enemiesAlive = next.enemyCount;
      if (next.enemyCount >= 2) next.multiEnemy = true;
    }
    const roster = [];
    for (const line of text.matchAll(ROSTER_LINE_RE)) {
      const name = (line[2] ?? "").trim();
      const hp = Number(line[3]);
      const maxHp = Number(line[4]);
      if (name && Number.isFinite(hp) && Number.isFinite(maxHp)) {
        roster.push({ name, hp, maxHp });
      }
    }
    if (roster.length > 0) {
      next.enemies = roster;
      if (roster.length >= 2) next.multiEnemy = true;
    }
    if (ACTIONS_MENU_RE.test(text)) {
      const charges = EPOS_CHARGES_RE.exec(text);
      const onCooldown = charges !== null && charges[1] === void 0;
      const empty = charges !== null && charges[1] !== void 0 && Number(charges[1]) <= 0;
      if ((onCooldown || empty) && !next.usedButtons.includes("\u044D\u043F\u043E\u0441")) {
        next.usedButtons = [...next.usedButtons, "\u044D\u043F\u043E\u0441"];
      }
    }
    return next;
  }
  function usedButtonKey(button) {
    return comparableButtonText2(button).replace(/^[^\p{L}\p{N}]+/u, "");
  }
  function markOutgoingBattleAction(state, text) {
    const action = usedButtonKey(text);
    if (!action || action.length > 40 || action.includes(" ")) return state;
    if (action === "\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F") return { ...state, expandTried: true };
    if (state.usedButtons.includes(action)) return state;
    return { ...state, usedButtons: [...state.usedButtons, action].slice(-30) };
  }
  function markActionsMenuButtons(state, buttons) {
    const known = new Set(state.menuButtons);
    for (const raw of buttons) {
      const button = usedButtonKey(raw);
      if (!button || button === "\u043A \u0431\u043E\u044E" || button === "\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F") continue;
      known.add(button);
    }
    const menuButtons = [...known].slice(-12);
    if (menuButtons.length === state.menuButtons.length && menuButtons.every((button, index) => button === state.menuButtons[index])) {
      return state;
    }
    return { ...state, menuButtons };
  }
  var KNOWN_MENU_BUTTONS = /* @__PURE__ */ new Set(["\u044D\u043F\u043E\u0441", "\u0430\u043F\u0442\u0435\u0447\u043A\u0430"]);
  function isSubmenuButton(button, state) {
    const normalized = usedButtonKey(button);
    if (KNOWN_MENU_BUTTONS.has(normalized)) return true;
    return state?.menuButtons.includes(normalized) ?? false;
  }
  function buttonByText(keyboard, needle) {
    const target = needle.toLowerCase();
    return flattenButtons(keyboard).find((button) => {
      const text = comparableButtonText2(button.text);
      return text === target || text.includes(target);
    }) ?? null;
  }
  function bestShotDamage(state) {
    if (!state) return null;
    const values = Object.values(state.skillDamage);
    if (values.length === 0) return null;
    return Math.max(...values);
  }
  function buttonCanKill(state, button) {
    if (!state?.target) return null;
    const known = state.skillDamage[comparableButtonText2(button)];
    const best = bestShotDamage(state);
    const estimate = known !== void 0 ? known : best !== null ? best * KILL_ESTIMATE_MARGIN : null;
    if (estimate === null) return null;
    return state.target.hp <= estimate;
  }
  function isGroupBattle(state) {
    if (!state) return false;
    const count = state.enemiesAlive ?? state.enemyCount ?? state.enemies.length;
    return count >= 3;
  }
  function describeRotationRule(rule) {
    const parts = [];
    if (rule.hpBelow !== null) parts.push(`HP \u2264 ${rule.hpBelow}%`);
    if (rule.groupOnly) parts.push("\u0433\u0440\u0443\u043F\u043F\u0430 \u0432\u0440\u0430\u0433\u043E\u0432");
    if (rule.oncePerBattle) parts.push("1 \u0440\u0430\u0437 \u0437\u0430 \u0431\u043E\u0439");
    if (rule.onKill) parts.push("\u0435\u0441\u043B\u0438 \u0434\u043E\u0431\u0438\u0432\u0430\u044E");
    if (rule.notFullHp) parts.push("\u043D\u0435\u043F\u043E\u043B\u043D\u043E\u0435 \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u0435");
    return parts.join(", ");
  }
  function playerHpPctOf(state) {
    if (!state?.player || state.player.maxHp <= 0) return null;
    return Math.round(100 * state.player.hp / state.player.maxHp);
  }
  function rotationRuleMatches(rule, state) {
    if (rule.disabled) return false;
    if (rule.oncePerBattle && state !== null && state.usedButtons.includes(usedButtonKey(rule.button))) return false;
    if (rule.groupOnly && !isGroupBattle(state)) return false;
    if (rule.hpBelow !== null) {
      const hpPct = playerHpPctOf(state);
      if (hpPct === null || hpPct > rule.hpBelow) return false;
    }
    if (rule.onKill && buttonCanKill(state, rule.button) !== true) return false;
    if (rule.notFullHp) {
      const hpPct = playerHpPctOf(state);
      if (hpPct === null || hpPct >= 100) return false;
    }
    return true;
  }
  function eligibleRotationRules(keyboard, state, rules) {
    const normalized = migrateBattleRotation(rules);
    const out = [];
    for (let index = 0; index < normalized.length; index += 1) {
      const rule = normalized[index];
      if (!rule) continue;
      if (!rotationRuleMatches(rule, state)) continue;
      out.push({ rule, button: buttonByText(keyboard, rule.button), step: index + 1, total: normalized.length });
    }
    return out;
  }
  function isActionsMenuKeyboard(keyboard) {
    return buttonByText(keyboard, "\u041A \u0431\u043E\u044E") !== null;
  }
  function rotationButtonsForState(rules, state) {
    return migrateBattleRotation(rules).filter((rule) => rotationRuleMatches(rule, state)).map((rule) => rule.button);
  }

  // src/core/advice.ts
  var FISHING_TASK_TTL_MS = 2e4;
  function isExpiredFishingAdvice(advice, now = Date.now()) {
    return (advice.kind === "label" || advice.kind === "color" || advice.kind === "icon") && now - advice.ts > FISHING_TASK_TTL_MS;
  }
  function isUnparsedColorTask(text) {
    return COLOR_TASK_RE2.test(text) && parseColorInstruction(text) === null;
  }
  var LABEL_TASK_RE = /Задание[^\n«]*?кнопку\s*«([^»]+)»/u;
  var COLOR_TASK_RE2 = /Задание[^\n]*(?:по\s+цвету|красн|зелён|син|бел|жёлт|сер|фиолет|оранж)/ui;
  var ICON_TASK_RE = /Задание[^\n]*?значком\s+([^\s\p{L}\p{N},.]+)/u;
  var BATTLE_TEXT_RE = /Атака врага|Ваша атака/u;
  var HEAL_WINDOW = 200;
  var HEAL_LOW_THRESHOLD = 30;
  var IGNORED_BUTTON_TEXTS = /* @__PURE__ */ new Set(["\u043E\u0442\u043F\u0443\u0441\u0442\u0438\u0442\u044C", "\u0443\u0439\u0442\u0438", "\u0438\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u044C"]);
  var NOT_IN_ROTATION = /* @__PURE__ */ new Set([...IGNORED_BUTTON_TEXTS, "\u2795 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F", "\u0441\u043C\u0435\u043D\u0438\u0442\u044C \u0446\u0435\u043B\u044C"]);
  function comparableText(button) {
    return button.text.replace(/^Загружается(?:\.\.\.|…)\s*/u, "").trim().toLowerCase();
  }
  function isTaskCandidate(button) {
    return !IGNORED_BUTTON_TEXTS.has(comparableText(button)) && !isNavigationButton(button.text);
  }
  function findLabelButton(keyboard, label) {
    const target = label.trim().toLowerCase();
    if (!target) return null;
    const buttons = flattenButtons(keyboard).filter((button) => comparableText(button).length > 0);
    const exact = buttons.find((button) => comparableText(button) === target);
    if (exact) return exact;
    const partial = buttons.filter((button) => comparableText(button).includes(target));
    if (partial.length === 0) return null;
    return partial[Math.floor(Math.random() * partial.length)] ?? null;
  }
  function findColorButton(keyboard, fullText) {
    const allowed = parseColorInstruction(fullText);
    if (!allowed || allowed.size === 0) return null;
    return flattenButtons(keyboard).find((button) => button.color !== null && allowed.has(button.color) && isTaskCandidate(button)) ?? null;
  }
  function firstIconCodePoint(text) {
    const cleaned = text.replace(/^Загружается(?:\.\.\.|…)\s*/u, "").trim();
    const first = [...cleaned][0];
    if (!first) return null;
    const code = first.codePointAt(0);
    return code !== void 0 ? code : null;
  }
  function findIconButton(keyboard, icon) {
    const target = firstIconCodePoint(icon);
    if (target === null) return null;
    return flattenButtons(keyboard).find((button) => {
      if (!isTaskCandidate(button)) return false;
      return firstIconCodePoint(button.text) === target;
    }) ?? null;
  }
  function findHealButton(keyboard) {
    return flattenButtons(keyboard).find((button) => /^➕?\s*Лечени/iu.test(button.text)) ?? null;
  }
  function anomalyAdvice(keyboard, text, ts, state, events, exitWish, typeRules, bonusLimit) {
    const buttons = flattenButtons(keyboard);
    const byText = (needle) => buttons.find((button) => comparableText(button).includes(needle)) ?? null;
    const leave = byText("\u043F\u043E\u043A\u0438\u043D\u0443\u0442\u044C");
    if (leave !== null && isLeaveConfirmText(text)) {
      return {
        kind: "anomaly",
        title: `\u041D\u0430\u0436\u043C\u0438 \xAB${leave.text.trim()}\xBB`,
        note: "\u0410\u043D\u043E\u043C\u0430\u043B\u0438\u044F \u043F\u0440\u043E\u0439\u0434\u0435\u043D\u0430 \u2014 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0430\u0435\u043C \u0432\u044B\u0445\u043E\u0434.",
        button: leave,
        ts
      };
    }
    if (exitWish) {
      const exitButton = byText("\u0432\u044B\u0439\u0442\u0438 \u0438\u0437 \u0430\u043D\u043E\u043C\u0430\u043B\u0438\u0438");
      if (exitButton !== null) {
        return {
          kind: "anomaly",
          title: `\u041D\u0430\u0436\u043C\u0438 \xAB${exitButton.text.trim()}\xBB`,
          note: "\u041C\u0430\u043B\u043E \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u044F \u2014 \u0432\u044B\u0445\u043E\u0434\u0438\u043C \u0438\u0437 \u0430\u043D\u043E\u043C\u0430\u043B\u0438\u0438.",
          button: exitButton,
          ts
        };
      }
      return {
        kind: "anomaly",
        title: "\u0410\u043D\u043E\u043C\u0430\u043B\u0438\u044F: \u0432\u044B\u0445\u043E\u0434\u0438\u043C",
        note: "\u0416\u0434\u0451\u043C \u043A\u043D\u043E\u043F\u043A\u0443 \xAB\u0412\u044B\u0439\u0442\u0438 \u0438\u0437 \u0430\u043D\u043E\u043C\u0430\u043B\u0438\u0438\xBB \u2014 \u0431\u043E\u043B\u0442\u044B \u0438 \u0445\u043E\u0434\u044B \u043D\u0435 \u043D\u0443\u0436\u043D\u044B.",
        button: null,
        hold: true,
        ts
      };
    }
    const artifact = byText("\u043F\u043E\u0434\u043E\u0431\u0440\u0430\u0442\u044C \u0430\u0440\u0442\u0435\u0444\u0430\u043A\u0442");
    if (artifact !== null) {
      return {
        kind: "anomaly",
        title: `\u041D\u0430\u0436\u043C\u0438 \xAB${artifact.text.trim()}\xBB`,
        note: "\u041F\u043E\u043B\u0435 \u0430\u043D\u043E\u043C\u0430\u043B\u0438\u0438: \u0430\u0440\u0442\u0435\u0444\u0430\u043A\u0442 \u0432 \u044D\u0442\u043E\u0439 \u043A\u043E\u043C\u043D\u0430\u0442\u0435 \u2014 \u0437\u0430\u0431\u0438\u0440\u0430\u0435\u043C.",
        button: artifact,
        ts
      };
    }
    if (isArtifactPickedText(text)) {
      const continueButton = flattenButtons(keyboard).find((button) => isContinueButton(button)) ?? null;
      if (continueButton !== null) {
        return {
          kind: "anomaly",
          title: `\u041D\u0430\u0436\u043C\u0438 \xAB${continueButton.text.trim()}\xBB`,
          note: "\u0410\u0440\u0442\u0435\u0444\u0430\u043A\u0442 \u043F\u043E\u043B\u0443\u0447\u0435\u043D \u2014 \u0432 \u043F\u043E\u043B\u0435 \u043C\u043E\u0436\u0435\u0442 \u0431\u044B\u0442\u044C \u0435\u0449\u0451: \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0430\u0435\u043C \u043E\u0445\u043E\u0442\u0443 \u043F\u043E \u0441\u0438\u0433\u043D\u0430\u043B\u0443.",
          button: continueButton,
          ts
        };
      }
    }
    const canBolt = byText("\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u0431\u043E\u043B\u0442") !== null;
    const canExit = byText("\u0432\u044B\u0439\u0442\u0438 \u0438\u0437 \u0430\u043D\u043E\u043C\u0430\u043B\u0438\u0438") !== null;
    const inField = canBolt || canExit;
    const artifactHere = isArtifactHereText(text) || !state?.deaf && inField && (state?.signal ?? 0) >= ANOMALY_MAX_SIGNAL;
    if (artifactHere) {
      return {
        kind: "anomaly",
        title: "\u0410\u043D\u043E\u043C\u0430\u043B\u0438\u044F: \u0430\u0440\u0442\u0435\u0444\u0430\u043A\u0442 \u0437\u0434\u0435\u0441\u044C",
        note: "\u0410\u0440\u0442\u0435\u0444\u0430\u043A\u0442 \u0432 \u044D\u0442\u043E\u0439 \u043A\u043E\u043C\u043D\u0430\u0442\u0435 \u2014 \u0436\u0434\u0451\u043C \u043A\u043D\u043E\u043F\u043A\u0443 \xAB\u041F\u043E\u0434\u043E\u0431\u0440\u0430\u0442\u044C \u0430\u0440\u0442\u0435\u0444\u0430\u043A\u0442\xBB. \u0411\u043E\u043B\u0442\u044B \u0438 \u0440\u0430\u0437\u0432\u0435\u0434\u043A\u0430 \u043D\u0435 \u043D\u0443\u0436\u043D\u044B.",
        button: null,
        ts
      };
    }
    if (inField && (state?.fieldEmpty === true || state?.signal === 0)) {
      const exitButton = byText("\u0432\u044B\u0439\u0442\u0438 \u0438\u0437 \u0430\u043D\u043E\u043C\u0430\u043B\u0438\u0438");
      if (exitButton !== null) {
        return {
          kind: "anomaly",
          title: `\u041D\u0430\u0436\u043C\u0438 \xAB${exitButton.text.trim()}\xBB`,
          note: "\u0421\u0438\u0433\u043D\u0430\u043B \u043F\u043E\u0433\u0430\u0441 \u2014 \u0430\u0440\u0442\u0435\u0444\u0430\u043A\u0442\u043E\u0432 \u0432 \u043F\u043E\u043B\u0435 \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435\u0442, \u0432\u044B\u0445\u043E\u0434\u0438\u043C.",
          button: exitButton,
          ts
        };
      }
      return {
        kind: "anomaly",
        title: "\u0410\u043D\u043E\u043C\u0430\u043B\u0438\u044F: \u0441\u0438\u0433\u043D\u0430\u043B \u043F\u043E\u0433\u0430\u0441",
        note: "\u0421\u0438\u0433\u043D\u0430\u043B\u0430 \u043D\u0435\u0442 \u2014 \u0436\u0434\u0451\u043C \u043A\u043D\u043E\u043F\u043A\u0443 \xAB\u0412\u044B\u0439\u0442\u0438 \u0438\u0437 \u0430\u043D\u043E\u043C\u0430\u043B\u0438\u0438\xBB, \u0431\u043E\u043B\u0442\u044B \u0438 \u0445\u043E\u0434\u044B \u043D\u0435 \u043D\u0443\u0436\u043D\u044B.",
        button: null,
        hold: true,
        ts
      };
    }
    const enter = byText("\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u0442\u044C \u0430\u043D\u043E\u043C\u0430\u043B\u0438\u044E");
    if (enter !== null) {
      const typeName = entryAnomalyName(text);
      const typeAction = typeName !== null ? typeRules?.[typeName] : void 0;
      const away = byText("\u0443\u0439\u0442\u0438");
      if (bonusLimit === 0) {
        if (away === null) return null;
        return {
          kind: "anomaly",
          title: `\u041D\u0430\u0436\u043C\u0438 \xAB${away.text.trim()}\xBB`,
          note: `\xAB${typeName ?? "\u0430\u043D\u043E\u043C\u0430\u043B\u0438\u044F"}\xBB: \u0414\u043E\u043F. \u043B\u0438\u043C\u0438\u0442 (0) \u2014 \u0446\u0435\u043D\u043D\u043E\u0433\u043E \u0430\u0440\u0442\u0435\u0444\u0430\u043A\u0442\u0430 \u0432 \u044D\u0442\u043E\u043C \u043F\u043E\u043B\u0435 \u043D\u0435\u0442, \u043E\u0431\u0445\u043E\u0434\u0438\u043C.`,
          button: away,
          ts
        };
      }
      if (typeAction === "skip") {
        if (away === null) return null;
        return {
          kind: "anomaly",
          title: `\u041D\u0430\u0436\u043C\u0438 \xAB${away.text.trim()}\xBB`,
          note: `\xAB${typeName}\xBB: \u043E\u0431\u0445\u043E\u0434\u0438\u043C \u043F\u043E \u0441\u043F\u0438\u0441\u043A\u0443 \u0430\u043D\u043E\u043C\u0430\u043B\u0438\u0439.`,
          button: away,
          ts
        };
      }
      if (typeAction === "enter") {
        return {
          kind: "anomaly",
          title: `\u041D\u0430\u0436\u043C\u0438 \xAB${enter.text.trim()}\xBB`,
          note: `\xAB${typeName}\xBB: \u0437\u0430\u0445\u043E\u0434\u0438\u043C \u043F\u043E \u0441\u043F\u0438\u0441\u043A\u0443 \u0430\u043D\u043E\u043C\u0430\u043B\u0438\u0439.`,
          button: enter,
          ts
        };
      }
      const action = events?.anomaly ?? "enter";
      if (action === "skip") {
        if (away === null) return null;
        return {
          kind: "anomaly",
          title: `\u041D\u0430\u0436\u043C\u0438 \xAB${away.text.trim()}\xBB`,
          note: "\u0410\u043D\u043E\u043C\u0430\u043B\u0438\u044F: \u043E\u0431\u0445\u043E\u0434\u0438\u043C \u043F\u043E \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0435 \u0441\u043E\u0431\u044B\u0442\u0438\u044F.",
          button: away,
          ts
        };
      }
      if (action === "ask") {
        return {
          kind: "anomaly",
          title: "\u0410\u043D\u043E\u043C\u0430\u043B\u0438\u044F: \u0442\u0432\u043E\u0451 \u0440\u0435\u0448\u0435\u043D\u0438\u0435",
          note: "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430 \u0441\u043E\u0431\u044B\u0442\u0438\u044F \xAB\u0421\u043F\u0440\u0430\u0448\u0438\u0432\u0430\u0442\u044C\xBB: \u0430\u0432\u0442\u043E \u043D\u0435 \u0436\u043C\u0451\u0442 \u2014 \u0437\u0430\u0445\u043E\u0434\u0438 \u0438\u043B\u0438 \u0443\u0445\u043E\u0434\u0438 \u0441\u0430\u043C.",
          button: null,
          hold: true,
          ts
        };
      }
      return {
        kind: "anomaly",
        title: `\u041D\u0430\u0436\u043C\u0438 \xAB${enter.text.trim()}\xBB`,
        note: "\u0417\u0430\u0445\u043E\u0434\u0438\u043C \u0432 \u0430\u043D\u043E\u043C\u0430\u043B\u0438\u044E: \u0446\u0435\u043B\u044C \u0441\u043E\u0431\u044B\u0442\u0438\u044F \u2014 \u0430\u0440\u0442\u0435\u0444\u0430\u043A\u0442.",
        button: enter,
        ts
      };
    }
    const circleStep = byText("\u0448\u0430\u0433\u043D\u0443\u0442\u044C \u0432 \u043A\u0440\u0443\u0433");
    if (circleStep !== null) {
      const bypass = byText("\u043E\u0431\u043E\u0439\u0442\u0438");
      if (bypass !== null) {
        return {
          kind: "anomaly",
          title: `\u041D\u0430\u0436\u043C\u0438 \xAB${bypass.text.trim()}\xBB`,
          note: "\u0410\u043D\u043E\u043C\u0430\u043B\u0438\u044F: \xAB\u041E\u0431\u043E\u0439\u0442\u0438\xBB \u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u0435\u0435 \u2014 \u0441\u0440\u0435\u0437\u043A\u0430 \u0447\u0435\u0440\u0435\u0437 \u043A\u0440\u0443\u0433 \u0431\u044C\u0451\u0442.",
          button: bypass,
          ts
        };
      }
    }
    if (!canExit) {
      const knockDown = byText("\u0441\u0431\u0438\u0442\u044C \u0431\u043E\u043B\u0442\u043E\u043C");
      if (knockDown === null) return null;
      return {
        kind: "anomaly",
        title: `\u041D\u0430\u0436\u043C\u0438 \xAB${knockDown.text.trim()}\xBB`,
        note: "\u0421\u0431\u0438\u0442\u044C \u0431\u043E\u043B\u0442\u043E\u043C \u2014 \u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u044B\u0439 \u0432\u0430\u0440\u0438\u0430\u043D\u0442 \u044D\u0442\u043E\u0439 \u0440\u0430\u0437\u0432\u0438\u043B\u043A\u0438.",
        button: knockDown,
        ts
      };
    }
    if (!inField) return null;
    const move = anomalyNextMove(state, keyboard);
    if (move === null) return null;
    if (move.kind === "search") {
      const search = byText("\u043E\u0431\u044B\u0441\u043A\u0430\u0442\u044C");
      if (search === null) return null;
      return {
        kind: "anomaly",
        title: `\u041D\u0430\u0436\u043C\u0438 \xAB${search.text.trim()}\xBB`,
        note: "\u041F\u043E\u043B\u0435 \u0430\u043D\u043E\u043C\u0430\u043B\u0438\u0438: \u043E\u0431\u044B\u0441\u043A \u2014 \u0431\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u044B\u0435 \u0431\u043E\u043B\u0442\u044B \u0438 \u043D\u0430\u0439\u0434\u0435\u043D\u043D\u043E\u0435.",
        button: search,
        ts
      };
    }
    if (move.kind === "bolt") {
      const bolt = byText("\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u0431\u043E\u043B\u0442");
      if (bolt === null) return null;
      return {
        kind: "anomaly",
        title: `\u041D\u0430\u0436\u043C\u0438 \xAB${bolt.text.trim()}\xBB`,
        note: "\u041F\u043E\u043B\u0435 \u0430\u043D\u043E\u043C\u0430\u043B\u0438\u0438: \u043E\u0434\u0438\u043D \u0431\u043E\u043B\u0442 \u043E\u0442\u043A\u0440\u044B\u0432\u0430\u0435\u0442 \u0432\u0441\u0435 \u043D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F \u043A\u043B\u0435\u0442\u043A\u0438.",
        button: bolt,
        ts
      };
    }
    if (move.kind === "exit") {
      const exitButton = byText("\u0432\u044B\u0439\u0442\u0438 \u0438\u0437 \u0430\u043D\u043E\u043C\u0430\u043B\u0438\u0438");
      if (exitButton === null) return null;
      return {
        kind: "anomaly",
        title: `\u041D\u0430\u0436\u043C\u0438 \xAB${exitButton.text.trim()}\xBB`,
        note: state?.fieldEmpty ? "\u0410\u0440\u0442\u0435\u0444\u0430\u043A\u0442\u043E\u0432 \u0432 \u043F\u043E\u043B\u0435 \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435\u0442 \u2014 \u0432\u044B\u0445\u043E\u0434\u0438\u043C." : "\u041F\u043E\u043B\u0435 \u0430\u043D\u043E\u043C\u0430\u043B\u0438\u0438: \u0438\u0434\u0442\u0438 \u043D\u0435\u043A\u0443\u0434\u0430 \u2014 \u0432\u044B\u0445\u043E\u0434\u0438\u043C.",
        button: exitButton,
        ts
      };
    }
    const target = buttons.find((button) => comparableText(button).includes(move.direction)) ?? null;
    if (target === null) return null;
    const whyNote = move.why === "back" ? state?.silence ? "\u0434\u0435\u0442\u0435\u043A\u0442\u043E\u0440 \u043C\u043E\u043B\u0447\u0438\u0442 \u2014 \u0432\u0435\u0442\u043A\u0430 \u043D\u0435 \u0442\u0430, \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u043C\u0441\u044F" : "\u0441\u0438\u0433\u043D\u0430\u043B \u0441\u043B\u0430\u0431\u0435\u0435\u0442 \u2014 \u0432\u0435\u0442\u043A\u0430 \u043C\u0435\u0440\u0442\u0432\u0430, \u043E\u0442\u0441\u0442\u0443\u043F\u0430\u0435\u043C" : move.why === "frontier" ? "\u0437\u0434\u0435\u0441\u044C \u0432\u0441\u0451 \u043F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043E \u2014 \u0438\u0434\u0451\u043C \u043A \u0431\u043B\u0438\u0436\u0430\u0439\u0448\u0435\u0439 \u043A\u043B\u0435\u0442\u043A\u0435 \u0441 \u043D\u0435\u0438\u0437\u0432\u0435\u0434\u0430\u043D\u043D\u044B\u043C\u0438 \u043F\u0440\u043E\u0445\u043E\u0434\u0430\u043C\u0438" : move.why === "course" ? state?.trend === "up" ? "\u0441\u0438\u0433\u043D\u0430\u043B \u043A\u0440\u0435\u043F\u043D\u0435\u0442 \u2014 \u0434\u0435\u0440\u0436\u0438\u043C \u043A\u0443\u0440\u0441" : "\u0441\u0438\u0433\u043D\u0430\u043B \u0440\u0430\u0441\u0442\u0451\u0442 \u2014 \u0434\u0435\u0440\u0436\u0438\u043C \u043A\u0443\u0440\u0441" : "\u043F\u0440\u043E\u0432\u0435\u0440\u044F\u0435\u043C \u043D\u043E\u0432\u044B\u0439 \u043C\u0430\u0440\u0448\u0440\u0443\u0442";
    return {
      kind: "anomaly",
      title: `\u041D\u0430\u0436\u043C\u0438 \xAB${target.text.trim()}\xBB`,
      note: `\u041F\u043E\u043B\u0435 \u0430\u043D\u043E\u043C\u0430\u043B\u0438\u0438: ${whyNote} (${move.direction}).`,
      button: target,
      ts
    };
  }
  function riftAdvice(keyboard, text, ts, events) {
    const buttons = flattenButtons(keyboard);
    const byText = (needle) => buttons.find((button) => comparableText(button).includes(needle)) ?? null;
    const activate = byText("\u0430\u043A\u0442\u0438\u0432\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0440\u0430\u0437\u043B\u043E\u043C");
    if (activate === null && !isRiftText(text)) return null;
    const action = events?.rift ?? "ask";
    if (action === "ask") {
      return {
        kind: "rift",
        title: "\u0420\u0430\u0437\u043B\u043E\u043C: \u0442\u0432\u043E\u0451 \u0440\u0435\u0448\u0435\u043D\u0438\u0435",
        note: "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430 \u0441\u043E\u0431\u044B\u0442\u0438\u044F \xAB\u0421\u043F\u0440\u0430\u0448\u0438\u0432\u0430\u0442\u044C\xBB: \u0430\u0432\u0442\u043E \u043D\u0435 \u0436\u043C\u0451\u0442 \u2014 \u0430\u043A\u0442\u0438\u0432\u0438\u0440\u0443\u0439 \u0438\u043B\u0438 \u0443\u0439\u0434\u0438 \u0441\u0430\u043C.",
        button: null,
        hold: true,
        ts
      };
    }
    if (action === "activate") {
      if (activate === null) return null;
      return {
        kind: "rift",
        title: `\u041D\u0430\u0436\u043C\u0438 \xAB${activate.text.trim()}\xBB`,
        note: "\u0420\u0430\u0437\u043B\u043E\u043C: \u0430\u043A\u0442\u0438\u0432\u0438\u0440\u0443\u0435\u043C \u043F\u043E \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0435 \u0441\u043E\u0431\u044B\u0442\u0438\u044F.",
        button: activate,
        ts
      };
    }
    const away = byText("\u0443\u0439\u0442\u0438");
    if (away === null) return null;
    return {
      kind: "rift",
      title: `\u041D\u0430\u0436\u043C\u0438 \xAB${away.text.trim()}\xBB`,
      note: "\u0420\u0430\u0437\u043B\u043E\u043C: \u043E\u0431\u0445\u043E\u0434\u0438\u043C \u043F\u043E \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0435 \u0441\u043E\u0431\u044B\u0442\u0438\u044F.",
      button: away,
      ts
    };
  }
  function helicopterAdvice(keyboard, text, ts, events, active) {
    const action = events?.helicopter ?? "wait";
    if (action === "ask") return null;
    const searching = flattenButtons(keyboard).some((button) => comparableText(button).includes("\u043F\u0440\u0435\u0440\u0432\u0430\u0442\u044C"));
    if (!isHelicopterText(text) && !(active && searching)) return null;
    if (action === "skip") {
      const interrupt = flattenButtons(keyboard).find((button) => comparableText(button).includes("\u043F\u0440\u0435\u0440\u0432\u0430\u0442\u044C")) ?? null;
      if (interrupt === null) return null;
      return {
        kind: "helicopter",
        title: `\u041D\u0430\u0436\u043C\u0438 \xAB${interrupt.text.trim()}\xBB`,
        note: "\u0412\u0435\u0440\u0442\u043E\u043B\u0451\u0442: \u043E\u0431\u0445\u043E\u0434\u0438\u043C \u043F\u043E \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0435 \u0441\u043E\u0431\u044B\u0442\u0438\u044F.",
        button: interrupt,
        ts
      };
    }
    return {
      kind: "helicopter",
      title: "\u0412\u0435\u0440\u0442\u043E\u043B\u0451\u0442: \u0436\u0434\u0451\u043C \u043E\u0431\u044B\u0441\u043A",
      note: "\u041E\u0431\u044B\u0441\u043A \u0432\u0435\u0440\u0442\u043E\u043B\u0451\u0442\u0430 \u0438\u0434\u0451\u0442 \u0441\u0430\u043C \u0438 \u043D\u0435 \u043B\u044E\u0431\u0438\u0442 \u0441\u043F\u0435\u0448\u043A\u0438 \u2014 \u0430\u0432\u0442\u043E \u043C\u043E\u043B\u0447\u0438\u0442 \u0434\u043E \u0435\u0433\u043E \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0438\u044F.",
      button: null,
      hold: true,
      ts
    };
  }
  function cacheAdvice(keyboard, text, ts, events, active) {
    const action = events?.caches ?? "wait";
    const searching = flattenButtons(keyboard).some((button) => comparableText(button).includes("\u043F\u0440\u0435\u0440\u0432\u0430\u0442\u044C"));
    if (!isCacheSearchText(text) && !(active && searching)) return null;
    if (action === "skip") {
      const interrupt = flattenButtons(keyboard).find((button) => comparableText(button).includes("\u043F\u0440\u0435\u0440\u0432\u0430\u0442\u044C")) ?? null;
      if (interrupt === null) return null;
      return {
        kind: "cache",
        title: `\u041D\u0430\u0436\u043C\u0438 \xAB${interrupt.text.trim()}\xBB`,
        note: "\u0421\u0445\u0440\u043E\u043D: \u043F\u0440\u043E\u043F\u0443\u0441\u043A\u0430\u0435\u043C \u043F\u043E \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0435 \u0441\u043E\u0431\u044B\u0442\u0438\u044F.",
        button: interrupt,
        ts
      };
    }
    return {
      kind: "cache",
      title: "\u0421\u0445\u0440\u043E\u043D: \u0436\u0434\u0451\u043C \u043E\u0431\u044B\u0441\u043A",
      note: "\u041E\u0431\u044B\u0441\u043A \u0441\u0445\u0440\u043E\u043D\u0430 \u0438\u0434\u0451\u0442 \u0441\u0430\u043C (\u0434\u043E 16 \u043C\u0438\u043D\u0443\u0442) \u2014 \u0430\u0432\u0442\u043E \u043C\u043E\u043B\u0447\u0438\u0442 \u0434\u043E \u0435\u0433\u043E \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0438\u044F.",
      button: null,
      hold: true,
      ts
    };
  }
  function healthPercentOf(text) {
    const index = text.indexOf("\u0417\u0434\u043E\u0440\u043E\u0432\u044C\u0435");
    if (index < 0) return null;
    const window2 = text.slice(index, index + HEAL_WINDOW);
    const match = /(\d{1,3})\s*%/u.exec(window2);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  }
  function isBattle(text, keyboard) {
    if (BATTLE_TEXT_RE.test(text)) return true;
    if (ACTIONS_MENU_RE.test(text)) return true;
    return isBattleKeyboard(keyboard);
  }
  function isBattleKeyboard(keyboard) {
    return flattenButtons(keyboard).some((button) => comparableText(button) === "\u0430\u0442\u0430\u043A\u0430");
  }
  var SCENE_CHANGE_RE = /Местность:|Локация:|Скорость исследования|Сворачиваем удочки|Перед глазами аномалия|Вы обнаружили|Отхожу подальше|Прохожу мимо|Продолжаем путь|повержены|погибли|возрожден/u;
  function isSceneChangeText(text) {
    return SCENE_CHANGE_RE.test(text);
  }
  var KNOCKOUT_RE = /Сокрушительный удар выбил вас из боя/u;
  function isKnockoutText(text) {
    return KNOCKOUT_RE.test(text);
  }
  var STALE_KEYBOARD_RE = /(?:действие уже выполняется|кнопка с прошлого экрана|кнопка уже устарела)/iu;
  function isStaleKeyboardText(text) {
    return STALE_KEYBOARD_RE.test(text);
  }
  function recoveryAdvice(keyboard, ts) {
    const buttons = flattenButtons(keyboard);
    const campfire = buttons.find((button) => comparableText(button).includes("\u043A\u043E\u0441\u0442\u0451\u0440"));
    if (campfire) {
      return {
        kind: "recovery",
        title: `\u041D\u0430\u0436\u043C\u0438 \xAB${campfire.text.trim()}\xBB`,
        note: "\u0412\u0430\u0441 \u0432\u044B\u0431\u0438\u043B\u043E \u0438\u0437 \u0431\u043E\u044F \u2014 \u0440\u0430\u0437\u0436\u0438\u0433\u0430\u0435\u043C \u043A\u043E\u0441\u0442\u0451\u0440, \u0447\u0442\u043E\u0431\u044B \u043E\u0442\u0434\u043E\u0445\u043D\u0443\u0442\u044C \u0438 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C HP.",
        button: campfire,
        ts
      };
    }
    const rest = buttons.find((button) => comparableText(button).includes("\u043E\u0442\u0434\u043E\u0445\u043D\u0443\u0442\u044C"));
    if (rest) {
      return {
        kind: "recovery",
        title: `\u041D\u0430\u0436\u043C\u0438 \xAB${rest.text.trim()}\xBB`,
        note: "\u041A\u043E\u0441\u0442\u0451\u0440 \u0433\u043E\u0440\u0438\u0442 \u2014 \u043E\u0442\u0434\u044B\u0445\u0430\u0435\u043C, \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u0435 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u0441\u044F \u0441\u0430\u043C\u043E.",
        button: rest,
        ts
      };
    }
    return null;
  }
  function battleAdvice(keyboard, ts, rotation, battle, autoExpand) {
    const eligible = eligibleRotationRules(keyboard, battle, rotation);
    const first = eligible[0] ?? null;
    if (first !== null && first.button !== null) {
      const conditions = describeRotationRule(first.rule);
      const killTarget = first.rule.onKill && battle?.target ? ` \u2014 \u0434\u043E\u0431\u044C\u0451\u0442 \xAB${battle.target.name}\xBB (${battle.target.hp} HP)` : "";
      return {
        kind: "battle",
        title: `\u041D\u0430\u0436\u043C\u0438 \xAB${first.button.text.trim()}\xBB`,
        note: `\u0420\u043E\u0442\u0430\u0446\u0438\u044F: \u0448\u0430\u0433 ${first.step} \u0438\u0437 ${first.total}${conditions ? ` (${conditions})` : ""}${killTarget}.`,
        button: first.button,
        ts
      };
    }
    const wanted = first;
    const expander = flattenButtons(keyboard).find((candidate) => comparableButtonText2(candidate.text).replace(/^[^\p{L}\p{N}]+/u, "") === "\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F");
    const wantsMenu = wanted !== null && isSubmenuButton(wanted.rule.button, battle);
    if (wanted !== null && wantsMenu && autoExpand && (battle === null || !battle.expandTried) && expander) {
      return {
        kind: "battle",
        title: `\u041D\u0430\u0436\u043C\u0438 \xAB${expander.text.trim()}\xBB`,
        note: `\u0420\u043E\u0442\u0430\u0446\u0438\u044F \u0436\u0434\u0451\u0442 \xAB${wanted.rule.button}\xBB \u2014 \u0437\u0430\u0445\u043E\u0434\u0438\u043C \u0432 \xAB\u2795 \u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F\xBB \u0437\u0430 \u043D\u0435\u0439.`,
        button: expander,
        ts
      };
    }
    const withButton = eligible.find((entry) => entry.button !== null) ?? null;
    if (withButton !== null && withButton.button !== null) {
      const conditions = describeRotationRule(withButton.rule);
      const killTarget = withButton.rule.onKill && battle?.target ? ` \u2014 \u0434\u043E\u0431\u044C\u0451\u0442 \xAB${battle.target.name}\xBB (${battle.target.hp} HP)` : "";
      return {
        kind: "battle",
        title: `\u041D\u0430\u0436\u043C\u0438 \xAB${withButton.button.text.trim()}\xBB`,
        note: `\u0420\u043E\u0442\u0430\u0446\u0438\u044F: \u0448\u0430\u0433 ${withButton.step} \u0438\u0437 ${withButton.total}${conditions ? ` (${conditions})` : ""}${killTarget}.`,
        button: withButton.button,
        ts
      };
    }
    const backToBattle = flattenButtons(keyboard).find((candidate) => comparableText(candidate).replace(/^[^\p{L}\p{N}]+/u, "") === "\u043A \u0431\u043E\u044E");
    if (backToBattle) {
      return {
        kind: "battle",
        title: `\u041D\u0430\u0436\u043C\u0438 \xAB${backToBattle.text.trim()}\xBB`,
        note: "\u0412 \xAB\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F\u0445\xBB \u043D\u0435\u0442 \u043F\u043E\u0434\u0445\u043E\u0434\u044F\u0449\u0438\u0445 \u043F\u0440\u0430\u0432\u0438\u043B \u2014 \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u043C\u0441\u044F \u043A \u0431\u043E\u044E.",
        button: backToBattle,
        ts
      };
    }
    return {
      kind: "battle",
      title: "\u041F\u043E\u0434\u0445\u043E\u0434\u044F\u0449\u0438\u0445 \u043F\u0440\u0430\u0432\u0438\u043B \u0440\u043E\u0442\u0430\u0446\u0438\u0438 \u043D\u0435\u0442",
      note: "\u0411\u043E\u0439: \u043D\u0438 \u043E\u0434\u043D\u043E \u043F\u0440\u0430\u0432\u0438\u043B\u043E \u043D\u0435 \u043F\u043E\u0434\u043E\u0448\u043B\u043E (\u043A\u043D\u043E\u043F\u043A\u0438 \u043D\u0435\u0442 \u0432 \u043A\u043B\u0430\u0432\u0438\u0430\u0442\u0443\u0440\u0435 \u0438\u043B\u0438 \u0443\u0441\u043B\u043E\u0432\u0438\u044F \u043D\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u044B). \u041E\u0442\u043A\u0440\u043E\u0439 \u043E\u043A\u043D\u043E \xAB\u0420\u043E\u0442\u0430\u0446\u0438\u044F\xBB \u0438 \u043F\u0440\u043E\u0432\u0435\u0440\u044C \u043F\u0440\u0430\u0432\u0438\u043B\u0430.",
      button: null,
      ts
    };
  }
  function battleRotationCandidates(keyboard) {
    if (!keyboard) return [];
    return flattenButtons(keyboard).filter((button) => {
      const text = comparableText(button);
      return text && !NOT_IN_ROTATION.has(text) && !/^➕?\s*Лечени/iu.test(button.text);
    }).map((button) => button.text.trim());
  }
  function collectBattleButtons(keyboards) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const keyboard of keyboards) {
      if (!isBattleKeyboard(keyboard)) continue;
      for (const name of battleRotationCandidates(keyboard)) {
        if (!seen.has(name)) {
          seen.add(name);
          out.push(name);
        }
      }
    }
    return out;
  }
  function enabledOf(options, kind) {
    return options?.enabled ? options.enabled.has(kind) : true;
  }
  function buildAdvice(input, options) {
    const { keyboard, ts } = input;
    const text = input.text.replace(/^Загружается(?:\.\.\.|…)\s*/u, "");
    if (!keyboard) {
      if (enabledOf(options, "battle") && BATTLE_TEXT_RE.test(text)) {
        return {
          kind: "battle",
          title: "\u0411\u043E\u0439: \u0436\u0434\u0451\u043C \u043A\u043D\u043E\u043F\u043A\u0438",
          note: "\u0412\u0440\u0430\u0433 \u0430\u0442\u0430\u043A\u0443\u0435\u0442, \u0438\u0433\u0440\u0430 \u043F\u043E\u043A\u0430 \u043D\u0435 \u0434\u0430\u043B\u0430 \u043A\u043D\u043E\u043F\u043E\u043A. \u041F\u043E\u044F\u0432\u044F\u0442\u0441\u044F \u2014 \u043F\u043E\u0441\u043E\u0432\u0435\u0442\u0443\u0435\u043C \u0440\u043E\u0442\u0430\u0446\u0438\u044E.",
          button: null,
          ts
        };
      }
      return null;
    }
    const rest = options?.rest ?? null;
    if (rest !== null && rest.phase !== null) {
      const byNeedle = (needle) => flattenButtons(keyboard).find((button) => comparableButtonText2(button.text).includes(needle)) ?? null;
      if (rest.phase === "fire") {
        const fire = byNeedle("\u043A\u043E\u0441\u0442\u0451\u0440");
        if (fire !== null) {
          return {
            kind: "rest",
            title: `\u041D\u0430\u0436\u043C\u0438 \xAB${fire.text.trim()}\xBB`,
            note: `HP ${rest.hpPercent ?? "?"}% \u2264 ${rest.thresholdPercent}% \u2014 \u0438\u0434\u0451\u043C \u043E\u0442\u0434\u044B\u0445\u0430\u0442\u044C \u043A \u043A\u043E\u0441\u0442\u0440\u0443.`,
            button: fire,
            ts
          };
        }
      } else {
        const restored = rest.hpPercent !== null && rest.hpPercent >= 95;
        if (!restored) {
          const restButton = byNeedle("\u043E\u0442\u0434\u043E\u0445\u043D\u0443\u0442\u044C");
          if (restButton !== null) {
            return {
              kind: "rest",
              title: `\u041D\u0430\u0436\u043C\u0438 \xAB${restButton.text.trim()}\xBB`,
              note: `\u041E\u0442\u0434\u044B\u0445\u0430\u0435\u043C: HP ${rest.hpPercent ?? "?"}% \u2014 \u043D\u0430\u0436\u0438\u043C\u0430\u0435\u043C, \u043F\u043E\u043A\u0430 \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u0435 \u043D\u0435 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u0441\u044F.`,
              button: restButton,
              ts
            };
          }
        } else {
          const zone = byNeedle("\u0437\u043E\u043D\u0430");
          if (zone !== null) {
            return {
              kind: "rest",
              title: `\u041D\u0430\u0436\u043C\u0438 \xAB${zone.text.trim()}\xBB`,
              note: "\u0417\u0434\u043E\u0440\u043E\u0432\u044C\u0435 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u043E \u2014 \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u043C\u0441\u044F \u043A \u0438\u0441\u0441\u043B\u0435\u0434\u043E\u0432\u0430\u043D\u0438\u044E \u043B\u043E\u043A\u0430\u0446\u0438\u0438.",
              button: zone,
              ts
            };
          }
        }
        return {
          kind: "rest",
          title: "\u041E\u0442\u0434\u044B\u0445",
          note: "\u0416\u0434\u0451\u043C \u043A\u043D\u043E\u043F\u043A\u0438 \u044D\u043A\u0440\u0430\u043D\u0430 \u043E\u0442\u0434\u044B\u0445\u0430.",
          button: null,
          hold: true,
          ts
        };
      }
    }
    const taskKeyboard = keyboard.inline ? keyboard : null;
    if (enabledOf(options, "label") && taskKeyboard) {
      const labelMatch = LABEL_TASK_RE.exec(text);
      if (labelMatch) {
        const label = labelMatch[1] ?? "";
        const button = findLabelButton(taskKeyboard, label);
        const guessed = button !== null && comparableText(button) !== label.trim().toLowerCase();
        return {
          kind: "label",
          title: `\u041D\u0430\u0436\u043C\u0438 \xAB${label.trim()}\xBB`,
          note: guessed ? "\u0422\u043E\u0447\u043D\u043E\u0439 \u043A\u043D\u043E\u043F\u043A\u0438 \u043D\u0435\u0442 \u2014 \u0432\u044B\u0431\u0440\u0430\u043D\u0430 \u043F\u043E\u0445\u043E\u0436\u0430\u044F \u043D\u0430\u0443\u0433\u0430\u0434. \u041E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u0438\u0435 \u043F\u043E \u0432\u0440\u0435\u043C\u0435\u043D\u0438, \u0440\u0435\u0448\u0430\u0439 \u0431\u044B\u0441\u0442\u0440\u043E." : "\u0417\u0430\u0434\u0430\u043D\u0438\u0435 \u043F\u043E \u043D\u0430\u0434\u043F\u0438\u0441\u0438 \u2014 \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u0438\u0435 \u043F\u043E \u0432\u0440\u0435\u043C\u0435\u043D\u0438, \u0440\u0435\u0448\u0430\u0439 \u0431\u044B\u0441\u0442\u0440\u043E.",
          button,
          ts
        };
      }
    }
    if (enabledOf(options, "color") && taskKeyboard && COLOR_TASK_RE2.test(text)) {
      const allowed = parseColorInstruction(text);
      if (allowed !== null) {
        const button = findColorButton(taskKeyboard, text);
        if (button) {
          return {
            kind: "color",
            title: `\u041D\u0430\u0436\u043C\u0438 \xAB${button.text.trim()}\xBB`,
            note: `\u0417\u0430\u0434\u0430\u043D\u0438\u0435 \u043F\u043E \u0446\u0432\u0435\u0442\u0443: \u043D\u0430\u0434\u043F\u0438\u0441\u0438 \u0432\u0440\u0443\u0442, \u0443 \u044D\u0442\u043E\u0439 \u043A\u043D\u043E\u043F\u043A\u0438 \u0446\u0432\u0435\u0442 \xAB${button.color}\xBB.`,
            button,
            buttonColor: button.color,
            ts
          };
        }
        return {
          kind: "color",
          title: "\u041F\u043E\u0434\u0445\u043E\u0434\u044F\u0449\u0430\u044F \u043A\u043D\u043E\u043F\u043A\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430",
          note: "\u0417\u0430\u0434\u0430\u043D\u0438\u0435 \u043F\u043E \u0446\u0432\u0435\u0442\u0443: \u0441\u0440\u0435\u0434\u0438 \u043A\u043D\u043E\u043F\u043E\u043A \u043D\u0435\u0442 \u0446\u0432\u0435\u0442\u0430 \u0438\u0437 \u0437\u0430\u0434\u0430\u043D\u0438\u044F. \u0412\u043E\u0437\u043C\u043E\u0436\u043D\u043E, \xAB\u041E\u0442\u043F\u0443\u0441\u0442\u0438\u0442\u044C\xBB.",
          button: null,
          ts
        };
      }
    }
    if (enabledOf(options, "icon") && taskKeyboard) {
      const iconMatch = ICON_TASK_RE.exec(text);
      if (iconMatch) {
        const icon = iconMatch[1] ?? "";
        const button = findIconButton(taskKeyboard, icon);
        if (button) {
          return {
            kind: "icon",
            title: `\u041D\u0430\u0436\u043C\u0438 \xAB${button.text.trim()}\xBB`,
            note: `\u0417\u0430\u0434\u0430\u043D\u0438\u0435 \u043F\u043E \u0437\u043D\u0430\u0447\u043A\u0443: \u0443 \u044D\u0442\u043E\u0439 \u043A\u043D\u043E\u043F\u043A\u0438 \u0437\u043D\u0430\u0447\u043E\u043A ${icon}, \u043D\u0430\u0434\u043F\u0438\u0441\u044C \u043D\u0435 \u0432\u0430\u0436\u043D\u0430.`,
            button,
            ts
          };
        }
        return {
          kind: "icon",
          title: "\u041A\u043D\u043E\u043F\u043A\u0438 \u0441 \u043D\u0443\u0436\u043D\u044B\u043C \u0437\u043D\u0430\u0447\u043A\u043E\u043C \u043D\u0435\u0442",
          note: `\u0417\u0430\u0434\u0430\u043D\u0438\u0435 \u043F\u043E \u0437\u043D\u0430\u0447\u043A\u0443 ${icon}: \u0441\u0440\u0435\u0434\u0438 \u043A\u043D\u043E\u043F\u043E\u043A \u0442\u0430\u043A\u043E\u0439 \u0437\u043D\u0430\u0447\u043E\u043A \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D. \u0412\u043E\u0437\u043C\u043E\u0436\u043D\u043E, \xAB\u041E\u0442\u043F\u0443\u0441\u0442\u0438\u0442\u044C\xBB.`,
          button: null,
          ts
        };
      }
    }
    if (enabledOf(options, "recovery") && options?.recovery) {
      const recovery = recoveryAdvice(keyboard, ts);
      if (recovery) return recovery;
    }
    if (enabledOf(options, "anomaly")) {
      const anomaly = anomalyAdvice(
        keyboard,
        text,
        ts,
        input.anomaly ?? null,
        options?.events,
        options?.anomalyExit === true,
        options?.anomalyTypeRules ?? null,
        options?.anomalyBonusLimit ?? null
      );
      if (anomaly) return anomaly;
    }
    if (enabledOf(options, "rift")) {
      const rift = riftAdvice(keyboard, text, ts, options?.events);
      if (rift) return rift;
    }
    if (enabledOf(options, "helicopter")) {
      const helicopter = helicopterAdvice(keyboard, text, ts, options?.events, options?.helicopter);
      if (helicopter) return helicopter;
    }
    if (enabledOf(options, "cache")) {
      const cache = cacheAdvice(keyboard, text, ts, options?.events, options?.caches);
      if (cache) return cache;
    }
    if (enabledOf(options, "battle") && isBattle(text, keyboard)) {
      if (BATTLE_TEXT_RE.test(text) && !isBattleKeyboard(keyboard) && !isActionsMenuKeyboard(keyboard)) {
        return {
          kind: "battle",
          title: "\u0411\u043E\u0439: \u0436\u0434\u0451\u043C \u043A\u043D\u043E\u043F\u043A\u0438",
          note: "\u0412\u0440\u0430\u0433 \u0430\u0442\u0430\u043A\u0443\u0435\u0442, \u0431\u043E\u0435\u0432\u0430\u044F \u043A\u043B\u0430\u0432\u0438\u0430\u0442\u0443\u0440\u0430 \u0435\u0449\u0451 \u043D\u0435 \u0437\u0430\u0445\u0432\u0430\u0447\u0435\u043D\u0430. \u041F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u0432 \u0437\u0430\u043F\u0438\u0441\u0438 \u2014 \u043F\u043E\u0441\u043E\u0432\u0435\u0442\u0443\u0435\u043C \u0440\u043E\u0442\u0430\u0446\u0438\u044E.",
          button: null,
          ts
        };
      }
      return battleAdvice(keyboard, ts, options?.battleRotation ?? [], options?.battle ?? null, options?.battleAutoExpand !== false);
    }
    if (enabledOf(options, "heal")) {
      const health = healthPercentOf(text);
      if (health !== null && health < HEAL_LOW_THRESHOLD) {
        const button = findHealButton(keyboard);
        if (button) {
          return {
            kind: "heal",
            title: `\u041D\u0430\u0436\u043C\u0438 \xAB${button.text.trim()}\xBB`,
            note: `\u0417\u0434\u043E\u0440\u043E\u0432\u044C\u0435 ${health}% \u2014 \u043F\u043E\u0440\u0430 \u043B\u0435\u0447\u0438\u0442\u044C\u0441\u044F.`,
            button,
            ts
          };
        }
      }
    }
    return null;
  }

  // src/core/message.ts
  function messageKey(message) {
    return `${message.peerId}:${message.conversationMessageId ?? message.id}`;
  }
  function normalizeMessage(raw, context = {}) {
    if (!isRecord(raw)) return null;
    const peerId = asNumber(pick(raw, "peer_id", "peerId") ?? context.peerId);
    if (peerId === null) return null;
    const conversationMessageId = asNumber(pick(raw, "conversation_message_id", "conversationMessageId")) || null;
    const id = asNumber(raw.id) || null;
    if (conversationMessageId === null && id === null) return null;
    const reply = isRecord(raw.reply_message) ? raw.reply_message : isRecord(raw.replyMessage) ? raw.replyMessage : null;
    const payloadRaw = rawPayload(raw.payload);
    const date = asNumber(raw.date) ?? 0;
    const attachments = Array.isArray(raw.attachments) ? raw.attachments.map((item) => isRecord(item) && typeof item.type === "string" ? item.type : null).filter((type) => type !== null) : [];
    const message = {
      key: "",
      peerId,
      conversationMessageId,
      id,
      fromId: asNumber(pick(raw, "from_id", "fromId")),
      out: asBoolean(raw.out),
      ts: date > 0 ? date * 1e3 : context.ts ?? Date.now(),
      text: asString(raw.text),
      keyboard: normalizeKeyboard(raw.keyboard),
      payloadRaw,
      payload: decodePayload(payloadRaw),
      replyTo: reply ? asNumber(pick(reply, "conversation_message_id", "id")) || null : null,
      attachments,
      source: context.source ?? "unknown"
    };
    message.key = messageKey(message);
    return message;
  }

  // src/core/dom.ts
  function normalizeComparableText(value) {
    return value.replace(/\s+/g, " ").trim();
  }
  function domTextOf(root) {
    let out = "";
    const walk = (node) => {
      if (node.nodeType === 3) {
        out += node.nodeValue ?? "";
        return;
      }
      if (node.nodeName === "BR") {
        out += "\n";
        return;
      }
      if (node.nodeName === "IMG") {
        out += node.getAttribute("alt") ?? "";
        return;
      }
      node.childNodes.forEach(walk);
    };
    walk(root);
    return cleanDomText(out);
  }
  function cleanDomText(value) {
    return value.replace(/\u00a0/g, " ").replace(/\u200b/g, "").replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[ \t]+$/g, "").replace(/^[ \t]+/g, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function messageSignature(message) {
    const text = normalizeComparableText(message.text);
    const keyboard = message.keyboard ? `${message.keyboard.inline ? 1 : 0}:${message.keyboard.buttons.map((row) => row.map((button) => normalizeComparableText(button.text)).join("")).join("")}` : null;
    const body = text || (keyboard ? `keyboard:${keyboard}` : `attachments:${message.attachments.join(",")}`);
    return `${message.peerId}:${message.out ? 1 : 0}:${body}`;
  }
  function stableNumericId(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0 || 1;
  }
  function parseVkEntityId(href) {
    let path = href;
    try {
      path = new URL(href, "https://vk.com").pathname;
    } catch {
    }
    const match = path.match(/^\/(id|club|public)(\d+)/i);
    if (!match) return null;
    const id = Number(match[2]);
    if (!Number.isFinite(id)) return null;
    return match[1]?.toLowerCase() === "id" ? id : -id;
  }
  function outgoingFromClass(className) {
    if (/(?:^|[\s_-])(?:out|outgoing|outbound)(?:$|[\s_-])/i.test(className)) return true;
    if (/(?:^|[\s_-])(?:in|incoming|inbound)(?:$|[\s_-])/i.test(className)) return false;
    return null;
  }

  // src/core/extract.ts
  function looksLikeMessage(value) {
    if (!isRecord(value)) return false;
    const hasConversationId = value.conversation_message_id !== null && value.conversation_message_id !== void 0;
    const hasClassicFields = value.peer_id !== null && value.peer_id !== void 0 && value.from_id !== null && value.from_id !== void 0 && value.date !== null && value.date !== void 0;
    return hasConversationId || hasClassicFields;
  }
  function collectMessages(node, out, depth = 0) {
    if (node === null || node === void 0 || depth > 10) return out;
    if (Array.isArray(node)) {
      for (const item of node) collectMessages(item, out, depth + 1);
      return out;
    }
    if (!isRecord(node)) return out;
    if (looksLikeMessage(node)) {
      out.push(node);
      return out;
    }
    for (const value of Object.values(node)) collectMessages(value, out, depth + 1);
    return out;
  }
  function extractMessages(payload) {
    return collectMessages(payload, []);
  }
  function extractConversationKeyboards(payload) {
    const out = [];
    collectConversationKeyboards(payload, out, /* @__PURE__ */ new Set());
    return out;
  }
  function collectConversationKeyboards(node, out, seen, depth = 0) {
    if (node === null || node === void 0 || depth > 12) return;
    if (Array.isArray(node)) {
      for (const item of node) collectConversationKeyboards(item, out, seen, depth + 1);
      return;
    }
    if (!isRecord(node)) return;
    const keyboard = node.current_keyboard;
    if (isRecord(keyboard) && normalizeKeyboard(keyboard) !== null) {
      const peer = isRecord(node.peer) ? node.peer : null;
      const peerId = asNumber(peer?.id) ?? asNumber(node.peer_id);
      if (peerId !== null) {
        const lastMessages = Array.isArray(node.last_messages) ? node.last_messages : [];
        const keyboardJson = JSON.stringify(keyboard);
        const alreadyOnMessage = lastMessages.some((item) => isRecord(item) && isRecord(item.keyboard) && JSON.stringify(item.keyboard) === keyboardJson);
        if (!alreadyOnMessage) {
          let lastIncomingDate = null;
          for (const item of lastMessages) {
            if (isRecord(item) && (item.out === 0 || item.out === false)) {
              lastIncomingDate = asNumber(item.date);
              if (lastIncomingDate !== null) break;
            }
          }
          const date = lastIncomingDate ?? asNumber(node.timestamp) ?? 0;
          const id = -stableNumericId(`${peerId}:${keyboardJson}`);
          const key = `${peerId}:${id}`;
          if (!seen.has(key)) {
            seen.add(key);
            out.push({
              id,
              peer_id: peerId,
              from_id: asNumber(keyboard.author_id) ?? (peerId < 0 ? peerId : void 0),
              date,
              out: 0,
              text: "",
              keyboard
            });
          }
        }
      }
    }
    for (const value of Object.values(node)) {
      collectConversationKeyboards(value, out, seen, depth + 1);
    }
  }

  // src/core/api.ts
  function extractApiMethod(url) {
    if (!url) return null;
    try {
      const parsed = new URL(url, "https://vk.com");
      const direct = parsed.searchParams.get("method") ?? parsed.searchParams.get("act");
      if (direct && /^messages\./.test(direct)) return direct;
      const pathMatch = parsed.pathname.match(/\/method\/([^/]+)/);
      if (pathMatch?.[1] && /^messages\./.test(pathMatch[1])) return pathMatch[1];
      if (parsed.pathname.includes("al_im.php") || parsed.pathname.includes("/al_im")) {
        return "messages.web";
      }
      return null;
    } catch {
      return null;
    }
  }
  function isLongPollUrl(url) {
    if (!url) return false;
    try {
      const parsed = new URL(url, "https://vk.com");
      if (parsed.hostname.includes("longpoll")) return true;
      return parsed.searchParams.get("act") === "a_check";
    } catch {
      return false;
    }
  }
  function parseRequestBody(body) {
    if (body === null || body === void 0) return null;
    if (typeof body === "string") {
      try {
        return JSON.parse(body);
      } catch {
      }
      try {
        return Object.fromEntries(new URLSearchParams(body));
      } catch {
        return body;
      }
    }
    if (body instanceof URLSearchParams) {
      return Object.fromEntries(body);
    }
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      const result = {};
      for (const [key, value] of body.entries()) {
        result[key] = typeof value === "string" ? value : "[file]";
      }
      return result;
    }
    if (typeof body === "object") {
      if ("getReader" in body) return "[stream]";
      return body;
    }
    return String(body);
  }
  function peerIdFromSel(sel) {
    if (!sel) return null;
    const value = sel.trim();
    const chat = value.match(/^(?:c|chat)(\d+)$/i);
    if (chat?.[1]) return 2e9 + Number(chat[1]);
    if (/^-?\d+$/.test(value)) return Number(value);
    return null;
  }

  // src/core/sanitize.ts
  var SENSITIVE_KEY = /token|password|passwd|secret|cookie|authorization|csrf/i;
  function sanitizeForStorage(value, depth = 0, seen = /* @__PURE__ */ new WeakSet(), stats) {
    if (value === null || typeof value !== "object") {
      if (stats !== void 0 && typeof value === "string") stats.chars += value.length;
      return value;
    }
    if (depth > 12) return "[depth]";
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    if (stats !== void 0) stats.nodes += 1;
    if (Array.isArray(value)) {
      return value.slice(0, 200).map((item) => sanitizeForStorage(item, depth + 1, seen, stats));
    }
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (stats !== void 0) stats.chars += key.length;
      result[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : sanitizeForStorage(item, depth + 1, seen, stats);
    }
    return result;
  }
  function sanitizeUrl(url) {
    if (!url) return null;
    try {
      const base = typeof location !== "undefined" ? location.href : "https://vk.com";
      const parsed = new URL(url, base);
      for (const key of ["access_token", "token", "csrf", "hash"]) {
        if (parsed.searchParams.has(key)) parsed.searchParams.set(key, "[redacted]");
      }
      return parsed.toString();
    } catch {
      return String(url);
    }
  }

  // src/core/decision.ts
  var MAX_LINK_AGE_MS = 6 * 60 * 60 * 1e3;
  var MAX_LINK_FUTURE_SKEW_MS = 10 * 1e3;
  var DEFAULT_MAX_LINK_AGE_MS = MAX_LINK_AGE_MS;
  var DEFAULT_MAX_FUTURE_SKEW_MS = MAX_LINK_FUTURE_SKEW_MS;
  function decisionKey(decision) {
    const bucket = Math.floor(decision.ts / 5e3);
    return `${decision.peerId}:${decision.kind}:${decision.payloadRaw ?? decision.text}:${bucket}`;
  }
  var MATCH_RANK = {
    none: 0,
    heuristic: 1,
    text: 2,
    color: 3,
    payload: 4
  };
  function payloadTextOf(payloadRawValue) {
    if (!payloadRawValue) return "";
    const payload = decodePayload(payloadRawValue);
    if (!isRecord(payload) || !isRecord(payload.d)) return "";
    return typeof payload.d.text === "string" ? payload.d.text : "";
  }
  function findColorButton2(keyboard, allowed) {
    for (const row of keyboard.buttons) {
      for (const button of row) {
        if (button.color !== null && allowed.has(button.color)) return button;
      }
    }
    return null;
  }
  function findBestLink(decision, candidates) {
    if (candidates.length === 0) return null;
    const decisionText = decision.text.trim() || payloadTextOf(decision.payloadRaw);
    const allowedColors = parseColorInstruction(decisionText);
    let fallbackMatch = null;
    for (const candidate of candidates) {
      if (!candidate.keyboard) continue;
      if (decision.payloadRaw) {
        const payloadButton = findButtonByPayload(candidate.keyboard, decision.payloadRaw);
        if (payloadButton) {
          return {
            offeredBy: candidate.key,
            button: payloadButton.text,
            buttonColor: payloadButton.color,
            match: "payload"
          };
        }
      }
      const colorButton = allowedColors !== null ? findColorButton2(candidate.keyboard, allowedColors) : null;
      if (colorButton) {
        return {
          offeredBy: candidate.key,
          button: colorButton.text,
          buttonColor: colorButton.color,
          match: "color"
        };
      }
      const textMatch = findButtonByTextMatch(candidate.keyboard, decisionText);
      if (textMatch) {
        if (textMatch.exact) {
          return {
            offeredBy: candidate.key,
            button: textMatch.button.text,
            buttonColor: textMatch.button.color,
            match: "text"
          };
        }
        fallbackMatch ??= { keyboard: candidate, button: textMatch.button };
      }
    }
    if (fallbackMatch) {
      return {
        offeredBy: fallbackMatch.keyboard.key,
        button: fallbackMatch.button.text,
        buttonColor: fallbackMatch.button.color,
        match: "text"
      };
    }
    const latest = candidates[0];
    if (!latest) return null;
    return { offeredBy: latest.key, button: null, buttonColor: null, match: "heuristic" };
  }
  function keyboardWindow(keyboards, ts, maxAgeMs = MAX_LINK_AGE_MS, maxFutureSkewMs = MAX_LINK_FUTURE_SKEW_MS) {
    let lo = 0;
    let hi = keyboards.length;
    while (lo < hi) {
      const mid = lo + hi >> 1;
      if ((keyboards[mid]?.ts ?? 0) < ts - maxAgeMs) lo = mid + 1;
      else hi = mid;
    }
    const from = lo;
    hi = keyboards.length;
    while (lo < hi) {
      const mid = lo + hi >> 1;
      if ((keyboards[mid]?.ts ?? 0) <= ts + maxFutureSkewMs) lo = mid + 1;
      else hi = mid;
    }
    return keyboards.slice(from, lo);
  }
  function linkDecision(decision, keyboards, maxAgeMs = DEFAULT_MAX_LINK_AGE_MS, maxFutureSkewMs = DEFAULT_MAX_FUTURE_SKEW_MS, force = false) {
    if (!force && decision.offeredBy !== null) return decision;
    if (force) {
      const decisionText = decision.text.trim() || payloadTextOf(decision.payloadRaw);
      const ceiling = decision.payloadRaw !== null ? MATCH_RANK.payload : parseColorInstruction(decisionText) !== null ? MATCH_RANK.color : MATCH_RANK.text;
      if ((MATCH_RANK[decision.match] ?? 0) >= ceiling) return decision;
    }
    const candidates = keyboards.filter((keyboard) => keyboard.peerId === decision.peerId && keyboard.keyboard !== null && keyboard.ts - decision.ts <= maxFutureSkewMs && decision.ts - keyboard.ts <= maxAgeMs).sort((a, b) => {
      const aFuture = a.ts > decision.ts;
      const bFuture = b.ts > decision.ts;
      if (aFuture !== bFuture) return aFuture ? 1 : -1;
      return aFuture ? a.ts - b.ts : b.ts - a.ts;
    });
    const best = findBestLink(decision, candidates);
    if (!best) return decision;
    if (force) {
      const currentRank = MATCH_RANK[decision.match] ?? 0;
      const bestRank = MATCH_RANK[best.match] ?? 0;
      if (bestRank <= currentRank) return decision;
    }
    return {
      ...decision,
      offeredBy: best.offeredBy,
      button: best.button,
      buttonColor: best.buttonColor,
      match: best.match
    };
  }
  function processBatch(rawMessages, options = {}) {
    const lastKeyboard = options.lastKeyboard ?? /* @__PURE__ */ new Map();
    const normalized = rawMessages.map((raw) => normalizeMessage(raw, options)).filter((message) => message !== null);
    const unique = [];
    const seen = /* @__PURE__ */ new Set();
    for (const message of normalized) {
      if (!seen.has(message.key)) {
        seen.add(message.key);
        unique.push(message);
      }
    }
    unique.sort((a, b) => a.ts - b.ts || (a.conversationMessageId ?? 0) - (b.conversationMessageId ?? 0));
    const decisions = [];
    for (const message of unique) {
      if (!message.out && message.keyboard) lastKeyboard.set(message.peerId, message);
      if (!message.out) continue;
      let offered = null;
      if (message.replyTo !== null) {
        const replied = unique.find((candidate) => candidate.peerId === message.peerId && (candidate.conversationMessageId ?? candidate.id) === message.replyTo && candidate.keyboard !== null);
        if (replied) offered = replied;
      }
      if (!offered) offered = lastKeyboard.get(message.peerId) ?? null;
      const decision = {
        key: "",
        ts: message.ts,
        peerId: message.peerId,
        userId: message.fromId,
        kind: message.payloadRaw ? "callback" : "text",
        text: message.text,
        payloadRaw: message.payloadRaw,
        payload: message.payload,
        inReplyTo: message.replyTo,
        offeredBy: null,
        button: null,
        buttonColor: null,
        match: "none",
        messageKey: message.key
      };
      const linked = linkDecision(decision, offered ? [offered] : [], options.maxLinkAgeMs);
      if (!linked.text && linked.button) linked.text = linked.button;
      linked.key = decisionKey(linked);
      decisions.push(linked);
    }
    return { messages: unique, decisions, lastKeyboard };
  }

  // src/core/send.ts
  function messageFromSend(request, response, now = Date.now(), seq = 0) {
    if (!isRecord(request)) return null;
    const peerId = asNumber(pick(request, "peer_id", "peerId"));
    if (peerId === null) return null;
    const responseRecord = isRecord(response) ? response : null;
    const responseId = responseRecord ? asNumber(responseRecord.response) : null;
    const payloadRaw = rawPayload(pick(request, "payload"));
    const payload = decodePayload(payloadRaw);
    const payloadData = isRecord(payload) && isRecord(payload.d) ? payload.d : null;
    const payloadText = payloadData && typeof payloadData.text === "string" ? payloadData.text : "";
    const text = String(pick(request, "message", "text") ?? "") || payloadText;
    return {
      id: responseId ?? -(now * 1e3 + seq),
      conversation_message_id: null,
      peer_id: peerId,
      from_id: null,
      date: Math.floor(now / 1e3),
      out: 1,
      text,
      payload: payloadRaw,
      keyboard: null
    };
  }

  // src/core/game.ts
  var GAME_CHAT_TITLE = "\u0421\u0442\u0430\u043B\u043A\u0435\u0440 \u0421\u0435\u0440\u0434\u0446\u0435 \u0427\u0435\u0440\u043D\u043E\u0431\u044B\u043B\u044F";
  var GAME_PEER_ID = -178710605;
  function normalizeTitle(value) {
    return value.toLowerCase().replace(/ё/gu, "\u0435").replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/gu, " ").trim();
  }
  var GAME_CHAT_TITLE_NORMALIZED = normalizeTitle(GAME_CHAT_TITLE);
  function isGameTitle(value) {
    return value.trim().length > 0 && normalizeTitle(value) === GAME_CHAT_TITLE_NORMALIZED;
  }
  function pageTitleLooksLikeGame(title) {
    const value = title.toLowerCase().replace(/ё/gu, "\u0435").replace(/^\(?\d+\)?[\s.·-]*/u, "").replace(/\s*[-–—|·]+\s*(?:вконтакте|vk)\s*$/u, "");
    return isGameTitle(value);
  }
  function detectGamePeers(payload) {
    const found = /* @__PURE__ */ new Set();
    collectGamePeers(payload, found, 0);
    return [...found];
  }
  function collectGamePeers(node, found, depth) {
    if (node === null || node === void 0 || depth > 12) return;
    if (Array.isArray(node)) {
      for (const item of node) collectGamePeers(item, found, depth + 1);
      return;
    }
    if (!isRecord(node)) return;
    const chatSettings = node.chat_settings;
    if (isRecord(chatSettings) && typeof chatSettings.title === "string" && isGameTitle(chatSettings.title)) {
      const peerId = asNumber(isRecord(node.peer) ? node.peer.id : null) ?? asNumber(node.peer_id);
      if (peerId !== null) found.add(peerId);
    }
    const id = asNumber(node.id);
    if (id !== null && id < 0 && typeof node.name === "string" && isGameTitle(node.name)) {
      found.add(id);
    }
    for (const value of Object.values(node)) collectGamePeers(value, found, depth + 1);
  }
  function isFishingFlowText(text) {
    return /Наживк|Садок|садке|Поплавок/u.test(text);
  }
  function isFishLostText(text) {
    return /Сорвалась|замешкал/u.test(text);
  }

  // src/core/settings.ts
  var ANOMALY_TYPES_KNOWN_LIMIT = 40;
  function sanitizeAnomalyTypeRules(value) {
    const out = { rules: {}, known: [] };
    if (!isRecord(value)) return out;
    const rules = value.rules;
    if (isRecord(rules)) {
      for (const [name, action] of Object.entries(rules)) {
        const key = name.trim();
        if (!key || action !== "enter" && action !== "skip") continue;
        out.rules[key] = action;
      }
    }
    if (Array.isArray(value.known)) {
      const seen = /* @__PURE__ */ new Set();
      for (const item of value.known) {
        if (typeof item !== "string") continue;
        const name = item.trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        out.known.push(name);
        if (out.known.length >= ANOMALY_TYPES_KNOWN_LIMIT) break;
      }
    }
    for (const name of Object.keys(out.rules)) {
      if (!out.known.includes(name)) out.known.push(name);
    }
    return out;
  }
  var MODES = ["observe", "advice", "auto"];
  function sanitizeMode(value) {
    return MODES.includes(value) ? value : "observe";
  }
  function sanitizeGamePeerIds(value) {
    if (!Array.isArray(value)) return [];
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const item of value) {
      if (typeof item !== "number" || !Number.isInteger(item) || seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
    return out;
  }
  function sanitizeBoolean(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  }
  function sanitizeEventRules(value) {
    const out = { ...DEFAULT_EVENT_RULES };
    if (!isRecord(value)) return out;
    if (isAnomalyEventAction(value.anomaly)) out.anomaly = value.anomaly;
    if (isRiftEventAction(value.rift)) out.rift = value.rift;
    if (isHelicopterEventAction(value.helicopter)) out.helicopter = value.helicopter;
    if (isCacheEventAction(value.caches)) out.caches = value.caches;
    return out;
  }
  var DELAY_MAX_MS = 6e5;
  function sanitizeAutoDelays(value) {
    if (!isRecord(value)) return {};
    const out = {};
    for (const key of DELAY_KEYS) {
      const raw = value[key];
      if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
      out[key] = Math.max(0, Math.min(DELAY_MAX_MS, Math.round(raw)));
    }
    return out;
  }
  var FORK_BUTTONS_LIMIT = 40;
  function sanitizeForkRules(value) {
    if (!Array.isArray(value)) return [];
    const out = [];
    for (const item of value) {
      if (!isRecord(item)) continue;
      const signature = typeof item.signature === "string" ? item.signature.trim() : "";
      if (!signature) continue;
      const buttons = Array.isArray(item.buttons) ? item.buttons.filter((button) => typeof button === "string" && button.trim().length > 0).slice(0, FORK_BUTTONS_LIMIT) : [];
      if (buttons.length === 0) continue;
      const choice = typeof item.choice === "string" && item.choice.trim().length > 0 ? item.choice : null;
      const ts = typeof item.ts === "number" && Number.isFinite(item.ts) && item.ts > 0 ? item.ts : 0;
      const count = typeof item.count === "number" && Number.isFinite(item.count) && item.count >= 1 ? Math.floor(item.count) : 1;
      out.push({ signature, buttons, choice, ts, count });
    }
    return out;
  }

  // src/core/update.ts
  function parseVersionFromSource(source) {
    const match = /\/\/\s*@version\s+(\S+)/u.exec(source);
    return match?.[1] ?? null;
  }
  function versionParts(version) {
    return version.split(".").map((part) => {
      const value = Number.parseInt(part, 10);
      return Number.isNaN(value) ? 0 : value;
    });
  }
  function isNewerVersion(remote, local) {
    const a = versionParts(remote);
    const b = versionParts(local);
    const length = Math.max(a.length, b.length);
    for (let i = 0; i < length; i += 1) {
      const av = a[i] ?? 0;
      const bv = b[i] ?? 0;
      if (av !== bv) return av > bv;
    }
    return false;
  }

  // src/core/hang.ts
  var PAGE_RELOAD_AFTER_MS = 5 * 6e4;
  function pageReloadDecision(input) {
    if (input.mode !== "auto") return "wait";
    if (!input.isGameChat || input.hidden) return "wait";
    if (input.captchaActive || input.manualPaused || input.blindFishing) return "wait";
    if (input.adviceHold || input.pendingChoice) return "wait";
    if (input.cacheSearchActive || input.helicopterActive || input.restActive) return "wait";
    if (input.silentMs <= PAGE_RELOAD_AFTER_MS) return "wait";
    if (!input.hasScreen) return "wait";
    return "schedule";
  }

  // src/storage/db.ts
  var DB_NAME = "stalker-assistant";
  var DB_VERSION = 3;
  var dbPromise = null;
  function openDb() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        const stores = [
          ["raw", "id"],
          ["messages", "key"],
          ["decisions", "key"],
          ["keyboards", "key"],
          ["meta", "key"]
        ];
        for (const [name, keyPath] of stores) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
        }
        const upgradeTx = request.transaction;
        for (const name of ["raw", "messages", "decisions", "keyboards"]) {
          if (!db.objectStoreNames.contains(name)) continue;
          const store = upgradeTx?.objectStore(name);
          if (store && !store.indexNames.contains("ts")) store.createIndex("ts", "ts", { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (settled) {
          db.close();
          return;
        }
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onblocked = () => {
        settled = true;
        console.warn("[Stalker Assistant] \u0431\u0430\u0437\u0430 \u0437\u0430\u043D\u044F\u0442\u0430 \u0432\u043A\u043B\u0430\u0434\u043A\u043E\u0439 \u0441\u043E \u0441\u0442\u0430\u0440\u043E\u0439 \u0432\u0435\u0440\u0441\u0438\u0435\u0439 \u0441\u043A\u0440\u0438\u043F\u0442\u0430: \u043F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 \u043E\u0441\u0442\u0430\u043B\u044C\u043D\u044B\u0435 \u0432\u043A\u043B\u0430\u0434\u043A\u0438 vk.com \u2014 \u0430\u0441\u0441\u0438\u0441\u0442\u0435\u043D\u0442 \u043F\u043E\u0434\u043D\u0438\u043C\u0435\u0442\u0441\u044F \u0441\u0430\u043C");
        reject(new Error("\u0431\u0430\u0437\u0430 IndexedDB \u0437\u0430\u043D\u044F\u0442\u0430 \u0434\u0440\u0443\u0433\u043E\u0439 \u0432\u043A\u043B\u0430\u0434\u043A\u043E\u0439 (\u0441\u0442\u0430\u0440\u0430\u044F \u0432\u0435\u0440\u0441\u0438\u044F \u0441\u043A\u0440\u0438\u043F\u0442\u0430): \u043F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 \u043E\u0441\u0442\u0430\u043B\u044C\u043D\u044B\u0435 \u0432\u043A\u043B\u0430\u0434\u043A\u0438 vk.com \u2014 \u0430\u0441\u0441\u0438\u0441\u0442\u0435\u043D\u0442 \u043F\u043E\u0434\u043D\u0438\u043C\u0435\u0442\u0441\u044F \u0441\u0430\u043C"));
      };
      request.onerror = () => {
        settled = true;
        reject(request.error ?? new Error("indexedDB open failed"));
      };
    });
  }
  function getDb() {
    if (!dbPromise) {
      dbPromise = openDb();
      dbPromise.catch(() => {
        dbPromise = null;
      });
    }
    return dbPromise;
  }
  function dbRequest(storeName, mode, action) {
    return getDb().then((db) => new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      let result;
      try {
        result = action(transaction.objectStore(storeName));
      } catch (error) {
        reject(error);
        return;
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error ?? new Error("indexedDB transaction failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("indexedDB transaction aborted"));
    }));
  }
  function putMany(storeName, items) {
    if (items.length === 0) return Promise.resolve();
    return dbRequest(storeName, "readwrite", (store) => {
      for (const item of items) store.put(item);
    });
  }
  function forEachChunked(storeName, visit, chunkSize = 5e3) {
    return getDb().then((db) => new Promise((resolve, reject) => {
      let visited = 0;
      const transaction = db.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor === null) return;
        visit(cursor.value);
        visited += 1;
        if (visited % chunkSize === 0) {
          setTimeout(() => cursor.continue(), 0);
          return;
        }
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("indexedDB forEach failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("indexedDB forEach aborted"));
    }));
  }
  function getAllSince(storeName, ts) {
    return getDb().then((db) => new Promise((resolve, reject) => {
      const request = db.transaction(storeName, "readonly").objectStore(storeName).index("ts").getAll(IDBKeyRange.lowerBound(ts));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("indexedDB getAllSince failed"));
    }));
  }
  function countStore(storeName) {
    return getDb().then((db) => new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("indexedDB count failed"));
    }));
  }
  function getMeta(key, fallback) {
    return getDb().then((db) => new Promise((resolve, reject) => {
      const transaction = db.transaction("meta", "readonly");
      const request = transaction.objectStore("meta").get(key);
      request.onsuccess = () => {
        const record = request.result;
        resolve(record ? record.value : fallback);
      };
      request.onerror = () => reject(request.error ?? new Error("indexedDB meta read failed"));
    }));
  }
  function setMeta(key, value) {
    return dbRequest("meta", "readwrite", (store) => {
      store.put({ key, value });
    });
  }
  function clearStores(names) {
    return getDb().then((db) => new Promise((resolve, reject) => {
      const transaction = db.transaction(names, "readwrite");
      for (const name of names) transaction.objectStore(name).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("indexedDB clear failed"));
    }));
  }
  function pruneStoreBefore(storeName, ts, chunk = 2e3) {
    const deleteChunk = () => getDb().then((db) => new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      const request = transaction.objectStore(storeName).index("ts").openCursor(IDBKeyRange.upperBound(ts, true));
      let deleted = 0;
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor === null || deleted >= chunk) return;
        cursor.delete();
        deleted += 1;
        cursor.continue();
      };
      transaction.oncomplete = () => resolve(deleted);
      transaction.onerror = () => reject(transaction.error ?? new Error("indexedDB prune by ts failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("indexedDB prune by ts aborted"));
    }));
    return new Promise((resolve, reject) => {
      let total = 0;
      const step = () => {
        deleteChunk().then((deleted) => {
          total += deleted;
          if (deleted >= chunk) {
            setTimeout(step, 0);
            return;
          }
          resolve(total);
        }).catch(reject);
      };
      step();
    });
  }
  function pruneStore(storeName, keepCount) {
    return getDb().then((db) => new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      let excess = 0;
      let deleted = 0;
      const countRequest = store.count();
      countRequest.onsuccess = () => {
        excess = countRequest.result - keepCount;
        if (excess <= 0) return;
        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor || deleted >= excess) return;
          cursor.delete();
          deleted += 1;
          cursor.continue();
        };
      };
      transaction.oncomplete = () => resolve(deleted);
      transaction.onerror = () => reject(transaction.error ?? new Error("indexedDB prune failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("indexedDB prune aborted"));
    }));
  }

  // src/storage/export.ts
  var EXPORT_STORES = ["raw", "messages", "decisions", "keyboards"];
  var EXPORT_CHUNK = 5e3;
  async function exportJsonl() {
    let count = 0;
    let buffer = [];
    const chunks = [];
    const flush = () => {
      if (buffer.length === 0) return;
      chunks.push(new Blob([buffer.join("\n") + "\n"]));
      buffer = [];
    };
    for (const name of EXPORT_STORES) {
      await forEachChunked(name, (item) => {
        buffer.push(JSON.stringify({ ...item, type: name }));
        count += 1;
        if (buffer.length >= EXPORT_CHUNK) flush();
      });
      flush();
    }
    const blob = new Blob(chunks, { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `stalker-export-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}.jsonl`;
    link.style.display = "none";
    document.documentElement.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
    return count;
  }

  // src/vk/location.ts
  function currentPeerFromLocation() {
    try {
      const url = new URL(location.href);
      const fromQuery = peerIdFromSel(
        url.searchParams.get("sel") ?? url.searchParams.get("peer") ?? url.searchParams.get("convo")
      );
      if (fromQuery !== null) return fromQuery;
      const path = url.pathname.match(/\/im\/convo\/([^/?#]+)/);
      return peerIdFromSel(path?.[1] ?? null);
    } catch {
      return null;
    }
  }

  // src/vk/game-chat.ts
  var HEADER_TITLE_SELECTORS = [
    ".ConvoHeader__title",
    '[class*="ConvoHeader__title"]',
    ".ConvoHeader__name"
  ];
  function chatTitleFromDomHeader() {
    for (const selector of HEADER_TITLE_SELECTORS) {
      const node = document.querySelector(selector);
      if (!node) continue;
      const text = domTextOf(node);
      if (text) return text;
    }
    return null;
  }
  function pageTitleLooksLikeGameTitle() {
    return pageTitleLooksLikeGame(document.title);
  }

  // src/vk/dom.ts
  var STRONG_MESSAGE_SELECTORS = [
    ".VirtualScrollItem[data-itemkey]",
    "[data-itemkey]",
    ".im-mess",
    "[data-msgid]",
    "[data-cmid]",
    "[data-message-id]",
    '[data-testid="message"]'
  ];
  var FALLBACK_MESSAGE_SELECTORS = [
    '[data-testid*="message"]',
    '[data-testid*="Message"]',
    '[class*="Message__content"]',
    '[class*="MessageContent"]',
    '[class*="message-content"]',
    '[class*="Message"]',
    '[class*="message"]'
  ];
  var MESSAGE_ID_QUERY = [
    "data-itemkey",
    "data-msgid",
    "data-cmid",
    "data-message-id",
    "data-conversation-message-id"
  ].map((attribute) => `[${attribute}]`).join(",") + ',[data-testid="message"]';
  var TEXT_SELECTORS = [
    ".MessageText",
    ".im-mess--text",
    '[class*="MessageText"]',
    '[class*="Message__text"]',
    '[class*="message__text"]',
    '[class*="message-text"]',
    '[class*="Text__content"]',
    '[class*="text__content"]'
  ];
  var KEYBOARD_SELECTOR = [
    ".ConvoComposer__botKeyboard",
    ".BotKeyboard--inline",
    '[class*="BotKeyboard"]',
    '[class*="Keyboard"]',
    '[class*="keyboard"]',
    '[class*="InlineKeyboard"]',
    '[class*="inline-keyboard"]',
    '[class*="ReplyKeyboard"]',
    '[class*="reply-keyboard"]',
    '[data-testid*="keyboard"]',
    '[data-testid*="Keyboard"]'
  ].join(",");
  var COMPOSER_KEYBOARD_SELECTOR = '.ConvoComposer__botKeyboard, [class*="ConvoComposer__botKeyboard"]';
  var KEYBOARD_ROW_SELECTOR = '.BotKeyboard__row, [class*="BotKeyboard__row"]';
  var KEYBOARD_BUTTON_SELECTOR = [
    ".BotKeyboard__button",
    '[class*="BotKeyboard__button"]',
    "button",
    '[role="button"]',
    'a[class*="Button"]'
  ].join(",");
  var HEADER_SELECTOR = [
    '[class*="Header"]',
    '[class*="header"]',
    '[class*="Author"]',
    '[class*="author"]',
    '[class*="Sender"]',
    '[class*="sender"]',
    ".im-mess--author"
  ].join(",");
  var REMOVE_BEFORE_TEXT_SELECTOR = [
    "button",
    '[role="button"]',
    '[class*="Keyboard"]',
    '[class*="keyboard"]',
    '[class*="Button"]',
    '[class*="button"]',
    "time",
    '[class*="Time"]',
    '[class*="time"]',
    HEADER_SELECTOR,
    '[class*="Meta"]',
    '[class*="meta"]'
  ].join(",");
  function findRenderedKeyboard(lastBotCmid = Number.POSITIVE_INFINITY) {
    const roots = [...document.querySelectorAll(".ConvoComposer__botKeyboard, .BotKeyboard")];
    let composer = null;
    for (let index = roots.length - 1; index >= 0; index -= 1) {
      const root = roots[index];
      if (!(root instanceof Element) || !isVisible(root)) continue;
      const buttons = readKeyboardRows(root);
      if (buttons.length === 0) continue;
      if (root.closest(".ConvoComposer__botKeyboard") !== null) {
        composer ??= { raw: { inline: false, one_time: false, buttons }, cmid: null, inline: false };
        continue;
      }
      const carrier = root.closest("[data-itemkey], [data-cmid], [data-conversation-message-id]");
      const cmid = carrier ? readNumberAttr(carrier, ["data-itemkey", "data-cmid", "data-conversation-message-id"]) : null;
      if (cmid !== null && cmid < lastBotCmid) continue;
      return { raw: { inline: true, one_time: false, buttons }, cmid, inline: true };
    }
    return composer;
  }
  var DomCollector = class {
    constructor(handlers) {
      this.handlers = handlers;
    }
    handlers;
    observer = null;
    timer = null;
    initialTimer = null;
    pollTimer = null;
    started = false;
    scanCount = 0;
    loggedEmpty = false;
    seen = /* @__PURE__ */ new Set();
    /** Последний известный состав клавиатуры каждого сообщения (ключ → JSON). */
    seenKeyboard = /* @__PURE__ */ new Map();
    /**
     * Элементы точных селекторов без текста и клавиатуры (служебные строки
     * разметки): сообщения ВК монтируются целиком, повторно разбирать их на
     * каждом скане не нужно.
     */
    knownEmpty = /* @__PURE__ */ new WeakSet();
    /** Кандидат на опознание по заголовку вкладки: peer и подтверждение вторым сканом. */
    titleCandidatePeer = null;
    titleCandidateConfirmed = false;
    start() {
      if (this.started) return;
      this.started = true;
      if (typeof console !== "undefined" && console.info) {
        console.info("[Stalker Assistant] DOM fallback started");
      }
      this.initialTimer = window.setTimeout(() => {
        this.initialTimer = null;
        this.scan();
      }, 2500);
      this.observer = new MutationObserver(() => this.schedule());
      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
      this.pollTimer = window.setInterval(() => this.schedule(), 3e3);
      window.addEventListener("popstate", this.onNavigate);
    }
    stop() {
      this.started = false;
      if (this.initialTimer !== null) {
        window.clearTimeout(this.initialTimer);
        this.initialTimer = null;
      }
      if (this.timer !== null) {
        window.clearTimeout(this.timer);
        this.timer = null;
      }
      if (this.pollTimer !== null) {
        window.clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
      this.observer?.disconnect();
      this.observer = null;
      window.removeEventListener("popstate", this.onNavigate);
    }
    reset() {
      this.seen.clear();
      this.seenKeyboard.clear();
      this.scanCount = 0;
      this.loggedEmpty = false;
      this.schedule();
    }
    /** Внеплановый скан (вкладку вернули на экран): DOM мог обновиться без мутаций. */
    rescan() {
      this.schedule();
    }
    onNavigate = () => {
      this.schedule();
    };
    schedule() {
      if (this.timer !== null) return;
      this.timer = window.setTimeout(() => {
        this.timer = null;
        this.scan();
      }, 350);
    }
    scan() {
      try {
        const peerId = currentPeerFromLocation();
        if (peerId === null) return;
        this.scanCount += 1;
        this.detectGameChat(peerId);
        if (this.handlers.shouldCollect && !this.handlers.shouldCollect(peerId)) return;
        const messages = [];
        for (const element of findMessageElements()) {
          const fastKey = domFastKey(element, peerId);
          if (fastKey !== null && this.seen.has(fastKey)) {
            const article = element.querySelector("article");
            const keyboard = extractKeyboard(article ?? element, true);
            const keyboardJson2 = keyboard ? JSON.stringify(keyboard) : null;
            if (keyboardJson2 === null || this.seenKeyboard.get(fastKey) === keyboardJson2) continue;
            const raw2 = messageFromElement(element, peerId);
            if (!raw2) continue;
            this.seenKeyboard.set(fastKey, keyboardJson2);
            messages.push(raw2);
            continue;
          }
          if (this.knownEmpty.has(element)) continue;
          const raw = messageFromElement(element, peerId);
          if (!raw) {
            this.knownEmpty.add(element);
            continue;
          }
          const key = domMessageKey(raw);
          const keyboardJson = raw.keyboard ? JSON.stringify(raw.keyboard) : null;
          if (this.seen.has(key)) {
            if (keyboardJson === null || this.seenKeyboard.get(key) === keyboardJson) continue;
          }
          this.seen.add(key);
          if (keyboardJson !== null) this.seenKeyboard.set(key, keyboardJson);
          messages.push(raw);
        }
        let keyboardCaptured = false;
        const composer = document.querySelector(COMPOSER_KEYBOARD_SELECTOR);
        if (composer) {
          const keyboard = extractKeyboard(composer, false);
          if (keyboard) {
            keyboardCaptured = true;
            const raw = keyboardOnlyMessage(peerId, keyboard);
            const key = domMessageKey(raw);
            if (!this.seen.has(key)) {
              this.seen.add(key);
              messages.push(raw);
            }
            this.handlers.onComposerKeyboard?.(keyboard, peerId);
          }
        }
        if (messages.length) {
          this.handlers.onMessages(messages, peerId);
          return;
        }
        if (this.scanCount >= 3 && !this.loggedEmpty && !keyboardCaptured) {
          this.loggedEmpty = true;
          if (typeof console !== "undefined" && console.info) {
            console.info("[Stalker Assistant] DOM fallback: visible message elements not found");
          }
        }
      } catch (error) {
        this.handlers.onError(error, "dom");
      }
    }
    /**
     * Опознаёт чат игры по названию. Шапка диалога — надёжный источник: нашли
     * и совпало — пиним сразу; нашли и не совпало — точно не игра. Заголовок
     * вкладки может отставать при SPA-навигации, поэтому требует подтверждения
     * на двух сканах подряд для того же чата.
     */
    detectGameChat(peerId) {
      const headerTitle = chatTitleFromDomHeader();
      if (headerTitle !== null) {
        if (isGameTitle(headerTitle)) this.handlers.onGamePeer?.(peerId);
        this.titleCandidatePeer = null;
        this.titleCandidateConfirmed = false;
        return;
      }
      if (pageTitleLooksLikeGameTitle()) {
        const samePeer = this.titleCandidatePeer === peerId;
        this.titleCandidatePeer = peerId;
        this.titleCandidateConfirmed = samePeer;
        if (this.titleCandidateConfirmed) this.handlers.onGamePeer?.(peerId);
        return;
      }
      this.titleCandidatePeer = null;
      this.titleCandidateConfirmed = false;
    }
  };
  function findMessageElements() {
    const strong = /* @__PURE__ */ new Set();
    for (const selector of STRONG_MESSAGE_SELECTORS) {
      document.querySelectorAll(selector).forEach((element) => {
        if (isPlausibleMessageElement(element)) strong.add(element);
      });
    }
    if (strong.size > 0) {
      const result = [];
      for (const element of strong) {
        if (insideIdCandidate(element, strong)) continue;
        if (!hasMessageId(element) && element.querySelector(MESSAGE_ID_QUERY) !== null) continue;
        result.push(element);
      }
      return result;
    }
    const candidates = /* @__PURE__ */ new Set();
    for (const selector of FALLBACK_MESSAGE_SELECTORS) {
      document.querySelectorAll(selector).forEach((element) => {
        if (isMessageCandidate(element)) candidates.add(element);
      });
    }
    const all = [...candidates];
    const withId = all.filter(hasMessageId);
    return all.filter((element) => {
      if (withId.some((other) => other !== element && other.contains(element))) return false;
      if (!hasMessageId(element) && withId.some((other) => other !== element && element.contains(other))) return false;
      if (withId.length === 0 && all.some((other) => other !== element && element.contains(other))) return false;
      return true;
    });
  }
  function insideIdCandidate(element, candidates) {
    let node = element.parentElement;
    while (node !== null) {
      if (candidates.has(node) && hasMessageId(node)) return true;
      node = node.parentElement;
    }
    return false;
  }
  function isPlausibleMessageElement(element) {
    if (element.closest("#stalker-assistant-host")) return false;
    if (element.closest(EXCLUDED_CONTAINER_SELECTOR)) return false;
    return isVisibleCached(element);
  }
  var EXCLUDED_CONTAINER_SELECTOR = [
    "#im_dialogs",
    ".im-page--dialogs",
    '[class*="Dialogs"]',
    '[class*="dialogs"]',
    '[class*="ConversationList"]',
    '[class*="conversation-list"]',
    '[class*="ChatsList"]',
    '[class*="chats-list"]',
    "input",
    "textarea",
    '[contenteditable="true"]',
    '[class*="Composer"]',
    '[class*="composer"]',
    '[class*="Input"]',
    '[class*="input"]'
  ].join(",");
  function isMessageCandidate(element) {
    if (element.closest("#stalker-assistant-host")) return false;
    if (element.closest(EXCLUDED_CONTAINER_SELECTOR)) return false;
    if (!isVisibleCached(element)) return false;
    const className = element.getAttribute("class") ?? "";
    const hasMessageClass = /(?:^|[\s_-])(?:im-mess|message|mess)(?:$|[\s_-])/i.test(className) || /Message(?:__|Content|Text)/i.test(className);
    if (!hasMessageClass && !hasMessageId(element)) return false;
    return domTextOf(element).length > 0;
  }
  function hasMessageId(element) {
    if (element.getAttribute("data-testid") === "message") return true;
    return [
      "data-itemkey",
      "data-msgid",
      "data-cmid",
      "data-message-id",
      "data-conversation-message-id"
    ].some((attribute) => element.hasAttribute(attribute));
  }
  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  var knownVisible = /* @__PURE__ */ new WeakSet();
  function isVisibleCached(element) {
    if (knownVisible.has(element)) return true;
    if (!isVisible(element)) return false;
    knownVisible.add(element);
    return true;
  }
  function messageFromElement(element, peerId) {
    const article = element.querySelector("article");
    const content = article ?? element;
    const textNode = article ? article.querySelector(".MessageText") : null;
    const text = article ? textNode ? domTextOf(textNode) : "" : extractText(element);
    const keyboard = extractKeyboard(content, true);
    if (!text && !keyboard) return null;
    const cmid = readNumberAttr(element, [
      "data-itemkey",
      "data-cmid",
      "data-conversation-message-id",
      "data-conversation-id"
    ]);
    const idAttr = readNumberAttr(element, ["data-msgid", "data-message-id", "data-id"]);
    const out = isOutgoing(element);
    const fromId = readNumberAttr(element, [
      "data-from-id",
      "data-from",
      "data-user-id",
      "data-sender-id"
    ]) ?? fromIdFromLinks(content) ?? (peerId < 0 && !out ? peerId : null);
    const id = cmid ?? idAttr ?? stableNumericId(`${peerId}:${out ? 1 : 0}:${fromId ?? ""}:${text}`);
    const raw = {
      id,
      peer_id: peerId,
      from_id: fromId ?? void 0,
      date: readDate(element),
      out: out ? 1 : 0,
      text
    };
    if (cmid !== null) raw.conversation_message_id = cmid;
    if (keyboard) raw.keyboard = keyboard;
    return raw;
  }
  function domMessageKey(raw) {
    return `${raw.peer_id}:${raw.conversation_message_id ?? raw.id}`;
  }
  function domFastKey(element, peerId) {
    const cmid = readNumberAttr(element, [
      "data-itemkey",
      "data-cmid",
      "data-conversation-message-id"
    ]);
    if (cmid !== null) return `${peerId}:${cmid}`;
    const idAttr = readNumberAttr(element, ["data-msgid", "data-message-id", "data-id"]);
    return idAttr !== null ? `${peerId}:${idAttr}` : null;
  }
  function keyboardOnlyMessage(peerId, keyboard) {
    return {
      id: -stableNumericId(`${peerId}:${JSON.stringify(keyboard)}`),
      peer_id: peerId,
      ...peerId < 0 ? { from_id: peerId } : {},
      date: Math.floor(Date.now() / 1e3),
      out: 0,
      text: "",
      keyboard
    };
  }
  function extractText(element) {
    for (const selector of TEXT_SELECTORS) {
      const node = element.querySelector(selector);
      const text = domTextOf(node ?? element);
      if (text) return text;
    }
    const clone = element.cloneNode(true);
    clone.querySelectorAll(REMOVE_BEFORE_TEXT_SELECTOR).forEach((node) => node.remove());
    return domTextOf(clone);
  }
  function readKeyboardRows(root) {
    const rowElements = [...root.querySelectorAll(KEYBOARD_ROW_SELECTOR)];
    if (rowElements.length > 0) {
      const rows = [];
      for (const row of rowElements) {
        const buttons = readKeyboardButtons(row);
        if (buttons.length > 0) rows.push(buttons);
      }
      return rows;
    }
    const byParent = /* @__PURE__ */ new Map();
    for (const node of root.querySelectorAll(KEYBOARD_BUTTON_SELECTOR)) {
      if (!(node instanceof HTMLElement)) continue;
      const button = describeKeyboardButton(node);
      if (!button) continue;
      const parent = node.parentElement ?? root;
      const row = byParent.get(parent) ?? [];
      row.push(button);
      byParent.set(parent, row);
    }
    return [...byParent.values()].filter((row) => row.length > 0);
  }
  function extractKeyboard(element, inline) {
    const root = inline ? element.querySelector(KEYBOARD_SELECTOR) : element;
    if (!root) return null;
    const rows = readKeyboardRows(root);
    if (rows.length === 0) return null;
    return { inline, one_time: false, buttons: rows };
  }
  function readKeyboardButtons(row) {
    const out = [];
    for (const node of row.querySelectorAll(KEYBOARD_BUTTON_SELECTOR)) {
      if (!(node instanceof HTMLElement)) continue;
      const button = describeKeyboardButton(node);
      if (button) out.push(button);
    }
    return out;
  }
  function describeKeyboardButton(node) {
    const text = domTextOf(node) || cleanDomText(node.getAttribute("title") ?? "") || cleanDomText(node.getAttribute("aria-label") ?? "");
    if (!text || /^[\u2800\s]+$/.test(text)) return null;
    const link = linkFromNode(node);
    const action = {
      type: link ? "open_link" : node.hasAttribute("aria-busy") ? "callback" : "text",
      label: text
    };
    if (link) action.link = link;
    return { action, color: keyboardButtonColor(node) };
  }
  function keyboardButtonColor(node) {
    const className = node.getAttribute("class") ?? "";
    if (className.includes("appearanceNegative")) return "negative";
    if (className.includes("appearancePositive")) return "positive";
    if (className.includes("modePrimary")) return "primary";
    return "secondary";
  }
  function linkFromNode(node) {
    if (node instanceof HTMLAnchorElement) return node.href;
    const anchor = node.querySelector("a[href]");
    return anchor ? anchor.href : null;
  }
  function isOutgoing(element) {
    const attr = element.getAttribute("data-out");
    if (attr === "1" || attr === "true") return true;
    if (attr === "0" || attr === "false") return false;
    if (element.closest(".ConvoStack--out")) return true;
    let current = element;
    for (let depth = 0; depth < 4 && current; depth += 1) {
      const byClass = outgoingFromClass(current.getAttribute("class") ?? "");
      if (byClass !== null) return byClass;
      const byTestId = outgoingFromClass(current.getAttribute("data-testid") ?? "");
      if (byTestId !== null) return byTestId;
      current = current.parentElement;
    }
    return false;
  }
  function fromIdFromLinks(element) {
    const scope = element.querySelector(HEADER_SELECTOR);
    if (!scope) return null;
    for (const link of scope.querySelectorAll("a[href]")) {
      const id = parseVkEntityId(link.getAttribute("href") ?? "");
      if (id !== null) return id;
    }
    return null;
  }
  function readNumberAttr(element, names) {
    for (const name of names) {
      const value = asNumber(element.getAttribute(name));
      if (value !== null) return value;
    }
    return null;
  }
  function readDate(element) {
    for (const name of ["data-ts", "data-timestamp", "data-date"]) {
      const value = element.getAttribute(name);
      if (!value) continue;
      const numeric = asNumber(value);
      if (numeric !== null) return numeric > 1e12 ? Math.floor(numeric / 1e3) : Math.floor(numeric);
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return Math.floor(parsed / 1e3);
    }
    const time = element.querySelector("time[datetime]");
    const datetime = time?.getAttribute("datetime");
    if (datetime) {
      const parsed = Date.parse(datetime);
      if (Number.isFinite(parsed)) return Math.floor(parsed / 1e3);
    }
    return Math.floor(Date.now() / 1e3);
  }

  // src/vk/user.ts
  function currentUserId() {
    const candidate = window;
    const values = [candidate.vk?.id, candidate.__VK__?.userId, candidate.__VK__?.user_id];
    for (const value of values) {
      const id = asNumber(value);
      if (id !== null) return id;
    }
    const meta = document.querySelector('meta[name="vk:user_id"]');
    return meta ? asNumber(meta.getAttribute("content")) : null;
  }

  // src/vk/click.ts
  var KEYBOARD_ROOT_SELECTORS = [
    ".ConvoComposer__botKeyboard",
    ".ConvoHistory__flow .BotKeyboard--inline",
    ".BotKeyboard"
  ];
  var BUTTON_SELECTOR = [
    ".BotKeyboard__button",
    "button",
    '[role="button"]'
  ].join(", ");
  function readKeyboardButtonColor(node) {
    const className = node.getAttribute("class") ?? "";
    if (className.includes("appearanceNegative")) return "negative";
    if (className.includes("appearancePositive")) return "positive";
    if (className.includes("modePrimary")) return "primary";
    return "secondary";
  }
  function comparable2(value) {
    return cleanDomText(value.replace(/^Загружается(?:\.\.\.|…)\s*/u, "")).toLowerCase();
  }
  function textWithoutSymbols(value) {
    return comparable2(value).replace(/^[^\p{L}\p{N}]+/u, "");
  }
  function renderedKeyboardRoots() {
    const roots = /* @__PURE__ */ new Set();
    document.querySelectorAll(KEYBOARD_ROOT_SELECTORS.join(",")).forEach((root) => roots.add(root));
    const outermost = [...roots].filter((root) => ![...roots].some((other) => other !== root && other.contains(root)));
    return outermost.reverse();
  }
  function renderedButtons() {
    const nodes = [];
    for (const root of renderedKeyboardRoots()) {
      for (const node of root.querySelectorAll(BUTTON_SELECTOR)) {
        nodes.push(node);
      }
    }
    return nodes;
  }
  function buttonLabel(node) {
    return domTextOf(node) || cleanDomText(node.getAttribute("title") ?? "") || cleanDomText(node.getAttribute("aria-label") ?? "");
  }
  function clickNode(node) {
    const clickTarget = node.querySelector("button") ?? node;
    clickTarget.scrollIntoView({ block: "nearest" });
    const pointerInit = { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: "mouse" };
    clickTarget.dispatchEvent(new PointerEvent("pointerdown", pointerInit));
    clickTarget.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    clickTarget.dispatchEvent(new PointerEvent("pointerup", pointerInit));
    clickTarget.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    clickTarget.click();
  }
  function clickKeyboardButton(buttonText, color) {
    const target = comparable2(buttonText);
    if (!target) return { clicked: false, found: 0 };
    const buttons = renderedButtons();
    for (const node of buttons) {
      if (comparable2(buttonLabel(node)) !== target) continue;
      if (color !== null && color !== void 0 && readKeyboardButtonColor(node) !== color) continue;
      clickNode(node);
      return { clicked: true, found: 1, mode: "exact" };
    }
    const partial = buttons.map((node) => ({ node, label: comparable2(buttonLabel(node)) })).filter(({ label, node }) => label.length >= 1 && label.length <= 3 && target.startsWith(label) && (color === null || color === void 0 || readKeyboardButtonColor(node) === color));
    if (partial.length === 0) return { clicked: false, found: 0 };
    const firstLabel = partial[0]?.label ?? "";
    if (!partial.every(({ label }) => label === firstLabel)) {
      return { clicked: false, found: partial.length };
    }
    clickNode(partial[0]?.node);
    return { clicked: true, found: partial.length, mode: "prefix", matchedText: firstLabel };
  }
  function clickFirstUnlabeledButton() {
    const roots = renderedKeyboardRoots();
    const freshest = roots[0];
    if (!freshest) return false;
    const kbButtons = [...freshest.querySelectorAll(BUTTON_SELECTOR)];
    const unlabeled = kbButtons.filter((node) => comparable2(buttonLabel(node)) === "");
    if (unlabeled.length !== 1) return false;
    const target = unlabeled[0];
    if (!target || kbButtons.indexOf(target) !== 0) return false;
    clickNode(target);
    return true;
  }
  function isAnyButtonRendered(buttonTexts) {
    const targets = new Set(buttonTexts.map((text) => comparable2(text)).filter((text) => text.length > 0));
    if (targets.size === 0) return false;
    return renderedButtons().some((node) => targets.has(comparable2(buttonLabel(node))));
  }
  function hasStuckLoadingButton() {
    return renderedButtons().some((node) => comparable2(buttonLabel(node)) === "");
  }
  function cycleComposerKeyboard() {
    if (document.querySelector(".ConvoComposer__botKeyboard") === null) return false;
    const toggle = findKeyboardToggle();
    if (toggle === null) return false;
    clickNode(toggle);
    window.setTimeout(() => {
      const toggle2 = findKeyboardToggle();
      if (toggle2 !== null) clickNode(toggle2);
    }, 350);
    return true;
  }
  function findKeyboardToggle() {
    const scope = document.querySelector(".ConvoComposer") ?? document;
    const byClass = scope.querySelector('[class*="botKeyboardButton"]') ?? scope.querySelector('[class*="keyboardToggle" i]') ?? scope.querySelector('[class*="KeyboardToggle"]');
    if (byClass !== null) return byClass;
    for (const node of scope.querySelectorAll('button, [role="button"]')) {
      const marker = `${node.getAttribute("aria-label") ?? ""} ${node.getAttribute("title") ?? ""}`.toLowerCase();
      if (/сверн|скрыть|разверн|клавиатур|keyboard/.test(marker)) return node;
    }
    return null;
  }
  function expandCollapsedActions() {
    for (const node of renderedButtons()) {
      if (textWithoutSymbols(buttonLabel(node)) !== "\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F") continue;
      clickNode(node);
      return true;
    }
    return false;
  }
  function expandComposerKeyboard() {
    if (document.querySelector(".ConvoComposer__botKeyboard") !== null) return false;
    const scope = document.querySelector(".ConvoComposer") ?? document;
    const toggle = scope.querySelector('[class*="botKeyboardButton"]');
    if (toggle === null) return false;
    clickNode(toggle);
    return true;
  }
  function findRenderedContinueButton() {
    for (const node of renderedButtons()) {
      const label = buttonLabel(node);
      if (!isContinueButtonText(label)) continue;
      return trimLoadingPrefix(cleanDomText(label));
    }
    return null;
  }
  function findRenderedRotationButton(rotation) {
    const wanted = rotation.map((name) => comparable2(name)).filter((name) => name.length > 0);
    if (wanted.length === 0) return null;
    for (const name of wanted) {
      for (const node of renderedButtons()) {
        const label = comparable2(buttonLabel(node));
        if (!label) continue;
        if (label === name || label.includes(name)) {
          return trimLoadingPrefix(cleanDomText(buttonLabel(node)));
        }
      }
    }
    return null;
  }
  var SEND_PRESS_DELAY_MS = 120;
  function sendChatMessage(text) {
    if (!text.trim()) return false;
    const input = document.querySelector('.ConvoComposer [contenteditable="true"]') ?? document.querySelector('[contenteditable="true"]');
    if (input === null) return false;
    input.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(input);
    selection?.removeAllRanges();
    selection?.addRange(range);
    let typed = false;
    try {
      typed = document.execCommand("insertText", false, text);
    } catch {
      typed = false;
    }
    if (!typed) {
      input.textContent = text;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
    }
    window.setTimeout(() => {
      const composer = input.closest(".ConvoComposer") ?? document;
      const sendButton = composer.querySelector('[class*="sendButton"], [aria-label="\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C"]');
      if (sendButton !== null) {
        clickNode(sendButton);
        return;
      }
      const enterInit = {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
        keyCode: 13,
        which: 13
      };
      input.dispatchEvent(new KeyboardEvent("keydown", enterInit));
      input.dispatchEvent(new KeyboardEvent("keypress", enterInit));
      input.dispatchEvent(new KeyboardEvent("keyup", enterInit));
    }, SEND_PRESS_DELAY_MS);
    return true;
  }

  // src/vk/scroll.ts
  var FLOW_SELECTORS = [".ConvoHistory__flow", "[data-itemkey]", ".im-mess"];
  var BOTTOM_EPSILON_PX = 80;
  function findUnreadHopButton() {
    const candidates = document.querySelectorAll(
      '[class*="historyUnreadWrapper"] button, [class*="HopNavigationButton"]'
    );
    for (const node of candidates) {
      const target = node.closest('button, [role="button"]') ?? node;
      const rect = target.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return target;
    }
    return null;
  }
  function scrollChatToBottom() {
    const unreadButton = findUnreadHopButton();
    if (unreadButton !== null) {
      clickNode(unreadButton);
      return "unread-button";
    }
    let flow = null;
    for (const selector of FLOW_SELECTORS) {
      flow = document.querySelector(selector);
      if (flow) break;
    }
    if (!flow) return null;
    let node = flow.parentElement;
    while (node && node !== document.body) {
      if (node.scrollHeight > node.clientHeight + 4) {
        const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
        if (distanceFromBottom < BOTTOM_EPSILON_PX) return null;
        node.scrollTop = node.scrollHeight;
        wheelDown(node);
        return "scroll";
      }
      node = node.parentElement;
    }
    wheelDown(flow);
    return "wheel";
  }
  function wheelDown(target) {
    for (let step = 0; step < 3; step += 1) {
      target.dispatchEvent(new WheelEvent("wheel", {
        deltaY: 600,
        bubbles: true,
        cancelable: true
      }));
    }
  }

  // src/core/garden.ts
  var GARDEN_SELL_COMMAND = "\u041F\u0440\u043E\u0434\u0430\u0442\u044C \u0432\u0441\u044E \u0440\u044B\u0431\u0443";
  var GARDEN_RE = /🗑\s*Садок:\s*(\d+)\s*\/\s*(\d+)/u;
  function isGardenSoldText(text) {
    return /Садок продан/u.test(text);
  }
  function parseGardenSlots(text) {
    const match = GARDEN_RE.exec(text);
    if (!match) return null;
    const current = Number(match[1]);
    const limit = Number(match[2]);
    if (!Number.isFinite(current) || !Number.isFinite(limit) || limit <= 0) return null;
    return { current, limit };
  }
  function isGardenFull(slots) {
    return slots !== null && slots.current >= slots.limit;
  }

  // src/core/apiclient.ts
  function asString2(value) {
    return typeof value === "string" && value.length > 0 ? value : null;
  }
  function harvestApiTemplate(prev, input) {
    let origin = prev?.origin ?? null;
    let version = prev?.version ?? null;
    let clientId = prev?.clientId ?? null;
    if (typeof input.url === "string" && input.url.includes("/method/")) {
      try {
        const parsed = new URL(input.url);
        const v = asString2(parsed.searchParams.get("v"));
        const id = asString2(parsed.searchParams.get("client_id"));
        if (v !== null) {
          origin = parsed.origin;
          version = v;
          clientId = id ?? clientId;
        }
      } catch {
      }
    }
    const params = input.request !== null && typeof input.request === "object" ? input.request : null;
    const token = params !== null ? asString2(params.access_token) : null;
    if (origin === null || version === null) return prev;
    return {
      origin,
      version,
      clientId: clientId ?? "",
      token: token ?? prev?.token ?? "",
      tokenAt: token !== null ? input.now : prev?.tokenAt ?? input.now
    };
  }
  function buildMethodUrl(template, method) {
    const query = template.version + (template.clientId ? `&client_id=${template.clientId}` : "");
    return `${template.origin}/method/${method}?v=${query}`;
  }
  function buildHistoryParams(template, peerId, count) {
    return {
      peer_id: String(peerId),
      offset: "0",
      count: String(count),
      extended: "0",
      access_token: template.token
    };
  }
  function reverseHistoryItems(response) {
    const wrap = response;
    const items = wrap?.response?.items;
    if (!Array.isArray(items) || items.length < 2) return response;
    return {
      ...response,
      response: { ...wrap.response, items: [...items].reverse() }
    };
  }
  function apiErrorSummary(json) {
    const error = json?.error;
    if (!error) return null;
    const code = typeof error.error_code === "number" ? error.error_code : null;
    const msg = typeof error.error_msg === "string" ? error.error_msg.slice(0, 120) : null;
    if (code === null && msg === null) return "unknown";
    return code === null ? msg : msg === null ? `code ${code}` : `code ${code}: ${msg}`;
  }

  // src/vk/apiclient.ts
  async function callVkApi(url, params) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params).toString()
      });
      const json = await response.json();
      const error = apiErrorSummary(json);
      return { ok: response.ok && error === null, json, error };
    } catch (e) {
      return { ok: false, json: null, error: e instanceof Error ? e.message.slice(0, 120) : "network" };
    }
  }
  function fetchHistoryTail(template, peerId, count) {
    return callVkApi(
      buildMethodUrl(template, "messages.getHistory"),
      buildHistoryParams(template, peerId, count)
    );
  }

  // src/runtime.ts
  function slimRawResponse(source, response) {
    if (source !== "self-poll") return response;
    const inner = response?.response;
    const items = Array.isArray(inner?.items) ? inner.items : [];
    return {
      response: {
        count: inner?.count ?? null,
        items: items.slice(0, 2).map((item) => {
          if (typeof item !== "object" || item === null) return item;
          const clone = { ...item };
          if (typeof clone.text === "string") clone.text = clone.text.slice(0, 200);
          delete clone.keyboard;
          return clone;
        })
      }
    };
  }
  var COMPOSER_SYNC_SUPPRESS_MS = 5e3;
  var SUBMENU_SYNC_SUPPRESS_MS = 1500;
  var KEYBOARD_LIVENESS_INTERVAL_MS = 1e4;
  var ANOMALY_STUCK_SILENCE_MS = 6e4;
  var CAPTCHA_SCAN_INTERVAL_MS = 3e3;
  var CAPTCHA_PAUSE_AFTER_SEEN_MS = 3e4;
  var CAPTCHA_MAX_EPISODE_MS = 6e5;
  var REST_COMPLETE_PERCENT = 95;
  var REST_SESSION_TIMEOUT_MS = 6e5;
  var STALE_STATE_RESET_MS = 18e4;
  var AUTO_SCROLL_TICK_MS = 5e3;
  var AUTO_SCROLL_IDLE_TICKS = 12;
  var FISHING_WINDOW_MS = 12e4;
  var SELF_POLL_AUTO_MS = 2e3;
  var SELF_POLL_ADVICE_MS = 5e3;
  var SELF_POLL_COUNT = 12;
  var KEYBOARD_EXPAND_MIN_INTERVAL_MS = 3e4;
  var KEYBOARD_RELOAD_MIN_INTERVAL_MS = 15e3;
  var GARDEN_SELL_RETRY_MS = 6e4;
  var FORK_RULE_REFRESH_MS = 3e4;
  var RAW_KEEP_ON_QUOTA = 5e3;
  var LOG_AUTO_DEDUPE_MS = 1500;
  var PENDING_WRITES_CAP = 3e3;
  var MESSAGE_KEEP_ON_QUOTA = 8e3;
  var RAW_RECOVERY_WATCHDOG_MS = 15e3;
  var PAGE_RELOAD_GRACE_MS = 3e4;
  var PAGE_RELOAD_LOOP_WINDOW_MS = 30 * 6e4;
  var PAGE_RELOAD_LOOP_LIMIT = 3;
  var PAGE_RELOAD_LOG_KEY = "stalkerPageReloadLog";
  var DIAG_BUFFER_KEY = "stalkerDiagBuffer";
  var DIAG_BUFFER_CAP = 200;
  var SEEN_KEYS_CAP = 12e3;
  var USER_ACTIVITY_WINDOW_MS = 4e3;
  var OTHER_TAB_AUTO_WINDOW_MS = 15e3;
  var UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1e3;
  var LOG_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1e3;
  var RAW_RETENTION_MS = 7 * 24 * 60 * 60 * 1e3;
  var DATA_RETENTION_MS = 14 * 24 * 60 * 60 * 1e3;
  var WRITE_FLUSH_MS = 400;
  var COUNT_REFRESH_MS = 5e3;
  var BATTLE_KEYBOARDS_KEEP = 200;
  var INIT_MESSAGES_WINDOW_MS = 7 * 24 * 60 * 60 * 1e3;
  var INIT_DECISIONS_WINDOW_MS = 48 * 60 * 60 * 1e3;
  var INIT_KEYBOARDS_WINDOW_MS = 48 * 60 * 60 * 1e3;
  var PENDING_EVENTS_LIMIT = 200;
  var RECOVERY_TTL_MS = 3 * 60 * 1e3;
  var DEFAULT_ANOMALY_TYPES = ["\u0422\u0440\u0430\u043C\u043F\u043B\u0438\u043D", "\u041A\u0430\u0440\u0443\u0441\u0435\u043B\u044C", "\u0413\u0430\u0437\u0438\u0440\u043E\u0432\u043A\u0430"];
  var Runtime = class _Runtime {
    state = {
      recording: true,
      mode: "observe",
      currentPeerId: null,
      gamePeerIds: [],
      isGameChat: false,
      otherTabAutoUntil: 0,
      counts: { messages: 0, decisions: 0, keyboards: 0, raw: 0 },
      errors: [],
      lastKeyboard: /* @__PURE__ */ new Map(),
      advice: null,
      battleRotation: [],
      battleAutoExpand: true,
      battleCandidates: [],
      pendingChoice: null,
      autoPlan: null,
      autoRepeatPauseUntil: 0,
      captchaPausedUntil: 0,
      blindFishing: false,
      autoDelays: { ...DEFAULT_AUTO_DELAYS },
      autoClicks: 0,
      autoReset: true,
      manualTakeover: true,
      manualPaused: false,
      gardenAutoSell: false,
      anomalyHpGuard: false,
      restGuard: false,
      restHpPercent: 60,
      gardenSlots: null,
      forkRules: [],
      eventRules: { ...DEFAULT_EVENT_RULES },
      anomalyTypeRules: { rules: {}, known: [...DEFAULT_ANOMALY_TYPES] },
      updateAvailable: null,
      pageReloadScheduledAt: 0,
      pageReloadSuspendedUntil: 0
    };
    panel = null;
    rawSeq = 0;
    sendSeq = 0;
    currentUserId = null;
    messageSignatures = /* @__PURE__ */ new Set();
    /** Состав клавиатуры каждого сообщения по ключу — чтобы пропускать обновления DOM. */
    messageKeyboards = /* @__PURE__ */ new Map();
    keyboardTimestamps = /* @__PURE__ */ new Map();
    /**
     * Первое появление каждой клавиатуры (ключ сообщения → ts). Повторный захват
     * (перезагрузка страницы, перерисовка ВК) не должен обновлять таймер
     * 12-секундного задания: мёртвая клавиатура «воскресала» свежей, и бот
     * вечно кликал неработающие кнопки (шторм ретраев в реальных логах).
     */
    keyboardFirstSeen = /* @__PURE__ */ new Map();
    /**
     * Кэш записей клавиатур по пир-у — relink без перечитывания базы на каждый
     * батч. Каждый бакет держится отсортированным по ts (пересортировка лениво,
     * только «грязных» пиров перед relink): окно кандидатов для решения берётся
     * бинарным поиском (keyboardWindow), а не полным filter+sort по всем записям.
     */
    keyboardBuckets = /* @__PURE__ */ new Map();
    /** Пиры, в чьи бакеты добавились записи с последней пересортировки. */
    keyboardBucketsDirty = /* @__PURE__ */ new Set();
    /** Кэш решений по ключу — то же. */
    decisionsByKey = /* @__PURE__ */ new Map();
    /** Троттлинг сообщений о сбоях записи в базу (квота и т.п.). */
    lastStorageErrorAt = 0;
    /** Троттлинг лога advice-expired: опрос ВК доставляет протухшее задание снова каждые ~5 с. */
    lastExpiredLogAt = 0;
    /** Троттлинг лога color-parse-miss: задание висит в карте, тик пересчитывает совет часто. */
    lastColorMissLogAt = 0;
    /** Перемонтажи клавиатуры при молчании игры в поле аномалии (сброс — свежее сообщение). */
    anomalyStuckCycles = /* @__PURE__ */ new Map();
    /** Троттлинг панельного предупреждения «игра не отвечает — обнови страницу». */
    lastAnomalyStuckNoteAt = 0;
    /** Подпись и время последнего авто-события (дедуп одинаковых соседних логов). */
    lastAutoLogSig = "";
    lastAutoLogAt = 0;
    /** Идёт восстановление raw после ошибки квоты (подрезка+повтор) — один за раз. */
    rawRecoveryInFlight = false;
    rawRecoveryStartedAt = 0;
    /**
     * Адаптивный предел подрезки при квоте: подрезка «до 5000» при сторе ровно
     * 5000 записей не удаляет НИЧЕГО (excess = 0) — байты остаются сверх квоты,
     * каждая запись продолжает падать (сессия 09-10.11: raw замер на ровно
     * 5000, входящие тексты перестали писаться). При повторных неудачах предел
     * уменьшается вдвое (до минимума), при успехе — возвращается к дефолту.
     */
    rawQuotaKeep = RAW_KEEP_ON_QUOTA;
    messageQuotaKeep = MESSAGE_KEEP_ON_QUOTA;
    /** Троттлинг лога write-failed: раз в 30 с на стор. */
    lastWriteFailLogAt = /* @__PURE__ */ new Map();
    /** Калбэки потери батчей записей: снимают дедуп-ключи, чтобы доставка повторилась. */
    pendingDropCallbacks = /* @__PURE__ */ new Map();
    /** Ключи уже обработанных входящих сообщений: дедуп повторных сетевых доставок. */
    seenIncomingKeys = /* @__PURE__ */ new Set();
    /** Тик проверки обновления (раз в секунду, сама проверка раз в 30 мин). */
    updateCheckTick = 0;
    lastUpdateCheckAt = 0;
    /** Последняя активность ИГРЫ: свежее сообщение или смена клавиатуры. */
    lastGameActivityAt = Date.now();
    /** Причина запланированной перезагрузки (для заметки панели и маркера). */
    pageReloadSilentMs = 0;
    /** До этого момента авто приостановлен капчей ВК (30 с после последнего ВИДИМОГО следа). */
    captchaActiveUntil = 0;
    /** Когда начался текущий эпизод капчи (страховка от вечного невидимого контейнера). */
    captchaEpisodeStartedAt = 0;
    /** Троттлинг лога captcha-pause: один лог на эпизод капчи. */
    captchaLoggedAt = 0;
    captchaScanTimer = null;
    /** Последний известный HP игрока в %, по чатам (для отдыха и стража). */
    lastHpPercent = /* @__PURE__ */ new Map();
    /** Фазы отдыха по чатам: fire (костёр) → rest (отдохнуть) → return (зона). */
    restPhaseByPeer = /* @__PURE__ */ new Map();
    /** Когда началась текущая сессия отдыха (таймаут зависания). */
    restStartedAtByPeer = /* @__PURE__ */ new Map();
    /** Рыбалка идёт (свежие сообщения про наживку/садок/поплавок) до этого момента. */
    fishingUntil = 0;
    /** Когда последний раз автоскролл реально прокрутил чат (задание могло висеть невидимым). */
    lastAutoScrollAt = 0;
    /** Шаблон API ВК (origin/v/client_id/токен/поля клика), собираемый из трафика страницы. */
    apiTemplate = null;
    /** Таймер цикла собственного опроса истории (сетевой захват). */
    selfPollTimer = null;
    /** Опрос в полёте: не плодим параллельные запросы. */
    selfPollInFlight = false;
    lastSelfPollAt = 0;
    lastBotText = /* @__PURE__ */ new Map();
    lastInlineKeyboard = /* @__PURE__ */ new Map();
    lastComposerKeyboard = /* @__PURE__ */ new Map();
    lastBotMessageTs = /* @__PURE__ */ new Map();
    lastBotCmid = /* @__PURE__ */ new Map();
    battleKeyboards = [];
    /** Состояние навигатора поля аномалии по каждому чату. */
    anomalyStates = /* @__PURE__ */ new Map();
    /**
     * Из аномалии пора выходить (страж HP): флаг по чатам, живёт до «Вы вышли
     * из аномалии» / входа в новое поле. После подбора артефакта флаг больше
     * НЕ ставится — артефактов в поле несколько, охота продолжается, пока
     * жив сигнал.
     */
    anomalyExitByPeer = /* @__PURE__ */ new Map();
    /**
     * «Доп. лимит (N)» текущего поля по чатам (с экрана входа): 0 — ценного
     * артефакта в поле нет, на экране входа советуем «Уйти».
     */
    anomalyBonusLimitByPeer = /* @__PURE__ */ new Map();
    /** Вертолёт: до этого момента действует окно «обыск идёт» (ждём/не мешаем). */
    helicopterUntilByPeer = /* @__PURE__ */ new Map();
    /** Схрон: до этого момента действует окно «обыск идёт» (ждём или прерываем). */
    cacheUntilByPeer = /* @__PURE__ */ new Map();
    /** Состояние боя по каждому чату (враг, HP, концентрация, урон навыков). */
    battleStates = /* @__PURE__ */ new Map();
    /** Заполненность садка по каждому чату («🗑 Садок: N/M» из сообщений улова). */
    gardenSlotsByPeer = /* @__PURE__ */ new Map();
    /** Когда отправляли «Продать всю рыбу» в последний раз (защита от шторма). */
    gardenSellAt = 0;
    manualChoice = null;
    lastAutoClickAt = 0;
    /** Окно подавления композер-синка после последнего автоклика (короче после «➕ Действия»). */
    composerSyncSuppressMs = COMPOSER_SYNC_SUPPRESS_MS;
    autoTimer = null;
    plannedAction = null;
    retryCount = 0;
    /** Таймер периодической проверки живости актуальной клавиатуры. */
    livenessTimer = null;
    pruneTimer = null;
    peerTrackingStarted = false;
    /** Последнее РЕАЛЬНОЕ (trusted) действие игрока на странице — см. noteUserActivity. */
    lastUserActivityAt = 0;
    lastOtherTabAutoAt = 0;
    tabChannel = null;
    tabHeartbeatTick = 0;
    /** Таймер притягивания чата к низу в авто-режиме (задания видны только в DOM). */
    scrollTimer = null;
    /** Сколько раз подряд боевая клавиатура не найдена в DOM (эвикция со второго промаха). */
    battleLivenessMisses = /* @__PURE__ */ new Map();
    /** Когда в последний раз был прогресс: захват клавиатуры или успешный клик. */
    lastProgressAt = Date.now();
    /** Когда в последний раз пытались развернуть свёрнутую клавиатуру бота. */
    lastKeyboardExpandAt = 0;
    lastKeyboardReloadAt = 0;
    /** Восстановление после нокаута: peer → время события («Сокрушительный удар…»). */
    recoveryByPeer = /* @__PURE__ */ new Map();
    /** До этого момента авто молчит: игрок сделал ручное действие. */
    manualTakeoverUntil = 0;
    /** Последний успешный автоклик: кнопка и время — для распознавания ручных действий. */
    lastAutoClickButton = null;
    lastAutoClickSuccessAt = 0;
    /** Время последнего успешного клика по кнопке (текст) — кулдаун повторов. */
    autoClickAtByButton = /* @__PURE__ */ new Map();
    /**
     * Серия одинаковых автокликов подряд без ответа игры (сообщение бота или
     * смена клавиатуры сбрасывают). Мёртвая серия — пауза авто (repeat-pause):
     * в реальном логе 03.11 бот 15 минут жал «Закинуть ещё» (93 клика).
     */
    clickStreak = null;
    /** Троттлинг диагностики скрытой вкладки. */
    lastHiddenLogAt = 0;
    /** Троттлинг диагностики «бой ждёт кнопки». */
    lastBattleWaitLogAt = 0;
    /** Буфер записей в IndexedDB (см. WRITE_FLUSH_MS): стор → накопленные записи. */
    pendingWrites = /* @__PURE__ */ new Map();
    writeTimer = null;
    /** Счётчики панели грязные — пересчитать не позже следующего тика. */
    countsDirty = false;
    countsTimer = null;
    /** Вызывается при мягком сбросе состояния (main.ts: пересканировать DOM). */
    onStateReset = null;
    /**
     * init завершён (meta прочитана, кэши собраны). Перехватчики активны с
     * document-start — события до этого момента копятся в буфер и обрабатываются
     * после: иначе фильтр «чат игры не опознан» молча терял первые ответы ВК.
     */
    initDone = false;
    pendingApi = [];
    pendingLongPoll = [];
    async init() {
      this.currentUserId = currentUserId();
      this.state.recording = sanitizeBoolean(await getMeta("recording", true), true);
      this.state.mode = sanitizeMode(await getMeta("mode", "observe"));
      this.state.battleRotation = migrateBattleRotation(await getMeta("battleRotation", []));
      if (!await getMeta("battleRotationSeeded", false)) {
        const has = (needle) => this.state.battleRotation.some((item) => item.button.toLowerCase() === needle);
        const prepend = [];
        if (!has("\u043A\u043E\u043D\u0446\u0435\u043D\u0442\u0440\u0430\u0446\u0438\u044F")) {
          prepend.push({ button: "\u041A\u043E\u043D\u0446\u0435\u043D\u0442\u0440\u0430\u0446\u0438\u044F", hpBelow: 60, groupOnly: false, oncePerBattle: false, onKill: false, notFullHp: false, disabled: false });
        }
        if (!has("\u044D\u043F\u043E\u0441")) {
          prepend.push({ button: "\u042D\u043F\u043E\u0441", hpBelow: null, groupOnly: true, oncePerBattle: true, onKill: false, notFullHp: false, disabled: false });
        }
        try {
          if (prepend.length > 0) {
            this.state.battleRotation = [...prepend, ...this.state.battleRotation];
            await setMeta("battleRotation", this.state.battleRotation);
          }
          await setMeta("battleRotationSeeded", true);
        } catch (error) {
          this.noteStorageError(error, "battleRotation (\u0441\u0438\u0434)");
        }
      }
      if (!await getMeta("battleHarvestRuleSeeded", false)) {
        if (!this.state.battleRotation.some((item) => item.button.toLowerCase() === "\u0436\u0430\u0442\u0432\u0430")) {
          this.state.battleRotation = [{
            button: "\u0416\u0430\u0442\u0432\u0430",
            hpBelow: null,
            groupOnly: false,
            oncePerBattle: false,
            onKill: true,
            notFullHp: false,
            disabled: false
          }, ...this.state.battleRotation];
          try {
            await setMeta("battleRotation", this.state.battleRotation);
          } catch (error) {
            this.noteStorageError(error, "battleRotation (\u0441\u0438\u0434 \u0416\u0430\u0442\u0432\u044B)");
          }
        }
        try {
          await setMeta("battleHarvestRuleSeeded", true);
        } catch (error) {
          this.noteStorageError(error, "battleHarvestRuleSeeded");
        }
      }
      this.state.battleAutoExpand = sanitizeBoolean(await getMeta("battleAutoExpand", true), true);
      this.state.gardenAutoSell = sanitizeBoolean(await getMeta("gardenAutoSell", false), false);
      this.state.anomalyHpGuard = sanitizeBoolean(await getMeta("anomalyHpGuard", false), false);
      this.state.restGuard = sanitizeBoolean(await getMeta("restHpGuard", false), false);
      const storedRestPercent = await getMeta("restHpPercent", 60);
      this.state.restHpPercent = typeof storedRestPercent === "number" && Number.isFinite(storedRestPercent) ? Math.max(5, Math.min(95, Math.round(storedRestPercent))) : 60;
      this.state.autoDelays = { ...DEFAULT_AUTO_DELAYS, ...sanitizeAutoDelays(await getMeta("autoDelays", {})) };
      if (!await getMeta("anomalyDelayBumped", false)) {
        if (this.state.autoDelays.anomaly === 1200) {
          this.state.autoDelays = { ...this.state.autoDelays, anomaly: 2200 };
          try {
            await setMeta("autoDelays", this.state.autoDelays);
          } catch (error) {
            this.noteStorageError(error, "autoDelays (\u043F\u043E\u0434\u044A\u0451\u043C \u0430\u043D\u043E\u043C\u0430\u043B\u0438\u0438)");
          }
        }
        try {
          await setMeta("anomalyDelayBumped", true);
        } catch {
        }
      }
      this.state.autoReset = sanitizeBoolean(await getMeta("autoReset", true), true);
      this.state.manualTakeover = sanitizeBoolean(await getMeta("manualTakeover", true), true);
      this.state.forkRules = sanitizeForkRules(await getMeta("forkRules", []));
      this.state.eventRules = sanitizeEventRules(await getMeta("eventRules", DEFAULT_EVENT_RULES));
      const storedTypes = sanitizeAnomalyTypeRules(await getMeta("anomalyTypeRules", null));
      this.state.anomalyTypeRules = {
        rules: storedTypes.rules,
        known: [.../* @__PURE__ */ new Set([...DEFAULT_ANOMALY_TYPES, ...storedTypes.known])]
      };
      this.state.gamePeerIds = sanitizeGamePeerIds(await getMeta("gamePeerIds", []));
      const usefulRules = this.state.forkRules.filter((rule) => !isNavigationForkRule(rule));
      if (usefulRules.length !== this.state.forkRules.length) {
        this.state.forkRules = usefulRules;
        await setMeta("forkRules", usefulRules);
      }
      const mergedForkRules = mergeDuplicateForkRules(this.state.forkRules);
      if (mergedForkRules.length !== this.state.forkRules.length) {
        this.state.forkRules = mergedForkRules;
        try {
          await setMeta("forkRules", mergedForkRules);
        } catch (error) {
          this.noteStorageError(error, "forkRules (\u0441\u043A\u043B\u0435\u0439\u043A\u0430 \u0434\u0443\u0431\u043B\u0435\u0439)");
        }
      }
      const loadSince = Date.now();
      const [existingMessages, existingKeyboards, existingDecisions] = await Promise.all([
        getAllSince("messages", loadSince - INIT_MESSAGES_WINDOW_MS),
        getAllSince("keyboards", loadSince - INIT_KEYBOARDS_WINDOW_MS),
        getAllSince("decisions", loadSince - INIT_DECISIONS_WINDOW_MS)
      ]);
      this.messageSignatures = new Set(existingMessages.map(messageSignature));
      for (const message of existingMessages) {
        if (message.keyboard) this.messageKeyboards.set(message.key, keyboardFingerprint(message.keyboard));
      }
      this.keyboardTimestamps = new Map(existingKeyboards.map((record) => [record.key, record.ts]));
      for (const record of existingKeyboards) {
        const bucket = this.keyboardBuckets.get(record.peerId) ?? [];
        bucket.push(record);
        this.keyboardBuckets.set(record.peerId, bucket);
        this.keyboardBucketsDirty.add(record.peerId);
      }
      this.keyboardFirstSeen = new Map(existingKeyboards.map((record) => [record.key, record.ts]));
      for (const decision of existingDecisions) this.decisionsByKey.set(decision.key, decision);
      const anomalyEntries = [];
      let anomalyPeer = null;
      for (const message of existingMessages) {
        if (!message.text || !this.isGamePeer(message.peerId)) continue;
        anomalyEntries.push({ ts: message.ts, text: message.text, cmid: message.conversationMessageId });
        anomalyPeer = message.peerId;
      }
      for (const decision of existingDecisions) {
        if (!decision.text || !this.isGamePeer(decision.peerId)) continue;
        anomalyEntries.push({ ts: decision.ts, text: decision.text, isDecision: true });
      }
      anomalyEntries.sort((a, b) => a.ts - b.ts);
      const restoredAnomaly = restoreAnomalyState(anomalyEntries);
      if (restoredAnomaly !== null && anomalyPeer !== null) {
        this.anomalyStates.set(anomalyPeer, restoredAnomaly);
      }
      const botTexts = existingMessages.filter((message) => !message.out && message.text).sort((a, b) => a.ts - b.ts);
      for (const message of botTexts) this.lastBotText.set(message.peerId, message.text);
      const byTs = [...existingMessages].sort((a, b) => a.ts - b.ts);
      for (const message of byTs) {
        if (message.out) continue;
        const cmid = message.conversationMessageId;
        if (cmid !== null) {
          this.lastBotCmid.set(message.peerId, Math.max(this.lastBotCmid.get(message.peerId) ?? 0, cmid));
        }
      }
      for (const message of byTs) {
        if (message.out) continue;
        this.lastBotMessageTs.set(message.peerId, Math.max(this.lastBotMessageTs.get(message.peerId) ?? 0, message.ts));
        if (!message.keyboard) continue;
        if (message.keyboard.inline) {
          if (isStaleDomInline(message.source, message.conversationMessageId, this.lastBotCmid.get(message.peerId) ?? 0)) continue;
          this.lastInlineKeyboard.set(message.peerId, message);
        } else {
          this.lastComposerKeyboard.set(message.peerId, message);
        }
      }
      this.battleKeyboards = existingKeyboards.filter((record) => isBattleKeyboard(record.keyboard)).map((record) => record.keyboard).slice(-BATTLE_KEYBOARDS_KEEP);
      this.state.battleCandidates = collectBattleButtons(this.battleKeyboards);
      await this.relinkDecisions();
      this.state.counts = await this.readCounts();
      this.evaluateAdvice();
      this.initDone = true;
      await this.drainPendingEvents();
      this.relogPageReloadMarkers();
      this.relogStashedDiagnostics();
      void this.pruneLogs();
    }
    /**
     * Ретеншен логов: сырые события старше RAW_RETENTION_MS, сообщения/решения/
     * клавиатуры старше DATA_RETENTION_MS удаляются (индекс ts, схема v3, чанками
     * с уступкой потока — см. pruneStoreBefore). Многолетняя база замедляла
     * страницу; удалённое фиксируется событием `log-prune`. Старт и далее раз в
     * LOG_PRUNE_INTERVAL_MS.
     */
    async pruneLogs() {
      try {
        const now = Date.now();
        const raw = await pruneStoreBefore("raw", now - RAW_RETENTION_MS);
        const messages = await pruneStoreBefore("messages", now - DATA_RETENTION_MS);
        const decisions = await pruneStoreBefore("decisions", now - DATA_RETENTION_MS);
        const keyboards = await pruneStoreBefore("keyboards", now - DATA_RETENTION_MS);
        if (raw + messages + decisions + keyboards > 0) {
          this.logAuto({ event: "log-prune", raw, messages, decisions, keyboards });
          this.refreshCountsSoon();
        }
      } catch (error) {
        this.reportError(error, "\u043F\u043E\u0434\u0440\u0435\u0437\u043A\u0430 \u043B\u043E\u0433\u043E\u0432");
      }
    }
    /** Отложенные события старта: api-ответы и LongPoll, пришедшие до конца init. */
    async drainPendingEvents() {
      const api = this.pendingApi.splice(0, this.pendingApi.length);
      const longPoll = this.pendingLongPoll.splice(0, this.pendingLongPoll.length);
      for (const event of api) await this.handleApi(event.method, event.response, event.context);
      for (const data of longPoll) await this.handleLongPoll(data);
    }
    async setRecording(value) {
      this.state.recording = value;
      await setMeta("recording", value);
      this.panel?.update(this.state);
    }
    /** Ошибки init — переходные (база была занята, потом освободилась): успешный
     * повторный init снимает их с панели, чтобы они не висели вечно. */
    clearErrors() {
      if (this.state.errors.length === 0) return;
      this.state.errors = [];
      this.panel?.update(this.state);
    }
    /** Это чат игры? Ассистент записывает и действует только в таких чатах. */
    isGamePeer(peerId) {
      return peerId !== null && (peerId === GAME_PEER_ID || this.state.gamePeerIds.includes(peerId));
    }
    /**
     * Запоминает peer чата игры, опознанного по названию (шапка диалога,
     * заголовок вкладки или ответ API). Хранится в meta и переживает перезагрузку:
     * один раз открыв чат игры, пользователь больше нигде ассистента не увидит.
     */
    pinGamePeer(peerId) {
      if (this.isGamePeer(peerId)) return;
      this.state.gamePeerIds = [...this.state.gamePeerIds, peerId];
      void setMeta("gamePeerIds", this.state.gamePeerIds).catch(() => {
      });
      this.syncGameChat();
      this.evaluateAdvice();
      this.panel?.update(this.state);
    }
    syncGameChat() {
      this.state.isGameChat = this.isGamePeer(this.state.currentPeerId);
    }
    async setMode(value) {
      this.state.mode = value;
      if (value !== "auto") this.cancelAutoPlan();
      if (value === "auto") {
        this.lastGameActivityAt = Date.now();
        this.evaluateAdvice();
        this.scheduleAuto();
      }
      if (value === "observe") {
        this.state.advice = null;
        this.state.battleCandidates = [];
        this.state.pendingChoice = null;
      } else {
        this.evaluateAdvice();
        if (value === "auto") this.scheduleAuto();
      }
      await setMeta("mode", value);
      this.panel?.update(this.state);
    }
    async setBattleRotation(rotation) {
      this.state.battleRotation = migrateBattleRotation(rotation);
      this.evaluateAdvice();
      if (this.state.mode === "auto") this.scheduleAuto();
      await setMeta("battleRotation", this.state.battleRotation);
      this.panel?.update(this.state);
    }
    /** Тумблер «Раскрывать «➕ Действия»»: вход в подменю только ради ожидающего правила. */
    async setBattleAutoExpand(value) {
      this.state.battleAutoExpand = value;
      this.evaluateAdvice();
      await setMeta("battleAutoExpand", value);
      this.panel?.update(this.state);
    }
    /** Тумблер «Продавать садок при полном»: команда «Продать всю рыбу» в авто-режиме. */
    async setGardenAutoSell(value) {
      this.state.gardenAutoSell = value;
      this.gardenSellAt = 0;
      if (this.state.mode === "auto") this.scheduleAuto();
      await setMeta("gardenAutoSell", value);
      this.panel?.update(this.state);
    }
    /** Тумблер «Страж HP (аномалия)»: здоровье ≤ 25% в поле — советуем выход. */
    async setAnomalyHpGuard(value) {
      this.state.anomalyHpGuard = value;
      this.evaluateAdvice();
      await setMeta("anomalyHpGuard", value);
      this.panel?.update(this.state);
    }
    /**
     * Отдых (настройка «Отдых при HP ≤ N%»): при низком здоровье на локации
     * бот ходит в костёр (Костёр → ➕ Отдохнуть до восстановления → ⬅ Зона).
     * Фазы отдых ведёт сам; настройка включается/порог меняется здесь.
     */
    async setRestGuard(enabled, percent) {
      const safe = Math.max(5, Math.min(95, Math.round(Number.isFinite(percent) ? percent : 60)));
      this.state.restGuard = enabled;
      this.state.restHpPercent = safe;
      if (!enabled) this.restPhaseByPeer.clear();
      try {
        await setMeta("restHpGuard", enabled);
        await setMeta("restHpPercent", safe);
      } catch (error) {
        this.noteStorageError(error, "restHpGuard");
      }
      this.evaluateAdvice();
      if (this.state.mode === "auto") this.scheduleAuto();
      this.panel?.update(this.state);
    }
    /**
     * Из аномалии пора выходить: ставит флаг до «Вы вышли из аномалии» / входа
     * в новое поле. Повторная причина не перелогируется (комнаты шлют шапку с
     * здоровьем на каждом входе).
     */
    latchAnomalyExit(peerId, reason, hp = null) {
      if (this.anomalyExitByPeer.has(peerId)) return;
      this.anomalyExitByPeer.set(peerId, Date.now());
      this.logAuto(hp !== null ? { event: "anomaly-exit-wish", reason, hp } : { event: "anomaly-exit-wish", reason });
      if (this.state.mode === "auto") this.scheduleAuto();
    }
    async setAutoDelay(key, valueMs) {
      const safe = Math.max(0, Math.min(6e5, Math.round(valueMs)));
      this.state.autoDelays = { ...this.state.autoDelays, [key]: safe };
      await setMeta("autoDelays", this.state.autoDelays);
      this.panel?.update(this.state);
    }
    async setAutoReset(value) {
      this.state.autoReset = value;
      if (value) this.lastProgressAt = Date.now();
      await setMeta("autoReset", value);
      this.panel?.update(this.state);
    }
    /** Тумблер «Пауза при ручных нажатиях»: авто молчит, пока игрок управляет сам. */
    async setManualTakeover(value) {
      this.state.manualTakeover = value;
      if (!value) this.manualTakeoverUntil = 0;
      await setMeta("manualTakeover", value);
      this.panel?.update(this.state);
    }
    /**
     * Мягкий сброс состояния: карты клавиатур, совет, план, выбор — без удаления
     * истории в базе. Эквивалент «Очистить» для рантайма: DOM пересканируется,
     * актуальное состояние собирается заново. Применяется вручную и автоматически
     * при долгом простое авто-режима.
     */
    resetState() {
      this.state.lastKeyboard.clear();
      this.lastBotText.clear();
      this.lastInlineKeyboard.clear();
      this.lastComposerKeyboard.clear();
      this.lastBotMessageTs.clear();
      this.lastBotCmid.clear();
      this.anomalyStates.clear();
      this.anomalyExitByPeer.clear();
      this.anomalyBonusLimitByPeer.clear();
      this.anomalyStuckCycles.clear();
      this.lastHpPercent.clear();
      this.restPhaseByPeer.clear();
      this.restStartedAtByPeer.clear();
      this.helicopterUntilByPeer.clear();
      this.cacheUntilByPeer.clear();
      this.battleStates.clear();
      this.battleLivenessMisses.clear();
      this.recoveryByPeer.clear();
      this.manualTakeoverUntil = 0;
      this.state.manualPaused = false;
      this.autoClickAtByButton.clear();
      this.clickStreak = null;
      this.state.autoRepeatPauseUntil = 0;
      this.lastAutoClickButton = null;
      this.fishingUntil = 0;
      this.state.advice = null;
      this.state.pendingChoice = null;
      this.cancelAutoPlan();
      this.manualChoice = null;
      this.lastProgressAt = Date.now();
      this.onStateReset?.();
      this.evaluateAdvice();
      this.panel?.update(this.state);
    }
    /** Ручной выбор кнопки в панели: нажмёт её и запомнит выбор как правило развилки. */
    async choosePendingButton(buttonText) {
      this.manualChoice = buttonText;
      const pending = this.state.pendingChoice;
      this.state.pendingChoice = null;
      if (pending) await this.saveForkChoice(pending, buttonText);
      if (this.state.mode === "auto") this.scheduleAuto();
      this.panel?.update(this.state);
    }
    dismissPendingChoice() {
      this.manualChoice = null;
      this.state.pendingChoice = null;
      this.panel?.update(this.state);
    }
    /** Меняет выбор запомненной развилки; null — снова спрашивать. */
    async setForkRuleChoice(signature, choice) {
      this.state.forkRules = applyForkChoice(this.state.forkRules, signature, choice);
      await setMeta("forkRules", this.state.forkRules);
      this.logAuto({ event: "rule-set", signature, choice: choice ?? "(\u0441\u043F\u0440\u0430\u0448\u0438\u0432\u0430\u0442\u044C)" });
      if (this.state.mode === "auto") this.scheduleAuto();
      this.panel?.update(this.state);
    }
    async deleteForkRule(signature) {
      this.state.forkRules = removeForkRule(this.state.forkRules, signature);
      await setMeta("forkRules", this.state.forkRules);
      this.logAuto({ event: "rule-delete", signature });
      if (this.state.mode === "auto") this.scheduleAuto();
      this.panel?.update(this.state);
    }
    /**
     * Действие для события «Аномалия»/«Разлом»/«Вертолёт» (окно «Правила»,
     * секция «События»): выбор валидируется по словарю этого события.
     */
    async setEventRule(event, action) {
      const valid = event === "anomaly" ? isAnomalyEventAction(action) : event === "rift" ? isRiftEventAction(action) : event === "caches" ? isCacheEventAction(action) : isHelicopterEventAction(action);
      if (!valid) return;
      this.state.eventRules = { ...this.state.eventRules, [event]: action };
      this.logAuto({ event: "event-rule-set", rule: event, action });
      await setMeta("eventRules", this.state.eventRules);
      this.evaluateAdvice();
      if (this.state.mode === "auto") this.scheduleAuto();
      this.panel?.update(this.state);
    }
    /**
     * Новое имя типа поля («Перед глазами аномалия: Трамплин») — в известный
     * список окна «Правила» → «Аномалии». Пишем meta только когда тип новый:
     * входы в поля часты, а список растёт редко.
     */
    rememberAnomalyType(peerId, typeName) {
      if (typeName === null) return;
      if (this.state.anomalyTypeRules.known.includes(typeName)) return;
      this.state.anomalyTypeRules = {
        rules: this.state.anomalyTypeRules.rules,
        known: [...this.state.anomalyTypeRules.known, typeName]
      };
      void setMeta("anomalyTypeRules", this.state.anomalyTypeRules).catch(() => {
      });
    }
    /**
     * Действие для типа аномалии (окно «Правила» → «Аномалии»): «заходить»,
     * «обходить» или null — «по общему правилу» (eventRules.anomaly).
     */
    async setAnomalyTypeRule(typeName, action) {
      const name = typeName.trim();
      if (!name) return;
      const rules = { ...this.state.anomalyTypeRules.rules };
      if (action === null) delete rules[name];
      else rules[name] = action;
      const known = this.state.anomalyTypeRules.known.includes(name) ? this.state.anomalyTypeRules.known : [...this.state.anomalyTypeRules.known, name];
      this.state.anomalyTypeRules = { rules, known };
      this.logAuto({ event: "anomaly-type-rule", type: name, action: action ?? "default" });
      await setMeta("anomalyTypeRules", this.state.anomalyTypeRules);
      this.evaluateAdvice();
      if (this.state.mode === "auto") this.scheduleAuto();
      this.panel?.update(this.state);
    }
    async saveForkChoice(pending, choice) {
      const keyboard = this.currentForkKeyboard(pending.peerId)?.keyboard ?? null;
      const signature = forkSignature(keyboard);
      if (!signature) return;
      const buttons = pending.buttons;
      const existing = findForkRule(this.state.forkRules, signature);
      if (existing) {
        this.state.forkRules = applyForkChoice(this.state.forkRules, signature, choice);
      } else {
        this.state.forkRules = upsertForkRule(this.state.forkRules, signature, buttons, Date.now()).rules;
        this.state.forkRules = applyForkChoice(this.state.forkRules, signature, choice);
      }
      try {
        await setMeta("forkRules", this.state.forkRules);
      } catch (error) {
        this.noteStorageError(error, "forkRules");
      }
    }
    async handleApi(method, response, context, opts) {
      const harvested = harvestApiTemplate(this.apiTemplate, {
        url: context.url,
        request: context.request,
        now: Date.now()
      });
      if (harvested !== null) this.apiTemplate = harvested;
      const apiError = response?.error;
      const errorCode = typeof apiError?.error_code === "number" ? apiError.error_code : null;
      if (errorCode !== null && errorCode >= 3300 && errorCode <= 3306) {
        this.noteCaptchaSeen(`api:${method}`);
      }
      if (!this.initDone) {
        if (this.pendingApi.length < PENDING_EVENTS_LIMIT) {
          this.pendingApi.push({ method, response, context });
        }
        return;
      }
      if (!this.state.recording) return;
      try {
        const messages = extractMessages(response);
        const conversationKeyboards = extractConversationKeyboards(response);
        for (const raw of conversationKeyboards) {
          const peerId2 = asNumber(raw.peer_id);
          const id = asNumber(raw.id);
          if (peerId2 === null || id === null) continue;
          const key = `${peerId2}:${id}`;
          const observedDate = asNumber(raw.date);
          const observedTs = observedDate !== null && observedDate > 0 ? observedDate * 1e3 : null;
          const existingTs = this.keyboardTimestamps.get(key);
          if (existingTs !== void 0 && (observedTs === null || existingTs <= observedTs)) {
            raw.date = Math.floor(existingTs / 1e3);
          } else if (observedTs !== null) {
            this.keyboardTimestamps.set(key, observedTs);
          }
        }
        messages.push(...conversationKeyboards);
        if (method === "messages.send" || method === "messages.sendMessage" || method === "messages.sendMessageEvent") {
          const synthetic = messageFromSend(context.request, response, Date.now(), this.sendSeq++);
          if (synthetic) {
            if (this.currentUserId !== null) synthetic.from_id = this.currentUserId;
            messages.push(synthetic);
          }
        }
        for (const peerId2 of detectGamePeers(response)) this.pinGamePeer(peerId2);
        const gameMessages = messages.filter((raw) => this.isGamePeer(asNumber(raw?.peer_id)));
        if (gameMessages.length === 0) return;
        const first = gameMessages[0];
        const peerId = asNumber(first?.peer_id) ?? context.peerId ?? null;
        await this.storeRaw({
          source: context.source,
          kind: "api",
          method,
          url: sanitizeUrl(context.url),
          peerId,
          payload: { request: context.request ?? null, response: slimRawResponse(context.source, response) }
        });
        await this.handleBatch(gameMessages, context.source, {
          history: opts?.history ?? method === "messages.getHistory"
        });
      } catch (error) {
        this.reportError(error, `api ${method}`);
      }
    }
    async handleDomMessages(rawMessages, peerId) {
      if (!this.state.recording || rawMessages.length === 0) return;
      try {
        const fresh = rawMessages.map((raw) => ({
          raw,
          message: normalizeMessage(raw, {
            source: "dom",
            ts: Date.now(),
            peerId: peerId ?? void 0
          })
        })).filter((item) => item.message !== null).filter((item) => this.isGamePeer(item.message.peerId)).filter((item) => {
          if (!this.messageSignatures.has(messageSignature(item.message))) return true;
          const keyboard = item.message.keyboard;
          if (!keyboard) return false;
          const fingerprint = keyboardFingerprint(keyboard);
          if (this.messageKeyboards.get(item.message.key) === fingerprint) return false;
          return true;
        });
        if (fresh.length === 0) return;
        await this.storeRaw({
          source: "dom",
          kind: "dom",
          peerId,
          payload: fresh.map((item) => item.raw)
        });
        await this.handleBatch(fresh.map((item) => item.raw), "dom");
      } catch (error) {
        this.reportError(error, "dom");
      }
    }
    async handleLongPoll(data) {
      if (!this.initDone) {
        if (this.pendingLongPoll.length < PENDING_EVENTS_LIMIT) {
          this.pendingLongPoll.push(data);
        }
        return;
      }
      if (!this.state.recording) return;
      try {
        const updates = Array.isArray(data) ? data : Array.isArray(data?.updates) ? data.updates : [data];
        const messages = [];
        for (const update of updates) {
          const found = extractMessages(update);
          if (found.length) messages.push(...found);
        }
        for (const peerId2 of detectGamePeers(data)) this.pinGamePeer(peerId2);
        const gameMessages = messages.filter((raw) => this.isGamePeer(asNumber(raw?.peer_id)));
        if (gameMessages.length === 0) return;
        const first = gameMessages[0];
        const peerId = asNumber(first?.peer_id) ?? null;
        await this.storeRaw({ source: "ws", kind: "longpoll", peerId, payload: data });
        await this.handleBatch(gameMessages, "ws");
      } catch (error) {
        this.reportError(error, "longpoll");
      }
    }
    async clear() {
      if (this.writeTimer !== null) {
        window.clearTimeout(this.writeTimer);
        this.writeTimer = null;
      }
      this.pendingWrites.clear();
      await clearStores(["raw", "messages", "decisions", "keyboards"]);
      this.state.lastKeyboard.clear();
      this.lastBotText.clear();
      this.lastInlineKeyboard.clear();
      this.lastComposerKeyboard.clear();
      this.lastBotMessageTs.clear();
      this.lastBotCmid.clear();
      this.anomalyStates.clear();
      this.anomalyExitByPeer.clear();
      this.anomalyBonusLimitByPeer.clear();
      this.anomalyStuckCycles.clear();
      this.lastHpPercent.clear();
      this.restPhaseByPeer.clear();
      this.restStartedAtByPeer.clear();
      this.helicopterUntilByPeer.clear();
      this.cacheUntilByPeer.clear();
      this.battleStates.clear();
      this.gardenSlotsByPeer.clear();
      this.gardenSellAt = 0;
      this.battleLivenessMisses.clear();
      this.recoveryByPeer.clear();
      this.manualTakeoverUntil = 0;
      this.state.manualPaused = false;
      this.autoClickAtByButton.clear();
      this.clickStreak = null;
      this.state.autoRepeatPauseUntil = 0;
      this.lastAutoClickButton = null;
      this.fishingUntil = 0;
      this.messageSignatures.clear();
      this.messageKeyboards.clear();
      this.seenIncomingKeys.clear();
      this.keyboardTimestamps.clear();
      this.keyboardFirstSeen.clear();
      this.keyboardBuckets.clear();
      this.keyboardBucketsDirty.clear();
      this.decisionsByKey.clear();
      this.state.advice = null;
      this.state.battleCandidates = [];
      this.state.pendingChoice = null;
      this.state.gardenSlots = null;
      this.cancelAutoPlan();
      this.manualChoice = null;
      this.lastProgressAt = Date.now();
      this.state.counts = { messages: 0, decisions: 0, keyboards: 0, raw: 0 };
      this.panel?.update(this.state);
    }
    async exportData() {
      await this.flushWrites();
      return exportJsonl();
    }
    /**
     * Отметка РЕАЛЬНОГО действия игрока на странице: pointerdown/keydown с
     * isTrusted=true (ставится в main.ts). Отличает клик игрока от эха нашего
     * автоклика: оба приходят одинаковой кнопкой через messages.sendMessageEvent,
     * и isManualAction считал эхо «своим» в пределах 3 с — пауза при ручных
     * нажатиях не срабатывала, когда игрок жмал ту же кнопку, что и бот.
     * Синтетические события кликера isTrusted=false — отметку не ставят.
     */
    noteUserActivity() {
      this.lastUserActivityAt = Date.now();
    }
    startPeerTracking() {
      if (this.peerTrackingStarted) return;
      this.peerTrackingStarted = true;
      const update = () => {
        const previousPeer = this.state.currentPeerId;
        this.state.currentPeerId = currentPeerFromLocation();
        this.syncGameChat();
        if (previousPeer !== this.state.currentPeerId) {
          this.cancelAutoPlan();
          this.manualChoice = null;
          this.state.pendingChoice = null;
          this.evaluateAdvice();
        }
        this.tabHeartbeatTick = (this.tabHeartbeatTick + 1) % 5;
        if (this.tabChannel !== null && this.tabHeartbeatTick === 0) {
          try {
            this.tabChannel.postMessage({ mode: this.state.mode, gameChat: this.state.isGameChat, ts: Date.now() });
          } catch {
          }
        }
        this.updateCheckTick = (this.updateCheckTick + 1) % 60;
        if (this.updateCheckTick === 0) void this.checkRemoteUpdate();
        this.state.otherTabAutoUntil = this.lastOtherTabAutoAt > 0 ? this.lastOtherTabAutoAt + OTHER_TAB_AUTO_WINDOW_MS : 0;
        this.panel?.update(this.state);
      };
      update();
      window.addEventListener("popstate", update);
      window.setInterval(update, 1e3);
      if (this.tabChannel === null && typeof BroadcastChannel === "function") {
        try {
          this.tabChannel = new BroadcastChannel("stalker-assistant");
          this.tabChannel.onmessage = (event) => {
            const data = event.data;
            if (data !== null && data?.mode === "auto" && data.gameChat === true && typeof data.ts === "number") {
              this.lastOtherTabAutoAt = Date.now();
            }
          };
        } catch {
        }
      }
      if (this.livenessTimer === null) {
        this.livenessTimer = window.setInterval(() => this.checkKeyboardLiveness(), KEYBOARD_LIVENESS_INTERVAL_MS);
      }
      if (this.scrollTimer === null) {
        let scrollTick = 0;
        this.scrollTimer = window.setInterval(() => {
          if (this.state.mode !== "auto" || !this.state.isGameChat) return;
          scrollTick += 1;
          const fishing = Date.now() < this.fishingUntil;
          this.checkBlindFishing(fishing);
          if (!fishing && scrollTick % AUTO_SCROLL_IDLE_TICKS !== 0 && findUnreadHopButton() === null) return;
          const via = scrollChatToBottom();
          if (via !== null) {
            this.lastAutoScrollAt = Date.now();
            this.logAuto({ event: "auto-scroll", source: fishing ? "fishing" : "periodic", via });
          }
        }, AUTO_SCROLL_TICK_MS);
      }
      if (this.pruneTimer === null) {
        this.pruneTimer = window.setInterval(() => {
          void this.pruneLogs();
        }, LOG_PRUNE_INTERVAL_MS);
      }
      if (this.selfPollTimer === null) {
        this.selfPollTimer = window.setInterval(() => this.maybeSelfPoll(), 1e3);
      }
      if (this.captchaScanTimer === null) {
        this.captchaScanTimer = window.setInterval(() => this.checkCaptcha(), CAPTCHA_SCAN_INTERVAL_MS);
      }
    }
    /**
     * Фазы отдыха (настройка «Отдых при HP ≤ N%»): idle → fire (HP упал, на
     * экране «🔥 Костёр») → rest (экран костра, «➕ Отдохнуть» по 5 с) →
     * return (здоровье восстановлено — «⬅ Зона») → idle (вернулись на локацию).
     * Лог 08.11 08:14-08:29: HP 71% → Костёр → Отдохнуть ×2 → HP 100% → Зона.
     * Таймаут сессии — защита от зависания фазы (голод блокирует восстановление).
     */
    updateRestPhase(peerId, keyboard) {
      const has = (needle) => keyboard !== null && flattenButtons(keyboard).some((button) => comparableButtonText2(button.text).includes(needle));
      const hasFire = has("\u043A\u043E\u0441\u0442\u0451\u0440");
      const hasRestButton = has("\u043E\u0442\u0434\u043E\u0445\u043D\u0443\u0442\u044C");
      const hasZone = has("\u0437\u043E\u043D\u0430");
      const hp = this.lastHpPercent.get(peerId) ?? null;
      const phase = this.restPhaseByPeer.get(peerId) ?? null;
      const enabled = this.state.restGuard;
      const threshold = this.state.restHpPercent;
      let next = phase;
      if (phase === null) {
        if (enabled && hasFire && hp !== null && hp <= threshold) next = "fire";
      } else if (phase === "fire") {
        if (hasRestButton) next = "rest";
        else if (!hasFire) next = null;
      } else if (phase === "rest") {
        if (hp !== null && hp >= REST_COMPLETE_PERCENT && hasZone) next = "return";
      } else if (phase === "return") {
        if (hasFire) next = null;
        else if (!hasZone) next = null;
      }
      const startedAt = this.restStartedAtByPeer.get(peerId) ?? 0;
      const timedOut = phase !== null && startedAt > 0 && Date.now() - startedAt > REST_SESSION_TIMEOUT_MS;
      if (timedOut) next = null;
      if (next === phase) {
        if (next !== null) this.restPhaseByPeer.set(peerId, next);
        return;
      }
      if (next !== null) {
        this.restPhaseByPeer.set(peerId, next);
        if (next === "fire") {
          this.restStartedAtByPeer.set(peerId, Date.now());
          this.logAuto({ event: "rest-start", hp: hp ?? -1, threshold });
        }
      } else {
        this.restPhaseByPeer.delete(peerId);
        this.restStartedAtByPeer.delete(peerId);
        if (phase === "return") this.logAuto({ event: "rest-done" });
        else if (timedOut) this.logAuto({ event: "rest-timeout", phase });
      }
    }
    /**
     * Капча ВК: при её показе (DOM или ошибка captcha в ответах API) авто-режим
     * приостанавливается на 30 с после последнего ВИДИМОГО следа капчи — клики
     * по кнопкам игры в это время спамят впустую и усугубляют блокировку.
     * Решается в браузере — пауза снимается сама. ВАЖНО: след считается только
     * если элемент реально отрисован (ширина/высота > 0): ВК после решения
     * капчи часто оставляет в разметке невидимый контейнер-«труп» с captcha
     * в классе — голый querySelector продлевал паузу вечно, и бот не понимал,
     * что можно продолжать (скрин 08.11 01:03). Для страховки эпизод капчи
     * не длится дольше 10 минут: если капча реально жива, следующие ошибки
     * API/клики начнут новый эпизод.
     */
    checkCaptcha() {
      const seen = this.findVisibleCaptcha();
      if (seen) {
        this.noteCaptchaSeen("page");
        return;
      }
      if (this.captchaActive()) return;
      if (this.state.captchaPausedUntil !== 0) {
        this.state.captchaPausedUntil = 0;
        this.logAuto({ event: "captcha-pause", state: "resolved" });
        this.evaluateAdvice();
        if (this.state.mode === "auto") this.scheduleAuto();
        this.panel?.update(this.state);
      }
    }
    /** Видимый след капчи в разметке: элементы-«трупы» (нули в rect, display:none)
     * не считаются — они остаются в DOM и после решения капчи. */
    findVisibleCaptcha() {
      if (typeof document === "undefined") return false;
      const candidates = document.querySelectorAll(
        '[class*="captcha" i], [id*="captcha" i], [src*="captcha" i], [alt*="captcha" i]'
      );
      for (const node of candidates) {
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
        return true;
      }
      return false;
    }
    captchaActive() {
      return Date.now() < this.captchaActiveUntil && Date.now() - this.captchaEpisodeStartedAt < CAPTCHA_MAX_EPISODE_MS;
    }
    /** След капчи увиден — пауза продлевается, план сбрасывается, лог раз в эпизод. */
    noteCaptchaSeen(source) {
      if (!this.captchaActive()) this.captchaEpisodeStartedAt = Date.now();
      this.captchaActiveUntil = Date.now() + CAPTCHA_PAUSE_AFTER_SEEN_MS;
      this.state.captchaPausedUntil = this.captchaActiveUntil;
      if (Date.now() - this.captchaLoggedAt > 6e4) {
        this.captchaLoggedAt = Date.now();
        this.logAuto({ event: "captcha-pause", source });
        this.cancelAutoPlan();
        this.panel?.update(this.state);
      }
    }
    /**
     * Слепая рыбалка: окно рыбалки активно, а вкладка В ФОНЕ — ВК не монтирует
     * новые сообщения, задания невидимы. Слепой бот продолжает закидывать удочку —
     * каждая холостая закидка жжёт наживку и гарантированно срывается (лог
     * 07.11 14:38–14:40). Пауза закидок до возврата вкладки (onVisibilityChange).
     *
     * 0.3.261108.16xx: раньше слепота детектилась по свежести DOM-захватов
     * (domStale + netFresh), но сеть приносит сообщения РАНЬШЕ DOM, и смонтированные
     * копии дедуплицируются как виденные — в видимой вкладке с работающей рыбалкой
     * «свежих» DOM-захватов могло не быть минутами (лог 08.11 07:51: задание
     * «Мутная вода» пришло, совет построился, а бот простоял ложную паузу и
     * сжёг наживку). Слепота теперь равна document.hidden: видимая вкладка не
     * слепнет; «чат прокручен» во время рыбалки держит автоскролл (scrollTick).
     */
    checkBlindFishing(fishing) {
      const blind = fishing && document.hidden;
      if (this.state.blindFishing === blind) return;
      this.state.blindFishing = blind;
      if (blind) {
        this.cancelAutoPlan();
        this.logAuto({ event: "blind-fishing", state: "blind" });
      } else {
        this.logAuto({ event: "blind-fishing", state: "recovered" });
      }
      this.panel?.update(this.state);
    }
    /**
     * Периодическая проверка живости актуальной клавиатуры (раз в ~12 с): карта
     * может держать уже закрытое событие — например, бой закончился без новой
     * клавиатуры от игры, и совет ротации висит, хотя в чате уже «Исследовать».
     * DOM — последний источник правды: кнопки не отрисованы — событие мертво.
     * Боевую не выкидываем с первого промаха: на ходу врага/выборе цели ВК прячет
     * её надолго — нужно два промаха подряд.
     */
    checkKeyboardLiveness() {
      this.maybePageReload();
      if (this.state.mode === "observe") return;
      if (this.captchaActive()) return;
      const peerId = this.state.currentPeerId;
      if (peerId === null || !this.isGamePeer(peerId)) {
        this.maybePageReload();
        return;
      }
      this.maybePageReload();
      if (this.state.autoReset && this.state.mode === "auto" && Date.now() - this.lastProgressAt > STALE_STATE_RESET_MS) {
        this.logAuto({ event: "auto-reset", idleMs: Date.now() - this.lastProgressAt });
        this.resetState();
        return;
      }
      const keyboardMessage = this.currentForkKeyboard(peerId);
      const keyboard = keyboardMessage?.keyboard ?? null;
      if (keyboard === null) {
        this.captureRenderedKeyboard(peerId);
        if (this.state.mode === "auto" && this.plannedAction === null && Date.now() - this.lastKeyboardExpandAt > KEYBOARD_EXPAND_MIN_INTERVAL_MS) {
          try {
            if (expandComposerKeyboard()) {
              this.lastKeyboardExpandAt = Date.now();
              this.logAuto({ event: "keyboard-expand" });
            }
          } catch (error) {
            this.reportError(error, "expand composer keyboard");
          }
        }
        if (this.state.mode === "auto" && this.plannedAction === null) this.scheduleAuto();
        return;
      }
      const texts = keyboard.buttons.flat().map((button) => button.text);
      if (isAnyButtonRendered(texts)) {
        this.battleLivenessMisses.delete(peerId);
        if (this.state.mode === "auto" && this.plannedAction === null) {
          const advice = this.state.advice;
          if (advice !== null && advice.kind === "battle" && advice.button === null && !isBattleKeyboard(keyboard)) {
            this.captureRenderedKeyboard(peerId);
            if (Date.now() - this.lastBattleWaitLogAt > 3e4) {
              this.lastBattleWaitLogAt = Date.now();
              this.logAuto({
                event: "battle-wait",
                inline: keyboard.inline,
                composerKnown: this.lastComposerKeyboard.has(peerId),
                adviceAgeMs: Date.now() - advice.ts
              });
            }
          }
          this.scheduleAuto();
        }
        if (this.anomalyStuckSilence(peerId) && Date.now() - this.lastKeyboardReloadAt > KEYBOARD_RELOAD_MIN_INTERVAL_MS) {
          try {
            if (cycleComposerKeyboard()) {
              this.lastKeyboardReloadAt = Date.now();
              this.logAuto({ event: "keyboard-reload", inline: keyboard.inline, source: "periodic", cause: "game-silent" });
              this.noteAnomalyStuck(peerId);
            }
          } catch (error) {
            this.reportError(error, "\u043F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u043A\u043B\u0430\u0432\u0438\u0430\u0442\u0443\u0440\u044B");
          }
        }
        return;
      }
      if (isBattleKeyboard(keyboard)) {
        const misses = (this.battleLivenessMisses.get(peerId) ?? 0) + 1;
        this.battleLivenessMisses.set(peerId, misses);
        if (misses < 2) {
          this.logAuto({ event: "liveness-miss", inline: keyboard.inline, misses });
          return;
        }
      }
      if (this.state.mode === "auto" && hasStuckLoadingButton() && Date.now() - this.lastKeyboardReloadAt > KEYBOARD_RELOAD_MIN_INTERVAL_MS) {
        try {
          if (cycleComposerKeyboard()) {
            this.lastKeyboardReloadAt = Date.now();
            this.logAuto({ event: "keyboard-reload", inline: keyboard.inline, source: "periodic" });
            return;
          }
        } catch (error) {
          this.reportError(error, "\u043F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u043A\u043B\u0430\u0432\u0438\u0430\u0442\u0443\u0440\u044B");
        }
      }
      if (keyboard.inline) this.lastInlineKeyboard.delete(peerId);
      else this.lastComposerKeyboard.delete(peerId);
      this.battleLivenessMisses.delete(peerId);
      this.logAuto({
        event: "keyboard-gone",
        inline: keyboard.inline,
        buttons: texts.map((text) => trimLoadingPrefix(text)),
        source: "periodic"
      });
      this.cancelAutoPlan();
      this.captureRenderedKeyboard(peerId);
      this.evaluateAdvice();
      this.panel?.update(this.state);
    }
    /**
     * Экран — последний источник правды о клавиатуре: читает самую свежую
     * отрисованную клавиатуру прямо из DOM в карту, когда карта пуста или
     * протухла. Закрывает случай «клавиатура события не захвачена» (разлом:
     * сообщение записано, кнопки на экране кликабельны, но ни сеть, ни
     * композер-синхор, ни DOM-запись их не принесли) — без этого правила
     * развилок применялись не к чему, и бот молчал до ручного клика игрока.
     */
    captureRenderedKeyboard(peerId) {
      if (Date.now() - this.lastAutoClickAt < this.composerSyncSuppressMs) return false;
      let rendered = null;
      try {
        rendered = findRenderedKeyboard(this.lastBotCmid.get(peerId) ?? 0);
      } catch (error) {
        this.reportError(error, "rendered keyboard");
        return false;
      }
      if (rendered === null) return false;
      const carrierKey = rendered.cmid !== null ? `${peerId}:${rendered.cmid}` : null;
      const carrierTs = carrierKey !== null ? this.keyboardFirstSeen.get(carrierKey) ?? this.lastBotMessageTs.get(peerId) ?? Date.now() : Date.now();
      const raw = rendered.cmid !== null ? {
        id: rendered.cmid,
        conversation_message_id: rendered.cmid,
        peer_id: peerId,
        out: 0,
        date: Math.floor(carrierTs / 1e3),
        text: "",
        keyboard: rendered.raw
      } : {
        id: -stableNumericId(`${peerId}:${JSON.stringify(rendered.raw)}`),
        peer_id: peerId,
        out: 0,
        date: Math.floor(Date.now() / 1e3),
        text: "",
        keyboard: rendered.raw
      };
      if (carrierKey !== null && !this.keyboardFirstSeen.has(carrierKey)) {
        this.keyboardFirstSeen.set(carrierKey, carrierTs);
      }
      const message = normalizeMessage(raw, { source: "dom", ts: carrierTs, peerId });
      if (!message?.keyboard) return false;
      const keyboard = message.keyboard;
      const current = this.currentForkKeyboard(peerId);
      if (keyboardsEqual(current?.keyboard ?? null, keyboard)) return false;
      if (keyboard.inline) this.lastInlineKeyboard.set(peerId, message);
      else this.lastComposerKeyboard.set(peerId, message);
      this.lastProgressAt = Date.now();
      this.lastGameActivityAt = Date.now();
      this.clickStreak = null;
      this.logAuto({
        event: "rendered-sync",
        inline: keyboard.inline,
        buttons: keyboard.buttons.flat().map((button) => trimLoadingPrefix(button.text)),
        replaced: current?.keyboard?.buttons.flat().map((button) => trimLoadingPrefix(button.text)) ?? null
      });
      this.evaluateAdvice();
      this.panel?.update(this.state);
      return true;
    }
    /**
     * Смена видимости вкладки. В скрытой вкладке ВК не монтирует новые сообщения
     * (задания рыбалки приходят только в DOM — бот слепнет, рыба срывается), а
     * таймеры Chrome замедляются до минуты. Фиксируем это в логе; при возврате
     * во вкладку сразу пересчитываем совет и план, не дожидаясь батча.
     */
    onVisibilityChange(hidden) {
      if (hidden) {
        if (this.state.mode !== "observe" && this.state.isGameChat && Date.now() - this.lastHiddenLogAt > 6e4) {
          this.lastHiddenLogAt = Date.now();
          this.logAuto({ event: "hidden-tab" });
        }
        this.checkBlindFishing(Date.now() < this.fishingUntil);
        return;
      }
      if (this.state.blindFishing) {
        this.state.blindFishing = false;
        this.logAuto({ event: "blind-fishing", state: "recovered" });
      }
      this.lastGameActivityAt = Date.now();
      this.evaluateAdvice();
      if (this.state.mode === "auto") this.scheduleAuto();
      this.panel?.update(this.state);
    }
    /**
     * Самообновление: сверяем версию открытой сборки с опубликованной в
     * репозитории (raw.githubusercontent отдаёт CORS «*» — обычный fetch при
     * @grant none). Tampermonkey обновляет установку по своему расписанию, но
     * открытые вкладки продолжают работать старым кодом до перезагрузки — эта
     * проверка закрывает разрыв: показывает заметку в панели и сама
     * перезагружает простаивающую вкладку (один раз на версию, флаг в
     * sessionStorage переживает перезагрузку и не даёт цикла, если Tampermonkey
     * ещё не успел установить новую сборку).
     */
    async checkRemoteUpdate() {
      if ("https://raw.githubusercontent.com/HeyOh79/stalker-install/main/stalker-assistant.user.js".length === 0) return;
      if (!this.initDone || !this.state.isGameChat) return;
      if (Date.now() - this.lastUpdateCheckAt < UPDATE_CHECK_INTERVAL_MS) return;
      this.lastUpdateCheckAt = Date.now();
      let remote;
      try {
        const response = await fetch("https://raw.githubusercontent.com/HeyOh79/stalker-install/main/stalker-assistant.user.js", { cache: "no-store" });
        if (!response.ok) return;
        remote = parseVersionFromSource(await response.text());
      } catch {
        return;
      }
      const local = "0.3.261111.1403";
      if (remote === null || !isNewerVersion(remote, local)) return;
      const firstNotice = this.state.updateAvailable?.remote !== remote;
      this.state.updateAvailable = { remote, local };
      let autoReloaded = false;
      if (firstNotice && sessionStorage.getItem("stalkerAutoReloaded") !== remote && this.isIdleForReload()) {
        sessionStorage.setItem("stalkerAutoReloaded", remote);
        this.logAuto({ event: "auto-update-reload", remote, local });
        autoReloaded = true;
      }
      this.panel?.update(this.state);
      if (autoReloaded) window.location.reload();
    }
    /** Простой: некуда и нечего кликать, события не идут — можно перезагрузиться. */
    isIdleForReload() {
      const peerId = this.state.currentPeerId;
      return this.plannedAction === null && this.state.pendingChoice === null && this.state.autoPlan === null && Date.now() >= this.fishingUntil && Date.now() >= this.manualTakeoverUntil && (peerId === null || !this.battleStates.has(peerId) && !this.anomalyStates.has(peerId) && this.restPhaseByPeer.get(peerId) === void 0);
    }
    /** Решение о перезагрузке для текущего чата (чистая логика — src/core/hang.ts). */
    pageReloadDecision(peerId) {
      const now = Date.now();
      const keyboardMessage = this.currentForkKeyboard(peerId);
      return pageReloadDecision({
        mode: this.state.mode,
        isGameChat: this.state.isGameChat,
        hidden: document.hidden,
        captchaActive: this.captchaActive(),
        manualPaused: this.state.manualPaused || now < this.manualTakeoverUntil,
        blindFishing: this.state.blindFishing,
        adviceHold: this.state.advice?.hold === true,
        pendingChoice: this.state.pendingChoice !== null,
        cacheSearchActive: now < (this.cacheUntilByPeer.get(peerId) ?? 0),
        helicopterActive: now < (this.helicopterUntilByPeer.get(peerId) ?? 0),
        restActive: this.restPhaseByPeer.has(peerId),
        silentMs: now - this.lastGameActivityAt,
        hasScreen: keyboardMessage !== null || this.state.advice !== null || this.plannedAction !== null
      });
    }
    cancelPageReload() {
      if (this.state.pageReloadScheduledAt === 0) return;
      this.state.pageReloadScheduledAt = 0;
      this.logAuto({ event: "page-reload-cancel", silentMs: this.pageReloadSilentMs });
      this.panel?.update(this.state);
    }
    /**
     * Тик детектора зависания (зовётся из проверки живости, раз в ~12 с):
     * игра молчит дольше PAGE_RELOAD_AFTER_MS при готовом действии —
     * предупреждаем в панели и через PAGE_RELOAD_GRACE_MS перезагружаем
     * страницу. Пока идёт отсчёт, любое изменение мира (ответ игры, смена
     * режима, длинное событие, уход вкладки в фон) отменяет перезагрузку.
     */
    maybePageReload() {
      const peerId = this.state.currentPeerId;
      if (peerId === null || !this.isGamePeer(peerId)) {
        this.cancelPageReload();
        return;
      }
      const now = Date.now();
      if (this.state.pageReloadSuspendedUntil > now) {
        this.cancelPageReload();
        return;
      }
      if (this.state.pageReloadScheduledAt !== 0) {
        if (this.pageReloadDecision(peerId) !== "schedule") {
          this.cancelPageReload();
        } else if (now >= this.state.pageReloadScheduledAt) {
          void this.executePageReload();
        }
        return;
      }
      if (this.pageReloadDecision(peerId) !== "schedule") return;
      this.pageReloadSilentMs = now - this.lastGameActivityAt;
      this.state.pageReloadScheduledAt = now + PAGE_RELOAD_GRACE_MS;
      this.logAuto({
        event: "page-reload-scheduled",
        silentMs: this.pageReloadSilentMs,
        graceMs: PAGE_RELOAD_GRACE_MS
      });
      this.panel?.update(this.state);
    }
    /**
     * Исполнение перезагрузки: маркер в localStorage (переживает саму
     * перезагрузку даже при проблемной базе), попытка сброса буфера записей
     * в базу — и window.location.reload(). После подъёма init переложит
     * маркер в базу событием `page-reload` (см. relogPageReloadMarkers).
     */
    async executePageReload() {
      const now = Date.now();
      this.state.pageReloadScheduledAt = 0;
      try {
        const log = this.readReloadLog();
        log.push({ ts: now, silentMs: this.pageReloadSilentMs, reason: "game-silent" });
        while (log.length > 12) log.shift();
        localStorage.setItem(PAGE_RELOAD_LOG_KEY, JSON.stringify(log));
      } catch {
      }
      this.logAuto({ event: "page-reload", silentMs: this.pageReloadSilentMs });
      try {
        await this.flushWrites();
      } catch {
      }
      window.location.reload();
    }
    readReloadLog() {
      try {
        const raw = localStorage.getItem(PAGE_RELOAD_LOG_KEY);
        if (raw === null) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((entry) => typeof entry === "object" && entry !== null && typeof entry.ts === "number");
      } catch {
        return [];
      }
    }
    /**
     * Журнал авто-перезагрузок из localStorage перекладывается в базу событием
     * `page-reload` (afterReload: true — сама перезагрузка случилась до этого
     * подъёма). Три и более перезагрузок за 30 минут — защита от цикла:
     * авто-перезагрузка приостанавливается на 30 минут.
     */
    relogPageReloadMarkers() {
      const log = this.readReloadLog();
      let changed = false;
      for (const entry of log) {
        if (entry.logged) continue;
        entry.logged = true;
        changed = true;
        this.logAuto({
          event: "page-reload",
          ts: entry.ts,
          silentMs: entry.silentMs,
          reason: entry.reason,
          afterReload: true
        });
      }
      if (changed) {
        try {
          localStorage.setItem(PAGE_RELOAD_LOG_KEY, JSON.stringify(log));
        } catch {
        }
      }
      const recent = log.filter((entry) => Date.now() - entry.ts < PAGE_RELOAD_LOOP_WINDOW_MS).length;
      if (recent >= PAGE_RELOAD_LOOP_LIMIT) {
        this.state.pageReloadSuspendedUntil = Date.now() + PAGE_RELOAD_LOOP_WINDOW_MS;
        this.logAuto({ event: "page-reload-suspended", recent });
      }
    }
    /**
     * Зависшие кнопки: в поле аномалии совет с кнопкой (болт/выход) жив, а
     * игра молчит дольше минуты — клики не проходят. Кнопки при этом ОТРИСОВАНЫ,
     * поэтому триггер «кнопка-спиннер» и eviction их не ловили (лог 07.11
     * 12:26: три клика болта без ответа, repeat-pause, после паузы — снова).
     */
    anomalyStuckSilence(peerId) {
      if (this.state.mode !== "auto") return false;
      const advice = this.state.advice;
      if (advice === null || advice.kind !== "anomaly" || advice.button === null) return false;
      const lastBot = this.lastBotMessageTs.get(peerId) ?? 0;
      return Date.now() - lastBot > ANOMALY_STUCK_SILENCE_MS;
    }
    /**
     * Перемонтаж при молчании: после двух безрезультатных циклов звали игрока —
     * обновить страницу безопасно, позиция в поле восстановится из лога.
     */
    noteAnomalyStuck(peerId) {
      const cycles = (this.anomalyStuckCycles.get(peerId) ?? 0) + 1;
      this.anomalyStuckCycles.set(peerId, cycles);
      if (cycles >= 2 && Date.now() - this.lastAnomalyStuckNoteAt > 18e4) {
        this.lastAnomalyStuckNoteAt = Date.now();
        this.reportError(new Error("\u0438\u0433\u0440\u0430 \u043D\u0435 \u043E\u0442\u0432\u0435\u0447\u0430\u0435\u0442 \u043D\u0430 \u043A\u043B\u0438\u043A\u0438 \u0432 \u0430\u043D\u043E\u043C\u0430\u043B\u0438\u0438 \u2014 \u043E\u0431\u043D\u043E\u0432\u0438 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443: \u043F\u043E\u0437\u0438\u0446\u0438\u044F \u0432 \u043F\u043E\u043B\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u0441\u044F, \u0431\u043E\u0442 \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442 \u0441\u0430\u043C"), "\u0437\u0430\u0432\u0438\u0441\u0448\u0438\u0435 \u043A\u043D\u043E\u043F\u043A\u0438");
      }
    }
    reportError(error, context = "") {
      const detail = error instanceof Error ? error.message : String(error);
      const message = context ? `${context}: ${detail}` : detail;
      this.state.errors.push(message);
      if (this.state.errors.length > 20) this.state.errors.shift();
      this.panel?.showError(message);
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[Stalker Assistant]", message);
      }
    }
    async handleBatch(rawMessages, source, options) {
      const history = options?.history === true;
      const result = processBatch(rawMessages, {
        source,
        ts: Date.now(),
        lastKeyboard: this.state.lastKeyboard
      });
      const effective = history ? result.messages : result.messages.filter((message) => {
        if (message.out) return true;
        if (!this.seenIncomingKeys.has(message.key)) {
          this.seenIncomingKeys.add(message.key);
          this.capSeenIncomingKeys();
          return true;
        }
        const keyboard = message.keyboard;
        if (!keyboard) return false;
        return this.messageKeyboards.get(message.key) !== keyboardFingerprint(keyboard);
      });
      for (const message of result.messages) {
        if (!message.out) this.seenIncomingKeys.add(message.key);
      }
      this.capSeenIncomingKeys();
      if (effective.length) {
        await this.writeQuiet("messages", effective, () => {
          for (const message of effective) this.seenIncomingKeys.delete(message.key);
        });
        for (const message of effective) {
          this.messageSignatures.add(messageSignature(message));
        }
        const changedKeyboardKeys = /* @__PURE__ */ new Set();
        for (const message of effective) {
          if (!message.keyboard) continue;
          const fingerprint = keyboardFingerprint(message.keyboard);
          if (this.messageKeyboards.get(message.key) !== fingerprint) changedKeyboardKeys.add(message.key);
          this.messageKeyboards.set(message.key, fingerprint);
          const known = this.keyboardFirstSeen.get(message.key);
          if (known === void 0 || message.ts < known) this.keyboardFirstSeen.set(message.key, message.ts);
        }
        const prevBotCmid = new Map(this.lastBotCmid);
        for (const message of effective) {
          if (message.out) continue;
          const cmid = message.conversationMessageId;
          if (cmid !== null) {
            this.lastBotCmid.set(message.peerId, Math.max(this.lastBotCmid.get(message.peerId) ?? 0, cmid));
          }
        }
        for (const message of effective) {
          const staleDom = message.source === "dom" && message.conversationMessageId !== null && message.conversationMessageId < (prevBotCmid.get(message.peerId) ?? message.conversationMessageId);
          const fresh = !history && !staleDom;
          if (message.out) {
            if (fresh) {
              const pending = this.state.pendingChoice;
              if (pending && pending.peerId === message.peerId) {
                const choice = matchChoiceButton(pending.buttons, message.text);
                if (choice) {
                  this.state.pendingChoice = null;
                  this.logAuto({ event: "learn-choice", choice, buttons: pending.buttons });
                  await this.saveForkChoice(pending, choice);
                }
              }
              const inline = this.lastInlineKeyboard.get(message.peerId) ?? null;
              if (inline && isForkResolvedByDecision(inline, message.text)) {
                this.lastInlineKeyboard.delete(message.peerId);
              }
              const battle = this.battleStates.get(message.peerId);
              if (battle && message.text) {
                this.battleStates.set(message.peerId, markOutgoingBattleAction(battle, message.text));
              }
              if (this.recoveryByPeer.has(message.peerId) && message.text) {
                const lowered = message.text.toLowerCase();
                if (lowered.includes("\u043E\u0442\u0434\u043E\u0445\u043D\u0443\u0442\u044C") || lowered.includes("\u043F\u0435\u0440\u0435\u043A\u0443\u0441\u0438\u0442\u044C")) {
                  this.recoveryByPeer.delete(message.peerId);
                }
              }
              if (this.state.manualTakeover) {
                const ownEcho = this.decisionsByKey.has(decisionKey({
                  ts: message.ts,
                  peerId: message.peerId,
                  kind: message.payloadRaw ? "callback" : "text",
                  payloadRaw: message.payloadRaw,
                  text: message.text
                }));
                if (!ownEcho && (isManualAction(message.source, message.text, this.lastAutoClickButton, this.lastAutoClickSuccessAt, Date.now()) || Date.now() - this.lastUserActivityAt < USER_ACTIVITY_WINDOW_MS)) {
                  const wasPaused = Date.now() < this.manualTakeoverUntil;
                  this.manualTakeoverUntil = Date.now() + MANUAL_TAKEOVER_MS;
                  this.state.manualPaused = true;
                  if (!wasPaused) {
                    this.logAuto({ event: "manual-takeover", source: message.source, text: trimLoadingPrefix(message.text).slice(0, 40) });
                    this.cancelAutoPlan();
                    this.panel?.update(this.state);
                  }
                }
              }
            }
            continue;
          }
          if (fresh && message.text) this.lastBotText.set(message.peerId, message.text);
          if (fresh && message.text) this.anomalyStuckCycles.delete(message.peerId);
          if (fresh && message.text) {
            const hpPercent = healthPercentFrom(message.text);
            if (hpPercent !== null) this.lastHpPercent.set(message.peerId, hpPercent);
          }
          if (fresh && !message.out && !(message.text && isStaleKeyboardText(message.text))) {
            this.clickStreak = null;
            this.lastGameActivityAt = Date.now();
          }
          if (fresh && message.text && isFishingFlowText(message.text)) {
            this.fishingUntil = message.ts + FISHING_WINDOW_MS;
          }
          if (fresh && message.text) {
            const slots = parseGardenSlots(message.text);
            if (slots !== null) {
              this.gardenSlotsByPeer.set(message.peerId, slots);
            } else if (isGardenSoldText(message.text)) {
              const previous = this.gardenSlotsByPeer.get(message.peerId);
              this.gardenSlotsByPeer.set(message.peerId, { current: 0, limit: previous?.limit ?? 35 });
            }
          }
          if (fresh && message.text && isFishLostText(message.text)) {
            if (this.lastInlineKeyboard.has(message.peerId)) {
              this.lastInlineKeyboard.delete(message.peerId);
            }
          }
          if (fresh && message.text && isAnomalyFieldText(message.text)) {
            this.anomalyStates.set(message.peerId, updateAnomalyState(this.anomalyStates.get(message.peerId) ?? null, message.text, message.conversationMessageId));
            if (this.state.anomalyHpGuard) {
              const hp = healthPercentFrom(message.text);
              if (hp !== null && hp <= ANOMALY_HP_GUARD_PERCENT) this.latchAnomalyExit(message.peerId, "low-hp", hp);
            }
            if (/Разведано направлений:\s*0\s*\//u.test(message.text)) this.anomalyExitByPeer.delete(message.peerId);
          }
          if (fresh && message.text) {
            const reset = anomalyResetReason(message.text);
            if (reset === "picked") {
              this.anomalyStates.set(message.peerId, updateAnomalyState(this.anomalyStates.get(message.peerId) ?? null, message.text, message.conversationMessageId));
              this.logAuto({ event: "anomaly-reset", reason: reset });
            } else {
              if (reset !== null && this.anomalyStates.has(message.peerId)) {
                this.anomalyStates.delete(message.peerId);
                this.logAuto({ event: "anomaly-reset", reason: reset });
              }
            }
            if (reset === "left" || reset === "enter") this.anomalyExitByPeer.delete(message.peerId);
            if (reset === "enter") this.restPhaseByPeer.delete(message.peerId);
            if (reset === "enter") {
              this.anomalyBonusLimitByPeer.set(message.peerId, bonusLimitFrom(message.text));
              this.rememberAnomalyType(message.peerId, entryAnomalyName(message.text));
            } else {
              this.anomalyBonusLimitByPeer.delete(message.peerId);
            }
            if (fresh && message.text && isSceneChangeText(message.text)) {
              this.anomalyExitByPeer.delete(message.peerId);
              this.anomalyStates.delete(message.peerId);
              this.anomalyBonusLimitByPeer.delete(message.peerId);
            }
          }
          if (fresh && message.text && isHelicopterText(message.text)) {
            this.helicopterUntilByPeer.set(message.peerId, message.ts + helicopterApproachMs(message.text));
          }
          if (fresh && message.text && isCacheSearchText(message.text)) {
            this.cacheUntilByPeer.set(message.peerId, message.ts + cacheSearchMs(message.text));
          }
          if (fresh && message.text && isBattleFlowText(message.text)) {
            this.battleStates.set(message.peerId, updateBattleState(this.battleStates.get(message.peerId) ?? null, message.text, message.conversationMessageId));
            this.fishingUntil = 0;
            if (this.state.blindFishing) {
              this.state.blindFishing = false;
              this.logAuto({ event: "blind-fishing", state: "recovered", cause: "battle" });
            }
          }
          if (fresh && message.keyboard && isActionsMenuKeyboard(message.keyboard)) {
            const battle = this.battleStates.get(message.peerId);
            if (battle) {
              this.battleStates.set(message.peerId, markActionsMenuButtons(battle, message.keyboard.buttons.flat().map((button) => button.text)));
            }
          }
          if (fresh && message.text && isStaleKeyboardText(message.text)) {
            this.lastInlineKeyboard.delete(message.peerId);
            this.lastComposerKeyboard.delete(message.peerId);
            this.battleStates.delete(message.peerId);
            if (this.lastAutoClickButton !== null && Date.now() - this.lastAutoClickSuccessAt < 15e3) {
              this.clickStreak = nextClickStreak(this.clickStreak, this.lastAutoClickButton);
              if (this.clickStreak.count >= AUTO_SAME_CLICK_LIMIT) {
                this.state.autoRepeatPauseUntil = Date.now() + AUTO_REPEAT_PAUSE_MS;
                this.logAuto({ event: "repeat-pause", button: this.lastAutoClickButton, clicks: this.clickStreak.count, cause: "stale-screen", pauseMs: AUTO_REPEAT_PAUSE_MS });
                this.clickStreak = null;
              }
            }
            this.logAuto({ event: "stale-screen" });
          }
          if (fresh && message.text && isKnockoutText(message.text)) {
            const inline = this.lastInlineKeyboard.get(message.peerId) ?? null;
            const composer = this.lastComposerKeyboard.get(message.peerId) ?? null;
            const inlineBattle = inline?.keyboard != null && isBattleKeyboard(inline.keyboard);
            const composerBattle = composer?.keyboard != null && isBattleKeyboard(composer.keyboard);
            if (inlineBattle) this.lastInlineKeyboard.delete(message.peerId);
            if (composerBattle) this.lastComposerKeyboard.delete(message.peerId);
            this.battleStates.delete(message.peerId);
            this.recoveryByPeer.set(message.peerId, Date.now());
            this.logAuto({ event: "knockout" });
          }
          if (fresh && message.text && isSceneChangeText(message.text)) {
            const inline = this.lastInlineKeyboard.get(message.peerId) ?? null;
            const composer = this.lastComposerKeyboard.get(message.peerId) ?? null;
            const inlineBattle = inline?.keyboard != null && isBattleKeyboard(inline.keyboard);
            const composerBattle = composer?.keyboard != null && isBattleKeyboard(composer.keyboard);
            if (inlineBattle) this.lastInlineKeyboard.delete(message.peerId);
            if (composerBattle) this.lastComposerKeyboard.delete(message.peerId);
            if (inlineBattle || composerBattle || this.battleStates.has(message.peerId)) {
              this.battleStates.delete(message.peerId);
            }
            if (inlineBattle || composerBattle) {
              this.logAuto({ event: "battle-over", scene: trimLoadingPrefix(message.text).slice(0, 60) });
            }
          }
          this.lastBotMessageTs.set(message.peerId, Math.max(this.lastBotMessageTs.get(message.peerId) ?? 0, message.ts));
          if (!message.keyboard) continue;
          const anchored = { ...message, ts: this.keyboardFirstSeen.get(message.key) ?? message.ts };
          if (message.keyboard.inline) {
            if (isStaleDomInline(message.source, message.conversationMessageId, this.lastBotCmid.get(message.peerId) ?? 0)) {
              continue;
            }
            if (fresh) {
              this.lastInlineKeyboard.set(message.peerId, anchored);
              if (changedKeyboardKeys.has(message.key)) this.lastProgressAt = Date.now();
            }
          } else if (fresh) {
            this.lastComposerKeyboard.set(message.peerId, anchored);
            if (changedKeyboardKeys.has(message.key)) this.lastProgressAt = Date.now();
          }
        }
      }
      const keyboards = effective.filter((message) => message.keyboard !== null).map((message) => ({
        key: message.key,
        peerId: message.peerId,
        ts: this.keyboardFirstSeen.get(message.key) ?? message.ts,
        keyboard: message.keyboard
      }));
      if (keyboards.length) {
        await this.writeQuiet("keyboards", keyboards);
        for (const record of keyboards) {
          const bucket = this.keyboardBuckets.get(record.peerId) ?? [];
          bucket.push(record);
          this.keyboardBuckets.set(record.peerId, bucket);
          this.keyboardBucketsDirty.add(record.peerId);
        }
        const before = this.state.battleCandidates.length;
        const freshBattle = keyboards.map((record) => record.keyboard).filter((keyboard) => isBattleKeyboard(keyboard));
        if (freshBattle.length > 0) {
          this.battleKeyboards.push(...freshBattle);
          if (this.battleKeyboards.length > BATTLE_KEYBOARDS_KEEP) {
            this.battleKeyboards = this.battleKeyboards.slice(-BATTLE_KEYBOARDS_KEEP);
          }
          this.state.battleCandidates = collectBattleButtons(this.battleKeyboards);
          if (this.state.battleCandidates.length !== before) this.panel?.update(this.state);
        }
      }
      if (result.decisions.length) {
        await this.writeQuiet("decisions", result.decisions);
        for (const decision of result.decisions) this.decisionsByKey.set(decision.key, decision);
        for (const decision of result.decisions) {
          const battle = this.battleStates.get(decision.peerId);
          const label = decision.button ?? decision.text;
          if (battle && label) {
            this.battleStates.set(decision.peerId, markOutgoingBattleAction(battle, label));
          }
          if (label !== null && /Прервать/u.test(label)) {
            this.cacheUntilByPeer.delete(decision.peerId);
            this.helicopterUntilByPeer.delete(decision.peerId);
          }
          const anomaly = this.anomalyStates.get(decision.peerId);
          const direction = anomaly !== void 0 && label !== null ? directionFromButtonText(label) : null;
          if (anomaly !== void 0 && direction !== null) {
            this.anomalyStates.set(decision.peerId, markAnomalyMove(anomaly, direction));
          }
        }
      }
      await this.relinkDecisions(result.decisions, keyboards);
      this.countsDirty = true;
      this.refreshCountsSoon();
      this.evaluateAdvice();
      this.panel?.update(this.state);
    }
    /** Актуальная клавиатура развилки: инлайн события, пока оно не закрыто, иначе клавиатура под полем. */
    currentForkKeyboard(peerId) {
      return pickForkKeyboard(
        this.lastInlineKeyboard.get(peerId) ?? null,
        this.lastComposerKeyboard.get(peerId) ?? null,
        this.lastBotMessageTs.get(peerId) ?? 0
      );
    }
    lastComposerMissingLogAt = 0;
    /** Пересчитывает совет для текущего чата: последний текст бота + последняя клавиатура. */
    evaluateAdvice() {
      const shownPeer = this.state.currentPeerId;
      this.state.gardenSlots = shownPeer !== null ? this.gardenSlotsByPeer.get(shownPeer) ?? null : null;
      if (this.state.mode === "observe") {
        this.state.advice = null;
        return;
      }
      const peerId = this.state.currentPeerId;
      if (peerId === null || !this.isGamePeer(peerId)) {
        this.state.advice = null;
        return;
      }
      let keyboardMessage = this.currentForkKeyboard(peerId);
      let keyboard = keyboardMessage?.keyboard ?? null;
      if (this.state.mode === "auto" && keyboard !== null) {
        const hasContinue = keyboard.buttons.flat().some((button) => isContinueButton(button));
        if (!hasContinue && Date.now() - this.lastComposerMissingLogAt > 1e4) {
          this.lastComposerMissingLogAt = Date.now();
          this.logAuto({
            event: "no-continue",
            inline: keyboard.inline,
            buttons: keyboard.buttons.flat().map((button) => trimLoadingPrefix(button.text)),
            composerKnown: this.lastComposerKeyboard.has(peerId)
          });
        }
      }
      const text = keyboardMessage?.text || this.lastBotText.get(peerId) || "";
      const anomaly = this.anomalyStates.get(peerId) ?? null;
      if (keyboard?.inline && isUnparsedColorTask(text) && Date.now() - this.lastColorMissLogAt > 3e4) {
        this.lastColorMissLogAt = Date.now();
        this.logAuto({
          event: "color-parse-miss",
          task: (text.split("\n").find((line) => line.includes("\u0417\u0430\u0434\u0430\u043D\u0438\u0435")) ?? text).slice(0, 100)
        });
      }
      this.updateRestPhase(peerId, keyboard);
      const recoveryTs = this.recoveryByPeer.get(peerId);
      const recovery = recoveryTs !== void 0 && Date.now() - recoveryTs < RECOVERY_TTL_MS;
      if (recoveryTs !== void 0 && !recovery) this.recoveryByPeer.delete(peerId);
      const options = {
        battleRotation: this.state.battleRotation,
        battleAutoExpand: this.state.battleAutoExpand,
        battle: this.battleStates.get(peerId) ?? null,
        recovery,
        events: this.state.eventRules,
        helicopter: Date.now() < (this.helicopterUntilByPeer.get(peerId) ?? 0),
        caches: Date.now() < (this.cacheUntilByPeer.get(peerId) ?? 0),
        anomalyExit: this.anomalyExitByPeer.has(peerId),
        anomalyTypeRules: this.state.anomalyTypeRules.rules,
        anomalyBonusLimit: this.anomalyBonusLimitByPeer.get(peerId) ?? null,
        rest: {
          enabled: this.state.restGuard,
          thresholdPercent: this.state.restHpPercent,
          hpPercent: this.lastHpPercent.get(peerId) ?? null,
          phase: this.restPhaseByPeer.get(peerId) ?? null
        }
      };
      this.state.advice = buildAdvice({ text, keyboard, ts: keyboardMessage?.ts ?? Date.now(), anomaly }, options);
      const computed = this.state.advice;
      if (computed && isExpiredFishingAdvice(computed)) {
        if (Date.now() - this.lastExpiredLogAt > 3e4) {
          this.lastExpiredLogAt = Date.now();
          this.logAuto({
            event: "advice-expired",
            kind: computed.kind,
            ageMs: Date.now() - computed.ts,
            inline: keyboardMessage?.keyboard?.inline ?? false
          });
        }
        if (keyboardMessage?.keyboard?.inline) {
          this.lastInlineKeyboard.delete(peerId);
        }
        const next = this.currentForkKeyboard(peerId);
        this.state.advice = buildAdvice({
          text: next?.text || this.lastBotText.get(peerId) || "",
          keyboard: next?.keyboard ?? null,
          ts: next?.ts ?? Date.now(),
          anomaly
        }, options);
        keyboardMessage = next;
        keyboard = next?.keyboard ?? null;
      }
      if (this.state.mode === "auto") {
        void this.recordFork(peerId, keyboard);
        this.updatePendingChoice(peerId, keyboard);
        this.scheduleAuto();
      }
    }
    /**
     * Запоминает развилку: кнопки на момент события, счётчик, время.
     * Не развилка (не записывается): ситуация советника — рыбалка/бой, даже когда
     * совет не нашёл кнопку, — и чистая навигация без кнопок выбора.
     */
    async recordFork(peerId, keyboard) {
      if (!keyboard || this.state.advice) return;
      if (!isForkKeyboard(keyboard)) return;
      const signature = forkSignature(keyboard);
      if (!signature) return;
      const existing = findForkRule(this.state.forkRules, signature);
      if (existing && Date.now() - existing.ts < FORK_RULE_REFRESH_MS) return;
      const buttons = keyboard.buttons.flat().map((button) => trimLoadingPrefix(button.text)).filter((text) => text.length > 0);
      const upsert = upsertForkRule(this.state.forkRules, signature, buttons, Date.now());
      if (!upsert.changed) return;
      this.state.forkRules = upsert.rules;
      try {
        await setMeta("forkRules", this.state.forkRules);
      } catch (error) {
        this.noteStorageError(error, "forkRules");
      }
    }
    /** Видимая клавиатура под полем ввода изменилась или вернулась — актуализируем фон. */
    handleComposerKeyboard(keyboardRaw, peerId) {
      try {
        if (peerId === null || !this.isGamePeer(peerId)) return;
        if (Date.now() - this.lastAutoClickAt < this.composerSyncSuppressMs) return;
        const message = normalizeMessage(
          {
            id: -stableNumericId(`${peerId}:${JSON.stringify(keyboardRaw)}`),
            peer_id: peerId,
            out: 0,
            date: Math.floor(Date.now() / 1e3),
            text: "",
            keyboard: keyboardRaw
          },
          { source: "dom", ts: Date.now(), peerId }
        );
        if (!message?.keyboard || message.keyboard.inline) return;
        const current = this.lastComposerKeyboard.get(peerId) ?? null;
        if (keyboardsEqual(current?.keyboard ?? null, message.keyboard)) return;
        this.lastComposerKeyboard.set(peerId, message);
        this.lastProgressAt = Date.now();
        this.lastGameActivityAt = Date.now();
        this.clickStreak = null;
        this.logAuto({
          event: "composer-sync",
          buttons: message.keyboard.buttons.flat().map((button) => button.text),
          replaced: current?.keyboard?.buttons.flat().map((button) => button.text) ?? null
        });
        this.evaluateAdvice();
        this.panel?.update(this.state);
      } catch (error) {
        this.reportError(error, "composer keyboard");
      }
    }
    /**
     * Показывает кнопки игры, когда авто-режим не знает, что нажать.
     * Не спрашивает: про ситуации советника (рыбалка/бой), чистую навигацию
     * («Уйти|Инвентарь») и когда план уже есть (правило или продолжение).
     */
    updatePendingChoice(peerId, keyboard) {
      const previous = this.state.pendingChoice;
      this.state.pendingChoice = null;
      if (!keyboard || this.manualChoice) return;
      if (this.state.advice) return;
      if (!isForkKeyboard(keyboard)) return;
      const action = nextAutoAction(keyboard, {
        advice: this.state.advice,
        delays: this.state.autoDelays,
        manualChoice: null,
        forkRules: this.state.forkRules
      });
      if (action) return;
      const buttons = keyboard.buttons.flat().filter((button) => !isContinueButton(button)).map((button) => trimLoadingPrefix(button.text)).filter((text) => text.length > 0);
      if (buttons.length === 0) return;
      this.state.pendingChoice = { peerId, ts: Date.now(), buttons };
      const changed = previous === null || previous.peerId !== peerId || previous.buttons.join("") !== buttons.join("");
      if (changed) this.logAuto({ event: "pending-choice", buttons });
    }
    /**
     * Диагностика авто-режима в лог: план, клик, ретрай, причина простоя.
     *
     * Дедуп: одинаковые события (имя + кнопка) подряд в пределах
     * LOG_AUTO_DEDUPE_MS пишутся один раз. Рекурсия отдыха 08.11 успевала
     * породить 4993 одинаковых rest-start в одну миллисекунду — storm транзакций
     * подрезки квоты заморозил raw-стор (диагностика перестала писаться во ВСЕХ
     * вкладках до перезагрузки). Одинаковые соседние события диагностической
     * ценности не несут — срезаем на входе.
     */
    logAuto(event) {
      const name = typeof event.event === "string" ? event.event : "?";
      const button = typeof event.button === "string" ? event.button : "";
      const signature = `${name}${button}`;
      const now = Date.now();
      if (signature === this.lastAutoLogSig && now - this.lastAutoLogAt < LOG_AUTO_DEDUPE_MS) return;
      this.lastAutoLogSig = signature;
      this.lastAutoLogAt = now;
      void this.storeRaw({ source: "auto", kind: "auto", peerId: this.state.currentPeerId, payload: event }).catch(() => {
      });
    }
    /** Планирует ближайшее автонажатие по текущему состоянию. */
    scheduleAuto() {
      const prevPlan = this.plannedAction;
      const prevTimerActive = this.autoTimer !== null;
      this.cancelAutoPlan();
      const peerId = this.state.currentPeerId;
      if (peerId === null || !this.isGamePeer(peerId)) return;
      if (this.captchaActive()) {
        this.cancelAutoPlan();
        return;
      }
      if (this.state.blindFishing && Date.now() < this.fishingUntil) {
        this.cancelAutoPlan();
        this.state.autoPlan = null;
        return;
      }
      if (Date.now() < this.manualTakeoverUntil) {
        this.cancelAutoPlan();
        this.state.manualPaused = true;
        return;
      }
      if (this.state.manualPaused) {
        this.state.manualPaused = false;
        this.panel?.update(this.state);
      }
      if (Date.now() < this.state.autoRepeatPauseUntil) {
        this.state.autoPlan = null;
        return;
      }
      if (this.state.advice?.hold) {
        this.state.autoPlan = null;
        return;
      }
      if (this.state.gardenAutoSell) {
        const slots = this.gardenSlotsByPeer.get(peerId) ?? null;
        if (isGardenFull(slots) && Date.now() - this.gardenSellAt > GARDEN_SELL_RETRY_MS) {
          const kept2 = keepEarliestPlanAt(
            { timerActive: prevTimerActive, plan: prevPlan },
            { button: GARDEN_SELL_COMMAND, reason: "rule", detached: true },
            this.state.autoDelays.other,
            Date.now()
          );
          if (!kept2.reused) this.retryCount = 0;
          this.plannedAction = { button: GARDEN_SELL_COMMAND, reason: "rule", detached: true, at: kept2.at, sendText: true };
          this.state.autoPlan = { button: GARDEN_SELL_COMMAND, reason: "rule", at: kept2.at };
          this.autoTimer = window.setTimeout(() => {
            void this.runAutoClick();
          }, Math.max(0, kept2.at - Date.now()));
          this.logAuto({
            event: "plan",
            button: GARDEN_SELL_COMMAND,
            reason: "rule",
            delayMs: Math.max(0, kept2.at - Date.now()),
            garden: `${slots?.current ?? "?"}/${slots?.limit ?? "?"}`,
            sendText: true
          });
          return;
        }
      }
      const keyboard = this.currentForkKeyboard(peerId)?.keyboard ?? null;
      const action = nextAutoAction(keyboard, {
        advice: this.state.advice,
        delays: this.state.autoDelays,
        manualChoice: this.manualChoice,
        forkRules: this.state.forkRules
      });
      if (!action) {
        if (this.state.advice?.kind === "battle" && this.state.advice.button === null) {
          const rendered = findRenderedRotationButton(
            rotationButtonsForState(this.state.battleRotation, this.battleStates.get(peerId) ?? null)
          );
          if (rendered !== null) {
            const wait = Math.max(
              this.state.autoDelays.battle,
              this.lastAutoClickAt + AUTO_MIN_INTERVAL_MS - Date.now(),
              0
            );
            const kept2 = keepEarliestPlanAt(
              { timerActive: prevTimerActive, plan: prevPlan },
              { button: rendered, reason: "advice", detached: true },
              wait,
              Date.now()
            );
            if (!kept2.reused) this.retryCount = 0;
            this.plannedAction = { button: rendered, reason: "advice", detached: true, at: kept2.at };
            this.state.autoPlan = { button: rendered, reason: "advice", at: kept2.at };
            this.autoTimer = window.setTimeout(() => {
              void this.runAutoClick();
            }, Math.max(0, kept2.at - Date.now()));
            this.logAuto({ event: "plan", button: rendered, reason: "advice", delayMs: Math.max(0, kept2.at - Date.now()), detached: true, source: "dom" });
            return;
          }
        }
        const battleInMap = keyboard !== null && isBattleKeyboard(keyboard);
        const domContinue = battleInMap ? null : findRenderedContinueButton();
        if (domContinue !== null) {
          const kept2 = keepEarliestPlanAt(
            { timerActive: prevTimerActive, plan: prevPlan },
            { button: domContinue, reason: "continue", detached: true },
            this.state.autoDelays.explore,
            Date.now()
          );
          if (!kept2.reused) this.retryCount = 0;
          this.plannedAction = { button: domContinue, reason: "continue", detached: true, at: kept2.at };
          this.state.autoPlan = { button: domContinue, reason: "continue", at: kept2.at };
          this.autoTimer = window.setTimeout(() => {
            void this.runAutoClick();
          }, Math.max(0, kept2.at - Date.now()));
          if (!kept2.reused) {
            this.logAuto({ event: "plan", button: domContinue, reason: "continue", delayMs: Math.max(0, kept2.at - Date.now()), detached: true, source: "dom" });
          }
          return;
        }
        const lastText = this.lastBotText.get(peerId) ?? "";
        const caughtAt = this.lastBotMessageTs.get(peerId) ?? 0;
        if (this.state.mode === "auto" && /Пойман:/u.test(lastText) && Date.now() - caughtAt < 6e4) {
          const kept2 = keepEarliestPlanAt(
            { timerActive: prevTimerActive, plan: prevPlan },
            { button: "\u0417\u0430\u043A\u0438\u043D\u0443\u0442\u044C \u0435\u0449\u0451", reason: "continue", detached: true },
            this.state.autoDelays.explore,
            Date.now()
          );
          if (!kept2.reused) this.retryCount = 0;
          this.plannedAction = { button: "\u0417\u0430\u043A\u0438\u043D\u0443\u0442\u044C \u0435\u0449\u0451", reason: "continue", detached: true, at: kept2.at };
          this.state.autoPlan = { button: "\u0417\u0430\u043A\u0438\u043D\u0443\u0442\u044C \u0435\u0449\u0451", reason: "continue", at: kept2.at };
          this.autoTimer = window.setTimeout(() => {
            void this.runAutoClick();
          }, Math.max(0, kept2.at - Date.now()));
          this.logAuto({ event: "plan", button: "\u0417\u0430\u043A\u0438\u043D\u0443\u0442\u044C \u0435\u0449\u0451", reason: "continue", delayMs: Math.max(0, kept2.at - Date.now()), detached: true });
          return;
        }
        this.updatePendingChoice(peerId, keyboard);
        return;
      }
      const dueToRateLimit = Math.max(0, this.lastAutoClickAt + AUTO_MIN_INTERVAL_MS - Date.now());
      let delay = Math.max(action.delayMs, dueToRateLimit);
      if (action.reason === "advice" && this.state.advice !== null && (this.state.advice.kind === "label" || this.state.advice.kind === "color" || this.state.advice.kind === "icon") && Date.now() - this.lastAutoScrollAt < 4e3) {
        delay = dueToRateLimit;
      }
      const button = trimLoadingPrefix(action.button.text);
      delay = sameButtonCooldownDelay(
        action.reason,
        delay,
        this.autoClickAtByButton.get(button) ?? null,
        Date.now()
      );
      const kept = keepEarliestPlanAt(
        { timerActive: prevTimerActive, plan: prevPlan },
        { button, reason: action.reason, detached: false },
        delay,
        Date.now()
      );
      const at = kept.at;
      if (!kept.reused) this.retryCount = 0;
      const planColor = action.reason === "advice" && this.state.advice?.kind === "color" ? this.state.advice.buttonColor ?? null : null;
      this.plannedAction = { button, reason: action.reason, detached: false, at, color: planColor };
      this.state.autoPlan = { button, reason: action.reason, at };
      this.autoTimer = window.setTimeout(() => {
        void this.runAutoClick();
      }, Math.max(0, at - Date.now()));
      if (!kept.reused) {
        this.logAuto({ event: "plan", button, reason: action.reason, delayMs: Math.max(0, at - Date.now()) });
      }
    }
    cancelAutoPlan() {
      if (this.autoTimer !== null) {
        window.clearTimeout(this.autoTimer);
        this.autoTimer = null;
      }
      this.plannedAction = null;
      this.state.autoPlan = null;
    }
    /**
     * Предел памяти дедупа входящих: ключи ~каждого реального сообщения плюс
     * синтетические клавиатуры; при переполнении роняем старейшую половину
     * (Set итерируется в порядке вставки). Падение в память не критично:
     * повторная доставка старого сообщения обработается как свежее один раз.
     */
    capSeenIncomingKeys() {
      if (this.seenIncomingKeys.size <= SEEN_KEYS_CAP) return;
      let drop = this.seenIncomingKeys.size - SEEN_KEYS_CAP / 2;
      for (const key of this.seenIncomingKeys) {
        this.seenIncomingKeys.delete(key);
        drop -= 1;
        if (drop <= 0) break;
      }
    }
    async runAutoClick() {
      const planned = this.plannedAction;
      this.cancelAutoPlan();
      if (!planned || this.state.mode !== "auto") return;
      if (Date.now() < this.state.autoRepeatPauseUntil) return;
      if (this.captchaActive()) return;
      if (this.state.blindFishing && Date.now() < this.fishingUntil) return;
      const peerId = this.state.currentPeerId;
      if (peerId === null || !this.isGamePeer(peerId)) return;
      if (Date.now() < this.manualTakeoverUntil) {
        this.state.manualPaused = true;
        this.panel?.update(this.state);
        return;
      }
      try {
        let result;
        if (planned.sendText === true) {
          let sent = false;
          try {
            sent = sendChatMessage(planned.button);
          } catch (error) {
            this.reportError(error, `\u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0430 \xAB${planned.button}\xBB`);
          }
          result = { clicked: sent, found: sent ? 1 : 0 };
        } else {
          result = clickKeyboardButton(planned.button, planned.color ?? null);
        }
        if (!result.clicked) {
          const keyboardMessage = peerId !== null ? this.currentForkKeyboard(peerId) : null;
          const keyboard = keyboardMessage?.keyboard ?? null;
          const scrollVia = this.retryCount === 1 || Date.now() < this.fishingUntil ? scrollChatToBottom() : null;
          if (scrollVia !== null) {
            this.lastAutoScrollAt = Date.now();
            this.logAuto({ event: "auto-scroll", source: "retry", button: planned.button, via: scrollVia });
          }
          if (this.retryCount === 1 && expandCollapsedActions()) {
            this.logAuto({ event: "expand-actions", button: planned.button, reason: planned.reason });
          }
          if (!planned.sendText && this.state.advice?.kind === "anomaly" && this.retryCount >= 1) {
            try {
              if (clickFirstUnlabeledButton()) {
                this.lastAutoClickAt = Date.now();
                this.lastAutoClickSuccessAt = Date.now();
                this.autoClickAtByButton.set(planned.button, Date.now());
                this.state.autoClicks += 1;
                this.logAuto({ event: "spinner-click", button: planned.button, retries: this.retryCount });
                return;
              }
            } catch (error) {
              this.reportError(error, "\u043A\u043B\u0438\u043A \u043F\u043E \u043A\u043D\u043E\u043F\u043A\u0435-\u0441\u043F\u0438\u043D\u043D\u0435\u0440\u0443");
            }
          }
          if (!planned.sendText && this.state.advice?.kind === "battle" && this.retryCount >= 2 && peerId !== null) {
            const renderedNow = findRenderedKeyboard(this.lastBotCmid.get(peerId) ?? 0);
            const renderedKb = renderedNow !== null ? normalizeKeyboard(renderedNow.raw) : null;
            if (renderedKb !== null && isActionsMenuKeyboard(renderedKb) && findButtonByTextMatch(renderedKb, planned.button) === null) {
              try {
                if (clickKeyboardButton("\u{1F3AF} \u041A \u0431\u043E\u044E").clicked) {
                  this.lastAutoClickAt = Date.now();
                  this.composerSyncSuppressMs = COMPOSER_SYNC_SUPPRESS_MS;
                  this.autoClickAtByButton.set("\u{1F3AF} \u041A \u0431\u043E\u044E", Date.now());
                  this.state.autoClicks += 1;
                  this.logAuto({ event: "submenu-exit", button: planned.button });
                  this.cancelAutoPlan();
                  this.evaluateAdvice();
                  return;
                }
              } catch (error) {
                this.reportError(error, "\u0432\u044B\u0445\u043E\u0434 \u0438\u0437 \u043F\u043E\u0434\u043C\u0435\u043D\u044E \u0431\u043E\u044F");
              }
            }
          }
          if ((hasStuckLoadingButton() || result.found > 0) && Date.now() - this.lastKeyboardReloadAt > KEYBOARD_RELOAD_MIN_INTERVAL_MS) {
            try {
              if (cycleComposerKeyboard()) {
                this.lastKeyboardReloadAt = Date.now();
                this.logAuto({ event: "keyboard-reload", button: planned.button, reason: planned.reason });
              }
            } catch (error) {
              this.reportError(error, "\u043F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u043A\u043B\u0430\u0432\u0438\u0430\u0442\u0443\u0440\u044B");
            }
          }
          if (!planned.detached && keyboard !== null && this.retryCount >= 3 && !isBattleKeyboard(keyboard)) {
            const texts = keyboard.buttons.flat().map((button) => button.text);
            if (!isAnyButtonRendered(texts)) {
              if (keyboard.inline) this.lastInlineKeyboard.delete(peerId);
              else this.lastComposerKeyboard.delete(peerId);
              this.logAuto({
                event: "keyboard-gone",
                inline: keyboard.inline,
                buttons: texts.map((text) => trimLoadingPrefix(text))
              });
              this.cancelAutoPlan();
              this.captureRenderedKeyboard(peerId);
              this.evaluateAdvice();
              this.panel?.update(this.state);
              return;
            }
          }
          const stillRelevant = planned.detached || keyboard !== null && findButtonByTextMatch(keyboard, planned.button) !== null;
          this.retryCount += 1;
          if (!stillRelevant || this.retryCount >= 10) {
            if (planned.sendText === true) this.gardenSellAt = Date.now();
            this.logAuto({ event: "drop-plan", button: planned.button, reason: planned.reason, stillRelevant, retries: this.retryCount });
            this.cancelAutoPlan();
            this.evaluateAdvice();
            this.panel?.update(this.state);
            return;
          }
          this.plannedAction = { ...planned, at: Date.now() + 1e3 };
          this.state.autoPlan = { button: planned.button, reason: planned.reason, at: Date.now() + 1e3 };
          this.autoTimer = window.setTimeout(() => {
            void this.runAutoClick();
          }, 1e3);
          this.logAuto({ event: "retry", button: planned.button, reason: planned.reason, retries: this.retryCount });
          return;
        }
        this.accountAutoClickSuccess(planned, peerId, result);
      } catch (error) {
        this.reportError(error, `auto click "${planned.button}"`);
        this.logAuto({ event: "error", button: planned.button, message: error instanceof Error ? error.message : String(error) });
      } finally {
        this.panel?.update(this.state);
      }
    }
    /**
     * Учёт успешного автонажатия: счётчики, кулдауны, серия repeat-pause,
     * пометка боя.
     */
    accountAutoClickSuccess(planned, peerId, result) {
      this.lastAutoClickAt = Date.now();
      this.lastProgressAt = Date.now();
      this.state.autoClicks += 1;
      this.lastAutoClickButton = planned.button;
      this.lastAutoClickSuccessAt = Date.now();
      this.autoClickAtByButton.set(planned.button, Date.now());
      if (planned.sendText === true) this.gardenSellAt = Date.now();
      if (planned.reason === "manual") this.manualChoice = null;
      if (planned.button.includes("\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F")) {
        this.composerSyncSuppressMs = SUBMENU_SYNC_SUPPRESS_MS;
        window.setTimeout(() => {
          const current = this.state.currentPeerId;
          if (current === null || !this.isGamePeer(current)) return;
          if (this.captureRenderedKeyboard(current)) {
            this.evaluateAdvice();
            if (this.state.mode === "auto") this.scheduleAuto();
          }
        }, SUBMENU_SYNC_SUPPRESS_MS + 200);
      } else {
        this.composerSyncSuppressMs = COMPOSER_SYNC_SUPPRESS_MS;
      }
      if (result?.mode === "prefix") {
        this.logAuto({ event: "prefix-click", button: planned.button, matched: result.matchedText ?? "" });
      }
      if (planned.sendText !== true) {
        this.clickStreak = nextClickStreak(this.clickStreak, planned.button);
        if (this.clickStreak.count >= AUTO_SAME_CLICK_LIMIT) {
          if (hasStuckLoadingButton()) {
            this.clickStreak = null;
            if (Date.now() - this.lastKeyboardReloadAt > KEYBOARD_RELOAD_MIN_INTERVAL_MS) {
              try {
                if (cycleComposerKeyboard()) {
                  this.lastKeyboardReloadAt = Date.now();
                  this.logAuto({ event: "keyboard-reload", button: planned.button, source: "stuck" });
                }
              } catch (error) {
                this.reportError(error, "\u043F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u043A\u043B\u0430\u0432\u0438\u0430\u0442\u0443\u0440\u044B");
              }
            }
          } else {
            this.state.autoRepeatPauseUntil = Date.now() + AUTO_REPEAT_PAUSE_MS;
            this.logAuto({ event: "repeat-pause", button: planned.button, clicks: this.clickStreak.count, pauseMs: AUTO_REPEAT_PAUSE_MS });
            this.clickStreak = null;
          }
        }
      }
      if (planned.sendText !== true && peerId !== null) {
        const battle = this.battleStates.get(peerId);
        if (battle) {
          this.battleStates.set(peerId, markOutgoingBattleAction(battle, planned.button));
        }
      }
      if (typeof console !== "undefined" && console.info) {
        console.info("[Stalker Assistant] auto click:", planned.button, `(${planned.reason})`);
      }
      this.logAuto({ event: "click", button: planned.button, reason: planned.reason });
    }
    /** Решение цикла self-poll: пора ли тянуть хвост истории (см. SELF_POLL_*). */
    maybeSelfPoll() {
      if (!this.initDone || !this.state.recording) return;
      if (this.state.mode === "observe") return;
      if (!this.state.isGameChat) return;
      const interval = this.state.mode === "auto" ? SELF_POLL_AUTO_MS : SELF_POLL_ADVICE_MS;
      if (Date.now() - this.lastSelfPollAt < interval) return;
      void this.runSelfPoll();
    }
    /**
     * Собственный опрос хвоста истории (сетевой захват): сообщения с заданиями
     * приходят транспортом, который не перехватывается, и без опроса видны
     * только смонтированными в DOM. Ответ идёт в общий конвейер handleApi как
     * «не-история» (карты и состояния обновляют только новые сообщения —
     * дедупликация по ключу пропускает уже виденное).
     */
    async runSelfPoll() {
      if (!this.initDone || !this.state.recording) return;
      if (this.selfPollInFlight) return;
      const peerId = this.state.currentPeerId;
      if (peerId === null || !this.isGamePeer(peerId)) return;
      const template = this.apiTemplate;
      if (template === null || template.token.length === 0) return;
      this.selfPollInFlight = true;
      this.lastSelfPollAt = Date.now();
      try {
        const result = await fetchHistoryTail(template, peerId, SELF_POLL_COUNT);
        if (!result.ok) {
          if (result.error !== null) this.logAuto({ event: "self-poll", error: result.error });
          return;
        }
        const before = this.state.counts.messages;
        const url = buildMethodUrl(template, "messages.getHistory");
        await this.handleApi("messages.getHistory", reverseHistoryItems(result.json), {
          url,
          request: buildHistoryParams(template, peerId, SELF_POLL_COUNT),
          source: "self-poll",
          peerId
        }, { history: false });
        const gained = this.state.counts.messages - before;
        if (gained > 0) {
          this.logAuto({ event: "self-poll", newMessages: gained });
        }
      } catch (error) {
        this.reportError(error, "self-poll");
      } finally {
        this.selfPollInFlight = false;
      }
    }
    /**
     * Перепривязка решений к клавиатурам. Работает по кэшу в памяти: полный проход —
     * только на старте; дальше пересчитываются лишь новые решения и те, чья привязка
     * может улучшиться (не payload и время попадает в окно новых клавиатур). Раньше
     * каждый батч перечитывал оба стора целиком — с ростом базы до десятков тысяч
     * записей это замедляло страницу до ощутимых пауз.
     */
    /**
     * Пересортировка бакетов пиров, куда добавились записи (лениво — только
     * перед relink, а не на каждом батче: опрос ВК приносит одни и те же
     * клавиатуры каждые ~5 с, и записи почти всегда добавляются в конец).
     */
    sortKeyboardBuckets() {
      for (const peerId of this.keyboardBucketsDirty) {
        const bucket = this.keyboardBuckets.get(peerId);
        if (bucket === void 0) continue;
        const byKey = /* @__PURE__ */ new Map();
        for (const record of bucket) byKey.set(record.key, record);
        this.keyboardBuckets.set(peerId, [...byKey.values()].sort((a, b) => a.ts - b.ts));
      }
      this.keyboardBucketsDirty.clear();
    }
    async relinkDecisions(newDecisions, newKeyboards) {
      if (this.keyboardBuckets.size === 0 || this.decisionsByKey.size === 0) return;
      try {
        let candidates;
        if (newDecisions === void 0) {
          candidates = [...this.decisionsByKey.values()];
        } else {
          if (newDecisions.length === 0 && (newKeyboards?.length ?? 0) === 0) return;
          const minKbTs = newKeyboards?.length ? Math.min(...newKeyboards.map((record) => record.ts)) : Number.POSITIVE_INFINITY;
          const maxKbTs = newKeyboards?.length ? Math.max(...newKeyboards.map((record) => record.ts)) : Number.NEGATIVE_INFINITY;
          const freshKeys = new Set(newDecisions.map((decision) => decision.key));
          candidates = [...newDecisions];
          for (const decision of this.decisionsByKey.values()) {
            if (freshKeys.has(decision.key)) continue;
            if (decision.offeredBy !== null && decision.match === "payload") continue;
            if (decision.ts + MAX_LINK_AGE_MS < minKbTs) continue;
            if (decision.ts > maxKbTs + MAX_LINK_FUTURE_SKEW_MS) continue;
            candidates.push(decision);
          }
        }
        const updates = [];
        this.sortKeyboardBuckets();
        for (const decision of candidates) {
          const bucket = this.keyboardBuckets.get(decision.peerId);
          if (bucket === void 0 || bucket.length === 0) continue;
          const window2 = keyboardWindow(bucket, decision.ts);
          if (window2.length === 0) continue;
          const linked = linkDecision(decision, window2, void 0, void 0, true);
          if (linked.offeredBy !== decision.offeredBy || linked.button !== decision.button || linked.match !== decision.match) {
            this.decisionsByKey.set(linked.key, linked);
            updates.push(linked);
          }
        }
        if (updates.length) await this.writeQuiet("decisions", updates);
      } catch (error) {
        this.noteStorageError(error, "decisions (\u043F\u0435\u0440\u0435\u043F\u0440\u0438\u0432\u044F\u0437\u043A\u0430)");
      }
    }
    async readCounts() {
      const [messages, decisions, keyboards, raw] = await Promise.all([
        countStore("messages"),
        countStore("decisions"),
        countStore("keyboards"),
        countStore("raw")
      ]);
      return { messages, decisions, keyboards, raw };
    }
    /** Порог «слишком большого» raw-payload (примерная длина JSON в символах). */
    static RAW_PAYLOAD_MAX_CHARS = 5e5;
    async storeRaw(event) {
      const stats = { nodes: 0, chars: 0 };
      const payload = sanitizeForStorage(event.payload, 0, /* @__PURE__ */ new WeakSet(), stats);
      const safePayload = stats.chars > _Runtime.RAW_PAYLOAD_MAX_CHARS ? { truncated: true, size: stats.chars } : payload;
      const record = {
        id: `${Date.now()}-${this.rawSeq++}`,
        ts: Date.now(),
        source: event.source,
        kind: event.kind,
        method: event.method ?? null,
        url: event.url ?? null,
        peerId: event.peerId ?? null,
        payload: safePayload
      };
      this.countsDirty = true;
      this.refreshCountsSoon();
      await this.writeQuiet("raw", [record]);
    }
    /** Запись в базу без остановки обработки: копится в буфер, пишется пачкой. */
    writeQuiet(store, items, onDropped) {
      if (items.length === 0) return Promise.resolve();
      const list = this.pendingWrites.get(store) ?? [];
      list.push(...items);
      if (list.length > PENDING_WRITES_CAP) {
        list.splice(0, list.length - PENDING_WRITES_CAP / 2);
        this.noteStorageError(new Error("pending writes overflow"), store);
      }
      this.pendingWrites.set(store, list);
      if (onDropped) {
        const callbacks = this.pendingDropCallbacks.get(store) ?? [];
        callbacks.push(onDropped);
        this.pendingDropCallbacks.set(store, callbacks);
      }
      if (this.writeTimer === null) {
        this.writeTimer = window.setTimeout(() => {
          this.writeTimer = null;
          void this.flushWrites();
        }, WRITE_FLUSH_MS);
      }
      return Promise.resolve();
    }
    /** Сброс буфера записей в базу: одна транзакция на стор. */
    async flushWrites() {
      if (this.writeTimer !== null) {
        window.clearTimeout(this.writeTimer);
        this.writeTimer = null;
      }
      if (this.pendingWrites.size === 0) return;
      const batch = this.pendingWrites;
      this.pendingWrites = /* @__PURE__ */ new Map();
      const batchCallbacks = this.pendingDropCallbacks;
      this.pendingDropCallbacks = /* @__PURE__ */ new Map();
      await Promise.all([...batch.entries()].map(
        ([store, items]) => putMany(store, items).catch(async (error) => {
          if (store === "raw") {
            if (this.rawRecoveryInFlight && Date.now() - this.rawRecoveryStartedAt < RAW_RECOVERY_WATCHDOG_MS) {
              this.noteWriteFailure(error, store);
              this.stashDiagnostics(items);
              return;
            }
            this.rawRecoveryInFlight = true;
            this.rawRecoveryStartedAt = Date.now();
            try {
              await pruneStore("raw", this.rawQuotaKeep);
              await putMany("raw", items);
              this.rawQuotaKeep = RAW_KEEP_ON_QUOTA;
            } catch (retryError) {
              this.rawQuotaKeep = Math.max(1e3, Math.floor(this.rawQuotaKeep / 2));
              this.noteWriteFailure(retryError, "raw");
              this.stashDiagnostics(items);
            } finally {
              this.rawRecoveryInFlight = false;
            }
            return;
          }
          if (store === "messages") {
            try {
              await pruneStore("messages", this.messageQuotaKeep);
              await putMany("messages", items);
              this.messageQuotaKeep = MESSAGE_KEEP_ON_QUOTA;
              return;
            } catch (retryError) {
              this.messageQuotaKeep = Math.max(1e3, Math.floor(this.messageQuotaKeep / 2));
              this.noteWriteFailure(retryError, store);
            }
          } else {
            this.noteWriteFailure(error, store);
          }
          const callbacks = batchCallbacks.get(store) ?? [];
          for (const callback of callbacks) callback();
        })
      ));
    }
    /** Ошибка записи: в панель (троттлинг) и в лог с текстом ошибки — по экспорту видно, что именно падает. */
    noteWriteFailure(error, store) {
      this.noteStorageError(error, store);
      const last = this.lastWriteFailLogAt.get(store) ?? 0;
      if (Date.now() - last < 3e4) return;
      this.lastWriteFailLogAt.set(store, Date.now());
      this.logAuto({
        event: "write-failed",
        store,
        message: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      });
    }
    /**
     * Диагностика (события logAuto), чья запись в raw не прошла, — в
     * localStorage: разбор пауз не должен зависеть от здоровья raw-стора.
     * Хранятся только авто-события (мелкие), не дампы ответов API.
     */
    stashDiagnostics(items) {
      const diagnostics = items.filter((item) => item.source === "auto" && item.kind === "auto");
      if (diagnostics.length === 0) return;
      try {
        const raw = localStorage.getItem(DIAG_BUFFER_KEY);
        const buffer = raw !== null ? JSON.parse(raw) : [];
        for (const record of diagnostics) {
          buffer.push({ ts: record.ts, payload: record.payload });
        }
        while (buffer.length > DIAG_BUFFER_CAP) buffer.shift();
        localStorage.setItem(DIAG_BUFFER_KEY, JSON.stringify(buffer));
      } catch {
      }
    }
    /** Переложить буфер диагностики из localStorage в базу (зовётся из init). */
    relogStashedDiagnostics() {
      let buffer = [];
      try {
        const raw = localStorage.getItem(DIAG_BUFFER_KEY);
        if (raw === null) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) buffer = parsed;
      } catch {
        return;
      }
      if (buffer.length === 0) return;
      for (const entry of buffer) {
        const payload = typeof entry.payload === "object" && entry.payload !== null ? entry.payload : {};
        this.logAuto({ ...payload, ts: entry.ts, stashed: true });
      }
      try {
        localStorage.removeItem(DIAG_BUFFER_KEY);
      } catch {
      }
    }
    /**
     * Счётчики панели пересчитываются не чаще раза в COUNT_REFRESH_MS и только
     * когда были записи: реальный пересчёт — четыре IDB-count транзакции.
     */
    refreshCountsSoon() {
      if (this.countsTimer !== null) return;
      this.countsTimer = window.setTimeout(() => {
        this.countsTimer = null;
        if (!this.countsDirty) return;
        this.countsDirty = false;
        this.readCounts().then((counts) => {
          this.state.counts = counts;
          this.panel?.update(this.state);
        }).catch(() => {
        });
      }, COUNT_REFRESH_MS);
    }
    noteStorageError(error, store) {
      const now = Date.now();
      if (now - this.lastStorageErrorAt < 3e4) return;
      this.lastStorageErrorAt = now;
      this.reportError(error, `\u0437\u0430\u043F\u0438\u0441\u044C \xAB${store}\xBB`);
    }
  };

  // src/ui/panel.ts
  var MODE_LABELS = {
    observe: "\u041D\u0430\u0431\u043B\u044E\u0434\u0435\u043D\u0438\u0435",
    advice: "\u0421\u043E\u0432\u0435\u0442\u043D\u0438\u043A",
    auto: "\u0410\u0432\u0442\u043E"
  };
  var MODE_ORDER = ["observe", "advice", "auto"];
  var Panel = class {
    elements;
    actions;
    mode = "observe";
    openWindowName = null;
    /**
     * Мемо рендера тяжёлых списков: update() приходит каждую секунду (тик
     * отслеживания чата) и на каждом батче — раньше правила и ротация
     * пересоздавались целиком (десятки узлов с обработчиками) без изменений,
     * создавая постоянный DOM-мусор и перерисовки.
     */
    lastRulesJson = "";
    lastTacticsJson = "";
    lastChoiceKey = "";
    lastEventsJson = "";
    lastAnomalyTypesJson = "";
    constructor(actions) {
      this.actions = actions;
      const host = document.createElement("div");
      host.id = "stalker-assistant-host";
      const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .panel, .modal {
          border-radius: 10px; background: #171b20; color: #e8eaed;
          border: 1px solid #39424d; box-shadow: 0 8px 24px rgba(0,0,0,.45);
          font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .panel {
          position: fixed; right: 14px; bottom: 14px; z-index: 2147483647;
          width: 252px; box-sizing: border-box; padding: 10px 12px;
        }
        .panel.hidden { display: none; }
        .game-note {
          display: none; margin-top: 8px; padding: 7px 8px;
          border: 1px solid #39424d; border-radius: 6px; background: #1d222a;
          color: #aeb6c0; font-size: 11px;
        }
        .game-note.on { display: block; }
        .tab-note {
          display: none; margin-top: 8px; padding: 7px 8px;
          border: 1px solid #6b5a2e; border-radius: 6px; background: #2a2418;
          color: #e0c98a; font-size: 11px;
        }
        .tab-note.on { display: block; }
        .captcha-note {
          display: none; margin-top: 8px; padding: 7px 8px;
          border: 1px solid #8a3a3a; border-radius: 6px; background: #2a1414;
          color: #ffb0b0; font-size: 11px; font-weight: 600;
        }
        .captcha-note.on { display: block; }
        .blind-note {
          display: none; margin-top: 8px; padding: 7px 8px;
          border: 1px solid #2e6b4a; border-radius: 6px; background: #14261c;
          color: #a0e0b8; font-size: 11px;
        }
        .blind-note.on { display: block; }
        .reload-note {
          display: none; margin-top: 8px; padding: 7px 8px;
          border: 1px solid #8a6a2e; border-radius: 6px; background: #2a2014;
          color: #f0d9a0; font-size: 11px; font-weight: 600;
        }
        .reload-note.on { display: block; }
        .update-note {
          display: none; margin-top: 8px; padding: 7px 8px;
          border: 1px solid #2e5a8a; border-radius: 6px; background: #141f2a;
          color: #a8ccf0; font-size: 11px;
        }
        .update-note.on { display: block; }
        .update-note .update-buttons {
          display: flex; gap: 6px; margin-top: 6px;
        }
        .update-note button {
          flex: 1; padding: 4px 6px; cursor: pointer;
          border: 1px solid #3a6a9a; border-radius: 5px;
          background: #1d3245; color: #cfe4f8; font-size: 11px;
        }
        .update-note button:hover { background: #24405a; }
        .backdrop {
          display: none; position: fixed; inset: 0; z-index: 2147483646;
          background: rgba(0,0,0,.45);
        }
        .backdrop.open { display: block; }
        .modal {
          display: none; position: fixed; top: 50%; left: 50%;
          transform: translate(-50%, -50%); z-index: 2147483647;
          width: 340px; max-width: calc(100vw - 24px);
          max-height: 80vh; overflow-y: auto; box-sizing: border-box; padding: 12px 14px;
        }
        .modal.open { display: block; }
        .rule { padding: 6px 0; border-bottom: 1px solid #2a323c; }
        .rule:last-child { border-bottom: none; }
        .rule-head { display: flex; align-items: center; gap: 4px; }
        .rule-head .rule-desc { flex: 1; font-size: 11px; color: #e8eaed; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .rule-head .rule-count { font-size: 10px; color: #7f8894; }
        .rule-current { margin-top: 2px; font-size: 10px; color: #7fc49b; }
        .rule-current.ask { color: #d9a066; }
        .rule-buttons { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
        .rule-buttons button { padding: 2px 6px; font-size: 10px; }
        .rule-buttons button.chosen { border-color: #2f6f4a; background: #1d3a2b; }
        .rules-empty { color: #7f8894; font-size: 11px; padding: 6px 0; }
        .head { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #35c46a; box-shadow: 0 0 6px #35c46a; }
        .dot.off { background: #8a929c; box-shadow: none; }
        .title { flex: 1; font-weight: 600; font-size: 12px; }
        .toggle { padding: 3px 6px; font-size: 10px; }
        .toggle.off { color: #aeb6c0; }
        .row { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; color: #aeb6c0; }
        .row b { color: #e8eaed; font-weight: 600; font-variant-numeric: tabular-nums; }
        .row b.full { color: #ff9b9b; }
        .section-title { color: #7f8894; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; margin: 8px 0 3px; }
        .actions { display: flex; gap: 6px; margin-top: 8px; }
        button {
          appearance: none; border: 1px solid #39424d; background: #232a32; color: #e8eaed;
          border-radius: 6px; padding: 5px 7px; font: inherit; cursor: pointer;
        }
        button:hover { background: #2c3540; }
        button.primary { flex: 1; border-color: #2f6f4a; background: #1d3a2b; }
        button.primary:hover { background: #24503a; }
        button.mode-active { border-color: #8a6d1f; background: #3a2f14; }
        button.window-open { border-color: #8a6d1f; background: #3a2f14; }
        button.danger { color: #ffb4b4; }
        button:disabled { opacity: .6; cursor: default; }
        button.small { padding: 2px 6px; font-size: 10px; }
        .advice {
          display: none; margin-top: 8px; padding: 7px 8px;
          border: 1px solid #8a6d1f; border-radius: 6px; background: #241f10;
        }
        .advice.on { display: block; }
        .advice .advice-title { font-weight: 600; font-size: 12px; color: #ffd76e; }
        .advice .advice-note { margin-top: 2px; font-size: 10px; color: #b3a877; }
        .advice .advice-stale { margin-top: 2px; font-size: 10px; color: #d98f66; }
        .choice {
          display: none; margin-top: 8px; padding: 7px 8px;
          border: 1px solid #7a4a1f; border-radius: 6px; background: #20140c;
        }
        .choice.on { display: block; }
        .choice .choice-title { font-weight: 600; font-size: 11px; color: #ffb066; }
        .choice .choice-note { margin: 2px 0 5px; font-size: 10px; color: #b39177; }
        .choice .choice-buttons { display: flex; flex-direction: column; gap: 4px; }
        .choice .choice-buttons button { text-align: left; }
        .choice .choice-skip { margin-top: 5px; font-size: 10px; color: #7f8894; }
        .plan { margin-top: 6px; font-size: 10px; color: #7fc49b; }
        .delay-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
        .delay-row label { flex: 1; color: #aeb6c0; }
        .delay-row input {
          width: 52px; box-sizing: border-box; padding: 3px 4px; font: inherit;
          border: 1px solid #39424d; border-radius: 6px; background: #232a32; color: #e8eaed;
        }
        .rot-item { display: flex; align-items: center; gap: 4px; padding: 2px 0; }
        .rot-item .num { color: #7f8894; font-size: 10px; width: 14px; text-align: right; }
        .rot-item .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .rot-item.off .name { color: #7f8894; text-decoration: line-through; }
        .rot-item input[type="checkbox"] { margin: 0; }
        .rot-cond { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin: 2px 0 5px 18px; color: #aeb6c0; font-size: 10px; }
        .rot-cond label { display: flex; align-items: center; gap: 3px; }
        .rot-cond input[type="number"] {
          width: 34px; box-sizing: border-box; padding: 2px 3px; font: inherit; font-size: 10px;
          border: 1px solid #39424d; border-radius: 6px; background: #232a32; color: #e8eaed;
        }
        .rot-cond input[type="checkbox"] { margin: 0; }
        .rot-empty { color: #7f8894; font-size: 11px; padding: 4px 0; }
        .extras { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0; }
        .extras button { padding: 3px 6px; font-size: 11px; }
        .cand-title { color: #7f8894; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; margin: 8px 0 3px; }
        .cands { display: flex; flex-wrap: wrap; gap: 4px; }
        .cands button { padding: 3px 6px; font-size: 11px; }
        .cands .none { color: #7f8894; font-size: 11px; }
        .hint { margin-top: 6px; color: #7f8894; font-size: 10px; }
        .error { margin-top: 6px; color: #ff9b9b; font-size: 11px; max-height: 34px; overflow: hidden; word-break: break-word; }
      </style>
      <div class="panel">
        <div class="head">
          <span class="dot"></span>
          <span class="title">Stalker Assistant</span>
          <button class="toggle" type="button">\u0417\u0430\u043F\u0438\u0441\u044C: \u0432\u043A\u043B</button>
        </div>
        <div class="game-note"></div>
        <div class="tab-note"></div>
        <div class="captcha-note"></div>
        <div class="blind-note"></div>
        <div class="reload-note"></div>
        <div class="update-note">
          <div class="update-text"></div>
          <div class="update-buttons">
            <button class="update-reload" type="button">\u{1F504} \u041F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0432\u043A\u043B\u0430\u0434\u043A\u0443</button>
            <button class="update-install" type="button" title="\u041E\u0442\u043A\u0440\u043E\u0435\u0442 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 \u0443\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0438 Tampermonkey \u2014 \u043D\u0430\u0436\u043C\u0438 \u0442\u0430\u043C \xAB\u041F\u0435\u0440\u0435\u0443\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C\xBB, \u0437\u0430\u0442\u0435\u043C \u0432\u0435\u0440\u043D\u0438\u0441\u044C \u0438 \u043F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u0438 \u0432\u043A\u043B\u0430\u0434\u043A\u0443.">\u0423\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0430</button>
          </div>
        </div>
        <div class="row"><span>\u0420\u0435\u0436\u0438\u043C</span><button class="mode" type="button">\u041D\u0430\u0431\u043B\u044E\u0434\u0435\u043D\u0438\u0435</button></div>
        <div class="row"><span>\u0410\u0432\u0442\u043E\u0441\u0431\u0440\u043E\u0441 \u043F\u0440\u0438 \u043F\u0440\u043E\u0441\u0442\u043E\u0435</span><button class="auto-reset toggle" type="button" title="\u041C\u044F\u0433\u043A\u0438\u0439 \u0441\u0431\u0440\u043E\u0441 \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u044F \u0431\u043E\u0442\u0430, \u0435\u0441\u043B\u0438 \u0430\u0432\u0442\u043E-\u0440\u0435\u0436\u0438\u043C \u0434\u043E\u043B\u0433\u043E \u0431\u0435\u0437 \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441\u0430 (3 \u043C\u0438\u043D). \u041B\u043E\u0433\u0438 \u043D\u0435 \u0443\u0434\u0430\u043B\u044F\u044E\u0442\u0441\u044F.">\u0432\u043A\u043B</button></div>
        <div class="row"><span>\u041F\u0430\u0443\u0437\u0430 \u043F\u0440\u0438 \u0440\u0443\u0447\u043D\u044B\u0445 \u043D\u0430\u0436\u0430\u0442\u0438\u044F\u0445</span><button class="manual-toggle toggle" type="button" title="\u0420\u0443\u0447\u043D\u043E\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 (\u043D\u0430\u0436\u0430\u0442\u0438\u0435 \u0441 \u0442\u0435\u043B\u0435\u0444\u043E\u043D\u0430 \u0438\u043B\u0438 \u043D\u0430\u0431\u043E\u0440 \u0442\u0435\u043A\u0441\u0442\u0430) \u043E\u0441\u0442\u0430\u043D\u0430\u0432\u043B\u0438\u0432\u0430\u0435\u0442 \u0430\u0432\u0442\u043E\u043D\u0430\u0436\u0430\u0442\u0438\u044F \u043D\u0430 30 \u0441 \u2014 \u0431\u043E\u0442 \u043D\u0435 \u043C\u0435\u0448\u0430\u0435\u0442 \u0438\u0433\u0440\u0430\u0442\u044C \u0440\u0443\u043A\u0430\u043C\u0438.">\u0432\u043A\u043B</button></div>
        <div class="row"><span>\u041F\u0440\u043E\u0434\u0430\u0432\u0430\u0442\u044C \u0441\u0430\u0434\u043E\u043A \u043F\u0440\u0438 \u043F\u043E\u043B\u043D\u043E\u043C</span><button class="garden-sell toggle" type="button" title="\u041A\u043E\u0433\u0434\u0430 \u0441\u0430\u0434\u043E\u043A \u043F\u043E\u043B\u043E\u043D (35/35 \u2014 \u0440\u044B\u0431\u0430 \u043E\u0442\u043F\u0443\u0441\u043A\u0430\u0435\u0442\u0441\u044F), \u0430\u0432\u0442\u043E-\u0440\u0435\u0436\u0438\u043C \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u044F\u0435\u0442 \u0432 \u0447\u0430\u0442 \u043A\u043E\u043C\u0430\u043D\u0434\u044B \xAB\u041F\u0440\u043E\u0434\u0430\u0442\u044C \u0432\u0441\u044E \u0440\u044B\u0431\u0443\xBB.">\u0432\u044B\u043A\u043B</button></div>
        <div class="row"><span>\u0421\u0442\u0440\u0430\u0436 HP (\u0430\u043D\u043E\u043C\u0430\u043B\u0438\u044F)</span><button class="hp-guard toggle" type="button" title="\u0415\u0441\u043B\u0438 \u0432 \u043F\u043E\u043B\u0435 \u0430\u043D\u043E\u043C\u0430\u043B\u0438\u0438 \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u0435 \u043F\u0430\u0434\u0430\u0435\u0442 \u0434\u043E 25% \u0438 \u043D\u0438\u0436\u0435, \u0430\u0432\u0442\u043E \u043F\u0435\u0440\u0435\u0441\u0442\u0430\u0451\u0442 \u0443\u0433\u043B\u0443\u0431\u043B\u044F\u0442\u044C\u0441\u044F \u0438 \u0432\u044B\u0445\u043E\u0434\u0438\u0442 \u0438\u0437 \u0430\u043D\u043E\u043C\u0430\u043B\u0438\u0438 \u2014 \u0434\u043E\u0431\u0438\u0440\u0430\u0442\u044C \u0430\u0440\u0442\u0435\u0444\u0430\u043A\u0442 \u043F\u0440\u0438 \u0442\u0430\u043A\u043E\u043C HP \u0440\u0438\u0441\u043A\u043E\u0432\u0430\u043D\u043D\u043E.">\u0432\u044B\u043A\u043B</button></div>
        <div class="row"><span>\u0427\u0430\u0442</span><b class="peer">\u2014</b></div>
        <div class="row"><span>\u0421\u0430\u0434\u043E\u043A</span><b class="garden">\u2014</b></div>
        <div class="row"><span>\u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F</span><b class="messages">0</b></div>
        <div class="row"><span>\u0420\u0435\u0448\u0435\u043D\u0438\u044F</span><b class="decisions">0</b></div>
        <div class="row"><span>\u041A\u043B\u0430\u0432\u0438\u0430\u0442\u0443\u0440\u044B</span><b class="keyboards">0</b></div>
        <div class="row"><span>\u0410\u0432\u0442\u043E\u043D\u0430\u0436\u0430\u0442\u0438\u044F</span><b class="autoclicks">0</b></div>
        <div class="advice">
          <div class="advice-title"></div>
          <div class="advice-note"></div>
          <div class="advice-stale"></div>
        </div>
        <div class="choice">
          <div class="choice-title">\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u0440\u0430\u0437\u0432\u0438\u043B\u043A\u0430</div>
          <div class="choice-note">\u0421\u043E\u0432\u0435\u0442\u043D\u0438\u043A \u043D\u0435 \u0437\u043D\u0430\u0435\u0442, \u0447\u0442\u043E \u0434\u0435\u043B\u0430\u0442\u044C. \u0412\u044B\u0431\u0435\u0440\u0438 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435:</div>
          <div class="choice-buttons"></div>
          <button class="choice-skip" type="button">\u041F\u0440\u043E\u043F\u0443\u0441\u0442\u0438\u0442\u044C (\u043D\u0435 \u043D\u0430\u0436\u0438\u043C\u0430\u0442\u044C)</button>
          <div class="hint" style="margin-top:4px">\u041D\u0435\u0442 \u043D\u0443\u0436\u043D\u043E\u0439 \u043A\u043D\u043E\u043F\u043A\u0438? \u0420\u0430\u0441\u043A\u0440\u043E\u0439 \xAB\u2795 \u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F\xBB \u0432 \u0447\u0430\u0442\u0435 \u2014 \u0441\u043F\u0438\u0441\u043E\u043A \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0441\u044F.</div>
        </div>
        <div class="plan"></div>
        <div class="actions">
          <button class="rotation-btn small" type="button">\u0420\u043E\u0442\u0430\u0446\u0438\u044F</button>
          <button class="rules-btn small" type="button">\u041F\u0440\u0430\u0432\u0438\u043B\u0430</button>
          <button class="delays-btn small" type="button">\u0417\u0430\u0434\u0435\u0440\u0436\u043A\u0438</button>
        </div>
        <div class="actions">
          <button class="export primary" type="button">\u042D\u043A\u0441\u043F\u043E\u0440\u0442</button>
          <button class="clear danger" type="button">\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C</button>
        </div>
        <div class="error"></div>
        <div class="hint">\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u043E, \u0431\u0435\u0437 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438. \u041D\u0435\u0442 \u043A\u043B\u0430\u0432\u0438\u0430\u0442\u0443\u0440 \u2014 \u043F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u0438 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443. v<span class="version">?</span></div>
      </div>
      <div class="backdrop"></div>
      <div class="modal modal-rotation">
        <div class="head">
          <span class="title">\u0420\u043E\u0442\u0430\u0446\u0438\u044F \u0431\u043E\u044F</span>
          <button class="modal-close small" type="button">\u2715</button>
        </div>
        <div class="section-title" style="margin-top:0">\u0420\u043E\u0442\u0430\u0446\u0438\u044F (\u0441\u0432\u0435\u0440\u0445\u0443 \u0432\u043D\u0438\u0437)</div>
        <div class="rotation"></div>
        <label class="rot-cond" style="margin-left:0" title="\u0417\u0430\u0445\u043E\u0434\u0438\u0442\u044C \u0432 \xAB\u2795 \u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F\xBB, \u0442\u043E\u043B\u044C\u043A\u043E \u043A\u043E\u0433\u0434\u0430 \u043F\u0440\u0430\u0432\u0438\u043B\u043E \u0440\u043E\u0442\u0430\u0446\u0438\u0438 \u0436\u0434\u0451\u0442 \u043A\u043D\u043E\u043F\u043A\u0443, \u043A\u043E\u0442\u043E\u0440\u043E\u0439 \u043D\u0435\u0442 \u0432 \u0431\u043E\u0435\u0432\u043E\u0439 \u043A\u043B\u0430\u0432\u0438\u0430\u0442\u0443\u0440\u0435 (\u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440, \xAB\u042D\u043F\u043E\u0441\xBB \u043F\u0440\u043E\u0442\u0438\u0432 \u0433\u0440\u0443\u043F\u043F\u044B)">
          <input type="checkbox" class="auto-expand"> \u0420\u0430\u0441\u043A\u0440\u044B\u0432\u0430\u0442\u044C \xAB\u2795 \u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F\xBB \u043F\u043E \u043F\u0440\u0430\u0432\u0438\u043B\u0430\u043C
        </label>
        <div class="cand-title">\u0414\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F</div>
        <div class="extras"></div>
        <div class="cand-title">\u0418\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0435 \u043A\u043D\u043E\u043F\u043A\u0438 \u0431\u043E\u044F</div>
        <div class="cands"></div>
        <div class="hint">\u0421\u043E\u0432\u0435\u0442\u0443\u0435\u0442\u0441\u044F \u043F\u0435\u0440\u0432\u043E\u0435 \u043F\u0440\u0430\u0432\u0438\u043B\u043E, \u0447\u044C\u044F \u043A\u043D\u043E\u043F\u043A\u0430 \u0435\u0441\u0442\u044C \u0432 \u043A\u043B\u0430\u0432\u0438\u0430\u0442\u0443\u0440\u0435 \u0438 \u0447\u044C\u0438 \u0443\u0441\u043B\u043E\u0432\u0438\u044F \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u044B. \u0423\u0441\u043B\u043E\u0432\u0438\u044F: \xABHP \u2264 N%\xBB \u2014 \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u0435 \u0438\u0433\u0440\u043E\u043A\u0430, \xAB\u0413\u0440\u0443\u043F\u043F\u0430 \u0432\u0440\u0430\u0433\u043E\u0432\xBB \u2014 \u043F\u0440\u043E\u0442\u0438\u0432\u043D\u0438\u043A \u043E\u0434\u0438\u043D \u0438\u0437 3 \u0438 \u0431\u043E\u043B\u0435\u0435, \xAB1 \u0440\u0430\u0437 \u0437\u0430 \u0431\u043E\u0439\xBB \u2014 \u043A\u043D\u043E\u043F\u043A\u0430 \u0435\u0449\u0451 \u043D\u0435 \u043D\u0430\u0436\u0438\u043C\u0430\u043B\u0430\u0441\u044C \u0432 \u044D\u0442\u043E\u043C \u0431\u043E\u044E (\u0433\u0440\u0430\u043D\u0430\u0442\u043E\u043C\u0451\u0442 \xAB\u042D\u043F\u043E\u0441\xBB). \u0410\u043F\u0442\u0435\u0447\u043A\u0438 \u0434\u043E\u0431\u0430\u0432\u043B\u044F\u0439 \u0441 \u043F\u043E\u0440\u043E\u0433\u043E\u043C HP \u0438 \u043F\u043E\u0432\u0442\u043E\u0440\u044F\u0439 \u043F\u043E \u0447\u0438\u0441\u043B\u0443 \u0441\u043B\u043E\u0442\u043E\u0432.</div>
      </div>
      <div class="modal modal-delays">
        <div class="head">
          <span class="title">\u0417\u0430\u0434\u0435\u0440\u0436\u043A\u0438 \u0430\u0432\u0442\u043E</span>
          <button class="modal-close small" type="button">\u2715</button>
        </div>
        <div class="section-title" style="margin-top:0">\u041F\u0430\u0443\u0437\u0430 \u043F\u0435\u0440\u0435\u0434 \u043D\u0430\u0436\u0430\u0442\u0438\u0435\u043C</div>
        <div class="delays"></div>
        <div class="hint">\u0412 \u0441\u0435\u043A\u0443\u043D\u0434\u0430\u0445, 0 \u2014 \u043D\u0430\u0436\u0438\u043C\u0430\u0442\u044C \u0441\u0440\u0430\u0437\u0443. \u041F\u0440\u0438\u043C\u0435\u043D\u044F\u0435\u0442\u0441\u044F \u0432 \u0440\u0435\u0436\u0438\u043C\u0435 \xAB\u0410\u0432\u0442\u043E\xBB.</div>
      </div>
      <div class="modal modal-rules">
        <div class="head">
          <span class="title">\u041F\u0440\u0430\u0432\u0438\u043B\u0430</span>
          <button class="modal-close small" type="button">\u2715</button>
        </div>
        <div class="section-title" style="margin-top:0">\u0421\u043E\u0431\u044B\u0442\u0438\u044F</div>
        <div class="hint" style="margin-top:0">\u0427\u0442\u043E \u0434\u0435\u043B\u0430\u0442\u044C \u043F\u0440\u0438 \u0432\u0441\u0442\u0440\u0435\u0447\u0435 \u0441 \u0441\u043E\u0431\u044B\u0442\u0438\u0435\u043C.</div>
        <div class="events-list"></div>
        <div class="section-title">\u0410\u043D\u043E\u043C\u0430\u043B\u0438\u0438</div>
        <div class="hint" style="margin-top:0">\u041A\u0430\u043A\u0438\u0435 \u043F\u043E\u043B\u044F \u043F\u043E\u0441\u0435\u0449\u0430\u0442\u044C. \xAB\u041E\u0431\u0449\u0435\u0435\xBB \u2014 \u043F\u043E \u043F\u0440\u0430\u0432\u0438\u043B\u0443 \u0441\u043E\u0431\u044B\u0442\u0438\u044F \xAB\u0410\u043D\u043E\u043C\u0430\u043B\u0438\u044F\xBB \u0432\u044B\u0448\u0435. \u041F\u043E\u043B\u0435 \u0441 \xAB\u0414\u043E\u043F. \u043B\u0438\u043C\u0438\u0442 (0)\xBB \u043E\u0431\u0445\u043E\u0434\u0438\u0442\u0441\u044F \u043D\u0435\u0437\u0430\u0432\u0438\u0441\u0438\u043C\u043E \u043E\u0442 \u0441\u043F\u0438\u0441\u043A\u0430.</div>
        <div class="anomaly-types-list"></div>
        <div class="section-title">\u0417\u0434\u043E\u0440\u043E\u0432\u044C\u0435</div>
        <div class="hint" style="margin-top:0">\u0410\u0432\u0442\u043E-\u043E\u0442\u0434\u044B\u0445 \u0443 \u043A\u043E\u0441\u0442\u0440\u0430 \u043B\u043E\u043A\u0430\u0446\u0438\u0438: \u041A\u043E\u0441\u0442\u0451\u0440 \u2192 \u2795 \u041E\u0442\u0434\u043E\u0445\u043D\u0443\u0442\u044C (\u0434\u043E \u043F\u043E\u043B\u043D\u043E\u0433\u043E \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u044F) \u2192 \u2B05 \u0417\u043E\u043D\u0430. \u041D\u0435 \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u0432\u043D\u0443\u0442\u0440\u0438 \u0430\u043D\u043E\u043C\u0430\u043B\u0438\u0438 \u2014 \u0442\u0430\u043C \xAB\u0421\u0442\u0440\u0430\u0436 HP\xBB.</div>
        <div class="rot-cond" style="margin-left:0">
          <label><input type="checkbox" class="rest-guard"> \u041E\u0442\u0434\u044B\u0445 \u043F\u0440\u0438 HP \u2264</label>
          <input type="number" class="rest-hp" min="5" max="95" step="5">
          <span>%</span>
        </div>
        <div class="section-title">\u0420\u0430\u0437\u0432\u0438\u043B\u043A\u0438</div>
        <div class="hint">\u0412\u044B\u0431\u043E\u0440 \u043A\u043D\u043E\u043F\u043A\u0438 \u0434\u043B\u044F \u043A\u0430\u0436\u0434\u043E\u0439 \u0440\u0430\u0437\u0432\u0438\u043B\u043A\u0438. \xAB\u0421\u043F\u0440\u0430\u0448\u0438\u0432\u0430\u0442\u044C\xBB \u2014 \u0430\u0432\u0442\u043E-\u0440\u0435\u0436\u0438\u043C \u0431\u0443\u0434\u0435\u0442 \u0436\u0434\u0430\u0442\u044C \u0442\u0432\u043E\u0435\u0433\u043E \u0440\u0435\u0448\u0435\u043D\u0438\u044F.</div>
        <div class="rules-list"></div>
      </div>
    `;
      document.documentElement.appendChild(host);
      const get = (selector) => {
        const element = shadow.querySelector(selector);
        if (!element) throw new Error(`panel element not found: ${selector}`);
        return element;
      };
      const delayInputs = /* @__PURE__ */ new Map();
      const delaysContainer = get(".delays");
      for (const key of DELAY_KEYS) {
        const row = document.createElement("div");
        row.className = "delay-row";
        const input = document.createElement("input");
        input.type = "number";
        input.min = "0";
        input.max = "600";
        input.step = "0.5";
        input.value = "0";
        input.id = `delay-${key}`;
        const label = document.createElement("label");
        label.htmlFor = input.id;
        label.textContent = AUTO_DELAY_LABELS[key];
        input.addEventListener("change", () => {
          const seconds = Number(input.value);
          if (!Number.isFinite(seconds)) return;
          actions.onAutoDelayChange(key, Math.round(seconds * 1e3));
        });
        row.append(label, input);
        delaysContainer.appendChild(row);
        delayInputs.set(key, input);
      }
      this.elements = {
        root: get(".panel"),
        gameNote: get(".game-note"),
        tabNote: get(".tab-note"),
        captchaNote: get(".captcha-note"),
        blindNote: get(".blind-note"),
        reloadNote: get(".reload-note"),
        updateNote: get(".update-note"),
        updateText: get(".update-text"),
        updateReload: get(".update-reload"),
        updateInstall: get(".update-install"),
        dot: get(".dot"),
        toggle: get(".toggle"),
        mode: get(".mode"),
        autoReset: get(".auto-reset"),
        manualTakeover: get(".manual-toggle"),
        gardenSell: get(".garden-sell"),
        hpGuard: get(".hp-guard"),
        peer: get(".peer"),
        garden: get(".garden"),
        messages: get(".messages"),
        decisions: get(".decisions"),
        keyboards: get(".keyboards"),
        autoClicks: get(".autoclicks"),
        advice: get(".advice"),
        adviceTitle: get(".advice-title"),
        adviceNote: get(".advice-note"),
        adviceStale: get(".advice-stale"),
        choice: get(".choice"),
        choiceButtons: get(".choice-buttons"),
        plan: get(".plan"),
        error: get(".error"),
        exportButton: get(".export"),
        clearButton: get(".clear"),
        backdrop: get(".backdrop"),
        rotationButton: get(".rotation-btn"),
        rotationWindow: get(".modal-rotation"),
        rotationClose: get(".modal-rotation .modal-close"),
        rotationList: get(".rotation"),
        autoExpand: get(".modal-rotation .auto-expand"),
        extras: get(".extras"),
        candidates: get(".cands"),
        delaysButton: get(".delays-btn"),
        delaysWindow: get(".modal-delays"),
        delaysClose: get(".modal-delays .modal-close"),
        delayInputs,
        rulesButton: get(".rules-btn"),
        rulesWindow: get(".modal-rules"),
        rulesClose: get(".modal-rules .modal-close"),
        eventsList: get(".events-list"),
        anomalyTypesList: get(".anomaly-types-list"),
        restGuard: get(".rest-guard"),
        restHp: get(".rest-hp"),
        rulesList: get(".rules-list")
      };
      if (true) {
        const versionEl = shadow.querySelector(".version");
        if (versionEl) versionEl.textContent = "0.3.261111.1403";
      }
      this.elements.toggle.addEventListener("click", () => actions.onToggleRecording());
      this.elements.updateReload.addEventListener("click", () => {
        window.location.reload();
      });
      this.elements.updateInstall.addEventListener("click", () => {
        if ("https://raw.githubusercontent.com/HeyOh79/stalker-install/main/stalker-assistant.user.js".length > 0) {
          window.open("https://raw.githubusercontent.com/HeyOh79/stalker-install/main/stalker-assistant.user.js", "_blank");
        }
      });
      this.elements.mode.addEventListener("click", () => {
        const index = MODE_ORDER.indexOf(this.mode);
        const next = MODE_ORDER[(index + 1) % MODE_ORDER.length] ?? "observe";
        actions.onToggleMode(next);
      });
      this.elements.autoReset.addEventListener("click", () => {
        this.actions.onToggleAutoReset(this.elements.autoReset.textContent !== "\u0432\u043A\u043B");
      });
      this.elements.manualTakeover.addEventListener("click", () => {
        this.actions.onToggleManualTakeover(this.elements.manualTakeover.textContent !== "\u0432\u043A\u043B");
      });
      this.elements.autoExpand.addEventListener("change", () => {
        this.actions.onToggleBattleAutoExpand(this.elements.autoExpand.checked);
      });
      this.elements.gardenSell.addEventListener("click", () => {
        this.actions.onToggleGardenAutoSell(this.elements.gardenSell.textContent !== "\u0432\u043A\u043B");
      });
      this.elements.hpGuard.addEventListener("click", () => {
        this.actions.onToggleAnomalyHpGuard(this.elements.hpGuard.textContent !== "\u0432\u043A\u043B");
      });
      this.elements.restGuard.addEventListener("change", () => {
        this.actions.onRestGuardChange(this.elements.restGuard.checked, Number(this.elements.restHp.value) || 60);
      });
      this.elements.restHp.addEventListener("change", () => {
        this.actions.onRestGuardChange(this.elements.restGuard.checked, Number(this.elements.restHp.value) || 60);
      });
      this.bindWindow("rotation", this.elements.rotationButton, this.elements.rotationClose);
      this.bindWindow("delays", this.elements.delaysButton, this.elements.delaysClose);
      this.bindWindow("rules", this.elements.rulesButton, this.elements.rulesClose);
      this.elements.backdrop.addEventListener("click", () => this.closeWindow());
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && this.openWindowName !== null) this.closeWindow();
      });
      get(".choice-skip").addEventListener("click", () => actions.onDismissChoice());
      this.elements.exportButton.addEventListener("click", () => {
        void this.handleExport(actions);
      });
      this.elements.clearButton.addEventListener("click", () => {
        void this.handleClear(actions);
      });
    }
    /** Кнопка панели открывает своё окно (единственное) или закрывает уже открытое. */
    bindWindow(name, button, close) {
      button.addEventListener("click", () => {
        this.openWindowName = this.openWindowName === name ? null : name;
        this.syncWindows();
      });
      close.addEventListener("click", () => this.closeWindow());
    }
    closeWindow() {
      this.openWindowName = null;
      this.syncWindows();
    }
    syncWindows() {
      const open = this.openWindowName;
      this.elements.backdrop.classList.toggle("open", open !== null);
      this.elements.rotationWindow.classList.toggle("open", open === "rotation");
      this.elements.delaysWindow.classList.toggle("open", open === "delays");
      this.elements.rulesWindow.classList.toggle("open", open === "rules");
      this.elements.rotationButton.classList.toggle("window-open", open === "rotation");
      this.elements.delaysButton.classList.toggle("window-open", open === "delays");
      this.elements.rulesButton.classList.toggle("window-open", open === "rules");
    }
    update(state) {
      const visible = state.isGameChat || state.gamePeerIds.length === 0 && state.currentPeerId !== null;
      this.elements.root.classList.toggle("hidden", !visible);
      this.elements.gameNote.classList.toggle("on", visible && !state.isGameChat);
      if (visible && !state.isGameChat) {
        this.elements.gameNote.textContent = "\u0427\u0430\u0442 \u0438\u0433\u0440\u044B \u0435\u0449\u0451 \u043D\u0435 \u043E\u043F\u043E\u0437\u043D\u0430\u043D. \u041E\u0442\u043A\u0440\u043E\u0439 \u0434\u0438\u0430\u043B\u043E\u0433 \xAB\u0421\u0442\u0430\u043B\u043A\u0435\u0440 \u0421\u0435\u0440\u0434\u0446\u0435 \u0427\u0435\u0440\u043D\u043E\u0431\u044B\u043B\u044F\xBB \u2014 \u0430\u0441\u0441\u0438\u0441\u0442\u0435\u043D\u0442 \u0432\u043A\u043B\u044E\u0447\u0438\u0442\u0441\u044F \u0441\u0430\u043C.";
      }
      const otherTabActive = state.otherTabAutoUntil > Date.now();
      this.elements.tabNote.classList.toggle("on", otherTabActive);
      if (otherTabActive) {
        this.elements.tabNote.textContent = "\u0410\u0441\u0441\u0438\u0441\u0442\u0435\u043D\u0442 \u0442\u0430\u043A\u0436\u0435 \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u0432 \u0440\u0435\u0436\u0438\u043C\u0435 \xAB\u0410\u0432\u0442\u043E\xBB \u0432 \u0434\u0440\u0443\u0433\u043E\u0439 \u0432\u043A\u043B\u0430\u0434\u043A\u0435 \u044D\u0442\u043E\u0433\u043E \u0447\u0430\u0442\u0430 \u2014 \u0435\u0451 \u0440\u0435\u0436\u0438\u043C\u044B \u043F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0430\u044E\u0442\u0441\u044F \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E. \u0417\u0430\u043A\u0440\u043E\u0439/\u043F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u0438 \u043B\u0438\u0448\u043D\u0438\u0435 \u0432\u043A\u043B\u0430\u0434\u043A\u0438 vk.com \u0438 vk.ru.";
      }
      const captchaActive = state.captchaPausedUntil > Date.now();
      this.elements.captchaNote.classList.toggle("on", captchaActive);
      if (captchaActive) {
        this.elements.captchaNote.textContent = "\u{1F6D1} \u0412\u041A \u043F\u043E\u043A\u0430\u0437\u0430\u043B \u043A\u0430\u043F\u0447\u0443 \u2014 \u0432\u0432\u0435\u0434\u0438 \u0435\u0451 \u0432 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435. \u0410\u0432\u0442\u043E-\u0440\u0435\u0436\u0438\u043C \u043F\u0440\u0438\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D \u0438 \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442 \u0441\u0430\u043C \u043F\u043E\u0441\u043B\u0435 \u0432\u0432\u043E\u0434\u0430.";
      }
      this.elements.blindNote.classList.toggle("on", state.blindFishing);
      if (state.blindFishing) {
        this.elements.blindNote.textContent = "\u{1F441} \u0420\u044B\u0431\u0430\u043B\u043A\u0430 \u043F\u0440\u0438\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u0430: \u0432\u043A\u043B\u0430\u0434\u043A\u0430 \u0432 \u0444\u043E\u043D\u0435, \u0437\u0430\u0434\u0430\u043D\u0438\u044F \u043D\u0435 \u043C\u043E\u043D\u0442\u0438\u0440\u0443\u044E\u0442\u0441\u044F. \u0412\u0435\u0440\u043D\u0438 \u0432\u043A\u043B\u0430\u0434\u043A\u0443 \u043D\u0430 \u043F\u0435\u0440\u0435\u0434\u043D\u0438\u0439 \u043F\u043B\u0430\u043D \u2014 \u0431\u043E\u0442 \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442 \u0441\u0430\u043C.";
      }
      const reloadScheduled = state.pageReloadScheduledAt > Date.now();
      const reloadSuspended = state.pageReloadSuspendedUntil > Date.now();
      this.elements.reloadNote.classList.toggle("on", reloadScheduled || reloadSuspended);
      if (reloadScheduled) {
        const seconds = Math.max(1, Math.ceil((state.pageReloadScheduledAt - Date.now()) / 1e3));
        this.elements.reloadNote.textContent = `\u23F1 \u0418\u0433\u0440\u0430 \u043D\u0435 \u043E\u0442\u0432\u0435\u0447\u0430\u0435\u0442 \u2014 \u043F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0436\u0443 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 \u0447\u0435\u0440\u0435\u0437 ${seconds} \u0441. \u0418\u0433\u0440\u0430 \u043E\u0436\u0438\u043B\u0430 \u0438\u043B\u0438 \u043F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0438 \u0440\u0435\u0436\u0438\u043C, \u0447\u0442\u043E\u0431\u044B \u043E\u0442\u043C\u0435\u043D\u0438\u0442\u044C.`;
      } else if (reloadSuspended) {
        const minutes = Math.ceil((state.pageReloadSuspendedUntil - Date.now()) / 6e4);
        this.elements.reloadNote.textContent = `\u23F1 \u0421\u0442\u0440\u0430\u043D\u0438\u0446\u0430 \u043F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0436\u0430\u043B\u0430\u0441\u044C \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u0447\u0430\u0441\u0442\u043E \u2014 \u0430\u0432\u0442\u043E-\u043F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u043F\u0440\u0438\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u0430 \u043D\u0430 ${minutes} \u043C\u0438\u043D. \u041F\u0440\u043E\u0432\u0435\u0440\u044C \u0438\u0433\u0440\u0443 \u0432\u0440\u0443\u0447\u043D\u0443\u044E.`;
      }
      const update = state.updateAvailable;
      this.elements.updateNote.classList.toggle("on", update !== null);
      if (update !== null) {
        this.elements.updateText.textContent = `\u{1F504} \u0414\u043E\u0441\u0442\u0443\u043F\u043D\u0430 \u0432\u0435\u0440\u0441\u0438\u044F ${update.remote} (\u0443 \u0442\u0435\u0431\u044F ${update.local}). Tampermonkey \u043E\u0431\u043D\u043E\u0432\u0438\u0442 \u0441\u043A\u0440\u0438\u043F\u0442 \u0441\u0430\u043C \u2014 \u043F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u0438 \u0432\u043A\u043B\u0430\u0434\u043A\u0443, \u0447\u0442\u043E\u0431\u044B \u043E\u043D \u0437\u0430\u0440\u0430\u0431\u043E\u0442\u0430\u043B.`;
      }
      this.elements.dot.classList.toggle("off", !state.recording);
      this.elements.toggle.textContent = state.recording ? "\u0417\u0430\u043F\u0438\u0441\u044C: \u0432\u043A\u043B" : "\u0417\u0430\u043F\u0438\u0441\u044C: \u0432\u044B\u043A\u043B";
      this.elements.toggle.classList.toggle("off", !state.recording);
      this.mode = state.mode;
      this.elements.mode.textContent = MODE_LABELS[state.mode];
      this.elements.mode.classList.toggle("mode-active", state.mode === "advice");
      this.elements.autoReset.textContent = state.autoReset ? "\u0432\u043A\u043B" : "\u0432\u044B\u043A\u043B";
      this.elements.autoReset.classList.toggle("off", !state.autoReset);
      this.elements.manualTakeover.textContent = state.manualTakeover ? "\u0432\u043A\u043B" : "\u0432\u044B\u043A\u043B";
      this.elements.manualTakeover.classList.toggle("off", !state.manualTakeover);
      this.elements.gardenSell.textContent = state.gardenAutoSell ? "\u0432\u043A\u043B" : "\u0432\u044B\u043A\u043B";
      this.elements.gardenSell.classList.toggle("off", !state.gardenAutoSell);
      this.elements.hpGuard.textContent = state.anomalyHpGuard ? "\u0432\u043A\u043B" : "\u0432\u044B\u043A\u043B";
      this.elements.hpGuard.classList.toggle("off", !state.anomalyHpGuard);
      if (this.elements.restGuard.checked !== state.restGuard) this.elements.restGuard.checked = state.restGuard;
      const restHpValue = String(state.restHpPercent);
      if (document.activeElement !== this.elements.restHp && this.elements.restHp.value !== restHpValue) {
        this.elements.restHp.value = restHpValue;
      }
      if (this.elements.autoExpand.checked !== state.battleAutoExpand) {
        this.elements.autoExpand.checked = state.battleAutoExpand;
      }
      const slots = state.gardenSlots;
      this.elements.garden.textContent = slots ? `${slots.current}/${slots.limit}` : "\u2014";
      this.elements.garden.title = slots ? slots.current >= slots.limit ? `\u0421\u0430\u0434\u043E\u043A \u043F\u043E\u043B\u043E\u043D \u2014 \u0440\u044B\u0431\u0430 \u043E\u0442\u043F\u0443\u0441\u043A\u0430\u0435\u0442\u0441\u044F${state.gardenAutoSell ? ", \u0430\u0432\u0442\u043E \u043F\u0440\u043E\u0434\u0430\u0441\u0442 \u043A\u043E\u043C\u0430\u043D\u0434\u043E\u0439 \xAB\u041F\u0440\u043E\u0434\u0430\u0442\u044C \u0432\u0441\u044E \u0440\u044B\u0431\u0443\xBB" : ""}` : "\u041C\u0435\u0441\u0442 \u0432 \u0441\u0430\u0434\u043A\u0435" : "\u041F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u0441 \u043F\u0435\u0440\u0432\u044B\u043C \u0443\u043B\u043E\u0432\u043E\u043C";
      this.elements.garden.classList.toggle("full", slots !== null && slots.current >= slots.limit);
      this.elements.peer.textContent = state.currentPeerId !== null ? String(state.currentPeerId) : "\u2014";
      this.elements.messages.textContent = String(state.counts.messages);
      this.elements.decisions.textContent = String(state.counts.decisions);
      this.elements.keyboards.textContent = String(state.counts.keyboards);
      this.elements.autoClicks.textContent = String(state.autoClicks);
      for (const key of DELAY_KEYS) {
        const input = this.elements.delayInputs.get(key);
        if (!input) continue;
        const seconds = String(Math.round(state.autoDelays[key] / 1e3 * 10) / 10);
        if (document.activeElement !== input && input.value !== seconds) input.value = seconds;
      }
      this.renderAdvice(state.advice);
      this.renderPlan(state);
      this.renderChoice(state);
      this.renderTactics(state);
      this.renderRules(state);
    }
    renderRules(state) {
      this.renderEventRules(state.eventRules);
      this.renderAnomalyTypes(state);
      const json = JSON.stringify(state.forkRules);
      if (json === this.lastRulesJson) return;
      this.lastRulesJson = json;
      const list = this.elements.rulesList;
      list.textContent = "";
      if (state.forkRules.length === 0) {
        const empty = document.createElement("div");
        empty.className = "rules-empty";
        empty.textContent = "\u041F\u043E\u043A\u0430 \u043F\u0443\u0441\u0442\u043E: \u0440\u0430\u0437\u0432\u0438\u0432 \u0440\u0430\u0437\u0432\u0438\u043B\u043A\u0438 \u0432 \u0440\u0435\u0436\u0438\u043C\u0435 \xAB\u0410\u0432\u0442\u043E\xBB, \u043E\u043D\u0438 \u043F\u043E\u044F\u0432\u044F\u0442\u0441\u044F \u0437\u0434\u0435\u0441\u044C.";
        list.appendChild(empty);
        return;
      }
      const sorted = [...state.forkRules].sort((a, b) => b.ts - a.ts);
      for (const rule of sorted) {
        list.appendChild(this.ruleItem(rule));
      }
    }
    /** Секция «События»: действия для аномалии и разлома (meta `eventRules`). */
    renderEventRules(rules) {
      const json = JSON.stringify(rules);
      if (json === this.lastEventsJson) return;
      this.lastEventsJson = json;
      const list = this.elements.eventsList;
      list.textContent = "";
      const rows = [
        { event: "anomaly", current: rules.anomaly, actions: ANOMALY_EVENT_ACTIONS },
        { event: "rift", current: rules.rift, actions: RIFT_EVENT_ACTIONS },
        { event: "helicopter", current: rules.helicopter, actions: HELICOPTER_EVENT_ACTIONS },
        { event: "caches", current: rules.caches, actions: CACHE_EVENT_ACTIONS }
      ];
      for (const { event, current, actions } of rows) {
        const meta = EVENT_RULE_LABELS[event];
        const item = document.createElement("div");
        item.className = "rule";
        const head = document.createElement("div");
        head.className = "rule-head";
        const desc = document.createElement("span");
        desc.className = "rule-desc";
        desc.textContent = meta.title;
        desc.title = meta.hint;
        head.append(desc);
        const buttons = document.createElement("div");
        buttons.className = "rule-buttons";
        for (const action of actions) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = meta.actions[action];
          button.title = meta.hint;
          if (action === current) button.classList.add("chosen");
          button.addEventListener("click", () => this.actions.onEventRuleChange(event, action));
          buttons.appendChild(button);
        }
        item.append(head, buttons);
        list.appendChild(item);
      }
    }
    /**
     * Секция «Аномалии»: заходить/обходить конкретные типы полей (meta
     * `anomalyTypeRules`). «Общее» сбрасывает на правило события «Аномалия».
     */
    renderAnomalyTypes(state) {
      const json = JSON.stringify(state.anomalyTypeRules);
      if (json === this.lastAnomalyTypesJson) return;
      this.lastAnomalyTypesJson = json;
      const list = this.elements.anomalyTypesList;
      list.textContent = "";
      for (const typeName of state.anomalyTypeRules.known) {
        const current = state.anomalyTypeRules.rules[typeName] ?? null;
        const item = document.createElement("div");
        item.className = "rule";
        const head = document.createElement("div");
        head.className = "rule-head";
        const desc = document.createElement("span");
        desc.className = "rule-desc";
        desc.textContent = typeName;
        head.append(desc);
        const buttons = document.createElement("div");
        buttons.className = "rule-buttons";
        const options = [
          ["enter", "\u0417\u0430\u0445\u043E\u0434\u0438\u0442\u044C"],
          ["skip", "\u041E\u0431\u0445\u043E\u0434\u0438\u0442\u044C"],
          [null, "\u041E\u0431\u0449\u0435\u0435"]
        ];
        for (const [action, label] of options) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = label;
          if (current === action) button.classList.add("chosen");
          button.addEventListener("click", () => this.actions.onAnomalyTypeRuleChange(typeName, action));
          buttons.appendChild(button);
        }
        item.append(head, buttons);
        list.appendChild(item);
      }
    }
    ruleItem(rule) {
      const item = document.createElement("div");
      item.className = "rule";
      const head = document.createElement("div");
      head.className = "rule-head";
      const desc = document.createElement("span");
      desc.className = "rule-desc";
      desc.textContent = describeFork(rule);
      desc.title = rule.buttons.join(" / ");
      const count = document.createElement("span");
      count.className = "rule-count";
      count.textContent = `\xD7${rule.count}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "small";
      remove.textContent = "\u2715";
      remove.title = "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0440\u0430\u0437\u0432\u0438\u043B\u043A\u0443 \u0438\u0437 \u0441\u043F\u0438\u0441\u043A\u0430";
      remove.addEventListener("click", () => this.actions.onForkRuleDelete(rule.signature));
      head.append(desc, count, remove);
      const current = document.createElement("div");
      current.className = rule.choice ? "rule-current" : "rule-current ask";
      current.textContent = rule.choice ? `\u0421\u0435\u0439\u0447\u0430\u0441: ${rule.choice}` : "\u0412\u044B\u0431\u043E\u0440 \u043D\u0435 \u0437\u0430\u0434\u0430\u043D \u2014 \u0430\u0432\u0442\u043E-\u0440\u0435\u0436\u0438\u043C \u0441\u043F\u0440\u043E\u0441\u0438\u0442.";
      const buttons = document.createElement("div");
      buttons.className = "rule-buttons";
      for (const text of rule.buttons) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = text;
        if (rule.choice === text) button.classList.add("chosen");
        button.addEventListener("click", () => this.actions.onForkRuleChoice(rule.signature, text));
        buttons.appendChild(button);
      }
      const ask = document.createElement("button");
      ask.type = "button";
      ask.textContent = "\u0421\u043F\u0440\u0430\u0448\u0438\u0432\u0430\u0442\u044C";
      ask.title = "\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u0432\u044B\u0431\u043E\u0440: \u0430\u0432\u0442\u043E-\u0440\u0435\u0436\u0438\u043C \u0441\u043D\u043E\u0432\u0430 \u0431\u0443\u0434\u0435\u0442 \u0441\u043F\u0440\u0430\u0448\u0438\u0432\u0430\u0442\u044C";
      if (!rule.choice) ask.classList.add("chosen");
      ask.addEventListener("click", () => this.actions.onForkRuleChoice(rule.signature, null));
      buttons.appendChild(ask);
      item.append(head, current, buttons);
      return item;
    }
    showError(message) {
      this.elements.error.textContent = message;
      this.elements.error.title = message;
    }
    renderAdvice(advice) {
      const container = this.elements.advice;
      if (!advice) {
        container.classList.remove("on");
        return;
      }
      container.classList.add("on");
      const title = this.elements.adviceTitle;
      const note = this.elements.adviceNote;
      const stale = this.elements.adviceStale;
      if (title) {
        title.textContent = advice.button ? `${advice.title} \u2014 \u043A\u043D\u043E\u043F\u043A\u0430 \u0435\u0441\u0442\u044C \u0432 \u043A\u043B\u0430\u0432\u0438\u0430\u0442\u0443\u0440\u0435` : advice.title;
      }
      if (note) note.textContent = advice.note;
      if (stale) {
        const ageSec = Math.floor((Date.now() - advice.ts) / 1e3);
        stale.textContent = ageSec >= 15 ? `\u0421\u043E\u0432\u0435\u0442 \u043E\u0442 ${ageSec} \u0441 \u043D\u0430\u0437\u0430\u0434 \u2014 \u0432\u043E\u0437\u043C\u043E\u0436\u043D\u043E, \u0443\u0441\u0442\u0430\u0440\u0435\u043B.` : "";
      }
    }
    renderPlan(state) {
      const plan = this.elements.plan;
      if (state.mode !== "auto") {
        plan.textContent = "";
        return;
      }
      if (state.manualPaused) {
        plan.textContent = "\u0410\u0432\u0442\u043E \u043D\u0430 \u043F\u0430\u0443\u0437\u0435: \u0442\u044B \u0438\u0433\u0440\u0430\u0435\u0448\u044C \u0440\u0443\u043A\u0430\u043C\u0438";
        return;
      }
      const pauseLeft = Math.ceil((state.autoRepeatPauseUntil - Date.now()) / 1e3);
      if (pauseLeft > 0) {
        plan.textContent = `\u0410\u0432\u0442\u043E \u043D\u0430 \u043F\u0430\u0443\u0437\u0435: \u0438\u0433\u0440\u0430 \u043C\u043E\u043B\u0447\u0438\u0442 \u043F\u043E\u0441\u043B\u0435 \u0441\u0435\u0440\u0438\u0438 \u043A\u043B\u0438\u043A\u043E\u0432 (${pauseLeft} \u0441)`;
        return;
      }
      if (!state.autoPlan) {
        plan.textContent = "";
        return;
      }
      const left = Math.max(0, Math.ceil((state.autoPlan.at - Date.now()) / 1e3));
      const reasonLabels = { advice: "\u0441\u043E\u0432\u0435\u0442", rule: "\u043F\u0440\u0430\u0432\u0438\u043B\u043E", manual: "\u0432\u044B\u0431\u043E\u0440", continue: "\u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0435\u043D\u0438\u0435" };
      plan.textContent = `\u0410\u0432\u0442\u043E: \xAB${state.autoPlan.button}\xBB \u0447\u0435\u0440\u0435\u0437 ${left} \u0441 (${reasonLabels[state.autoPlan.reason]})`;
    }
    renderChoice(state) {
      const container = this.elements.choice;
      const buttons = this.elements.choiceButtons;
      const pending = state.mode === "auto" ? state.pendingChoice : null;
      const choiceKey = pending ? pending.buttons.join("") : "";
      if (choiceKey === this.lastChoiceKey) return;
      this.lastChoiceKey = choiceKey;
      buttons.textContent = "";
      if (!pending) {
        container.classList.remove("on");
        return;
      }
      container.classList.add("on");
      for (const text of pending.buttons) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = text;
        button.addEventListener("click", () => this.actions.onChooseButton(text));
        buttons.appendChild(button);
      }
    }
    renderTactics(state) {
      if (this.rotationWindowHasFocus()) return;
      const json = JSON.stringify([state.battleRotation, state.battleCandidates, state.battleAutoExpand]);
      if (json === this.lastTacticsJson) return;
      this.lastTacticsJson = json;
      const list = this.elements.rotationList;
      list.textContent = "";
      if (state.battleRotation.length === 0) {
        const empty = document.createElement("div");
        empty.className = "rot-empty";
        empty.textContent = "\u0420\u043E\u0442\u0430\u0446\u0438\u044F \u043F\u0443\u0441\u0442\u0430 \u2014 \u0434\u043E\u0431\u0430\u0432\u044C \u043F\u0440\u0430\u0432\u0438\u043B\u0430 \u043D\u0438\u0436\u0435.";
        list.appendChild(empty);
      } else {
        state.battleRotation.forEach((rule, index) => {
          list.appendChild(this.rotationItem(state, rule, index));
        });
      }
      this.renderExtras(state);
      this.renderCandidates(state);
    }
    /** Фокус внутри окна ротации (ввод условия HP) — список нельзя перерисовывать. */
    rotationWindowHasFocus() {
      const active = this.elements.rotationWindow.ownerDocument.activeElement;
      return active !== null && this.elements.rotationWindow.contains(active);
    }
    /** Быстрые действия: гранатомёт «Эпос» против группы и аптечки по HP. */
    renderExtras(state) {
      const extras = this.elements.extras;
      extras.textContent = "";
      const inRotation = (needle) => state.battleRotation.some((rule) => rule.button.toLowerCase() === needle);
      const epos = document.createElement("button");
      epos.type = "button";
      epos.textContent = "+ \u042D\u043F\u043E\u0441 (\u0433\u0440\u0443\u043F\u043F\u0430 \u0432\u0440\u0430\u0433\u043E\u0432)";
      epos.title = "\u0413\u0440\u0430\u043D\u0430\u0442\u043E\u043C\u0451\u0442 \xAB\u042D\u043F\u043E\u0441\xBB: \u0434\u043E\u0431\u0430\u0432\u043B\u044F\u0435\u0442\u0441\u044F \u0441 \u0443\u0441\u043B\u043E\u0432\u0438\u044F\u043C\u0438 \xAB\u0413\u0440\u0443\u043F\u043F\u0430 \u0432\u0440\u0430\u0433\u043E\u0432\xBB \u0438 \xAB1 \u0440\u0430\u0437 \u0437\u0430 \u0431\u043E\u0439\xBB";
      epos.disabled = inRotation("\u044D\u043F\u043E\u0441");
      epos.addEventListener("click", () => {
        this.rotationChanged([...state.battleRotation, {
          button: "\u042D\u043F\u043E\u0441",
          hpBelow: null,
          groupOnly: true,
          oncePerBattle: true,
          onKill: false,
          notFullHp: false,
          disabled: false
        }]);
      });
      extras.appendChild(epos);
      const harvest = document.createElement("button");
      harvest.type = "button";
      harvest.textContent = "+ \u0416\u0430\u0442\u0432\u0430 (\u0435\u0441\u043B\u0438 \u0434\u043E\u0431\u0438\u0432\u0430\u044E)";
      harvest.title = "\u0423\u043C\u043D\u0430\u044F \xAB\u0416\u0430\u0442\u0432\u0430\xBB: \u043F\u0440\u043E\u0433\u043D\u043E\u0437 \u043F\u043E \u043D\u0430\u0431\u043B\u044E\u0434\u0430\u0435\u043C\u043E\u043C\u0443 \u0443\u0440\u043E\u043D\u0443 \u2014 \u0434\u043E\u0431\u044C\u0451\u0442 \u0446\u0435\u043B\u044C \u0438 \u043F\u043E\u0434\u043B\u0435\u0447\u0438\u0442. \u0423\u0441\u043B\u043E\u0432\u0438\u0435 \xAB\u0415\u0441\u043B\u0438 \u0434\u043E\u0431\u0438\u0432\u0430\u044E\xBB \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u043E";
      harvest.disabled = inRotation("\u0436\u0430\u0442\u0432\u0430");
      harvest.addEventListener("click", () => {
        this.rotationChanged([...state.battleRotation, {
          button: "\u0416\u0430\u0442\u0432\u0430",
          hpBelow: null,
          groupOnly: false,
          oncePerBattle: false,
          onKill: true,
          notFullHp: false,
          disabled: false
        }]);
      });
      extras.appendChild(harvest);
      const medkit = document.createElement("button");
      medkit.type = "button";
      medkit.textContent = "+ \u0410\u043F\u0442\u0435\u0447\u043A\u0430\u2026";
      medkit.title = "\u0410\u043F\u0442\u0435\u0447\u043A\u0430 \u0438\u043B\u0438 \u0431\u0438\u043D\u0442: \u0434\u043E\u0431\u0430\u0432\u043B\u044F\u0435\u0442\u0441\u044F \u0441 \u0443\u0441\u043B\u043E\u0432\u0438\u0435\u043C \xABHP \u2264 50%\xBB. \u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u2014 \u043A\u0430\u043A \u043D\u0430 \u043A\u043D\u043E\u043F\u043A\u0435 \u0432 \u0438\u0433\u0440\u0435";
      medkit.addEventListener("click", () => {
        const text = window.prompt("\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0430\u043F\u0442\u0435\u0447\u043A\u0438 (\u043A\u0430\u043A \u043D\u0430 \u043A\u043D\u043E\u043F\u043A\u0435 \u0432 \u0438\u0433\u0440\u0435):", "\u0410\u043F\u0442\u0435\u0447\u043A\u0430");
        const name = text?.trim();
        if (!name) return;
        if (state.battleRotation.some((rule) => rule.button.toLowerCase() === name.toLowerCase())) return;
        this.rotationChanged([...state.battleRotation, {
          button: name,
          hpBelow: 50,
          groupOnly: false,
          oncePerBattle: false,
          onKill: false,
          notFullHp: false,
          disabled: false
        }]);
      });
      extras.appendChild(medkit);
    }
    renderCandidates(state) {
      const cands = this.elements.candidates;
      cands.textContent = "";
      if (state.battleCandidates.length === 0) {
        const none = document.createElement("span");
        none.className = "none";
        none.textContent = "\u0411\u043E\u0435\u0432\u044B\u0445 \u043A\u043D\u043E\u043F\u043E\u043A \u043F\u043E\u043A\u0430 \u043D\u0435\u0442.";
        cands.appendChild(none);
      } else {
        const missing = state.battleCandidates.filter((name) => !state.battleRotation.some((rule) => rule.button.toLowerCase() === name.toLowerCase()));
        if (missing.length > 0) {
          const addAll = document.createElement("button");
          addAll.type = "button";
          addAll.textContent = "+ \u0412\u0441\u0435";
          addAll.title = "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432\u0441\u0435 \u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0435 \u043A\u043D\u043E\u043F\u043A\u0438 \u0431\u043E\u044F \u0432 \u043A\u043E\u043D\u0435\u0446 \u0440\u043E\u0442\u0430\u0446\u0438\u0438";
          addAll.addEventListener("click", () => {
            this.rotationChanged([...state.battleRotation, ...missing.map((name) => ({
              button: name,
              hpBelow: null,
              groupOnly: false,
              oncePerBattle: false,
              onKill: false,
              notFullHp: false,
              disabled: false
            }))]);
          });
          cands.appendChild(addAll);
        }
        for (const name of missing) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = `+ ${name}`;
          button.addEventListener("click", () => {
            this.rotationChanged([...state.battleRotation, {
              button: name,
              hpBelow: null,
              groupOnly: false,
              oncePerBattle: false,
              onKill: false,
              notFullHp: false,
              disabled: false
            }]);
          });
          cands.appendChild(button);
        }
        if (missing.length === 0) {
          const all = document.createElement("span");
          all.className = "none";
          all.textContent = "\u0412\u0441\u0435 \u043A\u043D\u043E\u043F\u043A\u0438 \u0443\u0436\u0435 \u0432 \u0440\u043E\u0442\u0430\u0446\u0438\u0438.";
          cands.appendChild(all);
        }
      }
      const manual = document.createElement("button");
      manual.type = "button";
      manual.textContent = "+ \u0412\u0440\u0443\u0447\u043D\u0443\u044E";
      manual.title = "\u0412\u0432\u0435\u0441\u0442\u0438 \u0442\u0435\u043A\u0441\u0442 \u0431\u043E\u0435\u0432\u043E\u0439 \u043A\u043D\u043E\u043F\u043A\u0438 \u0432\u0440\u0443\u0447\u043D\u0443\u044E";
      manual.addEventListener("click", () => {
        const text = window.prompt("\u0422\u0435\u043A\u0441\u0442 \u043A\u043D\u043E\u043F\u043A\u0438 \u0434\u043B\u044F \u0440\u043E\u0442\u0430\u0446\u0438\u0438 (\u043A\u0430\u043A \u0432 \u0438\u0433\u0440\u0435):");
        if (text && text.trim()) this.rotationChanged([...state.battleRotation, {
          button: text.trim(),
          hpBelow: null,
          groupOnly: false,
          oncePerBattle: false,
          onKill: false,
          notFullHp: false,
          disabled: false
        }]);
      });
      cands.appendChild(manual);
    }
    rotationItem(state, rule, index) {
      const wrap = document.createElement("div");
      const row = document.createElement("div");
      row.className = "rot-item";
      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.checked = !rule.disabled;
      enabled.title = rule.disabled ? "\u041F\u0440\u0430\u0432\u0438\u043B\u043E \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u043E \u2014 \u0432\u043A\u043B\u044E\u0447\u0438\u0442\u044C" : "\u0412\u044B\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u043F\u0440\u0430\u0432\u0438\u043B\u043E (\u0431\u0435\u0437 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F)";
      enabled.addEventListener("change", () => {
        const rotation = state.battleRotation.map((item, i) => i === index ? { ...item, disabled: !enabled.checked } : item);
        this.rotationChanged(rotation);
      });
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = `${index + 1}.`;
      const label = document.createElement("span");
      label.className = "name";
      label.textContent = rule.button;
      label.title = describeRotationRule(rule) || "\u0411\u0435\u0437 \u0443\u0441\u043B\u043E\u0432\u0438\u0439";
      row.classList.toggle("off", rule.disabled);
      const move = (delta, symbol) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "small";
        button.textContent = symbol;
        button.disabled = index + delta < 0 || index + delta >= state.battleRotation.length;
        button.addEventListener("click", () => {
          const rotation = [...state.battleRotation];
          const target = index + delta;
          const [item] = rotation.splice(index, 1);
          if (item !== void 0) rotation.splice(target, 0, item);
          this.rotationChanged(rotation);
        });
        return button;
      };
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "small";
      remove.textContent = "\u2715";
      remove.addEventListener("click", () => {
        this.rotationChanged(state.battleRotation.filter((_, i) => i !== index));
      });
      row.append(enabled, num, label, move(-1, "\u2191"), move(1, "\u2193"), remove);
      const cond = document.createElement("div");
      cond.className = "rot-cond";
      const patch = (change) => {
        const rotation = state.battleRotation.map((item, i) => i === index ? { ...item, ...change } : item);
        this.rotationChanged(rotation);
      };
      const hpLabel = document.createElement("label");
      hpLabel.textContent = "HP \u2264";
      const hpInput = document.createElement("input");
      hpInput.type = "number";
      hpInput.min = "1";
      hpInput.max = "100";
      hpInput.placeholder = "\u2014";
      hpInput.value = rule.hpBelow !== null ? String(rule.hpBelow) : "";
      hpInput.title = "\u041F\u0443\u0441\u0442\u043E \u2014 \u0431\u0435\u0437 \u0443\u0441\u043B\u043E\u0432\u0438\u044F \u043F\u043E \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u044E";
      hpInput.addEventListener("change", () => {
        const value = Number(hpInput.value);
        patch({ hpBelow: hpInput.value.trim() !== "" && Number.isFinite(value) ? value : null });
      });
      hpLabel.appendChild(hpInput);
      hpLabel.append("%");
      cond.appendChild(hpLabel);
      const groupLabel = document.createElement("label");
      groupLabel.title = "\u041F\u0440\u043E\u0442\u0438\u0432 3 \u0438 \u0431\u043E\u043B\u0435\u0435 \u043F\u0440\u043E\u0442\u0438\u0432\u043D\u0438\u043A\u043E\u0432";
      const group = document.createElement("input");
      group.type = "checkbox";
      group.checked = rule.groupOnly;
      group.addEventListener("change", () => patch({ groupOnly: group.checked }));
      groupLabel.appendChild(group);
      groupLabel.append("\u0413\u0440\u0443\u043F\u043F\u0430 \u0432\u0440\u0430\u0433\u043E\u0432");
      cond.appendChild(groupLabel);
      const onceLabel = document.createElement("label");
      onceLabel.title = "\u041A\u043D\u043E\u043F\u043A\u0430 \u043D\u0430\u0436\u0438\u043C\u0430\u0435\u0442\u0441\u044F \u043E\u0434\u0438\u043D \u0440\u0430\u0437 \u0437\u0430 \u0431\u043E\u0439 (\u0433\u0440\u0430\u043D\u0430\u0442\u043E\u043C\u0451\u0442 \xAB\u042D\u043F\u043E\u0441\xBB \u0438 \u043F\u043E\u0434\u043E\u0431\u043D\u044B\u0435)";
      const once = document.createElement("input");
      once.type = "checkbox";
      once.checked = rule.oncePerBattle;
      once.addEventListener("change", () => patch({ oncePerBattle: once.checked }));
      onceLabel.appendChild(once);
      onceLabel.append("1 \u0440\u0430\u0437 \u0437\u0430 \u0431\u043E\u0439");
      cond.appendChild(onceLabel);
      const killLabel = document.createElement("label");
      killLabel.title = "\u041F\u0440\u043E\u0433\u043D\u043E\u0437 \u043F\u043E \u043D\u0430\u0431\u043B\u044E\u0434\u0430\u0435\u043C\u043E\u043C\u0443 \u0443\u0440\u043E\u043D\u0443: \u0443\u0434\u0430\u0440 \u044D\u0442\u043E\u0439 \u043A\u043D\u043E\u043F\u043A\u0438 \u0434\u043E\u0431\u044C\u0451\u0442 \u0442\u0435\u043A\u0443\u0449\u0443\u044E \u0446\u0435\u043B\u044C (\u0443\u043C\u043D\u0430\u044F \xAB\u0416\u0430\u0442\u0432\u0430\xBB)";
      const kill = document.createElement("input");
      kill.type = "checkbox";
      kill.checked = rule.onKill;
      kill.addEventListener("change", () => patch({ onKill: kill.checked }));
      killLabel.appendChild(kill);
      killLabel.append("\u0415\u0441\u043B\u0438 \u0434\u043E\u0431\u0438\u0432\u0430\u044E");
      cond.appendChild(killLabel);
      const notFullLabel = document.createElement("label");
      notFullLabel.title = "\u0422\u043E\u043B\u044C\u043A\u043E \u043A\u043E\u0433\u0434\u0430 \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u0435 \u0438\u0433\u0440\u043E\u043A\u0430 \u043C\u0435\u043D\u044C\u0448\u0435 \u043C\u0430\u043A\u0441\u0438\u043C\u0443\u043C\u0430";
      const notFull = document.createElement("input");
      notFull.type = "checkbox";
      notFull.checked = rule.notFullHp;
      notFull.addEventListener("change", () => patch({ notFullHp: notFull.checked }));
      notFullLabel.appendChild(notFull);
      notFullLabel.append("\u041D\u0435\u043F\u043E\u043B\u043D\u043E\u0435 \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u0435");
      cond.appendChild(notFullLabel);
      wrap.append(row, cond);
      return wrap;
    }
    rotationChanged(rotation) {
      this.actions.onBattleRotationChange(rotation);
    }
    async handleExport(actions) {
      const button = this.elements.exportButton;
      const previous = button.textContent ?? "\u042D\u043A\u0441\u043F\u043E\u0440\u0442 JSONL";
      button.disabled = true;
      button.textContent = "\u042D\u043A\u0441\u043F\u043E\u0440\u0442...";
      try {
        const count = await actions.onExport();
        button.textContent = `\u0413\u043E\u0442\u043E\u0432\u043E: ${count}`;
      } catch (error) {
        this.showError(error instanceof Error ? error.message : String(error));
        button.textContent = "\u041E\u0448\u0438\u0431\u043A\u0430";
      } finally {
        window.setTimeout(() => {
          button.textContent = previous;
          button.disabled = false;
        }, 1500);
      }
    }
    async handleClear(actions) {
      if (!window.confirm("\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0432\u0441\u0435 \u0441\u043E\u0431\u0440\u0430\u043D\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435?")) return;
      this.elements.clearButton.disabled = true;
      try {
        await actions.onClear();
      } catch (error) {
        this.showError(error instanceof Error ? error.message : String(error));
      } finally {
        this.elements.clearButton.disabled = false;
      }
    }
  };

  // src/vk/intercept.ts
  function installInterceptors(handlers) {
    installFetch(handlers);
    installXhr(handlers);
    installWebSocket(handlers);
  }
  function installFetch(handlers) {
    if (typeof window.fetch !== "function") return;
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = extractApiMethod(url);
      const longPoll = isLongPollUrl(url);
      const request = parseRequestBody(init?.body);
      const result = originalFetch.call(window, input, init);
      if (longPoll) {
        result.then((response) => {
          try {
            response.clone().json().then((json) => handlers.onLongPoll(json)).catch(() => {
            });
          } catch {
          }
        }).catch(() => {
        });
      } else if (method) {
        result.then((response) => {
          try {
            response.clone().json().then((json) => handlers.onApi(method, json, { url, request, source: "fetch" })).catch((error) => handlers.onError(error, `fetch parse ${method}`));
          } catch (error) {
            handlers.onError(error, `fetch clone ${method}`);
          }
        }).catch(() => {
        });
      }
      return result;
    };
  }
  function installXhr(handlers) {
    const urlByXhr = /* @__PURE__ */ new WeakMap();
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      urlByXhr.set(this, String(url));
      originalOpen.apply(this, [method, url, ...rest]);
    };
    XMLHttpRequest.prototype.send = function(body) {
      const url = urlByXhr.get(this);
      const method = extractApiMethod(url);
      const longPoll = isLongPollUrl(url);
      if (method || longPoll) {
        this.addEventListener("load", () => {
          try {
            let json;
            if (this.responseType === "json") {
              json = this.response;
            } else if ((this.responseType === "" || this.responseType === "text") && this.responseText) {
              json = JSON.parse(this.responseText);
            } else {
              return;
            }
            if (longPoll) {
              handlers.onLongPoll(json);
              return;
            }
            if (method) {
              handlers.onApi(method, json, {
                url: url ?? null,
                request: parseRequestBody(body),
                source: "xhr"
              });
            }
          } catch (error) {
            handlers.onError(error, `xhr parse ${longPoll ? "longpoll" : method}`);
          }
        });
      }
      originalSend.call(this, body);
    };
  }
  function installWebSocket(handlers) {
    const NativeWebSocket = window.WebSocket;
    if (!NativeWebSocket) return;
    try {
      class HookedWebSocket extends NativeWebSocket {
        constructor(url, protocols) {
          super(url, protocols);
          this.addEventListener("message", (event) => {
            if (typeof event.data !== "string") return;
            let data;
            try {
              data = JSON.parse(event.data);
            } catch {
              return;
            }
            handlers.onLongPoll(data);
          });
        }
      }
      window.WebSocket = HookedWebSocket;
    } catch (error) {
      handlers.onError(error, "websocket hook");
    }
  }

  // src/vk/prefetch.ts
  function readPrefetchCache() {
    const cache = window.cur?.apiPrefetchCache;
    if (!Array.isArray(cache)) return [];
    const entries = [];
    for (const item of cache) {
      if (!isRecord(item)) continue;
      const method = typeof item.method === "string" ? item.method : null;
      if (!method || !("response" in item)) continue;
      let response = item.response;
      if (typeof response === "string") {
        try {
          response = JSON.parse(response);
        } catch {
          continue;
        }
      }
      entries.push({ method, response });
    }
    return entries;
  }
  async function ingestPrefetch(runtime) {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const entries = readPrefetchCache();
      if (entries.length > 0 && runtime.state.gamePeerIds.length > 0) {
        for (const entry of entries) {
          await runtime.handleApi(entry.method, entry.response, {
            url: null,
            request: null,
            source: "prefetch"
          });
        }
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1e3));
    }
  }

  // src/main.ts
  var INIT_RETRY_MS = 2e4;
  if (typeof window !== "undefined" && !window.__stalkerAssistant) {
    window.__stalkerAssistant = true;
    const runtime = new Runtime();
    let domCollector = null;
    installInterceptors({
      onApi: (method, response, context) => {
        void runtime.handleApi(method, response, context);
      },
      onLongPoll: (data) => {
        void runtime.handleLongPoll(data);
      },
      onError: (error, context) => runtime.reportError(error, context)
    });
    const start = async () => {
      try {
        if (typeof console !== "undefined" && console.info) {
          console.info(`[Stalker Assistant] v${"0.3.261111.1403"} started`);
        }
        runtime.panel = new Panel({
          onToggleRecording: () => {
            void runtime.setRecording(!runtime.state.recording);
          },
          onToggleMode: (mode) => {
            void runtime.setMode(mode);
          },
          onToggleAutoReset: (enabled) => {
            void runtime.setAutoReset(enabled);
          },
          onToggleManualTakeover: (enabled) => {
            void runtime.setManualTakeover(enabled);
          },
          onToggleBattleAutoExpand: (enabled) => {
            void runtime.setBattleAutoExpand(enabled);
          },
          onToggleGardenAutoSell: (enabled) => {
            void runtime.setGardenAutoSell(enabled);
          },
          onToggleAnomalyHpGuard: (enabled) => {
            void runtime.setAnomalyHpGuard(enabled);
          },
          onRestGuardChange: (enabled, percent) => {
            void runtime.setRestGuard(enabled, percent);
          },
          onBattleRotationChange: (rotation) => {
            void runtime.setBattleRotation(rotation);
          },
          onChooseButton: (buttonText) => {
            void runtime.choosePendingButton(buttonText);
          },
          onDismissChoice: () => runtime.dismissPendingChoice(),
          onAutoDelayChange: (key, valueMs) => {
            void runtime.setAutoDelay(key, valueMs);
          },
          onForkRuleChoice: (signature, choice) => {
            void runtime.setForkRuleChoice(signature, choice);
          },
          onForkRuleDelete: (signature) => {
            void runtime.deleteForkRule(signature);
          },
          onEventRuleChange: (event, action) => {
            void runtime.setEventRule(event, action);
          },
          onAnomalyTypeRuleChange: (typeName, action) => {
            void runtime.setAnomalyTypeRule(typeName, action);
          },
          onExport: () => runtime.exportData(),
          onClear: async () => {
            await runtime.clear();
            domCollector?.reset();
          }
        });
        runtime.panel.update(runtime.state);
        runtime.startPeerTracking();
        document.addEventListener("pointerdown", (event) => {
          if (event.isTrusted) runtime.noteUserActivity();
        }, true);
        document.addEventListener("keydown", (event) => {
          if (event.isTrusted) runtime.noteUserActivity();
        }, true);
        await runtime.init();
        console.info("[Stalker Assistant] init ok");
        afterInit();
      } catch (error) {
        runtime.state.recording = false;
        console.warn("[Stalker Assistant] init \u043D\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u043B\u0441\u044F:", error);
        runtime.reportError(error, "init");
        runtime.startPeerTracking();
        window.setTimeout(() => {
          void retryInit();
        }, INIT_RETRY_MS);
      }
    };
    let afterInitDone = false;
    const afterInit = () => {
      runtime.panel?.update(runtime.state);
      runtime.startPeerTracking();
      if (afterInitDone) return;
      afterInitDone = true;
      void ingestPrefetch(runtime);
      domCollector = new DomCollector({
        onMessages: (messages, peerId) => {
          void runtime.handleDomMessages(messages, peerId);
        },
        onComposerKeyboard: (keyboard, peerId) => {
          runtime.handleComposerKeyboard(keyboard, peerId);
        },
        onGamePeer: (peerId) => runtime.pinGamePeer(peerId),
        shouldCollect: (peerId) => runtime.isGamePeer(peerId),
        onError: (error, context) => runtime.reportError(error, context)
      });
      runtime.onStateReset = () => domCollector?.reset();
      domCollector.start();
      document.addEventListener("visibilitychange", () => {
        runtime.onVisibilityChange(document.hidden);
        if (!document.hidden) domCollector?.rescan();
      });
    };
    const retryInit = () => runtime.init().then(() => {
      console.info("[Stalker Assistant] init ok (\u043F\u043E\u0441\u043B\u0435 \u043F\u043E\u0432\u0442\u043E\u0440\u0430)");
      runtime.clearErrors();
      afterInit();
    }).catch(() => {
      window.setTimeout(() => {
        void retryInit();
      }, INIT_RETRY_MS);
    });
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        void start();
      });
    } else {
      void start();
    }
  }
})();

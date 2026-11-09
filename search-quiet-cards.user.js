// ==UserScript==
// @name         谷歌搜索样式优化 · MD3 风格
// @name:zh-CN   谷歌搜索样式优化 · MD3 风格
// @namespace    local.google-search.quiet-cards
// @version      1.9.13
// @description  MD3 风格的 Google 搜索样式优化，支持卡片瀑布流、实时设置与自动翻页，兼容百度、必应、搜狗。
// @author       dot
// @downloadURL  https://raw.githubusercontent.com/ZOUYIQAQ/Better-Google-Search/main/search-quiet-cards.user.js
// @updateURL    https://raw.githubusercontent.com/ZOUYIQAQ/Better-Google-Search/main/search-quiet-cards.user.js
// @match        https://www.google.com/search*
// @include      /^https:\/\/(?:www\.)?google\.(?:com|[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})\/search(?:\?.*)?$/
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @noframes
// @license      MIT
// @match        https://www.baidu.com/s*
// @match        https://www1.baidu.com/s*
// @match        https://www.bing.com/search*
// @match        https://cn.bing.com/search*
// @match        https://www.sogou.com/web*
// ==/UserScript==

// 为设置表单串行保存最新值，连续输入颜色时合并短时间内的变更。
function createLiveSettings(form, readDraft, saveDraft, showStatus) {
  let timer = 0;
  let revision = 0;
  let chain = Promise.resolve();
  // 串行写入，防止较早的异步保存覆盖较新的选择。
  function enqueue(value) {
    const current = ++revision;
    chain = chain.then(async () => {
      if (current !== revision) return;
      showStatus("正在自动保存…");
      try {
        const persistent = await saveDraft(value);
        if (current === revision)
          showStatus(persistent ? "已自动保存并生效" : "已立即生效；当前环境不支持持久化保存");
      } catch {
        if (current === revision) showStatus("自动保存失败，请重新修改或关闭前重试。", true);
      }
    });
    return chain;
  }
  // 有效颜色和选项才进入保存队列，不写入尚未输入完整的颜色。
  function schedule(delay = 0) {
    clearTimeout(timer);
    const value = readDraft();
    if (!value) return;
    timer = setTimeout(() => {
      timer = 0;
      void enqueue(value);
    }, delay);
  }
  // 文本和取色器输入做短暂合并，开关与单选项立即保存。
  function onInput(event) {
    const type = event.target?.type;
    if (type === "text" || type === "color") schedule(160);
  }
  // 改动完成后立即处理当前表单，包括键盘切换与下拉选项。
  function onChange() {
    schedule(0);
  }
  // 关闭弹窗时处理最后一次尚未执行的有效输入。
  function flush() {
    clearTimeout(timer);
    timer = 0;
    const value = readDraft();
    return value ? enqueue(value) : chain;
  }
  // 弹窗退出后移除表单监听，避免重复保存。
  function dispose() {
    clearTimeout(timer);
    form.removeEventListener("input", onInput);
    form.removeEventListener("change", onChange);
  }
  form.addEventListener("input", onInput);
  form.addEventListener("change", onChange);
  return { schedule, flush, dispose };
}

// 将滚动内容收在圆角内部，右上角关闭按钮不随内容滚动。
function mountSettingsFrame(dialog, shadow, requestClose) {
  const scroll = document.createElement("div");
  scroll.className = "settings-scroll";
  scroll.append(...dialog.childNodes);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "settings-close";
  close.setAttribute("aria-label", "关闭设置");
  close.title = "关闭设置";
  close.textContent = "×";
  close.addEventListener("click", requestClose);
  const css = document.createElement("style");
  css.textContent = `
dialog { overflow: hidden !important; padding: 8px !important; }
.settings-header { min-height: 56px; padding: 12px 20px 4px; }
.settings-scroll {
  box-sizing: border-box;
  max-height: calc(100vh - 120px);
  max-height: calc(100dvh - 120px);
  overflow: auto;
  overscroll-behavior: contain;
  padding: 20px;
  border-radius: 20px;
  scrollbar-width: thin;
  scrollbar-color: #bfa39c transparent;
}
.settings-scroll > form { padding: 0 !important; }
.settings-scroll h2 { margin-right: 44px; }
.settings-close {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--s-container, #f9ebe9);
  color: inherit;
  font: 26px/1 system-ui;
  cursor: pointer;
}
.settings-close:hover { filter: brightness(.96); }
.settings-close:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
`;
  const header = document.createElement("div");
  header.className = "settings-header";
  const heading = scroll.querySelector("h2");
  if (heading) header.append(heading);
  dialog.append(header, scroll, close);
  shadow.append(css);
}

// Google 主适配逻辑，保留文档开始阶段初始化和站点原生交互。
(() => {
  "use strict";
  const HOST = /^(?:www\.)?google\.(?:com|[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/i;
  if (
    !HOST.test(location.hostname) ||
    location.pathname !== "/search" ||
    window.top !== window.self
  )
    return;
  const PREFIX = "gqc";
  const STYLE_ID = `${PREFIX}-styles`;
  const VERSION = "1.9.13";
  const read = (name, fallback) => {
    try {
      return typeof GM_getValue === "function"
        ? GM_getValue(`${PREFIX}.${name}`, fallback)
        : fallback;
    } catch {
      return fallback;
    }
  };
  const config = {
    enabled: read("enabled", true),
    motion: read("motion", true),
    theme: "auto",
    width: read("width", "comfortable"),
    color: /^#[0-9a-f]{6}$/i.test(read("color", "#f9ebe9")) ? read("color", "#f9ebe9") : "#f9ebe9",
    columns: Number(read("columns", 1)) === 2 ? 2 : 1,
    autoLoad: read("autoLoad", true) !== false,
    blockAds: read("blockAds", true) !== false,
  };
  let root;
  let bootTimer = 0;
  let started = false;
  let failed = false;
  let enterIndex = 0;
  let active = false;
  let timer = 0;
  let observer;
  let themeObserver;
  let style;
  let previousScope;
  let initialTheme = "light";
  const marked = new Set();
  const titleLabels = new Map();
  const ownedCurrent = new Set();
  const ownedLinks = new Map();
  const menus = [];
  const media = matchMedia("(prefers-color-scheme: dark)");
  const KNOWN_RESULT = ".MjjYud, .g, .tF2Cxc, [data-sokoban-container], article";
  const SPECIAL = [
    '[role="dialog"]',
    '[role="menu"]',
    '[role="listbox"]',
    "g-scrolling-carousel",
    "g-inner-card",
    "g-accordion-expander",
    "[data-attrid]",
    "[data-async-type]",
    "[data-text-ad]",
    ".uEierd",
    "#Odp5De",
    "#eKIzJc",
    "[data-mcp]",
    "[data-mcpr]",
    "[data-md]",
  ].join(",");
  const AI_INPUT_CSS = `
/* 保存页中的另一种追问外壳使用底部定位，恢复为正文后的普通布局。 */
html[data-gqc-active="true"] :is(.gqc-top,.gqc-ai-overview) :is(.WzWwpc,.y4VEUd,.t0ITR,.eYq7id):has(textarea.ITIRGe) {
  position: static !important;
  inset: auto !important;
  transform: none !important;
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
  margin: 0 !important;
  display: block !important;
}

/* AI追问区沿用卡片主题与正文宽度，保留原生输入、附件和语音交互。 */
html[data-gqc-active="true"] :is(.gqc-top,.gqc-ai-overview) :is(.jkIdtf,.wPoHPd,.Pqkn2e,.F6k9bd,.X6JNf,.WzWwpc,.y4VEUd,.t0ITR,.eYq7id):has(textarea.ITIRGe) {
  width: 100% !important;
  max-width: none !important;
  min-width: 0 !important;
  box-sizing: border-box !important;
  margin-inline: 0 !important;
  padding-inline: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}
html[data-gqc-active="true"] :is(.gqc-top,.gqc-ai-overview) :is(.wPoHPd,.WzWwpc,.y4VEUd,.t0ITR,.eYq7id):has(textarea.ITIRGe) {
  position: relative !important;
  bottom: auto !important;
  z-index: auto !important;
}
html[data-gqc-active="true"] :is(.gqc-top,.gqc-ai-overview) :is(.wPoHPd,.WzWwpc,.y4VEUd,.t0ITR,.eYq7id):has(textarea.ITIRGe)::before,
html[data-gqc-active="true"] :is(.gqc-top,.gqc-ai-overview) :is(.wPoHPd,.WzWwpc,.y4VEUd,.t0ITR,.eYq7id):has(textarea.ITIRGe)::after {
  background: none !important;
  box-shadow: none !important;
}
html[data-gqc-active="true"] :is(.gqc-top,.gqc-ai-overview) .UAbVe:has(textarea.ITIRGe) {
  width: 100% !important;
  max-width: none !important;
  box-sizing: border-box !important;
  margin: 16px 0 8px !important;
  padding: 0 !important;
  background: var(--gqc-bg) !important;
  border: 1px solid var(--gqc-border) !important;
  border-radius: 24px !important;
  box-shadow: none !important;
  color: var(--gqc-ink) !important;
  transition: border-color 160ms ease, box-shadow 160ms ease;
}
html[data-gqc-active="true"] :is(.gqc-top,.gqc-ai-overview) .UAbVe:has(textarea.ITIRGe):focus-within {
  border-color: var(--gqc-link) !important;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--gqc-link) 14%, transparent) !important;
}
html[data-gqc-active="true"] :is(.gqc-top,.gqc-ai-overview) .UAbVe:has(textarea.ITIRGe) :is(.AgWCw,.esoFne,.yaj8zd,.Txyg0d) {
  --xhUGwc: var(--gqc-bg) !important;
  --XKMDxc: var(--gqc-surface) !important;
  --jINu6c: var(--gqc-ink) !important;
  --uLz37c: var(--gqc-muted) !important;
  background: transparent !important;
  box-shadow: none !important;
}
html[data-gqc-active="true"] :is(.gqc-top,.gqc-ai-overview) .UAbVe:has(textarea.ITIRGe) :is(.Zze5V,.d4HWzd,.wYOqBc) {
  display: none !important;
}
html[data-gqc-active="true"] :is(.gqc-top,.gqc-ai-overview) .UAbVe:has(textarea.ITIRGe) .AgWCw {
  margin-bottom: 0 !important;
}
html[data-gqc-active="true"] :is(.gqc-top,.gqc-ai-overview) textarea.ITIRGe {
  box-sizing: border-box !important;
  background: transparent !important;
  color: var(--gqc-ink) !important;
  caret-color: var(--gqc-link) !important;
  font: 16px/1.5 Arial, sans-serif !important;
  border: 0 !important;
  outline: none !important;
  resize: none !important;
}
html[data-gqc-active="true"] :is(.gqc-top,.gqc-ai-overview) textarea.ITIRGe::placeholder {
  color: var(--gqc-muted) !important;
  opacity: 1;
}
html[data-gqc-active="true"] :is(.gqc-top,.gqc-ai-overview) .UAbVe:has(textarea.ITIRGe) button {
  background: var(--gqc-surface) !important;
  color: var(--gqc-link) !important;
  border-radius: 50% !important;
}
html[data-gqc-active="true"] :is(.gqc-top,.gqc-ai-overview) .UAbVe:has(textarea.ITIRGe) button:hover {
  background: color-mix(in srgb, var(--gqc-link) 12%, var(--gqc-surface)) !important;
}
html[data-gqc-active="true"] :is(.gqc-top,.gqc-ai-overview) .UAbVe:has(textarea.ITIRGe) button:focus-visible {
  outline: 2px solid var(--gqc-link) !important;
  outline-offset: 3px;
}
html[data-gqc-active="true"] :is(.gqc-top,.gqc-ai-overview) .UAbVe:has(textarea.ITIRGe) button:disabled {
  opacity: 0.45;
}

html[data-gqc-active="true"] :is(.gqc-top,.gqc-ai-overview) .UAbVe:has(textarea.ITIRGe) button svg {
  color: inherit !important;
  fill: currentColor !important;
}
html[data-gqc-active="true"] :is(.gqc-top,.gqc-ai-overview) .UAbVe:has(textarea.ITIRGe) button[data-xid="input-plate-send-button"]:not(:disabled) {
  background: var(--gqc-link) !important;
  color: var(--gqc-bg) !important;
}
`;
  const CSS = `
html[data-gqc-boot="true"] :is(#searchform, #rcnt, #hdtb, #botstuff) {
  opacity: 0 !important;
}
/* 初次排版完成即完整显示，避免淡入期间已可滚动却仍看不清内容。 */
html[data-gqc-active="true"] :is(#searchform, #rcnt, #hdtb, #botstuff) {
  transition: none;
}
@media (prefers-reduced-motion: reduce) {
  html[data-gqc-boot="true"] :is(#searchform, #rcnt, #hdtb, #botstuff) {
    opacity: 1 !important;
  }
}
html[data-gqc-active="true"] {
  /* 由瀑布流锚点统一维持阅读位置，避免浏览器再次锚定底部分页。 */
  overflow-anchor: none;
  color-scheme: light;
  --gqc-bg: #fffbfa;
  --gqc-surface: #f9ebe9;
  --gqc-primary-container: #f9ebe9;
  --gqc-on-primary: #4f3530;
  --gqc-header-surface: #f9ebe9;
  --gqc-interaction: #eed8d3;
  --gqc-border: #e9dbd7;
  --gqc-ink: #352c29;
  --gqc-muted: #746660;
  --gqc-link: #765047;
  --gqc-accent: #91675e;
  --gqc-line: #e5d8d4;
  --gqc-feature-tint: #fcf1ef;
  --gqc-ring: rgba(145, 103, 94, 0.14);
  --gqc-scroll-thumb: #cbb8b2;
  --gqc-scroll-hover: #a99087;
  --gqc-shadow: none;
  --gqc-shadow-hover: 0 2px 4px #49332d12, 0 4px 12px #49332d0d;
  --gqc-column: 820px;
  --gqc-ease: cubic-bezier(0.2, 0.7, 0.2, 1);
  scrollbar-gutter: stable;
}
html[data-gqc-active="true"][data-gqc-width="compact"] {
  --gqc-column: 740px;
}
html[data-gqc-active="true"][data-gqc-theme="dark"] {
  color-scheme: dark;
  --gqc-bg: #181311;
  --gqc-surface: #2a2220;
  --gqc-primary-container: #493632;
  --gqc-on-primary: #f9ebe9;
  --gqc-header-surface: #352a26;
  --gqc-interaction: #493632;
  --gqc-border: #50413c;
  --gqc-ink: #ede0dc;
  --gqc-muted: #cbbab4;
  --gqc-link: #e6bfb7;
  --gqc-accent: #e6bfb7;
  --gqc-line: #50413c;
  --gqc-feature-tint: #302521;
  --gqc-ring: rgba(230, 191, 183, 0.14);
  --gqc-scroll-thumb: #76625a;
  --gqc-scroll-hover: #ac9186;
  --gqc-shadow: none;
  --gqc-shadow-hover: 0 2px 6px #0004, 0 6px 16px #0003;
}

html[data-gqc-active="true"],
html[data-gqc-active="true"] body {
  background: var(--gqc-bg) !important;
}
html[data-gqc-active="true"],
html[data-gqc-active="true"] * {
  scrollbar-color: var(--gqc-scroll-thumb) var(--gqc-bg);
  scrollbar-width: thin;
}
html[data-gqc-active="true"]::-webkit-scrollbar,
html[data-gqc-active="true"] *::-webkit-scrollbar {
  width: 10px;
  height: 8px;
}
html[data-gqc-active="true"]::-webkit-scrollbar-track,
html[data-gqc-active="true"] *::-webkit-scrollbar-track {
  background: var(--gqc-bg);
}
html[data-gqc-active="true"]::-webkit-scrollbar-thumb,
html[data-gqc-active="true"] *::-webkit-scrollbar-thumb {
  background: var(--gqc-scroll-thumb);
  border: 3px solid var(--gqc-bg);
  border-radius: 10px;
}
html[data-gqc-active="true"]::-webkit-scrollbar-thumb:hover,
html[data-gqc-active="true"] *::-webkit-scrollbar-thumb:hover {
  background: var(--gqc-scroll-hover);
}

html[data-gqc-active="true"] #searchform {
  overflow: visible !important;
  display: block !important;
  position: relative !important;
  top: auto !important;
  left: auto !important;
  right: auto !important;
  box-sizing: border-box !important;
  height: auto !important;
  min-height: 0 !important;
  width: min(var(--gqc-column), calc(100% - 48px)) !important;
  max-width: none !important;
  margin: 28px auto 0 !important;
  padding: 0 !important;
  background: transparent !important;
}
html[data-gqc-active="true"] .gqc-header-host {
  contain: none !important;
  display: block !important;
  height: auto !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  position: relative !important;
  top: auto !important;
}
html[data-gqc-active="true"] #searchform .gqc-header-row {
  display: flex !important;
  flex-wrap: wrap !important;
  justify-content: center !important;
  align-items: center !important;
  grid-column: auto !important;
  min-width: 0 !important;
  max-width: 100% !important;
  width: 100% !important;
  height: auto !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  gap: 12px !important;
}
html[data-gqc-active="true"] #tsf {
  flex: 0 0 100% !important;
  width: 100% !important;
  max-width: 100% !important;
  min-width: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  height: auto !important;
}
html[data-gqc-active="true"] #searchform .A8SBwf {
  width: 100% !important;
  max-width: none !important;
  min-width: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  transform: none !important;
}
html[data-gqc-active="true"] #searchform .logo {
  position: static !important;
  width: auto !important;
  height: auto !important;
  margin: 0 auto 20px !important;
  padding: 0 !important;
  text-align: center !important;
}
html[data-gqc-active="true"] #searchform .RNNXgb {
  min-height: 56px !important;
  border: 0 !important;
  outline: none !important;
  border-radius: 28px !important;
  background: var(--gqc-header-surface) !important;
  color: var(--gqc-ink) !important;
  box-shadow: none !important;
  transition: background-color 0.24s ease;
}
html[data-gqc-active="true"] #searchform .RNNXgb:focus-within {
  border: 0 !important;
  outline: none !important;
  box-shadow: none !important;
}
html[data-gqc-active="true"] #searchform [name="q"] {
  background: transparent !important;
  color: var(--gqc-ink) !important;
}

html[data-gqc-active="true"] #searchform [name="q"]:focus-visible {
  outline: none !important;
  box-shadow: inset 0 -2px 0 var(--gqc-accent) !important;
}

html[data-gqc-active="true"] #searchform .UUbT9 {
  width: 100% !important;
  max-width: 100% !important;
  left: 0 !important;
  right: 0 !important;
}
html[data-gqc-active="true"] #searchform .aajZCb {
  background: var(--gqc-bg) !important;
  color: var(--gqc-ink) !important;
  border: 1px solid var(--gqc-line) !important;
  border-radius: 20px !important;
  margin-top: 8px !important;
  box-shadow:
    0 6px 12px #49332d20,
    0 16px 36px #49332d26 !important;
}
html[data-gqc-active="true"] #searchform .A8SBwf:has([name="q"][aria-expanded="true"]) .RNNXgb {
  border-radius: 28px !important;
}
html[data-gqc-active="true"] #searchform .UUbT9 :is(.wM6W7d, .lnnVSe, .pcTkSc, .sbic) {
  color: var(--gqc-ink) !important;
}
html[data-gqc-active="true"] #searchform .UUbT9 :is(.sbhl, [role="option"][aria-selected="true"]) {
  background: var(--gqc-interaction) !important;
  color: var(--gqc-ink) !important;
}
html[data-gqc-active="true"] #searchform .UUbT9 .xtSCL {
  border-color: var(--gqc-border) !important;
}
html[data-gqc-active="true"] #searchform .Q3DXx a[href*="accounts.google.com"] {
  background: var(--gqc-primary-container) !important;
  color: var(--gqc-on-primary) !important;
  border-radius: 24px !important;
}
html[data-gqc-active="true"] .gqc-module button,
html[data-gqc-active="true"] .gqc-feature [role="button"][aria-expanded] {
  background: var(--gqc-primary-container) !important;
  color: var(--gqc-on-primary) !important;
  border: 0 !important;
  border-radius: 20px !important;
  box-shadow: none !important;
}

html[data-gqc-active="true"] #searchform .Q3DXx {
  position: absolute !important;
  top: -12px !important;
  right: min(0px, calc((var(--gqc-column) - 100vw) / 2 + 24px)) !important;
  left: auto !important;
  bottom: auto !important;
  z-index: 200;
  margin: 0 !important;
  padding: 0 !important;
  flex: 0 0 auto !important;
}
@media (max-width: 680px) {
  html[data-gqc-active="true"] #searchform .Q3DXx {
    position: static !important;
    order: -1;
    display: flex !important;
    justify-content: flex-end !important;
    flex: 0 0 100% !important;
    width: 100% !important;
    margin: 0 0 4px !important;
  }
}
html[data-gqc-active="true"] .gqc-nav-shell {
  box-sizing: border-box !important;
  width: min(var(--gqc-column), calc(100% - 48px)) !important;
  min-width: 0 !important;
  max-width: none !important;
  margin: 8px auto 0 !important;
  padding: 0 !important;
  background: transparent !important;
  border: 0 !important;
  border-bottom: 1px solid var(--gqc-line) !important;
  padding-bottom: 0 !important;
}
html[data-gqc-active="true"] .gqc-nav-wrapper {
  box-sizing: border-box !important;
  display: block !important;
  width: 100% !important;
  min-width: 0 !important;
  max-width: 100% !important;
  margin-inline: 0 !important;
  padding-inline: 0 !important;
}
html[data-gqc-active="true"] .gqc-nav-row {
  box-sizing: border-box !important;
  display: flex !important;
  justify-content: center !important;
  align-items: center !important;
  width: max-content !important;
  min-width: 100% !important;
  max-width: none !important;
  margin-inline: 0 !important;
  padding-inline: 0 !important;
  float: none !important;
}

html[data-gqc-active="true"] .gqc-nav-row {
  min-height: 48px !important;
  gap: 0 !important;
  border: 0 !important;
  padding-block: 0 !important;
}
html[data-gqc-active="true"] .gqc-nav-shell a {
  color: var(--gqc-muted) !important;
  text-decoration: none !important;
}
html[data-gqc-active="true"] .gqc-nav-item {
  position: relative !important;
  box-sizing: border-box !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  min-height: 48px !important;
  padding: 0 12px !important;
  margin: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  color: var(--gqc-muted) !important;
  transition:
    color 0.2s ease,
    background-color 0.2s ease;
}
html[data-gqc-active="true"] .gqc-nav-item .mXwfNd {
  min-height: 48px !important;
  align-items: center !important;
  padding: 0 !important;
  background: transparent !important;
  border-radius: 0 !important;
}
html[data-gqc-active="true"] .gqc-nav-item .mVH5Fc {
  padding-bottom: 0 !important;
  border-bottom: 0 !important;
  align-items: center !important;
}
html[data-gqc-active="true"] .gqc-nav-item :is(.R1QWuf, .M5dSnd) {
  padding-bottom: 0 !important;
  border-bottom: 0 !important;
  color: inherit !important;
}
html[data-gqc-active="true"] .gqc-nav-item:hover {
  background: var(--gqc-primary-container) !important;
  color: var(--gqc-link) !important;
}
html[data-gqc-active="true"] .gqc-nav-item[aria-disabled="true"],
html[data-gqc-active="true"] .gqc-nav-item[aria-current="page"],
html[data-gqc-active="true"] .gqc-nav-item:has([aria-current="page"]) {
  color: var(--gqc-link) !important;
  font-weight: 600 !important;
  background: transparent !important;
}
html[data-gqc-active="true"] .gqc-nav-item[aria-disabled="true"]::after,
html[data-gqc-active="true"] .gqc-nav-item[aria-current="page"]::after,
html[data-gqc-active="true"] .gqc-nav-item:has([aria-current="page"])::after {
  content: "";
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 24px;
  height: 3px;
  border-radius: 3px 3px 0 0;
  background: var(--gqc-accent);
  pointer-events: none;
}
html[data-gqc-active="true"] .gqc-nav-item:focus-visible {
  outline: 2px solid var(--gqc-accent);
  outline-offset: -4px;
  border-radius: 8px !important;
}

html[data-gqc-active="true"] .gqc-native-divider {
  border-color: transparent !important;
  background: transparent !important;
}

html[data-gqc-active="true"] .gqc-pager {
  box-sizing: border-box !important;
  width: 100% !important;
  max-width: 100% !important;
  margin: 16px auto 24px !important;
  padding: 0 !important;
}
html[data-gqc-active="true"] .gqc-pager-table {
  display: block !important;
  width: 100% !important;
  margin: 0 !important;
  border: 0 !important;
}
html[data-gqc-active="true"] .gqc-pager-table > tbody {
  display: block !important;
  width: 100% !important;
}
html[data-gqc-active="true"] .gqc-pager-row {
  display: flex !important;
  flex-wrap: wrap !important;
  justify-content: center !important;
  align-items: center !important;
  width: 100% !important;
  gap: 6px !important;
}
html[data-gqc-active="true"] .gqc-pager-row > td {
  display: block !important;
  padding: 0 !important;
  margin: 0 !important;
  border: 0 !important;
  text-align: center !important;
}
html[data-gqc-active="true"] .gqc-page-link,
html[data-gqc-active="true"] .gqc-page-current {
  box-sizing: border-box !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  min-width: 44px !important;
  min-height: 44px !important;
  padding: 0 12px !important;
  margin: 0 !important;
  border: 0 !important;
  border-radius: 22px !important;
  background: transparent !important;
  color: var(--gqc-muted) !important;
  font:
    500 14px/1.4 Arial,
    sans-serif !important;
  text-decoration: none !important;
  white-space: nowrap !important;
  transition:
    background-color 0.2s ease,
    color 0.2s ease,
    transform 0.2s var(--gqc-ease);
}
html[data-gqc-active="true"] .gqc-pager-row > td.gqc-page-current,
html[data-gqc-active="true"] .gqc-page-current,
html[data-gqc-active="true"] .gqc-page-link:is(#pnnext, #pnprev) {
  display: inline-flex !important;
  background: var(--gqc-primary-container) !important;
  color: var(--gqc-on-primary) !important;
}
html[data-gqc-active="true"] .gqc-page-current {
  font-weight: 700 !important;
}
html[data-gqc-active="true"] .gqc-page-link:is(#pnnext, #pnprev) {
  padding-inline: 20px !important;
}
html[data-gqc-active="true"] .gqc-page-link:is(#pnnext, #pnprev) > span:not(.D2pCqd) {
  margin: 0 !important;
  float: none !important;
}
html[data-gqc-active="true"] .gqc-page-link:hover {
  background: var(--gqc-surface) !important;
  color: var(--gqc-link) !important;
}
html[data-gqc-active="true"] .gqc-page-link:active {
  transform: scale(0.96);
}
html[data-gqc-active="true"] .gqc-page-link:focus-visible,
html[data-gqc-active="true"] .gqc-more-results:focus-visible {
  outline: 2px solid var(--gqc-accent);
  outline-offset: 3px;
}
html[data-gqc-active="true"] .gqc-pager[hidden],
html[data-gqc-active="true"] .gqc-pager[aria-hidden="true"],
html[data-gqc-active="true"] .gqc-more-results[hidden],
html[data-gqc-active="true"] .gqc-more-results[aria-hidden="true"],
html[data-gqc-active="true"] .gqc-pager-table[hidden],
html[data-gqc-active="true"] .gqc-pager-table[aria-hidden="true"],
html[data-gqc-active="true"] .gqc-pager-row > td[hidden],
html[data-gqc-active="true"] .gqc-pager-row > td[aria-hidden="true"] {
  display: none !important;
}
html[data-gqc-active="true"] .gqc-pager-table .D2pCqd:empty,
html[data-gqc-active="true"] .gqc-pager-row > .gqc-pager-decoration {
  display: none !important;
}
html[data-gqc-active="true"] .gqc-more-results {
  box-sizing: border-box !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: min(320px, 100%) !important;
  min-height: 48px !important;
  margin: 24px auto !important;
  padding: 0 24px !important;
  border: 0 !important;
  border-radius: 24px !important;
  background: var(--gqc-primary-container) !important;
  color: var(--gqc-on-primary) !important;
}

html[data-gqc-active="true"] #fbar {
  --center-abs-margin: 0px;
  display: block !important;
  box-sizing: border-box !important;
  width: 100% !important;
  background: var(--gqc-bg) !important;
  border-color: var(--gqc-border) !important;
  text-align: center !important;
}
html[data-gqc-active="true"] #fbar > div {
  box-sizing: border-box !important;
  width: min(var(--gqc-column), 100%) !important;
  max-width: 100% !important;
  margin-inline: auto !important;
  padding-inline: 24px !important;
}
html[data-gqc-active="true"] #fbar :is(.B4GxFc, .smiUbb, #CE62Bb) {
  margin-inline: 0 !important;
  padding-inline: 0 !important;
}
html[data-gqc-active="true"] #fbar .smiUbb {
  line-height: 1.6 !important;
  color: var(--gqc-muted) !important;
}
html[data-gqc-active="true"] #fbar [role="dialog"] {
  text-align: start;
}
html[data-gqc-active="true"] #fbar #fsl {
  display: flex !important;
  flex-wrap: wrap !important;
  align-items: center !important;
  justify-content: center !important;
  box-sizing: border-box !important;
  width: 100% !important;
  max-width: 100% !important;
  margin: 0 auto !important;
  padding: 4px 0 !important;
  gap: 4px 20px;
}
html[data-gqc-active="true"] #fbar #fsl > .Fx4vi {
  padding-inline: 0 !important;
}
html[data-gqc-active="true"] #fbar :is(a, .VtPCGb, .AhYzQb, .KwU3F, .Fx4vi) {
  color: var(--gqc-muted) !important;
}
html[data-gqc-active="true"] #fbar :is(a, [role="button"]):focus-visible {
  outline: 2px solid var(--gqc-accent);
  outline-offset: 3px;
  border-radius: 4px;
}

html[data-gqc-active="true"] .gqc-related-link {
  color: var(--gqc-ink) !important;
  text-decoration: none !important;
  border-radius: 16px;
}
html[data-gqc-active="true"] .gqc-related-surface {
  background: var(--gqc-surface) !important;
  color: var(--gqc-ink) !important;
  border: 0 !important;
  border-radius: 16px !important;
  transition:
    background-color 0.2s ease,
    box-shadow 0.2s ease;
}
html[data-gqc-active="true"] .b2Rnsc.gqc-related-surface {
  height: auto !important;
  min-height: 52px;
}
html[data-gqc-active="true"] .gqc-related-surface .B2VR9 {
  background: transparent !important;
}
html[data-gqc-active="true"] .gqc-related-link :is(.dg6jd, .DxHbyd, .wM6W7d) {
  color: inherit !important;
}
html[data-gqc-active="true"] .gqc-related-surface:has(.gqc-related-link:hover),
html[data-gqc-active="true"] .gqc-related-surface:has(.gqc-related-link:focus-visible),
html[data-gqc-active="true"] .gqc-related-link:hover .gqc-related-surface,
html[data-gqc-active="true"] .gqc-related-link:focus-visible .gqc-related-surface,
html[data-gqc-active="true"] .gqc-related-link.gqc-related-surface:is(:hover, :focus-visible) {
  background: var(--gqc-interaction) !important;
}
html[data-gqc-active="true"] .gqc-related-link:focus-visible {
  outline: 2px solid var(--gqc-accent);
  outline-offset: 2px;
}

html[data-gqc-active="true"] .gqc-layout {
  --center-abs-margin: 0px;
  --center-width: 100%;
  box-sizing: border-box !important;
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) !important;
  align-items: start !important;
  width: min(var(--gqc-column), calc(100% - 48px)) !important;
  max-width: none !important;
  min-width: 0 !important;
  margin: 28px auto 0 !important;
  padding: 0 !important;
  gap: 24px !important;
  float: none !important;
}
html[data-gqc-active="true"] .gqc-primary,
html[data-gqc-active="true"] .gqc-sidebar {
  box-sizing: border-box !important;
  min-width: 0 !important;
  max-width: 100% !important;
  width: auto !important;
  margin: 0 !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
  float: none !important;
  left: auto !important;
  right: auto !important;
}
html[data-gqc-active="true"] .gqc-layout > .gqc-top {
  grid-column: 1 / -1;
  margin-bottom: 0 !important;
}
html[data-gqc-active="true"] .gqc-top .YNk70c {
  display: block !important;
}
html[data-gqc-active="true"] .gqc-top .SePcAf {
  max-width: 100% !important;
}
html[data-gqc-active="true"] .gqc-top .YNk70c,
html[data-gqc-active="true"] .gqc-top .SLPe5b {
  margin-inline: 0 !important;
  max-width: 100% !important;
  width: auto !important;
}
html[data-gqc-active="true"] .gqc-primary {
  grid-column: 1;
}
html[data-gqc-active="true"] .gqc-sidebar {
  grid-column: 1 !important;
  position: static !important;
  display: block !important;
  height: auto !important;
  max-height: none !important;
}
html[data-gqc-active="true"] .gqc-sidebar[hidden],
html[data-gqc-active="true"] .gqc-sidebar[aria-hidden="true"] {
  display: none !important;
}
html[data-gqc-active="true"] .gqc-stack {
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) !important;
  width: 100% !important;
  gap: 24px !important;
}
html[data-gqc-active="true"] .gqc-stack-item {
  position: static !important;
  float: none !important;
  grid-column: 1 !important;
  width: 100% !important;
  min-width: 0 !important;
  max-width: 100% !important;
  margin-inline: 0 !important;
  padding-inline: 0 !important;
}
html[data-gqc-active="true"] .gqc-sidebar > div {
  background: var(--gqc-surface) !important;
  border: 0 !important;
  border-radius: 24px !important;
  max-width: 100% !important;
  width: auto !important;
  margin-inline: 0 !important;
}
html[data-gqc-active="true"] .gqc-layout > * {
  grid-column: 1 !important;
}
html[data-gqc-active="true"] .gqc-fallback-center {
  box-sizing: border-box !important;
  width: min(var(--gqc-column), calc(100% - 48px)) !important;
  max-width: 100% !important;
  min-width: 0 !important;
  margin-inline: auto !important;
}
html[data-gqc-active="true"] .gqc-results {
  width: 100% !important;
  max-width: 100% !important;
}

@media (min-width: 1100px) {
  html[data-gqc-active="true"][data-gqc-columns="2"] {
    --gqc-column: 1200px;
  }
  html[data-gqc-active="true"][data-gqc-columns="2"] .gqc-results {
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    gap: 20px;
    align-items: start;
  }
  html[data-gqc-active="true"][data-gqc-columns="2"] .gqc-results > * {
    grid-column: 1 / -1;
    min-width: 0;
  }
  html[data-gqc-active="true"][data-gqc-columns="2"] .gqc-results > .gqc-card {
    grid-column: auto;
    margin-bottom: 0 !important;
  }
  html[data-gqc-active="true"][data-gqc-columns="2"] .gqc-results > .gqc-pass-through {
    display: contents !important;
  }
  html[data-gqc-active="true"][data-gqc-columns="2"]
    .gqc-results
    > .gqc-card:has([aria-expanded], video, g-scrolling-carousel) {
    grid-column: 1 / -1;
  }
}
html[data-gqc-active="true"] .gqc-card,
html[data-gqc-active="true"] .gqc-module {
  box-sizing: border-box !important;
  position: relative;
  width: 100% !important;
  max-width: 100% !important;
  margin: 0 0 16px !important;
  padding: 24px !important;
  border: 0 !important;
  border-radius: 16px !important;
  background: var(--gqc-surface) !important;
  box-shadow: var(--gqc-shadow);
  transition:
    transform 0.3s var(--gqc-ease),
    box-shadow 0.3s ease;
}
html[data-gqc-active="true"] .gqc-module {
  padding: 24px;
  border-radius: 24px !important;
}
html[data-gqc-active="true"] .gqc-module a[href] {
  color: var(--gqc-link) !important;
}
html[data-gqc-active="true"] .gqc-card .tF2Cxc:last-child {
  margin-bottom: 0 !important;
}
html[data-gqc-active="true"] .gqc-card:has([aria-expanded="true"]),
html[data-gqc-active="true"] .gqc-card:has([role="dialog"]) {
  transform: none !important;
}
html[data-gqc-active="true"] .gqc-feature {
  --xhUGwc: var(--gqc-feature-tint);
  background: var(--gqc-feature-tint) !important;
}
html[data-gqc-active="true"] .gqc-feature .lE72Gc {
  background: var(--gqc-feature-tint) !important;
}
html[data-gqc-active="true"] .gqc-feature .bPlg5e {
  background-image: linear-gradient(transparent, var(--gqc-feature-tint) 14px) !important;
}
html[data-gqc-active="true"] .gqc-feature .RDmXvc {
  background-image: linear-gradient(transparent 0, var(--gqc-feature-tint) 80px) !important;
}
html[data-gqc-active="true"] .gqc-feature .Jzkafd[role="button"] {
  background: transparent !important;
}
html[data-gqc-active="true"] .gqc-feature .Jzkafd > .in7vHe {
  width: 100% !important;
  max-width: none !important;
  box-sizing: border-box !important;
  border: 0 !important;
  border-radius: 24px !important;
  background: var(--gqc-primary-container) !important;
  color: var(--gqc-on-primary) !important;
  box-shadow: none !important;
}
html[data-gqc-active="true"] .gqc-feature .Jzkafd > .in7vHe .niO4u {
  color: inherit !important;
}
html[data-gqc-active="true"] .gqc-feature .Jzkafd:focus-visible {
  outline: 2px solid var(--gqc-accent);
  outline-offset: 3px;
}
html[data-gqc-active="true"] .gqc-feature mark {
  background: var(--gqc-primary-container) !important;
  color: inherit !important;
}
html[data-gqc-active="true"] .gqc-card .gqc-title {
  display: block !important;
  color: var(--gqc-link) !important;
  font-size: 21px !important;
  line-height: 1.48 !important;
  font-weight: 500 !important;
  text-decoration: none !important;
  background-image: none !important;
  padding-bottom: 0 !important;
  border-bottom: 0 !important;
}
html[data-gqc-active="true"] .gqc-card .gqc-title-text {
  display: inline;
  background-image: linear-gradient(var(--gqc-accent),var(--gqc-accent));
  background-size: 0% 1px;
  background-position: left bottom;
  background-repeat: no-repeat;
  padding-bottom: 3px;
  text-decoration: none;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
  transition: background-size .36s cubic-bezier(.22,1,.36,1);
}
html[data-gqc-active="true"] .gqc-card:hover .gqc-title-text,
html[data-gqc-active="true"] .gqc-card:focus-within .gqc-title-text {
  background-size: 100% 1px;
}
html[data-gqc-active="true"][data-gqc-motion="false"] .gqc-title-text {
  transition: none;
}
@media (prefers-reduced-motion:reduce) {
  html[data-gqc-active="true"] .gqc-title-text {
    transition: none;
  }
}
html[data-gqc-active="true"] .gqc-card a:has(.gqc-title) {
  text-decoration: none !important;
}
html[data-gqc-active="true"] .gqc-card:focus-within {
  box-shadow: var(--gqc-shadow-hover);
}
html[data-gqc-active="true"] .gqc-card a:focus-visible {
  outline: 2px solid var(--gqc-accent);
  outline-offset: 5px;
  border-radius: 3px;
}
html[data-gqc-active="true"][data-gqc-motion="true"] .gqc-enter {
  animation: gqc-enter 0.4s var(--gqc-ease) var(--gqc-enter-delay, 0ms) both;
}
@keyframes gqc-enter {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.992);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (hover: hover) and (pointer: fine) {
  html[data-gqc-active="true"] .gqc-card:hover {
    transform: translateY(-2px) scale(1.004);
    box-shadow: var(--gqc-shadow-hover);
  }
  html[data-gqc-active="true"] .gqc-card:active {
    transform: translateY(0) scale(0.998);
  }
}
@media (max-width: 600px) {
  html[data-gqc-active="true"] #searchform,
  html[data-gqc-active="true"] .gqc-nav-shell {
    width: calc(100% - 24px) !important;
  }
  html[data-gqc-active="true"] .gqc-nav-shell {
    overflow-x: auto;
  }
  html[data-gqc-active="true"] .gqc-layout,
  html[data-gqc-active="true"] .gqc-fallback-center {
    width: calc(100% - 24px) !important;
    margin-top: 16px !important;
    gap: 16px !important;
  }
  html[data-gqc-active="true"] .gqc-card,
  html[data-gqc-active="true"] .gqc-module {
    padding: 20px !important;
    border-radius: 16px !important;
    margin-bottom: 12px !important;
  }
  html[data-gqc-active="true"] .gqc-card .gqc-title {
    font-size: 19px !important;
  }
}
html[data-gqc-active="true"][data-gqc-motion="false"] .gqc-card,
html[data-gqc-active="true"][data-gqc-motion="false"] .gqc-module,
html[data-gqc-active="true"][data-gqc-motion="false"] .gqc-title,
html[data-gqc-active="true"][data-gqc-motion="false"] .gqc-nav-item,
html[data-gqc-active="true"][data-gqc-motion="false"] .gqc-page-link,
html[data-gqc-active="true"][data-gqc-motion="false"] .gqc-related-surface,
html[data-gqc-active="true"][data-gqc-motion="false"] #searchform .RNNXgb {
  transition: none !important;
  animation: none !important;
}
html[data-gqc-active="true"][data-gqc-motion="false"] :is(.gqc-card, .gqc-page-link) {
  transform: none !important;
}
@media (prefers-reduced-motion: reduce) {
  html[data-gqc-active="true"] :is(.gqc-card, .gqc-page-link) {
    transform: none !important;
  }
  html[data-gqc-active="true"] .gqc-card,
  html[data-gqc-active="true"] .gqc-module,
  html[data-gqc-active="true"] .gqc-title,
  html[data-gqc-active="true"] .gqc-nav-item,
  html[data-gqc-active="true"] .gqc-page-link,
  html[data-gqc-active="true"] .gqc-related-surface,
  html[data-gqc-active="true"] #searchform .RNNXgb {
    animation: none !important;
    transition: none !important;
  }
}
@media (forced-colors: active) {
  html[data-gqc-active="true"] #searchform [name="q"]:focus-visible {
    outline: 2px solid Highlight !important;
    outline-offset: 2px;
  }
  html[data-gqc-active="true"]
    #searchform
    .UUbT9
    :is(.sbhl, [role="option"][aria-selected="true"]) {
    background: Highlight !important;
    color: HighlightText !important;
  }
  html[data-gqc-active="true"] .gqc-page-current {
    outline: 2px solid Highlight;
    outline-offset: -2px;
  }
  html[data-gqc-active="true"] .gqc-page-link {
    color: LinkText !important;
  }
  html[data-gqc-active="true"] .gqc-card,
  html[data-gqc-active="true"] .gqc-module {
    border: 1px solid CanvasText !important;
  }
  html[data-gqc-active="true"] .gqc-nav-item[aria-current="page"],
  html[data-gqc-active="true"] .gqc-nav-item[aria-disabled="true"],
  html[data-gqc-active="true"] .gqc-nav-item:has([aria-current="page"]) {
    text-decoration: underline !important;
    text-underline-offset: 8px;
  }
  html[data-gqc-active="true"],
  html[data-gqc-active="true"] * {
    scrollbar-color: auto;
  }
  html[data-gqc-active="true"] .gqc-card:hover .gqc-title,
  html[data-gqc-active="true"] .gqc-card:focus-within .gqc-title {
    text-decoration: underline !important;
    text-decoration-thickness: 1px !important;
  }
}
@media print {
  html[data-gqc-active="true"] .gqc-layout {
    display: block !important;
    width: 100% !important;
  }
  html[data-gqc-active="true"] .gqc-card,
  html[data-gqc-active="true"] .gqc-module {
    box-shadow: none !important;
    transform: none !important;
    animation: none !important;
    break-inside: avoid;
  }
}

@media (min-width: 1100px) {
  html[data-gqc-active="true"][data-gqc-columns="2"] .gqc-results.gqc-masonry-host {
    display: block !important;
    position: relative;
    overflow: visible;
    overflow-anchor: none;
  }
  html[data-gqc-active="true"][data-gqc-columns="2"]
    .gqc-results.gqc-masonry-host
    > .gqc-masonry-item {
    position: absolute;
    margin: 0 !important;
  }
  html[data-gqc-active="true"][data-gqc-columns="2"]
    .gqc-results.gqc-masonry-host
    > .gqc-pass-through {
    display: contents !important;
  }
}

/* 空模块不绘制背景、不参与布局；原生内容加载后会自动恢复。 */
html[data-gqc-active="true"] .gqc-empty {
  display: none !important;
}
/* 复杂模块统一表面，同时保留原生控件的展开、地图与菜单层级。 */
html[data-gqc-active="true"] :is(.gqc-questions, .gqc-local, .gqc-related, .gqc-images) {
  box-sizing: border-box !important;
  padding: 24px !important;
  border-radius: 24px !important;
  background: var(--gqc-surface) !important;
  color: var(--gqc-ink) !important;
  margin: 0 0 20px !important;
}
html[data-gqc-active="true"]
  :is(.gqc-questions, .gqc-local, .gqc-related, .gqc-images)
  :is(h2, [role="heading"][aria-level="2"]) {
  margin: 0 0 16px !important;
  font-size: 20px !important;
  color: var(--gqc-ink) !important;
}
html[data-gqc-active="true"] .gqc-questions :is(.related-question-pair, [data-initq]) {
  border-color: var(--gqc-line) !important;
}
html[data-gqc-active="true"] .gqc-questions :is(button, [role="button"]) {
  color: var(--gqc-ink);
  background-color: transparent;
}
html[data-gqc-active="true"] .gqc-local :is(.VkpGBb, [data-local-attribute]) {
  border-color: var(--gqc-line) !important;
  color: var(--gqc-ink) !important;
}
html[data-gqc-active="true"] .gqc-local :is(a[href*="/maps"], a[href*="maps.google"]) {
  color: var(--gqc-link) !important;
}
html[data-gqc-active="true"] .gqc-local :is(img.YQ4gaf,img.wA1Bge) {
  max-width: 100%;
  border-radius: 16px;
}
/* AI概览跨越完整结果列宽；内部原生引用、展开和操作按钮保持可用。 */
html[data-gqc-active="true"] .gqc-ai-overview {
  --gqc-feature-tint: var(--gqc-surface);
  --xhUGwc: var(--gqc-surface);
  box-sizing: border-box !important;
  width: 100% !important;
  max-width: none !important;
  min-width: 0 !important;
  margin: 0 0 20px !important;
  padding: 24px !important;
  border-radius: 24px !important;
  background: var(--gqc-surface) !important;
  color: var(--gqc-ink) !important;
}
html[data-gqc-active="true"] .gqc-ai-overview :is(#m-x-content,[data-lf-template-root],[data-subtree="mfc"],[data-scope-id="turn"]) {
  box-sizing: border-box !important;
  width: 100% !important;
  max-width: none !important;
  min-width: 0 !important;
}
html[data-gqc-active="true"] .gqc-ai-overview :is(.hdzaWe, .h7Tj7e, .lACQkd) {
  box-sizing: border-box !important;
  width: 100% !important;
  max-width: 100% !important;
}
html[data-gqc-active="true"] .gqc-ai-overview .h7Tj7e:not(.zc75bb) {
  overflow-x: clip !important;
  border-radius: 16px;
}
/* 展开区域与外层卡片共用底色，消除原生遮罩的矩形色块边缘。 */
html[data-gqc-active="true"] .gqc-ai-overview .zNsLfb {
  background: var(--gqc-surface) !important;
  border-radius: 24px;
}
html[data-gqc-active="true"] .gqc-related :is(.y6Uyqe, .EIaa9b, .AJLUJb) {
  width: 100% !important;
  min-width: 0 !important;
  max-width: none !important;
}
/* AI正文跟随跨列卡片展开，覆盖原生652像素正文限宽。 */
html[data-gqc-active="true"] :is(.gqc-ai-overview,.gqc-feature) .mZJni {
  box-sizing: border-box !important;
  width: 100% !important;
  min-width: 0 !important;
  max-width: none !important;
}
/* 地图模块与普通卡片等宽，地图和地点列表保持原生链接和交互。 */
html[data-gqc-active="true"] .gqc-local :is(.S7dMR,.yB02Ub,.o8ebK,.VkpGBb) {
  min-width: 0 !important;
  max-width: 100% !important;
}
html[data-gqc-active="true"] .gqc-local .S7dMR {
  overflow: hidden;
  border-radius: 16px;
}

html[data-gqc-active="true"] .gqc-local .jRKCUd {
  display: block !important;
  margin-top: 12px !important;
  text-decoration: none !important;
}
html[data-gqc-active="true"] .gqc-local .jRKCUd hr {
  display: none !important;
}
html[data-gqc-active="true"] .gqc-local .ZFiwCf {
  width: 100% !important;
  min-height: 44px !important;
  border-radius: 22px !important;
  background: color-mix(in srgb, var(--gqc-accent) 10%, var(--gqc-surface)) !important;
  color: var(--gqc-link) !important;
}
html[data-gqc-active="true"] .gqc-local .ZFiwCf svg {
  fill: currentColor !important;
}
html[data-gqc-active="true"] .gqc-images:not(.gqc-gallery-expanded) .gqc-image-overflow { display: none !important; }
html[data-gqc-active="true"] .gqc-rich :is(g-scrolling-carousel,g-inner-card) { max-width: 100%; min-width: 0; }
html[data-gqc-active="true"] #rso .gqc-rich a[href],
html[data-gqc-active="true"] #botstuff a[href] { color: var(--gqc-link) !important; }
html[data-gqc-active="true"] #rso .gqc-rich a[href] * { color: inherit !important; }
html[data-gqc-active="true"] .gqc-rich .ZFiwCf {
  background: color-mix(in srgb, var(--gqc-accent) 10%, var(--gqc-surface)) !important;
  color: var(--gqc-link) !important;
  border-radius: 22px !important;
}
html[data-gqc-active="true"] .gqc-rich.gqc-sidebar > * { max-width: 100%; min-width: 0; }
html[data-gqc-active="true"] #wob_wc .wob_ds { background: var(--gqc-primary-container) !important; }
/* 原生知识面板曾为侧栏折叠容器，接入瀑布流后改为自然内容高度。 */
html[data-gqc-active="true"] .gqc-sidebar.gqc-rich #jOAHU > .A6K0A {
  height: auto !important;
  max-height: none !important;
  overflow: visible !important;
  margin: 0 !important;
  padding: 0 !important;
}
/* 生成中就保留首位身份；只显示明确状态，不产生空白占位。 */
html[data-gqc-active="true"] .gqc-top { order: -1; position: relative; }
html[data-gqc-active="true"] .gqc-ai-pending::before {
  content: "AI 概览正在生成…";
  display: block;
  position: absolute;
  top: 20px;
  right: 24px;
  font-size: 12px;
  color: var(--gqc-muted);
}
${AI_INPUT_CSS}
/* 尚无正文的真实生成阶段使用轻量骨架，让固定预览框有清楚的加载含义。 */
html[data-gqc-active="true"] .gqc-ai-pending:not(.gqc-ai-managed)::before {
  content: "AI 概览 · 正在生成";
  left: 24px;
  right: auto;
  font-size: 14px;
  font-weight: 600;
}
html[data-gqc-active="true"] .gqc-ai-pending:not(.gqc-ai-managed)::after {
  content: "";
  position: absolute;
  inset: 82px 24px 86px;
  pointer-events: none;
  background:
    linear-gradient(var(--gqc-border) 0 0) 0 0 / 70% 10px,
    linear-gradient(var(--gqc-border) 0 0) 0 42px / 94% 10px,
    linear-gradient(var(--gqc-border) 0 0) 0 84px / 86% 10px,
    linear-gradient(var(--gqc-border) 0 0) 0 126px / 90% 10px,
    linear-gradient(var(--gqc-border) 0 0) 0 168px / 62% 10px;
  background-repeat: no-repeat;
  opacity: 0.55;
}
/* 原生单列结果的收起动画会缩放后续兄弟节点，瀑布流只接受自身定位。 */
html[data-gqc-active="true"] .gqc-masonry-item {
  transform: none !important;
  translate: none !important;
  rotate: none !important;
  scale: none !important;
  animation: none !important;
  transition-property: box-shadow, background-color !important;
}
/* 主AI默认保持统一预览高度，原生生成完成不会从整段正文突然折回。 */
html[data-gqc-active="true"] :is(.gqc-top,.gqc-ai-overview):not(.gqc-user-expanded) .h7Tj7e {
  height: 399px !important;
  min-height: 399px !important;
  max-height: 399px !important;
  overflow-y: clip !important;
}
/* 问答内的AI沿用卡片主题，消除原生652px内容宽度与横向滚动。 */
html[data-gqc-active="true"] .gqc-questions {
  --xhUGwc: var(--gqc-surface);
  --gqc-feature-tint: var(--gqc-surface);
}
html[data-gqc-active="true"] .gqc-questions :is(.hICk5e,.lJyoBc,.XTvndd,.mZJni,[data-subtree="mfc"]) {
  box-sizing: border-box !important;
  width: 100% !important;
  min-width: 0 !important;
  max-width: 100% !important;
  margin-inline: 0 !important;
  padding-inline: 0 !important;
}
html[data-gqc-active="true"] .gqc-questions :is(.lACQkd,.zNsLfb) {
  max-width: 100% !important;
  background: var(--gqc-surface) !important;
}
html[data-gqc-active="true"] .gqc-questions .Jzkafd > .in7vHe {
  width: 100% !important;
  box-sizing: border-box !important;
  border: 0 !important;
  border-radius: 24px !important;
  background: var(--gqc-primary-container) !important;
  color: var(--gqc-on-primary) !important;
  box-shadow: none !important;
}
html[data-gqc-active="true"] .gqc-questions .Jzkafd :is(svg,.niO4u) {
  color: inherit !important;
  fill: currentColor !important;
}
html[data-gqc-active="true"] .gqc-questions :is(.RDmXvc,.bPlg5e) {
  background-image: linear-gradient(transparent,var(--gqc-surface) 80px) !important;
}
html[data-gqc-active="true"] .gqc-questions .P4K06d[role="button"] {
  box-sizing: border-box !important;
  width: 100% !important;
  min-height: 44px;
  background: var(--gqc-primary-container) !important;
  border: 1px solid var(--gqc-line) !important;
  border-radius: 24px !important;
  color: var(--gqc-link) !important;
  box-shadow: none !important;
  transition: none !important;
}
html[data-gqc-active="true"] .gqc-questions .P4K06d::before,
html[data-gqc-active="true"] .gqc-questions .P4K06d::after {
  background: transparent !important;
  box-shadow: none !important;
}
html[data-gqc-active="true"] .gqc-questions .P4K06d :is(.niO4u,svg) {
  color: inherit !important;
  fill: currentColor !important;
}
html[data-gqc-active="true"] .gqc-questions .P4K06d:focus-visible {
  outline: 2px solid var(--gqc-accent);
  outline-offset: 3px;
}
/* AI刚出现时即置顶并使用固定预览框，生成完成不改变下方结果起点。 */
html[data-gqc-active="true"] #rcnt > :has(#Odp5De,#eKIzJc):not(:has(#rso)) { order: -1; }
html[data-gqc-active="true"] :is(.gqc-ai-managed,.gqc-ai-overview.gqc-ai-pending,#rcnt > :has(#Odp5De,#eKIzJc):not(:has(#rso))):not(.gqc-user-expanded) {
  position: relative;
  box-sizing: border-box !important;
  height: 485px !important;
  min-height: 485px !important;
  max-height: 485px !important;
  overflow: clip !important;
}
html[data-gqc-active="true"] .gqc-ai-managed:not(.gqc-user-expanded)::after {
  content: "";
  position: absolute;
  left: 24px;
  right: 24px;
  bottom: 68px;
  height: 72px;
  z-index: 3;
  background: linear-gradient(transparent,var(--gqc-feature-tint,var(--gqc-surface)));
  pointer-events: none;
}
html[data-gqc-active="true"] .gqc-ai-managed [role="button"][aria-controls="m-x-content"] { visibility: hidden !important; }
html[data-gqc-active="true"] .gqc-ai-toggle {
  z-index: 5;
  display: block;
  box-sizing: border-box;
  width: 100%;
  min-height: 44px;
  padding: 10px 20px;
  border: 1px solid var(--gqc-line);
  border-radius: 24px;
  background: var(--gqc-primary-container);
  color: var(--gqc-link);
  font: 500 14px/1.5 Arial,sans-serif;
  cursor: pointer;
}
html[data-gqc-active="true"] .gqc-ai-managed:not(.gqc-user-expanded) > .gqc-ai-toggle {
  position: absolute;
  bottom: 24px;
  left: 24px;
  width: calc(100% - 48px);
}
html[data-gqc-active="true"] .gqc-user-expanded > .gqc-ai-toggle { margin-top: 16px; }
html[data-gqc-active="true"] .gqc-ai-toggle:focus-visible { outline: 2px solid var(--gqc-accent); outline-offset: 3px; }
html[data-gqc-active="true"] .gqc-user-expanded :is(.h7Tj7e,#m-x-content) {
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
  overflow: visible !important;
}
/* 图片结果保持原生预览节点，以紧凑三列画廊融入单列卡片。 */
html[data-gqc-active="true"] .gqc-images :is(.cakeVe,.ZGKPYc) {
  display: grid !important;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px 12px;
  padding: 0 !important;
  margin: 0 !important;
}
html[data-gqc-active="true"] .gqc-images:not(.gqc-gallery-expanded) .ZGKPYc .vCUuC:nth-child(n+7) { display: none !important; }
html[data-gqc-active="true"] .gqc-images .ZGKPYc { max-height: none !important; overflow: visible !important; }
html[data-gqc-active="true"] .gqc-images .VwgOIc { display: contents; }
html[data-gqc-active="true"] .gqc-images :is(.vCUuC,.w43QB,.oYLlHe,.kwICDb) {
  width: 100% !important;
  min-width: 0 !important;
  max-width: 100% !important;
}
html[data-gqc-active="true"] .gqc-images .vCUuC { margin: 0 !important; }
html[data-gqc-active="true"] .gqc-images .pb66sc {
  position: relative;
  padding-top: 0 !important;
  aspect-ratio: 4 / 3;
  width: 100%;
  height: auto !important;
  overflow: hidden;
  border-radius: 12px;
  background: var(--gqc-bg);
}
html[data-gqc-active="true"] .gqc-images .pb66sc img {
  width: 100% !important;
  height: 100% !important;
  object-fit: contain !important;
}
html[data-gqc-active="true"] .gqc-images .Yt787 {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2 !important;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.45;
  color: var(--gqc-link);
}
html[data-gqc-active="true"] .gqc-images .jRKCUd { margin-top: 16px; }
html[data-gqc-active="true"] .gqc-images .jRKCUd hr { display: none !important; }
html[data-gqc-active="true"] .gqc-images .ZFiwCf {
  width: 100% !important;
  min-height: 44px;
  border-radius: 22px;
  background: color-mix(in srgb, var(--gqc-accent) 10%, var(--gqc-surface)) !important;
  color: var(--gqc-link) !important;
}
html[data-gqc-active="true"] .gqc-images .ZFiwCf svg { fill: currentColor; }
@media (max-width: 600px) {
  html[data-gqc-active="true"] .gqc-images :is(.cakeVe,.ZGKPYc) { grid-template-columns: repeat(2, minmax(0,1fr)); }
}
/* 原生模块的页间留白由外层卡片接管，避免卡片底部多出44像素空隙。 */
html[data-gqc-active="true"] .gqc-questions > .A6K0A > .cUnQKe,
html[data-gqc-active="true"] .gqc-related > .ULSxyf {
  margin-bottom: 0 !important;
}
/* 问答展开图标使用主题色，不改变原生按钮的点击区域和状态。 */
html[data-gqc-active="true"] .gqc-questions .aj35ze {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 32px !important;
  height: 32px !important;
  border-radius: 50% !important;
  border: 0 !important;
  box-shadow: none !important;
  background: color-mix(in srgb, var(--gqc-accent) 10%, var(--gqc-surface)) !important;
  color: var(--gqc-link) !important;
  transition: background-color .2s ease;
}
html[data-gqc-active="true"] .gqc-questions .aj35ze svg {
  fill: currentColor !important;
  color: inherit !important;
}
html[data-gqc-active="true"] .gqc-questions [role="button"]:is(:hover,:focus-visible,[aria-expanded="true"]) .aj35ze {
  background: color-mix(in srgb, var(--gqc-accent) 18%, var(--gqc-surface)) !important;
}
html[data-gqc-active="true"] .gqc-questions [role="button"]:focus-visible {
  outline: 2px solid var(--gqc-accent);
  outline-offset: 3px;
  border-radius: 12px;
}
html[data-gqc-active="true"] .gqc-ai-overview .Jzkafd svg {
  color: var(--gqc-link) !important;
  fill: currentColor !important;
}
html[data-gqc-active="true"] .gqc-related .MjjYud {
  margin: 0 !important;
  padding-bottom: 0 !important;
}
html[data-gqc-active="true"] .gqc-related .gqc-related-link {
  color: var(--gqc-link) !important;
}
/* 输入文字与搜索框图标垂直居中，焦点线不改变输入框几何。 */
html[data-gqc-active="true"] #searchform .RNNXgb {
  align-items: center !important;
  min-height: 56px !important;
}
html[data-gqc-active="true"] #searchform .SDkEP {
  display: flex !important;
  align-items: center !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  min-height: 56px !important;
}
html[data-gqc-active="true"] #searchform .a4bIc {
  display: flex !important;
  align-items: center !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  min-height: 56px !important;
}
html[data-gqc-active="true"] #searchform :is(input, textarea)[name="q"] {
  box-sizing: border-box !important;
  align-self: center !important;
  margin: 0 !important;
  padding: 0 !important;
  height: 28px !important;
  min-height: 28px !important;
  line-height: 28px !important;
  resize: none !important;
  overflow-y: hidden !important;
}
html[data-gqc-active="true"] #searchform [name="q"]:focus-visible {
  box-shadow: none !important;
  outline: none !important;
}
`;

  // 给节点添加可恢复的脚本标记。
  function mark(node, name) {
    if (!node || node.classList.contains(name)) return;
    node.classList.add(name);
    marked.add(node);
  }

  // 移除脚本负责的节点标记。
  function unmark(node, name) {
    if (node) node.classList.remove(name);
  }

  // 读取站点和系统当前使用的明暗主题。
  function pageTheme() {
    if (!document.body) return media.matches ? "dark" : "light";
    // 原生主题变量不受卡片配色覆盖；禁止临时禁用整张样式表。
    let value = getComputedStyle(root).getPropertyValue("--xhUGwc").trim();
    if (!value && root.dataset.gqcActive !== "true")
      value = getComputedStyle(document.body).backgroundColor;
    if (/^#[0-9a-f]{3}$/i.test(value)) value = "#" + [...value.slice(1)].map((x) => x + x).join("");
    const n = /^#[0-9a-f]{6}$/i.test(value)
      ? [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16))
      : /^rgba?\(/i.test(value)
        ? value.match(/[\d.]+/g)?.map(Number)
        : null;
    if (!n || (n.length > 3 && n[3] === 0))
      return root.dataset.gqcTheme || (media.matches ? "dark" : "light");
    return n[0] * 0.2126 + n[1] * 0.7152 + n[2] * 0.0722 < 128 ? "dark" : "light";
  }

  // 根据主题色生成浅色和深色表面。
  function applyPalette() {
    const id = `${PREFIX}-palette`;
    let palette = document.getElementById(id);
    if (!palette) {
      palette = document.createElement("style");
      palette.id = id;
      (document.head || root).append(palette);
    }
    if (config.color.toLowerCase() === "#f9ebe9") {
      palette.textContent = "";
      return;
    }
    const rgb = [1, 3, 5].map((i) => parseInt(config.color.slice(i, i + 2), 16));
    const mix = (base, ratio) =>
      `rgb(${rgb.map((v, i) => Math.round(v * ratio + base[i] * (1 - ratio))).join(",")})`;
    const white = [255, 255, 255],
      black = [0, 0, 0];
    const light = {
      bg: mix(white, 0.08),
      surface: mix(white, 0.5),
      "primary-container": mix(white, 0.5),
      "header-surface": mix(white, 0.5),
      "on-primary": mix(black, 0.22),
      ink: mix(black, 0.18),
      muted: mix(black, 0.38),
      link: mix(black, 0.32),
      accent: mix(black, 0.4),
      border: mix(white, 0.65),
      line: mix(white, 0.65),
      "feature-tint": mix(white, 0.28),
      interaction: mix(white, 0.72),
      "scroll-thumb": mix(white, 0.8),
      "scroll-hover": mix(black, 0.55),
    };
    const dark = {
      bg: mix(black, 0.08),
      surface: mix(black, 0.16),
      "primary-container": mix(black, 0.25),
      "header-surface": mix(black, 0.2),
      "on-primary": mix(white, 0.18),
      ink: mix(white, 0.12),
      muted: mix(white, 0.32),
      link: mix(white, 0.34),
      accent: mix(white, 0.34),
      border: mix(black, 0.34),
      line: mix(black, 0.34),
      "feature-tint": mix(black, 0.18),
      interaction: mix(black, 0.32),
      "scroll-thumb": mix(black, 0.45),
      "scroll-hover": mix(white, 0.5),
    };
    const css = (v, theme) =>
      `html[data-gqc-active="true"][data-gqc-theme="${theme}"]{${Object.entries(v)
        .map(([k, x]) => `--gqc-${k}:${x}`)
        .join(";")}}`;
    palette.textContent = css(light, "light") + css(dark, "dark");
  }

  // 应用已保存的外观和功能设置。
  function applyConfig() {
    if (failed) return;
    root.dataset.qcAds = String(config.enabled && config.blockAds);
    root.dataset.gqcTheme = initialTheme;
    root.dataset.gqcMotion = String(config.motion);
    root.dataset.gqcWidth = config.width;
    root.dataset.gqcColumns = String(config.columns);
    applyPalette();
    autoLoader.sync();
    schedule();
  }

  // 只在支持的网页搜索类型中启用主题。
  function allowedView() {
    const p = new URLSearchParams(location.search);
    return (
      (!p.get("tbm") || p.get("tbm") === "web") &&
      (!p.get("udm") || ["14", "web"].includes(p.get("udm")))
    );
  }

  // 处理当前页面的contentVisible步骤，保持原生交互。
  function contentVisible(node) {
    if (!node || node.getAttribute("aria-hidden") === "true" || node.hidden) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // 检查原生隐藏层级，跳过脚本自己的空壳样式，以便动态恢复内容。
  function nativeContentVisible(element, boundary) {
    for (let current = element; current; current = current.parentElement) {
      if (current.hidden || current.getAttribute("aria-hidden") === "true") return false;
      const css = getComputedStyle(current);
      if (css.visibility === "hidden" || css.visibility === "collapse") return false;
      if (css.display === "none" && !current.classList.contains("gqc-empty")) return false;
      if (current === boundary) break;
    }
    return true;
  }

  // 只在原生明确表示生成中时展示非空的轻量状态，不为不存在的回答留空卡片。
  function isAiGenerating(node) {
    if (node.getAttribute("aria-busy") === "true") return true;
    return [
      ...node.querySelectorAll(
        '[aria-busy="true"],[role="progressbar"],[role="status"],[aria-live]',
      ),
    ].some((item) => {
      if (!nativeContentVisible(item, node)) return false;
      if (item.getAttribute("aria-busy") === "true") return true;
      const rect = item.getBoundingClientRect();
      if (item.getAttribute("role") === "progressbar")
        return rect.width > 0 && rect.height > 0 && getComputedStyle(item).opacity !== "0";
      return (
        item.textContent.trim().length < 80 &&
        /^(正在(?:生成|思考|搜索|查找)|再多想|loading|thinking|generating)/i.test(
          item.textContent.trim(),
        )
      );
    });
  }

  // 识别真正可展示的内容，忽略隐藏文本和脚本；空壳隐藏后仍能检测后续加载。
  function hasRenderableContent(node) {
    if (node.classList.contains("gqc-ai-pending")) return true;
    const ai =
      node.matches(".gqc-ai-overview") ||
      !!node.querySelector("#Odp5De,#eKIzJc,[data-mcp],[data-mcpr]");
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode;
      const parent = text.parentElement;
      if (!text.textContent.trim() || !parent || parent.closest("script,style,template,noscript"))
        continue;
      if (
        ai &&
        parent.closest(
          'h1,h2,h3,[role="heading"],button,[role="button"],[role="status"],[aria-live]',
        )
      )
        continue;
      if (nativeContentVisible(parent, node)) return true;
    }
    // 地图、图片和视频可能没有文字，仍应保留；AI只有控件或装饰时不算已有回答。
    if (!ai) {
      for (const media of node.querySelectorAll("img,video,canvas,iframe,svg,[role='img']")) {
        if (
          nativeContentVisible(media, node) &&
          media.getAttribute("width") !== "0" &&
          media.getAttribute("height") !== "0"
        )
          return true;
      }
    }
    return false;
  }

  // 处理当前页面的clearCurrent步骤，保持原生交互。
  function clearCurrent() {
    for (const node of ownedCurrent)
      if (node.getAttribute("aria-current") === "page") node.removeAttribute("aria-current");
    ownedCurrent.clear();
  }

  // 清理本脚本创建的文字包裹层，保留原有文本节点和事件。
  function restoreTitleLabel(heading) {
    const label = titleLabels.get(heading);
    if (label?.parentNode === heading) label.replaceWith(...label.childNodes);
    titleLabels.delete(heading);
  }

  // 保留原生标题的块级盒子与变换，仅在文字上绘制可动画的细下划线。
  function decorateTitle(heading) {
    const previous = titleLabels.get(heading);
    if (previous?.parentNode === heading && heading.childNodes.length === 1) return;
    if (previous) restoreTitleLabel(heading);
    const label = document.createElement("span");
    label.className = "gqc-title-text";
    while (heading.firstChild) label.append(heading.firstChild);
    heading.append(label);
    titleLabels.set(heading, label);
  }

  // 清除脚本标记并恢复链接状态。
  function clearMarks() {
    for (const button of document.querySelectorAll(".gqc-ai-toggle")) button.remove();
    restoreSidePanel();
    restoreImagePacks();
    restoreRelatedSearches();
    clearCurrent();
    restoreResultLinks();
    for (const heading of titleLabels.keys()) restoreTitleLabel(heading);
    for (const node of marked) {
      for (const name of [...node.classList])
        if (name.startsWith(`${PREFIX}-`)) node.classList.remove(name);
    }
    marked.clear();
    previousScope = null;
  }

  // 为首次出现的卡片设置轻柔过渡。
  function enter(node) {
    if (!config.motion || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const delay = Math.min(enterIndex++ * 30, 180);
    node.style.setProperty("--gqc-enter-delay", `${delay}ms`);
    mark(node, "gqc-enter");
    setTimeout(() => {
      node.classList.remove("gqc-enter");
      node.style.removeProperty("--gqc-enter-delay");
    }, 600);
    setTimeout(() => {
      enterIndex = 0;
    }, 80);
  }

  // 判断是否包含独立模块标题。
  function significantHeading(node) {
    return [...node.querySelectorAll('h2, [role=heading][aria-level="2"]')].some((h) => {
      const rect = h.getBoundingClientRect();
      const css = getComputedStyle(h);
      return (
        rect.width > 2 && rect.height > 2 && css.clip === "auto" && css.visibility !== "hidden"
      );
    });
  }

  // 从结果标题定位对应的原生网页结果容器。
  function organicRoot(heading, scope) {
    const link = heading.closest("a[href]");
    if (!link || !scope.contains(link) || heading.closest("#rhs") || heading.closest(SPECIAL))
      return null;
    let chosen = null;
    for (let node = link.parentElement; node && node !== scope; node = node.parentElement) {
      if (
        node.matches(SPECIAL) ||
        significantHeading(node) ||
        node.querySelector("g-scrolling-carousel, g-accordion-expander, [data-text-ad]")
      )
        break;
      if (node.querySelectorAll("a[href] h3").length !== 1) break;
      if (node.matches(KNOWN_RESULT)) chosen = node;
    }
    if (!chosen || !chosen.querySelector("cite, .VuuXrf, [data-header-feature]")) return null;
    return chosen;
  }

  // 统一搜索栏、图标和导航的居中布局。
  function centerHeader() {
    const header = document.querySelector("#searchform");
    if (header) {
      for (
        let node = header.parentElement;
        node && node !== document.body && !node.contains(document.querySelector("#rcnt"));
        node = node.parentElement
      )
        mark(node, "gqc-header-host");
    }
    const form = document.querySelector("#tsf");
    if (form && form.closest("#searchform")) mark(form.parentElement, "gqc-header-row");
    for (const line of document.querySelectorAll("#cnt > .Fgyi2e.wZQcA :is(.zLSRge,.BO2cCe)"))
      mark(line, "gqc-native-divider");
    const oldNav = document.querySelector("#hdtb");
    const row = document.querySelector("#cnt .rQTE8b");
    if (row && row.querySelector('[role="list"]')) {
      const shell = row.closest(".Fgyi2e") || row.closest(".YNk70c");
      if (shell) {
        mark(shell, "gqc-nav-shell");
        mark(row, "gqc-nav-row");
        const list = row.querySelector('[role="list"]');
        for (const item of list?.children || []) {
          const control = item.querySelector('a, [role="button"]');
          if (control) mark(control, "gqc-nav-item");
        }
        const tools = row.querySelector("#hdtb-tls");
        if (tools) mark(tools, "gqc-nav-item");
        for (let node = row.parentElement; node && node !== shell; node = node.parentElement)
          mark(node, "gqc-nav-wrapper");
      }
    } else if (oldNav) {
      mark(oldNav, "gqc-nav-shell");
      const items = oldNav.querySelector('#hdtb-msb, [role="tablist"], nav');
      if (items) {
        mark(items, "gqc-nav-row");
        for (const item of items.querySelectorAll('a, [role="tab"]')) {
          if (!item.closest('[role="menu"], [role="listbox"]')) mark(item, "gqc-nav-item");
        }
        for (let node = items.parentElement; node && node !== oldNav; node = node.parentElement)
          mark(node, "gqc-nav-wrapper");
      }
    }
  }

  // 处理当前页面的isExternalResult步骤，保持原生交互。
  function isExternalResult(link) {
    try {
      const u = new URL(link.href, location.href);
      if (!["http:", "https:"].includes(u.protocol)) return false;
      if (u.origin !== location.origin) {
        if (HOST.test(u.hostname)) return ["/goto", "/url"].includes(u.pathname);
        return true;
      }
      return ["/goto", "/url"].includes(u.pathname);
    } catch {
      return false;
    }
  }

  // 恢复普通结果链接的原生属性。
  function restoreResultLinks(keep = new Set()) {
    for (const [link, old] of ownedLinks) {
      if (keep.has(link)) continue;
      if (link.getAttribute("target") === "_blank")
        old.target === null
          ? link.removeAttribute("target")
          : link.setAttribute("target", old.target);
      if (link.getAttribute("rel") === old.writtenRel)
        old.rel === null ? link.removeAttribute("rel") : link.setAttribute("rel", old.rel);
      ownedLinks.delete(link);
    }
  }

  // 处理当前页面的styleResultLinks步骤，保持原生交互。
  function styleResultLinks() {
    const keep = new Set();
    for (const link of document.querySelectorAll(
      "#rso a[href], #Odp5De a[href], #eKIzJc a[href], #rhs a[href], .gqc-auto-results a[href]",
    )) {
      if (!isExternalResult(link)) continue;
      keep.add(link);
      if (!ownedLinks.has(link))
        ownedLinks.set(link, {
          target: link.getAttribute("target"),
          rel: link.getAttribute("rel"),
        });
      const old = ownedLinks.get(link);
      const rel = [
        ...new Set(
          (link.getAttribute("rel") || "").split(/\s+/).filter(Boolean).concat("noopener"),
        ),
      ].join(" ");
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", rel);
      old.writtenRel = rel;
    }
    restoreResultLinks(keep);
  }

  // 处理当前页面的styleRelatedSearches步骤，保持原生交互。
  function styleRelatedSearches() {
    for (const link of document.querySelectorAll(
      "#bres a.ngTNl[href], #bres a.k8XOCe[href], #botstuff .card-section a.k8XOCe[href]",
    )) {
      mark(link, "gqc-related-link");
      const surface = link.closest(".b2Rnsc");
      mark(
        surface && surface.querySelectorAll("a[href]").length === 1
          ? surface
          : link.querySelector(".B2VR9") || link,
        "gqc-related-surface",
      );
    }
  }

  // 处理当前页面的stylePagination步骤，保持原生交互。
  function stylePagination() {
    clearCurrent();
    for (const table of document.querySelectorAll(
      "#botstuff table.gUbm5e, #navcnt table, #foot table#nav",
    )) {
      if (!table.querySelector("#pnnext, #pnprev, td.dlnXYb")) continue;
      const nav = table.closest('[role="navigation"], #navcnt') || table.parentElement;
      mark(nav, "gqc-pager");
      mark(table, "gqc-pager-table");
      for (const row of table.querySelectorAll("tr")) {
        mark(row, "gqc-pager-row");
        for (const cell of row.children) {
          const links = [...cell.querySelectorAll("a[href]")];
          for (const link of links) mark(link, "gqc-page-link");
          if (
            !links.length &&
            /^\d+$/.test(cell.textContent.trim()) &&
            (cell.matches('.dlnXYb, [aria-current="page"]') || cell.querySelector(".D2pCqd"))
          ) {
            mark(cell, "gqc-page-current");
            if (!cell.hasAttribute("aria-current")) {
              cell.setAttribute("aria-current", "page");
              ownedCurrent.add(cell);
            }
          } else if (
            !cell.textContent.trim() &&
            !cell.querySelector('a,button,[role="button"],input') &&
            cell.querySelector(".D2pCqd")
          ) {
            mark(cell, "gqc-pager-decoration");
          }
        }
      }
    }
    for (const node of document.querySelectorAll("#botstuff .mye4qd")) {
      if (contentVisible(node) && node.matches('a,button,[role="button"]'))
        mark(node, "gqc-more-results");
    }
  }

  // 管理自动加载、去重、取消和异常暂停。
  function createAutoLoader(canRun, options = {}) {
    const getLocation = options.getLocation || (() => location.href);
    const fetchPage = options.fetchImpl || ((...args) => fetch(...args));
    const OWN_ID = "gqc-auto-results";
    const BLOCKS = [
      '[role="dialog"]',
      '[role="menu"]',
      '[role="listbox"]',
      "g-scrolling-carousel",
      "g-inner-card",
      "g-accordion-expander",
      "[data-attrid]",
      "[data-async-type]",
      "[data-text-ad]",
      ".uEierd",
      "#Odp5De",
      "#eKIzJc",
      "[data-mcp]",
      "[data-mcpr]",
      "[data-md]",
      "[hidden]",
      '[aria-hidden="true"]',
    ].join(",");
    const KNOWN = ".MjjYud,.g,.tF2Cxc,[data-sokoban-container],article";
    let state = null;
    let generation = 0;
    const prefetch = createDirectionalPrefetch(
      () => {
        const s = state;
        return !!s && isCurrent(s) && !!s.next && !s.loading && !s.paused;
      },
      () => void loadNext(),
      () => state?.controls,
      { distance: 900 },
    );
    const setText = (node, value) => {
      if (node.textContent !== value) node.textContent = value;
    };
    const cleanText = (value, max) =>
      String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max);
    const googleHost = (hostname) =>
      /^(?:www\.)?google\.(?:com|[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/i.test(hostname);
    const pageOffset = (url) =>
      /^\d+$/.test(url.searchParams.get("start") || "0")
        ? Number(url.searchParams.get("start") || 0)
        : NaN;

    // 提取不能跨页改变的搜索条件。
    function viewKey(url) {
      return JSON.stringify(
        ["q", "tbm", "udm", "tbs"].map((key) => url.searchParams.get(key) || ""),
      );
    }

    // 生成同一搜索页的去重键。
    function pageKey(url) {
      return `${url.origin}${url.pathname}|${viewKey(url)}|${pageOffset(url)}`;
    }

    // 处理当前页面的currentKey步骤，保持原生交互。
    function currentKey() {
      return getLocation();
    }

    // 处理当前页面的supported步骤，保持原生交互。
    function supported(url) {
      const p = url.searchParams;
      return (
        googleHost(url.hostname) &&
        url.pathname === "/search" &&
        !!p.get("q") &&
        (!p.get("tbm") || p.get("tbm") === "web") &&
        (!p.get("udm") || ["14", "web"].includes(p.get("udm")))
      );
    }

    // 校验同源、同查询且页码递增的原生下一页。
    function nextPage(doc, base, initial, seen) {
      const link = doc.querySelector("#pnnext[href]");
      if (!link) return { url: null, reason: "没有找到下一页，已停止自动拼接。" };
      try {
        const url = new URL(link.getAttribute("href"), base);
        if (
          url.origin !== initial.origin ||
          url.pathname !== "/search" ||
          url.username ||
          url.password ||
          viewKey(url) !== viewKey(initial) ||
          !Number.isFinite(pageOffset(url)) ||
          pageOffset(url) <= pageOffset(base)
        ) {
          return {
            url: null,
            reason: "下一页地址或搜索条件已变化，请使用原生分页。",
          };
        }
        url.hash = "";
        if (seen.has(pageKey(url))) return { url: null, reason: "下一页重复，已停止自动拼接。" };
        return { url, reason: "" };
      } catch {
        return { url: null, reason: "无法识别下一页地址，请使用原生分页。" };
      }
    }

    // 校验结果链接及用于去重的目标地址。
    function resultURL(href, base) {
      try {
        const url = new URL(href, base);
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
          return null;
        if (googleHost(url.hostname) && !["/url", "/goto"].includes(url.pathname)) return null;
        let keyURL = new URL(url);
        if (googleHost(url.hostname)) {
          for (const name of ["url", "q", "u"]) {
            const target = url.searchParams.get(name);
            if (target && /^https?:\/\//i.test(target)) {
              keyURL = new URL(target);
              break;
            }
          }
        }
        keyURL.hash = "";
        return { href: url.href, key: keyURL.href, host: keyURL.hostname };
      } catch {
        return null;
      }
    }

    // 从分页响应提取普通网页结果，排除交互模块。
    function organicEntries(doc, base) {
      const scope = doc.querySelector("#rso");
      if (!scope) return [];
      const found = [];
      for (const heading of scope.querySelectorAll("a[href] h3")) {
        if (heading.closest(BLOCKS)) continue;
        const link = heading.closest("a[href]");
        const url = resultURL(link.getAttribute("href"), base);
        if (!url) continue;
        let card = null;
        let mixed = false;
        for (let node = link.parentElement; node && node !== scope; node = node.parentElement) {
          if (
            node.matches(BLOCKS) ||
            node.querySelector(
              'g-scrolling-carousel,g-accordion-expander,[data-text-ad],h2,[role="heading"][aria-level="2"]',
            )
          ) {
            mixed = true;
            break;
          }
          if (node.querySelectorAll("a[href] h3").length !== 1) break;
          if (node.matches(KNOWN)) card = node;
        }
        if (mixed || !card || !card.querySelector("cite,.VuuXrf,[data-header-feature]")) continue;
        const title = cleanText(heading.textContent, 500);
        if (!title) continue;
        const snippet = card.querySelector(
          ".VwiC3b,.yXK7lf,.IsZvec,[data-sncf],.aCOpRe,.st,.BNeawe.s3v9rd,p",
        );
        const cite = card.querySelector("cite");
        found.push({
          ...url,
          title,
          cite: cleanText(cite?.textContent || url.host, 250),
          snippet: cleanText(snippet?.textContent, 1600),
        });
      }
      return found;
    }

    // 处理当前页面的isCurrent步骤，保持原生交互。
    function isCurrent(s) {
      return (
        state === s &&
        s.generation === generation &&
        canRun() &&
        s.locationKey === currentKey() &&
        s.scope === document.querySelector("#rso") &&
        s.section.isConnected
      );
    }

    // 更新加载进度、暂停原因及可用操作。
    function status(s, message, retry = false) {
      s.lastMessage = message;
      s.lastRetry = retry;
      const needsHelp = s.paused || retry;
      const summary = s.loading
        ? "正在加载更多结果…"
        : needsHelp
          ? retry
            ? "加载未完成，请重试"
            : "自动加载已暂停"
          : !s.next && s.loaded
            ? "已显示全部结果"
            : "";
      setText(s.status, summary);
      s.status.hidden = !summary;
      s.controls.dataset.state = s.loading ? "loading" : needsHelp ? "paused" : "idle";
      s.controls.hidden = !s.next && !summary;
      setText(s.button, s.loading ? "加载中…" : retry ? "重试加载" : "加载下一页");
      s.button.hidden = !s.next || (s.paused && !retry);
      s.button.disabled = s.loading;
      // 原生页码保留完整翻页入口，正常状态不再重复添加第二个按钮。
      s.manual.hidden = !s.next || !needsHelp;
      if (s.next) s.manual.setAttribute("href", s.next.href);
      setText(s.manual, "打开下一页");
      s.status.title = needsHelp ? message : "";
    }

    // 处理当前页面的blockReason步骤，保持原生交互。
    function blockReason(doc) {
      if (
        doc.querySelector(
          'form[action*="/sorry"],#captcha-form,#recaptcha,.g-recaptcha,iframe[src*="recaptcha"]',
        ) ||
        /unusual traffic|异常流量|不寻常的流量/i.test(doc.querySelector("title")?.textContent || "")
      )
        return "Google 要求验证，自动拼接已停止。请打开完整分页处理。";
      if (
        doc.querySelector('form[action*="consent.google"],form[action*="/consent"]') ||
        /before you continue to google|使用 Google 前|在继续使用 Google 之前/i.test(
          doc.querySelector("title")?.textContent || "",
        )
      )
        return "Google 显示同意页面，自动拼接已停止。请打开完整分页处理。";
      return "";
    }

    // 构建自动拼接结果，标题和首屏使用一致样式。
    function createCard(entry) {
      const card = document.createElement("article");
      card.className = "gqc-card gqc-auto-card";
      const cite = document.createElement("cite");
      cite.className = "gqc-auto-cite";
      cite.textContent = entry.cite;
      const link = document.createElement("a");
      link.href = entry.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const heading = document.createElement("h3");
      heading.className = "gqc-title";
      heading.textContent = entry.title;
      link.append(heading);
      card.append(cite, link);
      if (entry.snippet) {
        const snippet = document.createElement("p");
        snippet.className = "gqc-auto-snippet";
        snippet.textContent = entry.snippet;
        card.append(snippet);
      }
      return card;
    }

    // 处理当前页面的loadNext步骤，保持原生交互。
    async function loadNext(manual = false) {
      const s = state;
      if (!s || !isCurrent(s) || !s.next || s.loading || (s.paused && !manual)) return;
      const requested = s.next;
      if (s.seenPages.has(pageKey(requested))) {
        s.paused = true;
        status(s, "下一页重复，已停止自动拼接。");
        return;
      }
      s.loading = true;
      s.paused = false;
      s.controller = new AbortController();
      const controller = s.controller;
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 2e4);
      status(s, "正在加载下一页…");
      try {
        const response = await fetchPage(requested.href, {
          credentials: "same-origin",
          signal: controller.signal,
          redirect: "manual",
          referrerPolicy: "same-origin",
          headers: { Accept: "text/html" },
        });
        if (!isCurrent(s)) return;
        if (response.type === "opaqueredirect" || response.status === 0) {
          s.paused = true;
          status(s, "Google 返回跳转，自动拼接已停止。请打开完整分页处理。");
          return;
        }
        if (!response.ok) {
          s.paused = true;
          status(
            s,
            `下一页请求失败（HTTP ${response.status}），自动拼接已暂停。`,
            response.status >= 500 && response.status <= 599,
          );
          return;
        }
        if (response.url) {
          const finalURL = new URL(response.url);
          if (
            finalURL.origin !== requested.origin ||
            finalURL.pathname !== "/search" ||
            viewKey(finalURL) !== viewKey(requested) ||
            pageOffset(finalURL) !== pageOffset(requested)
          ) {
            s.paused = true;
            status(s, "返回页面与请求不一致，自动拼接已停止。请使用完整分页。");
            return;
          }
        }
        const type = response.headers.get("content-type") || "";
        if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) {
          s.paused = true;
          status(s, "下一页不是可识别的搜索页面，请使用完整分页。");
          return;
        }
        const html = await response.text();
        if (!isCurrent(s)) return;
        const template = document.createElement("template");
        template.innerHTML = html;
        const doc = template.content;
        for (const node of doc.querySelectorAll("script,style,template,noscript")) node.remove();
        const blocker = blockReason(doc);
        if (blocker) {
          s.paused = true;
          status(s, blocker);
          return;
        }
        const query = doc.querySelector(
          '#searchform [name="q"],#tsf [name="q"],form[action="/search"] [name="q"]',
        );
        if (query && String(query.value) !== s.initial.searchParams.get("q")) {
          s.paused = true;
          status(s, "返回页面的搜索词已变化，自动拼接已停止。");
          return;
        }
        const entries = organicEntries(doc, requested);
        if (!entries.length) {
          s.paused = true;
          status(
            s,
            doc.querySelector("#rso,#topstuff")
              ? "下一页没有可安全拼接的普通结果，已停止。请查看完整分页。"
              : "未识别到搜索结果，自动拼接已停止。请查看完整分页。",
          );
          return;
        }
        const fragment = document.createDocumentFragment();
        let count = 0;
        for (const entry of entries) {
          if (s.seenResults.has(entry.key)) continue;
          s.seenResults.add(entry.key);
          const card = createCard(entry);
          s.ownedCards.add(card);
          fragment.append(card);
          count++;
        }
        s.seenPages.add(pageKey(requested));
        if (!count) {
          s.paused = true;
          status(s, "下一页结果均已出现，已停止重复加载。");
          return;
        }
        s.cards.append(fragment);
        for (const card of s.ownedCards)
          if (!card.dataset.gqcRevealed) {
            card.dataset.gqcRevealed = "true";
            enter(card);
          }
        schedule();
        s.loaded++;
        s.total += count;
        const next = nextPage(doc, requested, s.initial, s.seenPages);
        s.next = next.url;
        status(
          s,
          `已拼接 ${s.loaded} 页、${s.total} 条普通结果。${s.next ? "继续向下滚动可加载下一页。" : next.reason}`,
        );
      } catch (error) {
        if (!isCurrent(s)) return;
        if (error.name === "AbortError" && !timedOut) return;
        s.paused = true;
        status(
          s,
          timedOut
            ? "下一页加载超时，自动拼接已暂停。"
            : "下一页加载失败，自动拼接已暂停。可重试或打开完整分页。",
          true,
        );
      } finally {
        clearTimeout(timeout);
        if (state === s) {
          s.loading = false;
          if (s.controller === controller) s.controller = null;
          status(s, s.lastMessage || "", s.lastRetry || false);
        }
      }
    }

    // 停止当前功能并清理脚本创建的临时界面。
    function stop() {
      prefetch.stop();
      generation++;
      if (state) {
        state.controller?.abort();
        state.observer?.disconnect();
        state.section.remove();
        for (const card of state.ownedCards) card.remove();
        state = null;
      }
    }

    // 同步页面状态及已存在的结果节点。
    function sync() {
      const initial = new URL(getLocation());
      const scope = document.querySelector("#rso");
      const column = document.querySelector("#center_col");
      if (!canRun() || !supported(initial) || !scope || !column || !column.contains(scope)) {
        if (state) stop();
        return;
      }
      if (
        state &&
        state.locationKey === currentKey() &&
        state.scope === scope &&
        state.section.isConnected
      ) {
        if (!state.next && !state.loaded && !state.paused) {
          const next = nextPage(document, initial, initial, state.seenPages);
          if (next.url) {
            state.next = next.url;
            status(state, "向下滚动接近结果末端时，会提前请求下一页。");
          }
        }
        return;
      }
      stop();
      const section = document.createElement("section");
      section.id = OWN_ID;
      section.setAttribute("aria-label", "自动拼接的普通搜索结果");
      const style = document.createElement("style");
      style.textContent = `
#${OWN_ID} {
  width: 100%;
  margin: 24px 0 0;
  box-sizing: border-box;
}
#${OWN_ID} .gqc-auto-controls {
  display: flex;
  gap: 12px;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  padding: 8px 0;
  color: var(--gqc-muted);
  font:
    14px/1.6 Arial,
    sans-serif;
}
#${OWN_ID} .gqc-auto-status {
  margin: 0;
  font-size: 13px;
}
#${OWN_ID} button,
#${OWN_ID} .gqc-auto-manual {
  box-sizing: border-box;
  min-height: 44px;
  min-width: 148px;
  padding: 10px 24px;
  border: 0;
  border-radius: 20px;
  background: var(--gqc-surface, #f9ebe9);
  color: var(--gqc-link, #765047);
  font: inherit;
  cursor: pointer;
  text-decoration: none;
}
#${OWN_ID} button:disabled {
  opacity: 0.6;
  cursor: wait;
}
#${OWN_ID} [hidden] {
  display: none !important;
}
.gqc-auto-card .gqc-auto-cite {
  display: block;
  font-style: normal;
  color: var(--gqc-muted);
  font-size: 13px;
  overflow-wrap: anywhere;
}
.gqc-auto-card .gqc-auto-snippet {
  color: var(--gqc-muted);
  font:
    14px/1.65 Arial,
    sans-serif;
  margin: 10px 0 0;
  overflow-wrap: anywhere;
}
.gqc-auto-card .gqc-title {
  margin: 8px 0 0;
}
#${OWN_ID} :is(button, a):focus-visible {
  outline: 2px solid var(--gqc-accent);
  outline-offset: 4px;
}
`;
      const cards = scope;
      const controls = document.createElement("div");
      controls.className = "gqc-auto-controls";
      const statusNode = document.createElement("p");
      statusNode.className = "gqc-auto-status";
      statusNode.setAttribute("role", "status");
      statusNode.setAttribute("aria-live", "polite");
      const button = document.createElement("button");
      button.type = "button";
      button.addEventListener("click", () => void loadNext(true));
      const manual = document.createElement("a");
      manual.className = "gqc-auto-manual";
      controls.append(statusNode, button, manual);
      section.append(style, controls);
      scope.after(section);
      const seenPages = new Set([pageKey(initial)]);
      const next = nextPage(document, initial, initial, seenPages);
      state = {
        generation,
        initial,
        locationKey: currentKey(),
        scope,
        section,
        cards,
        ownedCards: new Set(),
        controls,
        status: statusNode,
        button,
        manual,
        next: next.url,
        seenPages,
        seenResults: new Set(organicEntries(document, initial).map((entry) => entry.key)),
        loading: false,
        paused: false,
        loaded: 0,
        total: 0,
        controller: null,
        observer: null,
      };
      status(state, next.url ? "向下滚动接近结果末端时，会提前请求下一页。" : next.reason);
      prefetch.start();
    }
    addEventListener("popstate", sync);
    addEventListener("pagehide", stop);
    return {
      sync,
      stop,
      reset() {
        stop();
        sync();
      },
    };
  }

  // 管理双列布局和原生样式恢复，不移动结果节点。
  function createMasonryLayout(canRun, options = {}) {
    const gap = Number.isFinite(options.gap) ? Math.max(0, options.gap) : 20;
    const minWidth = Number.isFinite(options.minWidth) ? options.minWidth : 1100;
    const hosts = new Map();
    let frame = 0;
    let pendingAnchor = null;
    let readingAnchor = null;
    let expansionAnchor = null;
    let disposed = false;
    const enabled = () => !disposed && canRun();
    const round = (n) => Math.round(n * 100) / 100;
    const number = (value) => Number.parseFloat(value) || 0;
    const equalSize = (a, b) =>
      a && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;

    // 设置本脚本负责的样式并保留原始值。
    function own(record, property, value) {
      const style = record.node.style;
      const current = style.getPropertyValue(property);
      const priority = style.getPropertyPriority(property);
      let saved = record.styles.get(property);
      if (!saved) {
        saved = {
          original: current,
          priority,
          written: null,
          writtenPriority: null,
        };
        record.styles.set(property, saved);
      } else if (
        saved.written !== null &&
        (current !== saved.written || priority !== saved.writtenPriority)
      ) {
        saved.original = current;
        saved.priority = priority;
      }
      if (current !== value || priority !== "important")
        style.setProperty(property, value, "important");
      saved.written = value;
      saved.writtenPriority = "important";
    }

    // 恢复脚本改写的样式，保留站点后续更新。
    function restore(record) {
      for (const [property, saved] of record.styles) {
        if (
          record.node.style.getPropertyValue(property) !== saved.written ||
          record.node.style.getPropertyPriority(property) !== saved.writtenPriority
        )
          continue;
        if (saved.original) record.node.style.setProperty(property, saved.original, saved.priority);
        else record.node.style.removeProperty(property);
      }
      record.styles.clear();
    }

    // 记录节点样式，便于关闭主题时恢复原状。
    function record(node) {
      return { node, styles: new Map() };
    }
    // 展开纯分组容器，以实际卡片为单位参与双列，保留原生节点和事件。
    function candidates(host) {
      const units = [];
      // 仅穿透含已识别结果的容器，复杂模块整体保留。
      function visit(node) {
        if (
          !(node instanceof HTMLElement) ||
          ["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"].includes(node.tagName)
        )
          return;
        if (!node.matches(".gqc-card,.gqc-module") && node.querySelector(".gqc-card,.gqc-module")) {
          unmark(node, "gqc-empty");
          if (node.hidden || getComputedStyle(node).display === "none") return;
          for (const child of node.children) visit(child);
          return;
        }
        if (!hasRenderableContent(node)) {
          mark(node, "gqc-empty");
          return;
        }
        unmark(node, "gqc-empty");
        if (node.hidden || getComputedStyle(node).display === "none") return;
        units.push(node);
      }
      for (const child of host.children) visit(child);
      // 仅调整布局单元的视觉顺序，AI概览优先，不搬运原生节点。
      const ordered = units.sort(
        (a, b) =>
          Number(b.classList.contains("gqc-ai-overview")) -
          Number(a.classList.contains("gqc-ai-overview")),
      );
      // 地图放在四张普通结果之后，再按较短列排布，避免抢占首屏。
      const maps = ordered.filter((node) => node.classList.contains("gqc-local"));
      const content = ordered.filter((node) => !node.classList.contains("gqc-local"));
      let cardCount = 0;
      let insertion = content.length;
      for (let index = 0; index < content.length; index++) {
        if (content[index].classList.contains("gqc-card") && ++cardCount === 4) {
          insertion = index + 1;
          break;
        }
      }
      content.splice(insertion, 0, ...maps);
      return content;
    }
    // 排除原生悬浮控件，普通卡片的菜单按钮不影响卡片列宽。
    function liveItems(host) {
      return candidates(host).filter((node) => {
        const css = getComputedStyle(node);
        if (css.display === "contents") return false;
        if (
          ["fixed", "absolute"].includes(css.position) &&
          !node.classList.contains("gqc-masonry-item")
        )
          return false;
        return node.matches(".gqc-card,.gqc-module") || node.offsetHeight > 0;
      });
    }
    // 只有复杂模块跨整行，卡片中的原生菜单不再误触发跨列。
    function fullWidth(node) {
      if (node.matches(".gqc-questions,.gqc-related,.gqc-local,.gqc-images,.gqc-rich"))
        return false;
      return !node.classList.contains("gqc-card") || node.classList.contains("gqc-module");
    }

    // 记录当前可见内容位置，减小布局变化引起的跳动。
    function captureAnchor() {
      if (expansionAnchor?.node.isConnected) return expansionAnchor;
      const focus = document.activeElement;
      if (focus && focus !== document.body && focus !== document.documentElement) {
        for (const host of hosts.keys()) {
          if (!host.contains(focus)) continue;
          const item = focus.closest(".gqc-masonry-item");
          if (!item) continue;
          const rect = item.getBoundingClientRect();
          if (rect.bottom > 0 && rect.top < innerHeight)
            return { node: item, top: rect.top, scroll: scrollY };
        }
      }
      const visible = [];
      // 滚动时只读取已经排版的节点，不重复遍历正文和重新分类整页。
      for (const state of hosts.values()) {
        for (const node of state.items.keys()) {
          if (
            !node.isConnected ||
            !node.classList.contains("gqc-masonry-item") ||
            node.classList.contains("gqc-pass-through") ||
            node.hidden
          )
            continue;
          const rect = node.getBoundingClientRect();
          if (rect.width > 0 && rect.bottom > 0 && rect.top < innerHeight)
            visible.push({ node, top: rect.top, bottom: rect.bottom, scroll: scrollY });
        }
      }
      visible.sort(
        (a, b) =>
          (a.top >= 0 ? a.top : innerHeight + Math.abs(a.top)) -
          (b.top >= 0 ? b.top : innerHeight + Math.abs(b.top)),
      );
      return visible[0] || null;
    }

    // 在主题扫描改写AI、侧栏及结果区域之前记录页面级阅读位置。
    function prepare() {
      if (!pendingAnchor && enabled())
        pendingAnchor = readingAnchor?.node.isConnected ? readingAnchor : captureAnchor();
    }

    // 根据内容锚点校正滚动位置并通知加载器。
    function settle(anchor) {
      if (anchor?.node.isConnected && anchor.scroll > 0) {
        const rect = anchor.node.getBoundingClientRect();
        // 扣除用户滚动及页面高度收缩造成的滚动变化，只补偿布局本身的位移。
        const expectedTop = anchor.top - (scrollY - anchor.scroll);
        const delta = rect.top - expectedTop;
        if (rect.width > 0 && Math.abs(delta) > 1)
          scrollBy({ left: 0, top: delta, behavior: "instant" });
      }
      readingAnchor = captureAnchor();
      document.dispatchEvent(new Event("gqc:masonry-settled"));
    }

    // 合并连续页面更新，避免频繁重复布局。
    function schedule() {
      if (!frame && enabled()) frame = requestAnimationFrame(layout);
    }

    // 监听结果区大小和内容变化。
    function observeHost(host) {
      const state = {
        host: record(host),
        items: new Map(),
        columns: new WeakMap(),
        columnCount: 0,
        wrappers: new Map(),
        sizes: new WeakMap(),
        observer: null,
        mutation: null,
      };
      if ("ResizeObserver" in window) {
        state.observer = new ResizeObserver((entries) => {
          let changed = false;
          for (const entry of entries) {
            const box = Array.isArray(entry.borderBoxSize)
              ? entry.borderBoxSize[0]
              : entry.borderBoxSize;
            const size = box
              ? { width: box.inlineSize, height: box.blockSize }
              : {
                  width: entry.contentRect.width,
                  height: entry.contentRect.height,
                };
            const old = state.sizes.get(entry.target);
            if (
              entry.target === host
                ? !old || Math.abs(old.width - size.width) >= 0.5
                : !equalSize(old, size)
            )
              changed = true;
            state.sizes.set(entry.target, size);
          }
          if (changed) schedule();
        });
        state.observer.observe(host);
      }
      state.mutation = new MutationObserver(schedule);
      state.mutation.observe(host, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      hosts.set(host, state);
      return state;
    }

    // 停止监听并恢复该结果区的原生样式。
    function drop(host, state) {
      state.observer?.disconnect();
      state.mutation?.disconnect();
      for (const item of state.items.values()) {
        restore(item);
        item.node.classList.remove("gqc-masonry-item");
      }
      for (const wrapper of state.wrappers.values()) restore(wrapper);
      state.wrappers.clear();
      restore(state.host);
      host.classList.remove("gqc-masonry-host");
      hosts.delete(host);
    }

    // 计算列宽、卡片高度及位置，批量应用布局。
    function layout() {
      frame = 0;
      if (!enabled()) {
        stop();
        return;
      }
      const anchor =
        pendingAnchor || (readingAnchor?.node.isConnected ? readingAnchor : captureAnchor());
      pendingAnchor = null;
      const plans = [];
      for (const [host, state] of hosts) {
        if (!host.isConnected || !host.classList.contains("gqc-results")) {
          drop(host, state);
          continue;
        }
        const hostCSS = getComputedStyle(host);
        if (hostCSS.display === "none" || host.clientWidth <= 0) continue;
        const padLeft = number(hostCSS.paddingLeft),
          padRight = number(hostCSS.paddingRight);
        const padTop = number(hostCSS.paddingTop),
          padBottom = number(hostCSS.paddingBottom);
        const borders = number(hostCSS.borderTopWidth) + number(hostCSS.borderBottomWidth);
        const width = host.clientWidth - padLeft - padRight;
        const columnCount = config.columns === 2 && innerWidth >= minWidth ? 2 : 1;
        const columnWidth = (width - gap * (columnCount - 1)) / columnCount;
        if (state.columnCount !== columnCount) {
          state.columns = new WeakMap();
          state.columnCount = columnCount;
        }
        if (!Number.isFinite(columnWidth) || columnWidth < 160) {
          drop(host, state);
          continue;
        }
        const nodes = liveItems(host);
        const wantedWrappers = new Set();
        for (const node of nodes) {
          for (
            let parent = node.parentElement;
            parent && parent !== host;
            parent = parent.parentElement
          )
            wantedWrappers.add(parent);
        }
        for (const [node, wrapper] of state.wrappers) {
          if (!wantedWrappers.has(node)) {
            restore(wrapper);
            state.wrappers.delete(node);
          }
        }
        for (const node of wantedWrappers) {
          let wrapper = state.wrappers.get(node);
          if (!wrapper) {
            wrapper = record(node);
            state.wrappers.set(node, wrapper);
          }
          own(wrapper, "display", "contents");
          own(wrapper, "position", "static");
          own(wrapper, "transform", "none");
          own(wrapper, "contain", "none");
        }
        const wanted = new Set(nodes);
        for (const [node, item] of state.items) {
          if (wanted.has(node)) continue;
          state.observer?.unobserve(node);
          restore(item);
          node.classList.remove("gqc-masonry-item");
          state.items.delete(node);
        }
        own(state.host, "position", "relative");
        own(state.host, "display", "block");
        own(state.host, "box-sizing", "border-box");
        own(state.host, "overflow-anchor", "none");
        host.classList.add("gqc-masonry-host");
        const items = [];
        for (const node of nodes) {
          let item = state.items.get(node);
          if (!item) {
            item = record(node);
            state.items.set(node, item);
            state.observer?.observe(node);
          }
          const span = fullWidth(node);
          own(item, "position", "absolute");
          own(item, "box-sizing", "border-box");
          own(item, "width", `${round(span ? width : columnWidth)}px`);
          own(item, "min-width", "0px");
          own(item, "max-width", "none");
          own(item, "margin", "0px");
          own(item, "right", "auto");
          own(item, "bottom", "auto");
          node.classList.add("gqc-masonry-item");
          items.push({ item, span });
        }
        plans.push({
          state,
          items,
          padLeft,
          padTop,
          padBottom,
          borders,
          columnWidth,
          columnCount,
          rtl: hostCSS.direction === "rtl",
        });
      }
      for (const plan of plans) {
        for (const placement of plan.items)
          placement.height = Math.max(0, placement.item.node.offsetHeight);
      }
      for (const plan of plans) {
        const heights = Array(plan.columnCount).fill(plan.padTop);
        let bottom = plan.padTop;
        for (const { item, span, height } of plan.items) {
          let column = plan.state.columns.get(item.node);
          if (column === undefined || column >= plan.columnCount) {
            column = heights.length === 1 || heights[0] <= heights[1] ? 0 : 1;
            if (!span) plan.state.columns.set(item.node, column);
          }
          const top = span ? Math.max(...heights) : heights[column];
          const visualColumn = plan.rtl && plan.columnCount === 2 ? 1 - column : column;
          const left = plan.padLeft + (span ? 0 : visualColumn * (plan.columnWidth + gap));
          own(item, "left", `${round(left)}px`);
          own(item, "top", `${round(top)}px`);
          bottom = Math.max(bottom, top + height);
          if (span) heights.fill(top + height + gap);
          else heights[column] = top + height + gap;
        }
        own(plan.state.host, "height", `${Math.ceil(bottom + plan.padBottom + plan.borders)}px`);
      }
      settle(anchor);
    }

    // 同步页面状态及已存在的结果节点。
    function sync() {
      if (!enabled()) {
        stop();
        return;
      }
      const desired = new Set(
        [...document.querySelectorAll(".gqc-results")].filter(
          (host) => host instanceof HTMLElement && !host.closest(".gqc-card,.gqc-module"),
        ),
      );
      for (const [host, state] of hosts)
        if (!desired.has(host) || !host.isConnected) drop(host, state);
      for (const host of desired) if (!hosts.has(host)) observeHost(host);
      schedule();
    }

    // 停止当前功能并清理脚本创建的临时界面。
    function stop() {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      pendingAnchor = null;
      readingAnchor = null;
      expansionAnchor = null;
      if (!hosts.size) return;
      const anchor = captureAnchor();
      for (const [host, state] of [...hosts]) drop(host, state);
      settle(anchor);
    }
    // 展开操作固定卡片起点，不能把向下移动的按钮或后续结果当作阅读锚点。
    function onExpansionClick(event) {
      if (!enabled() || !(event.target instanceof Element)) return;
      const control = event.target.closest("button,[role=button],[aria-expanded]");
      const item = control?.closest(".gqc-masonry-item,.gqc-top,.gqc-ai-overview");
      if (
        !item ||
        (!item.matches(".gqc-top,.gqc-ai-overview") &&
          ![...hosts.keys()].some((host) => host.contains(item)))
      )
        return;
      const label = `${control.getAttribute("aria-label") || ""} ${control.textContent || ""}`;
      if (
        !control.hasAttribute("aria-expanded") &&
        !/展开|收起|更多|全部显示|show more|show less|expand|collapse/i.test(label)
      )
        return;
      const rect = item.getBoundingClientRect();
      expansionAnchor = { node: item, top: rect.top, scroll: scrollY };
      pendingAnchor = expansionAnchor;
      readingAnchor = expansionAnchor;
    }

    // 用户开始主动滚动后结束展开锚定，恢复普通阅读位置跟随。
    function releaseExpansionAnchor() {
      expansionAnchor = null;
      readingAnchor = null;
    }

    // 用户滚动后更新阅读对象；重排已排队时保留变动前的锚点。
    function onReaderScroll() {
      if (expansionAnchor && Math.abs(scrollY - expansionAnchor.scroll) > 1) expansionAnchor = null;
      if (!frame && !pendingAnchor && enabled()) readingAnchor = captureAnchor();
    }
    const onResize = () => sync();
    const onLoad = (event) => {
      if ([...hosts.keys()].some((host) => host.contains(event.target))) schedule();
    };
    document.addEventListener("click", onExpansionClick, true);
    addEventListener("wheel", releaseExpansionAnchor, { passive: true });
    addEventListener("touchmove", releaseExpansionAnchor, { passive: true });
    addEventListener("scroll", onReaderScroll, { passive: true });
    addEventListener("resize", onResize, { passive: true });
    document.addEventListener("load", onLoad, true);
    document.fonts?.ready.then(() => {
      if (!disposed) schedule();
    });
    return {
      sync,
      stop,
      prepare,
      destroy() {
        stop();
        disposed = true;
        document.removeEventListener("click", onExpansionClick, true);
        removeEventListener("wheel", releaseExpansionAnchor);
        removeEventListener("touchmove", releaseExpansionAnchor);
        removeEventListener("scroll", onReaderScroll);
        removeEventListener("resize", onResize);
        document.removeEventListener("load", onLoad, true);
      },
    };
  }

  // 仅在用户向下滚动且接近结果末尾时加载。
  function createDirectionalPrefetch(canLoad, load, getSentinel, options = {}) {
    const distance = Number.isFinite(options.distance) ? Math.max(0, options.distance) : 900;
    let listening = false;
    let previousY = scrollY;
    let frame = 0;
    let downward = false;

    // 刷新滚动基线，避免布局校正误触发加载。
    function resetBaseline() {
      previousY = scrollY;
      downward = false;
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    }

    // 判断当前可见位置是否满足加载条件。
    function check() {
      frame = 0;
      if (!downward || document.hidden || !canLoad()) return;
      const sentinel = getSentinel();
      if (!sentinel?.isConnected) return;
      const rect = sentinel.getBoundingClientRect();
      const remaining =
        (document.scrollingElement || document.documentElement).scrollHeight -
        innerHeight -
        scrollY;
      const nearResultsEnd = rect.top - innerHeight <= distance && rect.bottom >= 0;
      if (rect.width > 0 && (nearResultsEnd || remaining <= distance)) {
        downward = false;
        load();
      }
    }

    // 重排只更新坐标基线，保留尚未完成的向下阅读意图。
    function onSettled() {
      previousY = scrollY;
      if (!frame && downward) frame = requestAnimationFrame(check);
    }

    // 到达页面边界时滚轮不再产生滚动事件，仍需记录继续向下的操作。
    function onWheel(event) {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      downward = event.deltaY > 0;
      onSettled();
    }

    // 键盘翻页与滚轮保持相同语义，不接管输入框中的按键。
    function onKeyDown(event) {
      if (event.target.closest?.("input,textarea,select,[contenteditable=true]")) return;
      if (["ArrowDown", "PageDown", "End", " "].includes(event.key)) downward = !event.shiftKey;
      else if (["ArrowUp", "PageUp", "Home"].includes(event.key)) downward = false;
      else return;
      onSettled();
    }

    // 根据滚动方向安排下一页检查。
    function onScroll() {
      const nextY = scrollY;
      if (nextY > previousY + 0.5) downward = true;
      else if (nextY < previousY - 0.5) downward = false;
      previousY = nextY;
      if (!frame && downward) frame = requestAnimationFrame(check);
    }

    // 初始化页面功能、监听器和设置入口。
    function start() {
      if (listening) return;
      listening = true;
      resetBaseline();
      addEventListener("scroll", onScroll, { passive: true });
      addEventListener("wheel", onWheel, { passive: true });
      addEventListener("keydown", onKeyDown);
      document.addEventListener("gqc:masonry-settled", onSettled);
    }

    // 停止当前功能并清理脚本创建的临时界面。
    function stop() {
      if (!listening) return;
      listening = false;
      removeEventListener("scroll", onScroll);
      removeEventListener("wheel", onWheel);
      removeEventListener("keydown", onKeyDown);
      document.removeEventListener("gqc:masonry-settled", onSettled);
      resetBaseline();
    }
    return { start, stop, resetBaseline };
  }
  // 只有用户主动展开主AI时才解除预览高度，保留原生控件的实际展开动作。
  document.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest('[role="button"][aria-controls="m-x-content"]');
      const module = button?.closest(".gqc-top,.gqc-ai-overview");
      if (!module || button.closest(".gqc-questions")) return;
      if (button.getAttribute("aria-expanded") !== "true") mark(module, "gqc-user-expanded");
      else unmark(module, "gqc-user-expanded");
    },
    true,
  );

  const masonry = createMasonryLayout(() => active && config.enabled);
  const autoLoader = createAutoLoader(() => active && config.enabled && config.autoLoad);
  let sidePlacement = null;

  // 关闭脚本时恢复知识面板原始位置。
  function restoreSidePanel() {
    if (sidePlacement?.placeholder.parentNode)
      sidePlacement.placeholder.replaceWith(sidePlacement.node);
    sidePlacement = null;
  }

  // 知识面板也作为单列信息卡片参与瀑布流，避免整页结束后出现宽大面板。
  function syncSidePanel(scope) {
    const node = document.querySelector("#rhs");
    if (!node || scope.contains(node) || !node.textContent.trim()) return;
    const placeholder = document.createComment("搜索样式优化：知识面板原始位置");
    node.before(placeholder);
    sidePlacement = { node, placeholder };
    scope.append(node);
  }

  const imagePlacements = new Map();
  const imageListeners = new WeakSet();

  // 恢复原生图片模块的位置，保留预览、展开和返回时的事件关系。
  function restoreImagePacks() {
    for (const [node, placeholder] of imagePlacements) {
      if (placeholder.parentNode) placeholder.replaceWith(node);
    }
    imagePlacements.clear();
  }

  // 接入位于结果区外的图片模块，不克隆图片或预览按钮。
  function syncImagePacks(scope) {
    for (const node of document.querySelectorAll(".Lv2Cle[data-iu]")) {
      if (scope.contains(node) || node.closest('[role="dialog"]')) continue;
      const heading = node.querySelector('h2,[role="heading"]');
      if (!heading || !/^(图片|图像|Images)$/i.test(heading.textContent.trim())) continue;
      const placeholder = document.createComment("搜索样式优化：图片模块原始位置");
      node.before(placeholder);
      imagePlacements.set(node, placeholder);
      scope.append(node);
    }
  }

  let relatedPlacement = null;

  // 恢复推荐搜索的原始位置，关闭脚本后不留下布局变化。
  function restoreRelatedSearches() {
    if (!relatedPlacement) return;
    const { node, placeholder } = relatedPlacement;
    if (placeholder.parentNode) placeholder.replaceWith(node);
    relatedPlacement = null;
  }

  // 将原生推荐搜索整体接入结果流，保留节点、事件和返回时的位置。
  function syncRelatedSearches(scope) {
    const node = document.querySelector("#bres");
    if (!node || scope.contains(node)) return;
    if (relatedPlacement) restoreRelatedSearches();
    const placeholder = document.createComment("搜索样式优化：推荐搜索原始位置");
    node.before(placeholder);
    relatedPlacement = { node, placeholder };
    scope.append(node);
  }

  // 在生成与完成阶段共用同一预览框，原生按钮尚未可见时仍可主动展开。
  function syncAiPreview(module) {
    if (!module.querySelector("#m-x-content")) return;
    mark(module, "gqc-ai-managed");
    let button = module.querySelector(":scope > .gqc-ai-toggle");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "gqc-ai-toggle";
      button.addEventListener("click", () => {
        const open = !module.classList.contains("gqc-user-expanded");
        if (open) mark(module, "gqc-user-expanded");
        else unmark(module, "gqc-user-expanded");
        const native = module.querySelector('[role="button"][aria-controls="m-x-content"]');
        if (native && (native.getAttribute("aria-expanded") === "true") !== open) native.click();
        button.textContent = open ? "收起 AI 概览" : "展开 AI 概览";
        button.setAttribute("aria-expanded", String(open));
        schedule();
      });
      module.append(button);
    }
    const open = module.classList.contains("gqc-user-expanded");
    const label = open ? "收起 AI 概览" : "展开 AI 概览";
    if (button.textContent !== label) button.textContent = label;
    if (button.getAttribute("aria-expanded") !== String(open))
      button.setAttribute("aria-expanded", String(open));
  }

  // 按语义标题识别AI概览、相关问题和地点，保留所有原生交互。
  function markRichModules(scope) {
    const kinds = [
      "gqc-questions",
      "gqc-local",
      "gqc-ai-overview",
      "gqc-related",
      "gqc-images",
      "gqc-rich",
    ];
    const desired = new Map();
    const related = scope.querySelector("#bres");
    if (related) desired.set(related, "gqc-related");
    const side = scope.querySelector("#rhs");
    if (side) desired.set(side, "gqc-rich");
    // 生成阶段可能尚未绘制标题，先根据原生AI容器识别位置。
    for (const marker of scope.querySelectorAll(
      '#Odp5De,#eKIzJc,[data-mcp],[data-mcpr],[data-async-type*="ai"]',
    )) {
      if (marker.closest(".related-question-pair,[data-initq]")) continue;
      const node = marker.closest(".MjjYud") || marker;
      if (!node.querySelector(".gqc-card") && nativeContentVisible(node, scope))
        desired.set(node, "gqc-ai-overview");
    }
    for (const heading of scope.querySelectorAll('h2,[role="heading"]')) {
      if (heading.closest("#bres") || !nativeContentVisible(heading, scope)) continue;
      const text = heading.textContent.trim();
      const kind = /^(AI\s*概览|AI\s*摘要|AI Overview|AI Overviews)$/i.test(text)
        ? "gqc-ai-overview"
        : /^(相关问题|其他人还问了|大家还在问|People also ask|More to ask)$/i.test(text)
          ? "gqc-questions"
          : /^(相关搜索|其他人还搜了|People also search for|Related searches)$/i.test(text)
            ? "gqc-related"
            : /^(焦点新闻|新闻|歌曲|专辑|电影|视频|短视频|Top stories|Videos|Songs|Albums)$/i.test(
                  text,
                )
              ? "gqc-rich"
              : /^(图片|图像|Images)$/i.test(text)
                ? "gqc-images"
                : /^(地点|地点信息|商家|Places|Locations|Local results)$/i.test(text)
                  ? "gqc-local"
                  : null;
      if (
        !kind ||
        (kind === "gqc-ai-overview" && heading.closest(".related-question-pair,[data-initq]"))
      )
        continue;
      const node =
        (kind === "gqc-images" ? heading.closest("[data-iu]") : null) ||
        heading.closest(".MjjYud") ||
        heading.closest("section,article,[data-local-pack]") ||
        heading.parentElement;
      if (
        !node ||
        node === scope ||
        !scope.contains(node) ||
        node.closest(".gqc-card") ||
        node.querySelector(".gqc-card")
      )
        continue;
      desired.set(node, kind);
      if (kind === "gqc-images") {
        [...node.querySelectorAll(".vCUuC")].forEach((item, index) => {
          if (index >= 6) mark(item, "gqc-image-overflow");
        });
      }
      if (kind === "gqc-images" && !imageListeners.has(node)) {
        // 只记录原生“更多图片”操作，继续由站点处理实际展开。
        node.addEventListener("click", (event) => {
          if (event.target.closest('.jEgXc [role="button"]')) mark(node, "gqc-gallery-expanded");
        });
        imageListeners.add(node);
      }
    }
    // 差量应用分类，避免滚动或原生展开时先回到灰色原生样式再恢复主题。
    const previous = scope.querySelectorAll(kinds.map((kind) => "." + kind).join(","));
    for (const node of new Set([...previous, ...desired.keys()])) {
      const kind = desired.get(node);
      for (const name of kinds) {
        if (name === kind) mark(node, name);
        else if (node.classList.contains(name)) unmark(node, name);
      }
      if (kind) mark(node, "gqc-module");
      if (kind === "gqc-ai-overview") {
        mark(node, "gqc-feature");
        if (isAiGenerating(node)) mark(node, "gqc-ai-pending");
        else unmark(node, "gqc-ai-pending");
        syncAiPreview(node);
      } else unmark(node, "gqc-ai-pending");
    }
  }

  // 同步普通结果与复杂模块，不替换站点原生节点。
  function scan() {
    if (timer) cancelAnimationFrame(timer);
    timer = 0;
    if (failed) return;
    masonry.prepare();
    const scope = document.querySelector("#rso");
    const column = document.querySelector("#center_col");
    active = !!(config.enabled && allowedView() && scope && column);
    root.dataset.gqcActive = String(active);
    if (!active) {
      clearMarks();
      autoLoader.sync();
      masonry.sync();
      return;
    }
    if (previousScope && previousScope !== scope) clearMarks();
    previousScope = scope;
    syncRelatedSearches(scope);
    syncImagePacks(scope);
    syncSidePanel(scope);
    for (const node of marked) if (!node.isConnected) marked.delete(node);
    const layout = document.querySelector("#rcnt");
    const side = document.querySelector("#rhs");
    centerHeader();
    stylePagination();
    styleRelatedSearches();
    styleResultLinks();
    const sideAvailable =
      side &&
      !side.hidden &&
      side.getAttribute("aria-hidden") !== "true" &&
      side.textContent.trim();
    if (layout && layout.contains(column)) {
      mark(layout, "gqc-layout");
      mark(column, "gqc-primary");
      let stack = layout;
      if (sideAvailable && layout.contains(side)) {
        let ancestor = column.parentElement;
        while (ancestor !== layout && !ancestor.contains(side)) ancestor = ancestor.parentElement;
        stack = ancestor;
        if (stack !== layout) mark(stack, "gqc-stack");
      }
      for (const item of [column, sideAvailable ? side : null, stack !== layout ? stack : null]) {
        if (!item || !layout.contains(item)) continue;
        for (let node = item; node && node !== layout; node = node.parentElement) {
          if (node !== column && node !== side && node !== stack) mark(node, "gqc-stack-item");
        }
      }
      if (sideAvailable) mark(side, "gqc-sidebar");
      for (const node of layout.children) {
        if (
          node !== column &&
          !node.contains(column) &&
          node !== side &&
          !node.contains(side) &&
          (["Odp5De", "eKIzJc"].includes(node.id) || node.querySelector?.("#Odp5De,#eKIzJc"))
        ) {
          mark(node, "gqc-top");
          mark(node, "gqc-module");
          mark(node, "gqc-feature");
          if (isAiGenerating(node)) mark(node, "gqc-ai-pending");
          else unmark(node, "gqc-ai-pending");
          syncAiPreview(node);
        }
      }
    } else {
      mark(column, "gqc-fallback-center");
      if (sideAvailable) {
        mark(side, "gqc-sidebar");
        mark(side, "gqc-fallback-center");
      }
    }
    mark(scope, "gqc-results");
    const cards = new Map();
    for (const title of scope.querySelectorAll("a[href] h3")) {
      const candidate = organicRoot(title, scope);
      if (candidate) cards.set(candidate, title);
    }
    for (const node of scope.querySelectorAll(".gqc-card")) {
      if (!cards.has(node)) {
        unmark(node, "gqc-card");
        unmark(node, "gqc-enter");
      }
    }
    const titles = new Set(cards.values());
    for (const title of scope.querySelectorAll(".gqc-title")) {
      if (!titles.has(title)) {
        restoreTitleLabel(title);
        unmark(title, "gqc-title");
      }
    }
    for (const [node, title] of cards) {
      if (node.closest(".gqc-card") && node.closest(".gqc-card") !== node) continue;
      const isNew = !node.classList.contains("gqc-card");
      mark(node, "gqc-card");
      mark(title, "gqc-title");
      decorateTitle(title);
      if (isNew) enter(node);
    }
    for (const heading of titleLabels.keys()) {
      if (!heading.isConnected) titleLabels.delete(heading);
    }
    markRichModules(scope);
    if (side && scope.contains(side)) mark(side, "gqc-rich");
    for (const node of scope.children) {
      unmark(node, "gqc-pass-through");
      if (
        node.matches("div.MjjYud") &&
        !node.hidden &&
        !contentVisible(node) &&
        getComputedStyle(node).display !== "none"
      )
        mark(node, "gqc-pass-through");
      const eligible =
        node instanceof HTMLElement &&
        !["SCRIPT", "STYLE", "TEMPLATE"].includes(node.tagName) &&
        (contentVisible(node) || node.classList.contains("gqc-ai-pending")) &&
        !node.matches("[role=dialog], [role=menu], [role=listbox]") &&
        node.textContent.trim().length > 8 &&
        !node.matches(".gqc-card") &&
        !node.querySelector(".gqc-card,.gqc-module");
      if (eligible) {
        mark(node, "gqc-module");
        const feature = !!(
          node.querySelector(
            '#Odp5De, #eKIzJc, [data-mcp], [data-mcpr], [data-async-type*="ai"], [data-attrid*="overview"]',
          ) || node.matches("#Odp5De, #eKIzJc, [data-mcp], [data-mcpr]")
        );
        if (feature || node.classList.contains("gqc-ai-overview")) mark(node, "gqc-feature");
        else unmark(node, "gqc-feature");
      } else {
        unmark(node, "gqc-module");
        unmark(node, "gqc-feature");
      }
    }
    autoLoader.sync();
    masonry.sync();
  }

  // 合并连续页面更新，避免频繁重复布局。
  function schedule() {
    if (failed || timer) return;
    timer = requestAnimationFrame(scan);
  }
  const APPEARANCE_DEFAULTS = Object.freeze({
    enabled: true,
    motion: true,
    width: "comfortable",
    color: "#f9ebe9",
    columns: 1,
    autoLoad: true,
    blockAds: true,
  });
  let settingsDialog = null;

  // 校验并统一主题颜色格式。
  function normalizeAppearanceColor(value) {
    if (typeof value !== "string") return null;
    const hex = value.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(hex)) return hex;
    if (/^#[0-9a-f]{3}$/.test(hex)) return `#${[...hex.slice(1)].map((c) => c + c).join("")}`;
    return null;
  }
  // 保存弹窗内的完整设置，包含以前位于管理器菜单中的开关。
  async function persistAppearance(values) {
    const next = {
      color: normalizeAppearanceColor(values.color),
      columns: Number(values.columns) === 2 ? 2 : 1,
      autoLoad: values.autoLoad === true,
      blockAds: values.blockAds !== false,
      enabled: values.enabled !== false,
      motion: values.motion !== false,
      width: values.width === "compact" ? "compact" : "comfortable",
    };
    if (!next.color) throw new TypeError("主题颜色无效");
    const persistent = typeof GM_setValue === "function";
    if (persistent)
      for (const [name, value] of Object.entries(next))
        await GM_setValue(`${PREFIX}.${name}`, value);
    Object.assign(config, next);
    applyConfig();
    schedule();
    registerMenus();
    return persistent;
  }

  // 通过唯一菜单打开设置，在弹窗内完成开关和外观调整。
  function openSettings() {
    if (settingsDialog?.isConnected) {
      settingsDialog.shadowRoot.querySelector('input[type="text"]')?.focus();
      return;
    }
    const previousFocus = document.activeElement;
    const host = document.createElement("div");
    host.id = `${PREFIX}-settings-host`;
    host.style.setProperty("display", "contents", "important");
    const shadow = host.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = `
.settings-option + .settings-option {
  margin-top: 18px;
}
.settings-option select {
  padding: 8px 12px;
  border: 1px solid var(--s-muted);
  border-radius: 12px;
  background: transparent;
  color: inherit;
}
.segment > span {
  pointer-events: none;
}

:host {
  all: initial;
  color-scheme: light;
  --s-bg: var(--gqc-bg, #fffbfa);
  --s-container: var(--gqc-surface, #f9ebe9);
  --s-tonal: var(--gqc-primary-container, #f9ebe9);
  --s-on-tonal: var(--gqc-on-primary, #4f3530);
  --s-ink: var(--gqc-ink, #352c29);
  --s-muted: var(--gqc-muted, #746660);
  --s-primary: var(--gqc-link, #765047);
  --s-error: #b3261e;
  --s-dialog: color-mix(in srgb, var(--s-bg) 68%, var(--s-container));
  --s-field: color-mix(in srgb, var(--s-container) 65%, var(--s-bg));
  --s-state: color-mix(in srgb, var(--s-primary) 9%, transparent);
}
:host([data-dark="true"]) {
  color-scheme: dark;
  --s-bg: var(--gqc-bg, #181311);
  --s-container: var(--gqc-surface, #2a2220);
  --s-tonal: var(--gqc-primary-container, #493632);
  --s-on-tonal: var(--gqc-on-primary, #f9ebe9);
  --s-ink: var(--gqc-ink, #ede0dc);
  --s-muted: var(--gqc-muted, #cbbab4);
  --s-primary: var(--gqc-link, #e6bfb7);
  --s-error: #ffb4ab;
  --s-dialog: color-mix(in srgb, var(--s-bg) 25%, var(--s-container));
  --s-field: color-mix(in srgb, var(--s-container) 70%, var(--s-tonal));
}
* {
  box-sizing: border-box;
}
dialog {
  position: fixed;
  inset: 0;
  margin: auto;
  padding: 0;
  border: 0;
  border-radius: 28px;
  width: min(512px, calc(100vw - 32px));
  max-width: none;
  max-height: calc(100vh - 32px);
  max-height: calc(100dvh - 32px);
  overflow: auto;
  background: var(--s-dialog);
  color: var(--s-ink);
  box-shadow: 0 12px 40px #21171129;
  font:
    14px/1.5 system-ui,
    -apple-system,
    "Segoe UI",
    sans-serif;
  text-align: start;
  scrollbar-width: thin;
  scrollbar-color: var(--s-muted) transparent;
}
dialog::backdrop {
  background: #0e08065c;
}
form {
  margin: 0;
  padding: 28px 28px 20px;
}
h2 {
  margin: 0;
  font-size: 26px;
  line-height: 1.35;
  font-weight: 500;
  letter-spacing: -0.3px;
}
p {
  margin: 0;
}
.intro {
  margin-top: 8px;
  color: var(--s-muted);
  font-size: 13px;
}
.field {
  margin: 28px 0 0;
  padding: 0;
  min-width: 0;
  border: 0;
}
.section-title,
legend {
  display: block;
  margin: 0 0 12px;
  padding: 0;
  font-size: 14px;
  line-height: 1.5;
  font-weight: 600;
}
.section-title {
  font: inherit;
  font-weight: 600;
}
.color-row {
  display: flex;
  align-items: stretch;
  gap: 14px;
}
input,
select,
button {
  font: inherit;
}
.filled-field {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 60px;
  padding: 8px 16px 7px;
  border-radius: 12px 12px 4px 4px;
  background: var(--s-field);
  box-shadow: inset 0 -1px 0 var(--s-muted);
}
.filled-field:focus-within {
  box-shadow: inset 0 -2px 0 var(--s-primary);
}
.filled-field label {
  margin: 0 0 1px;
  color: var(--s-primary);
  font-size: 11px;
  line-height: 1.5;
  font-weight: 600;
  letter-spacing: 0.4px;
}
input[type="text"] {
  width: 100%;
  min-width: 0;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--s-ink);
  font:
    16px/1.5 ui-monospace,
    "SFMono-Regular",
    Consolas,
    monospace;
}
input[type="text"]:focus-visible {
  outline: none;
}
.filled-field:has(input:focus-visible) {
  outline: 2px solid var(--s-primary);
  outline-offset: 3px;
}
input[type="color"] {
  flex: 0 0 60px;
  width: 60px;
  height: 60px;
  padding: 0;
  border: 0;
  border-radius: 18px;
  overflow: hidden;
  background: var(--s-tonal);
  cursor: pointer;
}
input[type="color"]::-webkit-color-swatch-wrapper {
  padding: 0;
}
input[type="color"]::-webkit-color-swatch {
  border: 0;
  border-radius: 18px;
}
input[type="color"]::-moz-color-swatch {
  border: 0;
  border-radius: 18px;
}
.hint {
  margin-top: 10px;
  color: var(--s-muted);
  font-size: 12px;
  line-height: 1.55;
}
.segments {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding: 4px;
  gap: 4px;
  border-radius: 28px;
  background: var(--s-field);
}
.segment {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  min-height: 48px;
  border-radius: 24px;
  color: var(--s-muted);
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition:
    color 0.16s,
    background-color 0.16s;
}
.segment input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  margin: 0;
  cursor: pointer;
}
.segment:has(input:checked) {
  background: var(--s-tonal);
  color: var(--s-on-tonal);
  font-weight: 650;
}
.segment:hover {
  background: var(--s-state);
}
.segment:has(input:checked):hover {
  background: color-mix(in srgb, var(--s-tonal) 90%, var(--s-primary));
}
.segment:has(input:focus-visible) {
  outline: 2px solid var(--s-primary);
  outline-offset: 2px;
}
.segment-check {
  width: 14px;
  opacity: 0;
  font-size: 15px;
  font-weight: 700;
}
.segment:has(input:checked) .segment-check {
  opacity: 1;
}
.layout-icon {
  display: grid;
  gap: 3px;
  width: 18px;
  height: 15px;
}
.layout-icon::before,
.layout-icon::after {
  content: "";
  border-radius: 2px;
  background: currentColor;
  opacity: 0.8;
}
.layout-icon.double {
  grid-template-columns: 1fr 1fr;
}
.switch-card {
  padding: 18px 18px 16px;
  border-radius: 20px;
  background: var(--s-field);
}
.switch-row {
  display: flex;
  align-items: center;
  gap: 20px;
  min-height: 32px;
  cursor: pointer;
}
.switch-label {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
}
.switch-control {
  position: relative;
  display: block;
  flex: 0 0 52px;
  width: 52px;
  height: 32px;
}
.switch-control input {
  position: absolute;
  z-index: 1;
  top: -6px;
  left: -4px;
  width: 60px;
  height: 44px;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.switch-track {
  display: block;
  width: 52px;
  height: 32px;
  border: 2px solid var(--s-muted);
  border-radius: 18px;
  background: transparent;
  transition:
    background-color 0.18s,
    border-color 0.18s;
}
.switch-track::before {
  content: "";
  position: absolute;
  top: 8px;
  left: 8px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--s-muted);
  transition:
    transform 0.18s,
    width 0.18s,
    height 0.18s,
    top 0.18s,
    left 0.18s;
}
.switch-control input:checked + .switch-track {
  background: var(--s-primary);
  border-color: var(--s-primary);
}
.switch-control input:checked + .switch-track::before {
  width: 24px;
  height: 24px;
  top: 4px;
  left: 24px;
  background: var(--s-bg);
}
.switch-control input:focus-visible + .switch-track {
  outline: 3px solid var(--s-primary);
  outline-offset: 4px;
}
.switch-control:has(input:disabled) {
  opacity: 0.38;
}
.switch-card .hint {
  margin-top: 10px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 24px;
}
.spacer {
  flex: 1;
}
button {
  min-height: 44px;
  padding: 10px 16px;
  border: 0;
  border-radius: 24px;
  background: transparent;
  color: var(--s-primary);
  cursor: pointer;
  font-size: 14px;
  line-height: 24px;
  font-weight: 600;
  transition: background-color 0.16s;
}
button:hover {
  background: var(--s-state);
}
button[type="submit"] {
  min-width: 80px;
  padding-inline: 24px;
  background: var(--s-primary);
  color: var(--s-bg);
}
button[type="submit"]:hover {
  background: color-mix(in srgb, var(--s-primary) 90%, var(--s-bg));
}
:is(input[type="color"], button):focus-visible {
  outline: 3px solid var(--s-primary);
  outline-offset: 3px;
}
.filled-field:has([aria-invalid="true"]) {
  box-shadow: inset 0 -2px 0 var(--s-error);
}
button:disabled,
input[type="text"]:disabled,
input[type="color"]:disabled,
.segment:has(input:disabled) {
  cursor: wait;
  opacity: 0.38;
}
.status {
  margin-top: 18px;
  color: var(--s-muted);
  font-size: 12px;
}
.status:empty {
  display: none;
}
.error {
  color: var(--s-error);
}
@media (max-width: 380px) {
  form {
    padding: 24px 20px 16px;
  }
  .actions {
    gap: 2px;
  }
  button {
    padding-inline: 12px;
  }
  button[type="submit"] {
    min-width: 68px;
    padding-inline: 20px;
  }
  .switch-row {
    gap: 12px;
  }
  .switch-card {
    padding-inline: 16px;
  }
}
@media (prefers-reduced-motion: reduce) {
  *,
  *::before {
    transition: none !important;
  }
}
@media (forced-colors: active) {
  dialog,
  .filled-field,
  .segments,
  button {
    border: 1px solid CanvasText !important;
  }
  .segment:has(input:checked) {
    outline: 2px solid Highlight;
    outline-offset: -2px;
  }
  .switch-control input:checked + .switch-track {
    background: Highlight;
    border-color: Highlight;
  }
  .switch-control input:checked + .switch-track::before {
    background: HighlightText;
  }
  .switch-control input:not(:checked) + .switch-track::before {
    background: CanvasText;
  }
  .switch-track,
  .switch-track::before {
    forced-color-adjust: none;
  }
  :focus-visible {
    outline-color: Highlight !important;
  }
}
@media print {
  :host {
    display: none !important;
  }
}
`;
    const make = (tag, props = {}, text) => {
      const node = document.createElement(tag);
      for (const [name, value] of Object.entries(props)) node.setAttribute(name, value);
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const dialog = make("dialog", {
      "aria-labelledby": "settings-heading",
      "aria-describedby": "settings-intro",
      lang: "zh-CN",
    });
    const form = make("form", { novalidate: "" });
    const heading = make("h2", { id: "settings-heading" }, "界面设置");
    const intro = make("p", { id: "settings-intro", class: "intro" }, "修改后自动保存并立即生效。");
    const colorField = make("div", { class: "field" });
    const colorLabel = make("h3", { class: "section-title" }, "主题颜色");
    const colorRow = make("div", { class: "color-row" });
    const picker = make("input", {
      type: "color",
      "aria-label": "选择主题颜色",
    });
    const hex = make("input", {
      type: "text",
      id: "theme-color-hex",
      maxlength: "7",
      placeholder: "#f9ebe9",
      spellcheck: "false",
      autocomplete: "off",
      autocapitalize: "off",
      "aria-describedby": "color-help settings-status",
    });
    const colorHint = make(
      "p",
      { id: "color-help", class: "hint" },
      "使用取色器，或输入 #RRGGBB / #RGB 格式的颜色。",
    );
    const hexField = make("div", { class: "filled-field" });
    hexField.append(make("label", { for: "theme-color-hex" }, "HEX 颜色值"), hex);
    colorRow.append(picker, hexField);
    colorField.append(colorLabel, colorRow, colorHint);
    const layoutField = make("fieldset", {
      class: "field",
      "aria-describedby": "columns-help",
    });
    const columnsLabel = make("legend", {}, "搜索结果布局");
    const columns = make("select", {
      id: "result-columns",
      hidden: "",
      tabindex: "-1",
      "aria-hidden": "true",
    });
    columns.append(make("option", { value: "1" }, "单列"), make("option", { value: "2" }, "双列"));
    const segments = make("div", { class: "segments" });
    const columnRadios = [1, 2].map((value) => {
      const label = make("label", { class: "segment" });
      const radio = make("input", {
        type: "radio",
        name: "result-columns-choice",
        value: String(value),
        id: `columns-${value}`,
        "aria-describedby": "columns-help",
      });
      const check = make("span", { class: "segment-check", "aria-hidden": "true" }, "✓");
      const icon = make("span", {
        class: `layout-icon${value === 2 ? " double" : ""}`,
        "aria-hidden": "true",
      });
      label.append(radio, check, icon, make("span", {}, value === 1 ? "单列" : "双列"));
      radio.addEventListener("change", () => {
        if (radio.checked) columns.value = radio.value;
      });
      segments.append(label);
      return radio;
    });
    const syncColumnRadios = () =>
      columnRadios.forEach((radio) => {
        radio.checked = radio.value === columns.value;
      });
    columns.addEventListener("change", syncColumnRadios);
    const columnsHint = make(
      "p",
      { id: "columns-help", class: "hint" },
      "窄屏自动使用单列；AI 概览和混合模块保留整行。",
    );
    layoutField.append(columnsLabel, columns, segments, columnsHint);
    const loadField = make("div", { class: "field switch-card" });
    const loadLabel = make("label", { class: "switch-row", for: "auto-load" });
    const autoLoad = make("input", {
      type: "checkbox",
      role: "switch",
      id: "auto-load",
      "aria-describedby": "load-help",
    });
    const switchControl = make("span", { class: "switch-control" });
    switchControl.append(autoLoad, make("span", { class: "switch-track", "aria-hidden": "true" }));
    loadLabel.append(make("span", { class: "switch-label" }, "自动加载下一页"), switchControl);
    const loadHint = make(
      "p",
      { id: "load-help", class: "hint" },
      "默认开启。滚动到底部会请求 Google 下一页并追加普通网页结果。复杂模块可在原页查看。",
    );
    loadField.append(loadLabel, loadHint);
    // 为简单开关生成具有完整点击区域的原生标签。
    function settingSwitch(id, title) {
      const row = make("label", { class: "switch-row settings-option", for: id });
      const control = make("span", { class: "switch-control" });
      const input = make("input", { id, type: "checkbox", role: "switch" });
      control.append(input, make("span", { class: "switch-track", "aria-hidden": "true" }));
      row.append(make("span", { class: "switch-label" }, title), control);
      return { row, input };
    }
    const enabledOption = settingSwitch("theme-enabled", "启用样式优化");
    const motionOption = settingSwitch("theme-motion", "轻柔动效");
    const adsOption = settingSwitch("block-ads", "隐藏搜索广告");
    const widthField = make("label", { class: "switch-row settings-option", for: "theme-width" });
    const widthChoice = make("select", { id: "theme-width" });
    widthChoice.append(
      make("option", { value: "comfortable" }, "舒适"),
      make("option", { value: "compact" }, "紧凑"),
    );
    widthField.append(make("span", { class: "switch-label" }, "单列宽度"), widthChoice);
    const behavior = make("section", { class: "field switch-card" });
    behavior.append(enabledOption.row, adsOption.row, motionOption.row, widthField);
    const status = make("p", {
      id: "settings-status",
      class: "status",
      role: "status",
      "aria-live": "polite",
      "aria-atomic": "true",
    });
    const actions = make("div", { class: "actions" });
    const reset = make("button", { type: "button" }, "恢复默认");
    const spacer = make("span", { class: "spacer", "aria-hidden": "true" });
    const cancel = make("button", { type: "button" }, "关闭");
    actions.append(reset, spacer, cancel);
    form.append(heading, intro, colorField, layoutField, loadField, behavior, status, actions);
    dialog.append(form);
    shadow.append(sheet, dialog);
    host.dataset.dark = String(root.dataset.gqcTheme === "dark");
    (document.body || root).append(host);
    settingsDialog = host;
    const setDraft = (values) => {
      picker.value = normalizeAppearanceColor(values.color) || APPEARANCE_DEFAULTS.color;
      hex.value = picker.value;
      columns.value = Number(values.columns) === 2 ? "2" : "1";
      syncColumnRadios();
      autoLoad.checked = values.autoLoad === true;
      enabledOption.input.checked = values.enabled !== false;
      adsOption.input.checked = values.blockAds !== false;
      motionOption.input.checked = values.motion !== false;
      widthChoice.value = values.width === "compact" ? "compact" : "comfortable";
      hex.removeAttribute("aria-invalid");
    };
    const say = (message, error = false) => {
      status.textContent = message;
      status.classList.toggle("error", error);
    };
    setDraft(config);
    picker.addEventListener("input", () => {
      hex.value = picker.value;
      hex.removeAttribute("aria-invalid");
      say("");
    });
    hex.addEventListener("input", () => {
      const normalized = normalizeAppearanceColor(hex.value);
      if (normalized) picker.value = normalized;
      hex.removeAttribute("aria-invalid");
      say("");
    });
    reset.addEventListener("click", () => {
      setDraft(APPEARANCE_DEFAULTS);
      liveSettings.schedule(0);
    });
    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      liveSettings.dispose();
      host.remove();
      if (settingsDialog === host) settingsDialog = null;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
    const closePanel = () => {
      if (dialog.open) dialog.close();
      cleanup();
    };
    // 从当前控件读取有效草稿；颜色未完整时保留之前的设置。
    function readDraft() {
      const color = normalizeAppearanceColor(hex.value);
      if (!color) {
        hex.setAttribute("aria-invalid", "true");
        say("请补全有效颜色，其他已保存设置保持不变。", true);
        return null;
      }
      hex.removeAttribute("aria-invalid");
      return {
        color,
        columns: Number(columns.value),
        autoLoad: autoLoad.checked,
        blockAds: adsOption.input.checked,
        enabled: enabledOption.input.checked,
        motion: motionOption.input.checked,
        width: widthChoice.value,
      };
    }
    const liveSettings = createLiveSettings(form, readDraft, persistAppearance, say);
    // 关闭前刷新最后一次有效改动，不再要求点击保存。
    function requestClose() {
      void liveSettings.flush().then(closePanel);
    }
    cancel.addEventListener("click", requestClose);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      requestClose();
    });
    dialog.addEventListener("close", cleanup, { once: true });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void liveSettings.flush();
    });
    mountSettingsFrame(dialog, shadow, requestClose);
    dialog.showModal();
    hex.focus({ preventScroll: true });
    hex.select();
  }

  // 保存单项设置并更新页面。
  function save(name, value) {
    config[name] = value;
    try {
      if (typeof GM_setValue === "function") GM_setValue(`${PREFIX}.${name}`, value);
    } catch {}
    applyConfig();
    registerMenus();
  }
  // 管理器列表始终只保留一个设置入口。
  function registerMenus() {
    if (typeof GM_registerMenuCommand !== "function") return;
    if (typeof GM_unregisterMenuCommand === "function")
      while (menus.length) GM_unregisterMenuCommand(menus.pop());
    else if (menus.length) return;
    menus.push(GM_registerMenuCommand("界面设置", openSettings));
  }

  // 初始化页面功能、监听器和设置入口。
  function start() {
    if (started || !document.body) return;
    started = true;
    initialTheme = pageTheme();
    applyConfig();
    scan();
    document.addEventListener("gqc:masonry-settled", revealPage, { once: true });
    observer = new MutationObserver((records) => {
      if (
        records.some((r) => {
          const target = r.target.nodeType === 1 ? r.target : r.target.parentElement;
          if (!target || target.id === STYLE_ID) return false;
          if (
            target.closest?.(
              "#rso, #center_col, #rhs, #rcnt, #searchform, #hdtb, .Fgyi2e, #botstuff, #navcnt, #foot",
            )
          )
            return true;
          return [...(r.addedNodes || []), ...(r.removedNodes || [])].some(
            (n) =>
              n.nodeType === 1 &&
              (n.matches?.(
                "#rso, #center_col, #rhs, #rcnt, #searchform, #hdtb, .Fgyi2e, #botstuff, #navcnt, #foot",
              ) ||
                n.querySelector?.(
                  "#rso, #center_col, #rhs, #rcnt, #searchform, #hdtb, .Fgyi2e, #botstuff, #navcnt, #foot",
                )),
          );
        })
      )
        schedule();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "aria-hidden", "aria-expanded", "aria-busy"],
    });
    themeObserver = new MutationObserver(() => {
      const next = pageTheme();
      if (next !== initialTheme) {
        initialTheme = next;
        applyConfig();
      }
    });
    themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    themeObserver.observe(root, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    media.addEventListener?.("change", () => {
      initialTheme = pageTheme();
      applyConfig();
    });
    addEventListener("resize", schedule, { passive: true });
    addEventListener("pageshow", schedule);
    addEventListener("popstate", schedule);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) schedule();
    });
    registerMenus();
  }

  // 结束启动过渡，确保原生页面保持可见。
  function revealPage() {
    clearTimeout(bootTimer);
    if (root) delete root.dataset.gqcBoot;
  }

  // 启动主题，失败时恢复可用的原生页面。
  function safeStart() {
    try {
      start();
    } catch (error) {
      failed = true;
      active = false;
      cancelAnimationFrame(timer);
      timer = 0;
      revealPage();
      observer?.disconnect();
      themeObserver?.disconnect();
      autoLoader.stop();
      masonry.destroy();
      clearMarks();
      style?.remove();
      document.getElementById(`${PREFIX}-palette`)?.remove();
      if (root) {
        delete root.dataset.gqcActive;
        delete root.dataset.gqcVersion;
      }
      for (const id of menus.splice(0)) {
        try {
          if (typeof GM_unregisterMenuCommand === "function") GM_unregisterMenuCommand(id);
        } catch {}
      }
      console.error("[搜索样式优化] 初始化失败，已恢复原生页面。", error);
    }
  }

  // 页面主体出现即初始化，流式结果在下一绘制帧前适配。
  function bootstrap() {
    root = document.documentElement;
    if (!root) return;
    // 更名前后的脚本可能并存：旧版负责布局时仍补齐新版追问样式，不重复初始化。
    let inputStyle = document.getElementById("gqc-ai-input-styles");
    if (!inputStyle) {
      inputStyle = document.createElement("style");
      inputStyle.id = "gqc-ai-input-styles";
      (document.head || root).append(inputStyle);
    }
    inputStyle.textContent = AI_INPUT_CSS;
    root.dataset.gqcInputVersion = VERSION;
    if (root.dataset.gqcVersion) return;
    root.dataset.gqcVersion = VERSION;
    style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || root).append(style);
    if (
      document.readyState === "loading" &&
      config.enabled &&
      config.motion &&
      allowedView() &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      root.dataset.gqcBoot = "true";
      bootTimer = setTimeout(revealPage, 1500);
    }
    // 搜索结果流式到达时立即处理，不等待整页脚本和资源完成解析。
    if (document.body) safeStart();
    else {
      const waitForBody = new MutationObserver(() => {
        if (!document.body) return;
        waitForBody.disconnect();
        safeStart();
      });
      waitForBody.observe(root, { childList: true });
    }
    document.addEventListener("DOMContentLoaded", schedule, { once: true });
  }
  if (document.documentElement) bootstrap();
  else {
    const waitForRoot = new MutationObserver(() => {
      if (document.documentElement) {
        waitForRoot.disconnect();
        bootstrap();
      }
    });
    waitForRoot.observe(document, { childList: true });
  }
})();

// 其他三站在文档就绪后启动，避免访问尚未创建的页面主体。
function 启动其他搜索站点() {
  (() => {
    "use strict";
    // 四站合一安装文件，无须额外的共享脚本。
    // 不加载远程代码，不跨域请求，不改写站点跳转地址。
    // 根据当前搜索站点选择适配器，各站设置使用独立键保存。
    const adapters = [
      {
        name: "百度",
        namespace: "baidu",
        hosts: ["www.baidu.com", "www1.baidu.com"],
        paths: ["/s"],
        query: ["wd", "word"],
        page: "pn",
        initial: 0,
        scope: "#content_left",
        card: ".result",
        heading: "h3.t a[href],h3 a[href]",
        snippet: ".c-abstract,.content-right_8Zs40,.c-span-last",
        next: "#page a[href]",
        nextText: "下一页|next",
        redirects: ["/link"],
        side: "#content_right",
        nav: "#s_tab",
        pager: "#page",
        css: `
html[data-qc-active="true"] {
  --qc-bg: #fffbfa;
  --qc-surface: #f9ebe9;
  --qc-ink: #352c29;
  --qc-muted: #746660;
  --qc-link: #765047;
  --qc-line: #e9dbd7;
  --qc-interaction: #eed8d3;
  --qc-width: 820px;
  color-scheme: light;
  scrollbar-gutter: stable;
}
html[data-qc-active="true"][data-qc-theme="dark"] {
  --qc-bg: #181311;
  --qc-surface: #2a2220;
  --qc-ink: #ede0dc;
  --qc-muted: #cbbab4;
  --qc-link: #e6bfb7;
  --qc-line: #50413c;
  --qc-interaction: #493632;
  color-scheme: dark;
}
@media (min-width: 1100px) {
  html[data-qc-active="true"][data-qc-columns="2"] {
    --qc-width: 1180px;
  }
}
html[data-qc-active="true"],
html[data-qc-active="true"] body {
  background: var(--qc-bg) !important;
  color: var(--qc-ink);
}
html[data-qc-active="true"] {
  scrollbar-color: var(--qc-line) var(--qc-bg);
  scrollbar-width: thin;
}
html[data-qc-active="true"] .qc-results {
  box-sizing: border-box !important;
  width: min(var(--qc-width), calc(100% - 48px)) !important;
  max-width: none !important;
  margin: 28px auto !important;
  padding: 0 !important;
  float: none !important;
  display: block !important;
  list-style: none !important;
}
html[data-qc-active="true"] .qc-card {
  box-sizing: border-box !important;
  width: 100%;
  max-width: 100%;
  min-width: 0 !important;
  margin: 0 0 20px !important;
  padding: 24px !important;
  border: 0 !important;
  border-radius: 24px !important;
  background: var(--qc-surface) !important;
  color: var(--qc-ink) !important;
  box-shadow: none !important;
  overflow-wrap: anywhere;
}
html[data-qc-active="true"] .qc-card :is(h2, h3) {
  margin-top: 0 !important;
  line-height: 1.4 !important;
}
html[data-qc-active="true"] .qc-card :is(h2, h3) a {
  color: var(--qc-link) !important;
  text-decoration: none;
}
html[data-qc-active="true"] .qc-card :is(h2, h3) a:hover {
  text-decoration: underline;
}
html[data-qc-active="true"]
  .qc-card
  :is(p, .c-abstract, .b_caption, .str_info, .str-text, .space-txt, .txt-box) {
  color: var(--qc-ink) !important;
  line-height: 1.7 !important;
}
html[data-qc-active="true"] .qc-card :is(cite, .qc-url) {
  color: var(--qc-muted) !important;
}
html[data-qc-active="true"] .qc-card img {
  max-width: 100%;
}
html[data-qc-active="true"] .qc-side {
  position: static !important;
  box-sizing: border-box !important;
  max-width: 100% !important;
  width: min(var(--qc-width), calc(100% - 48px)) !important;
  margin: 28px auto !important;
  left: auto !important;
  right: auto !important;
}
html[data-qc-active="true"] .qc-nav {
  width: min(var(--qc-width), calc(100% - 48px)) !important;
  box-sizing: border-box !important;
  margin: 16px auto !important;
}
html[data-qc-active="true"] .qc-pager {
  width: min(var(--qc-width), calc(100% - 48px)) !important;
  min-width: 0 !important;
  margin: 24px auto !important;
  padding: 0 !important;
  text-align: center;
}
html[data-qc-active="true"] .qc-pager a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  min-height: 36px;
  box-sizing: border-box;
  margin: 4px;
  padding: 6px 10px;
  border: 0 !important;
  border-radius: 18px !important;
  background: var(--qc-surface) !important;
  color: var(--qc-link) !important;
  text-decoration: none;
}
html[data-qc-active="true"] .qc-pager :is(strong, [aria-current="page"]) {
  color: var(--qc-ink) !important;
}
html[data-qc-active="true"] .qc-auto-controls {
  box-sizing: border-box;
  padding: 20px 16px;
  text-align: center;
  color: var(--qc-muted);
  font-size: 13px;
  line-height: 1.6;
}
html[data-qc-active="true"] .qc-auto-controls button {
  padding: 12px 24px;
  border: 0;
  border-radius: 24px;
  font: inherit;
  background: var(--qc-interaction);
  color: var(--qc-ink);
  cursor: pointer;
}
html[data-qc-active="true"] .qc-auto-controls a {
  color: var(--qc-link);
}
html[data-qc-active="true"] .qc-auto-controls button:disabled {
  cursor: default;
  opacity: 0.55;
}
html[data-qc-active="true"] :is(.qc-card, .qc-pager, .qc-auto-controls) :focus-visible {
  outline: 2px solid var(--qc-link) !important;
  outline-offset: 4px;
}
html[data-qc-active="true"] .qc-url {
  font-size: 12px;
  margin: 0 0 8px;
  overflow-wrap: anywhere;
}
html[data-qc-active="true"] .qc-auto-card h3 {
  font-size: 20px;
  font-weight: 500;
  margin: 0 0 10px;
}
html[data-qc-active="true"] .qc-auto-card p {
  margin: 0;
}
html[data-qc-active="true"] .qc-auto-badge {
  font-size: 11px;
  color: var(--qc-muted);
  margin-top: 12px;
}
html[data-qc-active="true"][data-qc-motion="true"] .qc-card {
  transition:
    background-color 0.2s,
    box-shadow 0.2s,
    transform 0.24s cubic-bezier(0.2, 0.7, 0.2, 1);
}
@media (hover: hover) {
  html[data-qc-active="true"][data-qc-motion="true"] .qc-card:hover {
    transform: translateY(-3px);
    box-shadow:
      0 2px 4px #49332d12,
      0 4px 12px #49332d0d !important;
  }
}
html[data-qc-active="true"][data-qc-motion="true"] .qc-enter {
  animation: qc-enter 0.38s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
@keyframes qc-enter {
  from {
    opacity: 0;
    translate: 0 8px;
  }
  to {
    opacity: 1;
    translate: 0 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  html[data-qc-active="true"] .qc-card {
    animation: none !important;
    transition: none !important;
    transform: none !important;
  }
}
@media (max-width: 680px) {
  html[data-qc-active="true"] .qc-card {
    padding: 20px !important;
    border-radius: 20px !important;
  }
}

html[data-qc-active="true"] #container {
  display: flex !important;
  flex-direction: column !important;
  width: 100% !important;
  min-width: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
}
html[data-qc-active="true"] #content_left {
  order: 1;
  float: none !important;
}
html[data-qc-active="true"] #content_right {
  order: 4;
  float: none !important;
  height: auto !important;
}
html[data-qc-active="true"] #rs {
  order: 2;
  width: min(var(--qc-width), calc(100% - 48px)) !important;
  margin: 24px auto !important;
}
html[data-qc-active="true"] #page {
  order: 3;
}
html[data-qc-active="true"] :is(#wrapper, #wrapper_wrapper) {
  min-width: 0 !important;
}
html[data-qc-active="true"] #head {
  position: relative !important;
  height: auto !important;
  min-width: 0 !important;
  background: var(--qc-bg) !important;
}
html[data-qc-active="true"] #head .head_wrapper {
  width: min(var(--qc-width), calc(100% - 48px)) !important;
  margin: 24px auto !important;
  min-height: 56px;
}
html[data-qc-active="true"] #head form.fm {
  position: relative !important;
  display: flex !important;
  margin: 0 !important;
  padding: 0 !important;
  width: 100% !important;
  max-width: none !important;
}
html[data-qc-active="true"] #head .s_ipt_wr {
  flex: 1 1 auto;
  min-width: 0 !important;
  width: auto !important;
  background: var(--qc-surface) !important;
  border: 0 !important;
  border-radius: 28px 0 0 28px !important;
  padding: 8px 20px !important;
}
html[data-qc-active="true"] #kw {
  width: 100% !important;
  background: transparent !important;
  color: var(--qc-ink) !important;
}
html[data-qc-active="true"] #head .s_btn_wr {
  width: auto !important;
}
html[data-qc-active="true"] #su {
  height: 56px !important;
  border: 0 !important;
  border-radius: 0 28px 28px 0 !important;
  background: var(--qc-interaction) !important;
  color: var(--qc-ink) !important;
}
html[data-qc-active="true"] :is(#s_tab, .s_tab_inner) {
  padding-left: 0 !important;
  min-width: 0 !important;
}
html[data-qc-active="true"] .head_nums_cont_outer {
  width: min(var(--qc-width), calc(100% - 48px)) !important;
  margin: 0 auto !important;
}
html[data-qc-active="true"] #page .page-inner {
  padding: 0 !important;
}
`,
      },
      {
        name: "必应",
        namespace: "bing",
        hosts: ["www.bing.com", "cn.bing.com"],
        paths: ["/search"],
        query: ["q"],
        page: "first",
        initial: 1,
        scope: "#b_results",
        card: "li.b_algo",
        heading: "h2 a[href]",
        snippet: ".b_caption p,.b_snippet",
        next: 'a.sb_pagN[href],a[rel="next"][href]',
        nextText: "",
        redirects: ["/ck/a", "/aclick"],
        side: "#b_context,.b_widemop_rr",
        nav: "#b_header .b_scopebar",
        pager: ".b_pag,#b_PagAboveFooter",
        css: `
html[data-qc-active="true"] {
  --qc-bg: #fffbfa;
  --qc-surface: #f9ebe9;
  --qc-ink: #352c29;
  --qc-muted: #746660;
  --qc-link: #765047;
  --qc-line: #e9dbd7;
  --qc-interaction: #eed8d3;
  --qc-width: 820px;
  color-scheme: light;
  scrollbar-gutter: stable;
}
html[data-qc-active="true"][data-qc-theme="dark"] {
  --qc-bg: #181311;
  --qc-surface: #2a2220;
  --qc-ink: #ede0dc;
  --qc-muted: #cbbab4;
  --qc-link: #e6bfb7;
  --qc-line: #50413c;
  --qc-interaction: #493632;
  color-scheme: dark;
}
@media (min-width: 1100px) {
  html[data-qc-active="true"][data-qc-columns="2"] {
    --qc-width: 1180px;
  }
}
html[data-qc-active="true"],
html[data-qc-active="true"] body {
  background: var(--qc-bg) !important;
  color: var(--qc-ink);
}
html[data-qc-active="true"] {
  scrollbar-color: var(--qc-line) var(--qc-bg);
  scrollbar-width: thin;
}
html[data-qc-active="true"] .qc-results {
  box-sizing: border-box !important;
  width: min(var(--qc-width), calc(100% - 48px)) !important;
  max-width: none !important;
  margin: 28px auto !important;
  padding: 0 !important;
  float: none !important;
  display: block !important;
  list-style: none !important;
}
html[data-qc-active="true"] .qc-card {
  box-sizing: border-box !important;
  width: 100%;
  max-width: 100%;
  min-width: 0 !important;
  margin: 0 0 20px !important;
  padding: 24px !important;
  border: 0 !important;
  border-radius: 24px !important;
  background: var(--qc-surface) !important;
  color: var(--qc-ink) !important;
  box-shadow: none !important;
  overflow-wrap: anywhere;
}
html[data-qc-active="true"] .qc-card :is(h2, h3) {
  margin-top: 0 !important;
  line-height: 1.4 !important;
}
html[data-qc-active="true"] .qc-card :is(h2, h3) a {
  color: var(--qc-link) !important;
  text-decoration: none;
}
html[data-qc-active="true"] .qc-card :is(h2, h3) a:hover {
  text-decoration: underline;
}
html[data-qc-active="true"]
  .qc-card
  :is(p, .c-abstract, .b_caption, .str_info, .str-text, .space-txt, .txt-box) {
  color: var(--qc-ink) !important;
  line-height: 1.7 !important;
}
html[data-qc-active="true"] .qc-card :is(cite, .qc-url) {
  color: var(--qc-muted) !important;
}
html[data-qc-active="true"] .qc-card img {
  max-width: 100%;
}
html[data-qc-active="true"] .qc-side {
  position: static !important;
  box-sizing: border-box !important;
  max-width: 100% !important;
  width: min(var(--qc-width), calc(100% - 48px)) !important;
  margin: 28px auto !important;
  left: auto !important;
  right: auto !important;
}
html[data-qc-active="true"] .qc-nav {
  width: min(var(--qc-width), calc(100% - 48px)) !important;
  box-sizing: border-box !important;
  margin: 16px auto !important;
}
html[data-qc-active="true"] .qc-pager {
  width: min(var(--qc-width), calc(100% - 48px)) !important;
  min-width: 0 !important;
  margin: 24px auto !important;
  padding: 0 !important;
  text-align: center;
}
html[data-qc-active="true"] .qc-pager a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  min-height: 36px;
  box-sizing: border-box;
  margin: 4px;
  padding: 6px 10px;
  border: 0 !important;
  border-radius: 18px !important;
  background: var(--qc-surface) !important;
  color: var(--qc-link) !important;
  text-decoration: none;
}
html[data-qc-active="true"] .qc-pager :is(strong, [aria-current="page"]) {
  color: var(--qc-ink) !important;
}
html[data-qc-active="true"] .qc-auto-controls {
  box-sizing: border-box;
  padding: 20px 16px;
  text-align: center;
  color: var(--qc-muted);
  font-size: 13px;
  line-height: 1.6;
}
html[data-qc-active="true"] .qc-auto-controls button {
  padding: 12px 24px;
  border: 0;
  border-radius: 24px;
  font: inherit;
  background: var(--qc-interaction);
  color: var(--qc-ink);
  cursor: pointer;
}
html[data-qc-active="true"] .qc-auto-controls a {
  color: var(--qc-link);
}
html[data-qc-active="true"] .qc-auto-controls button:disabled {
  cursor: default;
  opacity: 0.55;
}
html[data-qc-active="true"] :is(.qc-card, .qc-pager, .qc-auto-controls) :focus-visible {
  outline: 2px solid var(--qc-link) !important;
  outline-offset: 4px;
}
html[data-qc-active="true"] .qc-url {
  font-size: 12px;
  margin: 0 0 8px;
  overflow-wrap: anywhere;
}
html[data-qc-active="true"] .qc-auto-card h3 {
  font-size: 20px;
  font-weight: 500;
  margin: 0 0 10px;
}
html[data-qc-active="true"] .qc-auto-card p {
  margin: 0;
}
html[data-qc-active="true"] .qc-auto-badge {
  font-size: 11px;
  color: var(--qc-muted);
  margin-top: 12px;
}
html[data-qc-active="true"][data-qc-motion="true"] .qc-card {
  transition:
    background-color 0.2s,
    box-shadow 0.2s,
    transform 0.24s cubic-bezier(0.2, 0.7, 0.2, 1);
}
@media (hover: hover) {
  html[data-qc-active="true"][data-qc-motion="true"] .qc-card:hover {
    transform: translateY(-3px);
    box-shadow:
      0 2px 4px #49332d12,
      0 4px 12px #49332d0d !important;
  }
}
html[data-qc-active="true"][data-qc-motion="true"] .qc-enter {
  animation: qc-enter 0.38s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
@keyframes qc-enter {
  from {
    opacity: 0;
    translate: 0 8px;
  }
  to {
    opacity: 1;
    translate: 0 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  html[data-qc-active="true"] .qc-card {
    animation: none !important;
    transition: none !important;
    transform: none !important;
  }
}
@media (max-width: 680px) {
  html[data-qc-active="true"] .qc-card {
    padding: 20px !important;
    border-radius: 20px !important;
  }
}

html[data-qc-active="true"] #b_content {
  display: flex !important;
  flex-direction: column !important;
  width: min(var(--qc-width), calc(100% - 48px)) !important;
  margin: 28px auto !important;
  padding: 0 !important;
  min-width: 0 !important;
}
html[data-qc-active="true"] #b_content > main,
html[data-qc-active="true"] .b_widemop_layout {
  width: 100% !important;
  max-width: none !important;
  display: block !important;
  padding: 0 !important;
}
html[data-qc-active="true"] #b_results {
  width: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
}
html[data-qc-active="true"] :is(#b_context, .b_widemop_rr) {
  width: 100% !important;
  margin: 28px 0 !important;
}
html[data-qc-active="true"] #b_header {
  position: relative !important;
  width: min(var(--qc-width), calc(100% - 48px)) !important;
  min-width: 0 !important;
  margin: 28px auto 0 !important;
  padding: 0 !important;
  background: var(--qc-bg) !important;
}
html[data-qc-active="true"] #b_header #sb_form {
  width: 100% !important;
  margin: 0 !important;
}
html[data-qc-active="true"] #b_header .b_searchboxForm {
  width: 100% !important;
  max-width: none !important;
  box-sizing: border-box !important;
  border: 0 !important;
  border-radius: 28px !important;
  min-height: 56px !important;
  background: var(--qc-surface) !important;
  box-shadow: none !important;
}
html[data-qc-active="true"] #sb_form_q {
  max-width: calc(100% - 120px) !important;
  background: transparent !important;
  color: var(--qc-ink) !important;
}
html[data-qc-active="true"] #b_header .b_scopebar {
  margin: 16px 0 !important;
  padding: 0 !important;
}
html[data-qc-active="true"] #b_header .b_scopebar ul {
  padding: 0 !important;
}
html[data-qc-active="true"] #b_header #id_h {
  position: static !important;
  margin: 10px 0 !important;
}
html[data-qc-active="true"] #b_results .b_pag {
  width: 100% !important;
  box-sizing: border-box !important;
}
`,
      },
      {
        name: "搜狗",
        namespace: "sogou",
        hosts: ["www.sogou.com"],
        paths: ["/web"],
        query: ["query", "keyword"],
        page: "page",
        initial: 1,
        scope: "#main .results,.results",
        card: ".rb,.vrwrap",
        heading: "h3 a[href]",
        snippet: ".str_info,.str-text,.space-txt,.txt-box",
        next: "#sogou_next[href],#pagebar a[href],#pagebar_container a[href]",
        nextText: "下一页|next",
        redirects: ["/link"],
        side: "#main .right,.wrapper .right",
        nav: ".header .nav,.top-bar .nav",
        pager: "#pagebar,#pagebar_container",
        css: `
html[data-qc-active="true"] {
  --qc-bg: #fffbfa;
  --qc-surface: #f9ebe9;
  --qc-ink: #352c29;
  --qc-muted: #746660;
  --qc-link: #765047;
  --qc-line: #e9dbd7;
  --qc-interaction: #eed8d3;
  --qc-width: 820px;
  color-scheme: light;
  scrollbar-gutter: stable;
}
html[data-qc-active="true"][data-qc-theme="dark"] {
  --qc-bg: #181311;
  --qc-surface: #2a2220;
  --qc-ink: #ede0dc;
  --qc-muted: #cbbab4;
  --qc-link: #e6bfb7;
  --qc-line: #50413c;
  --qc-interaction: #493632;
  color-scheme: dark;
}
@media (min-width: 1100px) {
  html[data-qc-active="true"][data-qc-columns="2"] {
    --qc-width: 1180px;
  }
}
html[data-qc-active="true"],
html[data-qc-active="true"] body {
  background: var(--qc-bg) !important;
  color: var(--qc-ink);
}
html[data-qc-active="true"] {
  scrollbar-color: var(--qc-line) var(--qc-bg);
  scrollbar-width: thin;
}
html[data-qc-active="true"] .qc-results {
  box-sizing: border-box !important;
  width: min(var(--qc-width), calc(100% - 48px)) !important;
  max-width: none !important;
  margin: 28px auto !important;
  padding: 0 !important;
  float: none !important;
  display: block !important;
  list-style: none !important;
}
html[data-qc-active="true"] .qc-card {
  box-sizing: border-box !important;
  width: 100%;
  max-width: 100%;
  min-width: 0 !important;
  margin: 0 0 20px !important;
  padding: 24px !important;
  border: 0 !important;
  border-radius: 24px !important;
  background: var(--qc-surface) !important;
  color: var(--qc-ink) !important;
  box-shadow: none !important;
  overflow-wrap: anywhere;
}
html[data-qc-active="true"] .qc-card :is(h2, h3) {
  margin-top: 0 !important;
  line-height: 1.4 !important;
}
html[data-qc-active="true"] .qc-card :is(h2, h3) a {
  color: var(--qc-link) !important;
  text-decoration: none;
}
html[data-qc-active="true"] .qc-card :is(h2, h3) a:hover {
  text-decoration: underline;
}
html[data-qc-active="true"]
  .qc-card
  :is(p, .c-abstract, .b_caption, .str_info, .str-text, .space-txt, .txt-box) {
  color: var(--qc-ink) !important;
  line-height: 1.7 !important;
}
html[data-qc-active="true"] .qc-card :is(cite, .qc-url) {
  color: var(--qc-muted) !important;
}
html[data-qc-active="true"] .qc-card img {
  max-width: 100%;
}
html[data-qc-active="true"] .qc-side {
  position: static !important;
  box-sizing: border-box !important;
  max-width: 100% !important;
  width: min(var(--qc-width), calc(100% - 48px)) !important;
  margin: 28px auto !important;
  left: auto !important;
  right: auto !important;
}
html[data-qc-active="true"] .qc-nav {
  width: min(var(--qc-width), calc(100% - 48px)) !important;
  box-sizing: border-box !important;
  margin: 16px auto !important;
}
html[data-qc-active="true"] .qc-pager {
  width: min(var(--qc-width), calc(100% - 48px)) !important;
  min-width: 0 !important;
  margin: 24px auto !important;
  padding: 0 !important;
  text-align: center;
}
html[data-qc-active="true"] .qc-pager a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  min-height: 36px;
  box-sizing: border-box;
  margin: 4px;
  padding: 6px 10px;
  border: 0 !important;
  border-radius: 18px !important;
  background: var(--qc-surface) !important;
  color: var(--qc-link) !important;
  text-decoration: none;
}
html[data-qc-active="true"] .qc-pager :is(strong, [aria-current="page"]) {
  color: var(--qc-ink) !important;
}
html[data-qc-active="true"] .qc-auto-controls {
  box-sizing: border-box;
  padding: 20px 16px;
  text-align: center;
  color: var(--qc-muted);
  font-size: 13px;
  line-height: 1.6;
}
html[data-qc-active="true"] .qc-auto-controls button {
  padding: 12px 24px;
  border: 0;
  border-radius: 24px;
  font: inherit;
  background: var(--qc-interaction);
  color: var(--qc-ink);
  cursor: pointer;
}
html[data-qc-active="true"] .qc-auto-controls a {
  color: var(--qc-link);
}
html[data-qc-active="true"] .qc-auto-controls button:disabled {
  cursor: default;
  opacity: 0.55;
}
html[data-qc-active="true"] :is(.qc-card, .qc-pager, .qc-auto-controls) :focus-visible {
  outline: 2px solid var(--qc-link) !important;
  outline-offset: 4px;
}
html[data-qc-active="true"] .qc-url {
  font-size: 12px;
  margin: 0 0 8px;
  overflow-wrap: anywhere;
}
html[data-qc-active="true"] .qc-auto-card h3 {
  font-size: 20px;
  font-weight: 500;
  margin: 0 0 10px;
}
html[data-qc-active="true"] .qc-auto-card p {
  margin: 0;
}
html[data-qc-active="true"] .qc-auto-badge {
  font-size: 11px;
  color: var(--qc-muted);
  margin-top: 12px;
}
html[data-qc-active="true"][data-qc-motion="true"] .qc-card {
  transition:
    background-color 0.2s,
    box-shadow 0.2s,
    transform 0.24s cubic-bezier(0.2, 0.7, 0.2, 1);
}
@media (hover: hover) {
  html[data-qc-active="true"][data-qc-motion="true"] .qc-card:hover {
    transform: translateY(-3px);
    box-shadow:
      0 2px 4px #49332d12,
      0 4px 12px #49332d0d !important;
  }
}
html[data-qc-active="true"][data-qc-motion="true"] .qc-enter {
  animation: qc-enter 0.38s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
@keyframes qc-enter {
  from {
    opacity: 0;
    translate: 0 8px;
  }
  to {
    opacity: 1;
    translate: 0 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  html[data-qc-active="true"] .qc-card {
    animation: none !important;
    transition: none !important;
    transform: none !important;
  }
}
@media (max-width: 680px) {
  html[data-qc-active="true"] .qc-card {
    padding: 20px !important;
    border-radius: 20px !important;
  }
}

html[data-qc-active="true"] :is(.wrapper, #main) {
  min-width: 0 !important;
}
html[data-qc-active="true"] #main {
  display: flex !important;
  flex-direction: column !important;
  width: min(var(--qc-width), calc(100% - 48px)) !important;
  margin: 28px auto !important;
  padding: 0 !important;
}
html[data-qc-active="true"] .results {
  width: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
  float: none !important;
  order: 1;
}
html[data-qc-active="true"] #main .right {
  float: none !important;
  order: 3;
  width: 100% !important;
}
html[data-qc-active="true"] :is(#pagebar, #pagebar_container) {
  order: 2;
}
html[data-qc-active="true"] .header {
  min-width: 0 !important;
  height: auto !important;
  padding: 24px 0 !important;
  background: var(--qc-bg) !important;
}
html[data-qc-active="true"] .header form {
  width: min(var(--qc-width), calc(100% - 48px)) !important;
  max-width: 100% !important;
  margin: 0 auto !important;
}
html[data-qc-active="true"] .header .searchbox {
  display: flex !important;
  align-items: center !important;
  min-height: 56px !important;
  width: 100% !important;
  box-sizing: border-box !important;
  border: 0 !important;
  border-radius: 28px !important;
  background: var(--qc-surface) !important;
}
html[data-qc-active="true"] .header :is(input[name="query"], input[name="keyword"]) {
  flex: 1 1 auto !important;
  min-width: 0 !important;
  width: auto !important;
  padding: 8px 20px !important;
  background: transparent !important;
  color: var(--qc-ink) !important;
  max-width: calc(100% - 120px) !important;
}
html[data-qc-active="true"] .header :is(.sbtn, .sec-btn) {
  flex: 0 0 auto !important;
  min-height: 56px !important;
  min-width: 100px !important;
  margin-left: auto !important;
  border: 0 !important;
  border-radius: 0 28px 28px 0 !important;
  background: var(--qc-interaction) !important;
  color: var(--qc-ink) !important;
}
`,
      },
    ];
    const A = adapters.find(
      (adapter) =>
        adapter.hosts.includes(location.hostname) && adapter.paths.includes(location.pathname),
    );
    if (!A) return;
    if (
      window.top !== window.self ||
      !A.hosts.includes(location.hostname) ||
      !A.paths.includes(location.pathname)
    )
      return;
    const root = document.documentElement;
    const ID = `qc-${A.namespace}`;
    if (!root || document.getElementById(`${ID}-style`)) return;
    const DEFAULTS = Object.freeze({
      enabled: true,
      motion: true,
      color: "#f9ebe9",
      columns: 1,
      newTab: true,
      autoLoad: true,
      blockAds: true,
    });
    const normalize = (value) => ({
      enabled: value.enabled !== false,
      motion: value.motion !== false,
      color: /^#[0-9a-f]{6}$/i.test(value.color || "") ? value.color : DEFAULTS.color,
      columns: Number(value.columns) === 2 ? 2 : 1,
      newTab: value.newTab !== false,
      autoLoad: value.autoLoad !== false,
      blockAds: value.blockAds !== false,
    });
    let config;
    try {
      config = normalize(
        typeof GM_getValue === "function"
          ? GM_getValue(`${ID}.settings.v1`, DEFAULTS) || DEFAULTS
          : DEFAULTS,
      );
    } catch {
      config = { ...DEFAULTS };
    }
    let active = false,
      currentScope = null,
      scanTimer = 0,
      panel = null;
    const marks = new Set(),
      links = new Map(),
      menus = [];
    const media = matchMedia("(prefers-color-scheme: dark)");
    const SPECIAL =
      '.special-wrap,[role="dialog"],[role="listbox"],[role="menu"],video,iframe,form,[aria-expanded],[data-text-ad],.b_ad,.ec_tuiguang_pp,.ec-tuiguang';
    const css = A.css;
    const style = document.createElement("style");
    style.id = `${ID}-style`;
    style.textContent = css;
    (document.head || root).append(style);
    const palette = document.createElement("style");
    palette.id = `${ID}-palette`;
    (document.head || root).append(palette);
    const mark = (el, name) => {
      if (el && !el.classList.contains(name)) {
        el.classList.add(name);
        marks.add(el);
      }
    };
    const clean = (value, max = 1000) =>
      String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max);
    const make = (tag, text, className) => {
      const el = document.createElement(tag);
      if (text) el.textContent = text;
      if (className) el.className = className;
      return el;
    };

    // 读取当前搜索关键词。
    function query(url) {
      return A.query.map((key) => url.searchParams.get(key)).find(Boolean) || "";
    }

    // 检查当前地址是否属于支持的网页搜索。
    function allowed(url) {
      return (
        A.hosts.includes(url.hostname) &&
        A.paths.includes(url.pathname) &&
        !!query(url) &&
        !(
          A.namespace === "baidu" &&
          url.searchParams.get("tn") &&
          /image|video|news/i.test(url.searchParams.get("tn"))
        )
      );
    }

    // 归一化搜索条件，防止拼接其他查询结果。
    function signature(url) {
      // 保留有效筛选条件，仅忽略分页与统计字段。
      const ignore = new Set([
        A.page,
        "form",
        "FORM",
        "spm",
        "rsv_pq",
        "rsv_t",
        "rsv_page",
        "oq",
        "bs",
        "ie",
        "usm",
      ]);
      const analytics =
        /^(rsv_|eqid$|cvid$|sp$|pq$|sc$|qs$|sk$|ghsh$|ghacc$|ghpl$|sugsuv$|sugtime$|sut$)/i;
      const pairs = [...url.searchParams]
        .filter(([k]) => !ignore.has(k) && !A.query.includes(k) && !analytics.test(k))
        .sort(([a], [b]) => a.localeCompare(b));
      return JSON.stringify([query(url), pairs]);
    }

    // 解析并校验分页偏移量。
    function offset(url) {
      const value = url.searchParams.get(A.page);
      return value === null ? A.initial : /^\d+$/.test(value) ? Number(value) : NaN;
    }

    // 校验外链，保留站点原有跳转地址。
    function external(href, base = location.href) {
      try {
        const url = new URL(href, base);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
          return null;
        if (A.hosts.includes(url.hostname) && !A.redirects.includes(url.pathname)) return null;
        return url;
      } catch {
        return null;
      }
    }

    // 识别能够安全卡片化的普通网页结果。
    function normalCard(node) {
      if (!node.matches(A.card) || node.matches(SPECIAL) || node.querySelector(SPECIAL))
        return false;
      if (node.querySelectorAll("h2,h3").length !== 1) return false;
      const title = node.querySelector(A.heading);
      return !!(title && external(title.getAttribute("href")) && clean(title.textContent));
    }

    // 恢复链接原有的打开方式。
    function restoreLinks(keep = new Set()) {
      for (const [link, old] of links) {
        if (keep.has(link)) continue;
        if (link.getAttribute("target") === "_blank")
          old.target === null
            ? link.removeAttribute("target")
            : link.setAttribute("target", old.target);
        if (link.getAttribute("rel") === old.writtenRel)
          old.rel === null ? link.removeAttribute("rel") : link.setAttribute("rel", old.rel);
        links.delete(link);
      }
    }

    // 按当前设置调整结果链接的打开方式。
    function updateLinks(scope) {
      const keep = new Set();
      if (config.newTab)
        for (const link of scope.querySelectorAll("a[href]")) {
          if (
            link.closest('[role="dialog"],[role="menu"],[role="listbox"]') ||
            !external(link.getAttribute("href"))
          )
            continue;
          keep.add(link);
          let old = links.get(link);
          if (!old) {
            old = { target: link.getAttribute("target"), rel: link.getAttribute("rel") };
            links.set(link, old);
          } else {
            if (link.getAttribute("target") !== "_blank") old.target = link.getAttribute("target");
            if (link.getAttribute("rel") !== old.writtenRel) old.rel = link.getAttribute("rel");
          }
          old.writtenRel = [
            ...new Set(
              (link.getAttribute("rel") || "").split(/\s+/).filter(Boolean).concat("noopener"),
            ),
          ].join(" ");
          if (link.target !== "_blank") link.setAttribute("target", "_blank");
          if (link.getAttribute("rel") !== old.writtenRel) link.setAttribute("rel", old.writtenRel);
        }
      restoreLinks(keep);
    }

    // 恢复原生外观并释放当前结果区状态。
    function clear() {
      masonry.stop();
      loader.stop();
      restoreLinks();
      for (const el of marks)
        for (const c of [...el.classList]) if (c.startsWith("qc-")) el.classList.remove(c);
      marks.clear();
      root.removeAttribute("data-qc-active");
      currentScope = null;
    }

    // 根据主题色生成浅色和深色表面。
    function applyPalette() {
      if (config.color.toLowerCase() === "#f9ebe9") {
        if (palette.textContent) palette.textContent = "";
        return;
      }
      const rgb = [1, 3, 5].map((i) => parseInt(config.color.slice(i, i + 2), 16));
      const mix = (v, r) => `rgb(${rgb.map((x) => Math.round(x * r + v * (1 - r))).join(",")})`;
      const vars = (map) =>
        Object.entries(map)
          .map(([k, v]) => `--qc-${k}:${v}`)
          .join(";");
      const light = vars({
        bg: mix(255, 0.08),
        surface: mix(255, 0.5),
        ink: mix(0, 0.18),
        muted: mix(0, 0.38),
        link: mix(0, 0.32),
        line: mix(255, 0.65),
        interaction: mix(255, 0.72),
      });
      const dark = vars({
        bg: mix(0, 0.08),
        surface: mix(0, 0.16),
        ink: mix(255, 0.12),
        muted: mix(255, 0.32),
        link: mix(255, 0.34),
        line: mix(0, 0.34),
        interaction: mix(0, 0.32),
      });
      const value = [
        'html[data-qc-active="true"][data-qc-theme="light"] {',
        light,
        "}",
        'html[data-qc-active="true"][data-qc-theme="dark"] {',
        dark,
        "}",
      ].join("\n");
      if (palette.textContent !== value) palette.textContent = value;
    }

    // 重新识别结果与复杂模块并更新布局。
    function scan() {
      scanTimer = 0;
      root.dataset.qcAds = String(config.enabled && config.blockAds);
      const scope = document.querySelector(A.scope);
      active = config.enabled && allowed(new URL(location.href)) && !!scope;
      if (!active) {
        clear();
        return;
      }
      if (currentScope && currentScope !== scope) clear();
      currentScope = scope;
      root.dataset.qcActive = "true";
      root.dataset.qcTheme = media.matches ? "dark" : "light";
      root.dataset.qcMotion = String(config.motion);
      root.dataset.qcColumns = String(config.columns);
      applyPalette();
      mark(scope, "qc-results");
      for (const child of scope.children) {
        if (child.classList.contains("qc-auto-card")) continue;
        if (normalCard(child)) {
          if (!child.classList.contains("qc-card")) {
            mark(child, "qc-card");
            if (config.motion && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
              mark(child, "qc-enter");
              setTimeout(() => child.classList.remove("qc-enter"), 450);
            }
          }
        } else if (child.classList.contains("qc-card")) child.classList.remove("qc-card");
      }
      for (const [selector, name] of [
        [A.side, "qc-side"],
        [A.nav, "qc-nav"],
        [A.pager, "qc-pager"],
      ])
        for (const el of document.querySelectorAll(selector)) mark(el, name);
      updateLinks(scope);
      loader.sync(scope);
      masonry.sync();
    }

    // 合并连续页面更新，避免频繁重复布局。
    function schedule() {
      if (!scanTimer) scanTimer = setTimeout(scan, 80);
    }

    // 校验同源、同查询且页码递增的原生下一页。
    function nextPage(doc, base, initial, seen) {
      const candidates = [...doc.querySelectorAll(A.next)];
      const link = candidates.find(
        (a) =>
          !A.nextText ||
          a.id === "sogou_next" ||
          new RegExp(A.nextText, "i").test(
            `${a.textContent} ${a.getAttribute("aria-label") || ""} ${a.title}`,
          ),
      );
      if (!link) return { url: null, reason: "没有找到可识别的下一页，已停止拼接。" };
      try {
        const url = new URL(link.getAttribute("href"), base);
        url.hash = "";
        if (
          url.origin !== initial.origin ||
          !allowed(url) ||
          url.username ||
          url.password ||
          url.pathname !== initial.pathname ||
          query(url) !== query(initial) ||
          signature(url) !== signature(initial) ||
          !Number.isSafeInteger(offset(url)) ||
          offset(url) <= offset(base) ||
          seen.has(offset(url))
        )
          return { url: null, reason: "下一页地址或搜索条件不匹配，请使用原生分页。" };
        return { url, reason: "" };
      } catch {
        return { url: null, reason: "无法识别下一页地址，请使用原生分页。" };
      }
    }

    // 提取可安全拼接的普通网页标题、网址和摘要。
    function entries(doc, base) {
      const scope = doc.querySelector(A.scope);
      if (!scope) return [];
      return [...scope.children]
        .filter(normalCard)
        .map((node) => {
          const title = node.querySelector(A.heading),
            url = external(title.getAttribute("href"), base);
          if (!url) return null;
          const key = new URL(url);
          key.hash = "";
          return {
            title: clean(title.textContent, 260),
            url: url.href,
            key: key.href,
            host: url.hostname,
            snippet: clean(node.querySelector(A.snippet)?.textContent, 1000),
          };
        })
        .filter(Boolean);
    }

    // 创建只跟随原生分页的普通网页结果加载器。
    function createLoader() {
      let s = null,
        frame = 0,
        lastY = scrollY,
        goingDown = false;

      // 检查异步任务是否仍属于当前查询。
      function live(value) {
        return (
          s === value &&
          value.scope.isConnected &&
          location.href === value.href &&
          active &&
          config.autoLoad
        );
      }

      // 更新加载进度、暂停原因及可用操作。
      function status(value, text, retry = false) {
        value.label.textContent = text;
        value.button.disabled = value.loading || !value.next;
        value.button.textContent = retry ? "重试下一页" : "加载下一页";
        value.full.hidden = !value.next;
        if (value.next) value.full.href = value.next.href;
      }

      // 创建没有远程依赖的追加结果卡片。
      function card(entry, page) {
        const el = make("article", null, "qc-card qc-auto-card");
        // 必应使用列表，追加合法列表项并保留原生节点。
        const item = A.namespace === "bing" ? make("li", null, "qc-card qc-auto-card") : el;
        const title = make("h3"),
          a = make("a", entry.title);
        a.href = entry.url;
        title.append(a);
        item.append(make("p", entry.host, "qc-url"), title);
        if (entry.snippet) item.append(make("p", entry.snippet));
        item.append(make("div", `追加第 ${page - 1} 页 · 普通网页结果`, "qc-auto-badge"));
        return item;
      }

      // 请求下一页，校验响应并过滤重复结果。
      async function load(manual = false) {
        const value = s;
        if (!value || !live(value) || value.loading || !value.next || (!manual && value.paused))
          return;
        value.loading = true;
        value.paused = false;
        const target = value.next;
        value.controller = new AbortController();
        const timeout = setTimeout(() => value.controller.abort(), 15000);
        status(value, "正在加载下一页…");
        try {
          const response = await fetch(target.href, {
            credentials: "same-origin",
            mode: "same-origin",
            redirect: "error",
            signal: value.controller.signal,
          });
          if (!response.ok) throw Error(`HTTP ${response.status}`);
          const final = new URL(response.url || target.href);
          if (
            final.origin !== target.origin ||
            final.pathname !== target.pathname ||
            signature(final) !== signature(target) ||
            offset(final) !== offset(target)
          )
            throw Error("返回地址不匹配");
          const type = response.headers.get("content-type") || "";
          if (!/text\/html/i.test(type)) throw Error("响应不是网页");
          const html = await response.text();
          if (!live(value)) return;
          const doc = new DOMParser().parseFromString(html, "text/html");
          if (
            doc.querySelector(
              'form[action*="captcha"],#captcha,#b_captcha,#seccode,[id*="captcha"]',
            ) ||
            /安全验证|人机验证|请输入验证码|unusual traffic|verify you are human/i.test(doc.title)
          )
            throw Error("检测到验证页面");
          const incoming = entries(doc, target.href).filter((entry) => !value.keys.has(entry.key));
          if (!incoming.length) throw Error("未发现可安全拼接的新网页结果");
          value.seen.add(offset(target));
          value.page++;
          const fragment = document.createDocumentFragment();
          for (const entry of incoming) {
            if (value.keys.has(entry.key)) continue;
            value.keys.add(entry.key);
            const node = card(entry, value.page);
            value.owned.add(node);
            fragment.append(node);
          }
          // 保留原生分页位置，在其前方添加新的结果。
          const pager = [...value.scope.children].find((el) => el.matches(A.pager));
          value.scope.insertBefore(fragment, pager || null);
          const next = nextPage(doc, target, value.initial, value.seen);
          value.next = next.url;
          value.loading = false;
          status(
            value,
            value.next ? `已拼接 ${value.page} 页。继续向下滚动可加载下一页。` : next.reason,
          );
          schedule();
        } catch (error) {
          if (live(value)) {
            value.loading = false;
            value.paused = true;
            status(
              value,
              `自动拼接暂停：${error.name === "AbortError" ? "请求超时" : error.message}。可重试或打开完整分页。`,
              true,
            );
          }
        } finally {
          clearTimeout(timeout);
          if (s === value) value.loading = false;
        }
      }

      // 停止当前功能并清理脚本创建的临时界面。
      function stop() {
        if (!s) return;
        const old = s;
        s = null;
        old.controller?.abort();
        old.controls.remove();
        for (const node of old.owned) node.remove();
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        lastY = scrollY;
      }

      // 同步页面状态及已存在的结果节点。
      function sync(scope) {
        if (!active || !config.autoLoad) {
          stop();
          return;
        }
        if (s && (s.scope !== scope || s.href !== location.href)) stop();
        if (s) return;
        const initial = new URL(location.href),
          seen = new Set([offset(initial)]),
          next = nextPage(document, initial, initial, seen);
        const controls = make("section", null, "qc-auto-controls");
        controls.setAttribute("aria-label", "自动拼接");
        const label = make("p");
        label.setAttribute("role", "status");
        label.setAttribute("aria-live", "polite");
        const button = make("button", "加载下一页");
        button.type = "button";
        const full = make("a", "打开完整下一页");
        full.target = "_blank";
        full.rel = "noopener";
        const note = make(
          "p",
          "仅拼接普通网页文字。AI、视频、问答、图片等交互模块请打开完整分页。",
        );
        controls.append(label, button, make("span", "　"), full, note);
        scope.after(controls);
        s = {
          scope,
          href: location.href,
          initial,
          next: next.url,
          seen,
          keys: new Set(entries(document, location.href).map((e) => e.key)),
          owned: new Set(),
          controls,
          label,
          button,
          full,
          page: 1,
          loading: false,
          paused: false,
        };
        button.addEventListener("click", () => load(true));
        status(s, next.url ? "向下滚动到结果底部，或点按钮加载下一页。" : next.reason);
        lastY = scrollY;
      }
      addEventListener(
        "scroll",
        () => {
          const y = scrollY,
            down = y > lastY + 1;
          lastY = y;
          goingDown = down;
          if (!down || frame || !s || document.hidden) return;
          frame = requestAnimationFrame(() => {
            frame = 0;
            if (!goingDown || !s || !live(s) || document.hidden || s.loading || s.paused || !s.next)
              return;
            const box = s.controls.getBoundingClientRect();
            if (box.width > 0 && box.top < innerHeight + 700 && box.bottom > 0) void load();
          });
        },
        { passive: true },
      );
      document.addEventListener("qc:masonry-settled", () => {
        lastY = scrollY;
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
      });
      return { sync, stop };
    }

    // 保留原生节点的双列布局实现。

    // 管理双列布局和原生样式恢复，不移动结果节点。
    function createMasonryLayout(canRun, options = {}) {
      const gap = Number.isFinite(options.gap) ? Math.max(0, options.gap) : 20;
      const minWidth = Number.isFinite(options.minWidth) ? options.minWidth : 1100;
      const hosts = new Map();
      let frame = 0;
      let disposed = false;
      const enabled = () => !disposed && canRun() && innerWidth >= minWidth;
      const round = (n) => Math.round(n * 100) / 100;
      const number = (value) => Number.parseFloat(value) || 0;
      const equalSize = (a, b) =>
        a && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;

      // 设置本脚本负责的样式并保留原始值。
      function own(record, property, value) {
        const style = record.node.style;
        const current = style.getPropertyValue(property);
        const priority = style.getPropertyPriority(property);
        let saved = record.styles.get(property);
        if (!saved) {
          saved = { original: current, priority, written: null, writtenPriority: null };
          record.styles.set(property, saved);
        } else if (
          saved.written !== null &&
          (current !== saved.written || priority !== saved.writtenPriority)
        ) {
          // 恢复样式时保留主题运行期间发生的站点原生更新。
          saved.original = current;
          saved.priority = priority;
        }
        if (current !== value || priority !== "important")
          style.setProperty(property, value, "important");
        saved.written = value;
        saved.writtenPriority = "important";
      }

      // 恢复脚本改写的样式，保留站点后续更新。
      function restore(record) {
        for (const [property, saved] of record.styles) {
          if (
            record.node.style.getPropertyValue(property) !== saved.written ||
            record.node.style.getPropertyPriority(property) !== saved.writtenPriority
          )
            continue;
          if (saved.original)
            record.node.style.setProperty(property, saved.original, saved.priority);
          else record.node.style.removeProperty(property);
        }
        record.styles.clear();
      }

      // 记录节点样式，便于关闭主题时恢复原状。
      function record(node) {
        return { node, styles: new Map() };
      }

      // 遍历结果分组，返回实际参与布局的结果单元。
      function candidates(host) {
        return [...host.children].filter(
          (node) =>
            node instanceof HTMLElement &&
            !["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"].includes(node.tagName),
        );
      }

      // 筛选当前可见的结果，排除浮层及隐藏内容。
      function liveItems(host) {
        return candidates(host).filter((node) => {
          if (node.hidden || node.classList.contains("qc-pass-through")) return false;
          const css = getComputedStyle(node);
          if (css.display === "none" || css.display === "contents") return false;
          // 原生浮层不属于搜索卡片，不参与位置调整。
          if (
            (css.position === "fixed" || css.position === "absolute") &&
            !node.classList.contains("qc-masonry-item")
          )
            return false;
          return node.matches(".qc-card,.qc-module") || node.offsetHeight > 0;
        });
      }

      // 判断模块是否需要跨越两列。
      function fullWidth(node) {
        return (
          !node.classList.contains("qc-card") ||
          node.classList.contains("qc-module") ||
          !!node.querySelector(
            '[aria-expanded],video,g-scrolling-carousel,[role="dialog"],[role="menu"]',
          )
        );
      }

      // 记录当前可见内容位置，减小布局变化引起的跳动。
      function captureAnchor() {
        const focus = document.activeElement;
        if (focus && focus !== document.body && focus !== document.documentElement) {
          for (const host of hosts.keys()) {
            if (!host.contains(focus)) continue;
            const rect = focus.getBoundingClientRect();
            if (rect.bottom > 0 && rect.top < innerHeight) return { node: focus, top: rect.top };
          }
        }
        const visible = [];
        for (const host of hosts.keys()) {
          for (const node of candidates(host)) {
            if (node.classList.contains("qc-pass-through") || node.hidden) continue;
            const rect = node.getBoundingClientRect();
            if (rect.width > 0 && rect.bottom > 0 && rect.top < innerHeight)
              visible.push({ node, top: rect.top, bottom: rect.bottom });
          }
        }
        // 优先选择顶部可见卡片作为滚动锚点。
        visible.sort(
          (a, b) =>
            (a.top >= 0 ? a.top : innerHeight + Math.abs(a.top)) -
            (b.top >= 0 ? b.top : innerHeight + Math.abs(b.top)),
        );
        return visible[0] || null;
      }

      // 根据内容锚点校正滚动位置并通知加载器。
      function settle(anchor) {
        if (anchor?.node.isConnected) {
          const rect = anchor.node.getBoundingClientRect();
          const delta = rect.top - anchor.top;
          if (rect.width > 0 && Math.abs(delta) > 1)
            scrollBy({ left: 0, top: delta, behavior: "instant" });
        }
        // 通知加载器忽略布局校正产生的滚动。
        document.dispatchEvent(new Event("qc:masonry-settled"));
      }

      // 合并连续页面更新，避免频繁重复布局。
      function schedule() {
        if (!frame && enabled()) frame = requestAnimationFrame(layout);
      }

      // 监听结果区大小和内容变化。
      function observeHost(host) {
        const state = {
          host: record(host),
          items: new Map(),
          sizes: new WeakMap(),
          observer: null,
          mutation: null,
        };
        if ("ResizeObserver" in window) {
          state.observer = new ResizeObserver((entries) => {
            let changed = false;
            for (const entry of entries) {
              const box = Array.isArray(entry.borderBoxSize)
                ? entry.borderBoxSize[0]
                : entry.borderBoxSize;
              const size = box
                ? { width: box.inlineSize, height: box.blockSize }
                : { width: entry.contentRect.width, height: entry.contentRect.height };
              const old = state.sizes.get(entry.target);
              // 容器高度是布局结果，不重复触发布局。
              if (
                entry.target === host
                  ? !old || Math.abs(old.width - size.width) >= 0.5
                  : !equalSize(old, size)
              )
                changed = true;
              state.sizes.set(entry.target, size);
            }
            if (changed) schedule();
          });
          state.observer.observe(host);
        }
        state.mutation = new MutationObserver(schedule);
        state.mutation.observe(host, { childList: true, subtree: true, characterData: true });
        hosts.set(host, state);
        return state;
      }

      // 停止监听并恢复该结果区的原生样式。
      function drop(host, state) {
        state.observer?.disconnect();
        state.mutation?.disconnect();
        for (const item of state.items.values()) {
          restore(item);
          item.node.classList.remove("qc-masonry-item");
        }
        restore(state.host);
        host.classList.remove("qc-masonry-host");
        hosts.delete(host);
      }

      // 计算列宽、卡片高度及位置，批量应用布局。
      function layout() {
        frame = 0;
        if (!enabled()) {
          stop();
          return;
        }
        const anchor = captureAnchor();
        const plans = [];
        // 先批量设置宽度，再测量高度并写入位置。
        for (const [host, state] of hosts) {
          if (!host.isConnected || !host.classList.contains("qc-results")) {
            drop(host, state);
            continue;
          }
          const hostCSS = getComputedStyle(host);
          if (hostCSS.display === "none" || host.clientWidth <= 0) continue;
          const padLeft = number(hostCSS.paddingLeft),
            padRight = number(hostCSS.paddingRight);
          const padTop = number(hostCSS.paddingTop),
            padBottom = number(hostCSS.paddingBottom);
          const borders = number(hostCSS.borderTopWidth) + number(hostCSS.borderBottomWidth);
          const width = host.clientWidth - padLeft - padRight;
          const columnWidth = (width - gap) / 2;
          if (!Number.isFinite(columnWidth) || columnWidth < 160) {
            drop(host, state);
            continue;
          }
          const nodes = liveItems(host);
          const wanted = new Set(nodes);
          for (const [node, item] of state.items) {
            if (wanted.has(node)) continue;
            state.observer?.unobserve(node);
            restore(item);
            node.classList.remove("qc-masonry-item");
            state.items.delete(node);
          }
          own(state.host, "position", "relative");
          own(state.host, "display", "block");
          own(state.host, "box-sizing", "border-box");
          own(state.host, "overflow-anchor", "none");
          host.classList.add("qc-masonry-host");
          const items = [];
          for (const node of nodes) {
            let item = state.items.get(node);
            if (!item) {
              item = record(node);
              state.items.set(node, item);
              state.observer?.observe(node);
            }
            const span = fullWidth(node);
            own(item, "position", "absolute");
            own(item, "box-sizing", "border-box");
            own(item, "width", `${round(span ? width : columnWidth)}px`);
            own(item, "min-width", "0px");
            own(item, "max-width", "none");
            own(item, "margin", "0px");
            own(item, "right", "auto");
            own(item, "bottom", "auto");
            node.classList.add("qc-masonry-item");
            items.push({ item, span });
          }
          plans.push({
            state,
            items,
            padLeft,
            padTop,
            padBottom,
            borders,
            columnWidth,
            rtl: hostCSS.direction === "rtl",
          });
        }
        for (const plan of plans) {
          // 使用包含边框且不受悬停变换影响的原始高度。
          for (const placement of plan.items)
            placement.height = Math.max(0, placement.item.node.offsetHeight);
        }
        for (const plan of plans) {
          const heights = [plan.padTop, plan.padTop];
          let bottom = plan.padTop;
          for (const { item, span, height } of plan.items) {
            const column = heights[0] <= heights[1] ? 0 : 1;
            const top = span ? Math.max(...heights) : heights[column];
            const visualColumn = plan.rtl ? 1 - column : column;
            const left = plan.padLeft + (span ? 0 : visualColumn * (plan.columnWidth + gap));
            own(item, "left", `${round(left)}px`);
            own(item, "top", `${round(top)}px`);
            bottom = Math.max(bottom, top + height);
            if (span) heights[0] = heights[1] = top + height + gap;
            else heights[column] = top + height + gap;
          }
          own(plan.state.host, "height", `${Math.ceil(bottom + plan.padBottom + plan.borders)}px`);
        }
        settle(anchor);
      }

      // 同步页面状态及已存在的结果节点。
      function sync() {
        if (!enabled()) {
          stop();
          return;
        }
        const desired = new Set(
          [...document.querySelectorAll(".qc-results")].filter(
            (host) => host instanceof HTMLElement && !host.closest(".qc-card,.qc-module"),
          ),
        );
        for (const [host, state] of hosts)
          if (!desired.has(host) || !host.isConnected) drop(host, state);
        for (const host of desired) if (!hosts.has(host)) observeHost(host);
        schedule();
      }

      // 停止当前功能并清理脚本创建的临时界面。
      function stop() {
        if (frame) {
          cancelAnimationFrame(frame);
          frame = 0;
        }
        if (!hosts.size) return;
        const anchor = captureAnchor();
        for (const [host, state] of [...hosts]) drop(host, state);
        settle(anchor);
      }
      const onResize = () => sync();
      const onLoad = (event) => {
        if ([...hosts.keys()].some((host) => host.contains(event.target))) schedule();
      };
      addEventListener("resize", onResize, { passive: true });
      // 捕获延迟图片加载，兼容没有尺寸监听器的环境。
      document.addEventListener("load", onLoad, true);
      document.fonts?.ready.then(() => {
        if (!disposed) schedule();
      });
      return {
        sync,
        stop,
        destroy() {
          stop();
          disposed = true;
          removeEventListener("resize", onResize);
          document.removeEventListener("load", onLoad, true);
        },
      };
    }

    // 显示本站设置弹窗，所有开关统一在弹窗内配置。
    function openSettings() {
      if (panel?.isConnected) {
        panel.shadowRoot.querySelector("dialog").focus();
        return;
      }
      const host = make("div");
      host.id = `${ID}-settings`;
      const shadow = host.attachShadow({ mode: "open" });
      const ui = make("style");
      ui.textContent = `
:host {
  all: initial;
  font-family:
    system-ui,
    -apple-system,
    "Segoe UI",
    sans-serif;
  color-scheme: light dark;
}
dialog {
  box-sizing: border-box;
  width: min(520px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  overflow: auto;
  margin: auto;
  padding: 28px;
  border: 1px solid #e9dbd7;
  border-radius: 28px;
  background: #fffbfa;
  color: #352c29;
  box-shadow: 0 16px 64px #352c2930;
  font:
    14px/1.6 system-ui,
    sans-serif;
}
dialog::backdrop {
  background: #231a1860;
  backdrop-filter: blur(3px);
}
h2 {
  font-size: 24px;
  font-weight: 500;
  margin: 0 0 6px;
}
p {
  margin: 0 0 20px;
  color: #746660;
}
.field {
  display: block;
  margin: 22px 0;
}
label {
  cursor: pointer;
}
input,
button {
  font: inherit;
}
input[type="text"] {
  box-sizing: border-box;
  width: 145px;
  border: 1px solid #ab8e86;
  border-radius: 12px;
  background: transparent;
  color: inherit;
  padding: 10px 12px;
  text-transform: lowercase;
}
input[type="color"] {
  width: 48px;
  height: 44px;
  border: 0;
  background: transparent;
  border-radius: 12px;
  vertical-align: middle;
  cursor: pointer;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin: 18px 0;
}
.hint {
  font-size: 12px;
  display: block;
  color: #746660;
  margin-top: 4px;
}
fieldset {
  padding: 0;
  border: 0;
  margin: 22px 0;
}
legend {
  padding: 0;
  margin-bottom: 12px;
}
.segments {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border: 1px solid #ab8e86;
  border-radius: 24px;
  overflow: hidden;
}
.segments label {
  padding: 12px;
  text-align: center;
}
.segments label:has(input:checked) {
  background: #eed8d3;
}
.segments input {
  accent-color: #765047;
}
input[type="checkbox"] {
  appearance: none;
  width: 44px;
  height: 26px;
  border: 1px solid #ab8e86;
  border-radius: 16px;
  position: relative;
  flex: 0 0 auto;
  background: #eee4e1;
  cursor: pointer;
}
input[type="checkbox"]:before {
  content: "";
  position: absolute;
  width: 18px;
  height: 18px;
  top: 3px;
  left: 3px;
  border-radius: 50%;
  background: #746660;
  transition: transform 0.18s;
}
input[type="checkbox"]:checked {
  background: #765047;
  border-color: #765047;
}
input[type="checkbox"]:checked:before {
  background: #fff;
  transform: translateX(18px);
}
.buttons {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 22px;
}
button {
  border: 0;
  border-radius: 22px;
  padding: 10px 18px;
  background: #f9ebe9;
  color: #4f3530;
  cursor: pointer;
}
button.primary {
  background: #765047;
  color: #fff;
}
.reset {
  margin-right: auto;
  background: transparent;
  padding-left: 0;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
:focus-visible {
  outline: 2px solid #765047;
  outline-offset: 3px;
}
.status {
  min-height: 20px;
  font-size: 12px;
  margin: 14px 0 0;
}
@media (prefers-color-scheme: dark) {
  dialog {
    background: #211a18;
    color: #ede0dc;
    border-color: #50413c;
  }
  p,
  .hint {
    color: #cbbab4;
  }
  button {
    background: #493632;
    color: #ede0dc;
  }
  button.primary {
    background: #e6bfb7;
    color: #352c29;
  }
  .segments label:has(input:checked) {
    background: #493632;
  }
  input[type="text"] {
    border-color: #806a62;
  }
}
@media (prefers-reduced-motion: reduce) {
  * {
    transition: none !important;
  }
}
`;
      const dialog = make("dialog");
      dialog.setAttribute("aria-labelledby", "qc-settings-title");
      dialog.lang = "zh-CN";
      const title = make("h2", `${A.name} · 界面设置`);
      title.id = "qc-settings-title";
      const intro = make("p", "设置只应用于本站，修改后自动保存并立即生效。");
      const form = make("form");
      form.noValidate = true;
      const colorGroup = make("div", null, "field"),
        colorLabel = make("label", "主题颜色");
      colorLabel.htmlFor = "qc-color-text";
      const colorRow = make("div", null, "row"),
        picker = make("input"),
        hex = make("input");
      picker.type = "color";
      picker.setAttribute("aria-label", "选择主题颜色");
      hex.type = "text";
      hex.id = "qc-color-text";
      hex.maxLength = 7;
      hex.spellcheck = false;
      hex.autocomplete = "off";
      hex.setAttribute("aria-describedby", "qc-color-hint");
      const colorHint = make("span", "输入 #RRGGBB，默认 #f9ebe9。", "hint");
      colorHint.id = "qc-color-hint";
      colorRow.append(picker, hex);
      colorGroup.append(colorLabel, colorRow, colorHint);
      const fieldset = make("fieldset"),
        legend = make("legend", "搜索结果布局"),
        segments = make("div", null, "segments"),
        radios = [];
      for (const [v, label] of [
        [1, "单列"],
        [2, "双列瀑布流"],
      ]) {
        const l = make("label"),
          input = make("input");
        input.type = "radio";
        input.name = "columns";
        input.value = String(v);
        radios.push(input);
        l.append(input, document.createTextNode(` ${label}`));
        segments.append(l);
      }
      fieldset.append(legend, segments, make("span", "窄屏使用单列；复杂模块保留整行。", "hint"));

      // 创建带有说明和完整点击区域的设置开关。
      function toggle(label, hint) {
        const row = make("label", null, "row"),
          text = make("span", label),
          input = make("input");
        input.type = "checkbox";
        input.setAttribute("role", "switch");
        text.append(make("span", hint, "hint"));
        row.append(text, input);
        form.append(row);
        return input;
      }
      form.append(colorGroup, fieldset);
      const enabledToggle = toggle("启用样式优化", "关闭后恢复本站原生外观。");
      const adsToggle = toggle("隐藏搜索广告", "仅隐藏有明确广告标记的搜索结果。");
      const newTab = toggle("搜索外链新标签打开", "不改写原始地址，不影响分页和站内导航。");
      const auto = toggle("自动拼接", "仅加载可识别的普通网页文字，默认开启。");
      const motion = toggle("轻柔动效", "自动尊重系统“减少动态效果”设置。");
      const status = make("p", null, "status");
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      const actions = make("div", null, "buttons"),
        reset = make("button", "恢复默认", "reset"),
        cancel = make("button", "关闭", "primary");
      reset.type = cancel.type = "button";
      actions.append(reset, cancel);
      form.append(status, actions);
      dialog.append(title, intro, form);
      shadow.append(ui, dialog);
      document.body.append(host);
      panel = host;
      const previous = document.activeElement;

      // 把设置值填入弹窗控件。
      function fill(value) {
        picker.value = hex.value = value.color;
        radios.forEach((r) => (r.checked = Number(r.value) === value.columns));
        enabledToggle.checked = value.enabled;
        adsToggle.checked = value.blockAds !== false;
        newTab.checked = value.newTab;
        auto.checked = value.autoLoad;
        motion.checked = value.motion;
      }

      // 关闭弹窗并恢复先前焦点。
      function close() {
        liveSettings.dispose();
        dialog.close();
        host.remove();
        panel = null;
        if (previous?.isConnected) previous.focus();
      }
      fill(config);
      picker.addEventListener("input", () => {
        hex.value = picker.value;
        hex.removeAttribute("aria-invalid");
      });
      hex.addEventListener("input", () => {
        if (/^#[0-9a-f]{6}$/i.test(hex.value)) picker.value = hex.value;
      });
      cancel.addEventListener("click", requestClose);
      reset.addEventListener("click", () => {
        fill(DEFAULTS);
        liveSettings.schedule(0);
      });
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        requestClose();
      });
      dialog.addEventListener("click", (event) => {
        const r = dialog.getBoundingClientRect();
        if (
          event.target === dialog &&
          (event.clientX < r.left ||
            event.clientX > r.right ||
            event.clientY < r.top ||
            event.clientY > r.bottom)
        )
          requestClose();
      });
      // 只读取完整且有效的颜色，避免输入中间状态进入存储。
      function readDraft() {
        if (!/^#[0-9a-f]{6}$/i.test(hex.value.trim())) {
          status.textContent = "请补全六位颜色，输入完整后自动生效。";
          hex.setAttribute("aria-invalid", "true");
          return null;
        }
        hex.removeAttribute("aria-invalid");
        return normalize({
          ...config,
          enabled: enabledToggle.checked,
          blockAds: adsToggle.checked,
          color: hex.value.trim(),
          columns: Number(radios.find((r) => r.checked)?.value),
          newTab: newTab.checked,
          autoLoad: auto.checked,
          motion: motion.checked,
        });
      }
      // 更新本站独立设置并马上重新扫描现有页面。
      async function saveDraft(value) {
        const persistent = typeof GM_setValue === "function";
        if (persistent) await GM_setValue(`${ID}.settings.v1`, value);
        config = value;
        scan();
        registerMenus();
        return persistent;
      }
      const liveSettings = createLiveSettings(form, readDraft, saveDraft, (message) => {
        status.textContent = message;
      });
      // 关闭前刷新当前有效输入，保留刚刚输入的主题颜色。
      function requestClose() {
        void liveSettings.flush().then(close);
      }
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void liveSettings.flush();
      });
      mountSettingsFrame(dialog, shadow, requestClose);
      dialog.showModal();
      hex.focus();
    }
    // 每个站点只提供一个设置菜单，全部选项统一在弹窗内调整。
    function registerMenus() {
      if (typeof GM_registerMenuCommand !== "function") return;
      if (menus.length && typeof GM_unregisterMenuCommand !== "function") return;
      if (typeof GM_unregisterMenuCommand === "function")
        for (const id of menus.splice(0)) GM_unregisterMenuCommand(id);
      menus.push(GM_registerMenuCommand("界面设置", openSettings));
    }
    const masonry = createMasonryLayout(() => active && config.columns === 2);
    const loader = createLoader();
    // 设置仅通过脚本管理器菜单打开，页面不添加悬浮入口。
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["href"],
    });
    addEventListener("popstate", schedule);
    addEventListener("pageshow", schedule);
    media.addEventListener("change", schedule);
    registerMenus();
    scan();
  })();
}
if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", 启动其他搜索站点, { once: true });
else 启动其他搜索站点();

// 普通结果卡片支持点击空白区域打开主链接，复杂模块保留独立交互。
(() => {
  const selector = ".gqc-card,.qc-card";
  const interactive =
    'a,button,input,textarea,select,summary,[role="button"],[role="menuitem"],[contenteditable="true"]';
  // 仅接管普通卡片的非交互空白区域，不改写原始目标地址。
  function openCard(event) {
    if (
      event.defaultPrevented ||
      (event.type === "keydown" && event.key !== "Enter") ||
      (event.type === "click" && event.button !== 0)
    )
      return;
    if (
      document.documentElement.dataset.gqcActive !== "true" &&
      document.documentElement.dataset.qcActive !== "true"
    )
      return;
    const target = event.target instanceof Element ? event.target : null;
    const card = target?.closest(selector);
    if (!card || target.closest(interactive) || window.getSelection()?.toString().trim()) return;
    if (event.type === "keydown" && target !== card) return;
    const heading = card.querySelector("h3,h2");
    const link = heading?.closest("a[href]") || heading?.querySelector("a[href]");
    if (!link || !/^https?:/.test(link.href)) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.type === "auxclick")
      window.open(link.href, "_blank", "noopener");
    else link.click();
  }
  document.addEventListener("click", openCard);
  document.addEventListener("auxclick", (event) => {
    if (event.button === 1) openCard(event);
  });
  document.addEventListener("keydown", openCard);
  const style = document.createElement("style");
  style.textContent = `
      html[data-gqc-active="true"] .gqc-card,
      html[data-qc-active="true"] .qc-card {
        cursor: pointer;
      }
      html[data-qc-active="true"] .qc-card :is(h2,h3) a:hover {
        text-decoration-thickness: 1px;
        text-underline-offset: 4px;
      }
    `;
  (document.head || document.documentElement)?.append(style);
})();

// 广告过滤独立实现，仅依据明确的广告标记隐藏容器，不删除原生节点。
(() => {
  const engines = [
    {
      hosts: /^(?:www\.)?google\.(?:com|[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/i,
      path: "/search",
      selectors: [
        "#tads",
        "#tadsb",
        "#bottomads",
        ".uEierd",
        "[data-text-ad]",
        'div[aria-label="广告"]',
        'div[aria-label="Ads"]',
        'div[aria-label="Sponsored"]',
      ],
    },
    {
      hosts: /^(?:www|www1)\.baidu\.com$/i,
      path: "/s",
      selectors: [
        "#content_left .EC_result",
        "#content_left [data-tuiguang]",
        "#content_right [data-tuiguang]",
        "#content_left .ec-tuiguang",
        "#content_left .ec_tuiguang_pp",
      ],
    },
    {
      hosts: /^(?:www|cn)\.bing\.com$/i,
      path: "/search",
      selectors: [
        "#b_results .b_ad",
        "#b_context .b_ad",
        "#b_results .ad_fls",
        "#b_results [data-text-ad]",
      ],
    },
    {
      hosts: /^www\.sogou\.com$/i,
      path: "/web",
      selectors: [
        ".results [data-tuiguang]",
        ".results [data-text-ad]",
        ".results .vrwrap.advr",
        '[id^="sogouad"]',
        '[id^="sogou-ads"]',
        ".results .ec_ad_results",
      ],
    },
  ];
  const engine = engines.find(
    (rule) => rule.hosts.test(location.hostname) && rule.path === location.pathname,
  );
  if (!engine || window.top !== window.self) return;
  let timer = 0;
  const marked = new Set();
  const scopeSelector =
    "#rso,#tads,#tadsb,#bottomads,#content_left,#content_right,#b_results,#b_context,.results";
  const resultSelector =
    ".EC_result,.c-container,.result,.result-op,li.b_ad,li.b_algo,.vrwrap,.rb,[data-text-ad]";
  // 将广告标签定位到对应结果容器，严禁提升到整个结果区或地图模块。
  function adContainer(marker) {
    const container = marker.closest(resultSelector);
    if (
      container &&
      !container.matches(scopeSelector) &&
      !container.matches(".gqc-questions,.gqc-local")
    )
      return container;
    return marker;
  }
  // 复查明确广告标记，普通正文中包含“广告”一词不会触发过滤。
  function scanAds() {
    timer = 0;
    if (document.documentElement.dataset.qcAds !== "true") return;
    const current = new Set();
    for (const selector of engine.selectors) {
      for (const marker of document.querySelectorAll(selector)) {
        if (
          marker.hasAttribute("data-tuiguang") &&
          ["0", "false"].includes(marker.getAttribute("data-tuiguang"))
        )
          continue;
        current.add(adContainer(marker));
      }
    }
    let changed = false;
    for (const node of marked) {
      if (!node.isConnected || !current.has(node)) {
        node.classList.remove("qc-ad-hidden");
        marked.delete(node);
        changed = true;
      }
    }
    for (const node of current) {
      if (
        node.matches("#rso,#content_left,#content_right,#b_results,#b_context,.results,body,html")
      )
        continue;
      if (!node.classList.contains("qc-ad-hidden")) {
        node.classList.add("qc-ad-hidden");
        changed = true;
      }
      marked.add(node);
    }
    if (changed) dispatchEvent(new Event("resize"));
  }
  // 合并异步插入广告的连续变化，避免反复遍历整页。
  function scheduleAds() {
    if (!timer) timer = setTimeout(scanAds, 120);
  }
  // 样式只在广告过滤开启时生效，关闭选项即可还原原生内容。
  function startAds() {
    const style = document.createElement("style");
    style.textContent = `
      html[data-qc-ads="true"] .qc-ad-hidden {
        display:none!important;
      }
    `;
    (document.head || document.documentElement).append(style);
    const observer = new MutationObserver(scheduleAds);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-tuiguang", "data-text-ad", "aria-label"],
    });
    const settingsObserver = new MutationObserver(scheduleAds);
    settingsObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-qc-ads"],
    });
    scheduleAds();
  }
  if (document.documentElement) startAds();
  else document.addEventListener("DOMContentLoaded", startAds, { once: true });
})();

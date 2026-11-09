const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../search-quiet-cards.user.js'), 'utf8');
const start = source.indexOf('  function isSearchEntry()');
const end = source.indexOf('  // 搜索适配器延迟', start);

// 用可控的原生事件模拟首页同文档切换，直接运行实际启动函数。
function setup(platform, path) {
  let mutations, interval, starts = 0, registrations = 0, removals = 0, disconnected = 0;
  const events = new Map();
  const context = vm.createContext({
    currentPlatform: platform,
    platformPanel: null,
    location: { pathname: path },
    openPlatformSettings() {},
    GM_registerMenuCommand() { registrations++; return 123; },
    GM_unregisterMenuCommand(id) { assert.equal(id, 123); removals++; },
    MutationObserver: class {
      constructor(callback) { mutations = callback; }
      observe() {}
      disconnect() { disconnected++; }
    },
    document: {
      addEventListener(name, callback) { events.set(name, callback); },
      removeEventListener(name) { events.delete(name); },
    },
    window: {
      addEventListener(name, callback) { events.set(name, callback); },
      removeEventListener(name) { events.delete(name); },
    },
    setInterval(callback) { interval = callback; return 1; },
    clearInterval() { interval = null; },
  });
  vm.runInContext(source.slice(start, end), context);
  context.watchSearchEntry(() => starts++);
  return { context, events, mutate: () => mutations?.(), tick: () => interval?.(), values: () => ({ starts, registrations, removals, disconnected, polling: !!interval }) };
}

for (const [platform, path] of Object.entries({ google: '/search', baidu: '/s', bing: '/search', sogou: '/web' })) {
  test(`${platform}首页保持待命，同文档搜索只启动一次并撤销等待器`, () => {
    const runtime = setup(platform, '/');
    assert.equal(runtime.values().starts, 0);
    runtime.context.location.pathname = path;
    runtime.mutate(); runtime.mutate(); runtime.tick();
    assert.deepEqual(runtime.values(), { starts: 1, registrations: 1, removals: 1, disconnected: 1, polling: false });
    assert.equal(runtime.events.size, 0);
  });
}

test('只有地址变化但没有DOM事件时也会启动', () => {
  const runtime = setup('baidu', '/');
  runtime.context.location.pathname = '/s';
  runtime.tick();
  assert.equal(runtime.values().starts, 1);
});

test('直接打开结果页立即启动，不注册临时菜单或轮询', () => {
  const runtime = setup('baidu', '/s');
  assert.deepEqual(runtime.values(), { starts: 1, registrations: 0, removals: 0, disconnected: 0, polling: false });
});

test('首页匹配规则覆盖根域名和带参数首页，排除其他栏目', () => {
  const includes = [...source.matchAll(/^\/\/ @include\s+(\/.*\/)$/gm)].map(match => vm.runInNewContext(match[1]));
  for (const url of ['https://baidu.com/', 'https://www.baidu.com/?tn=baidu', 'https://www.sogou.com/', 'https://www.bing.com/?mkt=zh-CN', 'https://www.google.co.jp/']) {
    assert.ok(includes.some(pattern => pattern.test(url)), url);
  }
  assert.ok(!includes.some(pattern => pattern.test('https://www.baidu.com/other')));
});

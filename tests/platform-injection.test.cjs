const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'search-quiet-cards.user.js'), 'utf8');

// 关闭的平台运行完整源码时，任何页面访问都会立即失败，防止残留初始化漏过入口。
function runDisabled(hostname, platform) {
  const menus = [];
  const window = {};
  window.top = window.self = window;
  let pageReads = 0;
  let reloads = 0, listener;
  const context = {
    window,
    location: { hostname, pathname: '/search', reload: () => reloads++ },
    GM_addValueChangeListener: (_key, callback) => { listener = callback; },
    GM_getValue: (key) => key === 'quiet-search.platforms.v1' ? { [platform]: false } : undefined,
    GM_registerMenuCommand: (label, callback) => menus.push({ label, callback }),
  };
  Object.defineProperty(context, 'document', { get() {
    pageReads++;
    throw new Error('禁用平台不应访问页面');
  } });
  vm.runInNewContext(source, context, { timeout: 1000 });
  return { menus, pageReads, change: (previous, next, remote) => listener("quiet-search.platforms.v1", previous, next, remote), reloads: () => reloads };
}

for (const [hostname, platform] of [
  ['www.google.com', 'google'], ['www.google.co.jp', 'google'],
  ['www.baidu.com', 'baidu'], ['www1.baidu.com', 'baidu'],
  ['www.bing.com', 'bing'], ['cn.bing.com', 'bing'], ['www.sogou.com', 'sogou'],
]) {
  test(`${hostname}关闭注入时不访问DOM、不启动功能，仅注册设置菜单`, () => {
    const result = runDisabled(hostname, platform);
    assert.equal(result.pageReads, 0);
    assert.equal(result.menus.length, 1);
    assert.equal(result.menus[0].label, '界面设置');
    assert.equal(typeof result.menus[0].callback, 'function');
  });
}

test('其他标签页重新开启当前平台时会刷新', () => {
  const result = runDisabled('www.baidu.com', 'baidu');
  result.change({ baidu: false }, { baidu: true }, true);
  assert.equal(result.reloads(), 1);
});

test('其他平台开关变化不刷新当前平台', () => {
  const result = runDisabled('www.baidu.com', 'baidu');
  result.change({ baidu: false, bing: true }, { baidu: false, bing: false }, true);
  assert.equal(result.reloads(), 0);
});

test('本地保存回调不重复触发刷新', () => {
  const result = runDisabled('www.baidu.com', 'baidu');
  result.change({ baidu: false }, { baidu: true }, false);
  assert.equal(result.reloads(), 0);
});

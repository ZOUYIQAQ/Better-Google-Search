const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../search-quiet-cards.user.js'), 'utf8');
const start = source.indexOf('  function hideInlineAd(');
const end = source.indexOf('  const scopeSelector', start);

// 模拟原生行内优先级，验证覆盖、网页更新以及撤销的边界。
function setup(value = 'block', priority = 'important') {
  const values = new Map([['display', [value, priority]]]);
  const node = { style: {
    getPropertyValue(name) { return values.get(name)?.[0] || ''; },
    getPropertyPriority(name) { return values.get(name)?.[1] || ''; },
    setProperty(name, next, importance) { values.set(name, [next, importance]); },
  } };
  const context = vm.createContext({ inlineAds: new Map() });
  vm.runInContext(source.slice(start, end), context);
  return { node, context };
}

test('广告行内强制显示被覆盖，关闭时恢复原值且不覆盖网页新值', () => {
  const { node, context } = setup();
  assert.equal(context.hideInlineAd(node), true);
  assert.equal(node.style.getPropertyValue('display'), 'none');
  context.hideInlineAd(node);
  context.restoreInlineAd(node);
  assert.equal(node.style.getPropertyValue('display'), 'block');
  context.hideInlineAd(node);
  node.style.setProperty('display', 'grid', 'important');
  context.restoreInlineAd(node);
  assert.equal(node.style.getPropertyValue('display'), 'grid');
});

test('普通行内样式和原生隐藏状态不改写', () => {
  for (const [value, priority] of [['block', ''], ['none', 'important']]) {
    const { node, context } = setup(value, priority);
    assert.equal(context.hideInlineAd(node), false);
    assert.equal(node.style.getPropertyValue('display'), value);
  }
});

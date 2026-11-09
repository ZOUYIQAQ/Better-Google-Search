const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../search-quiet-cards.user.js'), 'utf8');
const start = source.indexOf('    function masonryColumn(');
const end = source.indexOf('    // 管理双列布局', start);
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);

test('跨行占位变成普通卡片后才选择列位，不能全部锁在左列', () => {
  const columns = new WeakMap();
  const first = {}, second = {}, third = {};
  for (const node of [first, second, third]) {
    context.masonryColumn(node, true, [0, 0], columns);
    assert.equal(columns.has(node), false);
  }
  assert.equal(context.masonryColumn(first, false, [0, 0], columns), 0);
  assert.equal(context.masonryColumn(second, false, [200, 0], columns), 1);
  assert.equal(context.masonryColumn(third, false, [200, 300], columns), 0);
});

test('已分列卡片在后续加载时保持列位，跨行后重新按高度选择', () => {
  const columns = new WeakMap(), node = {};
  assert.equal(context.masonryColumn(node, false, [300, 100], columns), 1);
  assert.equal(context.masonryColumn(node, false, [0, 900], columns), 1);
  context.masonryColumn(node, true, [0, 900], columns);
  assert.equal(context.masonryColumn(node, false, [0, 900], columns), 0);
});

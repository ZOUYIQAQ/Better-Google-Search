const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../search-quiet-cards.user.js'), 'utf8');
const base = source.indexOf('    function createMasonryLayout(canRun, options = {}) {', source.indexOf('function masonryColumn'));

// 提取实际布局样式函数，用禁止误写的原生样式桩检查广告规则兼容边界。
function harness(namespace = 'baidu') {
  const appended = [];
  const head = { append(node) { node.isConnected = true; appended.push(node); } };
  const context = vm.createContext({
    A: { namespace }, ID: 'qc-' + namespace, root: head,
    document: { head, createElement() { return { textContent: '', isConnected: false }; } },
  });
  const functions = [
    ['flushLayoutSheet', '\n      const enabled'],
    ['own', '\n      // 恢复脚本改写'],
    ['restore', '\n      // 记录节点样式'],
    ['record', '\n      // 遍历结果分组'],
  ].map(([name, marker]) => {
    const start = source.indexOf('      function ' + name + '(', base);
    return source.slice(start, source.indexOf(marker, start));
  }).join('\n');
  vm.runInContext('const sheetItems = new Set(); let layoutSheet = null; let layoutSequence = 0;\n' + functions, context);
  return { context, appended };
}

// 保留网页原有样式并统计写入次数，模拟真实结果节点。
function nativeNode(parentId, initial = {}) {
  const attributes = new Map(), values = new Map(Object.entries(initial));
  const writes = [];
  return {
    parentElement: { id: parentId }, isConnected: true, attributes, writes,
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    style: {
      getPropertyValue(name) { return values.get(name)?.[0] || ''; },
      getPropertyPriority(name) { return values.get(name)?.[1] || ''; },
      setProperty(name, value, priority) { writes.push(name); values.set(name, [value, priority]); },
      removeProperty(name) { writes.push(name); values.delete(name); },
    },
  };
}

test('百度结果双列样式不写入行内important，避免触发AdGuard中文规则', () => {
  const { context, appended } = harness(), node = nativeNode('content_left');
  const record = context.record(node);
  context.own(record, 'position', 'absolute');
  context.own(record, 'width', '590px');
  context.own(record, 'left', '610px');
  context.flushLayoutSheet();
  assert.equal(node.writes.length, 0);
  assert.equal(node.getAttribute('style'), null);
  assert.match(appended[0].textContent, /position: absolute !important/);
  assert.match(appended[0].textContent, /data-qc-layout="m1"/);
});

test('退出双列只撤销自有规则，保留网页原始行内样式和标记', () => {
  const { context, appended } = harness(), node = nativeNode('content_left', { color: ['red', ''] });
  node.setAttribute('data-qc-layout', 'native-marker');
  const record = context.record(node);
  context.own(record, 'top', '200px');context.flushLayoutSheet();
  context.restore(record);context.flushLayoutSheet();
  assert.equal(node.getAttribute('data-qc-layout'), 'native-marker');
  assert.equal(node.style.getPropertyValue('color'), 'red');
  assert.equal(node.writes.length, 0);
  assert.equal(appended[0].textContent, '');
});

test('百度容器及其他平台沿用可恢复的行内布局，不扩大兼容修改范围', () => {
  for (const [namespace, parent] of [['baidu', 'container'], ['bing', 'b_results']]) {
    const { context } = harness(namespace), node = nativeNode(parent, { width: ['640px', ''] });
    const record = context.record(node);
    context.own(record, 'width', '1200px');
    assert.equal(node.style.getPropertyValue('width'), '1200px');
    context.restore(record);
    assert.equal(node.style.getPropertyValue('width'), '640px');
    assert.equal(node.style.getPropertyPriority('width'), '');
  }
});

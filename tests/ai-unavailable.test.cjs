const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'search-quiet-cards.user.js'), 'utf8');
// 从实际源码提取同步函数，覆盖失败提示、隐藏历史提示与恢复状态。
function syncFor(visible) {
  const start = source.indexOf('  function syncAiPreview(module) {');
  const end = source.indexOf('  // 按语义标题识别AI概览', start);
  return vm.runInNewContext(source.slice(start, end) + '\nsyncAiPreview', {
    nativeContentVisible: () => visible,
    mark: (node, name) => node.classes.add(name),
    unmark: (node, name) => node.classes.delete(name),
  });
}
// 模拟失败通知所在模块，不引入与本次判断无关的展开交互。
function moduleFor(text) {
  return { classes: new Set(['gqc-ai-pending', 'gqc-user-expanded']),
    querySelectorAll: () => [{children: [], textContent: text}], querySelector: () => null };
}
test('AI 摘要失败后收缩，并撤销生成及展开占位；恢复后可重新生成', () => {
  for (const text of ['无法针对此搜索生成 AI 概览', '目前无法生成 AI 概要。请稍后重试。', '目前无法生成 AI 摘要。请稍后重试。', 'AI Overview is unavailable']) {
    const module = moduleFor(text);
    const sync = syncFor(true);
    sync(module);
    assert.ok(module.classes.has('gqc-ai-unavailable'));
    assert.ok(!module.classes.has('gqc-ai-pending'));
    module.querySelectorAll = () => [];
    sync(module);
    assert.ok(!module.classes.has('gqc-ai-unavailable'));
  }
});
test('隐藏失败提示及普通回答不触发收缩', () => {
  const hidden = moduleFor('目前无法生成 AI 摘要。请稍后重试。');
  syncFor(false)(hidden);
  assert.ok(!hidden.classes.has('gqc-ai-unavailable'));
  const normal = moduleFor('OpenRouter 是一个模型路由平台。');
  syncFor(true)(normal);
  assert.ok(!normal.classes.has('gqc-ai-unavailable'));
});

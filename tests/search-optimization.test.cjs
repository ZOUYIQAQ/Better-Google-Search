const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../search-quiet-cards.user.js'), 'utf8');
const start = source.indexOf('  function safeDestination(');
const end = source.indexOf('  // 设置中提供独立开关', start);
const context = vm.createContext({ URL, TextDecoder, Uint8Array, atob, location: { href: 'https://www.google.com/search?q=测试' } });
vm.runInContext(source.slice(start, end), context);

test('直达解析拒绝危险协议、口令、占位网址和加密参数', () => {
  for (const value of ['javascript:alert(1)', 'https://user:secret@example.com', 'http://nourl.ubs.baidu.com/1', null]) {
    assert.equal(context.safeDestination(value), null);
  }
  assert.equal(context.decodeSearchDestination('https://www.sogou.com/link?url=encrypted'), null);
  assert.equal(context.decodeSearchDestination('https://www.bing.com/aclick?u=a1aHR0cHM6Ly9leGFtcGxlLmNvbQ'), null);
});

test('谷歌参数与必应编码保留完整目标网址和中文查询', () => {
  const destination = 'https://example.com/搜索?q=飞书&signature=a%2Bb';
  const expected = new URL(destination).href;
  assert.equal(context.decodeSearchDestination('https://www.google.com/url?q=' + encodeURIComponent(destination)), expected);
  assert.equal(context.decodeSearchDestination('https://www.bing.com/ck/a?u=a1' + Buffer.from(destination).toString('base64url')), expected);
  assert.equal(context.decodeSearchDestination('https://evil.example/url?q=' + encodeURIComponent(destination)), null);
  assert.equal(context.decodeSearchDestination('https://www.bing.com/ck/a?u=a1!invalid'), null);
});

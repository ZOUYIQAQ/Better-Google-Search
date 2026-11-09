const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(
  path.join(__dirname, "..", "search-quiet-cards.user.js"),
  "utf8",
);

// 从实际发布源码提取分页校验，避免另写一份逻辑掩盖回归。
function signatureFor(engine) {
  const start = source.indexOf("    function signature(url)");
  const end = source.indexOf("    // 解析并校验分页偏移量。", start);
  const queryStart = source.indexOf("    function query(url)");
  const queryEnd = source.indexOf(
    "    // 检查当前地址是否属于支持的网页搜索。",
    queryStart,
  );
  return vm.runInNewContext(
    `${source.slice(queryStart, queryEnd)}\n${source.slice(start, end)}\nsignature`,
    { A: engine },
  );
}

test("百度空统计参数不阻止合法下一页", () => {
  const signature = signatureFor({ namespace: "baidu", page: "pn", query: ["wd", "word"] });
  assert.equal(
    signature(new URL("https://www.baidu.com/s?wd=北京&f=8&tn=baidu&rqlang=cn")),
    signature(
      new URL(
        "https://www.baidu.com/s?wd=北京&pn=10&topic_pn=&rsv_page=1&usm=6",
      ),
    ),
  );
});

test("必应跳转和追踪字段不阻止合法下一页", () => {
  const signature = signatureFor({ page: "first", query: ["q"] });
  assert.equal(
    signature(
      new URL("https://www.bing.com/search?q=Python+asyncio&rdr=1&rdrig=one"),
    ),
    signature(
      new URL(
        "https://www.bing.com/search?q=Python+asyncio&first=11&FPIG=two&FORM=PORE",
      ),
    ),
  );
});

test("真实筛选条件和搜索词变化仍必须拒绝拼接", () => {
  const signature = signatureFor({ page: "first", query: ["q"] });
  const initial = signature(
    new URL("https://www.bing.com/search?q=Python&filters=site:python.org"),
  );
  assert.notEqual(
    initial,
    signature(new URL("https://www.bing.com/search?q=Python&first=11")),
  );
  assert.notEqual(
    initial,
    signature(
      new URL("https://www.bing.com/search?q=Java&filters=site:python.org"),
    ),
  );
});

test("搜狗时间筛选不会被统计参数规则误忽略", () => {
  const signature = signatureFor({ page: "page", query: ["query", "keyword"] });
  assert.notEqual(
    signature(new URL("https://www.sogou.com/web?query=天气&tsn=1")),
    signature(new URL("https://www.sogou.com/web?query=天气&tsn=2&page=2")),
  );
});

// 使用实页中不同的图片徽标，验证广告与普通网页标签不会混淆。
function imageAdDetector() {
  const start = source.indexOf("  function hasBingImageAd(node)");
  const end = source.indexOf("  // 复查明确广告标记", start);
  return vm.runInNewContext(`${source.slice(start, end)}\nhasBingImageAd`, {
    getComputedStyle: (paragraph) => ({ content: paragraph.before }),
  });
}

test("必应图片广告徽标会被识别，普通网页徽标保留", () => {
  const badges = JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures/bing-badges.json"), "utf8"),
  );
  const detect = imageAdDetector();
  assert.equal(
    detect({ querySelectorAll: () => [{ before: badges.ad }] }),
    true,
  );
  assert.equal(
    detect({ querySelectorAll: () => [{ before: badges.organic }] }),
    false,
  );
  assert.equal(
    detect({
      querySelectorAll: () => [{ before: "none", textContent: "广告研究文章" }],
    }),
    false,
  );
});

// 直接运行三站加载器的边界检查，模拟快速滚过加载条的真实场景。
function bottomCheck(box, goingDown = true) {
  const start = source.indexOf('      function checkBottom()');
  const end = source.indexOf('      addEventListener(', start);
  return vm.runInNewContext(`(() => {
    let frame = 0, calls = 0;
    const goingDown = ${goingDown};
    const s = { loading: false, paused: false, next: {}, controls: { getBoundingClientRect: () => box } };
    const queue = [];
    const requestAnimationFrame = (callback) => { queue.push(callback); return 1; };
    const live = () => true;
    const load = () => calls++;
    ${source.slice(start, end)}
    checkBottom();
    queue.forEach(callback => callback());
    return calls;
  })()`, { box, document: { hidden: false }, innerHeight: 1000 });
}

test('三站快速滚过加载条后仍自动续页', () => {
  assert.equal(bottomCheck({ top: -120, bottom: -70, width: 820 }), 1);
});

test('尚未接近结果底部时不提前续页', () => {
  assert.equal(bottomCheck({ top: 2200, bottom: 2250, width: 820 }), 0);
});

test('向上滚动不触发三站自动续页', () => {
  assert.equal(bottomCheck({ top: -120, bottom: -70, width: 820 }, false), 0);
});

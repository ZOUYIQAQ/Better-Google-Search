const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

// 使用真实函数源码建立事件环境，验证重排和滚动边界的时序。
function setup() {
  const source = fs.readFileSync(path.join(__dirname, "../search-quiet-cards.user.js"), "utf8");
  const begin = source.indexOf("  function createDirectionalPrefetch(");
  const end = source.indexOf("  // 只有用户主动展开主AI", begin);
  const events = new Map();
  const frames = new Map();
  let nextFrame = 0;
  let loads = 0;
  let allowed = true;
  // 保存窗口和文档监听器，以便复现浏览器事件顺序。
  function addEventListener(name, listener) {
    if (!events.has(name)) events.set(name, new Set());
    events.get(name).add(listener);
  }
  // 移除指定监听器，确保关闭功能后不继续翻页。
  function removeEventListener(name, listener) {
    events.get(name)?.delete(listener);
  }
  const context = {
    scrollY: 1000,
    innerHeight: 1000,
    document: {
      hidden: false,
      scrollingElement: { scrollHeight: 2000 },
      addEventListener,
      removeEventListener,
    },
    addEventListener,
    removeEventListener,
    requestAnimationFrame(callback) {
      frames.set(++nextFrame, callback);
      return nextFrame;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(begin, end), context);
  const prefetch = context.createDirectionalPrefetch(
    () => allowed,
    () => loads++,
    () => ({
      isConnected: true,
      getBoundingClientRect: () => ({ top: 970, bottom: 1020, width: 400 }),
    }),
  );
  // 同步发送事件，随后由测试显式推进下一绘制帧。
  function emit(name, event = {}) {
    for (const listener of events.get(name) || []) listener(event);
  }
  // 模拟浏览器推进一帧，不递归执行本帧中新安排的任务。
  function flush() {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback();
  }
  prefetch.start();
  return {
    prefetch,
    emit,
    flush,
    context,
    count: () => loads,
    allow: (value) => {
      allowed = value;
    },
  };
}

// 初始化或无用户意图的重排不能自动翻页。
test("首次加载和空重排不主动翻页", () => {
  const s = setup();
  s.emit("gqc:masonry-settled");
  s.flush();
  assert.equal(s.count(), 0);
});

// 已在页面底部时，继续向下滚轮也能触发翻页。
test("底部没有scroll事件仍可通过向下滚轮加载", () => {
  const s = setup();
  s.emit("wheel", { deltaY: 120, deltaX: 0 });
  s.flush();
  assert.equal(s.count(), 1);
});

// 加载中或重排期间的阅读意图不能被坐标基线刷新吞掉。
test("暂时不可加载时保留意图，重排完成后无需再次滚动", () => {
  const s = setup();
  s.allow(false);
  s.emit("wheel", { deltaY: 120, deltaX: 0 });
  s.flush();
  s.emit("gqc:masonry-settled");
  s.flush();
  assert.equal(s.count(), 0);
  s.allow(true);
  s.emit("gqc:masonry-settled");
  s.flush();
  assert.equal(s.count(), 1);
  s.emit("gqc:masonry-settled");
  s.flush();
  assert.equal(s.count(), 1);
});

// 用户改变方向后，不再因为旧的向下意图预加载。
test("向上滚动取消待处理的向下意图", () => {
  const s = setup();
  s.allow(false);
  s.emit("wheel", { deltaY: 120, deltaX: 0 });
  s.flush();
  s.emit("wheel", { deltaY: -120, deltaX: 0 });
  s.allow(true);
  s.emit("gqc:masonry-settled");
  s.flush();
  assert.equal(s.count(), 0);
});

// 停止时移除新增监听，避免关闭后隐式请求。
test("停止后滚轮及布局事件都不再加载", () => {
  const s = setup();
  s.prefetch.stop();
  s.emit("wheel", { deltaY: 120, deltaX: 0 });
  s.emit("gqc:masonry-settled");
  s.flush();
  assert.equal(s.count(), 0);
});

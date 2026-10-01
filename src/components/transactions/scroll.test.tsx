import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  pretendToBeVisual: true,
  url: "http://127.0.0.1/",
});

const window = dom.window;
Object.assign(globalThis, {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  Node: window.Node,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  IS_REACT_ACT_ENVIRONMENT: true,
});

window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
  const height = this.getAttribute("data-testid") === "txn-scroll" ? 600 : 36;
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 800,
    bottom: height,
    width: 800,
    height,
    toJSON() {
      return {};
    },
  };
};
Object.defineProperty(window.HTMLElement.prototype, "clientHeight", {
  configurable: true,
  get() {
    return this.getAttribute("data-testid") === "txn-scroll" ? 600 : 36;
  },
});
Object.defineProperty(window.HTMLElement.prototype, "clientWidth", {
  configurable: true,
  get() {
    return 800;
  },
});
Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get() {
    return this.getAttribute("data-row") == null && this.getAttribute("data-testid") === "txn-scroll" ? 600 : 36;
  },
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserverStub;
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;

const ROW_COUNT = 50_000;
const ROW_HEIGHT = 36;

test("the transactions grid mounts a window while scrolling 50,000 rows", async () => {
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { createElement } = await import("react");
  const { VirtualGrid } = await import("./virtual-grid");

  const root = createRoot(document.getElementById("root")!);
  await act(async () => {
    root.render(
      createElement(VirtualGrid, {
        count: ROW_COUNT,
        estimateSize: () => ROW_HEIGHT,
        renderItem: (item: { index: number }) => createElement("span", null, `row ${item.index}`),
      }),
    );
  });

  const scroller = document.querySelector("[data-testid='txn-scroll']") as HTMLElement;
  const totalSize = Number(scroller.getAttribute("data-total-size"));
  assert.equal(totalSize, ROW_COUNT * ROW_HEIGHT);

  const mounted = () => [...document.querySelectorAll("[data-row]")].map((node) => Number(node.getAttribute("data-row")));
  const top = mounted();
  assert.ok(top.length > 0 && top.length < 80, `top window mounted ${top.length} rows`);
  assert.ok(Math.max(...top) < 100);

  scroller.scrollTop = (ROW_COUNT - 30) * ROW_HEIGHT;
  await act(async () => {
    scroller.dispatchEvent(new window.Event("scroll"));
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  const bottom = mounted();
  assert.ok(bottom.length > 0 && bottom.length < 80, `bottom window mounted ${bottom.length} rows`);
  assert.ok(Math.max(...bottom) > ROW_COUNT - 40, `expected a row near the end, saw ${Math.max(...bottom)}`);
  root.unmount();
});

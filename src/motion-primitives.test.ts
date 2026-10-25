import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  animate,
  buttonFeedback,
  copyText,
  createSpring,
  fromButton,
  textDifference,
} from "./motion-primitives";
import { MotionButton, MotionPresence } from "./Motion";
import SegmentedControl from "./SegmentedControl";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function frames() {
  let time = 0,
    id = 0,
    reduce = false;
  const queued = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("window", {
    matchMedia: () => ({ matches: reduce, addEventListener() {} }),
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queued.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => queued.delete(key));
  vi.spyOn(performance, "now").mockImplementation(() => time);
  return {
    queued,
    reduce: () => {
      reduce = true;
    },
    advance(ms = 16) {
      time += ms;
      const current = [...queued.values()];
      queued.clear();
      current.forEach((callback) => callback(time));
    },
  };
}

describe("motion lifecycle and real outcomes", () => {
  it("retargets a spring continuously, settles exactly and cancels its frame on disposal", () => {
    const clock = frames(),
      spring = createSpring(0),
      updates: number[] = [];
    spring.subscribe((value) => updates.push(value));
    spring.set(100);
    clock.advance();
    expect(spring.getValue()).toBeGreaterThan(0);
    expect(spring.getValue()).toBeLessThan(100);
    const before = spring.getValue();
    spring.set(-30);
    expect(spring.getValue()).toBe(before);
    for (let i = 0; i < 240 && clock.queued.size; i++) clock.advance();
    expect(spring.getValue()).toBe(-30);
    expect(clock.queued.size).toBe(0);
    spring.set(80);
    spring.stop();
    expect(clock.queued.size).toBe(0);
    expect(updates.every(Number.isFinite)).toBe(true);
  });
  it("bounds delayed frames and immediately completes when reduced motion is enabled mid-flight", () => {
    const clock = frames(),
      spring = createSpring(15);
    spring.set(400);
    clock.advance(10000);
    expect(Number.isFinite(spring.getValue())).toBe(true);
    clock.reduce();
    clock.advance();
    expect(spring.getValue()).toBe(400);
    expect(clock.queued.size).toBe(0);
    spring.set(12);
    expect(spring.getValue()).toBe(12);
    expect(clock.queued.size).toBe(0);
  });
  it("does not animate detached elements or create a delayed reduced-motion state", () => {
    const clock = frames(),
      method = vi.fn();
    expect(
      animate(
        { isConnected: false, animate: method } as unknown as Element,
        [],
      ),
    ).toBeUndefined();
    clock.reduce();
    expect(
      animate({ isConnected: true, animate: method } as unknown as Element, []),
    ).toBeUndefined();
    expect(method).not.toHaveBeenCalled();
  });
  it("reports clipboard success only after the real write resolves, and propagates failures", async () => {
    class Button extends EventTarget {
      isConnected = true;
    }
    vi.stubGlobal("HTMLButtonElement", Button);
    vi.stubGlobal("document", { activeElement: null });
    const first = new Button(),
      second = new Button(),
      results: boolean[] = [];
    first.addEventListener("motion-copy", (event) =>
      results.push((event as CustomEvent<boolean>).detail),
    );
    second.addEventListener("motion-copy", () => {
      throw new Error("wrong source");
    });
    let resolve!: () => void;
    const write = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    vi.stubGlobal("navigator", { clipboard: { writeText: write } });
    const pending = fromButton(first as unknown as HTMLButtonElement, () =>
      copyText("9007199254740993"),
    );
    fromButton(second as unknown as HTMLButtonElement, () => {});
    expect(results).toEqual([]);
    resolve();
    await pending;
    expect(write).toHaveBeenCalledWith("9007199254740993");
    expect(results).toEqual([true]);
    write.mockRejectedValueOnce(new Error("denied"));
    await expect(
      fromButton(first as unknown as HTMLButtonElement, () =>
        copyText("secret"),
      ),
    ).rejects.toThrow("denied");
    expect(results).toEqual([true, false]);
  });
  it("ties action feedback to the initiating button and ignores completions after it is removed", () => {
    class Button extends EventTarget {
      isConnected = true;
    }
    const button = new Button(),
      states: string[] = [];
    button.addEventListener("motion-action", (event) =>
      states.push((event as CustomEvent<string>).detail),
    );
    const finish = fromButton(
      button as unknown as HTMLButtonElement,
      buttonFeedback,
    );
    expect(states).toEqual(["pending"]);
    finish(false);
    expect(states).toEqual(["pending", "error"]);
    button.isConnected = false;
    finish(true);
    expect(states).toEqual(["pending", "error"]);
  });
  it("keeps Unicode boundaries and shared prefix/suffix during label morphing", () => {
    expect(textDifference("复制 👩结果", "复制 ✅结果")).toEqual({
      prefix: 3,
      suffix: 2,
      removed: ["👩"],
      added: ["✅"],
    });
    expect(textDifference("已复制", "已复制").added).toEqual([]);
  });
  it("preserves rich copy markup, accessible names and a single segmented keyboard entry", () => {
    const rich = renderToStaticMarkup(
      createElement(
        MotionButton,
        { variant: "copy", "aria-label": "复制 HEX" },
        createElement("code", null, "#112233"),
      ),
    );
    expect(rich).toContain("<code>#112233</code>");
    expect(rich).toContain('aria-label="复制 HEX"');
    expect(rich).not.toContain("motion-label-slot");
    const html = renderToStaticMarkup(
      createElement(SegmentedControl, {
        label: "视图",
        value: "a",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "更长的名称" },
        ],
        onChange() {},
      }),
    );
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(1);
    expect(
      renderToStaticMarkup(
        createElement(MotionPresence, { present: false, children: "closed" }),
      ),
    ).toBe("");
  });
  it("measures labels without duplicating their DOM text", () => {
    const html = renderToStaticMarkup(
      createElement(MotionButton, null, "刷新"),
    );
    expect(html).toContain('data-label="刷新"');
    expect(html.replace(/<[^>]*>/g, "")).toBe("刷新");
  });
});

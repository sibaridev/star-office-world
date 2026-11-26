import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const frontendDir = path.join(process.cwd(), "frontend");
const indexHtmlPath = path.join(frontendDir, "index.html");
const electronHtmlPath = path.join(frontendDir, "electron-standalone.html");

test("Frontend Audit: Zero native alert() and confirm() calls anywhere in frontend/", () => {
  const files = fs.readdirSync(frontendDir);
  const patterns = [
    /\bwindow\.alert\s*\(/,
    /\bwindow\.confirm\s*\(/,
    /\bwindow\s*\[\s*['"`]alert['"`]\s*\]\s*\(/,
    /\bwindow\s*\[\s*['"`]confirm['"`]\s*\]\s*\(/,
  ];

  for (const file of files) {
    if (!file.endsWith(".html") && !file.endsWith(".js")) continue;
    if (file.includes("vendor") || file.includes("phaser")) continue;

    const filePath = path.join(frontendDir, file);
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);

    lines.forEach((line, idx) => {
      // Check for native calls
      for (const p of patterns) {
        assert.equal(
          p.test(line),
          false,
          `File ${file}:${idx + 1} contains native call pattern ${p}: ${line.trim()}`
        );
      }

      // Check alert(...) and confirm(...) function invocations (excluding window['alert'] = ... and showConfirmModal)
      if (/\balert\s*\(/.test(line)) {
        assert.fail(`File ${file}:${idx + 1} contains alert(...) call: ${line.trim()}`);
      }
      if (/\bconfirm\s*\(/.test(line)) {
        if (!line.includes("showConfirmModal") && !line.includes("custom-confirm")) {
          assert.fail(`File ${file}:${idx + 1} contains confirm(...) call: ${line.trim()}`);
        }
      }
    });
  }
});

test("Frontend Audit: All showConfirmModal callers in index.html and electron-standalone.html are awaited and handled", () => {
  for (const filePath of [indexHtmlPath, electronHtmlPath]) {
    const filename = path.basename(filePath);
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);

    lines.forEach((line, idx) => {
      if (line.includes("showConfirmModal(") && !line.includes("function showConfirmModal") && !line.includes("window['showConfirmModal']")) {
        const isFallback = line.includes("Prefer await showConfirmModal") || line.includes("showConfirmModal({ message");
        const isAwaited = line.includes("await showConfirmModal");
        assert.ok(
          isFallback || isAwaited,
          `${filename}:${idx + 1} call to showConfirmModal is not awaited: ${line.trim()}`
        );
      }
    });
  }
});

function createMockDOMContext(htmlSource) {
  const toastIdx = htmlSource.indexOf("function showToast(");
  assert.notEqual(toastIdx, -1, "showToast definition found");

  const scriptEndIdx = htmlSource.indexOf("let uiLang =", toastIdx);
  assert.notEqual(scriptEndIdx, -1, "End of dialog definitions found");

  const dialogCode = htmlSource.slice(toastIdx, scriptEndIdx);

  const elementsById = new Map();
  const eventListeners = new Map();

  class MockElement {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.id = "";
      this.className = "";
      this.classList = {
        _classes: new Set(),
        add: (...cls) => cls.forEach(c => this.classList._classes.add(c)),
        remove: (...cls) => cls.forEach(c => this.classList._classes.delete(c)),
        includes: (c) => this.classList._classes.has(c),
        contains: (c) => this.classList._classes.has(c)
      };
      this.attributes = new Map();
      this.style = {};
      this.children = [];
      this.parentNode = null;
      this.textContent = "";
      this.innerHTML = "";
      this.onclick = null;
      this.onmouseenter = null;
      this.onmouseleave = null;
      this.type = "";
    }

    setAttribute(key, value) {
      this.attributes.set(key, String(value));
    }
    getAttribute(key) {
      return this.attributes.get(key) || null;
    }
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      if (child.id) elementsById.set(child.id, child);
      return child;
    }
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    }
    focus() {
      context.document.activeElement = this;
    }
  }

  const body = new MockElement("body");
  const document = {
    body,
    activeElement: null,
    createElement: (tag) => new MockElement(tag),
    getElementById: (id) => elementsById.get(id) || null,
    addEventListener: (event, handler) => {
      if (!eventListeners.has(event)) eventListeners.set(event, []);
      eventListeners.get(event).push(handler);
    },
    removeEventListener: (event, handler) => {
      if (!eventListeners.has(event)) return;
      const list = eventListeners.get(event);
      const idx = list.indexOf(handler);
      if (idx !== -1) list.splice(idx, 1);
    },
    _dispatchKeydown: (key, extra = {}) => {
      const list = eventListeners.get("keydown") || [];
      const event = {
        key,
        defaultPrevented: false,
        preventDefault: () => { event.defaultPrevented = true; },
        ...extra
      };
      [...list].forEach(h => h(event));
      return event;
    }
  };

  const context = {
    console: { warn: () => {}, log: () => {} },
    document,
    setTimeout: (fn, delay) => {
      const handle = { fn, delay, cancelled: false };
      handle.id = setTimeout(() => {
        if (!handle.cancelled) fn();
      }, Math.min(delay, 20));
      return handle;
    },
    clearTimeout: (handle) => {
      if (handle) {
        handle.cancelled = true;
        clearTimeout(handle.id);
      }
    },
    Boolean,
    String,
    Promise,
    Array,
    elementsById,
    window: {}
  };

  context.window = context;
  vm.createContext(context);
  vm.runInContext(dialogCode, context);

  return context;
}

for (const [targetName, filePath] of [["index.html", indexHtmlPath], ["electron-standalone.html", electronHtmlPath]]) {
  test(`${targetName} showToast: supports all notification types, roles, aria-live, close buttons, and timer dismissal`, async () => {
    const htmlSource = fs.readFileSync(filePath, "utf8");
    const ctx = createMockDOMContext(htmlSource);

    // 1. Types check
    const toastInfo = ctx.showToast("Test info", "info", 0);
    assert.ok(toastInfo.className.includes("custom-toast-info"));
    assert.equal(toastInfo.getAttribute("role"), "status");
    assert.equal(toastInfo.getAttribute("aria-live"), "polite");

    const toastSuccess = ctx.showToast("Test success", "SUCCESS", 0);
    assert.ok(toastSuccess.className.includes("custom-toast-success"));
    assert.equal(toastSuccess.getAttribute("role"), "status");
    assert.equal(toastSuccess.getAttribute("aria-live"), "polite");

    const toastWarn = ctx.showToast("Test warn", "warn", 0);
    assert.ok(toastWarn.className.includes("custom-toast-warning"));
    assert.equal(toastWarn.getAttribute("role"), "status");
    assert.equal(toastWarn.getAttribute("aria-live"), "polite");

    const toastError = ctx.showToast("Test error", "error", 0);
    assert.ok(toastError.className.includes("custom-toast-error"));
    assert.equal(toastError.getAttribute("role"), "alert");
    assert.equal(toastError.getAttribute("aria-live"), "assertive");

    // 2. Simultaneous notifications in container
    const container = ctx.document.getElementById("custom-toast-container");
    assert.ok(container);
    assert.equal(container.children.length, 4);

    // 3. Close button
    const closeBtn = toastInfo.children.find(c => c.className === "custom-toast-close");
    assert.ok(closeBtn);
    assert.equal(closeBtn.getAttribute("aria-label"), "Close");
    assert.equal(closeBtn.type, "button");
    closeBtn.onclick({ stopPropagation: () => {} });
    assert.ok(toastInfo.classList.contains("toast-hiding"));

    // 4. Programmatic dismissal
    toastSuccess.dismiss();
    assert.ok(toastSuccess.classList.contains("toast-hiding"));

    // 5. Hover pause and unhover
    const toastHover = ctx.showToast("Hover me", "info", 500);
    assert.ok(typeof toastHover.onmouseenter === "function");
    assert.ok(typeof toastHover.onmouseleave === "function");
    toastHover.onmouseenter();
    toastHover.onmouseleave();

    // 6. Global alert fallback invokes showToast
    ctx.window.alert("Alert fallback test");
    const lastToast = container.children[container.children.length - 1];
    assert.ok(lastToast.className.includes("custom-toast-info"));
  });

  test(`${targetName} showConfirmModal: handles confirm, cancel, keyboard shortcuts, focus management, and queueing`, async () => {
    const htmlSource = fs.readFileSync(filePath, "utf8");
    const ctx = createMockDOMContext(htmlSource);

    const prevButton = ctx.document.createElement("button");
    prevButton.id = "launch-btn";
    ctx.document.body.appendChild(prevButton);
    prevButton.focus();
    assert.equal(ctx.document.activeElement, prevButton);

    // 1. Confirm resolves true
    const p1 = ctx.showConfirmModal({ title: "Modal 1", message: "Confirm me" });
    const okBtn = ctx.document.getElementById("custom-confirm-ok-btn");
    assert.ok(okBtn);
    okBtn.onclick({ stopPropagation: () => {} });
    const res1 = await p1;
    assert.equal(res1, true);

    // 2. Cancel resolves false
    const p2 = ctx.showConfirmModal({ title: "Modal 2", message: "Cancel me" });
    const cancelBtn = ctx.document.getElementById("custom-confirm-cancel-btn");
    assert.ok(cancelBtn);
    cancelBtn.onclick({ stopPropagation: () => {} });
    const res2 = await p2;
    assert.equal(res2, false);

    // 3. Close button (✕) resolves false
    const pClose = ctx.showConfirmModal({ title: "Modal Close", message: "Close X" });
    const closeBtn = ctx.document.getElementById("custom-confirm-close-btn");
    assert.ok(closeBtn);
    closeBtn.onclick({ stopPropagation: () => {} });
    const resClose = await pClose;
    assert.equal(resClose, false);

    // 4. Overlay backdrop click resolves false
    const pOverlay = ctx.showConfirmModal({ title: "Overlay", message: "Click outside" });
    const overlay = ctx.document.getElementById("custom-confirm-overlay");
    assert.ok(overlay);
    overlay.onclick({ target: overlay });
    const resOverlay = await pOverlay;
    assert.equal(resOverlay, false);

    // 5. Escape key resolves false
    const p3 = ctx.showConfirmModal("Escape test");
    ctx.document._dispatchKeydown("Escape");
    const res3 = await p3;
    assert.equal(res3, false);

    // 6. Enter key resolves true when focus is on okBtn
    const p4 = ctx.showConfirmModal("Enter test");
    ctx.document._dispatchKeydown("Enter");
    const res4 = await p4;
    assert.equal(res4, true);

    // 7. Enter key on cancel button resolves false
    const p5 = ctx.showConfirmModal("Enter on cancel test");
    const cancelBtn5 = ctx.document.getElementById("custom-confirm-cancel-btn");
    cancelBtn5.focus();
    ctx.document._dispatchKeydown("Enter");
    const res5 = await p5;
    assert.equal(res5, false);

    // 8. Danger mode focuses cancel button by default
    const pDanger = ctx.showConfirmModal({ title: "Danger Action", message: "Destructive", isDanger: true });
    assert.equal(ctx.document.activeElement, ctx.document.getElementById("custom-confirm-cancel-btn"));
    const box = ctx.document.getElementById("custom-confirm-box");
    assert.ok(box.classList.contains("danger-mode"));
    ctx.document._dispatchKeydown("Escape");
    await pDanger;

    // 9. Focus trap: Tab from okBtn cycles to closeBtn, Shift+Tab from closeBtn cycles to okBtn
    const pTrap = ctx.showConfirmModal("Trap test");
    const trapOk = ctx.document.getElementById("custom-confirm-ok-btn");
    const trapClose = ctx.document.getElementById("custom-confirm-close-btn");
    trapOk.focus();
    ctx.document._dispatchKeydown("Tab");
    assert.equal(ctx.document.activeElement, trapClose);
    ctx.document._dispatchKeydown("Tab", { shiftKey: true });
    assert.equal(ctx.document.activeElement, trapOk);
    trapOk.onclick({ stopPropagation: () => {} });
    await pTrap;

    // 10. Queueing: three concurrent calls
    const pQueue1 = ctx.showConfirmModal({ title: "Queue 1" });
    const pQueue2 = ctx.showConfirmModal({ title: "Queue 2" });
    const pQueue3 = ctx.showConfirmModal({ title: "Queue 3" });

    const titleEl = ctx.document.getElementById("custom-confirm-title");
    assert.equal(titleEl.textContent, "Queue 1");

    // Confirm Queue 1
    const okBtnQueue = ctx.document.getElementById("custom-confirm-ok-btn");
    okBtnQueue.onclick({ stopPropagation: () => {} });
    const resQ1 = await pQueue1;
    assert.equal(resQ1, true);

    // Queue 2 is now displayed immediately without state corruption
    assert.equal(titleEl.textContent, "Queue 2");
    const cancelBtnQueue = ctx.document.getElementById("custom-confirm-cancel-btn");
    cancelBtnQueue.onclick({ stopPropagation: () => {} });
    const resQ2 = await pQueue2;
    assert.equal(resQ2, false);

    // Queue 3 is displayed
    assert.equal(titleEl.textContent, "Queue 3");
    okBtnQueue.onclick({ stopPropagation: () => {} });
    const resQ3 = await pQueue3;
    assert.equal(resQ3, true);

    // After queue is empty, focus is restored to launch-btn
    assert.equal(ctx.document.activeElement, prevButton);

    // 11. Global confirm fallback
    const confirmFallbackResult = ctx.window.confirm("Synchronous confirm fallback");
    assert.equal(confirmFallbackResult, false);
    // Dismiss the fallback modal created
    ctx.document._dispatchKeydown("Escape");
  });
}

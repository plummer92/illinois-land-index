import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../parcel-dashboard/parcel-share.js", import.meta.url), "utf8");
const pin = "28010100008";
const expected = `https://illinoislandindex.com/parcel-dashboard/?scoreDetail=${pin}#property-result`;

function setup(navigator = {}) {
  function node(tagName) {
    return {
      tagName, children: [], listeners: {}, attributes: {}, textContent: "", isConnected: true,
      hidden: false, disabled: false,
      append(...children) { this.children.push(...children); },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(type, handler) { this.listeners[type] = handler; },
      focus() { this.focused = true; },
      select() { this.selected = true; },
    };
  }
  const window = {};
  vm.runInNewContext(source, {
    window, navigator, URL, document: { createElement: node },
    location: new URL("https://preview.example.org/parcel-dashboard/?address=600%20Example%20Street&analytics_test=1&scoreTown=CHATHAM&utm_source=private#find-property"),
  });
  const wrap = window.createPropertyShare(pin);
  const [actions, status, manual] = wrap.children;
  const [share, copy] = actions.children;
  const field = manual.children[1];
  return { window, wrap, share, copy, status, manual, field, click: button => button.listeners.click() };
}

test("native share sends a clean canonical parcel link and generic text", async () => {
  const sent = [];
  const view = setup({ share: async data => sent.push(data) });
  await view.click(view.share);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, expected);
  assert.equal(sent[0].title, "Property details | Illinois Land Index");
  assert.doesNotMatch(JSON.stringify(sent), /Example|address|analytics_test|utm_|scoreTown|preview\.example/);
  assert.equal(view.status.textContent, "Property link shared.");
  assert.equal(view.status.attributes.role, "status");
  assert.equal(view.share.disabled, false);
});

test("only valid public parcel identifiers can create a sharing control", () => {
  const view = setup();
  for (const bad of ["600 Example Street", "123", "28010100008&address=secret", 28010100008, null, undefined]) {
    assert.equal(view.window.createPropertyShare(bad), null);
  }
});

test("primary share action copies the link when native sharing is unavailable", async () => {
  const copied = [];
  const view = setup({ clipboard: { writeText: async value => copied.push(value) } });
  assert.equal(view.copy.hidden, true);
  await view.click(view.share);
  assert.deepEqual(copied, [expected]);
  assert.match(view.status.textContent, /^Link copied/);
  assert.equal(view.manual.hidden, true);
});

test("Copy link bypasses native sharing when both choices are available", async () => {
  let nativeCalls = 0;
  const copied = [];
  const view = setup({ share: async () => nativeCalls++, clipboard: { writeText: async value => copied.push(value) } });
  assert.equal(view.copy.hidden, false);
  await view.click(view.copy);
  assert.equal(nativeCalls, 0);
  assert.deepEqual(copied, [expected]);
});

test("canceling native share never copies or opens a fallback without permission", async () => {
  let copied = 0;
  const view = setup({
    share: async () => { throw Object.assign(new Error("Canceled"), { name: "AbortError" }); },
    clipboard: { writeText: async () => copied++ },
  });
  await view.click(view.share);
  assert.equal(copied, 0);
  assert.equal(view.status.textContent, "Sharing canceled.");
  assert.equal(view.manual.hidden, true);
  assert.equal(view.share.disabled, false);
});

test("blocked native sharing falls back to copying the same clean URL", async () => {
  const copied = [];
  const view = setup({
    share: async () => { throw Object.assign(new Error("Unavailable"), { name: "NotAllowedError" }); },
    clipboard: { writeText: async value => copied.push(value) },
  });
  await view.click(view.share);
  assert.deepEqual(copied, [expected]);
  assert.match(view.status.textContent, /^Link copied/);
});

test("clipboard denial presents a labeled read-only selectable link, without claiming success", async () => {
  const view = setup({ clipboard: { writeText: async () => { throw new Error("Denied"); } } });
  await view.click(view.share);
  assert.equal(view.manual.hidden, false);
  assert.equal(view.manual.children[0], "Property link");
  assert.equal(view.field.readOnly, true);
  assert.equal(view.field.value, expected);
  assert.equal(view.field.focused, true);
  assert.equal(view.field.selected, true);
  assert.equal(view.status.textContent, "Select and copy the property link below.");
  assert.equal(view.share.disabled, false);
});

test("a second tap during sharing does not open duplicate dialogs", async () => {
  let finish;
  let calls = 0;
  const view = setup({ share: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const pending = view.click(view.share);
  await view.click(view.share);
  await view.click(view.copy);
  assert.equal(calls, 1);
  assert.equal(view.share.disabled, true);
  finish();
  await pending;
  assert.equal(view.share.disabled, false);
});

test("changing properties while sharing cannot display stale status or focus a detached fallback", async () => {
  let fail;
  const view = setup({ clipboard: { writeText: () => new Promise((_resolve, reject) => { fail = reject; }) } });
  const pending = view.click(view.share);
  view.wrap.isConnected = false;
  fail(new Error("Clipboard blocked"));
  await pending;
  assert.equal(view.status.textContent, "");
  assert.equal(view.manual.hidden, true);
  assert.equal(view.field.focused, undefined);
  await view.click(view.share);
  assert.equal(view.status.textContent, "");
});

// Recent input events for the CONTROLS setup page's tester: every raw press
// and what the debounce made of it (fired / blocked), so one physical tap can
// be checked on the device that produced it. The ring is capped and lives
// across overlay open/close — tap the real controls, then reopen the page.

const CAP = 40;
const ring = [];

export function logInput(source, name, kind) {
  ring.push({ t: performance.now() / 1000, source, name, kind });
  if (ring.length > CAP) ring.shift();
}

export function inputLog() {
  return ring;
}

export function clearInputLog() {
  ring.length = 0;
}

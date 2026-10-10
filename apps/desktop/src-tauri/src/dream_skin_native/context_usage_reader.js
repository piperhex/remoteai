const MAX_FIBER_DEPTH = 80;
const COMPOSER_SELECTOR = '[data-codex-composer-root], .composer-surface-chrome';

function committedFiber(element) {
  const key = Object.keys(element).find(key => key.startsWith("__reactFiber$"));
  const fiber = key ? element[key] : null;
  let root = fiber;
  for (let depth = 0; root?.return && depth < MAX_FIBER_DEPTH; depth += 1) root = root.return;
  // DOM nodes retain their first Fiber even after React commits the alternate tree.
  if (root?.stateNode?.current && root.stateNode.current !== root) return fiber?.alternate ?? null;
  return fiber;
}

function readNativeContext(element) {
  let fiber = committedFiber(element);
  let usage = null;
  let conversationId = null;
  for (let depth = 0; fiber && depth < MAX_FIBER_DEPTH; depth += 1, fiber = fiber.return) {
    const props = fiber.memoizedProps;
    if (!props || typeof props !== "object") continue;
    if (!usage && Object.hasOwn(props, "contextUsage")) usage = props.contextUsage;
    conversationId ??= props.conversationId ?? props.threadId ?? null;
    if (fiber.stateNode instanceof Element && fiber.stateNode.matches(COMPOSER_SELECTOR)) break;
  }
  if (!usage || !Object.hasOwn(usage, "usedTokens") || !Object.hasOwn(usage, "contextWindow")) return null;
  return {
    conversationId: conversationId ?? composerConversationId(element.closest(COMPOSER_SELECTOR)),
    value: contextUsage({ last: { totalTokens: usage.usedTokens }, modelContextWindow: usage.contextWindow }),
  };
}

function composerConversationId(composer) {
  const root = composer && committedFiber(composer);
  const queue = root?.child ? [root.child] : [];
  const ids = new Set();
  for (let count = 0; queue.length && count < 400; count += 1) {
    const fiber = queue.pop();
    const id = fiber.memoizedProps?.conversationId ?? fiber.memoizedProps?.threadId;
    if (typeof id === "string" && id) ids.add(id);
    if (fiber.child) queue.push(fiber.child);
    if (fiber.sibling) queue.push(fiber.sibling);
  }
  // Multiple editors may coexist; never infer identity from the URL or another composer.
  return ids.size === 1 ? [...ids][0] : null;
}

function emptyNativeContext(composer) {
  if (!composer) return null;
  const root = committedFiber(composer);
  const queue = root?.child ? [root.child] : [];
  for (let count = 0; queue.length && count < 400; count += 1) {
    const fiber = queue.pop();
    const usage = fiber.memoizedProps?.contextUsage;
    // The native indicator renders null until its first usage event. Keep capacity settings reachable.
    if (!fiber.child && usage && Object.hasOwn(usage, "usedTokens") && Object.hasOwn(usage, "contextWindow")) {
      let parent = fiber.return;
      while (parent && !(parent.stateNode instanceof Element)) parent = parent.return;
      if (parent?.stateNode && composer.contains(parent.stateNode)) return { native: parent.stateNode,
        snapshot: { conversationId: composerConversationId(composer),
          value: contextUsage({ last: { totalTokens: usage.usedTokens }, modelContextWindow: usage.contextWindow }) } };
    }
    if (fiber.child) queue.push(fiber.child);
    if (fiber.sibling) queue.push(fiber.sibling);
  }
  return null;
}

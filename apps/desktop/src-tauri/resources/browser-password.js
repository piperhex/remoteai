var RemoteAIBrowserPassword = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // browser/data/passwordPage.ts
  var passwordPage_exports = {};
  __export(passwordPage_exports, {
    passwordPage: () => passwordPage
  });

  // browser/data/passwordPageFields.ts
  var loginPage = () => window;
  var formInputs = (form) => Array.from(form.querySelectorAll("input")).filter((input) => !input.disabled && input.type !== "hidden" && input.getClientRects().length > 0);
  var autocompleteField = (input) => input.autocomplete.trim().toLowerCase().split(/\s+/).filter((token) => token !== "webauthn").pop();
  var usernameInput = (fields) => fields.find((input) => autocompleteField(input) === "username") ?? fields.find((input) => ["text", "email", "tel"].includes(input.type) && [input.name, input.id].some((value) => value.toLowerCase() === "username")) ?? fields.find((input) => input.type === "email") ?? fields.find((input) => ["text", "tel"].includes(input.type));
  var passwordInput = (fields) => fields.find((input) => input.type === "password" && autocompleteField(input) !== "new-password");
  function clickedSubmitter(event) {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const control = event.target.closest("button, input");
    if (!(control instanceof HTMLButtonElement || control instanceof HTMLInputElement)) return;
    if ((control.type === "submit" || control.type === "image") && !control.matches(":disabled")) return control;
  }
  function safeLoginForm(form, submitter) {
    try {
      const override = submitter?.getAttribute("formaction");
      return new URL(form.action || location.href, location.href).origin === location.origin && (!override || new URL(override, document.baseURI).origin === location.origin);
    } catch {
      return false;
    }
  }
  function postLoginMessage(options, message) {
    const page = loginPage(), serialized = JSON.stringify(message);
    if (options.native && page.ReactNativeWebView) {
      page.ReactNativeWebView.postMessage(serialized);
      return true;
    }
    if (options.desktop && page.chrome?.webview) {
      page.chrome.webview.postMessage(serialized);
      return true;
    }
    return false;
  }

  // browser/data/passwordUsernameFirst.ts
  var USERNAME_STEP_LIFETIME_MS = 10 * 60 * 1e3;
  var PASSWORD_STEP_LIFETIME_MS = 30 * 1e3;
  var loginButtonName = /^(?:(?:button|btn)[-_]?)?(?:sign[-_]?in|log[-_]?in)(?:[-_]?(?:button|btn))?$/i;
  var passwordSelector = "input[type=password]";
  function isLoginButton(button) {
    return button.type === "button" && !button.form && !button.matches(":disabled") && button.getClientRects().length > 0 && [button.id, button.name, button.dataset.testid ?? ""].some((value) => loginButtonName.test(value));
  }
  function nearbyFields(element, selector, eligible) {
    for (let scope = element.parentElement; scope && scope !== document.body; scope = scope.parentElement) {
      const matches = Array.from(scope.querySelectorAll(selector)).filter(eligible);
      if (matches.length) return matches;
    }
    return [];
  }
  function commandPassword(button) {
    if (!isLoginButton(button)) return;
    const fields = nearbyFields(
      button,
      passwordSelector,
      (field) => field.getClientRects().length > 0
    );
    if (fields.length !== 1 || fields[0].form || fields[0].matches(":disabled, [readonly]")) return;
    return passwordInput(fields);
  }
  function activatedPassword(event) {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    if (event instanceof MouseEvent) {
      const button = event.target.closest("button");
      return button ? commandPassword(button) : void 0;
    }
    if (event.key !== "Enter" || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || !(event.target instanceof HTMLInputElement)) return;
    const buttons = nearbyFields(event.target, "button", isLoginButton);
    if (buttons.length === 1 && commandPassword(buttons[0]) === event.target) return event.target;
  }
  function submittedUsername(form, submitter) {
    if (!form || !safeLoginForm(form, submitter) || form.matches(":invalid")) return;
    const fields = formInputs(form);
    if (fields.some((input) => input.type === "password")) return;
    const identities = fields.filter((input) => {
      const hint = autocompleteField(input);
      return ["text", "email", "tel"].includes(input.type) && (hint === "username" || hint === "email");
    });
    const username = identities.length === 1 ? identities[0].value.trim() : "";
    if (username && username.length <= 512) return { form, username, at: performance.now() };
  }
  function watchPasswordStep(input, accepted, stop) {
    const navigation = window.navigation;
    const onNavigate = (event) => {
      const { destination, navigationType, userInitiated } = event;
      if (event.isTrusted && !userInitiated && !destination.sameDocument && input.value && (navigationType === "push" || navigationType === "replace")) accepted();
    };
    const observer = new MutationObserver(() => {
      if (input.isConnected) {
        if (!input.value) stop();
        return;
      }
      const replacement = Array.from(document.querySelectorAll(passwordSelector)).some((field) => !field.form && field.getClientRects().length > 0);
      if (replacement) stop();
      else accepted();
    });
    observer.observe(document, { childList: true, subtree: true });
    navigation?.addEventListener("navigate", onNavigate);
    const timeout = window.setTimeout(stop, PASSWORD_STEP_LIFETIME_MS);
    return () => {
      observer.disconnect();
      navigation?.removeEventListener("navigate", onNavigate);
      window.clearTimeout(timeout);
    };
  }
  function observeUsernameFirstLogin(offer) {
    let previous;
    let stopWatching;
    const stop = () => {
      stopWatching?.();
      stopWatching = void 0;
    };
    const remember = (form, submitter) => {
      const username = submittedUsername(form, submitter);
      if (username) previous = username;
    };
    document.addEventListener("submit", (event) => {
      if (event.isTrusted && event.target instanceof HTMLFormElement) remember(event.target, event.submitter);
    }, true);
    const onActivation = (event) => {
      if (!event.isTrusted || event instanceof KeyboardEvent && event.key !== "Enter") return;
      stop();
      if (!previous || performance.now() - previous.at > USERNAME_STEP_LIFETIME_MS || previous.form.isConnected && previous.form.getClientRects().length > 0) return;
      const input = activatedPassword(event);
      if (!input?.value || input.value.length > 4096) return;
      const login = { origin: location.origin, username: previous.username, password: input.value };
      stopWatching = watchPasswordStep(input, () => {
        stop();
        previous = void 0;
        offer(login);
      }, stop);
    };
    document.addEventListener("click", (event) => {
      const submitter = clickedSubmitter(event);
      if (submitter) remember(submitter.form, submitter);
      onActivation(event);
    }, true);
    document.addEventListener("keyup", onActivation, true);
    document.addEventListener("input", (event) => {
      if (event.isTrusted) stop();
    }, true);
  }

  // browser/data/passwordPageSubmission.ts
  function readLogin(form, commandClick) {
    const fields = formInputs(form);
    const password = commandClick ? passwordInput(fields) : fields.find((input) => input.type === "password");
    if (!password?.value || password.value.length > 4096) return;
    return {
      origin: location.origin,
      username: usernameInput(fields)?.value.slice(0, 512) ?? "",
      password: password.value
    };
  }
  function offerLogin(options, login) {
    const page = loginPage();
    if (!postLoginMessage(options, { type: "browser-login", login }) && page.__remoteaiLogin) {
      page.__remoteaiLogin.pending = login;
    }
  }
  function observeLoginSubmissions(options) {
    observeUsernameFirstLogin((login) => offerLogin(options, login));
    const pending = /* @__PURE__ */ new WeakMap();
    document.addEventListener("submit", (event) => {
      const form = event.target;
      if (!event.isTrusted || !(form instanceof HTMLFormElement)) return;
      const clickedLogin = pending.get(form);
      pending.delete(form);
      if (!safeLoginForm(form, event.submitter)) return;
      const login = readLogin(form, false) ?? clickedLogin;
      if (login) offerLogin(options, login);
    }, true);
    document.addEventListener("click", (event) => {
      const control = clickedSubmitter(event), form = control?.form;
      if (!form || !safeLoginForm(form, control)) return;
      const login = readLogin(form, true);
      if (!login) return;
      const validBeforeClick = !form.matches(":invalid");
      pending.set(form, login);
      window.setTimeout(() => {
        if (pending.get(form) !== login) return;
        pending.delete(form);
        if (!event.defaultPrevented || !safeLoginForm(form, control)) return;
        if (validBeforeClick || !form.matches(":invalid")) offerLogin(options, login);
      }, 0);
    }, true);
  }

  // browser/data/passwordPageCapture.ts
  function captureFocus(event, options) {
    const input = event.target, page = loginPage();
    if (!event.isTrusted || !(input instanceof HTMLInputElement) || !input.form || !page.__remoteaiLogin) return;
    const fields = formInputs(input.form), password = passwordInput(fields);
    if (!safeLoginForm(input.form) || !password || !fields.includes(input) || input !== password && input !== usernameInput(fields)) return;
    const id = Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
    page.__remoteaiLogin.focus = { id, input };
    const { x, y, width, height } = input.getBoundingClientRect();
    const focus = {
      origin: location.origin,
      id,
      username: usernameInput(fields)?.value.slice(0, 512) ?? "",
      bounds: { x, y, width, height },
      viewport: { width: innerWidth, height: innerHeight }
    };
    if (!postLoginMessage(options, { type: "browser-login-focus", focus })) page.__remoteaiLogin.pendingFocus = focus;
  }
  function installPasswordCapture(options) {
    const page = loginPage();
    if (page.__remoteaiLogin?.installed) return true;
    page.__remoteaiLogin = { installed: true, pending: null };
    observeLoginSubmissions(options);
    document.addEventListener("click", (event) => captureFocus(event, options), true);
    let tabFocus = false;
    document.addEventListener("keydown", (event) => {
      tabFocus = event.isTrusted && event.key === "Tab";
    }, true);
    document.addEventListener("focusin", (event) => {
      if (tabFocus) captureFocus(event, options);
      tabFocus = false;
    }, true);
    return true;
  }

  // browser/data/passwordPage.ts
  function passwordPage(options) {
    if (window.top !== window || !["http:", "https:"].includes(location.protocol)) return null;
    const page = loginPage();
    if (options.action === "install") return installPasswordCapture(options);
    if (options.action === "take") {
      const login2 = page.__remoteaiLogin?.pending;
      if (page.__remoteaiLogin) page.__remoteaiLogin.pending = null;
      return login2 ?? null;
    }
    if (options.action === "takeFocus") {
      const focus2 = page.__remoteaiLogin?.pendingFocus;
      if (page.__remoteaiLogin) page.__remoteaiLogin.pendingFocus = null;
      return focus2 ?? null;
    }
    const login = options.login;
    if (!login || login.origin !== location.origin) return false;
    const focus = options.focusId ? page.__remoteaiLogin?.focus : void 0;
    if (options.focusId && (focus?.id !== options.focusId || !focus.input.isConnected)) return false;
    const form = focus ? focus.input.form : Array.from(document.forms).find((form2) => safeLoginForm(form2) && passwordInput(formInputs(form2)));
    if (!form || !safeLoginForm(form)) return false;
    const fields = formInputs(form), password = passwordInput(fields);
    if (!password) return false;
    const set = (input, value) => {
      if (!input) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set(usernameInput(fields), login.username);
    set(password, login.password);
    return password.value === login.password;
  }
  return __toCommonJS(passwordPage_exports);
})();

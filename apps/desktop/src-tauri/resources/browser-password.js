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

  // browser/data/model.ts
  var MAX_DATA_BYTES = 4 * 1024 * 1024;

  // browser/data/passwordFocus.ts
  var USERNAME_STEP_LIFETIME_MS = 10 * 60 * 1e3;

  // browser/data/passwordUsernameFirstFields.ts
  var signInName = /^(?:(?:button|btn)[-_]?)?(?:sign[-_]?in|log[-_]?in)(?:[-_]?(?:button|btn))?$/i;
  var nextStepName = /^(?:(?:button|btn)[-_]?)?(?:next|continue)(?:[-_]?(?:button|btn))?$/i;
  var passwordSelector = "input[type=password]";
  var commandMatches = (control, pattern) => [control.id, control.name, control.dataset.testid ?? ""].some((value) => pattern.test(value));
  var isVisible = (element) => element.getClientRects().length > 0;
  var isAwsSignIn = () => location.protocol === "https:" && (location.hostname === "signin.aws.amazon.com" || location.hostname.endsWith(".signin.aws.amazon.com"));
  function nearbyFields(element, selector, eligible) {
    for (let scope = element.parentElement; scope && scope !== document.body; scope = scope.parentElement) {
      const matches = Array.from(scope.querySelectorAll(selector)).filter(eligible);
      if (matches.length) return matches;
    }
    return [];
  }
  function isLoginButton(button) {
    return button.type === "button" && !button.form && !button.matches(":disabled") && isVisible(button) && commandMatches(button, signInName);
  }
  function commandPassword(button) {
    if (!isLoginButton(button)) return;
    const fields = nearbyFields(button, passwordSelector, isVisible);
    if (fields.length !== 1 || fields[0].form || fields[0].matches(":disabled, [readonly]")) return;
    return passwordInput(fields);
  }
  function isCommandPassword(input) {
    if (input.type !== "password" || input.form) return false;
    const buttons = nearbyFields(input, "button", isLoginButton);
    return buttons.length === 1 && commandPassword(buttons[0]) === input;
  }
  function usernameFirstIdentity(form) {
    const fields = formInputs(form);
    if (fields.some((input) => input.type === "password")) return;
    const identities = fields.filter((input) => {
      const hint = autocompleteField(input);
      return ["text", "email", "tel"].includes(input.type) && (hint === "username" || hint === "email");
    });
    if (identities.length === 1) return identities[0];
  }
  function fillableUsernameStep(form) {
    if (!safeLoginForm(form)) return;
    const input = usernameFirstIdentity(form);
    if (!input || input.matches(":disabled, [readonly]")) return;
    if (isAwsSignIn() && input.id === "resolving_input" && input.type !== "email") return;
    const next = Array.from(form.elements).some((control) => (control instanceof HTMLButtonElement || control instanceof HTMLInputElement) && control.type === "submit" && isVisible(control) && safeLoginForm(form, control) && (commandMatches(control, nextStepName) || autocompleteField(input) === "username"));
    if (next) return input;
  }
  function displayedAwsUsername(input) {
    if (!isAwsSignIn()) return;
    const panel = input.closest('[data-testid="root-password-form"]');
    if (!panel) return;
    const identities = Array.from(panel.querySelectorAll("strong")).filter(isVisible).map((label) => label.textContent?.trim() ?? "").filter((value) => value.length <= 512 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
    if (identities.length === 1) return identities[0];
  }
  function commandPasswordIdentity(input) {
    if (!isCommandPassword(input)) return;
    const step = loginPage().__remoteaiLogin?.usernameStep;
    const displayed = displayedAwsUsername(input);
    if (step && performance.now() - step.at <= USERNAME_STEP_LIFETIME_MS && !isVisible(step.form) && (!displayed || displayed === step.username)) {
      return { username: step.username, continuationId: step.continuationId };
    }
    if (displayed) return { username: displayed };
  }

  // browser/data/passwordUsernameFirst.ts
  var PASSWORD_STEP_LIFETIME_MS = 30 * 1e3;
  function activatedPassword(event) {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    if (event instanceof MouseEvent) {
      const button = event.target.closest("button");
      return button ? commandPassword(button) : void 0;
    }
    if (event.key !== "Enter" || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || !(event.target instanceof HTMLInputElement)) return;
    if (isCommandPassword(event.target)) return event.target;
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
    const page = loginPage().__remoteaiLogin;
    if (!page) return;
    let stopWatching;
    const stop = () => {
      stopWatching?.();
      stopWatching = void 0;
    };
    const remember = (form, submitter) => {
      if (!form || !safeLoginForm(form, submitter) || form.matches(":invalid")) return;
      const input = usernameFirstIdentity(form), username = input?.value.trim(), choice = page.usernameChoice;
      if (!username || username.length > 512) return;
      const continuationId = choice?.input === input && choice?.username === username ? choice.id : void 0;
      page.usernameStep = { form, username, at: performance.now(), continuationId };
    };
    document.addEventListener("submit", (event) => {
      if (event.isTrusted && event.target instanceof HTMLFormElement) remember(event.target, event.submitter);
    }, true);
    const onActivation = (event) => {
      if (!event.isTrusted || event instanceof KeyboardEvent && event.key !== "Enter") return;
      stop();
      const input = activatedPassword(event);
      if (!input?.value || input.value.length > 4096) return;
      const identity = commandPasswordIdentity(input);
      if (!identity) return;
      const login = { origin: location.origin, username: identity.username, password: input.value };
      stopWatching = watchPasswordStep(input, () => {
        stop();
        page.usernameStep = void 0;
        page.usernameChoice = void 0;
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
  function describeInput(input) {
    const form = input.form;
    if (!form) {
      const identity = commandPasswordIdentity(input);
      return identity && { ...identity, stage: "password" };
    }
    if (!safeLoginForm(form)) return;
    const fields = formInputs(form), password = passwordInput(fields), username = usernameInput(fields);
    if (password && (input === password || input === username)) return { username: username?.value ?? "" };
    if (!password && fillableUsernameStep(form) === input) return { username: input.value, stage: "username" };
  }
  function captureFocus(event, options) {
    const input = event.target, page = loginPage();
    if (!event.isTrusted || !(input instanceof HTMLInputElement) || !page.__remoteaiLogin) return;
    const description = describeInput(input);
    if (!description) return;
    const id = Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
    page.__remoteaiLogin.focus = { id, input };
    const { x, y, width, height } = input.getBoundingClientRect();
    const focus = {
      ...description,
      origin: location.origin,
      id,
      username: description.username.slice(0, 512),
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
      const input = event.target;
      if (tabFocus) captureFocus(event, options);
      else if (event.isTrusted && input instanceof HTMLInputElement && input.type === "password" && !input.form) {
        window.setTimeout(() => {
          if (document.activeElement === input && page.__remoteaiLogin?.focus?.input !== input) {
            captureFocus(event, options);
          }
        }, 0);
      }
      tabFocus = false;
    }, true);
    return true;
  }

  // browser/data/passwordPage.ts
  function standardLoginForm() {
    return Array.from(document.forms).find((form) => safeLoginForm(form) && passwordInput(formInputs(form)));
  }
  function fillInput(input, value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return input.value === value;
  }
  function fillUsername(options, focused) {
    const identity = options.identity;
    if (!identity?.username || identity.origin !== location.origin) return false;
    if (!focused && standardLoginForm()) return false;
    const inputs = focused ? focused.form && fillableUsernameStep(focused.form) === focused ? [focused] : [] : Array.from(document.forms).map(fillableUsernameStep).filter((input) => input !== void 0);
    if (inputs.length !== 1 || !fillInput(inputs[0], identity.username)) return false;
    const page = loginPage().__remoteaiLogin;
    if (page && options.focusId) {
      page.usernameChoice = { id: options.focusId, input: inputs[0], username: identity.username.trim() };
    }
    return true;
  }
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
    const focus = options.focusId ? page.__remoteaiLogin?.focus : void 0;
    if (options.focusId && (focus?.id !== options.focusId || !focus.input.isConnected)) return false;
    if (options.action === "fillUsername") return fillUsername(options, focus?.input);
    const login = options.login;
    if (!login || login.origin !== location.origin) return false;
    const form = focus ? focus.input.form : standardLoginForm();
    if (!form) {
      const inputs = focus ? [focus.input] : Array.from(document.querySelectorAll(passwordSelector));
      const matching = inputs.filter((input) => commandPasswordIdentity(input)?.username === login.username);
      return matching.length === 1 && fillInput(matching[0], login.password);
    }
    if (!safeLoginForm(form)) return false;
    const fields = formInputs(form), password = passwordInput(fields);
    if (!password) return false;
    const username = usernameInput(fields);
    if (username) fillInput(username, login.username);
    return fillInput(password, login.password);
  }
  return __toCommonJS(passwordPage_exports);
})();

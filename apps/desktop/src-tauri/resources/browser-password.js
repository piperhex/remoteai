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
  var usernameInput = (fields) => fields.find((input) => input.autocomplete === "username") ?? fields.find((input) => input.type === "email") ?? fields.find((input) => ["text", "tel"].includes(input.type));
  var passwordInput = (fields) => fields.find((input) => input.type === "password" && input.autocomplete !== "new-password");
  function safeLoginForm(form) {
    try {
      return new URL(form.action || location.href, location.href).origin === location.origin;
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

  // browser/data/passwordPageCapture.ts
  function captureLogin(event, options) {
    const form = event.target, page = loginPage();
    if (!(form instanceof HTMLFormElement) || !event.isTrusted || !safeLoginForm(form)) return;
    const fields = formInputs(form), password = fields.find((input) => input.type === "password");
    if (!password?.value || password.value.length > 4096) return;
    const login = {
      origin: location.origin,
      username: usernameInput(fields)?.value.slice(0, 512) ?? "",
      password: password.value
    };
    if (!postLoginMessage(options, { type: "browser-login", login }) && page.__remoteaiLogin) {
      page.__remoteaiLogin.pending = login;
    }
  }
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
    document.addEventListener("submit", (event) => captureLogin(event, options), true);
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
    if (window.top !== window || location.protocol !== "https:") return null;
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

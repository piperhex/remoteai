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
  function passwordPage(options) {
    if (window.top !== window || location.protocol !== "https:") return null;
    const page = window;
    const inputs = (form2) => Array.from(form2.querySelectorAll("input")).filter((input) => !input.disabled && input.type !== "hidden" && input.getClientRects().length > 0);
    const username = (fields2) => fields2.find((input) => input.autocomplete === "username") ?? fields2.find((input) => input.type === "email") ?? fields2.find((input) => ["text", "tel"].includes(input.type));
    const safeForm = (form2) => new URL(form2.action || location.href, location.href).origin === location.origin;
    if (options.action === "install") {
      if (page.__remoteaiLogin?.installed) return true;
      page.__remoteaiLogin = { installed: true, pending: null };
      document.addEventListener("submit", (event) => {
        const form2 = event.target;
        if (!(form2 instanceof HTMLFormElement) || !event.isTrusted || !safeForm(form2)) return;
        const fields2 = inputs(form2), password2 = fields2.find((input) => input.type === "password");
        if (!password2?.value || password2.value.length > 4096) return;
        const login2 = {
          origin: location.origin,
          username: username(fields2)?.value.slice(0, 512) ?? "",
          password: password2.value
        };
        if (options.native) page.ReactNativeWebView?.postMessage(JSON.stringify({ type: "browser-login", login: login2 }));
        else if (options.desktop && page.chrome?.webview) {
          page.chrome.webview.postMessage(JSON.stringify({ type: "browser-login", login: login2 }));
        } else if (page.__remoteaiLogin) page.__remoteaiLogin.pending = login2;
      }, true);
      return true;
    }
    if (options.action === "take") {
      const login2 = page.__remoteaiLogin?.pending;
      if (page.__remoteaiLogin) page.__remoteaiLogin.pending = null;
      return login2 ?? null;
    }
    const login = options.login;
    if (!login || login.origin !== location.origin) return false;
    const form = Array.from(document.forms).find((form2) => safeForm(form2) && inputs(form2).some((input) => input.type === "password" && input.autocomplete !== "new-password"));
    if (!form) return false;
    const fields = inputs(form), password = fields.find((input) => input.type === "password");
    const set = (input, value) => {
      if (!input) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set(username(fields), login.username);
    set(password, login.password);
    return true;
  }
  return __toCommonJS(passwordPage_exports);
})();

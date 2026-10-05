const CODEX_SPEED_SELECTOR_OVERLAY: &str = r#"
  window.__CODEX_SWITCH_REFRESH_SPEED_SELECTOR__ = () => {
    const stateKey = "__CODEX_SWITCH_SPEED_SELECTOR__";
    const overlayVersion = 18;
    const usageRefreshMs = 5000;
    const usageRequestTimeoutMs = 15000;
    const initialTier = __CODEX_SWITCH_SERVICE_TIER__;
    const fastModeAllowed = window.__CODEX_SWITCH_FAST_MODE_ALLOWED__ === true;
    const existing = window[stateKey];
    const removeSelectors = (installed = existing) => {
      if (installed) installed.installed = false;
      installed?.observer?.disconnect();
      if (installed?.timer) clearInterval(installed.timer);
      if (installed?.usageTimer) clearInterval(installed.usageTimer);
      if (installed?.initialUsageTimer) clearTimeout(installed.initialUsageTimer);
      if (installed?.onUsageVisible) document.removeEventListener("visibilitychange", installed.onUsageVisible);
      const injectedNodes = "[data-codex-switch-speed-selector], [data-codex-switch-speed-submenu]";
      for (const selector of document.querySelectorAll(injectedNodes)) selector.remove();
      delete window[stateKey];
    };
    if (window.__CODEX_SWITCH_COMPOSER_STATUS_ALLOWED__ !== true) {
      removeSelectors();
      return;
    }
    if (existing?.installed && existing.version === overlayVersion) {
      if (!existing.pendingTier) existing.tier = initialTier;
      existing.fastModeAllowed = fastModeAllowed;
      existing.syncAll?.();
      existing.requestUsage?.();
      return;
    }
    removeSelectors();
    const state = {
      installed: true, version: overlayVersion, tier: initialTier, fastModeAllowed, language: "zh",
      observer: null, timer: null,
      usageTimer: null, initialUsageTimer: null, usagePending: false, usageRequestedAt: 0,
      onUsageVisible: null,
      pendingTier: null, previousTier: null, syncAll: null,
      completeSelection: null, completeUsageRequest: null, updateUsage: null, requestUsage: null,
      usage: {
        enabled: false, totalTokens: 0, estimatedCostUsd: 0,
        primaryRemainingPercent: null, primaryRemainingAggregated: false,
        providerEstimatedCost: null,
      },
    };
    window[stateKey] = state;
    const copy = {
      zh: {
        today: "今日", fast: "快速模式", group: "今日用量与快速模式",
        tokens: "今日 Token 用量", cost: "今日预估成本",
        quota: "当前账号主用量余额", totalQuota: "并发账号主用量余额合计",
        apiCost: "当前 API 今日预估成本", totalApiCost: "聚合 API 今日总预估成本",
      },
      en: {
        today: "Today", fast: "Fast mode", group: "Today's usage and fast mode",
        tokens: "Tokens used today", cost: "Estimated cost today",
        quota: "Current account quota remaining", totalQuota: "Total quota remaining across concurrent accounts",
        apiCost: "Current API estimated cost today", totalApiCost: "Combined API estimated cost today",
      },
      ru: {
        today: "Сегодня", fast: "Быстрый режим", group: "Расход за сегодня и быстрый режим",
        tokens: "Токены за сегодня", cost: "Стоимость за сегодня",
        quota: "Остаток лимита аккаунта", totalQuota: "Общий остаток лимитов параллельных аккаунтов",
        apiCost: "Стоимость текущего API за сегодня", totalApiCost: "Общая стоимость API за сегодня",
      },
    };
    const text = key => copy[state.language][key];
    const formatTokens = value => {
      if (value >= 1000000) {
        return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value / 1000000)}M`;
      }
      if (value >= 1000) {
        return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value / 1000)}K`;
      }
      return new Intl.NumberFormat("en-US").format(value);
    };
    const formatCost = value => {
      const maximumFractionDigits = value > 0 && value < 0.01 ? 4 : 2;
      return `${new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value)}USD`;
    };
    const displayedTrailingUsage = () => {
      if (Number.isFinite(state.usage.primaryRemainingPercent)) {
        const value = `${Math.round(state.usage.primaryRemainingPercent)}%`;
        return {
          value,
          displayText: value,
          amount: state.usage.primaryRemainingPercent,
          kind: "quota",
          label: text(state.usage.primaryRemainingAggregated ? "totalQuota" : "quota"),
        };
      }
      const estimate = state.usage.providerEstimatedCost;
      if (!estimate || !Number.isFinite(estimate.amountUsd)) return null;
      const value = formatCost(estimate.amountUsd);
      return {
        value,
        displayText: `API ${value}`,
        amount: estimate.amountUsd,
        kind: "cost",
        label: text(estimate.aggregated ? "totalApiCost" : "apiCost"),
      };
    };
    const usesDarkPalette = element => {
      const channels = getComputedStyle(element).color.match(/[\d.]+/g)?.map(Number);
      if (!channels || channels.length < 3) return false;
      const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      return luminance > 150;
    };
    const syncUsageColors = usage => {
      const dark = usesDarkPalette(usage);
      const tokens = dark ? "rgb(84,214,177)" : "rgb(10,132,105)";
      const cost = dark ? "rgb(245,177,65)" : "rgb(180,93,0)";
      const balance = displayedTrailingUsage();
      let balanceColor = dark ? "rgb(96,211,148)" : "rgb(22,135,78)";
      if (balance?.kind === "cost" || balance?.amount <= 50) balanceColor = cost;
      if (balance?.kind === "quota" && balance.amount <= 20) {
        balanceColor = dark ? "rgb(255,113,113)" : "rgb(190,45,45)";
      }
      usage.querySelector("[data-today-tokens]").style.setProperty("color", tokens, "important");
      usage.querySelector("[data-today-cost]").style.setProperty("color", cost, "important");
      usage.querySelector("[data-trailing-balance]").style.setProperty("color", balanceColor, "important");
    };
    const syncSwitch = selector => {
      const controls = selector.querySelector("[data-speed-controls]");
      if (controls) {
        controls.hidden = !state.fastModeAllowed;
        controls.style.display = controls.hidden ? "none" : "inline-flex";
      }
      const toggle = selector.querySelector("[data-speed-switch]");
      if (!toggle || !state.fastModeAllowed) return;
      const enabled = state.tier === "priority";
      toggle.setAttribute("aria-checked", String(enabled));
      toggle.style.background = enabled ? "rgb(16,163,127)" : "rgb(142,142,147)";
      toggle.firstElementChild.style.transform = enabled ? "translateX(12px)" : "translateX(0)";
    };
    const syncUsage = selector => {
      const usage = selector.querySelector("[data-today-usage]");
      if (!usage) return;
      usage.hidden = !state.usage.enabled;
      usage.style.display = usage.hidden ? "none" : "inline-flex";
      if (usage.hidden) return;
      syncUsageColors(usage);
      const tokens = formatTokens(state.usage.totalTokens);
      const cost = formatCost(state.usage.estimatedCostUsd);
      const balance = displayedTrailingUsage();
      const balanceSeparator = usage.querySelector("[data-balance-separator]");
      const balanceValue = usage.querySelector("[data-trailing-balance]");
      balanceSeparator.hidden = !balance;
      balanceValue.hidden = !balance;
      balanceValue.textContent = balance?.displayText ?? "";
      usage.querySelector("[data-today-tokens]").textContent = tokens;
      usage.querySelector("[data-today-cost]").textContent = cost;
      const colon = state.language === "zh" ? "：" : ": ";
      const comma = state.language === "zh" ? "，" : ", ";
      const balanceTitle = balance ? `\n${balance.label}${colon}${balance.value}` : "";
      usage.title = `${text("tokens")}${colon}${tokens}\n${text("cost")}${colon}${cost}${balanceTitle}`;
      const balanceAria = balance ? `${comma}${balance.label} ${balance.value}` : "";
      usage.setAttribute(
        "aria-label",
        `${text("tokens")} ${tokens}${comma}${text("cost")} ${cost}${balanceAria}`,
      );
    };
    const syncAll = () => {
      for (const selector of document.querySelectorAll("[data-codex-switch-speed-selector]")) {
        selector.setAttribute("aria-label", text("group"));
        selector.querySelector("[data-today-label]").textContent = text("today");
        selector.querySelector("[data-speed-label]").textContent = text("fast");
        syncUsage(selector);
        syncSwitch(selector);
        const visible = state.fastModeAllowed || state.usage.enabled;
        selector.hidden = !visible;
        selector.style.setProperty("display", visible ? "inline-flex" : "none", "important");
        const toggle = selector.querySelector("[data-speed-switch]");
        if (toggle) {
          toggle.setAttribute("aria-label", text("fast"));
          toggle.disabled = !state.fastModeAllowed || Boolean(state.pendingTier);
        }
      }
    };
    state.syncAll = syncAll;
    state.completeUsageRequest = () => { state.usagePending = false; state.usageRequestedAt = 0; };
    state.updateUsage = summary => {
      state.completeUsageRequest();
      if (["zh", "en", "ru"].includes(summary?.language)) state.language = summary.language;
      const totalTokens = Number(summary?.totalTokens);
      const estimatedCostUsd = Number(summary?.estimatedCostUsd);
      const primaryRemainingPercent = summary?.primaryRemainingPercent;
      const providerEstimatedCost = summary?.providerEstimatedCost;
      state.usage = {
        enabled: summary?.enabled === true,
        totalTokens: Number.isFinite(totalTokens) ? Math.max(0, totalTokens) : 0,
        estimatedCostUsd: Number.isFinite(estimatedCostUsd) ? Math.max(0, estimatedCostUsd) : 0,
        primaryRemainingPercent: typeof primaryRemainingPercent === "number"
          && Number.isFinite(primaryRemainingPercent)
          ? Math.max(0, primaryRemainingPercent)
          : null,
        primaryRemainingAggregated: summary?.primaryRemainingAggregated === true,
        providerEstimatedCost: providerEstimatedCost
          && typeof providerEstimatedCost.amountUsd === "number"
          && Number.isFinite(providerEstimatedCost.amountUsd)
          ? {
            amountUsd: Math.max(0, providerEstimatedCost.amountUsd),
            aggregated: providerEstimatedCost.aggregated === true,
          }
          : null,
      };
      syncAll();
    };
    state.requestUsage = () => {
      if (!state.installed || window[stateKey] !== state
        || typeof window.codexSwitchRequestUsageSummary !== "function") return;
      const now = Date.now();
      // Retry lost acknowledgements without overlapping ordinary polling requests.
      if (state.usagePending && now - state.usageRequestedAt < usageRequestTimeoutMs) return;
      state.usagePending = true;
      state.usageRequestedAt = now;
      try {
        window.codexSwitchRequestUsageSummary("refresh");
      } catch {
        // A disconnected binding can throw before the request reaches the host.
        state.completeUsageRequest();
      }
    };
    state.completeSelection = (tier, succeeded) => {
      if (state.pendingTier !== tier) return;
      if (!succeeded) state.tier = state.previousTier;
      state.pendingTier = null;
      state.previousTier = null;
      syncAll();
    };
    const selectTier = tier => {
      if (!state.fastModeAllowed || state.pendingTier
        || typeof window.codexSwitchSetServiceTier !== "function") return;
      state.previousTier = state.tier;
      state.tier = tier;
      state.pendingTier = tier;
      syncAll();
      window.codexSwitchSetServiceTier(tier);
    };
    const createUsage = () => {
      const usage = document.createElement("span");
      const today = document.createElement("span");
      const tokens = document.createElement("strong");
      const separator = document.createElement("span");
      const cost = document.createElement("strong");
      const balanceSeparator = document.createElement("span");
      const balance = document.createElement("strong");
      usage.dataset.todayUsage = "true";
      usage.hidden = true;
      usage.style.cssText = "display:inline-flex;align-items:center;gap:3px;margin-right:2px;"
        + "font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;"
        + "transform:translateY(1px);";
      today.dataset.todayLabel = "true";
      today.textContent = text("today");
      today.style.color = "var(--text-tertiary)";
      tokens.dataset.todayTokens = "true";
      tokens.style.fontWeight = "650";
      separator.textContent = "·";
      separator.style.color = "var(--text-tertiary)";
      cost.dataset.todayCost = "true";
      cost.style.fontWeight = "650";
      balanceSeparator.dataset.balanceSeparator = "true";
      balanceSeparator.textContent = "·";
      balanceSeparator.style.color = "var(--text-tertiary)";
      balance.dataset.trailingBalance = "true";
      balance.style.fontWeight = "650";
      balanceSeparator.hidden = true;
      balance.hidden = true;
      usage.append(today, tokens, separator, cost, balanceSeparator, balance);
      return usage;
    };
    const createSelector = () => {
      const container = document.createElement("div");
      const content = document.createElement("div");
      const controls = document.createElement("span");
      const label = document.createElement("span");
      const toggle = document.createElement("button");
      const thumb = document.createElement("span");
      container.dataset.codexSwitchSpeedSelector = "true";
      container.className = "no-drag cursor-interaction select-none";
      container.setAttribute("role", "group");
      container.setAttribute("aria-label", text("group"));
      container.style.cssText = "display:inline-flex;align-items:center;flex:0 0 auto;width:auto;"
        + "white-space:nowrap;margin-right:4px;padding:3px 8px;border-radius:9999px;"
        + "background:var(--background-primary-ghost);font-size:14px;line-height:18px;"
        + "color:var(--text-tertiary);";
      container.style.setProperty("display", "inline-flex", "important");
      content.style.cssText = "display:flex;align-items:center;gap:6px;";
      controls.dataset.speedControls = "true";
      controls.style.cssText = "display:inline-flex;align-items:center;gap:6px;";
      label.className = "text-tertiary text-sm leading-[18px]";
      label.dataset.speedLabel = "true";
      label.textContent = text("fast");
      toggle.type = "button";
      toggle.dataset.speedSwitch = "true";
      toggle.setAttribute("role", "switch");
      toggle.setAttribute("aria-label", text("fast"));
      toggle.style.cssText = "display:block;flex:0 0 auto;width:28px;height:16px;padding:2px;"
        + "appearance:none;border:0;border-radius:9999px;cursor:pointer;"
        + "background:rgb(142,142,147);transition:background 120ms ease;";
      thumb.style.cssText = "display:block;width:12px;height:12px;border-radius:50%;"
        + "background:rgb(255,255,255);transition:transform 120ms ease;";
      toggle.append(thumb);
      toggle.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        selectTier(state.tier === "priority" ? "default" : "priority");
      });
      controls.append(label, toggle);
      content.append(createUsage(), controls);
      container.append(content);
      for (const eventName of ["pointerdown", "mousedown", "click"]) {
        container.addEventListener(eventName, event => {
          event.stopPropagation();
        }, eventName !== "click");
      }
      syncUsage(container);
      syncSwitch(container);
      return container;
    };
    const render = () => {
      if (window.__CODEX_SWITCH_COMPOSER_STATUS_ALLOWED__ !== true) {
        removeSelectors(state);
        return;
      }
      const anchor = document.querySelector('[data-composer-navigation-target="reasoning"]');
      if (!anchor) return;
      const modelWrapper = anchor.parentElement?.parentElement;
      const parent = modelWrapper?.parentElement;
      let container = parent?.querySelector(":scope > [data-codex-switch-speed-selector]");
      if (!container) {
        container = createSelector();
        modelWrapper.before(container);
      }
    };
    state.observer = new MutationObserver(render);
    state.observer.observe(document.documentElement, { childList: true, subtree: true });
    state.timer = setInterval(render, 1000);
    state.usageTimer = setInterval(state.requestUsage, usageRefreshMs);
    state.onUsageVisible = () => { if (!document.hidden) state.requestUsage(); };
    document.addEventListener("visibilitychange", state.onUsageVisible);
    render();
    state.initialUsageTimer = setTimeout(state.requestUsage, 0);
  };
  window.__CODEX_SWITCH_REFRESH_SPEED_SELECTOR__();
"#;

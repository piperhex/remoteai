const CODEX_SPEED_SELECTOR_OVERLAY: &str = r#"
  window.__CODEX_SWITCH_REFRESH_SPEED_SELECTOR__ = () => {
    const stateKey = "__CODEX_SWITCH_SPEED_SELECTOR__";
    const overlayVersion = 20;
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
      pendingTier: null, previousTier: null, selectionError: false, syncAll: null,
      completeSelection: null, completeUsageRequest: null, updateUsage: null, requestUsage: null,
      updateLanguage: null,
      usage: {
        enabled: false, totalTokens: 0, estimatedCostUsd: 0,
        primaryRemainingPercent: null, primaryRemainingAggregated: false,
        providerEstimatedCost: null,
      },
    };
    window[stateKey] = state;
    const copy = {
      zh: {
        today: "今日", normal: "普通模式", fast: "快速模式", ultrafast: "Ultrafast 模式",
        group: "今日用量与速度模式", switchTo: "点击切换为",
        speedError: "速度模式未能切换，请稍后重试。",
        tokens: "今日 Token 用量", cost: "今日预估成本",
        quota: "当前账号主用量余额", totalQuota: "并发账号主用量余额合计",
        apiCost: "当前 API 今日预估成本", totalApiCost: "聚合 API 今日总预估成本",
      },
      en: {
        today: "Today", normal: "Normal mode", fast: "Fast mode", ultrafast: "Ultrafast mode",
        group: "Today's usage and speed mode", switchTo: "Click to switch to ",
        speedError: "Couldn't change speed. Please try again.",
        tokens: "Tokens used today", cost: "Estimated cost today",
        quota: "Current account quota remaining", totalQuota: "Total quota remaining across concurrent accounts",
        apiCost: "Current API estimated cost today", totalApiCost: "Combined API estimated cost today",
      },
      ru: {
        today: "Сегодня", normal: "Обычный режим", fast: "Быстрый режим", ultrafast: "Сверхбыстрый режим",
        group: "Расход за сегодня и режим скорости", switchTo: "Нажмите, чтобы переключиться на ",
        speedError: "Не удалось изменить скорость. Попробуйте ещё раз.",
        tokens: "Токены за сегодня", cost: "Стоимость за сегодня",
        quota: "Остаток лимита аккаунта", totalQuota: "Общий остаток лимитов параллельных аккаунтов",
        apiCost: "Стоимость текущего API за сегодня", totalApiCost: "Общая стоимость API за сегодня",
      },
    };
    const text = key => copy[state.language][key];
    const speedModes = {
      default: { name: "normal", next: "priority", bolts: 0 },
      priority: { name: "fast", next: "ultrafast", bolts: 1 },
      ultrafast: { name: "ultrafast", next: "default", bolts: 2 },
    };
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
    const syncSpeedButton = selector => {
      const controls = selector.querySelector("[data-speed-controls]");
      if (controls) {
        controls.hidden = !state.fastModeAllowed;
        controls.style.display = controls.hidden ? "none" : "inline-flex";
      }
      const button = selector.querySelector("[data-speed-button]");
      if (!button) return;
      const mode = speedModes[state.tier] ?? speedModes.default;
      const label = `${text(mode.name)} · ${text("switchTo")}${text(speedModes[mode.next].name)}`;
      button.dataset.speed = mode.name;
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-busy", String(Boolean(state.pendingTier)));
      button.disabled = !state.fastModeAllowed || Boolean(state.pendingTier);
      const tooltip = selector.querySelector("[data-speed-tooltip]");
      tooltip.textContent = state.selectionError ? text("speedError") : label;
      const color = mode.name === "ultrafast" ? '#9560ed' : '#3984ed';
      for (const [index, bolt] of button.querySelectorAll("[data-speed-bolt]").entries()) {
        const lit = index < mode.bolts;
        bolt.setAttribute("class", lit ? "is-lit" : "");
        bolt.setAttribute("fill", lit ? color : "none");
        bolt.setAttribute("stroke", lit ? color : "currentColor");
      }
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
        syncUsage(selector);
        syncSpeedButton(selector);
        const visible = state.fastModeAllowed || state.usage.enabled;
        selector.hidden = !visible;
        selector.style.setProperty("display", visible ? "inline-flex" : "none", "important");
      }
    };
    state.syncAll = syncAll;
    state.updateLanguage = language => {
      if (!["zh", "en", "ru"].includes(language) || state.language === language) return;
      state.language = language;
      syncAll();
    };
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
      state.selectionError = !succeeded;
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
      state.selectionError = false;
      syncAll();
      try {
        window.codexSwitchSetServiceTier(tier);
      } catch {
        state.completeSelection(tier, false);
      }
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
    const createSpeedIcon = () => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      for (const [key, value] of Object.entries({ width: "26", height: "16", viewBox: "0 0 30 20",
        fill: "none", "aria-hidden": "true" })) svg.setAttribute(key, value);
      for (const index of [0, 1]) {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.dataset.speedBolt = String(index);
        path.setAttribute("transform", `translate(${index * 12} 0)`);
        path.setAttribute("d", "M10 1 2 11h6l-1 8 9-11h-6l1-7Z");
        path.setAttribute("stroke-width", "1.3");
        path.setAttribute("stroke-linejoin", "round");
        svg.append(path);
      }
      return svg;
    };
    const createSpeedControls = () => {
      const controls = document.createElement("span");
      const button = document.createElement("button");
      const tooltip = document.createElement("span");
      const styles = document.createElement("style");
      controls.dataset.speedControls = "true";
      controls.style.cssText = "display:inline-flex;position:relative;align-items:center;";
      button.type = "button";
      button.dataset.speedButton = "true";
      button.className = "no-drag cursor-interaction select-none";
      button.style.cssText = "display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;"
        + "width:38px;height:32px;padding:4px;border:0;border-radius:8px;"
        + "background:transparent;color:var(--text-tertiary,#718078);cursor:pointer;";
      button.append(createSpeedIcon());
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        selectTier((speedModes[state.tier] ?? speedModes.default).next);
      });
      tooltip.dataset.speedTooltip = "true";
      tooltip.setAttribute("role", "tooltip");
      tooltip.style.cssText = "position:absolute;right:0;bottom:calc(100% + 8px);z-index:1000;box-sizing:border-box;"
        + "width:max-content;max-width:min(400px,calc(100vw - 16px));white-space:normal;"
        + "overflow-wrap:anywhere;padding:6px 8px;border-radius:6px;background:#222;color:#fff;"
        + "font-size:12px;line-height:18px;pointer-events:none;";
      styles.textContent = "[data-speed-tooltip]{display:none}"
        + "[data-speed-controls]:hover [data-speed-tooltip],"
        + "[data-speed-controls]:focus-within [data-speed-tooltip]{display:block}"
        + "[data-speed-button]:hover{background:var(--background-primary-ghost,#e8f2eb)!important}"
        + "[data-speed-button]:focus-visible{outline:2px solid #3984ed;outline-offset:2px}"
        + "[data-speed-button]:disabled{cursor:default!important;opacity:.5}";
      const fitTooltip = () => {
        const availableWidth = controls.getBoundingClientRect().right - 8;
        tooltip.style.maxWidth = `${Math.min(400, availableWidth)}px`;
      };
      controls.addEventListener("pointerenter", fitTooltip);
      controls.addEventListener("focusin", fitTooltip);
      controls.append(styles, button, tooltip);
      return controls;
    };
    const createSelector = () => {
      const container = document.createElement("div");
      const content = document.createElement("div");
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
      content.append(createUsage(), createSpeedControls());
      container.append(content);
      for (const eventName of ["pointerdown", "mousedown", "click"]) {
        container.addEventListener(eventName, event => {
          event.stopPropagation();
        }, eventName !== "click");
      }
      syncUsage(container);
      syncSpeedButton(container);
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

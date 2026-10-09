import { createElement, useCallback, useState } from "react";
import { Modal } from "antd";
import {
  activateAggregateApi,
  activateProvider,
  activateProviderGroup,
  deactivateProvider,
  queryProviderBalance,
  removeAggregateApi,
  removeProvider,
  saveAggregateApiProfile,
  saveProviderProfile,
  setLocalProxyAutoDisableUnreachable,
  setLocalProxyCustomPriority,
  setLocalProxyCustomThreshold,
  setLocalProxyServiceTier,
  setLocalProxyGlobalThreshold,
  setLocalProxyImageAccount,
  setLocalProxyImageModelTarget,
  setLocalProxyOpenaiAuthAccount,
  setLocalProxyListenOnAllInterfaces,
  setLocalProxyAutoSwitch,
  setLocalProxyConcurrentRouting,
  setSystemPromptFilterEnabled,
  setSystemPromptFilterRules,
  setSystemPromptInjectionEnabled,
  setSystemPromptInjectionPrompts,
  setProviderModelControl,
  setProviderGroup,
  setProviderAutoSwitchEnabled,
  startLocalProxy,
  stopLocalProxy,
  stopLocalProxyWithoutMigrating,
  subscribeToLocalProxyStartProgress,
  subscribeToLocalProxyStopProgress,
  switchProviderModel,
} from "../api/backend";
import type { Translate } from "../i18n";
import type {
  AggregateApiInput,
  LocalProxyStartProgress,
  LocalProxyStopProgress,
  ImageModelTarget,
  ImageRouteKind,
  ProviderInput,
  ProxyServiceTier,
  SystemPromptRule,
} from "../types";
import { useProviderData } from "./useProviderData";
import { runSwitchFollowUp } from "./switchFollowUp";

interface ProviderCloudSync {
  pushProvider?: (id: string) => Promise<void> | void;
  deleteProvider?: (id: string) => Promise<void> | void;
}

function providerErrorMessage(error: unknown, t: Translate) {
  const message = String(error);
  if (message.includes("conversation history could not be synchronized")
    && message.includes("ChatGPT/Codex could not be restarted")) {
    return t("providers.error.proxyStartSyncAndRestartFailed");
  }
  if (message.includes("Local proxy was started, but conversation history could not be synchronized")) {
    return t("providers.error.proxyStartSyncFailed");
  }
  if (message.includes("Local proxy was started and conversation history was synchronized")) {
    return t("providers.error.proxyStartedRestartFailed");
  }
  if (message.includes("Proxy stop was cancelled because conversation history could not be restored safely")) {
    return t("providers.error.proxyStopCancelled");
  }
  if (message.includes("Proxy stop failed and automatic recovery was incomplete")) {
    return t("providers.error.proxyStopRecoveryIncomplete");
  }
  if (message.includes("Local proxy was stopped, the selected auth.json and non-proxy conversations were restored")) {
    return t("providers.error.proxyStoppedRestartFailed");
  }
  if (message.includes("Local proxy was stopped without migrating conversations")) {
    return t("providers.error.proxyStoppedWithoutMigrationRestartFailed");
  }
  if (message.includes("API key is required for a new provider")) return t("providers.error.apiKeyRequired");
  if (message.includes("Provider does not exist")) return t("providers.error.notFound");
  if (message.includes("Chat Completions providers need a local Responses bridge")) {
    return t("providers.error.chatBridgeRequired");
  }
  if (message.includes("Third-party Providers require the local proxy")) {
    return t("providers.error.proxyRequired");
  }
  if (message.includes("Start the local proxy before changing request speed")) {
    return t("usage.speedProxyRequired");
  }
  if (message.includes("Fast mode is not available for the current provider")) {
    return t("usage.speedUnavailable");
  }
  if (message.includes("Provider API key is empty")) return t("providers.error.apiKeyEmpty");
  if (message.includes("Provider name is required")) return t("providers.error.nameRequired");
  if (message.includes("Aggregate API name is required")) return t("providers.aggregate.error.nameRequired");
  if (message.includes("Select at least two APIs")) return t("providers.aggregate.error.membersRequired");
  if (message.includes("Every API in an aggregate must support")) {
    return t("providers.aggregate.error.modelMismatch");
  }
  if (message.includes("Aggregate API does not exist")) return t("providers.aggregate.error.notFound");
  if (message.includes("Enable the aggregate API")) return t("providers.aggregate.error.disabled");
  if (message.includes("Model is required")) return t("providers.error.modelRequired");
  if (message.includes("Base URL is required")) return t("providers.error.baseUrlRequired");
  if (message.includes("Base URL must be an http:// or https:// URL with a host")) {
    return t("providers.error.baseUrlHttp");
  }
  if (message.includes("Provider Base URL must be an upstream API endpoint")) {
    return t("providers.error.baseUrlLocalProxy");
  }
  if (message.includes("Official Codex local proxy requires")) return t("providers.error.officialProxyAuthRequired");
  if (message.includes("Provider id is invalid")) return t("providers.error.providerIdInvalid");
  if (message.includes("Stop the active Provider group")) return t("providers.error.stopGroupFirst");
  if (message.includes("Provider group does not contain")) return t("providers.error.groupEmpty");
  if (message.includes("Select a Provider group")) return t("providers.error.groupRequired");
  if (message.includes("unique API and model names")) return t("providers.error.groupModelDuplicate");
  if (message.includes("Provider balance query token is required")) {
    return t("providers.error.balanceTokenRequired");
  }
  if (message.includes("Provider balance query URL is required")) {
    return t("providers.error.balanceUrlRequired");
  }
  if (message.includes("Provider balance query URL must be an http:// or https:// URL with a host")) {
    return t("providers.error.balanceUrlHttp");
  }
  if (message.startsWith("Provider balance query URL is invalid:")) {
    return t("providers.error.balanceUrlInvalid", {
      error: message.slice("Provider balance query URL is invalid:".length).trim(),
    });
  }
  if (message.includes("New API wallet username and password must be provided together")) {
    return t("providers.error.walletLoginRequired");
  }
  if (message.includes("New API wallet password is required when changing the username")) {
    return t("providers.error.walletPasswordRequired");
  }
  if (message.includes("Image generation account must use an OAuth token")) {
    return t("providers.error.imageAccountOAuthRequired");
  }
  if (message.includes("Start the local proxy before selecting an image generation account")) {
    return t("providers.error.imageAccountProxyRequired");
  }
  if (message.includes("Start the local proxy before selecting an image model")) {
    return t("providers.error.imageAccountProxyRequired");
  }
  if (message.includes("Image output account must use an OAuth token")) {
    return t("providers.error.imageAccountOAuthRequired");
  }
  if (message.includes("The selected image model is not available for this Provider")) {
    return t("providers.error.imageModelUnavailable");
  }
  if (message.includes("The selected Provider model does not support image input")) {
    return t("providers.error.imageInputUnsupported");
  }
  if (message.includes("OpenAI login account must use an OAuth token")) {
    return t("providers.error.openaiAuthAccountOAuthRequired");
  }
  if (message.includes("Start the local proxy before selecting an OpenAI login account")) {
    return t("providers.error.openaiAuthAccountProxyRequired");
  }
  if (message.includes("Enable at least one official account")) {
    return t("providers.error.concurrentRoutingAccountRequired");
  }
  if (message.includes("API key is required before listening on the local network")) {
    return t("providers.error.lanApiKeyRequired");
  }
  if (message.startsWith("Base URL is invalid:")) {
    return t("providers.error.baseUrlInvalid", { error: message.slice("Base URL is invalid:".length).trim() });
  }
  return message;
}

export function useProviderManager(
  notify: (message: string) => void,
  t: Translate,
  cloudSync?: ProviderCloudSync,
) {
  const { providers, aggregateApis, localProxy, loading, load, setLocalProxy } = useProviderData(notify);
  const [busyProviderId, setBusyProviderId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [proxyBusy, setProxyBusy] = useState(false);
  const [proxyStartProgress, setProxyStartProgress] = useState<LocalProxyStartProgress | null>(null);
  const [proxyStopProgress, setProxyStopProgress] = useState<LocalProxyStopProgress | null>(null);

  const saveProvider = useCallback(async (provider: ProviderInput) => {
    setSaving(true);
    try {
      const saved = await saveProviderProfile(provider);
      notify(t("toast.providerSaved"));
      await load();
      await cloudSync?.pushProvider?.(saved.id);
      return saved;
    } catch (error) {
      notify(providerErrorMessage(error, t));
      return null;
    } finally {
      setSaving(false);
    }
  }, [cloudSync, load, notify, t]);

  const saveAggregateApi = useCallback(async (aggregate: AggregateApiInput) => {
    setSaving(true);
    try {
      const saved = await saveAggregateApiProfile(aggregate);
      notify(t("toast.aggregateApiSaved"));
      await load();
      return saved;
    } catch (error) {
      notify(providerErrorMessage(error, t));
      return null;
    } finally {
      setSaving(false);
    }
  }, [load, notify, t]);

  const switchAggregateApi = useCallback(async (id: string) => {
    setBusyProviderId(`aggregate:${id}`);
    try {
      await activateAggregateApi(id);
      notify(t("toast.aggregateApiSwitched"));
      await load();
      return true;
    } catch (error) {
      notify(providerErrorMessage(error, t));
      return false;
    } finally {
      setBusyProviderId(null);
    }
  }, [load, notify, t]);

  const deleteAggregateApi = useCallback(async (id: string) => {
    setBusyProviderId(`aggregate:${id}`);
    try {
      await removeAggregateApi(id);
      notify(t("toast.aggregateApiDeleted"));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setBusyProviderId(null);
    }
  }, [load, notify, t]);

  const switchProvider = useCallback(async (id: string) => {
    setBusyProviderId(id);
    try {
      const refreshesBalance = providers.some(
        (provider) => provider.id === id && Boolean(provider.balancePlatform),
      );
      await activateProvider(id);
      notify(t("toast.providerSwitchedHot"));
      await load();
      if (refreshesBalance) runSwitchFollowUp(() => queryProviderBalance(id));
      return true;
    } catch (error) {
      notify(providerErrorMessage(error, t));
      return false;
    } finally {
      setBusyProviderId(null);
    }
  }, [load, notify, providers, t]);

  const switchProviderGroup = useCallback(async (group: string) => {
    setBusyProviderId(`group:${group}`);
    try {
      await activateProviderGroup(group);
      notify(t("toast.providerGroupSwitched", { group }));
      await load();
      return true;
    } catch (error) {
      notify(providerErrorMessage(error, t));
      return false;
    } finally {
      setBusyProviderId(null);
    }
  }, [load, notify, t]);

  const cancelProviderUse = useCallback(async (id: string) => {
    setBusyProviderId(id);
    try {
      await deactivateProvider();
      notify(t("toast.providerUseCancelled"));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setBusyProviderId(null);
    }
  }, [load, notify, t]);

  const switchModel = useCallback(async (id: string, model: string) => {
    setBusyProviderId(id);
    try {
      await switchProviderModel(id, model);
      notify(t("toast.providerModelSwitched"));
      await load();
      runSwitchFollowUp(() => cloudSync?.pushProvider?.(id));
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setBusyProviderId(null);
    }
  }, [cloudSync, load, notify, t]);

  const setModelControl = useCallback(async (id: string, controlledByCodex: boolean) => {
    setBusyProviderId(id);
    try {
      await setProviderModelControl(id, controlledByCodex);
      notify(t("toast.providerModelControlSaved"));
      await load();
      await cloudSync?.pushProvider?.(id);
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setBusyProviderId(null);
    }
  }, [cloudSync, load, notify, t]);

  const changeProviderGroup = useCallback(async (id: string, group: string) => {
    setBusyProviderId(id);
    try {
      await setProviderGroup(id, group);
      notify(t(group.trim() ? "toast.providerGroupSaved" : "toast.providerGroupCleared"));
      await load();
      await cloudSync?.pushProvider?.(id);
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setBusyProviderId(null);
    }
  }, [cloudSync, load, notify, t]);

  const changeProviderGroups = useCallback(async (ids: string[], group: string) => {
    const uniqueIds = [...new Set(ids)];
    const changedIds: string[] = [];
    let firstError: string | null = null;
    setBusyProviderId("group:batch");
    try {
      for (const id of uniqueIds) {
        setBusyProviderId(id);
        try {
          await setProviderGroup(id, group);
          changedIds.push(id);
          await cloudSync?.pushProvider?.(id);
        } catch (error) {
          firstError ??= providerErrorMessage(error, t);
        }
      }
      if (firstError) notify(firstError);
      if (changedIds.length) {
        notify(t(group.trim() ? "toast.providerGroupsSaved" : "toast.providerGroupsCleared", {
          count: changedIds.length,
        }));
        await load();
      }
      return changedIds;
    } finally {
      setBusyProviderId(null);
    }
  }, [cloudSync, load, notify, t]);

  const setProviderAutoSwitch = useCallback(async (id: string, enabled: boolean) => {
    setBusyProviderId(id);
    try {
      await setProviderAutoSwitchEnabled(id, enabled);
      notify(t(enabled
        ? "toast.providerAutoSwitchEnabled"
        : "toast.providerAutoSwitchDisabled"));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setBusyProviderId(null);
    }
  }, [load, notify, t]);

  const deleteProvider = useCallback(async (id: string) => {
    setBusyProviderId(id);
    try {
      await removeProvider(id);
      notify(t("toast.providerDeleted"));
      await load();
      await cloudSync?.deleteProvider?.(id);
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setBusyProviderId(null);
    }
  }, [cloudSync, load, notify, t]);

  const deleteProviders = useCallback(async (ids: string[]) => {
    const uniqueIds = [...new Set(ids)];
    const deletedIds: string[] = [];
    setBusyProviderId(uniqueIds[0] ?? null);
    try {
      for (const id of uniqueIds) {
        setBusyProviderId(id);
        try {
          await removeProvider(id);
          deletedIds.push(id);
          await cloudSync?.deleteProvider?.(id);
        } catch (error) {
          notify(providerErrorMessage(error, t));
        }
      }
      if (deletedIds.length) {
        notify(t("toast.providersDeleted", { count: deletedIds.length }));
        await load();
      }
      return deletedIds;
    } finally {
      setBusyProviderId(null);
    }
  }, [cloudSync, load, notify, t]);

  const startProxy = useCallback(async () => {
    setProxyBusy(true);
    setProxyStartProgress({ phase: "preparingClient", percent: 3 });
    const unsubscribeProgress = subscribeToLocalProxyStartProgress((progress) => {
      setProxyStartProgress(progress);
    });
    const fakeProgressTimer = window.setInterval(() => {
      setProxyStartProgress((current) => {
        if (!current || current.phase === "complete" || current.phase === "failed") return current;
        const ceiling = current.phase === "preparingClient" ? 12
          : current.phase === "startingProxy" ? 35
            : current.phase === "syncingConversations" ? 88
              : 98;
        if (current.percent >= ceiling) return current;
        return { ...current, percent: Math.min(ceiling, current.percent + 1) };
      });
    }, 700);
    try {
      setLocalProxy(await startLocalProxy());
      setProxyStartProgress({ phase: "complete", percent: 100 });
      notify(t("toast.localProxyStarted"));
      await load();
      await new Promise((resolve) => window.setTimeout(resolve, 650));
    } catch (error) {
      const startCompleted = String(error).includes(
        "Local proxy was started and conversation history was synchronized",
      );
      setProxyStartProgress((current) => ({
        phase: startCompleted ? "complete" : "failed",
        percent: startCompleted ? 100 : Math.max(current?.percent ?? 0, 3),
      }));
      notify(providerErrorMessage(error, t));
      // Configuration is kept when only the client relaunch fails, so ensure the
      // card reflects the running proxy before the user starts it manually.
      await load();
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    } finally {
      window.clearInterval(fakeProgressTimer);
      unsubscribeProgress();
      setProxyStartProgress(null);
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const stopProxyAttempt = useCallback(async (withoutMigration: boolean, providerWasActive: boolean) => {
    setProxyBusy(true);
    setProxyStopProgress({ phase: "stoppingClient", percent: 3 });
    const unsubscribeProgress = subscribeToLocalProxyStopProgress(setProxyStopProgress);
    const fakeProgressTimer = window.setInterval(() => {
      setProxyStopProgress((current) => {
        if (!current || current.phase === "complete" || current.phase === "failed") return current;
        const ceiling = current.phase === "stoppingClient" ? 10
          : current.phase === "restoringConversations" ? 88
            : current.phase === "skippingConversations" ? 88
              : current.phase === "restoringConfiguration" ? 94
                : 98;
        if (current.percent >= ceiling) return current;
        return { ...current, percent: Math.min(ceiling, current.percent + 1) };
      });
    }, 700);
    let canRetryWithoutMigration = false;
    try {
      const status = withoutMigration
        ? await stopLocalProxyWithoutMigrating()
        : await stopLocalProxy();
      setLocalProxy(status);
      setProxyStopProgress({ phase: "complete", percent: 100 });
      notify(t(providerWasActive
        ? "toast.localProxyStoppedProviderDeselected"
        : "toast.localProxyStopped"));
      await load();
      await new Promise((resolve) => window.setTimeout(resolve, 650));
    } catch (error) {
      const stopCompleted = String(error).includes(
        "Local proxy was stopped, the selected auth.json and non-proxy conversations were restored",
      );
      canRetryWithoutMigration = !withoutMigration && !stopCompleted;
      setProxyStopProgress((current) => ({
        phase: stopCompleted ? "complete" : "failed",
        percent: stopCompleted ? 100 : Math.max(current?.percent ?? 0, 3),
      }));
      notify(providerErrorMessage(error, t));
      await load();
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    } finally {
      window.clearInterval(fakeProgressTimer);
      unsubscribeProgress();
      setProxyStopProgress(null);
      setProxyBusy(false);
    }
    return canRetryWithoutMigration;
  }, [load, notify, t]);

  const confirmStopWithoutMigration = useCallback(() => new Promise<boolean>((resolve) => {
    Modal.confirm({
      title: t("providers.proxy.stopFailedConfirmTitle"),
      content: createElement(
        "span",
        { className: "compact-confirm-copy" },
        t("providers.proxy.stopFailedConfirmDescription"),
      ),
      okText: t("providers.proxy.keepRunning"),
      cancelText: t("providers.proxy.stopWithoutMigration"),
      okType: "primary",
      cancelButtonProps: { danger: true },
      closable: false,
      maskClosable: false,
      keyboard: false,
      onOk: () => resolve(false),
      onCancel: () => resolve(true),
    });
  }), [t]);

  const stopProxy = useCallback(async () => {
    const providerWasActive = providers.some((provider) => provider.active);
    const canRetryWithoutMigration = await stopProxyAttempt(false, providerWasActive);
    if (canRetryWithoutMigration && await confirmStopWithoutMigration()) {
      await stopProxyAttempt(true, providerWasActive);
    }
  }, [confirmStopWithoutMigration, providers, stopProxyAttempt]);

  const setProxyAutoSwitch = useCallback(async (enabled: boolean) => {
    setProxyBusy(true);
    try {
      setLocalProxy(await setLocalProxyAutoSwitch(enabled));
      notify(t(enabled ? "toast.proxyAutoSwitchEnabled" : "toast.proxyAutoSwitchDisabled"));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const setProxyAutoDisableUnreachable = useCallback(async (enabled: boolean) => {
    setProxyBusy(true);
    try {
      setLocalProxy(await setLocalProxyAutoDisableUnreachable(enabled));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const setProxyCustomPriority = useCallback(async (enabled: boolean) => {
    setProxyBusy(true);
    try {
      setLocalProxy(await setLocalProxyCustomPriority(enabled));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const setProxyServiceTier = useCallback(async (serviceTier: ProxyServiceTier) => {
    setProxyBusy(true);
    try {
      setLocalProxy(await setLocalProxyServiceTier(serviceTier));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const setProxyCustomThreshold = useCallback(async (enabled: boolean) => {
    setProxyBusy(true);
    try {
      setLocalProxy(await setLocalProxyCustomThreshold(enabled));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const setProxyGlobalThreshold = useCallback(async (threshold: number) => {
    setProxyBusy(true);
    try {
      setLocalProxy(await setLocalProxyGlobalThreshold(threshold));
      notify(t("toast.proxyGlobalThresholdSaved"));
      await load();
      return true;
    } catch (error) {
      notify(providerErrorMessage(error, t));
      return false;
    } finally {
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const setProxyImageAccount = useCallback(async (accountId: string | null) => {
    setProxyBusy(true);
    try {
      setLocalProxy(await setLocalProxyImageAccount(accountId));
      notify(t("toast.proxyImageAccountSaved"));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const setProxyImageModel = useCallback(async (
    routeKind: ImageRouteKind,
    target: ImageModelTarget | null,
  ) => {
    setProxyBusy(true);
    try {
      setLocalProxy(await setLocalProxyImageModelTarget(routeKind, target));
      notify(t(routeKind === "input"
        ? "toast.proxyImageInputModelSaved"
        : "toast.proxyImageOutputModelSaved"));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const setProxyOpenaiAuthAccount = useCallback(async (accountId: string | null) => {
    setProxyBusy(true);
    try {
      setLocalProxy(await setLocalProxyOpenaiAuthAccount(accountId));
      notify(t(accountId
        ? "toast.proxyOpenaiAuthAccountSaved"
        : "toast.proxyOpenaiAuthAccountCleared"));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
      await load();
    } finally {
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const setProxyListenOnAllInterfaces = useCallback(async (enabled: boolean, apiKey?: string) => {
    setProxyBusy(true);
    try {
      setLocalProxy(await setLocalProxyListenOnAllInterfaces(enabled, apiKey));
      const keyOnlyUpdate = Boolean(apiKey?.trim()) && enabled === localProxy?.listenOnAllInterfaces;
      const listeningMessage = enabled ? "toast.proxyLanListeningEnabled" : "toast.proxyLanListeningDisabled";
      notify(t(keyOnlyUpdate ? "toast.proxyLanApiKeySaved" : listeningMessage));
      await load();
      return true;
    } catch (error) {
      notify(providerErrorMessage(error, t));
      await load();
      return false;
    } finally {
      setProxyBusy(false);
    }
  }, [load, localProxy?.listenOnAllInterfaces, notify, t]);

  const setProxyConcurrentRouting = useCallback(async (
    enabled: boolean,
    accountGroup: string | null = null,
  ) => {
    setProxyBusy(true);
    try {
      setLocalProxy(await setLocalProxyConcurrentRouting(enabled, accountGroup));
      notify(t(enabled
        ? "toast.proxyConcurrentRoutingEnabled"
        : "toast.proxyConcurrentRoutingDisabled"));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const setSystemPromptFilter = useCallback(async (enabled: boolean) => {
    setProxyBusy(true);
    try {
      setLocalProxy(await setSystemPromptFilterEnabled(enabled));
      notify(t(enabled ? "toast.systemPromptFilterEnabled" : "toast.systemPromptFilterDisabled"));
      await load();
    } catch (error) {
      notify(String(error));
    } finally {
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const saveSystemPromptFilterRules = useCallback(async (rules: SystemPromptRule[]) => {
    setProxyBusy(true);
    try {
      setLocalProxy(await setSystemPromptFilterRules(rules));
      notify(t("toast.systemPromptFilterRulesSaved"));
      await load();
      return true;
    } catch (error) {
      notify(String(error));
      return false;
    } finally {
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const setSystemPromptInjection = useCallback(async (enabled: boolean) => {
    setProxyBusy(true);
    try {
      setLocalProxy(await setSystemPromptInjectionEnabled(enabled));
      notify(t(enabled ? "toast.systemPromptInjectionEnabled" : "toast.systemPromptInjectionDisabled"));
      await load();
    } catch (error) {
      notify(String(error));
    } finally {
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const saveSystemPromptInjectionPrompts = useCallback(async (prompts: SystemPromptRule[]) => {
    setProxyBusy(true);
    try {
      setLocalProxy(await setSystemPromptInjectionPrompts(prompts));
      notify(t("toast.systemPromptInjectionPromptsSaved"));
      await load();
      return true;
    } catch (error) {
      notify(String(error));
      return false;
    } finally {
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  return {
    providers,
    aggregateApis,
    refreshAggregateApis: load,
    localProxy,
    loading,
    busyProviderId,
    saving,
    proxyBusy,
    proxyStartProgress,
    proxyStopProgress,
    activeProvider: providers.find((provider) => provider.active) ?? null,
    saveProvider,
    saveAggregateApi,
    switchAggregateApi,
    deleteAggregateApi,
    switchProvider,
    switchProviderGroup,
    cancelProviderUse,
    switchModel,
    setModelControl,
    changeProviderGroup,
    changeProviderGroups,
    setProviderAutoSwitch,
    deleteProvider,
    deleteProviders,
    startProxy,
    stopProxy,
    setProxyServiceTier,
    setProxyAutoSwitch,
    setProxyConcurrentRouting,
    setProxyAutoDisableUnreachable,
    setProxyCustomPriority,
    setProxyCustomThreshold,
    setProxyGlobalThreshold,
    setProxyImageAccount,
    setProxyImageModel,
    setProxyOpenaiAuthAccount,
    setProxyListenOnAllInterfaces,
    setSystemPromptFilter,
    saveSystemPromptFilterRules,
    setSystemPromptInjection,
    saveSystemPromptInjectionPrompts,
    reload: load,
  };
}

import { useEffect, useRef, type ReactNode } from "react";
import { isDesktopApp } from "../../api/backend";
import type { Account, Provider } from "../../types";
import type { SkillsMarketPageProps } from "../skillsMarket/types";
import { CodexGuiPage } from "../CodexGuiPage";
import { ProxyAccountPicker } from "./ProxyAccountPicker";
import { useGuiAccountSelection } from "./useGuiAccountSelection";
import { useGuiComputers } from "./remote/useGuiComputers";
import { useGuiLayout } from "./useGuiLayout";
import { GuiHostPicker } from "../../../../../shared/conversation/GuiHostPicker";
import { RemoteGuiWorkspaces } from "./remote/RemoteGuiWorkspaces";
import type { ThreadNavigation } from "./useNotificationNavigation";

export function GuiWorkspace(props: {
  active: boolean; accounts: Account[]; providers: Provider[]; privacyMode: boolean;
  loading: boolean; windowControls?: ReactNode;
  notificationTarget?: ThreadNavigation;
  plugins: Omit<SkillsMarketPageProps, "active">;
}) {
  const computers = useGuiComputers({ active: props.active, login: props.plugins.onLogin,
    identity: props.plugins.authenticated && props.plugins.baseUrl && props.plugins.currentUserId
      ? { baseUrl: props.plugins.baseUrl, userId: props.plugins.currentUserId } : null });
  const { choose } = computers;
  const notificationRequest = props.notificationTarget?.requestId;
  const handledNotification = useRef<string>();
  useEffect(() => {
    if (!notificationRequest || handledNotification.current === notificationRequest) return;
    handledNotification.current = notificationRequest;
    choose(null);
  }, [notificationRequest, choose]);
  const remote = isDesktopApp ? computers.current : null;
  const localActive = props.active && !remote;
  const focusMode = useGuiLayout(props.active);
  const selection = useGuiAccountSelection({ ...props, active: localActive });
  return <><div hidden={Boolean(remote)} style={{ height: '100%' }}>
    <CodexGuiPage active={localActive} notificationTarget={props.notificationTarget}
    syncComputers={computers}
    focusMode={focusMode} providers={selection.providers} aggregateApis={selection.aggregateApis ?? []}
    hostPicker={isDesktopApp && <GuiHostPicker navigation={computers} active={localActive} />}
    windowControls={props.windowControls} plugins={props.plugins} accountPicker={
      <ProxyAccountPicker active={localActive} computers={isDesktopApp ? computers : undefined}
        accounts={selection.accounts} providers={selection.providers}
        aggregateApis={selection.aggregateApis ?? []} privacyMode={props.privacyMode}
        busy={false} loading={props.loading || selection.loading} selectionError={selection.error}
        onSwitchAccount={selection.switchAccount} onSwitchProvider={selection.switchProvider}
        onSwitchAggregate={selection.switchAggregate} />
    } /></div>
    {isDesktopApp && computers.identity &&
      <RemoteGuiWorkspaces key={JSON.stringify([computers.identity.baseUrl, computers.identity.userId])}
        active={props.active} current={remote} identity={computers.identity} computers={computers}
        privacyMode={props.privacyMode} focusMode={focusMode} windowControls={props.windowControls} />
    }
  </>;
}

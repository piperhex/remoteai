import { copyText } from "../../../../../shared/clipboard";
import { Button } from "antd";
import { Copy } from "lucide-react";
import { LOOPBACK_IPV4 } from "../../api/proxyEndpoints";
import type { useProxyEndpointAddresses } from "../../hooks/useProxyEndpointAddresses";
import type { Translate } from "../../i18n";

interface ProxyEndpointListProps {
  endpoints: ReturnType<typeof useProxyEndpointAddresses>;
  port: number | undefined;
  listenOnAllInterfaces: boolean;
  notify: (message: string) => void;
  t: Translate;
}

export function ProxyEndpointList({ endpoints, port, listenOnAllInterfaces, notify, t }: ProxyEndpointListProps) {
  const { addresses, loading, failed } = endpoints;
  const copyEndpoint = async (endpoint: string) => {
    try {
      await copyText(endpoint);
      notify(t("providers.proxy.endpointCopied"));
    } catch {
      notify(t("providers.proxy.endpointCopyFailed"));
    }
  };

  return (
    <section className="proxy-settings-section" aria-labelledby="proxy-endpoints-title">
      <h3 id="proxy-endpoints-title">{t("providers.proxy.endpoints")}</h3>
      {Boolean(port) && <ul className="proxy-settings-endpoints">
        {addresses.map((address) => {
          const endpoint = `http://${address}:${port}/v1`;
          return (
            <li key={address}>
              <div>
                <small>{t(address === LOOPBACK_IPV4
                  ? "providers.proxy.localEndpoint" : "providers.proxy.lanEndpoint")}</small>
                <code>{endpoint}</code>
              </div>
              <Button type="text" size="small" icon={<Copy size={14} />}
                aria-label={`${t("providers.proxy.copyEndpoint")}: ${endpoint}`}
                onClick={() => void copyEndpoint(endpoint)} />
            </li>
          );
        })}
      </ul>}
      {!port && <p>{t("providers.proxy.endpointsUnavailable")}</p>}
      {loading && <p role="status">{t("providers.proxy.loadingAddresses")}</p>}
      {failed && <p role="status">{t("providers.proxy.addressesFailed")}</p>}
      {!listenOnAllInterfaces && <p>{t("providers.proxy.endpointLanHint")}</p>}
    </section>
  );
}

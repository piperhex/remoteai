#import <Network/Network.h>
#import <WebKit/WebKit.h>
#include <stdbool.h>

bool configure_mapping_domains(WKWebView *view, uint16_t port, const char *domains) {
    if (@available(macOS 14.0, *)) {
        NSString *service = [@(port) stringValue];
        nw_endpoint_t endpoint = nw_endpoint_create_host("127.0.0.1", service.UTF8String);
        nw_proxy_config_t proxy = nw_proxy_config_create_socksv5(endpoint);
        if (!proxy) return false;
        for (NSString *domain in [[NSString stringWithUTF8String:domains] componentsSeparatedByString:@","]) {
            nw_proxy_config_add_match_domain(proxy, domain.UTF8String);
        }
        view.configuration.websiteDataStore.proxyConfigurations = @[proxy];
        return true;
    }
    return false;
}

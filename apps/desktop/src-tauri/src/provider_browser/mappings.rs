//! Select an isolated browser environment when opening a locally running mapping.
use super::{BrowserError, Result};
use csw_chat_connectivity::browser_mapping::{BrowserMappingProxy, BrowserRoute};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Mutex,
};
use tauri::{Manager, Webview};
#[cfg(windows)]
mod loopback;

#[derive(Default)]
pub(crate) struct State {
    proxy: tokio::sync::OnceCell<BrowserMappingProxy>,
    active: Mutex<BTreeSet<BrowserRoute>>,
    tabs: Mutex<BTreeMap<String, BrowserMapping>>,
    #[cfg(windows)]
    aliases: Mutex<BTreeMap<BrowserRoute, loopback::Alias>>,
}

impl State {
    pub(super) fn revoke(&self) -> Result<()> {
        let mut active = self.active.lock().map_err(|_| BrowserError::Unavailable)?;
        if let Some(proxy) = self.proxy.get() {
            proxy
                .configure(BTreeSet::new())
                .map_err(|_| BrowserError::Unavailable)?;
        }
        active.clear();
        #[cfg(windows)]
        self.aliases
            .lock()
            .map_err(|_| BrowserError::Unavailable)?
            .clear();
        Ok(())
    }
    async fn configure(&self, routes: BTreeSet<BrowserRoute>) -> Result<()> {
        if routes.is_empty() && !self.proxy.initialized() {
            return Ok(());
        }
        let proxy = self
            .proxy
            .get_or_try_init(|| BrowserMappingProxy::start(BTreeSet::new()))
            .await
            .map_err(|_| BrowserError::Unavailable)?;
        let mut active = self.active.lock().map_err(|_| BrowserError::Unavailable)?;
        if !BrowserRoute::valid_set(&routes)
            || routes
                .iter()
                .any(|r| matches!(r.domain.as_str(), "tauri.localhost" | "ipc.localhost"))
        {
            return Err(BrowserError::Invalid);
        }
        #[cfg(windows)]
        let additions = {
            let aliases = self.aliases.lock().map_err(|_| BrowserError::Unavailable)?;
            let mut additions = BTreeMap::new();
            for route in &routes {
                if route.domain != "localhost" && !route.domain.ends_with(".localhost") {
                    continue;
                }
                if let Some(target) = route.target.filter(|_| !aliases.contains_key(route)) {
                    additions.insert(
                        route.clone(),
                        loopback::Alias::bind(target).map_err(|_| BrowserError::Unavailable)?,
                    );
                }
            }
            additions
        };
        proxy
            .configure(routes.clone())
            .map_err(|_| BrowserError::Invalid)?;
        #[cfg(windows)]
        {
            let mut aliases = self.aliases.lock().map_err(|_| BrowserError::Unavailable)?;
            aliases.retain(|route, _| routes.contains(route));
            aliases.extend(additions);
        }
        *active = routes;
        Ok(())
    }
}

#[tauri::command]
pub(crate) async fn configure_browser_mappings(
    webview: Webview,
    routes: BTreeSet<BrowserRoute>,
) -> std::result::Result<(), String> {
    if webview.label() != "main" {
        return Err(BrowserError::Invalid.to_string());
    }
    webview
        .state::<State>()
        .configure(routes)
        .await
        .map_err(|e| e.to_string())
}

#[derive(Clone, Eq, PartialEq, serde::Serialize)]
pub(super) struct BrowserMapping {
    routes: BTreeSet<BrowserRoute>,
    proxy: u16,
    #[cfg(windows)]
    resolver_rules: String,
}

pub(super) fn lookup(owner: &Webview, url: &url::Url) -> Result<Option<BrowserMapping>> {
    #[cfg(target_os = "macos")]
    if !objc2::available!(macos = 14.0) {
        return Ok(None);
    }
    let Some(state) = owner.try_state::<State>() else {
        return Ok(None);
    };
    let Some(proxy) = state.proxy.get() else {
        return Ok(None);
    };
    let active = state.active.lock().map_err(|_| BrowserError::Unavailable)?;
    if !active.iter().any(|r| {
        Some(r.domain.as_str()) == url.host_str() && Some(r.port) == url.port_or_known_default()
    }) {
        return Ok(None);
    }
    let mapping = BrowserMapping {
        routes: active.clone(),
        proxy: proxy.port(),
        #[cfg(windows)]
        resolver_rules: state
            .aliases
            .lock()
            .map_err(|_| BrowserError::Unavailable)?
            .iter()
            .map(|(r, a)| format!("MAP {}:{} 127.0.0.1:{}", r.domain, r.port, a.port))
            .collect::<Vec<_>>()
            .join(", "),
    };
    Ok(Some(mapping))
}

pub(super) fn remember(
    owner: &Webview,
    label: &str,
    mapping: Option<&BrowserMapping>,
) -> Result<()> {
    if let Some(state) = owner.try_state::<State>() {
        let mut tabs = state.tabs.lock().map_err(|_| BrowserError::Unavailable)?;
        match mapping {
            Some(mapping) => {
                tabs.insert(label.to_owned(), mapping.clone());
            }
            None => {
                tabs.remove(label);
            }
        }
    }
    Ok(())
}

pub(super) fn matches(
    owner: &Webview,
    label: &str,
    mapping: Option<&BrowserMapping>,
) -> Result<bool> {
    let Some(state) = owner.try_state::<State>() else {
        return Ok(true);
    };
    let tabs = state.tabs.lock().map_err(|_| BrowserError::Unavailable)?;
    Ok(tabs.get(label) == mapping)
}

impl BrowserMapping {
    pub(super) fn builder(
        &self,
        owner: &Webview,
        builder: tauri::webview::WebviewBuilder<tauri::Wry>,
    ) -> Result<tauri::webview::WebviewBuilder<tauri::Wry>> {
        use sha2::{Digest, Sha256};
        let key = Sha256::digest(serde_json::to_vec(self).map_err(|_| BrowserError::Invalid)?);
        let dir = owner
            .path()
            .app_data_dir()
            .map_err(|_| BrowserError::Unavailable)?
            .join("browser-mappings")
            .join(hex::encode(key));
        // A developer can map a domain that already has a signed-in regular browsing session.
        // Keep mapped sites out of that profile and discard their site data when its session ends.
        let builder = builder.data_directory(dir).incognito(true);
        #[cfg(windows)]
        {
            use base64::{engine::general_purpose::STANDARD, Engine};
            let args =
                crate::webview_windows::browser_arguments(owner.config()).unwrap_or_default();
            let script = self.pac_script();
            Ok(builder.additional_browser_args(&format!(
                "{args} --proxy-pac-url=data:application/x-ns-proxy-autoconfig;base64,{} --host-resolver-rules=\"{}\"",
                STANDARD.encode(script), self.resolver_rules
            )))
        }
        #[cfg(target_os = "macos")]
        return Ok(builder);
        #[cfg(not(any(windows, target_os = "macos")))]
        {
            let url = format!("socks5://127.0.0.1:{}", self.proxy)
                .parse()
                .map_err(|_| BrowserError::Invalid)?;
            Ok(builder.proxy_url(url))
        }
    }

    #[cfg(target_os = "macos")]
    pub(super) fn configure_view(&self, view: &Webview) -> Result<()> {
        use std::{
            ffi::{c_char, c_void, CString},
            sync::mpsc,
            time::Duration,
        };
        extern "C" {
            fn configure_mapping_domains(
                view: *mut c_void,
                port: u16,
                domains: *const c_char,
            ) -> bool;
        }
        let domains = self
            .routes
            .iter()
            .map(|r| r.domain.as_str())
            .collect::<Vec<_>>()
            .join(",");
        let domains = CString::new(domains).map_err(|_| BrowserError::Invalid)?;
        let port = self.proxy;
        let (tx, rx) = mpsc::sync_channel(1);
        view.with_webview(move |view| {
            // SAFETY: Tauri supplies the live WKWebView on its UI thread. The string lives through this call.
            let configured =
                unsafe { configure_mapping_domains(view.inner(), port, domains.as_ptr()) };
            if tx.send(configured).is_err() {
                eprintln!("Browser mapping configuration timed out");
            }
        })
        .map_err(|_| BrowserError::Unavailable)?;
        match rx.recv_timeout(Duration::from_secs(10)) {
            Ok(true) => Ok(()),
            _ => Err(BrowserError::Unavailable),
        }
    }

    #[cfg(windows)]
    fn pac_script(&self) -> String {
        // Keep the page origin, TLS verification, WebSockets and subresource requests in Chromium's network stack.
        let addresses = self
            .routes
            .iter()
            .map(|r| format!("'{}:{}'", r.domain, r.port))
            .collect::<Vec<_>>()
            .join(",");
        format!("function FindProxyForURL(url,host){{var m=/^(https?|wss?):\\/\\/[^/]+?(?::(\\d+))?(?:\\/|$)/i.exec(url);\
            if(m && [{addresses}].indexOf(host+':'+(m[2] || (/^(https|wss)$/i.test(m[1]) ? 443 : 80)))>=0)\
            return 'SOCKS5 127.0.0.1:{}';return 'DIRECT';}}", self.proxy)
    }
}

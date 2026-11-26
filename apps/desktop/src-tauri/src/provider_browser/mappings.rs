//! Select an isolated browser environment when opening a locally running mapping.
use super::{BrowserError, Result};
use csw_chat_connectivity::browser_mapping::{BrowserMappingProxy, BrowserRoute};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Mutex,
};
use tauri::{Manager, Webview};

#[derive(Default)]
pub(crate) struct State {
    proxy: tokio::sync::OnceCell<BrowserMappingProxy>,
    active: Mutex<BTreeSet<BrowserRoute>>,
    tabs: Mutex<BTreeMap<String, BTreeSet<BrowserRoute>>>,
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
        proxy
            .configure(routes.clone())
            .map_err(|_| BrowserError::Invalid)?;
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

#[derive(Clone)]
pub(super) struct BrowserMapping {
    routes: BTreeSet<BrowserRoute>,
    proxy: u16,
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
    let route = BrowserRoute {
        domain: url.host_str().unwrap_or_default().to_owned(),
        port: url.port_or_known_default().unwrap_or_default(),
    };
    let active = state.active.lock().map_err(|_| BrowserError::Unavailable)?;
    Ok(active.contains(&route).then(|| BrowserMapping {
        routes: active.clone(),
        proxy: proxy.port(),
    }))
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
                tabs.insert(label.to_owned(), mapping.routes.clone());
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
    Ok(tabs.get(label) == mapping.map(|m| &m.routes))
}

impl BrowserMapping {
    pub(super) fn builder(
        &self,
        owner: &Webview,
        builder: tauri::webview::WebviewBuilder<tauri::Wry>,
    ) -> Result<tauri::webview::WebviewBuilder<tauri::Wry>> {
        use sha2::{Digest, Sha256};
        let key =
            Sha256::digest(serde_json::to_vec(&self.routes).map_err(|_| BrowserError::Invalid)?);
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
                "{args} --proxy-pac-url=data:application/x-ns-proxy-autoconfig;base64,{}",
                STANDARD.encode(script)
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

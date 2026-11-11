//! Source-specific authentication behind the existing official account management surface.
pub(crate) mod authorization_browser;
mod cli;
mod credentials;
mod login;
mod native;
mod oauth;
mod pkce_login;
mod refresh;
mod store;
#[cfg(test)]
mod tests;
mod vault;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Emitter, Manager, Runtime};

pub(crate) use store::{is_claude_id, list};
type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
enum Error {
    #[error("client.officialAccounts.invalidRequest")]
    Invalid,
    #[error("client.officialAccounts.storageFailed")]
    Storage,
    #[error("client.officialAccounts.cliRequired")]
    CliRequired,
    #[error("client.officialAccounts.loginFailed")]
    Login,
    #[error("client.officialAccounts.loginExpired")]
    Expired,
    #[error("client.officialAccounts.stateMismatch")]
    State,
    #[error("client.officialAccounts.signInRequired")]
    SignedOut,
    #[error("client.officialAccounts.busy")]
    Busy,
    #[error("client.officialAccounts.networkFailed")]
    Network,
    #[error("client.officialAccounts.keychainFailed")]
    Keychain,
    #[error("client.officialAccounts.credentialsChanged")]
    Changed,
    #[error("client.officialAccounts.authOverride")]
    Override,
    #[error("client.officialAccounts.openBrowserFailed")]
    Browser,
}

#[derive(Deserialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum Request {
    List,
    Start {
        account_id: Option<String>,
        method: LoginMethod,
    },
    Poll {
        login_id: String,
    },
    Submit {
        login_id: String,
        code: String,
    },
    Cancel {
        login_id: String,
    },
    Import,
    Activate {
        id: String,
    },
    Refresh {
        id: String,
    },
    Delete {
        id: String,
    },
    Deactivate,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum LoginMethod {
    Cli,
    Pkce,
}

fn serialized(value: impl Serialize) -> Result<Value> {
    serde_json::to_value(value).map_err(|_| Error::Invalid)
}

#[tauri::command]
pub(crate) async fn claude_account_request<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: Request,
) -> std::result::Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || execute(&app, request))
        .await
        .map_err(|_| Error::Storage.to_string())?
        .map_err(|error| error.to_string())
}

fn execute<R: Runtime>(app: &tauri::AppHandle<R>, request: Request) -> Result<Value> {
    let root = app.path().app_data_dir().map_err(|_| Error::Storage)?;
    let value = match request {
        Request::List => return serialized(store::list_root(&root)?),
        Request::Start { account_id, method } => {
            return serialized(match method {
                LoginMethod::Cli => login::start(&root, account_id)?,
                LoginMethod::Pkce => pkce_login::start(account_id)?,
            })
        }
        Request::Poll { login_id } => {
            return serialized(if login_id.starts_with("oauth_") {
                pkce_login::poll(&login_id)?
            } else {
                login::poll(&login_id)?
            })
        }
        Request::Submit { login_id, code } => {
            if login_id.starts_with("oauth_") {
                serialized(pkce_login::submit(&root, &login_id, &code)?)?
            } else {
                login::submit(&login_id, &code)?;
                Value::Null
            }
        }
        Request::Cancel { login_id } => {
            if login_id.starts_with("oauth_") {
                pkce_login::cancel(&login_id)?
            } else {
                login::cancel(&login_id)?
            };
            return Ok(Value::Null);
        }
        Request::Import => serialized(store::import_current(&root)?)?,
        Request::Activate { id } => {
            store::activate(&root, &id)?;
            Value::Null
        }
        Request::Refresh { id } => serialized(store::refresh(&root, &id)?)?,
        Request::Delete { id } => {
            store::delete(&root, &id)?;
            Value::Null
        }
        Request::Deactivate => {
            refresh::deactivate(&root)?;
            Value::Null
        }
    };
    app.emit("accounts-changed", ())
        .map_err(|_| Error::Storage)?;
    crate::codex_gui::web::publish(
        app,
        "codex-gui-event",
        &serde_json::json!({
            "method": "claudeAccounts/changed", "params": {}
        }),
    );
    Ok(value)
}

pub(crate) fn switch_blocking<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: String,
) -> std::result::Result<(), String> {
    execute(app, Request::Activate { id })
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub(crate) fn delete_blocking<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: String,
) -> std::result::Result<(), String> {
    execute(app, Request::Delete { id })
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub(crate) fn refresh_blocking<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
) -> std::result::Result<crate::models::UsageSummary, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| Error::Storage.to_string())?;
    store::refresh(&root, id)
        .map(|account| account.usage)
        .map_err(|error| error.to_string())
}

pub(crate) fn exists(paths: &crate::storage::Paths, id: &str) -> bool {
    is_claude_id(id)
        && paths
            .accounts
            .join(id)
            .join("claude-profile.json")
            .is_file()
}

use super::*;
mod install;
mod models;
pub(crate) use install::*;
pub(crate) use models::{Reply as ProviderMarketReply, Request as ProviderMarketRequest};
use models::{Request, Scope};

#[derive(Debug, thiserror::Error)]
enum MarketError {
    #[error("market.signIn")]
    Authentication,
    #[error("market.invalid")]
    Invalid,
    #[error("market.conflict")]
    Conflict,
    #[error("market.forbidden")]
    Forbidden,
    #[error("market.missing")]
    Missing,
    #[error("market.unavailable")]
    Unavailable,
}
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'-' | b'_'))
}
fn request_parts(request: Request) -> Result<(Method, String, Option<Value>), MarketError> {
    let path = "/provider-market";
    match request {
        Request::List {
            scope,
            search,
            page,
        } if search.len() <= 160 && (1..=10000).contains(&page) => {
            let suffix = if matches!(scope, Scope::Mine) {
                "/mine"
            } else {
                ""
            };
            let query: String = url::form_urlencoded::Serializer::new(String::new())
                .append_pair("scope", scope.query())
                .append_pair("search", &search)
                .append_pair("page", &page.to_string())
                .finish();
            Ok((Method::GET, format!("{path}{suffix}?{query}"), None))
        }
        Request::Get { id } if valid_id(&id) => Ok((Method::GET, format!("{path}/{id}"), None)),
        Request::Save {
            id,
            revision,
            published,
            draft,
        } if id.as_deref().is_none_or(valid_id) => {
            let body =
                json!({"draft": draft, "revision": revision.unwrap_or(0), "published": published});
            if body.to_string().len() > 256 * 1024 {
                return Err(MarketError::Invalid);
            }
            Ok(match id {
                Some(id) => (Method::PUT, format!("{path}/{id}"), Some(body)),
                None => (Method::POST, path.into(), Some(body)),
            })
        }
        Request::Remove { id, revision } if valid_id(&id) && revision > 0 => Ok((
            Method::DELETE,
            format!("{path}/{id}"),
            Some(json!({"revision": revision})),
        )),
        Request::Usage { id, provider_id } if valid_id(&id) && valid_id(&provider_id) => Ok((
            Method::POST,
            format!("{path}/{id}/usage"),
            Some(json!({"providerId": provider_id})),
        )),
        _ => Err(MarketError::Invalid),
    }
}
fn exchange<R: Runtime>(
    app: &tauri::AppHandle<R>,
    identity: Option<GuiCloudIdentity>,
    request: Request,
) -> Result<ProviderMarketReply, MarketError> {
    let public = matches!(
        &request,
        Request::Get { .. }
            | Request::List {
                scope: Scope::All | Scope::Official | Scope::Community,
                ..
            }
    );
    let (method, path, body) = request_parts(request)?;
    let client = api_client().map_err(|_| MarketError::Unavailable)?;
    let response = if public {
        let settings = read_app_settings(app).map_err(|_| MarketError::Unavailable)?;
        client
            .get(endpoint(&settings, &path).map_err(|_| MarketError::Unavailable)?)
            .send()
            .map_err(|_| MarketError::Unavailable)?
            .into()
    } else {
        authenticated_request(app, identity.as_ref(), (method, path, body), &client)?
    };
    read_reply(response)
}
fn authenticated_request<R: Runtime>(
    app: &tauri::AppHandle<R>,
    identity: Option<&GuiCloudIdentity>,
    request: (Method, String, Option<Value>),
    client: &Client,
) -> Result<CloudResponse, MarketError> {
    let identity = identity.ok_or(MarketError::Authentication)?;

    let (mut settings, mut credentials) =
        cloud_snapshot(app).map_err(|_| MarketError::Unavailable)?;
    if base_url(&settings).ok() != Some(identity.base_url.as_str())
        || settings.cloud_user_id.as_deref() != Some(&identity.user_id)
        || !cloud_state(&settings, &credentials).authenticated
    {
        return Err(MarketError::Authentication);
    }
    cloud_request(
        app,
        client,
        &mut settings,
        &mut credentials,
        request.0,
        &request.1,
        request.2,
    )
    .map_err(|_| MarketError::Unavailable)
}
fn read_reply(response: CloudResponse) -> Result<ProviderMarketReply, MarketError> {
    match response.status().as_u16() {
        200..=299 => (),
        400 => return Err(MarketError::Invalid),
        401 => return Err(MarketError::Authentication),
        403 => return Err(MarketError::Forbidden),
        404 => return Err(MarketError::Missing),
        409 => return Err(MarketError::Conflict),
        _ => return Err(MarketError::Unavailable),
    }
    use std::io::Read;
    const MAX_REPLY_BYTES: u64 = 16 * 1024 * 1024;
    let mut bytes = Vec::new();
    response
        .take(MAX_REPLY_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| MarketError::Unavailable)?;
    if bytes.len() as u64 > MAX_REPLY_BYTES {
        return Err(MarketError::Unavailable);
    }
    serde_json::from_slice(&bytes).map_err(|_| MarketError::Unavailable)
}
/// All credential locks, settings reads and HTTP requests run off the UI thread, including anonymous browsing.
#[tauri::command]
pub(crate) async fn cloud_provider_market(
    app: tauri::AppHandle,
    identity: Option<GuiCloudIdentity>,
    request: ProviderMarketRequest,
) -> Result<ProviderMarketReply, String> {
    tauri::async_runtime::spawn_blocking(move || exchange(&app, identity, request))
        .await
        .map_err(|_| MarketError::Unavailable.to_string())?
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_routes_and_private_fields() {
        assert!(request_parts(Request::Get {
            id: "../auth".into()
        })
        .is_err());
        assert!(
            serde_json::from_value::<Request>(json!({"type":"save", "official":true})).is_err()
        );
        let mut draft = json!({"name":"Example", "description":"", "baseUrl":"https://example.test/v1",
            "currency":"USD", "unit":"millionTokens", "models":[]});
        for key in [
            "apiKey",
            "ownerId",
            "headers",
            "requestOptions",
            "walletPassword",
            "reviewStatus",
            "reviewReason",
            "marketingBadge",
        ] {
            draft[key] = "secret".into();
            assert!(serde_json::from_value::<models::Draft>(draft.clone()).is_err());
            draft.as_object_mut().unwrap().remove(key);
        }
    }
    #[test]
    fn public_dtos_preserve_null_and_zero() {
        let value = json!({"multiplier":5.0,"input":null,"output":0.0,"cachedInput":null,
            "longContextThreshold":null,"longContext":{"input":null,"output":null,"cachedInput":null}});
        let tier: models::Tier = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(tier).unwrap(), value);
    }

    #[test]
    fn public_reply_accepts_market_metadata_with_allowlisted_draft() {
        let value = json!({"id":"entry", "ownerId":null, "official":true,"published":true,
            "revision":1,"userCount":3,"sortOrder":null,"name":"Example","description":"",
            "baseUrl":"https://example.test/v1","currency":"USD","unit":"millionTokens",
            "models":[],"balanceQuery":null,"pageLink":null});
        let reply: ProviderMarketReply = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(reply).unwrap(), value);
    }

    #[test]
    fn market_review_and_badge_survive_native_transport() {
        let value = json!({"id":"entry", "ownerId":"owner", "official":false,"published":true,
            "revision":2,"userCount":3,"sortOrder":null,"name":"Example","description":"",
            "baseUrl":"https://example.test/v1","currency":"USD","unit":"millionTokens",
            "models":[],"balanceQuery":null,"pageLink":null,"reviewStatus":"rejected",
            "reviewReason":"Update the page URL", "marketingBadge":{"text":"Offer","tone":"orange"}});
        let reply: ProviderMarketReply = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(reply).unwrap(), value);
    }
}

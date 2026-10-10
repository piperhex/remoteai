use super::*;

/// Only the main window can invite another account or answer an invitation.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum AssistanceCommand {
    List,
    Invite {
        email: String,
    },
    Respond {
        id: String,
        action: AssistanceAction,
    },
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AssistanceAction {
    Accept,
    Decline,
    End,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum AssistanceState {
    Pending,
    Accepted,
    Declined,
    Ended,
    Expired,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AssistanceInvitation {
    id: String,
    host_device_id: String,
    host_name: String,
    host_email: String,
    helper_email: String,
    helper_device_id: Option<String>,
    state: AssistanceState,
    expires_at: String,
}

#[derive(Deserialize)]
struct AssistanceList {
    requests: Vec<AssistanceInvitation>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssistanceReply {
    identity: GuiCloudIdentity,
    current_device_id: String,
    requests: Vec<AssistanceInvitation>,
}

#[derive(Debug, thiserror::Error)]
enum AssistanceError {
    #[error("请先登录，再使用远程协助。")]
    Authentication,
    #[error("请输入有效的邮箱地址。")]
    InvalidEmail,
    #[error("邀请不存在或已失效。")]
    InvalidInvitation,
    #[error("远程协助暂不可用，请稍后重试。")]
    Unavailable,
    #[error("当前服务暂不支持远程协助，请联系管理员更新。")]
    Unsupported,
    #[error("{0}")]
    Rejected(&'static str),
}

impl AssistanceCommand {
    fn validate(&self) -> Result<(), AssistanceError> {
        match self {
            Self::Invite { email } => {
                let email = email.trim();
                let Some((local, domain)) = email.split_once('@') else {
                    return Err(AssistanceError::InvalidEmail);
                };
                if local.is_empty()
                    || domain.is_empty()
                    || email.len() > 254
                    || email.chars().any(char::is_whitespace)
                    || domain.contains('@')
                {
                    return Err(AssistanceError::InvalidEmail);
                }
            }
            Self::Respond { id, .. } if Uuid::parse_str(id).is_err() => {
                return Err(AssistanceError::InvalidInvitation);
            }
            _ => {}
        }
        Ok(())
    }

    fn request(&self, device: &str) -> (Method, String, Option<Value>) {
        match self {
            Self::List => (
                Method::GET,
                format!("/remote-assistance?deviceId={device}"),
                None,
            ),
            Self::Invite { email } => (
                Method::POST,
                "/remote-assistance".into(),
                Some(json!({"deviceId": device, "email": email.trim()})),
            ),
            Self::Respond { id, action } => (
                Method::POST,
                format!("/remote-assistance/{id}"),
                Some(json!({"deviceId": device, "action": action})),
            ),
        }
    }
}

fn public_error(response: reqwest::blocking::Response, responding: bool) -> AssistanceError {
    match response.status() {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => return AssistanceError::Authentication,
        StatusCode::NOT_FOUND => {
            return if responding {
                AssistanceError::InvalidInvitation
            } else {
                AssistanceError::Unsupported
            }
        }
        _ => {}
    }
    let message = response.json::<Value>().ok();
    // Never forward arbitrary server or proxy details to the interface.
    let safe = match message
        .as_ref()
        .and_then(|body| body["message"].as_str())
        .unwrap_or("")
    {
        "请输入有效的邮箱地址。" => "请输入有效的邮箱地址。",
        "请保持本机登录，并更新到支持远程协助的版本。" => {
            "请保持本机登录，并更新到支持远程协助的版本。"
        }
        "请先结束当前协助或取消邀请。" => "请先结束当前协助或取消邀请。",
        "邀请发送过于频繁，请稍后再试。" => "邀请发送过于频繁，请稍后再试。",
        "本次邀请已结束。" => "本次邀请已结束。",
        "邀请已处理，请刷新后重试。" => "邀请已处理，请刷新后重试。",
        "请在已登录的电脑上接受邀请。" => "请在已登录的电脑上接受邀请。",
        _ => return AssistanceError::Unavailable,
    };
    AssistanceError::Rejected(safe)
}

fn run(
    app: &tauri::AppHandle,
    command: AssistanceCommand,
) -> Result<AssistanceReply, AssistanceError> {
    command.validate()?;
    let _guard = lock_cloud_credentials().map_err(|_| AssistanceError::Unavailable)?;
    let mut settings = read_app_settings(app).map_err(|_| AssistanceError::Unavailable)?;
    let mut credentials = read_cloud_credentials(app);
    if !cloud_state(&settings, &credentials).authenticated {
        return Err(AssistanceError::Authentication);
    }
    let device = read_or_create_installation_state(app)
        .map_err(|_| AssistanceError::Unavailable)?
        .device_id;
    let (method, path, body) = command.request(&device);
    let client = api_client().map_err(|_| AssistanceError::Unavailable)?;
    let response = cloud_request(
        app,
        &client,
        &mut settings,
        &mut credentials,
        method,
        &path,
        body,
    )
    .map_err(|_| AssistanceError::Unavailable)?;
    let requests = decode_response(response, &command)?;
    Ok(AssistanceReply {
        identity: GuiCloudIdentity {
            base_url: base_url(&settings)
                .map_err(|_| AssistanceError::Authentication)?
                .to_owned(),
            user_id: settings
                .cloud_user_id
                .ok_or(AssistanceError::Authentication)?,
        },
        current_device_id: device,
        requests,
    })
}

fn decode_response(
    response: reqwest::blocking::Response,
    command: &AssistanceCommand,
) -> Result<Vec<AssistanceInvitation>, AssistanceError> {
    if !response.status().is_success() {
        return Err(public_error(
            response,
            matches!(command, AssistanceCommand::Respond { .. }),
        ));
    }
    if matches!(command, AssistanceCommand::List) {
        return response
            .json::<AssistanceList>()
            .map(|list| list.requests)
            .map_err(|_| AssistanceError::Unavailable);
    }
    response
        .json::<AssistanceInvitation>()
        .map(|invitation| vec![invitation])
        .map_err(|_| AssistanceError::Unavailable)
}

#[tauri::command]
pub(crate) async fn remote_assistance(
    app: tauri::AppHandle,
    window: tauri::Webview,
    request: AssistanceCommand,
) -> Result<AssistanceReply, String> {
    if window.label() != "main" {
        return Err(AssistanceError::Unavailable.to_string());
    }
    tauri::async_runtime::spawn_blocking(move || run(&app, request))
        .await
        .map_err(|_| AssistanceError::Unavailable.to_string())?
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invitation_input_cannot_escape_its_route_or_accept_invalid_emails() {
        for email in [
            "",
            "alice",
            "@example.com",
            "a@@example.com",
            "a b@example.com",
        ] {
            assert!(AssistanceCommand::Invite {
                email: email.into()
            }
            .validate()
            .is_err());
        }
        assert!(AssistanceCommand::Invite {
            email: " friend@example.com ".into()
        }
        .validate()
        .is_ok());
        assert!(AssistanceCommand::Respond {
            id: "../devices".into(),
            action: AssistanceAction::Accept
        }
        .validate()
        .is_err());
    }
}

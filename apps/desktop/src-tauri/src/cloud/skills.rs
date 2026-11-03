use super::*;

pub(crate) fn fetch_skill_market_items<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Vec<SkillMarketItem>, String> {
    let client = api_client()?;
    let settings = read_app_settings(app)?;
    let response = client
        .get(endpoint(&settings, "/skills")?)
        .header("Accept", "application/json")
        .send()
        .map_err(|error| format!("Skill market request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error("Skill market request", response));
    }
    response
        .json::<SkillMarketResponse>()
        .map(|response| response.items)
        .map_err(|error| format!("Skill market response is invalid: {error}"))
}

pub(crate) struct SkillMarketUpload<'a> {
    pub(crate) title: &'a str,
    pub(crate) description: &'a str,
    pub(crate) version: &'a str,
    pub(crate) skill_id: Option<&'a str>,
    pub(crate) archive_file_name: &'a str,
    pub(crate) archive: &'a [u8],
    pub(crate) preview: Option<&'a SkillPreview>,
}

pub(crate) fn upload_skill_market_item<R: Runtime>(
    app: &tauri::AppHandle<R>,
    upload: SkillMarketUpload<'_>,
) -> Result<SkillMarketItem, String> {
    let client = feedback_client()?;
    let (mut settings, mut credentials) = cloud_snapshot(app)?;
    if credentials.access_token.is_none() || credentials.refresh_token.is_none() {
        return Err("Please sign in before publishing a skill".to_string());
    }
    let method = if upload.skill_id.is_some() {
        Method::PATCH
    } else {
        Method::POST
    };
    let path = upload
        .skill_id
        .map(|id| format!("/skills/{id}"))
        .unwrap_or_else(|| "/skills".to_string());
    let mut final_response = None;
    for attempt in 0..2 {
        prepare_cloud_request(app, &settings, &mut credentials)?;
        let archive_part = multipart::Part::bytes(upload.archive.to_vec())
            .file_name(upload.archive_file_name.to_string())
            .mime_str("application/zip")
            .map_err(|error| format!("Could not prepare skill archive upload: {error}"))?;
        let mut form = multipart::Form::new()
            .text("title", upload.title.to_string())
            .text("description", upload.description.to_string())
            .text("version", upload.version.to_string())
            .part("archive", archive_part);
        if let Some(preview) = upload.preview {
            let preview_part = multipart::Part::bytes(preview.data.clone())
                .file_name(preview.file_name.clone())
                .mime_str(&preview.mime_type)
                .map_err(|error| format!("Could not prepare skill preview upload: {error}"))?;
            form = form.part("preview", preview_part);
        }
        let access_token = credentials
            .access_token
            .as_deref()
            .ok_or_else(|| "Cloud access token is missing. Please log in again.".to_string())?;
        let response = client
            .request(method.clone(), endpoint(&settings, &path)?)
            .bearer_auth(access_token)
            .header("Accept", "application/json")
            .multipart(form)
            .send()
            .map_err(|error| format!("Skill upload failed: {error}"))?;
        if response.status() != StatusCode::UNAUTHORIZED || attempt == 1 {
            final_response = Some(CloudResponse::authenticated(app, &credentials, response)?);
            break;
        }
        refresh_cloud_token(app, &client, &mut settings, &mut credentials)?;
    }
    persist_cloud_sync(app, &settings, &credentials)?;
    let response = final_response.ok_or_else(|| "Skill upload failed".to_string())?;
    if !response.status().is_success() {
        return Err(response_error("Skill upload", response));
    }
    response
        .json()
        .map_err(|error| format!("Skill upload response is invalid: {error}"))
}

pub(crate) fn download_skill_market_archive<R: Runtime>(
    app: &tauri::AppHandle<R>,
    skill_id: &str,
) -> Result<Vec<u8>, String> {
    let client = api_client()?;
    let settings = read_app_settings(app)?;
    let response = client
        .get(endpoint(
            &settings,
            &format!("/skills/{skill_id}/download"),
        )?)
        .header("Accept", "application/zip")
        .send()
        .map_err(|error| format!("Skill download failed: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error("Skill download", response));
    }
    let bytes = response
        .bytes()
        .map_err(|error| format!("Could not read skill download: {error}"))?;
    if bytes.len() > crate::skills_market::MAX_SKILL_ARCHIVE_BYTES {
        return Err("Downloaded skill archive exceeds the 1 MB limit".to_string());
    }
    Ok(bytes.to_vec())
}

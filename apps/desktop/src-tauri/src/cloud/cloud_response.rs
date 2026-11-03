//! Recheck identity after reading a potentially slow HTTP body, before exposing it.
use super::*;
use serde::de::DeserializeOwned;
use std::io::{self, Read};

pub(super) struct CloudResponse {
    response: reqwest::blocking::Response,
    validate: Box<dyn Fn() -> Result<(), String> + Send>,
}

impl From<reqwest::blocking::Response> for CloudResponse {
    fn from(response: reqwest::blocking::Response) -> Self {
        Self {
            response,
            validate: Box::new(|| Ok(())),
        }
    }
}

impl CloudResponse {
    pub(super) fn authenticated<R: Runtime>(
        app: &tauri::AppHandle<R>,
        credentials: &CloudCredentials,
        response: reqwest::blocking::Response,
    ) -> Result<Self, String> {
        ensure_cloud_session(app, credentials)?;
        let app = app.clone();
        let credentials = credentials.clone();
        Ok(Self {
            response,
            validate: Box::new(move || ensure_cloud_session(&app, &credentials)),
        })
    }

    pub(super) fn status(&self) -> StatusCode {
        self.response.status()
    }

    pub(super) fn error_for_status(self) -> Result<Self, String> {
        (self.validate)()?;
        self.response
            .error_for_status_ref()
            .map_err(|error| error.to_string())?;
        Ok(self)
    }

    pub(super) fn json<T: DeserializeOwned>(self) -> Result<T, String> {
        let result = self.response.json().map_err(|error| error.to_string());
        (self.validate)()?;
        result
    }

    pub(super) fn text(self) -> Result<String, String> {
        let result = self.response.text().map_err(|error| error.to_string());
        (self.validate)()?;
        result
    }
}

impl Read for CloudResponse {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let count = self.response.read(buffer)?;
        if count == 0 {
            (self.validate)().map_err(io::Error::other)?;
        }
        Ok(count)
    }
}

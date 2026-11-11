use super::Client;
use crate::codex_gui::{
    error::{GuiError, Result},
    prediction::{self, PredictionRequest},
    prediction_transport,
    protocol::GuiResponse,
};
use serde_json::json;

impl Client {
    pub(crate) async fn suggest_next_prompt(
        &self,
        request: PredictionRequest,
    ) -> Result<GuiResponse> {
        request.validate()?;
        let suggestion = match self.prediction_slot.try_acquire() {
            Ok(_slot) => {
                tokio::time::timeout(prediction_transport::TIMEOUT, self.predict(&request))
                    .await
                    .ok()
                    .and_then(std::result::Result::ok)
                    .flatten()
            }
            // Suggestions are optional; never queue work behind another prediction.
            Err(_) => None,
        };
        Ok(GuiResponse {
            data: json!({"suggestion": suggestion}),
        })
    }

    async fn predict(&self, request: &PredictionRequest) -> Result<Option<String>> {
        if self
            .active_turns
            .lock()
            .await
            .contains_key(&request.thread_id)
        {
            return Ok(None);
        }
        let response = self.recent_context(&request.thread_id, 6).await?;
        let Some(body) = prediction::request_body(&response["thread"], request) else {
            return Ok(None);
        };
        let app = self.app.clone();
        let base_url = tauri::async_runtime::spawn_blocking(move || {
            crate::local_proxy::gui_runtime::ensure_started(&app).map_err(|_| GuiError::Startup)
        })
        .await
        .map_err(|_| GuiError::Startup)??;
        prediction_transport::generate(&base_url, body).await
    }
}

//! Encrypted chat text is submitted directly by the native session codec.
use super::{bulk::Target, model::*, State};

impl State {
    pub(crate) async fn send_chat(&self, target: &Target, text: String) -> Result<()> {
        let peer = self.get("main", &target.peer).await?;
        let channel = peer.channel(&target.channel).await?;
        if channel.spec.label != "codex-chat-v1" {
            return Err(Error::Invalid);
        }
        channel.send(text.into(), true).await
    }
}

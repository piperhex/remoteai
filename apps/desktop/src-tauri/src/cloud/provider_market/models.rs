use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Price {
    input: Option<f64>,
    output: Option<f64>,
    cached_input: Option<f64>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Tier {
    multiplier: f64,
    input: Option<f64>,
    output: Option<f64>,
    cached_input: Option<f64>,
    long_context_threshold: Option<u64>,
    long_context: Price,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Protocol {
    OpenaiResponses,
    OpenaiChat,
    AnthropicMessages,
    GeminiGenerateContent,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Model {
    pub(super) id: String,
    pub(super) protocol: Protocol,
    tiers: Vec<Tier>,
}
/// Public field allowlist; personal Provider profiles and their secrets never cross this boundary.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Draft {
    pub(super) name: String,
    description: String,
    pub(super) base_url: String,
    currency: String,
    unit: String,
    pub(super) models: Vec<Model>,
    pub(super) balance_query: Option<crate::models::ProviderBalanceScript>,
    pub(super) page_link: Option<crate::models::MarketPageLink>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Item {
    #[serde(flatten)]
    draft: Draft,
    id: String,
    owner_id: Option<String>,
    official: bool,
    published: bool,
    revision: u64,
    user_count: u64,
    sort_order: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    review_status: Option<ReviewStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    review_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    marketing_badge: Option<MarketingBadge>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum ReviewStatus {
    Draft,
    Pending,
    Approved,
    Rejected,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum BadgeTone {
    Blue,
    Green,
    Orange,
    Red,
    Purple,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct MarketingBadge {
    text: String,
    tone: BadgeTone,
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Scope {
    All,
    Official,
    Community,
    Mine,
}
impl Scope {
    pub(super) fn query(&self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Official => "official",
            Self::Community => "community",
            Self::Mine => "mine",
        }
    }
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Request {
    List {
        scope: Scope,
        search: String,
        page: u32,
    },
    Get {
        id: String,
    },
    Save {
        id: Option<String>,
        revision: Option<u64>,
        published: bool,
        draft: Box<Draft>,
    },
    Remove {
        id: String,
        revision: u64,
    },
    Usage {
        id: String,
        #[serde(rename = "providerId")]
        provider_id: String,
    },
}
#[derive(Deserialize, Serialize)]
#[serde(untagged)]
pub(crate) enum Reply {
    Page { items: Vec<Item>, total: u64 },
    Item(Box<Item>),
    Acknowledgement { ok: bool, counted: Option<bool> },
}

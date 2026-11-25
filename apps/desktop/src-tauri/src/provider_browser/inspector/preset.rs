use serde::Deserialize;

/// Device identifiers accepted from the inspector toolbar. Apple models share Safari identities.
#[derive(Clone, Copy, Default, Deserialize, PartialEq)]
pub(crate) enum DevicePreset {
    #[default]
    #[serde(rename = "responsive")]
    Responsive,
    #[serde(rename = "iPhone 16", alias = "iPhone SE", alias = "iPhone 16 Pro Max")]
    IPhone,
    #[serde(rename = "iPad Mini")]
    IPadMini,
    #[serde(rename = "iPad Pro 13")]
    IPadPro,
    #[serde(rename = "Pixel 9")]
    Pixel9,
    #[serde(rename = "Pixel 9 Pro")]
    Pixel9Pro,
    #[serde(rename = "Pixel 10")]
    Pixel10,
    #[serde(rename = "Samsung Galaxy A55")]
    GalaxyA55,
    #[serde(rename = "Pixel 9 Pro Fold")]
    Pixel9ProFold,
    #[serde(rename = "Galaxy Z Fold 6")]
    GalaxyZFold6,
    #[serde(rename = "Surface Pro 10")]
    SurfacePro,
    #[serde(rename = "Nest Hub Max")]
    NestHubMax,
}

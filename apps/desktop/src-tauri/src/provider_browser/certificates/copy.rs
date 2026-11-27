// Generated from packages/i18n/platform/desktop/src-tauri/src/provider_browser/certificates/copy.rs. Do not edit.
use crate::storage::{interface_language, InterfaceLanguage};
use serde::Serialize;

#[derive(Serialize)]
pub(super) struct CertificateCopy {
    trust: &'static str,
    remember: &'static str,
    changed: &'static str,
}

pub(super) fn current() -> CertificateCopy {
    match interface_language() {
        InterfaceLanguage::Zh => CertificateCopy {
            trust: "信任此证书并继续",
            remember: "请核对证书指纹。信任后，下次访问此网站会直接打开。",
            changed: "此网站的证书或验证错误已变化。请重新核对指纹，再决定是否信任。",
        },
        InterfaceLanguage::En => CertificateCopy {
            trust: "Trust this certificate and continue",
            remember: "Check the fingerprint. If you trust this certificate, this site will open directly next time.",
            changed: "The certificate or its validation error has changed. Check the fingerprint before trusting it again.",
        },
        InterfaceLanguage::Ja => CertificateCopy {
            trust: "この証明書を信頼して続行",
            remember: "指紋を確認してください。この証明書を信頼すると、次回からこのサイトを直接開きます。",
            changed: "証明書または検証エラーが変わりました。もう一度信頼する前に指紋を確認してください。",
        },
        InterfaceLanguage::Ru => CertificateCopy {
            trust: "Доверять сертификату и продолжить",
            remember: "Проверьте отпечаток. Если вы доверяете сертификату, в следующий раз сайт откроется сразу.",
            changed: "Сертификат или ошибка его проверки изменились. Проверьте отпечаток ещё раз.",
        },
    }
}

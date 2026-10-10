#include "platform.hpp"
#include "windows_driver.hpp"
#include "windows_desktop.hpp"
#include <wtsapi32.h>
#include <algorithm>
#include <cwctype>
#include <stdexcept>
#include <thread>
#include <vector>

namespace {
constexpr DWORD fallback_width = 1920;
constexpr DWORD fallback_height = 1080;
constexpr DWORD privacy_refresh_rate = 60;
constexpr DWORD privacy_color_depth = 32;
struct Topology {
    std::vector<DISPLAYCONFIG_PATH_INFO> paths;
    std::vector<DISPLAYCONFIG_MODE_INFO> modes;
};
Topology topology(UINT32 flags = QDC_ONLY_ACTIVE_PATHS) {
    InputDesktopScope desktop;
    for (int attempt = 0; attempt < 5; ++attempt) {
        UINT32 paths = 0, modes = 0;
        if (GetDisplayConfigBufferSizes(flags, &paths, &modes)) throw std::runtime_error("display query failed");
        Topology value{std::vector<DISPLAYCONFIG_PATH_INFO>(paths), std::vector<DISPLAYCONFIG_MODE_INFO>(modes)};
        const auto result = QueryDisplayConfig(flags, &paths, value.paths.data(), &modes, value.modes.data(), nullptr);
        if (result == ERROR_INSUFFICIENT_BUFFER) continue;
        if (result) throw std::runtime_error("display topology unavailable");
        value.paths.resize(paths); value.modes.resize(modes); return value;
    }
    throw std::runtime_error("display topology changed");
}
std::wstring source_name(const DISPLAYCONFIG_PATH_INFO& path) {
    InputDesktopScope desktop;
    DISPLAYCONFIG_SOURCE_DEVICE_NAME name{};
    name.header = {DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME, sizeof(name), path.sourceInfo.adapterId, path.sourceInfo.id};
    if (DisplayConfigGetDeviceInfo(&name.header)) throw std::runtime_error("display identity unavailable");
    return name.viewGdiDeviceName;
}
bool owned_adapter(const DISPLAYCONFIG_PATH_INFO& path) {
    InputDesktopScope desktop;
    DISPLAYCONFIG_ADAPTER_NAME name{};
    name.header = {DISPLAYCONFIG_DEVICE_INFO_GET_ADAPTER_NAME, sizeof(name), path.targetInfo.adapterId, 0};
    if (DisplayConfigGetDeviceInfo(&name.header)) return false;
    auto instance = privacy_device_instance();
    std::replace(instance.begin(), instance.end(), L'\\', L'#');
    auto device = std::wstring(name.adapterDevicePath);
    std::transform(instance.begin(), instance.end(), instance.begin(), towlower);
    std::transform(device.begin(), device.end(), device.begin(), towlower);
    return !instance.empty() && device.find(instance + L'#') != std::wstring::npos;
}
void apply(Topology& value) {
    InputDesktopScope desktop;
    const auto result = SetDisplayConfig(static_cast<UINT32>(value.paths.size()), value.paths.data(),
        static_cast<UINT32>(value.modes.size()), value.modes.data(),
        SDC_APPLY | SDC_USE_SUPPLIED_DISPLAY_CONFIG | SDC_ALLOW_CHANGES);
    if (result) throw std::runtime_error("display configuration failed: " + std::to_string(result));
}
bool session_locked() {
    DWORD session = 0, bytes = 0;
    if (!ProcessIdToSessionId(GetCurrentProcessId(), &session)) return false;
    LPWSTR buffer = nullptr;
    if (!WTSQuerySessionInformationW(WTS_CURRENT_SERVER_HANDLE, session, WTSSessionInfoEx, &buffer, &bytes)) return false;
    const auto info = reinterpret_cast<WTSINFOEXW*>(buffer);
    const bool locked = bytes >= sizeof(WTSINFOEXW) && info->Level == 1
        && info->Data.WTSInfoExLevel1.SessionFlags == WTS_SESSIONSTATE_LOCK;
    WTSFreeMemory(buffer); return locked;
}
void lock_session() {
    if (session_locked()) return;
    if (!LockWorkStation()) throw std::runtime_error("lock request failed");
    for (int i = 0; i < 100; ++i) {
        if (session_locked()) return;
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    throw std::runtime_error("lock not confirmed");
}
void size_private_display(const std::wstring& selected, const Topology& original) {
    InputDesktopScope desktop;
    DWORD width = fallback_width, height = fallback_height;
    for (const auto& mode : original.modes) {
        if (mode.infoType != DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE) continue;
        if (mode.sourceMode.position.x || mode.sourceMode.position.y) continue;
        width = mode.sourceMode.width; height = mode.sourceMode.height; break;
    }
    DEVMODEW chosen{}; chosen.dmSize = sizeof(chosen);
    DEVMODEW mode{}; mode.dmSize = sizeof(mode);
    for (DWORD index = 0; EnumDisplaySettingsW(selected.c_str(), index, &mode); ++index) {
        if (mode.dmBitsPerPel != privacy_color_depth || mode.dmDisplayFrequency != privacy_refresh_rate) continue;
        if (mode.dmPelsWidth == width && mode.dmPelsHeight == height) { chosen = mode; break; }
        if (mode.dmPelsWidth == fallback_width && mode.dmPelsHeight == fallback_height) chosen = mode;
    }
    if (!chosen.dmPelsWidth) throw std::runtime_error("privacy resolution unavailable");
    chosen.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY | DM_BITSPERPEL;
    if (ChangeDisplaySettingsExW(selected.c_str(), &chosen, nullptr, 0, nullptr) != DISP_CHANGE_SUCCESSFUL)
        throw std::runtime_error("privacy resolution change failed");
}
class WindowsPrivacy final : public PrivacyPlatform {
    HANDLE exclusive = nullptr;
    Topology original;
    bool created = false;
    bool private_screen = false;
    std::wstring selected;
    std::string discover() {
        for (int attempt = 0; attempt < 100; ++attempt) {
            auto all = topology(QDC_ALL_PATHS);
            auto found = std::find_if(all.paths.begin(), all.paths.end(), [](const auto& path) {
                return path.targetInfo.targetAvailable && owned_adapter(path);
            });
            if (found != all.paths.end()) {
                selected = source_name(*found);
                // Activate just the new path alongside the snapshot, without changing saved Windows defaults.
                if (!(found->flags & DISPLAYCONFIG_PATH_ACTIVE)) {
                    auto extended = original;
                    auto added = *found;
                    added.flags |= DISPLAYCONFIG_PATH_ACTIVE;
                    added.sourceInfo.modeInfoIdx = DISPLAYCONFIG_PATH_MODE_IDX_INVALID;
                    added.targetInfo.modeInfoIdx = DISPLAYCONFIG_PATH_MODE_IDX_INVALID;
                    extended.paths.push_back(added); apply(extended);
                }
                std::string name;
                // GDI source names are ASCII identifiers (\\.\DISPLAYn).
                for (const auto ch : selected) {
                    if (ch > 127) throw std::runtime_error("invalid source name");
                    name.push_back(static_cast<char>(ch));
                }
                return name;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
        throw std::runtime_error("virtual display did not arrive");
    }
public:
    ~WindowsPrivacy() override { if (exclusive) CloseHandle(exclusive); }
    std::string prepare() override {
        exclusive = CreateMutexW(nullptr, TRUE, L"Global\\RemoteAI.PrivacyDisplay");
        if (!exclusive || GetLastError() == ERROR_ALREADY_EXISTS) throw std::runtime_error("privacy already active");
        original = topology();
        if (original.paths.empty()) throw std::runtime_error("no original desktop");
        ensure_privacy_driver();
        created = true;
        set_privacy_device_enabled(true);
        const auto name = discover();
        size_private_display(selected, original);
        return name;
    }
    void commit() override {
        auto only = topology();
        std::erase_if(only.paths, [&](const auto& path) { return source_name(path) != selected || !owned_adapter(path); });
        if (only.paths.size() != 1) throw std::runtime_error("virtual display missing");
        auto& mode = only.modes.at(only.paths[0].sourceInfo.modeInfoIdx);
        mode.sourceMode.position = {0, 0};
        private_screen = true;
        apply(only);
        verify();
    }
    void verify() override {
        if (!private_screen) return;
        const auto verified = topology();
        if (verified.paths.size() != 1 || !owned_adapter(verified.paths[0]))
            throw std::runtime_error("physical display still active");
    }
    void restore(bool lock) override {
        if (!created) return;
        if (lock && private_screen) lock_session();
        apply(original);
        set_privacy_device_enabled(false);
        created = false; private_screen = false;
    }
};
}
std::unique_ptr<PrivacyPlatform> privacy_platform() { return std::make_unique<WindowsPrivacy>(); }

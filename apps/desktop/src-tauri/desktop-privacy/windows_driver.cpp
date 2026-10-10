#include "platform.hpp"
#include "windows_driver.hpp"
#include <initguid.h>
#include <devguid.h>
#include <setupapi.h>
#include <newdev.h>
#include <shellapi.h>
#include <wintrust.h>
#include <softpub.h>
#include <array>
#include <cstring>
#include <filesystem>
#include <stdexcept>
#include <vector>

namespace {
constexpr wchar_t registry[] = L"SOFTWARE\\RemoteAI\\PrivacyDisplay";
constexpr wchar_t hardware[] = L"Root\\MttVDD";
constexpr DWORD driver_missing = 2;
constexpr DWORD desktop_locked = 3;
std::filesystem::path executable() {
    std::array<wchar_t, 32768> path{};
    const DWORD length = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
    if (!length || length == path.size()) throw std::runtime_error("helper path unavailable");
    return std::filesystem::path(std::wstring(path.data(), length));
}
bool trusted(const std::filesystem::path& path) {
    WINTRUST_FILE_INFO file{}; file.cbStruct = sizeof(file); file.pcwszFilePath = path.c_str();
    WINTRUST_DATA data{}; data.cbStruct = sizeof(data); data.dwUIChoice = WTD_UI_NONE;
    data.fdwRevocationChecks = WTD_REVOKE_NONE; data.dwUnionChoice = WTD_CHOICE_FILE;
    data.pFile = &file; data.dwStateAction = WTD_STATEACTION_VERIFY;
    GUID policy = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    const auto result = WinVerifyTrust(nullptr, &policy, &data);
    data.dwStateAction = WTD_STATEACTION_CLOSE;
    WinVerifyTrust(nullptr, &policy, &data);
    return result == ERROR_SUCCESS;
}
std::vector<std::wstring> driver_devices() {
    const auto devices = SetupDiGetClassDevsW(&GUID_DEVCLASS_DISPLAY, nullptr, nullptr, 0);
    if (devices == INVALID_HANDLE_VALUE) throw std::runtime_error("display device query failed");
    std::vector<std::wstring> result;
    SP_DEVINFO_DATA device{}; device.cbSize = sizeof(device);
    for (DWORD index = 0; SetupDiEnumDeviceInfo(devices, index, &device); ++index) {
        std::array<wchar_t, 4096> ids{}, instance{};
        if (!SetupDiGetDeviceRegistryPropertyW(devices, &device, SPDRP_HARDWAREID, nullptr,
            reinterpret_cast<BYTE*>(ids.data()), sizeof(ids), nullptr)) continue;
        if (_wcsicmp(ids.data(), hardware)) continue;
        if (SetupDiGetDeviceInstanceIdW(devices, &device, instance.data(),
            static_cast<DWORD>(instance.size()), nullptr)) result.emplace_back(instance.data());
    }
    SetupDiDestroyDeviceInfoList(devices); return result;
}
void record_device(HDEVINFO devices, SP_DEVINFO_DATA& device) {
    std::array<wchar_t, 4096> instance{};
    if (!SetupDiGetDeviceInstanceIdW(devices, &device, instance.data(),
        static_cast<DWORD>(instance.size()), nullptr)) throw std::runtime_error("device identity unavailable");
    HKEY key = nullptr;
    if (RegCreateKeyExW(HKEY_LOCAL_MACHINE, registry, 0, nullptr, 0, KEY_SET_VALUE, nullptr, &key, nullptr))
        throw std::runtime_error("device ownership unavailable");
    const auto result = RegSetValueExW(key, L"Instance", 0, REG_SZ,
        reinterpret_cast<const BYTE*>(instance.data()), static_cast<DWORD>((wcslen(instance.data()) + 1) * sizeof(wchar_t)));
    RegCloseKey(key);
    if (result) throw std::runtime_error("device ownership write failed");
}
void install() {
    if (!driver_devices().empty()) throw std::runtime_error("another virtual display driver exists");
    const auto root = executable().parent_path() / "privacy-driver";
    if (!trusted(root / "MttVDD.dll") || !trusted(root / "mttvdd.cat"))
        throw std::runtime_error("untrusted privacy driver");
    const auto devices = SetupDiCreateDeviceInfoList(&GUID_DEVCLASS_DISPLAY, nullptr);
    if (devices == INVALID_HANDLE_VALUE) throw std::runtime_error("driver install unavailable");
    SP_DEVINFO_DATA device{}; device.cbSize = sizeof(device);
    bool registered = false;
    try {
        if (!SetupDiCreateDeviceInfoW(devices, L"Display", &GUID_DEVCLASS_DISPLAY,
            L"Remote AI Privacy Display", nullptr, DICD_GENERATE_ID, &device)) throw std::runtime_error("device create failed");
        constexpr wchar_t ids[] = L"Root\\MttVDD\0";
        if (!SetupDiSetDeviceRegistryPropertyW(devices, &device, SPDRP_HARDWAREID,
            reinterpret_cast<const BYTE*>(ids), sizeof(ids))
            || !SetupDiCallClassInstaller(DIF_REGISTERDEVICE, devices, &device)) throw std::runtime_error("device register failed");
        registered = true;
        BOOL reboot = FALSE;
        if (!UpdateDriverForPlugAndPlayDevicesW(nullptr, hardware, (root / "MttVDD.inf").c_str(),
            0, &reboot))
            throw std::runtime_error("driver install failed");
        if (reboot) throw std::runtime_error("driver needs restart");
        record_device(devices, device);
    } catch (...) {
        if (registered && !SetupDiRemoveDevice(devices, &device)) OutputDebugStringW(L"Privacy device cleanup failed");
        SetupDiDestroyDeviceInfoList(devices); throw;
    }
    SetupDiDestroyDeviceInfoList(devices);
}

}
std::wstring privacy_device_instance() {
    std::array<wchar_t, 4096> value{}; DWORD bytes = sizeof(value);
    if (RegGetValueW(HKEY_LOCAL_MACHINE, registry, L"Instance", RRF_RT_REG_SZ, nullptr, value.data(), &bytes)) return {};
    return value.data();
}
void ensure_privacy_driver() {
    const auto devices = driver_devices();
    // Installation belongs to the separate, interactive setup process, never a capture transaction.
    if (devices.empty()) throw std::runtime_error("privacy driver installation required");
    if (devices.size() != 1 || _wcsicmp(devices[0].c_str(), privacy_device_instance().c_str()))
        throw std::runtime_error("virtual driver owned by another application");
}
void set_privacy_device_enabled(bool enabled) {
    const auto devices = SetupDiCreateDeviceInfoList(&GUID_DEVCLASS_DISPLAY, nullptr);
    if (devices == INVALID_HANDLE_VALUE) throw std::runtime_error("device control unavailable");
    SP_DEVINFO_DATA device{}; device.cbSize = sizeof(device);
    SP_PROPCHANGE_PARAMS change{}; change.ClassInstallHeader.cbSize = sizeof(SP_CLASSINSTALL_HEADER);
    change.ClassInstallHeader.InstallFunction = DIF_PROPERTYCHANGE;
    change.StateChange = enabled ? DICS_ENABLE : DICS_DISABLE;
    change.Scope = DICS_FLAG_CONFIGSPECIFIC;
    const auto instance = privacy_device_instance();
    const bool success = !instance.empty()
        && SetupDiOpenDeviceInfoW(devices, instance.c_str(), nullptr, 0, &device)
        && SetupDiSetClassInstallParamsW(devices, &device, &change.ClassInstallHeader, sizeof(change))
        && SetupDiCallClassInstaller(DIF_PROPERTYCHANGE, devices, &device);
    SetupDiDestroyDeviceInfoList(devices);
    if (!success) throw std::runtime_error("privacy device switch failed");
}

namespace {
bool bind_desktop(bool interactive) {
    const auto desktop = OpenInputDesktop(0, FALSE, GENERIC_ALL);
    if (!desktop) return false;
    std::array<wchar_t, 256> name{}; DWORD bytes = 0;
    const bool usable = !interactive || (GetUserObjectInformationW(desktop, UOI_NAME,
        name.data(), sizeof(name), &bytes) && !_wcsicmp(name.data(), L"Default"));
    if (!usable || !SetThreadDesktop(desktop)) { CloseDesktop(desktop); return false; }
    // Retain the bound desktop handle for the process lifetime.
    return true;
}
DWORD check_driver() {
    const auto devices = driver_devices();
    if (!devices.empty()) { ensure_privacy_driver(); return 0; }
    // Do not place an installation prompt on the lock/sign-in/secure desktop.
    return bind_desktop(true) ? driver_missing : desktop_locked;
}
void interactive_install() {
    const auto exclusive = CreateMutexW(nullptr, TRUE, L"Global\\RemoteAI.PrivacyDisplay");
    if (!exclusive) throw std::runtime_error("privacy setup unavailable");
    const bool already_open = GetLastError() == ERROR_ALREADY_EXISTS;
    // The same mutex excludes other setup windows and active privacy guardians.
    auto guard = std::unique_ptr<void, decltype(&CloseHandle)>(exclusive, CloseHandle);
    if (already_open || !driver_devices().empty()) return;
    const auto answer = MessageBoxW(nullptr,
        L"首次使用隐私屏需要安装显示组件。\n是否现在安装？", L"Remote AI · 隐私屏",
        MB_YESNO | MB_DEFBUTTON2 | MB_ICONQUESTION | MB_SETFOREGROUND);
    if (answer != IDYES) return;
    // Windows owns publisher confirmation. Never import certificates or weaken signature policy.
    install();
    set_privacy_device_enabled(false);
    guard.reset();
    MessageBoxW(nullptr, L"安装完成。\n请重新开启隐私屏。", L"Remote AI · 隐私屏",
        MB_OK | MB_ICONINFORMATION | MB_SETFOREGROUND);
}
}

bool platform_command(int argc, char** argv) {
    if (argc == 2) {
        const bool setup = std::strcmp(argv[1], "--install-driver") == 0;
        if (setup && !bind_desktop(true)) ExitProcess(desktop_locked);
        try {
            if (std::strcmp(argv[1], "--check-driver") == 0) ExitProcess(check_driver());
            if (setup) { interactive_install(); return true; }
        } catch (const std::exception&) {
            if (setup) MessageBoxW(nullptr, L"安装未完成。\n可以稍后重新开启隐私屏再试。",
                L"Remote AI · 隐私屏", MB_OK | MB_ICONINFORMATION | MB_SETFOREGROUND);
            ExitProcess(1);
        }
        ExitProcess(1);
    }
    // The service launches us in the interactive session. Bind before querying its desktop.
    if (!bind_desktop(false)) ExitProcess(1);
    return false;
}

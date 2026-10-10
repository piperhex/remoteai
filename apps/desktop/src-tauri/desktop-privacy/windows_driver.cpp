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
#include <filesystem>
#include <stdexcept>
#include <vector>

namespace {
constexpr wchar_t registry[] = L"SOFTWARE\\RemoteAI\\PrivacyDisplay";
constexpr wchar_t hardware[] = L"Root\\MttVDD";
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
            INSTALLFLAG_NONINTERACTIVE, &reboot))
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
    auto devices = driver_devices();
    if (devices.empty()) { install(); devices = driver_devices(); }
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

bool platform_command(int argc, char** argv) {
    (void)argc; (void)argv;
    // The service launches us in the interactive session. Bind before querying its desktop.
    const auto desktop = OpenInputDesktop(0, FALSE, GENERIC_ALL);
    if (!desktop || !SetThreadDesktop(desktop)) ExitProcess(1);
    // Retain the desktop handle for the process lifetime.
    return false;
}

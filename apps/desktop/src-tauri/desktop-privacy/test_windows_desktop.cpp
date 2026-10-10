#include "windows_desktop.hpp"
#include <iostream>

int main() {
    const auto previous = GetThreadDesktop(GetCurrentThreadId());
    const auto isolated = CreateDesktopW(L"RemoteAI.PrivacyDesktopTest", nullptr, nullptr, 0, GENERIC_ALL, nullptr);
    if (!isolated || !SetThreadDesktop(isolated)) return 1;
    bool passed = false;
    try {
        {
            InputDesktopScope input;
            UINT32 paths = 0, modes = 0;
            passed = GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &paths, &modes) == ERROR_SUCCESS && paths > 0;
        }
        passed = passed && GetThreadDesktop(GetCurrentThreadId()) == isolated;
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; }
    if (!SetThreadDesktop(previous) || !CloseDesktop(isolated)) return 1;
    if (!passed) return 1;
    std::cout << "Privacy display APIs follow the input desktop and restore the previous thread desktop.\n";
    return 0;
}

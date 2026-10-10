#pragma once
#include <windows.h>
#include <stdexcept>

// Locking or unlocking switches desktops. Display APIs must follow that switch,
// even when the guardian was started on a different desktop.
class InputDesktopScope {
    HDESK previous = GetThreadDesktop(GetCurrentThreadId());
    HDESK current = nullptr;
public:
    InputDesktopScope() {
        current = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS | DESKTOP_WRITEOBJECTS);
        if (!current) throw std::runtime_error("input desktop unavailable");
        if (!SetThreadDesktop(current)) {
            CloseDesktop(current); current = nullptr;
            throw std::runtime_error("input desktop switch failed");
        }
    }
    ~InputDesktopScope() {
        if (!SetThreadDesktop(previous)) OutputDebugStringW(L"Privacy desktop restore failed");
        if (current && !CloseDesktop(current)) OutputDebugStringW(L"Privacy desktop cleanup failed");
    }
    InputDesktopScope(const InputDesktopScope&) = delete;
    InputDesktopScope& operator=(const InputDesktopScope&) = delete;
};

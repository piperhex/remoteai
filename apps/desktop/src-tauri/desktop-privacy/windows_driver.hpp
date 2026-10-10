#pragma once
#include <windows.h>
#include <string>
void ensure_privacy_driver();
void set_privacy_device_enabled(bool enabled);
std::wstring privacy_device_instance();

#pragma once
#include <memory>
#include <string>

// Each implementation owns only the display created for this privacy session.
class PrivacyPlatform {
public:
    virtual ~PrivacyPlatform() = default;
    virtual std::string prepare() = 0;
    virtual void commit() = 0;
    virtual void verify() = 0;
    virtual void restore(bool lock) = 0;
};
std::unique_ptr<PrivacyPlatform> privacy_platform();
bool platform_command(int argc, char** argv);

#include "platform.hpp"
#include <iostream>
#include <stdexcept>
#include <cstdlib>

class FakePlatform final : public PrivacyPlatform {
    bool active = false;
    bool created = false;
    bool fail_lock = std::getenv("PRIVACY_TEST_LOCK_RETRY") != nullptr;
public:
    std::string prepare() override { created = true; std::cerr << "prepare\n"; return "test-display"; }
    void commit() override { active = true; std::cerr << "disconnect\n"; }
    void verify() override {}
    void restore(bool lock) override {
        if (!created) return;
        if (active && lock && fail_lock) {
            fail_lock = false; std::cerr << "lock-pending\n"; throw std::runtime_error("test lock delay");
        }
        if (active && lock) std::cerr << "lock-confirmed\n";
        std::cerr << "restore\n"; active = false; created = false;
    }
};
std::unique_ptr<PrivacyPlatform> privacy_platform() { return std::make_unique<FakePlatform>(); }
bool platform_command(int, char**) { return false; }

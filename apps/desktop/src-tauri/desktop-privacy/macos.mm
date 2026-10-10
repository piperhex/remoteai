#include "platform.hpp"
#import "CGVirtualDisplayPrivate.h"
#include <dlfcn.h>
#include <csignal>
#include <fcntl.h>
#include <sys/file.h>
#include <unistd.h>
#include <array>
#include <stdexcept>
#include <thread>
#include <vector>

namespace {
using EnableDisplay = CGError (*)(CGDisplayConfigRef, CGDirectDisplayID, bool);
using LockScreen = void (*)();
struct Screen {
    CGDirectDisplayID id;
    CGPoint origin;
    CGDirectDisplayID mirror;
    CGDisplayModeRef mode;
};
std::vector<CGDirectDisplayID> active_displays(bool online = false) {
    std::array<CGDirectDisplayID, 64> ids{}; uint32_t count = 0;
    const auto result = online ? CGGetOnlineDisplayList(static_cast<uint32_t>(ids.size()), ids.data(), &count)
        : CGGetActiveDisplayList(static_cast<uint32_t>(ids.size()), ids.data(), &count);
    if (result != kCGErrorSuccess)
        throw std::runtime_error("display enumeration failed");
    return {ids.begin(), ids.begin() + count};
}
void check(CGError error) {
    if (error != kCGErrorSuccess) throw std::runtime_error("display configuration failed");
}
bool locked() {
    const auto session = CGSessionCopyCurrentDictionary();
    if (!session) return false;
    const auto value = CFDictionaryGetValue(session, CFSTR("CGSSessionScreenIsLocked"));
    const bool result = value && CFGetTypeID(value) == CFBooleanGetTypeID()
        && CFBooleanGetValue(static_cast<CFBooleanRef>(value));
    CFRelease(session); return result;
}
class MacPrivacy final : public PrivacyPlatform {
    int exclusive = -1;
    std::vector<Screen> original;
    CGVirtualDisplay* display = nil;
    EnableDisplay enable = nullptr;
    LockScreen lock_screen = nullptr;
    bool private_screen = false;
    void configure(bool restore) {
        CGDisplayConfigRef configuration = nullptr;
        check(CGBeginDisplayConfiguration(&configuration));
        try {
            for (const auto& screen : original) check(enable(configuration, screen.id, restore));
            if (!restore) check(CGConfigureDisplayOrigin(configuration, display.displayID, 0, 0));
            check(CGCompleteDisplayConfiguration(configuration, kCGConfigureForSession));
        } catch (...) { CGCancelDisplayConfiguration(configuration); throw; }
    }
    void restore_layout() {
        CGDisplayConfigRef configuration = nullptr;
        check(CGBeginDisplayConfiguration(&configuration));
        try {
            for (const auto& screen : original) {
                check(CGConfigureDisplayOrigin(configuration, screen.id,
                    static_cast<int32_t>(screen.origin.x), static_cast<int32_t>(screen.origin.y)));
                if (screen.mode) check(CGConfigureDisplayWithDisplayMode(configuration, screen.id, screen.mode, nullptr));
                check(CGConfigureDisplayMirrorOfDisplay(configuration, screen.id, screen.mirror));
            }
            check(CGCompleteDisplayConfiguration(configuration, kCGConfigureForSession));
        } catch (...) { CGCancelDisplayConfiguration(configuration); throw; }
    }
    void confirm_lock() {
        if (locked()) return;
        lock_screen();
        for (int attempt = 0; attempt < 100; ++attempt) {
            if (locked()) return;
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
        throw std::runtime_error("lock not confirmed");
    }
public:
    ~MacPrivacy() override {
        for (const auto& screen : original) if (screen.mode) CFRelease(screen.mode);
        if (exclusive >= 0) close(exclusive);
    }
    std::string prepare() override {
        @autoreleasepool {
            const auto path = std::string("/tmp/remote-ai-privacy-") + std::to_string(getuid()) + ".lock";
            exclusive = open(path.c_str(), O_CREAT | O_RDWR | O_NOFOLLOW | O_CLOEXEC, 0600);
            if (exclusive < 0 || flock(exclusive, LOCK_EX | LOCK_NB)) throw std::runtime_error("privacy already active");
            // Private symbols are checked before modifying any display. Keep frameworks loaded for the session.
            const auto graphics = dlopen("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics", RTLD_LAZY);
            const auto login = dlopen("/System/Library/PrivateFrameworks/login.framework/login", RTLD_LAZY);
            enable = graphics ? reinterpret_cast<EnableDisplay>(dlsym(graphics, "CGSConfigureDisplayEnabled")) : nullptr;
            lock_screen = login ? reinterpret_cast<LockScreen>(dlsym(login, "SACLockScreenImmediate")) : nullptr;
            if (!enable || !lock_screen || !NSClassFromString(@"CGVirtualDisplay"))
                throw std::runtime_error("privacy unavailable on this macOS");
            for (const auto id : active_displays(true)) {
                if (CGDisplayIsActive(id) || CGDisplayIsInMirrorSet(id))
                    original.push_back({id, CGDisplayBounds(id).origin, CGDisplayMirrorsDisplay(id), CGDisplayCopyDisplayMode(id)});
            }
            if (original.empty()) throw std::runtime_error("no original desktop");
            CGVirtualDisplayDescriptor* descriptor = [NSClassFromString(@"CGVirtualDisplayDescriptor") new];
            [descriptor setDispatchQueue:dispatch_get_global_queue(QOS_CLASS_USER_INTERACTIVE, 0)];
            [descriptor setName:@"Remote AI Privacy Display"];
            [descriptor setMaxPixelsWide:2560]; [descriptor setMaxPixelsHigh:1440];
            [descriptor setSizeInMillimeters:CGSizeMake(600, 340)];
            [descriptor setVendorID:0x4353]; [descriptor setProductID:0x5750]; [descriptor setSerialNum:1];
            display = [[NSClassFromString(@"CGVirtualDisplay") alloc] initWithDescriptor:descriptor];
            CGVirtualDisplaySettings* settings = [NSClassFromString(@"CGVirtualDisplaySettings") new];
            CGVirtualDisplayMode* mode = [[NSClassFromString(@"CGVirtualDisplayMode") alloc]
                initWithWidth:2560 height:1440 refreshRate:60];
            [settings setModes:@[mode]]; [settings setHiDPI:0];
            if (!display || ![display applySettings:settings]) throw std::runtime_error("virtual display creation failed");
            return "macos:" + std::to_string(display.displayID);
        }
    }
    void commit() override {
        private_screen = true;
        configure(false);
        verify();
    }
    void verify() override {
        if (!private_screen) return;
        const auto active = active_displays();
        if (active.size() != 1 || active[0] != display.displayID)
            throw std::runtime_error("physical display still active");
    }
    void restore(bool lock) override {
        if (!display) return;
        if (lock && private_screen) confirm_lock();
        configure(true); restore_layout();
        display = nil; private_screen = false;
    }
};
}
std::unique_ptr<PrivacyPlatform> privacy_platform() { return std::make_unique<MacPrivacy>(); }
bool platform_command(int, char**) {
    // A parent crash can close stdout between commit and its acknowledgement. Keep the
    // guardian alive to read EOF and lock before the virtual display is released.
    std::signal(SIGPIPE, SIG_IGN);
    return false;
}

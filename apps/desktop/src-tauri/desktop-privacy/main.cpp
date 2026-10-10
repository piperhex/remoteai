#include "platform.hpp"
#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <iostream>
#include <mutex>
#include <queue>
#include <thread>

namespace {
#ifndef PRIVACY_LEASE_MS
#define PRIVACY_LEASE_MS 20000
#endif
constexpr auto lease = std::chrono::milliseconds(PRIVACY_LEASE_MS);
struct Inbox {
    std::mutex mutex;
    std::condition_variable changed;
    std::queue<std::string> commands;
    bool closed = false;
};
void read_commands(const std::shared_ptr<Inbox>& inbox) {
    std::string line;
    while (std::getline(std::cin, line) && line.size() <= 32) {
        std::lock_guard lock(inbox->mutex);
        if (inbox->commands.size() >= 32) break;
        inbox->commands.push(line);
        inbox->changed.notify_one();
    }
    std::lock_guard lock(inbox->mutex);
    inbox->closed = true;
    inbox->changed.notify_one();
}
void watch(PrivacyPlatform& platform) {
    auto inbox = std::make_shared<Inbox>();
    std::thread(read_commands, inbox).detach();
    for (;;) {
        std::unique_lock lock(inbox->mutex);
        const bool received = inbox->changed.wait_for(lock, lease, [&] {
            return inbox->closed || !inbox->commands.empty();
        });
        if (!received || (inbox->closed && inbox->commands.empty())) { platform.restore(true); return; }
        auto command = inbox->commands.front(); inbox->commands.pop(); lock.unlock();
        if (command == "ping") { platform.verify(); continue; }
        if (command == "commit") {
            platform.commit(); std::cout << "ok" << std::endl; continue;
        }
        if (command == "disable" || command == "cancel") {
            platform.restore(false); std::cout << "ok" << std::endl; return;
        }
        platform.restore(true); return;
    }
}
[[noreturn]] void finish(std::unique_ptr<PrivacyPlatform>& platform, int code) {
    platform.reset();
    std::cout.flush(); std::cerr.flush();
    // A stdin reader may still be blocked after manual disable. Do not run iostream static
    // destructors concurrently with that reader; all owned display resources are released above.
    std::_Exit(code);
}
}
int main(int argc, char** argv) {
    if (platform_command(argc, argv)) return 0;
    if (argc != 1) return 2;
    auto platform = privacy_platform();
    try {
        std::cout << platform->prepare() << std::endl;
        watch(*platform);
        finish(platform, 0);
    } catch (const std::exception& error) {
        // Diagnostics stay on the host; the IPC boundary returns fixed user-facing messages.
        std::cerr << "privacy helper: " << error.what() << std::endl;
        // Keep ownership of the virtual display until locking and restoration succeed.
        // In particular, releasing a macOS virtual display on a failed lock can expose the desktop.
        for (;;) {
            try { platform->restore(true); break; }
            catch (const std::exception& cleanup) {
                std::cerr << "privacy recovery: " << cleanup.what() << std::endl;
                std::this_thread::sleep_for(std::chrono::seconds(1));
            }
        }
        finish(platform, 1);
    }
}

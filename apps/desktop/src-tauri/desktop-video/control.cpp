#include "video.hpp"
#include "desktop_context.hpp"
#include <array>
#include <cstring>

namespace desktop {
namespace {
constexpr uint32_t control_magic = 0x32575343;
constexpr uint32_t min_bitrate = 200'000, max_bitrate = 32'000'000, max_fps = 144;
}

bool Encoder::poll_controls() {
    check_service_desktop();
    const HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
    DWORD available = 0;
    // Test fixtures and old launchers may have no control pipe.
    if (!PeekNamedPipe(input, nullptr, 0, nullptr, &available, nullptr) || available < 12) return false;
    std::array<uint32_t, 3> message{};
    DWORD received = 0;
    if (!ReadFile(input, message.data(), sizeof(message), &received, nullptr) || received != sizeof(message))
        throw std::runtime_error("video control closed");
    const auto [magic, bitrate, fps] = message;
    if (magic != control_magic) throw std::runtime_error("invalid video control");
    if (bitrate != 0 || fps != 0) {
        if (bitrate < min_bitrate || bitrate > max_bitrate || fps < 1 || fps > max_fps)
            throw std::runtime_error("invalid video control settings");
        reconfigure(static_cast<int>(bitrate), static_cast<int>(fps));
    }
    keyframe = {};
    return true;
}

void Encoder::reconfigure(int bitrate, int fps) {
    if (config.bitrate == bitrate && config.fps == fps) return;
    config.bitrate = bitrate; config.fps = fps;
    const char* name = codec->codec->name;
    if (std::strcmp(name, "h264_nvenc") == 0 || std::strcmp(name, "hevc_nvenc") == 0) {
        // FFmpeg's NVENC wrapper reconfigures these public fields on the next submitted frame.
        codec->bit_rate = bitrate; codec->rc_max_rate = bitrate;
        codec->rc_buffer_size = bitrate / 2; codec->framerate = {fps, 1};
        return;
    }
    // MF/OpenH264 wrappers do not expose live rate updates. Retain the capture, GPU and process;
    // reopen only the codec and start with an IDR instead of tearing down the entire pipeline.
    receive();
    open_codec(name);
}
}

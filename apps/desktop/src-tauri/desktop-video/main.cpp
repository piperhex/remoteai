#include "video.hpp"
#include "audio.hpp"
#include "pacing.hpp"
#include "desktop_context.hpp"
#include <charconv>
#include <cstdio>
#include <fcntl.h>
#include <io.h>
#include <string_view>

namespace desktop {
namespace {
uint64_t number(std::string_view text) {
    uint64_t value = 0;
    const auto result = std::from_chars(text.data(), text.data() + text.size(), value);
    if (result.ec != std::errc{} || result.ptr != text.data() + text.size())
        throw std::runtime_error("invalid argument");
    return value;
}

Config parse(int argc, char** argv) {
    if (argc != 7 && argc != 8) throw std::runtime_error("invalid arguments");
    const auto width = number(argv[1]), height = number(argv[2]), fps = number(argv[3]);
    const auto bitrate = number(argv[4]), monitor = number(argv[5]);
    const std::string_view backend(argv[6]);
    const std::string_view codec = argc == 8 ? argv[7] : "h264";
    if (width < 2 || height < 2 || width > 16384 || height > 16384
        || width * height > 16'777'216 || width % 2 || height % 2
        || fps < 1 || fps > 144 || bitrate < 200'000 || bitrate > 32'000'000 || monitor == 0
        || (backend != "gpu" && backend != "gdi" && backend != "dxgi" && backend != "gdi-gpu")
        || (codec != "h264" && codec != "h265")) throw std::runtime_error("invalid settings");
    const auto capture = backend == "dxgi" ? CaptureBackend::Dxgi
        : backend == "gpu" ? CaptureBackend::Wgc : CaptureBackend::Gdi;
    return {static_cast<int>(width), static_cast<int>(height), static_cast<int>(fps),
        static_cast<int>(bitrate), reinterpret_cast<HMONITOR>(monitor), capture, nullptr,
        codec == "h265" ? VideoCodec::H265 : VideoCodec::H264, backend == "gdi"};
}

template<class Source> void stream_gpu(const Config& config, Encoder& encoder) {
    Source capture(encoder.gpu(), config);
    DamageGate gate(config.fps);
    FrameWait wait;
    for (;;) {
        if (encoder.poll_controls()) {
            gate.set_fps(encoder.fps()); gate.observe(true); capture.frame_rate(encoder.fps());
        }
        const bool captured = capture.poll(gate);
        const auto now = Clock::now();
        if (captured && gate.due(now)) {
            encoder.submit(capture.texture().get(), capture.rotation());
            gate.submitted(now);
        }
        encoder.receive();
        wait.until(Clock::now() + std::chrono::milliseconds(1));
    }
}

void stream_gdi(const Config& config, Encoder& encoder) {
    GdiCapture capture(config);
    capture.open();
    DamageGate gate(config.fps);
    FrameWait wait;
    auto next = Clock::now();
    for (;;) {
        if (encoder.poll_controls()) { gate.set_fps(encoder.fps()); gate.observe(true); }
        const auto interval = std::chrono::nanoseconds(1'000'000'000 / encoder.fps());
        capture.poll(gate);
        const auto now = Clock::now();
        if (gate.due(now)) {
            encoder.submit(capture);
            gate.submitted(now);
        }
        encoder.receive();
        const auto finished = Clock::now();
        next += interval * ((finished - next) / interval + 1);
        wait.until(next);
    }
}
}
}

int main(int argc, char** argv) {
    try {
        _setmode(_fileno(stdout), _O_BINARY);
        desktop::bind_service_desktop();
        SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        winrt::init_apartment(winrt::apartment_type::multi_threaded);
        av_log_set_level(AV_LOG_ERROR);
        if (argc == 2 && std::string_view(argv[1]) == "audio") { desktop::audio::stream(); return 0; }
        const auto config = desktop::parse(argc, argv);
        desktop::Encoder encoder(config);
        const unsigned char capabilities[] = {7, 0, 0, 0, 'C', 'S', 'W', '3',
            static_cast<uint8_t>(config.capture), static_cast<uint8_t>(encoder.backend()),
            static_cast<uint8_t>(config.codec)};
        if (std::fwrite(capabilities, 1, sizeof(capabilities), stdout) != sizeof(capabilities)
            || std::fflush(stdout) != 0) throw std::runtime_error("video output closed");
        if (config.capture == desktop::CaptureBackend::Gdi) desktop::stream_gdi(config, encoder);
        else if (config.capture == desktop::CaptureBackend::Dxgi)
            desktop::stream_gpu<desktop::DxgiCapture>(config, encoder);
        else desktop::stream_gpu<desktop::Capture>(config, encoder);
        return 0;
    } catch (const winrt::hresult_error& error) {
        std::fprintf(stderr, "desktop-video Windows error=%08lx\n", static_cast<unsigned long>(error.code().value));
    } catch (const std::exception& error) {
        std::fprintf(stderr, "desktop-video: %s\n", error.what());
    }
    return 1;
}

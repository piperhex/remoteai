#pragma once
#include "damage.hpp"
#include <windows.h>
#include <d3d11.h>
#include <d3d11_1.h>
#include <dxgi1_2.h>
#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>
extern "C" {
#include <libavcodec/avcodec.h>
#include <libavutil/hwcontext.h>
#include <libavutil/hwcontext_d3d11va.h>
#include <libavutil/opt.h>
#include <libswscale/swscale.h>
}

namespace desktop {
template<class T> using Com = winrt::com_ptr<T>;
enum class CaptureBackend : uint8_t { Wgc = 1, Dxgi = 2, Gdi = 3 };
enum class VideoCodec : uint8_t { H264 = 1, H265 = 2 };
enum class VideoEncoder : uint8_t { Nvenc = 1, MediaFoundation = 2, OpenH264 = 3 };
struct Config {
    int width, height, fps, bitrate;
    HMONITOR monitor;
    CaptureBackend capture;
    HWND window = nullptr;
    VideoCodec codec = VideoCodec::H264;
    bool software = false;
};
inline void check(int result) { if (result < 0) throw std::runtime_error("video operation failed"); }
struct FrameDelete { void operator()(AVFrame* frame) const { av_frame_free(&frame); } };
struct BufferDelete { void operator()(AVBufferRef* buffer) const { av_buffer_unref(&buffer); } };
struct CodecDelete { void operator()(AVCodecContext* codec) const { avcodec_free_context(&codec); } };
struct PacketDelete { void operator()(AVPacket* packet) const { av_packet_free(&packet); } };
using Frame = std::unique_ptr<AVFrame, FrameDelete>;
using Buffer = std::unique_ptr<AVBufferRef, BufferDelete>;
using Codec = std::unique_ptr<AVCodecContext, CodecDelete>;
using Packet = std::unique_ptr<AVPacket, PacketDelete>;

class Capture {
    winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool pool{nullptr};
    winrt::Windows::Graphics::Capture::GraphicsCaptureSession session{nullptr};
    winrt::Windows::Graphics::Capture::Direct3D11CaptureFrame latest{nullptr};
    winrt::Windows::Graphics::SizeInt32 size{};
public:
    Capture(ID3D11Device* device, const Config& config);
    Capture(const Capture&) = delete;
    Capture& operator=(const Capture&) = delete;
    ~Capture();
    bool poll(DamageGate& gate);
    void frame_rate(int fps);
    Com<ID3D11Texture2D> texture() const;
    DXGI_MODE_ROTATION rotation() const { return DXGI_MODE_ROTATION_IDENTITY; }
};

class GdiCapture {
    HDC screen = nullptr, memory = nullptr;
    HBITMAP bitmap = nullptr;
    HGDIOBJ previous_object = nullptr;
    uint8_t* pixels = nullptr;
    int width = 0, height = 0;
    HWND window = nullptr;
    HMONITOR monitor = nullptr;
    std::vector<uint8_t> previous;
public:
    explicit GdiCapture(const Config& config);
    GdiCapture(const GdiCapture&) = delete;
    GdiCapture& operator=(const GdiCapture&) = delete;
    ~GdiCapture();
    void open();
    bool poll(DamageGate& gate);
    const uint8_t* data() const { return pixels; }
    int stride() const { return width * 4; }
};

// Desktop Duplication and its D3D device must belong to the selected monitor's adapter.
std::string monitor_adapter(HMONITOR monitor);
class DxgiCapture {
    Com<ID3D11Device> device;
    Com<ID3D11DeviceContext> context;
    Com<IDXGIOutput1> output;
    Com<IDXGIOutputDuplication> duplication;
    Com<ID3D11Texture2D> latest;
    DXGI_MODE_ROTATION orientation = DXGI_MODE_ROTATION_IDENTITY;
    void copy(ID3D11Texture2D* source);
public:
    DxgiCapture(ID3D11Device* device, const Config& config);
    bool poll(DamageGate& gate);
    void frame_rate(int) {}
    Com<ID3D11Texture2D> texture() const { return latest; }
    DXGI_MODE_ROTATION rotation() const { return orientation; }
};

class Scaler {
    Com<ID3D11Device> device;
    Com<ID3D11VideoDevice> video;
    Com<ID3D11VideoContext> context;
    Com<ID3D11VideoProcessorEnumerator> enumerator;
    Com<ID3D11VideoProcessor> processor;
    Config config;
    UINT source_width = 0, source_height = 0;
    void configure(ID3D11Texture2D* source);
public:
    Scaler(ID3D11Device* device, const Config& config);
    void convert(ID3D11Texture2D* source, AVFrame* destination, DXGI_MODE_ROTATION rotation);
};

class Encoder {
    Config config;
    Buffer device;
    Buffer frames;
    Codec codec;
    Packet packet;
    Frame software;
    SwsContext* conversion = nullptr;
    std::unique_ptr<Scaler> scaler;
    Com<ID3D11Texture2D> uploaded;
    VideoEncoder implementation = VideoEncoder::OpenH264;
    Clock::time_point started = Clock::now(), keyframe{};
    void open_hardware();
    void open_codec(const char* name);
    void emit(AVFrame* frame);
    void reconfigure(int bitrate, int fps);
public:
    explicit Encoder(const Config& config);
    ~Encoder();
    ID3D11Device* gpu() const;
    void submit(ID3D11Texture2D* texture, DXGI_MODE_ROTATION rotation = DXGI_MODE_ROTATION_IDENTITY);
    void submit(const GdiCapture& capture);
    void receive();
    bool poll_controls();
    int fps() const { return config.fps; }
    VideoEncoder backend() const { return implementation; }
};
}

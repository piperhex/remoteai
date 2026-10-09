#include "video.hpp"
#include <d3d10.h>
#include <cstdio>

namespace desktop {
namespace {
constexpr int timebase = 1'000'000;
constexpr uint32_t max_packet = 8 * 1024 * 1024;

void configure_codec(AVCodecContext* codec, const Config& config) {
    codec->width = config.width; codec->height = config.height;
    codec->time_base = {1, timebase}; codec->framerate = {config.fps, 1};
    codec->bit_rate = config.bitrate; codec->rc_max_rate = config.bitrate;
    codec->rc_buffer_size = config.bitrate / 2;
    codec->gop_size = config.fps * 2; codec->max_b_frames = 0;
    codec->profile = config.codec == VideoCodec::H265 ? AV_PROFILE_HEVC_MAIN : AV_PROFILE_H264_BASELINE;
    codec->flags |= AV_CODEC_FLAG_LOW_DELAY;
    codec->color_range = AVCOL_RANGE_MPEG; codec->colorspace = AVCOL_SPC_BT709;
    codec->color_primaries = AVCOL_PRI_BT709; codec->color_trc = AVCOL_TRC_BT709;
}

void options(AVCodecContext* codec, const char* name) {
    auto set = [&](const char* key, const char* value) { check(av_opt_set(codec->priv_data, key, value, 0)); };
    if (std::strcmp(name, "h264_nvenc") == 0 || std::strcmp(name, "hevc_nvenc") == 0) {
        set("preset", "p1"); set("tune", "ull"); set("rc", "vbr");
        set("zerolatency", "1"); set("profile", std::strcmp(name, "hevc_nvenc") == 0 ? "main" : "baseline");
        // The default async output delay buffers several frames, which can mean seconds on idle desktops.
        set("delay", "0"); set("rc-lookahead", "0"); set("forced-idr", "1");
    } else if (std::strcmp(name, "h264_mf") == 0 || std::strcmp(name, "hevc_mf") == 0) {
        set("hw_encoding", "1"); set("scenario", "display_remoting"); set("rate_control", "ld_vbr");
    } else {
        set("rc_mode", "bitrate"); set("allow_skip_frames", "0");
    }
}

void write_packet(const AVPacket* packet) {
    if (packet->size <= 0 || static_cast<uint32_t>(packet->size) > max_packet)
        throw std::runtime_error("invalid video packet");
    const auto length = static_cast<uint32_t>(packet->size);
    const uint8_t header[] = {static_cast<uint8_t>(length), static_cast<uint8_t>(length >> 8),
        static_cast<uint8_t>(length >> 16), static_cast<uint8_t>(length >> 24)};
    // One length-delimited access unit is immediately readable, including the last update before idle.
    if (std::fwrite(header, 1, sizeof(header), stdout) != sizeof(header)
        || std::fwrite(packet->data, 1, length, stdout) != length || std::fflush(stdout) != 0)
        throw std::runtime_error("video output closed");
}
}

Encoder::Encoder(const Config& settings) : config(settings), packet(av_packet_alloc()) {
    if (!packet) throw std::bad_alloc();
    if (!config.software) { open_hardware(); return; }
    if (config.codec != VideoCodec::H264) throw std::runtime_error("hardware codec unavailable");
    open_codec("libopenh264");
    software.reset(av_frame_alloc());
    if (!software) throw std::bad_alloc();
    software->format = AV_PIX_FMT_YUV420P;
    software->width = config.width; software->height = config.height;
    check(av_frame_get_buffer(software.get(), 32));
    conversion = sws_getContext(config.width, config.height, AV_PIX_FMT_BGRA,
        config.width, config.height, AV_PIX_FMT_YUV420P, SWS_FAST_BILINEAR, nullptr, nullptr, nullptr);
    if (!conversion) throw std::runtime_error("video conversion unavailable");
    const auto coefficients = sws_getCoefficients(SWS_CS_ITU709);
    check(sws_setColorspaceDetails(conversion, coefficients, 1, coefficients, 0, 0, 1 << 16, 1 << 16));
}

Encoder::~Encoder() { sws_freeContext(conversion); }

ID3D11Device* Encoder::gpu() const {
    auto hardware = reinterpret_cast<AVHWDeviceContext*>(device->data);
    return static_cast<AVD3D11VADeviceContext*>(hardware->hwctx)->device;
}

void Encoder::open_hardware() {
    AVBufferRef* reference = nullptr;
    const auto adapter = config.capture == CaptureBackend::Dxgi ? monitor_adapter(config.monitor) : std::string{};
    check(av_hwdevice_ctx_create(&reference, AV_HWDEVICE_TYPE_D3D11VA,
        adapter.empty() ? nullptr : adapter.c_str(), nullptr, 0));
    device.reset(reference);
    Com<ID3D10Multithread> multithread;
    winrt::check_hresult(gpu()->QueryInterface(multithread.put()));
    multithread->SetMultithreadProtected(TRUE);
    frames.reset(av_hwframe_ctx_alloc(device.get()));
    if (!frames) throw std::bad_alloc();
    auto context = reinterpret_cast<AVHWFramesContext*>(frames->data);
    context->format = AV_PIX_FMT_D3D11; context->sw_format = AV_PIX_FMT_NV12;
    context->width = config.width; context->height = config.height;
    // Separate textures avoid array-view ambiguity in Media Foundation and the video processor.
    context->initial_pool_size = 0;
    auto d3d = static_cast<AVD3D11VAFramesContext*>(context->hwctx);
    d3d->BindFlags = D3D11_BIND_RENDER_TARGET;
    check(av_hwframe_ctx_init(frames.get()));
    try { open_codec(config.codec == VideoCodec::H265 ? "hevc_nvenc" : "h264_nvenc"); }
    catch (const std::exception&) { open_codec(config.codec == VideoCodec::H265 ? "hevc_mf" : "h264_mf"); }
    scaler = std::make_unique<Scaler>(gpu(), config);
}

void Encoder::open_codec(const char* name) {
    const auto encoder_codec = avcodec_find_encoder_by_name(name);
    if (!encoder_codec) throw std::runtime_error("encoder unavailable");
    Codec next(avcodec_alloc_context3(encoder_codec));
    if (!next) throw std::bad_alloc();
    configure_codec(next.get(), config);
    next->pix_fmt = config.software ? AV_PIX_FMT_YUV420P : AV_PIX_FMT_D3D11;
    if (frames) {
        next->hw_frames_ctx = av_buffer_ref(frames.get());
        if (!next->hw_frames_ctx) throw std::bad_alloc();
    }
    options(next.get(), name);
    check(avcodec_open2(next.get(), encoder_codec, nullptr));
    codec = std::move(next);
    implementation = std::strstr(name, "nvenc") ? VideoEncoder::Nvenc
        : std::strstr(name, "_mf") ? VideoEncoder::MediaFoundation : VideoEncoder::OpenH264;
    std::fprintf(stderr, "desktop-video encoder=%s\n", name);
}

void Encoder::submit(ID3D11Texture2D* texture, DXGI_MODE_ROTATION rotation) {
    Frame frame(av_frame_alloc());
    if (!frame) throw std::bad_alloc();
    check(av_hwframe_get_buffer(frames.get(), frame.get(), 0));
    scaler->convert(texture, frame.get(), rotation);
    emit(frame.get());
}

void Encoder::submit(const GdiCapture& capture) {
    if (!config.software) {
        if (!uploaded) {
            D3D11_TEXTURE2D_DESC description{};
            description.Width = config.width; description.Height = config.height;
            description.MipLevels = 1; description.ArraySize = 1;
            description.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
            description.SampleDesc.Count = 1; description.BindFlags = D3D11_BIND_RENDER_TARGET;
            winrt::check_hresult(gpu()->CreateTexture2D(&description, nullptr, uploaded.put()));
        }
        Com<ID3D11DeviceContext> context;
        gpu()->GetImmediateContext(context.put());
        context->UpdateSubresource(uploaded.get(), 0, nullptr, capture.data(), capture.stride(), 0);
        submit(uploaded.get());
        return;
    }
    check(av_frame_make_writable(software.get()));
    const uint8_t* input[] = {capture.data()};
    const int strides[] = {capture.stride()};
    check(sws_scale(conversion, input, strides, 0, config.height, software->data, software->linesize));
    emit(software.get());
}

void Encoder::emit(AVFrame* frame) {
    const auto now = Clock::now();
    frame->pts = std::chrono::duration_cast<std::chrono::microseconds>(now - started).count();
    frame->pict_type = AV_PICTURE_TYPE_NONE;
    if (keyframe == Clock::time_point{} || now - keyframe >= refresh_interval) {
        frame->pict_type = AV_PICTURE_TYPE_I;
        keyframe = now;
    }
    check(avcodec_send_frame(codec.get(), frame));
    receive();
}

void Encoder::receive() {
    for (;;) {
        const int result = avcodec_receive_packet(codec.get(), packet.get());
        if (result == AVERROR(EAGAIN)) return;
        check(result);
        write_packet(packet.get());
        av_packet_unref(packet.get());
    }
}
}

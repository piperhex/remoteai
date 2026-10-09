#include "video.hpp"

namespace desktop {
Scaler::Scaler(ID3D11Device* gpu, const Config& settings) : config(settings) {
    device.copy_from(gpu);
    video = device.as<ID3D11VideoDevice>();
    Com<ID3D11DeviceContext> immediate;
    device->GetImmediateContext(immediate.put());
    context = immediate.as<ID3D11VideoContext>();
}

void Scaler::configure(ID3D11Texture2D* source) {
    D3D11_TEXTURE2D_DESC texture{};
    source->GetDesc(&texture);
    if (texture.Width == source_width && texture.Height == source_height) return;
    source_width = texture.Width; source_height = texture.Height;
    D3D11_VIDEO_PROCESSOR_CONTENT_DESC description{};
    description.InputFrameFormat = D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE;
    description.InputWidth = source_width; description.InputHeight = source_height;
    description.OutputWidth = config.width; description.OutputHeight = config.height;
    description.InputFrameRate = {static_cast<UINT>(config.fps), 1};
    description.OutputFrameRate = description.InputFrameRate;
    description.Usage = D3D11_VIDEO_USAGE_PLAYBACK_NORMAL;
    enumerator = nullptr; processor = nullptr;
    winrt::check_hresult(video->CreateVideoProcessorEnumerator(&description, enumerator.put()));
    winrt::check_hresult(video->CreateVideoProcessor(enumerator.get(), 0, processor.put()));
    RECT input{0, 0, static_cast<LONG>(source_width), static_cast<LONG>(source_height)};
    RECT output{0, 0, config.width, config.height};
    context->VideoProcessorSetStreamSourceRect(processor.get(), 0, TRUE, &input);
    context->VideoProcessorSetStreamDestRect(processor.get(), 0, TRUE, &output);
    context->VideoProcessorSetOutputTargetRect(processor.get(), TRUE, &output);
    context->VideoProcessorSetStreamAutoProcessingMode(processor.get(), 0, FALSE);
    D3D11_VIDEO_PROCESSOR_COLOR_SPACE rgb{}, yuv{};
    rgb.RGB_Range = 0; yuv.YCbCr_Matrix = 1;
    context->VideoProcessorSetStreamColorSpace(processor.get(), 0, &rgb);
    context->VideoProcessorSetOutputColorSpace(processor.get(), &yuv);
}

void Scaler::convert(ID3D11Texture2D* source, AVFrame* destination, DXGI_MODE_ROTATION rotation) {
    configure(source);
    // Duplication surfaces are unrotated; rotate on the GPU before presenting a portrait/flipped desktop.
    const bool rotated = rotation >= DXGI_MODE_ROTATION_ROTATE90 && rotation <= DXGI_MODE_ROTATION_ROTATE270;
    const auto rotating = context.try_as<ID3D11VideoContext1>();
    if (rotated && !rotating) throw std::runtime_error("display rotation unavailable");
    if (rotating) rotating->VideoProcessorSetStreamRotation(processor.get(), 0, rotated,
        rotated ? static_cast<D3D11_VIDEO_PROCESSOR_ROTATION>(rotation - DXGI_MODE_ROTATION_IDENTITY)
            : D3D11_VIDEO_PROCESSOR_ROTATION_IDENTITY);
    D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC input{};
    input.ViewDimension = D3D11_VPIV_DIMENSION_TEXTURE2D;
    Com<ID3D11VideoProcessorInputView> input_view;
    winrt::check_hresult(video->CreateVideoProcessorInputView(source, enumerator.get(), &input, input_view.put()));
    D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC output{};
    output.ViewDimension = D3D11_VPOV_DIMENSION_TEXTURE2D;
    auto texture = reinterpret_cast<ID3D11Texture2D*>(destination->data[0]);
    Com<ID3D11VideoProcessorOutputView> output_view;
    winrt::check_hresult(video->CreateVideoProcessorOutputView(texture, enumerator.get(), &output, output_view.put()));
    D3D11_VIDEO_PROCESSOR_STREAM stream{};
    stream.Enable = TRUE; stream.pInputSurface = input_view.get();
    winrt::check_hresult(context->VideoProcessorBlt(processor.get(), output_view.get(), 0, 1, &stream));
}
}

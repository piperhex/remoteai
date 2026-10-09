#include "video.hpp"
#include <string>

namespace desktop {
namespace {
Com<IDXGIOutput1> find_output(IDXGIAdapter* adapter, HMONITOR monitor) {
    for (UINT index = 0; ; ++index) {
        Com<IDXGIOutput> output;
        const auto result = adapter->EnumOutputs(index, output.put());
        if (result == DXGI_ERROR_NOT_FOUND) return {};
        winrt::check_hresult(result);
        DXGI_OUTPUT_DESC description{};
        winrt::check_hresult(output->GetDesc(&description));
        if (description.Monitor == monitor) return output.as<IDXGIOutput1>();
    }
}

struct AcquiredFrame {
    IDXGIOutputDuplication* duplication;
    ~AcquiredFrame() {
        // Cleanup must also run during exceptions; access loss is handled by the next acquisition.
        duplication->ReleaseFrame();
    }
};
}

std::string monitor_adapter(HMONITOR monitor) {
    Com<IDXGIFactory1> factory;
    winrt::check_hresult(CreateDXGIFactory1(__uuidof(IDXGIFactory1), factory.put_void()));
    for (UINT index = 0; ; ++index) {
        Com<IDXGIAdapter1> adapter;
        const auto result = factory->EnumAdapters1(index, adapter.put());
        if (result == DXGI_ERROR_NOT_FOUND) throw std::runtime_error("display adapter unavailable");
        winrt::check_hresult(result);
        if (find_output(adapter.get(), monitor)) return std::to_string(index);
    }
}

DxgiCapture::DxgiCapture(ID3D11Device* gpu, const Config& config) {
    device.copy_from(gpu);
    device->GetImmediateContext(context.put());
    auto dxgi = device.as<IDXGIDevice>();
    Com<IDXGIAdapter> adapter;
    winrt::check_hresult(dxgi->GetAdapter(adapter.put()));
    output = find_output(adapter.get(), config.monitor);
    if (!output) throw std::runtime_error("display adapter mismatch");
    winrt::check_hresult(output->DuplicateOutput(device.get(), duplication.put()));
    DXGI_OUTDUPL_DESC description{};
    duplication->GetDesc(&description);
    orientation = description.Rotation;
}

void DxgiCapture::copy(ID3D11Texture2D* source) {
    D3D11_TEXTURE2D_DESC description{}, previous{};
    source->GetDesc(&description);
    if (latest) latest->GetDesc(&previous);
    if (!latest || previous.Width != description.Width || previous.Height != description.Height
        || previous.Format != description.Format) {
        latest = nullptr;
        description.Usage = D3D11_USAGE_DEFAULT;
        description.BindFlags = D3D11_BIND_RENDER_TARGET;
        description.CPUAccessFlags = 0;
        description.MiscFlags = 0;
        winrt::check_hresult(device->CreateTexture2D(&description, nullptr, latest.put()));
    }
    // Own the texture before ReleaseFrame; later idle refreshes must not read a released desktop surface.
    context->CopyResource(latest.get(), source);
}

bool DxgiCapture::poll(DamageGate& gate) {
    DXGI_OUTDUPL_FRAME_INFO information{};
    Com<IDXGIResource> resource;
    const auto result = duplication->AcquireNextFrame(0, &information, resource.put());
    if (result == DXGI_ERROR_WAIT_TIMEOUT) return static_cast<bool>(latest);
    // Access loss exits this helper. The service reopens the active desktop and refreshes monitor dimensions.
    winrt::check_hresult(result);
    AcquiredFrame acquired{duplication.get()};
    const bool changed = information.LastPresentTime.QuadPart != 0 || !latest;
    if (changed) copy(resource.as<ID3D11Texture2D>().get());
    gate.observe(changed);
    return static_cast<bool>(latest);
}
}

import Foundation
import VideoToolbox

func selfTest() throws {
    try framingSelfTest()
    try encoderSelfTest()
    print("macOS desktop framing, H.264 encoding, dropped-frame recovery and keyframe control passed")
}

private func framingSelfTest() throws {
    let payload = Data([0, 0, 0, 2, 0x65, 7, 0, 0, 0, 1, 9])
    let expected = Data([0, 0, 0, 1, 0x65, 7, 0, 0, 0, 1, 9])
    guard try Wire.annexB(payload, lengthBytes: 4) == expected,
          Wire.word(try Wire.packet(Data([9])), at: 0) == 1 else { throw DesktopVideoError.invalidPacket }
    for invalid in [Data([0, 0, 0]), Data([0, 0, 0, 2, 9]), Data([0, 0, 0, 0])] {
        do {
            _ = try Wire.annexB(invalid, lengthBytes: 4)
            throw DesktopVideoError.encoding
        } catch DesktopVideoError.invalidPacket { /* Expected malformed data rejection. */ }
    }
}

private func encoderSelfTest() throws {
    let options = try CaptureOptions(arguments: ["1", "320", "240", "30", "1000000"])
    let pixelBuffer = try makeTestPixelBuffer(options)
    let lock = NSLock()
    var frames = [Data]()
    let encoder = try VideoEncoder(options: options) { frame in
        lock.lock()
        defer { lock.unlock() }
        frames.append(frame)
    }
    try encoder.encode(pixelBuffer, at: CMTime(value: 0, timescale: 30))
    try encoder.finish()
    // Use the real callback: a successful drop with a nil sample must leave this encoder usable.
    VideoEncoder.outputCallback(Unmanaged.passUnretained(encoder).toOpaque(), nil, noErr,
        [.asynchronous, .frameDropped], nil)
    try encoder.control(bitrate: 2_000_000, fps: 30)
    try encoder.encode(pixelBuffer, at: CMTime(value: 1, timescale: 30))
    try encoder.finish()
    lock.lock()
    defer { lock.unlock() }
    guard frames.count == 2, frames.allSatisfy({
        $0.count > 4 && $0.starts(with: [0, 0, 0, 1]) && $0[4] & 0x1f == 7
    }) else {
        throw DesktopVideoError.encoding
    }
}

private func makeTestPixelBuffer(_ options: CaptureOptions) throws -> CVPixelBuffer {
    var pixelBuffer: CVPixelBuffer?
    guard CVPixelBufferCreate(nil, options.width, options.height, kCVPixelFormatType_32BGRA,
        [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &pixelBuffer) == kCVReturnSuccess,
        let pixelBuffer else { throw DesktopVideoError.encoding }
    guard CVPixelBufferLockBaseAddress(pixelBuffer, []) == kCVReturnSuccess else {
        throw DesktopVideoError.encoding
    }
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }
    if let base = CVPixelBufferGetBaseAddress(pixelBuffer) {
        memset(base, 128, CVPixelBufferGetBytesPerRow(pixelBuffer) * options.height)
    }
    return pixelBuffer
}

import Foundation
import VideoToolbox

final class VideoEncoder {
    private var session: VTCompressionSession?
    private var forceKeyframe = true
    private let output: (Data) throws -> Void

    static let outputCallback: VTCompressionOutputCallback = { context, _, status, flags, sample in
        guard status == noErr else { exit(1) }
        // VideoToolbox may successfully drop a frame and provide no sample buffer.
        if flags.contains(.frameDropped) { return }
        guard let context, let sample else { exit(1) }
        let encoder = Unmanaged<VideoEncoder>.fromOpaque(context).takeUnretainedValue()
        do { try encoder.emit(sample) } catch { exit(1) }
    }

    init(options: CaptureOptions, output: @escaping (Data) throws -> Void) throws {
        self.output = output
        let result = VTCompressionSessionCreate(
            allocator: nil, width: Int32(options.width), height: Int32(options.height),
            codecType: kCMVideoCodecType_H264, encoderSpecification: nil,
            imageBufferAttributes: nil, compressedDataAllocator: nil,
            outputCallback: Self.outputCallback,
            refcon: Unmanaged.passUnretained(self).toOpaque(), compressionSessionOut: &session
        )
        guard result == noErr, session != nil else { throw DesktopVideoError.encoding }
        try set(kVTCompressionPropertyKey_RealTime, kCFBooleanTrue)
        try set(kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse)
        try set(kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_H264_Baseline_AutoLevel)
        try set(kVTCompressionPropertyKey_MaxKeyFrameInterval, options.fps as CFNumber)
        try set(kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, 1 as CFNumber)
        try set(kVTCompressionPropertyKey_ExpectedFrameRate, options.fps as CFNumber)
        try set(kVTCompressionPropertyKey_AverageBitRate, options.bitrate as CFNumber)
        guard let session, VTCompressionSessionPrepareToEncodeFrames(session) == noErr else {
            throw DesktopVideoError.encoding
        }
    }

    deinit { if let session { VTCompressionSessionInvalidate(session) } }

    private func set(_ key: CFString, _ value: CFTypeRef) throws {
        guard let session, VTSessionSetProperty(session, key: key, value: value) == noErr else {
            throw DesktopVideoError.encoding
        }
    }

    // Called on the same serial queue as encode, so controls never race a submitted frame.
    func control(bitrate: UInt32, fps: UInt32) throws {
        forceKeyframe = true
        if bitrate == 0 && fps == 0 { return }
        guard (200_000...32_000_000).contains(bitrate), (1...144).contains(fps) else {
            throw DesktopVideoError.invalidArguments
        }
        try set(kVTCompressionPropertyKey_AverageBitRate, Int(bitrate) as CFNumber)
    }

    func encode(_ buffer: CVPixelBuffer, at timestamp: CMTime) throws {
        guard let session else { throw DesktopVideoError.encoding }
        let properties = forceKeyframe ? [kVTEncodeFrameOptionKey_ForceKeyFrame: true] as CFDictionary : nil
        forceKeyframe = false
        let result = VTCompressionSessionEncodeFrame(session, imageBuffer: buffer,
            presentationTimeStamp: timestamp, duration: .invalid, frameProperties: properties,
            sourceFrameRefcon: nil, infoFlagsOut: nil)
        guard result == noErr else { throw DesktopVideoError.encoding }
    }

    func finish() throws {
        guard let session, VTCompressionSessionCompleteFrames(session, untilPresentationTimeStamp: .invalid) == noErr
        else { throw DesktopVideoError.encoding }
    }

    private func emit(_ sample: CMSampleBuffer) throws {
        guard CMSampleBufferDataIsReady(sample), let format = CMSampleBufferGetFormatDescription(sample),
              let block = CMSampleBufferGetDataBuffer(sample) else { throw DesktopVideoError.encoding }
        let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false)
            as? [[CFString: Any]]
        let keyframe = attachments?.first?[kCMSampleAttachmentKey_NotSync] as? Bool != true
        var parameters = Data()
        var lengthBytes: Int32 = 0
        try parameterSets(format, into: &parameters, lengthBytes: &lengthBytes, include: keyframe)
        let length = CMBlockBufferGetDataLength(block)
        guard length > 0, length <= Wire.maximumPacket else { throw DesktopVideoError.invalidPacket }
        var payload = Data(count: length)
        let copied = payload.withUnsafeMutableBytes {
            CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: $0.baseAddress!)
        }
        guard copied == noErr else { throw DesktopVideoError.encoding }
        parameters.append(try Wire.annexB(payload, lengthBytes: Int(lengthBytes)))
        try output(parameters)
    }

    private func parameterSets(_ format: CMFormatDescription, into data: inout Data,
                               lengthBytes: inout Int32, include: Bool) throws {
        var count = 0
        guard CMVideoFormatDescriptionGetH264ParameterSetAtIndex(format, parameterSetIndex: 0,
            parameterSetPointerOut: nil, parameterSetSizeOut: nil, parameterSetCountOut: &count,
            nalUnitHeaderLengthOut: &lengthBytes) == noErr else { throw DesktopVideoError.encoding }
        if !include { return }
        for index in 0..<count {
            var pointer: UnsafePointer<UInt8>?
            var size = 0
            guard CMVideoFormatDescriptionGetH264ParameterSetAtIndex(format, parameterSetIndex: index,
                parameterSetPointerOut: &pointer, parameterSetSizeOut: &size, parameterSetCountOut: nil,
                nalUnitHeaderLengthOut: nil) == noErr, let pointer else { throw DesktopVideoError.encoding }
            data.append(contentsOf: [0, 0, 0, 1])
            data.append(pointer, count: size)
        }
    }
}

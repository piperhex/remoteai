import Foundation
import ScreenCaptureKit

@available(macOS 13.0, *)
final class DesktopCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    private let queue = DispatchQueue(label: "dev.codex.switch.desktop.capture")
    private let outputQueue = DispatchQueue(label: "dev.codex.switch.desktop.output")
    private let pendingFrames = DispatchSemaphore(value: 2)
    private let options: CaptureOptions
    private var encoder: VideoEncoder?
    private var stream: SCStream?
    private var latest: CVPixelBuffer?
    private var lastFrame = DispatchTime.now()
    private var timer: DispatchSourceTimer?

    init(options: CaptureOptions) { self.options = options }

    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first(where: { $0.displayID == options.display }) else {
            throw DesktopVideoError.unavailableDisplay
        }
        encoder = try VideoEncoder(options: options) { [weak self] frame in try self?.write(frame) }
        try FileHandle.standardOutput.write(contentsOf: Wire.packet(Data("CSW2".utf8)))
        let configuration = SCStreamConfiguration()
        configuration.width = options.width
        configuration.height = options.height
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: Int32(options.fps))
        configuration.queueDepth = 3
        configuration.showsCursor = false
        configuration.capturesAudio = false
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        self.stream = stream
        try await stream.startCapture()
        startHeartbeat()
        startControls()
    }

    private func write(_ frame: Data) throws {
        // A blocked pipe must never grow an unbounded frame queue. Do not drop encoded reference frames:
        // backpressure the encoder instead, while capture retains at most its configured surface queue.
        pendingFrames.wait()
        let packet: Data
        do { packet = try Wire.packet(frame) } catch { pendingFrames.signal(); throw error }
        outputQueue.async { [self] in
            defer { pendingFrames.signal() }
            do { try FileHandle.standardOutput.write(contentsOf: packet) } catch { exit(1) }
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sample.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false)
                as? [[SCStreamFrameInfo: Any]],
              let status = attachments.first?[.status] as? Int else { return }
        if [SCFrameStatus.blank, .suspended, .stopped].contains(where: { $0.rawValue == status }) {
            // A locked or unavailable desktop must not keep streaming the last unlocked screen.
            exit(1)
        }
        guard status == SCFrameStatus.complete.rawValue, let image = sample.imageBuffer else { return }
        latest = image
        encode(image)
    }

    private func encode(_ image: CVPixelBuffer) {
        lastFrame = .now()
        let timestamp = CMTime(value: Int64(lastFrame.uptimeNanoseconds), timescale: 1_000_000_000)
        do { try encoder?.encode(image, at: timestamp) } catch { exit(1) }
    }

    private func startHeartbeat() {
        let interval = max(500_000_000, 1_000_000_000 / options.fps)
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + .nanoseconds(interval), repeating: .nanoseconds(interval))
        timer.setEventHandler { [weak self] in
            guard let self, let image = latest,
                  DispatchTime.now().uptimeNanoseconds - lastFrame.uptimeNanoseconds >= UInt64(interval) else { return }
            // ScreenCaptureKit may stop producing samples on a static desktop; keep recovery IDRs flowing.
            encode(image)
        }
        self.timer = timer
        timer.resume()
    }

    private func startControls() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var buffer = Data()
            while let self {
                do {
                    guard let part = try FileHandle.standardInput.read(upToCount: Wire.controlBytes), !part.isEmpty
                    else { exit(0) }
                    buffer.append(part)
                    if buffer.count < Wire.controlBytes { continue }
                    guard Wire.word(buffer, at: 0) == Wire.controlMagic else { exit(1) }
                    let bitrate = Wire.word(buffer, at: 4)
                    let fps = Wire.word(buffer, at: 8)
                    buffer.removeFirst(Wire.controlBytes)
                    // Rebase Data indices after removeFirst before reading the next message.
                    buffer = Data(buffer)
                    self.queue.async { [self] in
                        do {
                            try self.encoder?.control(bitrate: bitrate, fps: fps)
                            if let image = self.latest { self.encode(image) }
                        } catch { exit(1) }
                    }
                } catch { exit(1) }
            }
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) { exit(1) }
}

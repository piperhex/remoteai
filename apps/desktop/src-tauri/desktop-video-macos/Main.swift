import Foundation

@main
struct DesktopVideo {
    static func main() async {
        do {
            if Array(CommandLine.arguments.dropFirst()) == ["--self-test"] {
                try selfTest()
                return
            }
            let options = try CaptureOptions(arguments: Array(CommandLine.arguments.dropFirst()))
            guard #available(macOS 13.0, *) else { exit(1) }
            let capture = DesktopCapture(options: options)
            try await capture.start()
            // The stream callbacks and stdin EOF control lifetime; retain capture throughout.
            while true {
                try await Task.sleep(nanoseconds: 60_000_000_000)
                withExtendedLifetime(capture) {}
            }
        } catch {
            // Keep stdout binary and avoid exposing system details through the remote session.
            exit(1)
        }
    }
}

import Foundation

enum DesktopVideoError: Error {
    case invalidArguments, unavailableDisplay, encoding, invalidPacket
}

struct CaptureOptions {
    let display: UInt32
    let width: Int
    let height: Int
    let fps: Int
    let bitrate: Int

    init(arguments: [String]) throws {
        guard arguments.count == 5, let display = UInt32(arguments[0]),
              let width = Int(arguments[1]), let height = Int(arguments[2]),
              let fps = Int(arguments[3]), let bitrate = Int(arguments[4]),
              (2...2560).contains(width), (2...16384).contains(height),
              width % 2 == 0, height % 2 == 0, (1...144).contains(fps),
              (200_000...32_000_000).contains(bitrate) else {
            throw DesktopVideoError.invalidArguments
        }
        self.display = display
        self.width = width
        self.height = height
        self.fps = fps
        self.bitrate = bitrate
    }
}

enum Wire {
    static let controlBytes = 12
    static let controlMagic: UInt32 = 0x3257_5343
    static let maximumPacket = 8 * 1024 * 1024

    static func word(_ data: Data, at offset: Int) -> UInt32 {
        let bytes = [UInt8](data[offset..<offset + 4])
        return UInt32(bytes[0]) | UInt32(bytes[1]) << 8 | UInt32(bytes[2]) << 16 | UInt32(bytes[3]) << 24
    }

    static func packet(_ data: Data) throws -> Data {
        guard !data.isEmpty, data.count <= maximumPacket else { throw DesktopVideoError.invalidPacket }
        var size = UInt32(data.count).littleEndian
        var result = withUnsafeBytes(of: &size) { Data($0) }
        result.append(data)
        return result
    }

    static func annexB(_ data: Data, lengthBytes: Int) throws -> Data {
        guard (1...4).contains(lengthBytes) else { throw DesktopVideoError.invalidPacket }
        var output = Data()
        var offset = 0
        while offset < data.count {
            guard offset + lengthBytes <= data.count else { throw DesktopVideoError.invalidPacket }
            var length = 0
            for byte in data[offset..<offset + lengthBytes] { length = (length << 8) | Int(byte) }
            offset += lengthBytes
            guard length > 0, length <= data.count - offset else { throw DesktopVideoError.invalidPacket }
            output.append(contentsOf: [0, 0, 0, 1])
            output.append(data[offset..<offset + length])
            offset += length
        }
        return output
    }
}

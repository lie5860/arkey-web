import Foundation

public enum CodexMicroProtocolError: Error, Equatable {
    case invalidReportLength(Int)
    case invalidReportID(UInt8)
    case invalidChannel(UInt8)
    case invalidPayloadLength(Int)
    case invalidJSON
}

public enum CodexMicroProtocol {
    public static let vendorID: UInt32 = 0x303A
    public static let productID: UInt32 = 0x8360
    public static let reportID: UInt8 = 0x06
    public static let rpcChannel: UInt8 = 0x02
    public static let reportSize = 64
    public static let payloadSize = 61

    // Usage page FF00, usage 61, one 63-byte input and output report with ID 06.
    public static let reportDescriptor = Data([
        0x06, 0x00, 0xFF,
        0x09, 0x61,
        0xA1, 0x01,
        0x85, reportID,
        0x09, 0x62,
        0x15, 0x00,
        0x26, 0xFF, 0x00,
        0x95, 0x3F,
        0x75, 0x08,
        0x81, 0x02,
        0x09, 0x63,
        0x15, 0x00,
        0x26, 0xFF, 0x00,
        0x95, 0x3F,
        0x75, 0x08,
        0x91, 0x82,
        0xC0,
    ])

    public static func normalizeOutputReport(reportID explicitReportID: UInt8?, data: Data) throws -> Data {
        if data.count == reportSize {
            guard data.first == reportID else {
                throw CodexMicroProtocolError.invalidReportID(data.first ?? 0)
            }
            return data
        }

        if data.count == reportSize - 1 {
            let receivedID = explicitReportID ?? reportID
            guard receivedID == reportID else {
                throw CodexMicroProtocolError.invalidReportID(receivedID)
            }
            return Data([receivedID]) + data
        }

        throw CodexMicroProtocolError.invalidReportLength(data.count)
    }

    public static func reports(forJSONObject object: Any) throws -> [Data] {
        guard JSONSerialization.isValidJSONObject(object) else {
            throw CodexMicroProtocolError.invalidJSON
        }
        var bytes = [UInt8](try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]))
        bytes.append(0x0A)

        return stride(from: 0, to: bytes.count, by: payloadSize).map { offset in
            let end = min(offset + payloadSize, bytes.count)
            let chunk = bytes[offset..<end]
            var report = [UInt8](repeating: 0, count: reportSize)
            report[0] = reportID
            report[1] = rpcChannel
            report[2] = UInt8(chunk.count)
            report.replaceSubrange(3..<(3 + chunk.count), with: chunk)
            return Data(report)
        }
    }

    public static func agentEvent(slot: Int, pressed: Bool) throws -> [Data] {
        guard (0..<6).contains(slot) else {
            throw CodexMicroProtocolError.invalidPayloadLength(slot)
        }
        return try reports(forJSONObject: [
            "method": "v.oai.hid",
            "params": [
                "act": pressed ? 1 : 0,
                "ag": slot,
                "k": String(format: "AG%02d", slot),
            ],
        ])
    }
}

public struct CodexMicroJSONAccumulator: Sendable {
    private var buffer = Data()
    private let maximumBufferedBytes: Int

    public init(maximumBufferedBytes: Int = 16_384) {
        self.maximumBufferedBytes = maximumBufferedBytes
    }

    public mutating func append(report: Data) throws -> [Any] {
        guard report.count == CodexMicroProtocol.reportSize else {
            throw CodexMicroProtocolError.invalidReportLength(report.count)
        }
        guard report[0] == CodexMicroProtocol.reportID else {
            throw CodexMicroProtocolError.invalidReportID(report[0])
        }
        guard report[1] == CodexMicroProtocol.rpcChannel else {
            throw CodexMicroProtocolError.invalidChannel(report[1])
        }

        let count = Int(report[2])
        guard count <= CodexMicroProtocol.payloadSize else {
            throw CodexMicroProtocolError.invalidPayloadLength(count)
        }
        let pendingSize = buffer.count + count
        guard pendingSize <= maximumBufferedBytes else {
            buffer.removeAll(keepingCapacity: true)
            throw CodexMicroProtocolError.invalidPayloadLength(pendingSize)
        }

        buffer.append(report.subdata(in: 3..<(3 + count)))
        var messages: [Any] = []
        while let newline = buffer.firstIndex(of: 0x0A) {
            let messageData = buffer[..<newline]
            buffer.removeSubrange(...newline)
            guard !messageData.isEmpty else { continue }
            guard let object = try? JSONSerialization.jsonObject(with: messageData) else {
                throw CodexMicroProtocolError.invalidJSON
            }
            messages.append(object)
        }
        if !buffer.isEmpty, let object = try? JSONSerialization.jsonObject(with: buffer) {
            messages.append(object)
            buffer.removeAll(keepingCapacity: true)
        }
        return messages
    }
}

public struct CodexMicroRPCResult: Sendable {
    public let response: [String: any Sendable]
    public let event: CodexMicroHostEvent
}

public enum CodexMicroHostEvent: Sendable, Equatable {
    case handshake(method: String)
    case threadStatus(slots: [CodexMicroSlotLight])
    case rgbConfiguration
    case other(method: String)
}

public struct CodexMicroSlotLight: Sendable, Equatable {
    public let slot: Int
    public let color: UInt32?
    public let brightness: Double?
    public let effect: Int?
    public let speed: Double?

    public init(slot: Int, color: UInt32?, brightness: Double?, effect: Int?, speed: Double?) {
        self.slot = slot
        self.color = color
        self.brightness = brightness
        self.effect = effect
        self.speed = speed
    }
}

public enum CodexMicroRPC {
    public static func handle(_ object: Any) throws -> CodexMicroRPCResult {
        guard let request = object as? [String: Any],
              let method = request["method"] as? String else {
            throw CodexMicroProtocolError.invalidJSON
        }

        var response: [String: any Sendable] = [:]
        if let identifier = request["id"] as? Int {
            response["id"] = identifier
        } else if let identifier = request["id"] as? String {
            response["id"] = identifier
        }

        switch method {
        case "sys.version":
            let version: [String: any Sendable] = ["version": "0.1.4"]
            response["result"] = version
            return CodexMicroRPCResult(response: response, event: .handshake(method: method))
        case "device.status":
            let status: [String: any Sendable] = [
                "battery": 100,
                "is_charging": true,
                "layer_index": 0,
                "profile_index": 0,
                "version": "0.1.4",
            ]
            response["result"] = status
            return CodexMicroRPCResult(response: response, event: .handshake(method: method))
        case "v.oai.thstatus":
            response["result"] = true
            return CodexMicroRPCResult(
                response: response,
                event: .threadStatus(slots: parseSlotLights(request["params"]))
            )
        case "v.oai.rgbcfg":
            response["result"] = true
            return CodexMicroRPCResult(response: response, event: .rgbConfiguration)
        default:
            response["result"] = true
            return CodexMicroRPCResult(response: response, event: .other(method: method))
        }
    }

    private static func parseSlotLights(_ value: Any?) -> [CodexMicroSlotLight] {
        guard let values = value as? [[String: Any]] else { return [] }
        return values.compactMap { item in
            guard let slot = item["id"] as? Int, (0..<6).contains(slot) else { return nil }
            return CodexMicroSlotLight(
                slot: slot,
                color: (item["c"] as? NSNumber).map { $0.uint32Value },
                brightness: (item["b"] as? NSNumber)?.doubleValue,
                effect: (item["e"] as? NSNumber)?.intValue,
                speed: (item["s"] as? NSNumber)?.doubleValue
            )
        }
    }
}

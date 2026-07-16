import Foundation
import IOKit.hid

enum CodexMicroLabTarget: Int, CaseIterable, Codable, Identifiable {
    case agent1 = 0
    case agent2
    case agent3
    case agent4
    case agent5
    case agent6
    case command1
    case command2
    case command3
    case command4
    case command5
    case command6
    case encoderPress
    case joystickUp
    case joystickRight
    case joystickDown
    case joystickLeft

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .agent1: "Agent 1"
        case .agent2: "Agent 2"
        case .agent3: "Agent 3"
        case .agent4: "Agent 4"
        case .agent5: "Agent 5"
        case .agent6: "Agent 6"
        case .command1: "Fast · ACT06"
        case .command2: "Approve · ACT07"
        case .command3: "Decline · ACT08"
        case .command4: "Continue · ACT09"
        case .command5: "PTT · ACT10"
        case .command6: "Send · ACT12"
        case .encoderPress: "旋钮按下 · ENC_PRESS"
        case .joystickUp: "方向上"
        case .joystickRight: "方向右"
        case .joystickDown: "方向下"
        case .joystickLeft: "方向左"
        }
    }

    var shortTitle: String {
        switch self {
        case .agent1, .agent2, .agent3, .agent4, .agent5, .agent6: "AG\(rawValue + 1)"
        case .command1: "FAST"
        case .command2: "OK"
        case .command3: "NO"
        case .command4: "CONT"
        case .command5: "PTT"
        case .command6: "SEND"
        case .encoderPress: "ENC"
        case .joystickUp: "UP"
        case .joystickRight: "RIGHT"
        case .joystickDown: "DOWN"
        case .joystickLeft: "LEFT"
        }
    }

    var symbol: String {
        switch self {
        case .agent1, .agent2, .agent3, .agent4, .agent5, .agent6: "sparkle"
        case .command1: "bolt.fill"
        case .command2: "checkmark"
        case .command3: "xmark"
        case .command4: "arrow.right"
        case .command5: "mic.fill"
        case .command6: "paperplane.fill"
        case .encoderPress: "button.programmable"
        case .joystickUp: "arrow.up"
        case .joystickRight: "arrow.right"
        case .joystickDown: "arrow.down"
        case .joystickLeft: "arrow.left"
        }
    }

    var configurationHint: String? {
        switch self {
        case .command5:
            "Micro 默认把 ACT10 用于原生语音：按住录音、松开停止，350 ms 内双击可锁定录音。麦克风和转写由 ChatGPT Desktop 处理；如果你在 ChatGPT 设置中改绑了 ACT10，实际动作以该设置为准。"
        default:
            nil
        }
    }
}

struct CodexMicroLabPosition: Codable, Equatable {
    let row: UInt8
    let column: UInt8
}

enum CodexMicroLabVerification: String, Codable, Equatable {
    case verified
    case pendingReadback

    var detail: String {
        switch self {
        case .verified: "已从固件 EEPROM 读回并验证。"
        case .pendingReadback: "当前尚未完成 EEPROM 读回；ChatGPT 正占用 HID 时可稍后刷新验证。"
        }
    }
}

struct CodexMicroLabSnapshot: Codable, Equatable {
    var mappings: [CodexMicroLabTarget: CodexMicroLabPosition]
    var encoderEnabled: Bool
    var verification: CodexMicroLabVerification

    static let nativeMappings: [CodexMicroLabTarget: CodexMicroLabPosition] = [
        .agent1: .init(row: 4, column: 17),
        .agent2: .init(row: 4, column: 18),
        .agent3: .init(row: 4, column: 19),
        .agent4: .init(row: 3, column: 17),
        .agent5: .init(row: 3, column: 18),
        .agent6: .init(row: 3, column: 19),
        .command1: .init(row: 2, column: 20),
        .command2: .init(row: 0, column: 17),
        .command3: .init(row: 0, column: 20),
        .command4: .init(row: 0, column: 18),
        .command5: .init(row: 5, column: 18),
        .command6: .init(row: 4, column: 20),
        .encoderPress: .init(row: 0, column: 13)
    ]

    static let nativeDefault = CodexMicroLabSnapshot(
        mappings: nativeMappings,
        encoderEnabled: true,
        verification: .pendingReadback
    )

    static func normalizedForClient(_ snapshot: CodexMicroLabSnapshot?) -> CodexMicroLabSnapshot {
        var normalized = snapshot ?? nativeDefault
        normalized.encoderEnabled = true
        return normalized
    }

    static func resolvedForConnection(
        readback: CodexMicroLabSnapshot?,
        fallback: CodexMicroLabSnapshot
    ) -> CodexMicroLabSnapshot {
        var resolved = normalizedForClient(readback ?? fallback)
        if readback == nil || readback?.encoderEnabled == false {
            resolved.verification = .pendingReadback
        }
        return resolved
    }
}

enum CodexMicroLabError: LocalizedError {
    case deviceNotFound
    case cannotOpen(Int32)
    case writeFailed(Int32)

    var errorDescription: String? {
        switch self {
        case .deviceNotFound: "未发现 Codex Micro Lab（303A:8360 / FF00）。请使用 USB 连接实验固件。"
        case .cannotOpen(let code): "无法以非独占方式打开 Codex Micro Lab（IOKit \(code)）。"
        case .writeFailed(let code): "Codex Micro Lab 配置未写入（IOKit \(code)）。"
        }
    }
}

enum CodexMicroLabProtocol {
    static let vendorID = 0x303A
    static let productID = 0x8360
    static let usagePage = 0xFF00
    static let usage = 0x61
    static let reportID: UInt8 = 0x07
    static let reportSize = 64
    static let magic: UInt8 = 0xA7
    static let version: UInt8 = 1

    enum Opcode: UInt8 {
        case hello = 0x01
        case mappings = 0x02
        case set = 0x04
        case clear = 0x05
        case encoder = 0x06
    }

    struct Packet: Equatable {
        let opcode: UInt8
        let sequence: UInt8
        let payload: [UInt8]
    }

    static func encode(opcode: Opcode, sequence: UInt8, payload: [UInt8] = []) -> [UInt8] {
        precondition(payload.count <= reportSize - 6)
        var report = [UInt8](repeating: 0, count: reportSize)
        report[0] = reportID
        report[1] = magic
        report[2] = version
        report[3] = opcode.rawValue
        report[4] = sequence
        report[5] = UInt8(payload.count)
        report.replaceSubrange(6..<(6 + payload.count), with: payload)
        return report
    }

    static func decode(_ bytes: [UInt8]) -> Packet? {
        let report: [UInt8]
        if bytes.count == reportSize - 1, bytes.first == magic {
            report = [reportID] + bytes
        } else {
            report = bytes
        }
        guard report.count >= 6,
              report[0] == reportID,
              report[1] == magic,
              report[2] == version else { return nil }
        let length = Int(report[5])
        guard length <= report.count - 6 else { return nil }
        return Packet(opcode: report[3], sequence: report[4], payload: Array(report[6..<(6 + length)]))
    }

    static func snapshot(from packet: Packet) -> CodexMicroLabSnapshot? {
        guard packet.opcode == Opcode.mappings.rawValue, packet.payload.count >= 2 else { return nil }
        let count = Int(packet.payload[0])
        guard packet.payload.count >= 2 + count * 3 else { return nil }
        var mappings: [CodexMicroLabTarget: CodexMicroLabPosition] = [:]
        for index in 0..<count {
            let offset = 2 + index * 3
            guard let target = CodexMicroLabTarget(rawValue: Int(packet.payload[offset])) else { continue }
            let row = packet.payload[offset + 1]
            let column = packet.payload[offset + 2]
            if row != 0xFF, column != 0xFF {
                mappings[target] = CodexMicroLabPosition(row: row, column: column)
            }
        }
        return CodexMicroLabSnapshot(mappings: mappings, encoderEnabled: packet.payload[1] != 0, verification: .verified)
    }
}

final class CodexMicroLabService {
    private var sequence: UInt8 = 0

    var isConnected: Bool { deviceName != nil }

    var deviceName: String? {
        withDevice { device in
            (IOHIDDeviceGetProperty(device, kIOHIDProductKey as CFString) as? String) ?? "ARkey Codex Micro Lab"
        }
    }

    func setMapping(target: CodexMicroLabTarget, position: CodexMicroLabPosition) throws {
        try write(.set, payload: [UInt8(target.rawValue), position.row, position.column])
    }

    func clearMapping(target: CodexMicroLabTarget) throws {
        try write(.clear, payload: [UInt8(target.rawValue)])
    }

    func enableEncoder() throws {
        try write(.encoder, payload: [1])
    }

    func readMappingsIfAvailable() -> CodexMicroLabSnapshot? {
        guard let result: CodexMicroLabSnapshot? = withOpenDevice({ device in
            let sequence = nextSequence()
            let request = CodexMicroLabProtocol.encode(opcode: .mappings, sequence: sequence)
            guard setReport(device, request) == kIOReturnSuccess else { return nil }

            var response = [UInt8](repeating: 0, count: CodexMicroLabProtocol.reportSize - 1)
            var length = response.count
            let status = IOHIDDeviceGetReport(
                device,
                kIOHIDReportTypeInput,
                CFIndex(CodexMicroLabProtocol.reportID),
                &response,
                &length
            )
            guard status == kIOReturnSuccess else { return nil }
            response = Array(response.prefix(length))
            guard let packet = CodexMicroLabProtocol.decode(response), packet.sequence == sequence else { return nil }
            return CodexMicroLabProtocol.snapshot(from: packet)
        }) else { return nil }
        return result
    }

    private func write(_ opcode: CodexMicroLabProtocol.Opcode, payload: [UInt8]) throws {
        guard let status: IOReturn = withOpenDevice({ device in
            setReport(device, CodexMicroLabProtocol.encode(opcode: opcode, sequence: nextSequence(), payload: payload))
        }) else { throw CodexMicroLabError.deviceNotFound }
        guard status == kIOReturnSuccess else { throw CodexMicroLabError.writeFailed(status) }
    }

    private func nextSequence() -> UInt8 {
        defer { sequence &+= 1 }
        return sequence
    }

    private func setReport(_ device: IOHIDDevice, _ report: [UInt8]) -> IOReturn {
        var payload = Array(report.dropFirst())
        return IOHIDDeviceSetReport(
            device,
            kIOHIDReportTypeOutput,
            CFIndex(CodexMicroLabProtocol.reportID),
            &payload,
            payload.count
        )
    }

    private func withDevice<T>(_ body: (IOHIDDevice) -> T?) -> T? {
        let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
        let match: [String: Int] = [
            kIOHIDVendorIDKey as String: CodexMicroLabProtocol.vendorID,
            kIOHIDProductIDKey as String: CodexMicroLabProtocol.productID,
            kIOHIDPrimaryUsagePageKey as String: CodexMicroLabProtocol.usagePage,
            kIOHIDPrimaryUsageKey as String: CodexMicroLabProtocol.usage
        ]
        IOHIDManagerSetDeviceMatching(manager, match as CFDictionary)
        guard IOHIDManagerOpen(manager, IOOptionBits(kIOHIDOptionsTypeNone)) == kIOReturnSuccess,
              let devices = IOHIDManagerCopyDevices(manager) else {
            return nil
        }
        defer { IOHIDManagerClose(manager, IOOptionBits(kIOHIDOptionsTypeNone)) }
        for case let device as IOHIDDevice in devices as NSSet {
            return body(device)
        }
        return nil
    }

    private func withOpenDevice<T>(_ body: (IOHIDDevice) -> T) -> T? {
        withDevice { device in
            let status = IOHIDDeviceOpen(device, IOOptionBits(kIOHIDOptionsTypeNone))
            guard status == kIOReturnSuccess else { return nil }
            defer { IOHIDDeviceClose(device, IOOptionBits(kIOHIDOptionsTypeNone)) }
            return body(device)
        }
    }
}

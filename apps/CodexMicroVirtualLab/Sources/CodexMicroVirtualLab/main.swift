import CoreHID
#if canImport(CodexMicroVirtualLabCore)
import CodexMicroVirtualLabCore
#endif
import Foundation

private actor LabSession {
    private var accumulator = CodexMicroJSONAccumulator()
    private var desktopConnected = false

    func receive(reportID: UInt8?, data: Data, from device: HIDVirtualDevice) async throws {
        let report = try CodexMicroProtocol.normalizeOutputReport(reportID: reportID, data: data)
        for object in try accumulator.append(report: report) {
            let result = try CodexMicroRPC.handle(object)
            desktopConnected = true
            describe(result.event)
            for responseReport in try CodexMicroProtocol.reports(forJSONObject: result.response) {
                try await device.dispatchInputReport(data: responseReport, timestamp: .now)
            }
        }
    }

    func tap(slot: Int, on device: HIDVirtualDevice) async throws {
        guard desktopConnected else {
            throw LabError.desktopNotConnected
        }
        try await send(slot: slot, pressed: true, on: device)
        try await Task.sleep(for: .milliseconds(70))
        try await send(slot: slot, pressed: false, on: device)
    }

    func send(slot: Int, pressed: Bool, on device: HIDVirtualDevice) async throws {
        guard desktopConnected else {
            throw LabError.desktopNotConnected
        }
        for report in try CodexMicroProtocol.agentEvent(slot: slot, pressed: pressed) {
            try await device.dispatchInputReport(data: report, timestamp: .now)
        }
        print("Agent \(slot + 1) \(pressed ? "按下" : "松开")")
    }

    private func describe(_ event: CodexMicroHostEvent) {
        switch event {
        case .handshake(let method):
            print("Desktop 握手：\(method)")
        case .threadStatus(let slots):
            let summary = slots.sorted { $0.slot < $1.slot }.map { light in
                let color = light.color.map { String(format: "%06X", $0) } ?? "------"
                return "A\(light.slot + 1)=#\(color)/e\(light.effect ?? -1)"
            }.joined(separator: " ")
            print("Desktop Agent 状态：\(summary.isEmpty ? "空" : summary)")
        case .rgbConfiguration:
            print("Desktop 灯光配置已接收")
        case .other(let method):
            print("Desktop 方法：\(method)")
        }
    }
}

private final class VirtualDeviceDelegate: HIDVirtualDeviceDelegate, Sendable {
    private let session: LabSession

    init(session: LabSession) {
        self.session = session
    }

    func hidVirtualDevice(
        _ device: HIDVirtualDevice,
        receivedSetReportRequestOfType type: HIDReportType,
        id: HIDReportID?,
        data: Data
    ) async throws {
        guard type == .output else { return }
        try await session.receive(reportID: id?.rawValue, data: data, from: device)
    }

    func hidVirtualDevice(
        _ device: HIDVirtualDevice,
        receivedGetReportRequestOfType type: HIDReportType,
        id: HIDReportID?,
        maxSize: Int
    ) async throws -> Data {
        guard id?.rawValue == CodexMicroProtocol.reportID else { return Data() }
        return Data(repeating: 0, count: min(maxSize, CodexMicroProtocol.reportSize - 1))
    }
}

private enum LabError: LocalizedError {
    case acknowledgementRequired
    case virtualDeviceUnavailable
    case desktopNotConnected
    case invalidCommand

    var errorDescription: String? {
        switch self {
        case .acknowledgementRequired:
            return "必须传入 --acknowledge-device-identity-test 才会枚举实验设备。"
        case .virtualDeviceUnavailable:
            return "无法创建虚拟 HID。请检查签名 entitlement 和系统权限。"
        case .desktopNotConnected:
            return "ChatGPT/Codex Desktop 尚未完成握手，未发送按键。"
        case .invalidCommand:
            return "命令格式：tap 1..6、down 1..6、up 1..6、help 或 quit。"
        }
    }
}

@main
private struct CodexMicroVirtualLabMain {
    static func main() async {
        do {
            try await run()
        } catch {
            FileHandle.standardError.write(Data("错误：\(error.localizedDescription)\n".utf8))
            Foundation.exit(EXIT_FAILURE)
        }
    }

    private static func run() async throws {
        guard CommandLine.arguments.contains("--acknowledge-device-identity-test") else {
            throw LabError.acknowledgementRequired
        }

        let properties = HIDVirtualDevice.Properties(
            descriptor: CodexMicroProtocol.reportDescriptor,
            vendorID: CodexMicroProtocol.vendorID,
            productID: CodexMicroProtocol.productID,
            transport: .usb,
            product: "Arkey Codex Micro Virtual Lab",
            manufacturer: "Work Louder",
            modelNumber: "Arkey Virtual Lab",
            versionNumber: 0x0100
        )
        guard let device = HIDVirtualDevice(properties: properties) else {
            throw LabError.virtualDeviceUnavailable
        }

        let session = LabSession()
        await device.activate(delegate: VirtualDeviceDelegate(session: session))

        print("Codex Micro Virtual Lab 已枚举；退出本工具即移除设备。")
        print("等待 Desktop 握手。输入 help 查看命令。")

        while let line = readLine(strippingNewline: true) {
            let components = line.split(whereSeparator: \Character.isWhitespace).map(String.init)
            guard let command = components.first?.lowercased() else { continue }
            if command == "quit" || command == "exit" { break }
            if command == "help" {
                print("tap 1..6 | down 1..6 | up 1..6 | quit")
                continue
            }

            do {
                guard components.count == 2,
                      let visibleSlot = Int(components[1]),
                      (1...6).contains(visibleSlot) else {
                    throw LabError.invalidCommand
                }
                let slot = visibleSlot - 1
                switch command {
                case "tap":
                    try await session.tap(slot: slot, on: device)
                case "down":
                    try await session.send(slot: slot, pressed: true, on: device)
                case "up":
                    try await session.send(slot: slot, pressed: false, on: device)
                default:
                    throw LabError.invalidCommand
                }
            } catch {
                print("未执行：\(error.localizedDescription)")
            }
        }

        print("Codex Micro Virtual Lab 已停止。")
    }
}

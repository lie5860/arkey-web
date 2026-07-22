import Foundation
import Testing
@testable import CodexMicroVirtualLabCore

@Test("Codex Micro descriptor exposes only the native report")
func descriptorMatchesNativeSurface() {
    let bytes = [UInt8](CodexMicroProtocol.reportDescriptor)
    #expect(bytes.starts(with: [0x06, 0x00, 0xFF, 0x09, 0x61]))
    #expect(bytes.containsSubsequence([0x85, 0x06]))
    #expect(!bytes.containsSubsequence([0x85, 0x07]))
    #expect(bytes.containsSubsequence([0x95, 0x3F, 0x75, 0x08, 0x81, 0x02]))
    #expect(bytes.containsSubsequence([0x95, 0x3F, 0x75, 0x08, 0x91, 0x82]))
}

@Test("Agent events preserve physical press and release semantics")
func agentEvents() throws {
    var accumulator = CodexMicroJSONAccumulator()
    let pressReports = try CodexMicroProtocol.agentEvent(slot: 1, pressed: true)
    let releaseReports = try CodexMicroProtocol.agentEvent(slot: 1, pressed: false)
    let press = try pressReports.flatMap { try accumulator.append(report: $0) }.first as? [String: Any]
    let release = try releaseReports.flatMap { try accumulator.append(report: $0) }.first as? [String: Any]
    let pressParams = press?["params"] as? [String: Any]
    let releaseParams = release?["params"] as? [String: Any]

    #expect(press?["method"] as? String == "v.oai.hid")
    #expect(pressParams?["k"] as? String == "AG01")
    #expect(pressParams?["ag"] as? Int == 1)
    #expect(pressParams?["act"] as? Int == 1)
    #expect(releaseParams?["act"] as? Int == 0)
}

@Test("Fragmented Desktop requests are reconstructed and answered")
func fragmentedRequests() throws {
    let request: [String: Any] = [
        "id": 42,
        "method": "v.oai.thstatus",
        "params": [
            ["id": 0, "c": 0x00FF66, "b": 0.5, "e": 4, "s": 0.25],
            ["id": 1, "c": 0xFF9900, "b": 1.0, "e": 2, "s": 0.75],
        ],
    ]
    var reports = try CodexMicroProtocol.reports(forJSONObject: request)
    #expect(reports.count > 1)
    var finalReport = [UInt8](reports.removeLast())
    finalReport[2] -= 1 // Desktop requests do not need the device's newline delimiter.
    finalReport[3 + Int(finalReport[2])] = 0
    reports.append(Data(finalReport))

    var accumulator = CodexMicroJSONAccumulator()
    let messages = try reports.flatMap { try accumulator.append(report: $0) }
    #expect(messages.count == 1)
    let result = try CodexMicroRPC.handle(messages[0])
    #expect(result.response["id"] as? Int == 42)
    #expect(result.response["result"] as? Bool == true)
    #expect(try !CodexMicroProtocol.reports(forJSONObject: result.response).isEmpty)
    guard case .threadStatus(let slots) = result.event else {
        Issue.record("Expected thread status event")
        return
    }
    #expect(slots.map(\.slot) == [0, 1])
    #expect(slots[0].color == 0x00FF66)
    #expect(slots[0].effect == 4)
}

@Test("CoreHID output data accepts an omitted report ID")
func omittedReportID() throws {
    let full = try CodexMicroProtocol.reports(forJSONObject: ["id": 1, "method": "sys.version"])[0]
    let payloadOnly = full.dropFirst()
    let normalized = try CodexMicroProtocol.normalizeOutputReport(
        reportID: CodexMicroProtocol.reportID,
        data: Data(payloadOnly)
    )
    #expect(normalized == full)
}

private extension Array where Element == UInt8 {
    func containsSubsequence(_ candidate: [UInt8]) -> Bool {
        guard candidate.count <= count else { return false }
        return indices.dropLast(Swift.max(0, candidate.count - 1)).contains { index in
            Array(self[index..<(index + candidate.count)]) == candidate
        }
    }
}

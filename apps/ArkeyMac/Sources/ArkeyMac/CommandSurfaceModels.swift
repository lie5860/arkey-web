import Foundation
import SwiftUI
import UniformTypeIdentifiers

enum ArkeyTransport: String, Codable, CaseIterable, Identifiable {
    case usb
    case bluetooth
    case simulator
    case unavailable

    var id: String { rawValue }
}

enum KeyboardControlKind: String, Codable {
    case key
    case knobPress
    case encoder
}

struct KeyboardControl: Codable, Hashable, Identifiable {
    let id: String
    let kind: KeyboardControlKind
    let label: String
    let matrixRow: Int?
    let matrixColumn: Int?
    let ledIndex: Int?
    let encoderIndex: Int?
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    let bindable: Bool

    init(
        id: String,
        kind: KeyboardControlKind,
        label: String,
        matrixRow: Int?,
        matrixColumn: Int?,
        ledIndex: Int?,
        encoderIndex: Int?,
        x: Double,
        y: Double,
        width: Double,
        height: Double,
        bindable: Bool
    ) {
        self.id = id
        self.kind = kind
        self.label = label
        self.matrixRow = matrixRow
        self.matrixColumn = matrixColumn
        self.ledIndex = ledIndex
        self.encoderIndex = encoderIndex
        self.x = x
        self.y = y
        self.width = width
        self.height = height
        self.bindable = bindable
    }

    private enum CodingKeys: String, CodingKey {
        case id, kind, label, matrixRow, matrixColumn, ledIndex, encoderIndex
        case x, y, width, height, bindable, matrix, unit
    }

    private struct MatrixPosition: Codable {
        let row: Int
        let column: Int
    }

    private struct UnitFrame: Codable {
        let x: Double
        let y: Double
        let width: Double
        let height: Double
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let matrix = try container.decodeIfPresent(MatrixPosition.self, forKey: .matrix)
        let unit = try container.decodeIfPresent(UnitFrame.self, forKey: .unit)
        id = try container.decode(String.self, forKey: .id)
        kind = try container.decode(KeyboardControlKind.self, forKey: .kind)
        label = try container.decodeIfPresent(String.self, forKey: .label) ?? ""
        matrixRow = try container.decodeIfPresent(Int.self, forKey: .matrixRow) ?? matrix?.row
        matrixColumn = try container.decodeIfPresent(Int.self, forKey: .matrixColumn) ?? matrix?.column
        ledIndex = try container.decodeIfPresent(Int.self, forKey: .ledIndex)
        encoderIndex = try container.decodeIfPresent(Int.self, forKey: .encoderIndex)
        x = try container.decodeIfPresent(Double.self, forKey: .x) ?? unit?.x ?? 0
        y = try container.decodeIfPresent(Double.self, forKey: .y) ?? unit?.y ?? 0
        width = try container.decodeIfPresent(Double.self, forKey: .width) ?? unit?.width ?? 1
        height = try container.decodeIfPresent(Double.self, forKey: .height) ?? unit?.height ?? 1
        bindable = try container.decodeIfPresent(Bool.self, forKey: .bindable) ?? true
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(kind, forKey: .kind)
        try container.encode(label, forKey: .label)
        if let matrixRow, let matrixColumn {
            try container.encode(MatrixPosition(row: matrixRow, column: matrixColumn), forKey: .matrix)
        }
        try container.encodeIfPresent(ledIndex, forKey: .ledIndex)
        try container.encodeIfPresent(encoderIndex, forKey: .encoderIndex)
        try container.encode(UnitFrame(x: x, y: y, width: width, height: height), forKey: .unit)
        try container.encode(bindable, forKey: .bindable)
    }
}

struct KeyboardProfileV2: Codable, Equatable {
    let profileId: String
    let version: Int
    let layoutHash: String
    let name: String
    let vendorId: Int
    let productIds: [Int]
    let ledCount: Int
    let controls: [KeyboardControl]

    init(
        profileId: String,
        version: Int,
        layoutHash: String,
        name: String,
        vendorId: Int,
        productIds: [Int],
        ledCount: Int,
        controls: [KeyboardControl]
    ) {
        self.profileId = profileId
        self.version = version
        self.layoutHash = layoutHash
        self.name = name
        self.vendorId = vendorId
        self.productIds = productIds
        self.ledCount = ledCount
        self.controls = controls
    }

    private enum CodingKeys: String, CodingKey {
        case profileId, version, layoutHash, name, vendorId, productIds, ledCount, controls, transports, encoder
    }

    private struct TransportSet: Codable {
        let usb: USBTransport
    }

    private struct USBTransport: Codable {
        let vendorId: Int
        let productIds: [Int]
    }

    private struct EncoderDescriptor: Codable {
        let id: String
        let label: String
        let index: Int
        let pressControlId: String
        let bindable: Bool
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let transports = try container.decodeIfPresent(TransportSet.self, forKey: .transports)
        profileId = try container.decode(String.self, forKey: .profileId)
        version = try container.decode(Int.self, forKey: .version)
        layoutHash = try container.decode(String.self, forKey: .layoutHash)
        name = try container.decode(String.self, forKey: .name)
        vendorId = try container.decodeIfPresent(Int.self, forKey: .vendorId) ?? transports?.usb.vendorId ?? 0
        productIds = try container.decodeIfPresent([Int].self, forKey: .productIds) ?? transports?.usb.productIds ?? []
        ledCount = try container.decode(Int.self, forKey: .ledCount)
        var decodedControls = try container.decode([KeyboardControl].self, forKey: .controls)
        if let encoder = try container.decodeIfPresent(EncoderDescriptor.self, forKey: .encoder),
           let pressIndex = decodedControls.firstIndex(where: { $0.id == encoder.pressControlId }) {
            let press = decodedControls[pressIndex]
            decodedControls[pressIndex] = KeyboardControl(
                id: encoder.id,
                kind: .encoder,
                label: encoder.label,
                matrixRow: press.matrixRow,
                matrixColumn: press.matrixColumn,
                ledIndex: nil,
                encoderIndex: encoder.index,
                x: press.x,
                y: press.y,
                width: press.width,
                height: press.height,
                bindable: encoder.bindable && press.bindable
            )
        }
        controls = decodedControls
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(profileId, forKey: .profileId)
        try container.encode(version, forKey: .version)
        try container.encode(layoutHash, forKey: .layoutHash)
        try container.encode(name, forKey: .name)
        try container.encode(vendorId, forKey: .vendorId)
        try container.encode(productIds, forKey: .productIds)
        try container.encode(ledCount, forKey: .ledCount)
        try container.encode(controls, forKey: .controls)
    }

    var maxX: Double { controls.map { $0.x + $0.width }.max() ?? 22.5 }
    var maxY: Double { controls.map { $0.y + $0.height }.max() ?? 6.25 }
}

enum AgentTaskState: String, Codable, CaseIterable, Identifiable {
    case unassigned
    case idle
    case working
    case unread
    case requiresInput
    case error

    var id: String { rawValue }

    var title: String {
        switch self {
        case .unassigned: "未分配"
        case .idle: "Idle"
        case .working: "Thinking"
        case .unread: "Complete"
        case .requiresInput: "Requires input"
        case .error: "Error"
        }
    }

    var hexColor: String {
        switch self {
        case .unassigned: "#000000"
        case .idle: "#FFFFFF"
        case .working: "#304FFE"
        case .unread: "#00FF4C"
        case .requiresInput: "#FF6D00"
        case .error: "#FF0033"
        }
    }

    var priority: Int {
        switch self {
        case .requiresInput: 5
        case .unread: 4
        case .working: 3
        case .error: 2
        case .idle: 1
        case .unassigned: 0
        }
    }
}

struct AgentTaskSlot: Codable, Equatable, Identifiable {
    var id: String
    /// Stable physical Agent Key position. This is intentionally independent of
    /// the user-selected task sort mode shown in the rail.
    var slotIndex: Int
    var threadId: String?
    var title: String
    var state: AgentTaskState
    var updatedAt: Date
    var activeTurnId: String?
    var pendingApprovalCount: Int
    var pendingStructuredRequestCount: Int
    var pinned: Bool
    var selected: Bool
    var reasoningEffort: String?
    var serviceTier: String?

    static func placeholder(_ index: Int) -> AgentTaskSlot {
        AgentTaskSlot(
            id: "task-slot-\(index)",
            slotIndex: index,
            threadId: nil,
            title: "Agent \(index + 1)",
            state: .unassigned,
            updatedAt: .distantPast,
            activeTurnId: nil,
            pendingApprovalCount: 0,
            pendingStructuredRequestCount: 0,
            pinned: false,
            selected: index == 0,
            reasoningEffort: nil,
            serviceTier: nil
        )
    }
}

struct ThreadImportCandidate: Equatable, Identifiable {
    let id: String
    let title: String
    let cwd: String?
    let updatedAt: String?
}

enum RuntimeRequestID {
    case integer(Int)
    case string(String)

    var value: Any {
        switch self {
        case .integer(let value): value
        case .string(let value): value
        }
    }

    var displayValue: String {
        switch self {
        case .integer(let value): String(value)
        case .string(let value): value
        }
    }
}

struct StructuredApprovalRequest: Identifiable {
    let requestID: RuntimeRequestID
    let method: String
    let params: [String: Any]

    var id: String { "\(method):\(requestID.displayValue)" }
}

enum CommandActionKind: String, Codable, CaseIterable, Identifiable {
    case taskAgent
    case approveCurrent
    case declineCurrent
    case pushToTalk
    case send
    case continueNewTask
    case toggleFastMode
    case togglePlanMode
    case dialReasoning
    case cancelFocusedControl
    case reviewChanges
    case gitCommit
    case createPullRequest
    case openSkill
    case navigateBack
    case navigateForward
    case toggleSidebar
    case openTerminal
    case openBrowser
    case attachFile
    case scheduledTasks

    var id: String { rawValue }

    var title: String {
        switch self {
        case .taskAgent: "Agent Key"
        case .approveCurrent: "Approve"
        case .declineCurrent: "Decline"
        case .pushToTalk: "Push to talk"
        case .send: "Send"
        case .continueNewTask: "Continue"
        case .toggleFastMode: "Fast"
        case .togglePlanMode: "Plan"
        case .dialReasoning: "Reasoning"
        case .cancelFocusedControl: "Cancel"
        case .reviewChanges: "Review"
        case .gitCommit: "Commit"
        case .createPullRequest: "Pull Request"
        case .openSkill: "Skills"
        case .navigateBack: "Back"
        case .navigateForward: "Forward"
        case .toggleSidebar: "Sidebar"
        case .openTerminal: "Terminal"
        case .openBrowser: "Browser"
        case .attachFile: "Attach"
        case .scheduledTasks: "Scheduled"
        }
    }

    var symbol: String {
        switch self {
        case .taskAgent: "sparkle"
        case .approveCurrent: "checkmark"
        case .declineCurrent: "xmark"
        case .pushToTalk: "waveform"
        case .send: "arrow.up"
        case .continueNewTask: "arrow.triangle.branch"
        case .toggleFastMode: "bolt.fill"
        case .togglePlanMode: "list.bullet.clipboard"
        case .dialReasoning: "dial.medium"
        case .cancelFocusedControl: "escape"
        case .reviewChanges: "doc.text.magnifyingglass"
        case .gitCommit: "arrow.trianglehead.branch"
        case .createPullRequest: "arrow.triangle.pull"
        case .openSkill: "shippingbox"
        case .navigateBack: "chevron.backward"
        case .navigateForward: "chevron.forward"
        case .toggleSidebar: "sidebar.left"
        case .openTerminal: "terminal"
        case .openBrowser: "safari"
        case .attachFile: "paperclip"
        case .scheduledTasks: "calendar.badge.clock"
        }
    }

    var repeatable: Bool {
        switch self {
        case .taskAgent, .continueNewTask, .reviewChanges, .openSkill, .openTerminal, .openBrowser, .attachFile: true
        default: false
        }
    }
}

struct CommandActionInstance: Codable, Equatable, Identifiable, Transferable {
    let id: String
    let kind: CommandActionKind
    let title: String
    let ordinal: Int?
    let enabled: Bool

    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .arkeyAction)
    }
}

struct CommandBinding: Codable, Equatable, Identifiable {
    var id: String { controlId }
    let controlId: String
    let action: CommandActionInstance
    let revision: Int
    let createdAt: Date
    let taskId: String?
    let active: Bool

    init(
        controlId: String,
        action: CommandActionInstance,
        revision: Int,
        createdAt: Date,
        taskId: String? = nil,
        active: Bool = true
    ) {
        self.controlId = controlId
        self.action = action
        self.revision = revision
        self.createdAt = createdAt
        self.taskId = taskId
        self.active = active
    }
}

enum LightingPrimitive: String, Codable, CaseIterable, Identifiable {
    case off
    case solid
    case breath
    case shallowBreath
    case doublePulse
    case riseFade
    case pressFlash
    case snake
    case typing
    case completeWave

    var id: String { rawValue }
}

enum EffectTarget: String, Codable, CaseIterable, Identifiable {
    case selectedKey
    case selectedTask
    case globalAtmosphere

    var id: String { rawValue }
}

struct EffectSpec: Codable, Equatable {
    var primitive: LightingPrimitive
    var target: EffectTarget
    var targetControlId: String?
    var hexColor: String
    var brightness: Double
    var speed: Double
    var durationMs: Int?
    var seed: Int
    var phase: Double
    var epoch: UInt64
    var atmosphereMix: Double

    static let idle = EffectSpec(
        primitive: .solid,
        target: .selectedKey,
        targetControlId: nil,
        hexColor: "#FFFFFF",
        brightness: 0.82,
        speed: 0.4,
        durationMs: nil,
        seed: 1,
        phase: 0,
        epoch: 0,
        atmosphereMix: 0.12
    )
}

struct EffectCatalogDocument: Codable, Equatable {
    let version: Int
    let atmosphereMix: Double
    let selectedPulsePeriodMs: Int
    let primitives: [String: Int]
    let semantics: [String: SemanticEffectDefinition]
    let voice: [String: VoiceEffectDefinition]
    let priority: [String]

    static let fallback = EffectCatalogDocument(
        version: 1,
        atmosphereMix: 0.12,
        selectedPulsePeriodMs: 2_500,
        primitives: ["off": 0, "solid": 1, "shallowBreath": 2, "breath": 3, "doublePulse": 4, "riseFade": 5, "pressFlash": 6],
        semantics: [
            "unassigned": .init(hex: "#000000", hue: 0, saturation: 0, value: 0, basePrimitive: .off, selectedPrimitive: .off, entryPrimitive: nil, entryDurationMs: nil),
            "idle": .init(hex: "#FFFFFF", hue: 0, saturation: 0, value: 255, basePrimitive: .solid, selectedPrimitive: .shallowBreath, entryPrimitive: nil, entryDurationMs: nil),
            "working": .init(hex: "#304FFE", hue: 166, saturation: 207, value: 255, basePrimitive: .solid, selectedPrimitive: .shallowBreath, entryPrimitive: nil, entryDurationMs: nil),
            "completeUnread": .init(hex: "#00FF4C", hue: 96, saturation: 255, value: 255, basePrimitive: .solid, selectedPrimitive: .breath, entryPrimitive: .riseFade, entryDurationMs: 600),
            "requiresInput": .init(hex: "#FF6D00", hue: 18, saturation: 255, value: 255, basePrimitive: .solid, selectedPrimitive: .breath, entryPrimitive: .doublePulse, entryDurationMs: 900),
            "error": .init(hex: "#FF0033", hue: 250, saturation: 255, value: 255, basePrimitive: .solid, selectedPrimitive: .breath, entryPrimitive: .doublePulse, entryDurationMs: 900),
            "offline": .init(hex: "#000000", hue: 0, saturation: 0, value: 0, basePrimitive: .off, selectedPrimitive: .off, entryPrimitive: nil, entryDurationMs: nil)
        ],
        voice: [
            "recording": .init(hex: "#20E0B2", hue: 117, saturation: 219, value: 224, primitive: .breath),
            "processing": .init(hex: "#FFFFFF", hue: 0, saturation: 0, value: 255, primitive: .breath),
            "ready": .init(hex: "#FFFFFF", hue: 0, saturation: 0, value: 255, primitive: .solid)
        ],
        priority: ["keychronSystem", "bindingCaptureTransient", "ptt", "approvalInput", "taskSlot", "commandAvailability", "globalAtmosphere"]
    )
}

struct SemanticEffectDefinition: Codable, Equatable {
    let hex: String
    let hue: Int
    let saturation: Int
    let value: Int
    let basePrimitive: LightingPrimitive
    let selectedPrimitive: LightingPrimitive
    let entryPrimitive: LightingPrimitive?
    let entryDurationMs: Int?
}

struct VoiceEffectDefinition: Codable, Equatable {
    let hex: String
    let hue: Int
    let saturation: Int
    let value: Int
    let primitive: LightingPrimitive
}

enum VoiceCaptureState: String, Codable, CaseIterable {
    case idle
    case recording
    case locked
    case processing
    case ready
    case error
}

enum BindingOutcome: Equatable {
    case bound(CommandBinding)
    case conflict(existing: CommandBinding)
    case unavailable(String)
}

struct RuntimeEvent: Decodable {
    let type: String
    let status: ArkeyStatus?
    let task: AgentTaskSlot?
    let binding: CommandBinding?
    let message: String?
    let sequence: Int?
}

enum TaskSortMode: String, Codable, CaseIterable, Identifiable {
    case priority
    case recent
    case pinned
    case custom

    var id: String { rawValue }
}

enum CommandSurfaceDefaults {
    static func initialDock() -> [CommandActionInstance] {
        var actions = (0..<6).map {
            CommandActionInstance(
                id: "task-agent-\($0 + 1)",
                kind: .taskAgent,
                title: "Agent \($0 + 1)",
                ordinal: $0 + 1,
                enabled: true
            )
        }
        let singles: [CommandActionKind] = [
            .approveCurrent, .declineCurrent, .pushToTalk, .send,
            .continueNewTask, .toggleFastMode, .togglePlanMode,
            .dialReasoning, .cancelFocusedControl, .reviewChanges,
            .gitCommit, .createPullRequest, .openSkill,
            .navigateBack, .navigateForward, .toggleSidebar,
            .openTerminal, .openBrowser, .attachFile, .scheduledTasks
        ]
        actions.append(contentsOf: singles.map {
            CommandActionInstance(
                id: $0.rawValue,
                kind: $0,
                title: $0.title,
                ordinal: nil,
                enabled: $0 != .scheduledTasks && $0 != .togglePlanMode
            )
        })
        return actions
    }
}

struct DockStackState: Equatable {
    var actions: [CommandActionInstance]
    var initialTaskInstancesRemaining: Set<String>
    var nextTaskOrdinal: Int
    var nextInstanceSequence: Int

    static var initial: DockStackState {
        DockStackState(
            actions: CommandSurfaceDefaults.initialDock(),
            initialTaskInstancesRemaining: Set((1...6).map { "task-agent-\($0)" }),
            nextTaskOrdinal: 7,
            nextInstanceSequence: 1
        )
    }

    @discardableResult
    mutating func consume(instanceId: String) -> CommandActionInstance? {
        guard let index = actions.firstIndex(where: { $0.id == instanceId }) else { return nil }
        let action = actions.remove(at: index)
        if action.kind == .taskAgent {
            initialTaskInstancesRemaining.remove(action.id)
            guard initialTaskInstancesRemaining.isEmpty else { return nil }
            let replacement = CommandActionInstance(
                id: "task-agent-\(nextTaskOrdinal)",
                kind: .taskAgent,
                title: "Agent \(nextTaskOrdinal)",
                ordinal: nextTaskOrdinal,
                enabled: true
            )
            nextTaskOrdinal += 1
            actions.append(replacement)
            return replacement
        }
        guard action.kind.repeatable else { return nil }
        nextInstanceSequence += 1
        let replacement = CommandActionInstance(
            id: "\(action.kind.rawValue)-\(nextInstanceSequence)",
            kind: action.kind,
            title: action.title,
            ordinal: nil,
            enabled: action.enabled
        )
        actions.append(replacement)
        return replacement
    }
}

struct CaptureRearmGate: Equatable {
    private(set) var completedTokens: Set<Int> = []
    private(set) var releasedTokens: Set<Int> = []

    var hasPendingSignals: Bool {
        !completedTokens.isEmpty || !releasedTokens.isEmpty
    }

    mutating func bindingCompleted(token: Int) -> Bool {
        completedTokens.insert(token)
        return consumeIfReady(token)
    }

    mutating func releaseObserved(token: Int) -> Bool {
        releasedTokens.insert(token)
        return consumeIfReady(token)
    }

    mutating func reset() {
        completedTokens.removeAll()
        releasedTokens.removeAll()
    }

    private mutating func consumeIfReady(_ token: Int) -> Bool {
        guard completedTokens.contains(token), releasedTokens.contains(token) else { return false }
        completedTokens.remove(token)
        releasedTokens.remove(token)
        return true
    }
}

enum ArkeyLightingMath {
    static func semanticBrightness(_ semantic: Double, globalLuminance: Double) -> Double {
        min(1, max(0, 0.88 * semantic + 0.12 * globalLuminance))
    }
}

extension UTType {
    static let arkeyAction = UTType(exportedAs: "dev.arkey.command-action")
}

extension Color {
    init(arkeyHex hex: String) {
        let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var value: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&value)
        let red, green, blue: Double
        if cleaned.count == 6 {
            red = Double((value >> 16) & 0xff) / 255
            green = Double((value >> 8) & 0xff) / 255
            blue = Double(value & 0xff) / 255
        } else {
            red = 1; green = 1; blue = 1
        }
        self.init(red: red, green: green, blue: blue)
    }

    func arkeyHex() -> String {
        let converted = NSColor(self).usingColorSpace(.deviceRGB) ?? .white
        return String(
            format: "#%02X%02X%02X",
            Int(converted.redComponent * 255),
            Int(converted.greenComponent * 255),
            Int(converted.blueComponent * 255)
        )
    }
}

enum Q6FallbackProfile {
    private struct Entry {
        let row: Int
        let column: Int
        let x: Double
        let y: Double
        let width: Double
        let height: Double
    }

    static let profile: KeyboardProfileV2 = {
        let entries = layoutEntries
        var led = 0
        let controls = entries.map { entry -> KeyboardControl in
            let isKnob = entry.row == 0 && entry.column == 13
            let currentLED = isKnob ? nil : led
            if !isKnob { led += 1 }
            return KeyboardControl(
                id: isKnob ? "encoder-0" : "r\(entry.row)c\(entry.column)",
                kind: isKnob ? .encoder : .key,
                label: label(row: entry.row, column: entry.column),
                matrixRow: entry.row,
                matrixColumn: entry.column,
                ledIndex: currentLED,
                encoderIndex: isKnob ? 0 : nil,
                x: entry.x,
                y: entry.y,
                width: entry.width,
                height: entry.height,
                bindable: true
            )
        }
        return KeyboardProfileV2(
            profileId: "keychron-q6-pro-ansi-knob",
            version: 2,
            layoutHash: "de355358987dddc4f73a610892192e63e36facecc2417aa4b4e0ac4a40a63346",
            name: "Keychron Q6 Pro ANSI Knob",
            vendorId: 0x3434,
            productIds: [0x0660],
            ledCount: 108,
            controls: controls
        )
    }()

    private static func label(row: Int, column: Int) -> String {
        let rows: [[Int: String]] = [
            [0:"esc",1:"F1",2:"F2",3:"F3",4:"F4",5:"F5",6:"F6",7:"F7",8:"F8",9:"F9",10:"F10",11:"F11",12:"F12",13:"Reasoning",14:"Print",15:"Mic",16:"Light",17:"Num",18:"/",19:"*",20:"−"],
            [0:"`",1:"1",2:"2",3:"3",4:"4",5:"5",6:"6",7:"7",8:"8",9:"9",10:"0",11:"−",12:"=",13:"delete",14:"ins",15:"home",16:"pgup",17:"7",18:"8",19:"9",20:"+"],
            [0:"tab",1:"Q",2:"W",3:"E",4:"R",5:"T",6:"Y",7:"U",8:"I",9:"O",10:"P",11:"[",12:"]",13:"\\",14:"del",15:"end",16:"pgdn",17:"4",18:"5",19:"6",20:"+"],
            [0:"caps",1:"A",2:"S",3:"D",4:"F",5:"G",6:"H",7:"J",8:"K",9:"L",10:";",11:"'",13:"return",17:"1",18:"2",19:"3"],
            [0:"shift",2:"Z",3:"X",4:"C",5:"V",6:"B",7:"N",8:"M",9:",",10:".",11:"/",13:"shift",15:"↑",17:"1",18:"2",19:"3",20:"enter"],
            [0:"ctrl",1:"⌥",2:"⌘",6:"space",10:"⌘",11:"fn",12:"⌥",13:"ctrl",14:"←",15:"↓",16:"→",18:"0",19:"."],
        ]
        return rows.indices.contains(row) ? rows[row][column] ?? "" : ""
    }

    private static let layoutEntries: [Entry] = [
        .init(row:0,column:0,x:0,y:0,width:1,height:1),.init(row:0,column:1,x:1.25,y:0,width:1,height:1),.init(row:0,column:2,x:2.25,y:0,width:1,height:1),.init(row:0,column:3,x:3.25,y:0,width:1,height:1),.init(row:0,column:4,x:4.25,y:0,width:1,height:1),.init(row:0,column:5,x:5.5,y:0,width:1,height:1),.init(row:0,column:6,x:6.5,y:0,width:1,height:1),.init(row:0,column:7,x:7.5,y:0,width:1,height:1),.init(row:0,column:8,x:8.5,y:0,width:1,height:1),.init(row:0,column:9,x:9.75,y:0,width:1,height:1),.init(row:0,column:10,x:10.75,y:0,width:1,height:1),.init(row:0,column:11,x:11.75,y:0,width:1,height:1),.init(row:0,column:12,x:12.75,y:0,width:1,height:1),.init(row:0,column:13,x:14,y:0,width:1,height:1),.init(row:0,column:14,x:15.25,y:0,width:1,height:1),.init(row:0,column:15,x:16.25,y:0,width:1,height:1),.init(row:0,column:16,x:17.25,y:0,width:1,height:1),.init(row:0,column:17,x:18.5,y:0,width:1,height:1),.init(row:0,column:18,x:19.5,y:0,width:1,height:1),.init(row:0,column:19,x:20.5,y:0,width:1,height:1),.init(row:0,column:20,x:21.5,y:0,width:1,height:1),
        .init(row:1,column:0,x:0,y:1.25,width:1,height:1),.init(row:1,column:1,x:1,y:1.25,width:1,height:1),.init(row:1,column:2,x:2,y:1.25,width:1,height:1),.init(row:1,column:3,x:3,y:1.25,width:1,height:1),.init(row:1,column:4,x:4,y:1.25,width:1,height:1),.init(row:1,column:5,x:5,y:1.25,width:1,height:1),.init(row:1,column:6,x:6,y:1.25,width:1,height:1),.init(row:1,column:7,x:7,y:1.25,width:1,height:1),.init(row:1,column:8,x:8,y:1.25,width:1,height:1),.init(row:1,column:9,x:9,y:1.25,width:1,height:1),.init(row:1,column:10,x:10,y:1.25,width:1,height:1),.init(row:1,column:11,x:11,y:1.25,width:1,height:1),.init(row:1,column:12,x:12,y:1.25,width:1,height:1),.init(row:1,column:13,x:13,y:1.25,width:2,height:1),.init(row:1,column:14,x:15.25,y:1.25,width:1,height:1),.init(row:1,column:15,x:16.25,y:1.25,width:1,height:1),.init(row:1,column:16,x:17.25,y:1.25,width:1,height:1),.init(row:1,column:17,x:18.5,y:1.25,width:1,height:1),.init(row:1,column:18,x:19.5,y:1.25,width:1,height:1),.init(row:1,column:19,x:20.5,y:1.25,width:1,height:1),.init(row:1,column:20,x:21.5,y:1.25,width:1,height:1),
        .init(row:2,column:0,x:0,y:2.25,width:1.5,height:1),.init(row:2,column:1,x:1.5,y:2.25,width:1,height:1),.init(row:2,column:2,x:2.5,y:2.25,width:1,height:1),.init(row:2,column:3,x:3.5,y:2.25,width:1,height:1),.init(row:2,column:4,x:4.5,y:2.25,width:1,height:1),.init(row:2,column:5,x:5.5,y:2.25,width:1,height:1),.init(row:2,column:6,x:6.5,y:2.25,width:1,height:1),.init(row:2,column:7,x:7.5,y:2.25,width:1,height:1),.init(row:2,column:8,x:8.5,y:2.25,width:1,height:1),.init(row:2,column:9,x:9.5,y:2.25,width:1,height:1),.init(row:2,column:10,x:10.5,y:2.25,width:1,height:1),.init(row:2,column:11,x:11.5,y:2.25,width:1,height:1),.init(row:2,column:12,x:12.5,y:2.25,width:1,height:1),.init(row:2,column:13,x:13.5,y:2.25,width:1.5,height:1),.init(row:2,column:14,x:15.25,y:2.25,width:1,height:1),.init(row:2,column:15,x:16.25,y:2.25,width:1,height:1),.init(row:2,column:16,x:17.25,y:2.25,width:1,height:1),.init(row:2,column:17,x:18.5,y:2.25,width:1,height:1),.init(row:2,column:18,x:19.5,y:2.25,width:1,height:1),.init(row:2,column:19,x:20.5,y:2.25,width:1,height:1),.init(row:2,column:20,x:21.5,y:2.25,width:1,height:2),
        .init(row:3,column:0,x:0,y:3.25,width:1.75,height:1),.init(row:3,column:1,x:1.75,y:3.25,width:1,height:1),.init(row:3,column:2,x:2.75,y:3.25,width:1,height:1),.init(row:3,column:3,x:3.75,y:3.25,width:1,height:1),.init(row:3,column:4,x:4.75,y:3.25,width:1,height:1),.init(row:3,column:5,x:5.75,y:3.25,width:1,height:1),.init(row:3,column:6,x:6.75,y:3.25,width:1,height:1),.init(row:3,column:7,x:7.75,y:3.25,width:1,height:1),.init(row:3,column:8,x:8.75,y:3.25,width:1,height:1),.init(row:3,column:9,x:9.75,y:3.25,width:1,height:1),.init(row:3,column:10,x:10.75,y:3.25,width:1,height:1),.init(row:3,column:11,x:11.75,y:3.25,width:1,height:1),.init(row:3,column:13,x:12.75,y:3.25,width:2.25,height:1),.init(row:3,column:17,x:18.5,y:3.25,width:1,height:1),.init(row:3,column:18,x:19.5,y:3.25,width:1,height:1),.init(row:3,column:19,x:20.5,y:3.25,width:1,height:1),
        .init(row:4,column:0,x:0,y:4.25,width:2.25,height:1),.init(row:4,column:2,x:2.25,y:4.25,width:1,height:1),.init(row:4,column:3,x:3.25,y:4.25,width:1,height:1),.init(row:4,column:4,x:4.25,y:4.25,width:1,height:1),.init(row:4,column:5,x:5.25,y:4.25,width:1,height:1),.init(row:4,column:6,x:6.25,y:4.25,width:1,height:1),.init(row:4,column:7,x:7.25,y:4.25,width:1,height:1),.init(row:4,column:8,x:8.25,y:4.25,width:1,height:1),.init(row:4,column:9,x:9.25,y:4.25,width:1,height:1),.init(row:4,column:10,x:10.25,y:4.25,width:1,height:1),.init(row:4,column:11,x:11.25,y:4.25,width:1,height:1),.init(row:4,column:13,x:12.25,y:4.25,width:2.75,height:1),.init(row:4,column:15,x:16.25,y:4.25,width:1,height:1),.init(row:4,column:17,x:18.5,y:4.25,width:1,height:1),.init(row:4,column:18,x:19.5,y:4.25,width:1,height:1),.init(row:4,column:19,x:20.5,y:4.25,width:1,height:1),.init(row:4,column:20,x:21.5,y:4.25,width:1,height:2),
        .init(row:5,column:0,x:0,y:5.25,width:1.25,height:1),.init(row:5,column:1,x:1.25,y:5.25,width:1.25,height:1),.init(row:5,column:2,x:2.5,y:5.25,width:1.25,height:1),.init(row:5,column:6,x:3.75,y:5.25,width:6.25,height:1),.init(row:5,column:10,x:10,y:5.25,width:1.25,height:1),.init(row:5,column:11,x:11.25,y:5.25,width:1.25,height:1),.init(row:5,column:12,x:12.5,y:5.25,width:1.25,height:1),.init(row:5,column:13,x:13.75,y:5.25,width:1.25,height:1),.init(row:5,column:14,x:15.25,y:5.25,width:1,height:1),.init(row:5,column:15,x:16.25,y:5.25,width:1,height:1),.init(row:5,column:16,x:17.25,y:5.25,width:1,height:1),.init(row:5,column:18,x:18.5,y:5.25,width:2,height:1),.init(row:5,column:19,x:20.5,y:5.25,width:1,height:1)
    ]
}

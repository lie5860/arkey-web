import SwiftUI

struct WorkflowPreviewView: View {
    let actionId: String
    let approval: StructuredApprovalRequest?
    let gitPreview: String
    let onClose: () -> Void
    let onConfirm: (String?) -> Void
    @State private var explicitInput = ""
    @FocusState private var inputFocused: Bool

    init(
        actionId: String,
        approval: StructuredApprovalRequest? = nil,
        gitPreview: String = "",
        onClose: @escaping () -> Void,
        onConfirm: @escaping (String?) -> Void
    ) {
        self.actionId = actionId
        self.approval = approval
        self.gitPreview = gitPreview
        self.onClose = onClose
        self.onConfirm = onConfirm
        _explicitInput = State(initialValue: Self.defaultInput(for: actionId, approval: approval))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Image(systemName: symbol)
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(accent)
                    .frame(width: 42, height: 42)
                    .background(accent.opacity(0.13), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(accent.opacity(0.22), lineWidth: 0.75)
                    }
                Text(title)
                    .font(.title2.bold())
                    .foregroundStyle(ArkeyTheme.textPrimary)
                Spacer()
            }
            .help(detail)
            .accessibilityHint(detail)

            if actionId == "approval" {
                Label("不能单键批准；请逐项确认。", systemImage: "hand.raised.fill")
                    .foregroundStyle(ArkeyTheme.warning)
                    .padding(13)
                    .background(ArkeyTheme.warning.opacity(0.09), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(ArkeyTheme.warning.opacity(0.22), lineWidth: 0.75)
                    }
                if let approval {
                    VStack(alignment: .leading, spacing: 7) {
                        Text(approval.method).font(.caption.monospaced().bold())
                        Text("requestId: \(approval.requestID.displayValue)")
                            .font(.caption2.monospaced())
                            .foregroundStyle(ArkeyTheme.textSecondary)
                        ScrollView {
                            Text(prettyJSON(approval.params))
                                .font(.caption2.monospaced())
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .frame(maxHeight: 110)
                    }
                    .padding(12)
                    .background(ArkeyTheme.canvas, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .strokeBorder(ArkeyTheme.stroke, lineWidth: 0.75)
                    }
                    Text("响应 JSON")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(ArkeyTheme.textSecondary)
                    TextEditor(text: $explicitInput)
                        .font(.caption.monospaced())
                        .foregroundStyle(ArkeyTheme.textPrimary)
                        .scrollContentBackground(.hidden)
                        .focused($inputFocused)
                        .frame(minHeight: 90)
                        .padding(6)
                        .background(ArkeyTheme.canvas, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .strokeBorder(ArkeyTheme.strokeStrong, lineWidth: 0.75)
                        }
                        .accessibilityLabel("审批响应 JSON")
                        .accessibilityHint(approvalInputAccessibilityHint)
                }
            } else if actionId == "git_commit" || actionId == "create_pr" {
                Label("尚未执行 Git 命令；下一步检查 diff、分支和文案。", systemImage: "checkmark.shield")
                .padding(13)
                .arkeyPanel(radius: 12)
                ScrollView {
                    Text(gitPreview.isEmpty ? "正在读取 Git preview…" : gitPreview)
                        .font(.caption2.monospaced())
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 150)
                .padding(10)
                .background(ArkeyTheme.canvas, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(ArkeyTheme.stroke, lineWidth: 0.75)
                }
            } else if actionId == "skill" {
                TextField("完整且可读的 SKILL.md 绝对路径", text: $explicitInput)
                    .textFieldStyle(.roundedBorder)
                    .focused($inputFocused)
                    .help("仅使用你明确指定的 Skill；ARkey 不会自动猜测")
                    .accessibilityLabel("SKILL.md 绝对路径")
            }

            if let validationHint {
                Label(validationHint, systemImage: "exclamationmark.circle")
                    .font(.caption)
                    .foregroundStyle(ArkeyTheme.danger)
            }

            HStack {
                Spacer()
                Button("取消") { onClose() }
                    .buttonStyle(ArkeyControlButtonStyle())
                    .keyboardShortcut(.cancelAction)
                Button(confirmTitle) { onConfirm(explicitInput.nilIfEmpty) }
                    .buttonStyle(ArkeyControlButtonStyle(tone: .accent))
                    .disabled(
                        (actionId == "skill" && explicitInput.nilIfEmpty == nil)
                        || (actionId == "approval" && !isValidStructuredResult)
                    )
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 520)
        .foregroundStyle(ArkeyTheme.textPrimary)
        .tint(ArkeyTheme.accent)
        .background(ArkeyTheme.window)
        .preferredColorScheme(.dark)
        .onAppear {
            if actionId == "approval" || actionId == "skill" {
                inputFocused = true
            }
        }
    }

    private var title: String {
        switch actionId {
        case "git_commit": "Git Commit"
        case "create_pr": "Create Pull Request"
        case "review": "Review Changes"
        case "skill": "Choose Skill"
        case "approval": "需要可见审批"
        default: "ARkey Workflow"
        }
    }

    private var symbol: String {
        switch actionId {
        case "git_commit": "arrow.trianglehead.branch"
        case "create_pr": "arrow.triangle.pull"
        case "review": "doc.text.magnifyingglass"
        case "skill": "shippingbox"
        case "approval": "hand.raised.fill"
        default: "sparkles"
        }
    }

    private var accent: Color {
        actionId == "approval" ? ArkeyTheme.warning : ArkeyTheme.accent
    }

    private var detail: String {
        switch actionId {
        case "git_commit": "先检查当前工作区 diff、未跟踪文件与提交说明，然后由用户明确确认。"
        case "create_pr": "先检查目标 remote、分支、diff 与 PR 文案，然后由用户明确确认。"
        case "review": "Review 会通过 Codex App Server 的受支持工作流启动；不会模拟 ChatGPT Desktop 点击。"
        case "skill": "只有显式选择的 Skill input 才会进入下一次请求。"
        case "approval": "所选任务正在等待不能安全二元化的请求。"
        default: "此动作需要在 ARkey 的可见界面中继续。"
        }
    }

    private var confirmTitle: String {
        switch actionId {
        case "review": "开始 Review"
        case "skill": "使用此 Skill"
        case "approval": "提交响应"
        case "git_commit", "create_pr": "查看完整预览"
        default: "继续"
        }
    }

    private var isValidStructuredResult: Bool {
        guard let data = explicitInput.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        switch approval?.method {
        case "item/permissions/requestApproval":
            return object["permissions"] is [String: Any] && object["scope"] as? String == "turn"
        case "item/tool/requestUserInput":
            return WorkflowApprovalValidation.userInputAnswersAreComplete(
                object,
                questions: approval?.params["questions"]
            )
        case "mcpServer/elicitation/request":
            return WorkflowApprovalValidation.elicitationResponseIsValid(
                object,
                params: approval?.params
            )
        default:
            return false
        }
    }

    private var validationHint: String? {
        if actionId == "skill" && explicitInput.nilIfEmpty == nil {
            return "请输入明确的 SKILL.md 绝对路径。"
        }
        if actionId == "approval" && !isValidStructuredResult {
            if approval?.method == "item/tool/requestUserInput" {
                return "每个问题至少需要一个非空答案。"
            }
            if approval?.method == "mcpServer/elicitation/request" {
                return "接受请求时必须填写符合表单要求的 content。"
            }
            return "JSON 结构与当前审批请求不匹配，修正后才能提交。"
        }
        return nil
    }

    private var approvalInputAccessibilityHint: String {
        switch approval?.method {
        case "item/tool/requestUserInput":
            return "必须为当前请求中的每个问题提供至少一个非空答案"
        case "item/permissions/requestApproval":
            return "填写 permissions，并将 scope 设为 turn"
        case "mcpServer/elicitation/request":
            return "拒绝或取消可直接提交；接受时必须填写 content"
        default:
            return "输入符合当前审批请求的 JSON"
        }
    }

    private func prettyJSON(_ object: [String: Any]) -> String {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]) else {
            return "{}"
        }
        return String(decoding: data, as: UTF8.self)
    }

    private static func defaultInput(for actionId: String, approval: StructuredApprovalRequest?) -> String {
        guard actionId == "approval", let method = approval?.method else { return "" }
        switch method {
        case "item/permissions/requestApproval": return "{\n  \"permissions\": {},\n  \"scope\": \"turn\"\n}"
        case "item/tool/requestUserInput": return "{\n  \"answers\": {}\n}"
        case "mcpServer/elicitation/request": return "{\n  \"action\": \"decline\"\n}"
        default: return "{}"
        }
    }
}

enum WorkflowApprovalValidation {
    static func userInputAnswersAreComplete(_ object: [String: Any], questions rawQuestions: Any?) -> Bool {
        guard let answers = object["answers"] as? [String: Any],
              let questions = rawQuestions as? [[String: Any]],
              !questions.isEmpty else {
            return false
        }
        let questionIDs = questions.compactMap { question -> String? in
            guard let id = question["id"] as? String,
                  !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
            return id
        }
        guard questionIDs.count == questions.count,
              Set(questionIDs).count == questions.count else { return false }
        return questionIDs.allSatisfy { id in
            guard let answer = answers[id] as? [String: Any],
                  let values = answer["answers"] as? [String],
                  !values.isEmpty else { return false }
            return values.allSatisfy {
                !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            }
        }
    }

    static func elicitationResponseIsValid(_ object: [String: Any], params: [String: Any]?) -> Bool {
        guard let action = object["action"] as? String else { return false }
        if action == "decline" || action == "cancel" { return true }
        guard action == "accept",
              let content = object["content"] as? [String: Any] else { return false }

        guard let schema = params?["requestedSchema"] as? [String: Any],
              let required = schema["required"] as? [String],
              !required.isEmpty else {
            return true
        }
        return required.allSatisfy { key in
            guard let value = content[key] else { return false }
            return meaningfulJSONValue(value)
        }
    }

    private static func meaningfulJSONValue(_ value: Any) -> Bool {
        if value is NSNull { return false }
        if let string = value as? String {
            return !string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        if let values = value as? [Any] {
            return !values.isEmpty && values.allSatisfy(meaningfulJSONValue)
        }
        return value is NSNumber
    }
}

private extension String {
    var nilIfEmpty: String? {
        let value = trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}

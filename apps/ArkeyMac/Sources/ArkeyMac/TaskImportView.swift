import SwiftUI

struct TaskImportView: View {
    @ObservedObject var store: CommandSurfaceStore
    @State private var showingScopeInfo = false

    var body: some View {
        VStack(alignment: .leading, spacing: 15) {
            HStack {
                Text("导入任务")
                    .font(.title2.bold())
                    .foregroundStyle(ArkeyTheme.textPrimary)
                Text("当前工作区")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(ArkeyTheme.textSecondary)
                    .padding(.horizontal, 8)
                    .frame(height: 24)
                    .background(ArkeyTheme.surfaceHover, in: Capsule())
                Button {
                    showingScopeInfo.toggle()
                } label: {
                    Image(systemName: "info.circle")
                }
                .buttonStyle(ArkeyIconButtonStyle(size: 24))
                .help("查看导入范围")
                .accessibilityLabel("查看导入范围")
                .popover(isPresented: $showingScopeInfo, arrowEdge: .bottom) {
                    Text("仅显示当前 workspace 的 CLI / VS Code 任务；不会自动接管 ChatGPT Desktop。")
                        .font(.callout)
                        .foregroundStyle(ArkeyTheme.textPrimary)
                        .padding(14)
                        .frame(width: 320, alignment: .leading)
                        .background(ArkeyTheme.window)
                        .preferredColorScheme(.dark)
                }
                Spacer()
                Button { store.importPickerVisible = false } label: {
                    Image(systemName: "xmark")
                }
                    .buttonStyle(ArkeyIconButtonStyle(size: 28))
                    .help("关闭")
                    .accessibilityLabel("关闭")
                    .keyboardShortcut(.cancelAction)
            }

            if store.importCandidates.isEmpty {
                ContentUnavailableView("没有可导入任务", systemImage: "tray", description: Text("在当前项目启动 Codex 后再试。"))
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(store.importCandidates) { candidate in
                            let location = URL(fileURLWithPath: candidate.cwd ?? candidate.id).lastPathComponent
                            HStack(spacing: 12) {
                                Image(systemName: "terminal")
                                    .foregroundStyle(ArkeyTheme.accent)
                                    .frame(width: 30, height: 30)
                                    .background(ArkeyTheme.accentSoft, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(candidate.title)
                                        .font(.headline)
                                        .foregroundStyle(ArkeyTheme.textPrimary)
                                        .lineLimit(1)
                                    Text(location)
                                        .font(.caption.monospaced())
                                        .foregroundStyle(ArkeyTheme.textSecondary)
                                        .lineLimit(1)
                                }
                                Spacer()
                                Button { Task { await store.importTask(candidate.id) } } label: {
                                    Image(systemName: "tray.and.arrow.down")
                                }
                                .buttonStyle(ArkeyIconButtonStyle(tone: .accent, size: 28))
                                .help("导入 \(candidate.title)\n\(candidate.cwd ?? candidate.id)")
                                .accessibilityLabel("导入 \(candidate.title)")
                                .accessibilityHint("来源：\(candidate.cwd ?? candidate.id)")
                            }
                            .padding(12)
                            .arkeyPanel(radius: 12)
                            .help(candidate.cwd ?? candidate.id)
                            .accessibilityValue(candidate.cwd ?? candidate.id)
                        }
                    }
                }
            }
        }
        .padding(22)
        .frame(width: 620, height: 430)
        .foregroundStyle(ArkeyTheme.textPrimary)
        .tint(ArkeyTheme.accent)
        .background(ArkeyTheme.window)
        .preferredColorScheme(.dark)
    }
}

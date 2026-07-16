import SwiftUI

struct CodexMicroLabConfiguratorView: View {
    @ObservedObject var store: CommandSurfaceStore
    @State private var showingConfigurationHint = false
    @State private var showingClearConfirmation = false

    private let columns = [GridItem(.adaptive(minimum: 80, maximum: 112), spacing: 7)]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Label("选择槽位 → 按实体键", systemImage: "cursorarrow.click")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(ArkeyTheme.textSecondary)
                Spacer(minLength: 12)
                Text(store.selectedCodexMicroTarget.title)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(ArkeyTheme.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .help(store.selectedCodexMicroTarget.title)
            }

            LazyVGrid(columns: columns, alignment: .leading, spacing: 7) {
                ForEach(CodexMicroLabTarget.allCases) { target in
                    Button {
                        store.selectCodexMicroTarget(target)
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: target.symbol)
                                .frame(width: 13)
                            Text(target.shortTitle)
                                .lineLimit(1)
                        }
                        .font(.system(size: 9, weight: .semibold))
                        .padding(.horizontal, 7)
                        .frame(maxWidth: .infinity, minHeight: 34, alignment: .center)
                    }
                    .buttonStyle(
                        ArkeyTileButtonStyle(
                            isSelected: target == store.selectedCodexMicroTarget,
                            accent: ArkeyTheme.accent
                        )
                    )
                    .overlay(alignment: .topTrailing) {
                        if target == store.selectedCodexMicroTarget {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 8, weight: .bold))
                                .foregroundStyle(ArkeyTheme.accent)
                                .padding(4)
                                .allowsHitTesting(false)
                        }
                    }
                    .accessibilityValue(target == store.selectedCodexMicroTarget ? "已选择" : "")
                    .accessibilityLabel(target.title)
                    .accessibilityAddTraits(target == store.selectedCodexMicroTarget ? .isSelected : [])
                    .help(target.configurationHint ?? target.title)
                }
            }

            HStack(spacing: 8) {
                Label("旋钮始终由 Micro 接管", systemImage: "dial.medium")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(ArkeyTheme.textSecondary)
                .help("Micro 模式始终接管旋钮，不提供关闭开关")
                .accessibilityLabel("旋钮始终由 Codex Micro 接管")

                if let hint = store.selectedCodexMicroTarget.configurationHint {
                    Button {
                        showingConfigurationHint.toggle()
                    } label: {
                        Image(systemName: "info.circle")
                    }
                    .buttonStyle(ArkeyIconButtonStyle(size: 26))
                    .help("查看当前槽位说明")
                    .accessibilityLabel("查看 \(store.selectedCodexMicroTarget.title) 说明")
                    .popover(isPresented: $showingConfigurationHint, arrowEdge: .bottom) {
                        Text(hint)
                            .font(.callout)
                            .foregroundStyle(ArkeyTheme.textPrimary)
                            .padding(14)
                            .frame(width: 330, alignment: .leading)
                            .background(ArkeyTheme.window)
                            .preferredColorScheme(.dark)
                    }
                }

                Spacer()

                Label(verificationTitle, systemImage: verificationSymbol)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(store.codexMicroLabSnapshot.verification == .verified ? ArkeyTheme.accent : ArkeyTheme.warning)
                    .help(store.codexMicroLabSnapshot.verification.detail)
                    .accessibilityLabel(store.codexMicroLabSnapshot.verification.detail)

                Button { Task { await store.refreshCodexMicroLab() } } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(ArkeyIconButtonStyle(size: 28))
                .help("刷新验证")
                .accessibilityLabel("刷新验证")

                Button(role: .destructive) {
                    showingClearConfirmation = true
                } label: {
                    Image(systemName: "trash")
                }
                .buttonStyle(ArkeyIconButtonStyle(tone: .danger, size: 28))
                .disabled(!selectedTargetHasMapping)
                .help(selectedTargetHasMapping ? "清除当前槽位映射" : "当前槽位尚未映射")
                .accessibilityLabel("清除 \(store.selectedCodexMicroTarget.title) 映射")
            }
        }
        .padding(10)
        .foregroundStyle(ArkeyTheme.textPrimary)
        .arkeyPanel(radius: 15, raised: true)
        .help("选择槽位后点击实体键；映射键由 Micro 独占，清除后恢复普通输入")
        .confirmationDialog(
            "清除 \(store.selectedCodexMicroTarget.title) 的映射？",
            isPresented: $showingClearConfirmation
        ) {
            Button("清除映射", role: .destructive) {
                Task { await store.clearCodexMicroTarget() }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("原实体键将恢复普通输入。")
        }
    }

    private var selectedTargetHasMapping: Bool {
        store.codexMicroLabSnapshot.mappings[store.selectedCodexMicroTarget] != nil
    }

    private var verificationTitle: String {
        store.codexMicroLabSnapshot.verification == .verified ? "已验证" : "待验证"
    }

    private var verificationSymbol: String {
        store.codexMicroLabSnapshot.verification == .verified
            ? "checkmark.seal.fill"
            : "eye.slash.badge.exclamationmark"
    }
}

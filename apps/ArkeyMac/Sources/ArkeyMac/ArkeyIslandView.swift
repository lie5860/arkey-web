import SwiftUI

struct ArkeyIslandView: View {
    @ObservedObject var controller: ArkeyController
    @ObservedObject var coordinator: ArkeyNotchCoordinator

    var body: some View {
        HStack(spacing: 12) {
            statusGlyph

            Text(statusText)
                .font(.system(size: 13, weight: .semibold))

            Spacer()

            Button {
                NSApp.activate(ignoringOtherApps: true)
                Task { await coordinator.showCompact() }
            } label: {
                Image(systemName: "macwindow")
            }
            .buttonStyle(ArkeyIconButtonStyle(tone: .accent, size: 30))
            .help("打开 Command Surface")
            .accessibilityLabel("打开 Command Surface")

            Button {
                Task { await coordinator.showCompact() }
            } label: {
                Image(systemName: "chevron.up")
            }
            .buttonStyle(ArkeyIconButtonStyle(size: 28))
            .help("收起")
            .accessibilityLabel("收起 ARkey Island")
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
        .frame(width: 360)
        .help(controller.message)
        .accessibilityLabel("ARkey Island，\(statusText)，\(controller.message)")
    }

    private var statusGlyph: some View {
        ZStack {
            Circle()
                .fill(controller.isReady ? ArkeyTheme.accentSoft : ArkeyTheme.warning.opacity(0.16))
                .frame(width: 38, height: 38)
            Image(systemName: controller.isReady ? "keyboard.fill" : "keyboard.badge.ellipsis")
                .foregroundStyle(controller.isReady ? ArkeyTheme.accent : ArkeyTheme.warning)
        }
    }

    private var statusText: String {
        if controller.isBusy {
            return "执行中"
        }
        if controller.isReady {
            return "已连接"
        }
        return "需要处理"
    }
}

struct ArkeyCompactLeadingView: View {
    @ObservedObject var controller: ArkeyController

    var body: some View {
        Image(systemName: controller.isReady ? "keyboard.fill" : "keyboard.badge.ellipsis")
            .foregroundStyle(controller.isReady ? ArkeyTheme.accent : ArkeyTheme.warning)
            .font(.system(size: 13, weight: .semibold))
    }
}

struct ArkeyCompactTrailingView: View {
    @ObservedObject var controller: ArkeyController

    var body: some View {
        if controller.isBusy {
            ProgressView()
                .controlSize(.small)
                .frame(width: 16, height: 16)
        } else {
            Circle()
                .fill(controller.isReady ? ArkeyTheme.accent : ArkeyTheme.warning)
                .frame(width: 8, height: 8)
        }
    }
}

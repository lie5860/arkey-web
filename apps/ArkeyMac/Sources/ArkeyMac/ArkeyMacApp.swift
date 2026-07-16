import SwiftUI

@main
struct ArkeyMacApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var controller = ArkeyController()
    @StateObject private var notch = ArkeyNotchCoordinator()

    var body: some Scene {
        WindowGroup("Arkey", id: "command-surface") {
            ContentView(controller: controller, notch: notch)
                .frame(minWidth: 980, minHeight: 680)
                .task {
                    notch.configure(controller: controller)
                    await controller.refresh()
                    await notch.showCompact()
                }
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1180, height: 760)

        MenuBarExtra("ARkey", systemImage: "keyboard") {
            ArkeyMenuBarContent(controller: controller, notch: notch)
        }
    }
}

private struct ArkeyMenuBarContent: View {
    @ObservedObject var controller: ArkeyController
    @ObservedObject var notch: ArkeyNotchCoordinator
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Button("打开 Command Surface") {
            openWindow(id: "command-surface")
            NSApp.activate(ignoringOtherApps: true)
        }
        Button(notch.isExpanded ? "收起 Island" : "展开 Island") {
            Task { await notch.toggle() }
        }
        Divider()
        Button("刷新状态") {
            Task { await controller.refresh() }
        }
        Button("修复后台服务") {
            Task { await controller.repairDaemon() }
        }
        Button("隐藏 Island") {
            Task { await notch.hide() }
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }
}

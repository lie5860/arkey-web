import DynamicNotchKit
import SwiftUI

@MainActor
final class ArkeyNotchCoordinator: ObservableObject {
    @Published private(set) var isPresented = false
    @Published private(set) var isExpanded = false

    private var notch: DynamicNotch<ArkeyIslandView, ArkeyCompactLeadingView, ArkeyCompactTrailingView>?

    func configure(controller: ArkeyController) {
        guard notch == nil else { return }

        notch = DynamicNotch(hoverBehavior: .all) {
            ArkeyIslandView(controller: controller, coordinator: self)
        } compactLeading: {
            ArkeyCompactLeadingView(controller: controller)
        } compactTrailing: {
            ArkeyCompactTrailingView(controller: controller)
        }
    }

    func showCompact() async {
        guard let notch else { return }
        await notch.compact()
        isPresented = true
        isExpanded = false
    }

    func expand() async {
        guard let notch else { return }
        await notch.expand()
        isPresented = true
        isExpanded = true
    }

    func hide() async {
        guard let notch else { return }
        await notch.hide()
        isPresented = false
        isExpanded = false
    }

    func toggle() async {
        if isExpanded {
            await showCompact()
        } else {
            await expand()
        }
    }
}

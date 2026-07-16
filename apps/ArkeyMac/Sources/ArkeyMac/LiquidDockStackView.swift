import SwiftUI

struct LiquidDockStackView: View {
    @ObservedObject var store: CommandSurfaceStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 9) {
            insertPort

            Rectangle()
                .fill(ArkeyTheme.stroke)
                .frame(width: 1)
                .padding(.vertical, 8)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 7) {
                    ForEach(Array(store.dock.enumerated()), id: \.element.id) { index, action in
                        dockIcon(action, isTop: index == 0)
                            .transition(
                                reduceMotion
                                    ? .opacity
                                    : .asymmetric(
                                        insertion: .move(edge: .trailing).combined(with: .opacity),
                                        removal: .scale(scale: 0.84, anchor: .leading).combined(with: .opacity)
                                    )
                            )
                    }
                }
                .padding(.horizontal, 1)
                .padding(.vertical, 2)
            }
        }
        .padding(7)
        .frame(height: 64)
        .arkeyPanel(radius: 14, raised: true)
        .animation(
            reduceMotion ? .easeOut(duration: 0.12) : .spring(response: 0.26, dampingFraction: 0.82),
            value: store.dock
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel("功能绑定栏")
    }

    private var insertPort: some View {
        Button {
            store.setQuickBindingEnabled(!store.continuousBindingMode)
        } label: {
            HStack(spacing: 8) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(store.continuousBindingMode ? ArkeyTheme.accentSoft : ArkeyTheme.surfaceHover)
                    Image(systemName: store.isCapturing ? "dot.radiowaves.left.and.right" : "plus")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(store.continuousBindingMode ? ArkeyTheme.accent : ArkeyTheme.textSecondary)
                }
                .frame(width: 28, height: 28)

                Text(store.continuousBindingMode ? "绑定中" : "绑定")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(ArkeyTheme.textPrimary)
            }
            .padding(.horizontal, 8)
            .frame(width: 88, height: 46, alignment: .leading)
        }
        .buttonStyle(
            ArkeyTileButtonStyle(
                isSelected: store.continuousBindingMode,
                accent: ArkeyTheme.accent
            )
        )
        .help(store.continuousBindingMode ? "停止连续绑定" : "开始连续绑定当前选中的功能")
        .accessibilityLabel(store.continuousBindingMode ? "连续绑定已启用" : "启用连续绑定")
        .accessibilityHint("右侧第一个功能是当前栈顶")
    }

    private func dockIcon(_ action: CommandActionInstance, isTop: Bool) -> some View {
        let selected = store.selectedActionId == action.id

        return Button {
            store.selectAction(action)
        } label: {
            VStack(spacing: 3) {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: action.kind.symbol)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(selected ? ArkeyTheme.textPrimary : ArkeyTheme.textSecondary)
                        .frame(width: 26, height: 24)

                    if let ordinal = action.ordinal {
                        Text("\(ordinal)")
                            .font(.system(size: 7, weight: .bold))
                            .foregroundStyle(selected ? .black.opacity(0.72) : ArkeyTheme.textSecondary)
                            .frame(width: 14, height: 14)
                            .background(selected ? ArkeyTheme.accent : ArkeyTheme.surfacePressed, in: Circle())
                            .offset(x: 7, y: -4)
                    }
                }

                if action.kind != .taskAgent {
                    Text(action.title)
                        .font(.system(size: 8, weight: selected ? .semibold : .medium))
                        .foregroundStyle(selected ? ArkeyTheme.textPrimary : ArkeyTheme.textTertiary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }
            }
            .frame(width: 52, height: 46)
            .overlay(alignment: .bottom) {
                if isTop {
                    Capsule()
                        .fill(ArkeyTheme.accent)
                        .frame(width: 14, height: 2)
                        .offset(y: -3)
                }
            }
        }
        .buttonStyle(ArkeyTileButtonStyle(isSelected: selected, accent: ArkeyTheme.accent))
        .disabled(!action.enabled)
        .draggable(action)
        .help(action.enabled ? "选择 \(action.title)；也可拖到键位" : "\(action.title) 尚未在当前版本启用")
        .accessibilityLabel("\(action.title)\(isTop ? "，当前栈顶" : "")")
        .accessibilityHint(action.enabled ? "点击选择后按实体键，或拖到模拟键盘" : "此功能当前不可用")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

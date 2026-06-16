#if os(iOS)
import UIKit

/// Attaches a UIPanGestureRecognizer to a UIButton to make it draggable,
/// optionally snapping to the nearest vertical edge on release and
/// persisting the position in UserDefaults.
///
/// Usage:
/// ```swift
/// MushiFabDragController.attach(to: button, config: config.draggable!, window: window)
/// ```
final class MushiFabDragController {
    private static let kPosKeyX = "mushi.fab_pos_x"
    private static let kPosKeyY = "mushi.fab_pos_y"
    private static let kFabSize: CGFloat = 56
    private static let kEdgePad: CGFloat = 12

    private weak var button: UIButton?
    private let config: MushiConfig.DraggableConfig
    private weak var window: UIWindow?
    private var startCenter: CGPoint = .zero
    private var dragStart: CGPoint = .zero
    private var isDragging = false

    private init(button: UIButton, config: MushiConfig.DraggableConfig, window: UIWindow) {
        self.button = button
        self.config = config
        self.window = window

        if config.persist {
            let defaults = UserDefaults.standard
            let x = defaults.double(forKey: Self.kPosKeyX)
            let y = defaults.double(forKey: Self.kPosKeyY)
            if x != 0 || y != 0 {
                // Remove auto-layout constraints and apply frame-based position
                button.translatesAutoresizingMaskIntoConstraints = true
                let safeArea = window.safeAreaInsets
                let clampedX = clampX(CGFloat(x), in: window.bounds.width)
                let clampedY = clampY(CGFloat(y), in: window.bounds.height, safeArea: safeArea)
                button.frame = CGRect(
                    x: clampedX,
                    y: clampedY,
                    width: Self.kFabSize,
                    height: Self.kFabSize
                )
            }
        }

        let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
        pan.maximumNumberOfTouches = 1
        button.addGestureRecognizer(pan)
    }

    @discardableResult
    static func attach(
        to button: UIButton,
        config: MushiConfig.DraggableConfig,
        window: UIWindow
    ) -> MushiFabDragController {
        let controller = MushiFabDragController(button: button, config: config, window: window)
        // Retain controller via associated object so it lives as long as the button
        objc_setAssociatedObject(
            button,
            &kAssocKey,
            controller,
            .OBJC_ASSOCIATION_RETAIN_NONATOMIC
        )
        return controller
    }

    @objc private func handlePan(_ gesture: UIPanGestureRecognizer) {
        guard let button = button, let window = window else { return }

        switch gesture.state {
        case .began:
            isDragging = false
            startCenter = button.center
            dragStart = gesture.location(in: window)
            // Switch to frame-based layout so we can move freely
            if button.translatesAutoresizingMaskIntoConstraints == false {
                button.translatesAutoresizingMaskIntoConstraints = true
                button.frame = CGRect(
                    x: button.frame.origin.x,
                    y: button.frame.origin.y,
                    width: Self.kFabSize,
                    height: Self.kFabSize
                )
            }

        case .changed:
            let current = gesture.location(in: window)
            let dx = current.x - dragStart.x
            let dy = current.y - dragStart.y
            if abs(dx) > 6 || abs(dy) > 6 { isDragging = true }
            let safeArea = window.safeAreaInsets
            let newX = clampX(startCenter.x - Self.kFabSize / 2 + dx, in: window.bounds.width)
            let newY = clampY(startCenter.y - Self.kFabSize / 2 + dy, in: window.bounds.height, safeArea: safeArea)
            button.frame = CGRect(x: newX, y: newY, width: Self.kFabSize, height: Self.kFabSize)

        case .ended, .cancelled:
            guard isDragging else { return }
            let safeArea = window.safeAreaInsets
            var finalX = button.frame.origin.x
            if config.snapToEdge {
                let midX = window.bounds.width / 2
                finalX = finalX + Self.kFabSize / 2 < midX
                    ? Self.kEdgePad + safeArea.left
                    : window.bounds.width - Self.kFabSize - Self.kEdgePad - safeArea.right
            }
            let finalY = clampY(button.frame.origin.y, in: window.bounds.height, safeArea: safeArea)

            UIView.animate(withDuration: 0.25, delay: 0, options: .curveEaseOut) {
                button.frame = CGRect(x: finalX, y: finalY, width: Self.kFabSize, height: Self.kFabSize)
            }

            if config.persist {
                UserDefaults.standard.set(Double(finalX), forKey: Self.kPosKeyX)
                UserDefaults.standard.set(Double(finalY), forKey: Self.kPosKeyY)
            }

        default:
            break
        }
    }

    private func clampX(_ x: CGFloat, in width: CGFloat) -> CGFloat {
        let safeArea = window?.safeAreaInsets ?? .zero
        return max(
            Self.kEdgePad + safeArea.left,
            min(x, width - Self.kFabSize - Self.kEdgePad - safeArea.right)
        )
    }

    private func clampY(_ y: CGFloat, in height: CGFloat, safeArea: UIEdgeInsets) -> CGFloat {
        return max(
            safeArea.top + Self.kEdgePad,
            min(y, height - Self.kFabSize - safeArea.bottom - Self.kEdgePad)
        )
    }
}

private var kAssocKey: UInt8 = 0
#endif

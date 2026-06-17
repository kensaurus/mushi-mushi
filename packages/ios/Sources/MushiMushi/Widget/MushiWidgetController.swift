#if os(iOS)
import UIKit

/// Modal bottom sheet for collecting a free-form bug description plus an
/// optional category tag. Auto-attaches the most recent screenshot taken
/// when the controller was instantiated.
final class MushiWidgetController: UIViewController, UITextViewDelegate {
    private let config: MushiConfig
    private let onSubmit: ([String: Any]) -> Void
    private let textView = UITextView()
    private let placeholderLabel = UILabel()
    private let submitButton = UIButton(type: .system)
    private let segmented = UISegmentedControl(items: ["Bug", "Slow", "Visual", "Confusing"])
    private let attachedScreenshot: String?
    private let initialCategory: String?

    init(config: MushiConfig, screenshot: String?, initialCategory: String? = nil, onSubmit: @escaping ([String: Any]) -> Void) {
        self.config = config
        self.attachedScreenshot = screenshot
        self.initialCategory = initialCategory
        self.onSubmit = onSubmit
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .pageSheet
        if let sheet = sheetPresentationController {
            sheet.detents = [.medium(), .large()]
            sheet.prefersGrabberVisible = true
        }
    }

    required init?(coder: NSCoder) { nil }

    override func viewDidLoad() {
        super.viewDidLoad()
        // Respect theme.inherit: detect system dark mode
        let resolvedDark: Bool
        if config.theme.inherit {
            resolvedDark = traitCollection.userInterfaceStyle == .dark
        } else {
            resolvedDark = config.theme.dark
        }
        view.backgroundColor = resolvedDark ? UIColor(white: 0.1, alpha: 1) : .systemBackground
        title = "Report a bug"

        // Keyboard avoidance: register for keyboard show/hide so the
        // text view scrolls into view on both portrait and landscape.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardWillShow(_:)),
            name: UIResponder.keyboardWillShowNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardWillHide(_:)),
            name: UIResponder.keyboardWillHideNotification,
            object: nil
        )

        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        segmented.selectedSegmentIndex = Self.categoryIndex(for: initialCategory)
        stack.addArrangedSubview(segmented)

        let textContainer = UIView()
        textContainer.layer.cornerRadius = 8
        textContainer.layer.borderWidth = 1
        textContainer.layer.borderColor = UIColor.separator.cgColor
        textContainer.translatesAutoresizingMaskIntoConstraints = false

        textView.delegate = self
        textView.font = .preferredFont(forTextStyle: .body)
        textView.backgroundColor = .clear
        textView.translatesAutoresizingMaskIntoConstraints = false
        textContainer.addSubview(textView)

        placeholderLabel.text = "What went wrong? (\(config.minDescriptionLength)+ characters)"
        placeholderLabel.textColor = .placeholderText
        placeholderLabel.font = .preferredFont(forTextStyle: .body)
        placeholderLabel.translatesAutoresizingMaskIntoConstraints = false
        textContainer.addSubview(placeholderLabel)

        stack.addArrangedSubview(textContainer)

        submitButton.setTitle("Submit", for: .normal)
        submitButton.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        submitButton.backgroundColor = UIColor(hex: config.theme.accentColor) ?? .systemBlue
        submitButton.setTitleColor(.white, for: .normal)
        // WCAG AA: disabled state uses a visible dim tone, not 40% opacity white
        submitButton.setTitleColor(UIColor.label.withAlphaComponent(0.4), for: .disabled)
        submitButton.layer.cornerRadius = 10
        submitButton.contentEdgeInsets = UIEdgeInsets(top: 12, left: 16, bottom: 12, right: 16)
        submitButton.addTarget(self, action: #selector(submit), for: .touchUpInside)
        submitButton.isEnabled = false
        submitButton.alpha = 0.4
        stack.addArrangedSubview(submitButton)

        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            textContainer.heightAnchor.constraint(equalToConstant: 140),
            textView.topAnchor.constraint(equalTo: textContainer.topAnchor, constant: 8),
            textView.leadingAnchor.constraint(equalTo: textContainer.leadingAnchor, constant: 8),
            textView.trailingAnchor.constraint(equalTo: textContainer.trailingAnchor, constant: -8),
            textView.bottomAnchor.constraint(equalTo: textContainer.bottomAnchor, constant: -8),
            placeholderLabel.topAnchor.constraint(equalTo: textView.topAnchor, constant: 8),
            placeholderLabel.leadingAnchor.constraint(equalTo: textView.leadingAnchor, constant: 4)
        ])

        navigationItem.rightBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .cancel, target: self, action: #selector(cancel))
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func keyboardWillShow(_ note: Notification) {
        guard let kbFrameEnd = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
              let duration = note.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double
        else { return }
        // `keyboardFrameEndUserInfoKey` is reported in screen coordinates, but
        // `view.bounds` is the view's own local space. Subtracting them directly
        // miscomputes the overlap for `.pageSheet` / `.formSheet` presentations,
        // rotation, split-view, and any non-zero view origin. Convert the
        // keyboard frame into the view's coordinate space first.
        let screenSpace = (note.object as? UIScreen ?? view.window?.windowScene?.screen)?.coordinateSpace
        let kbFrameInView = screenSpace.map { view.convert(kbFrameEnd, from: $0) }
            ?? view.convert(kbFrameEnd, from: nil)
        let overlap = view.bounds.maxY - kbFrameInView.minY
        guard overlap > 0 else { return }
        UIView.animate(withDuration: duration) {
            self.view.transform = CGAffineTransform(translationX: 0, y: -overlap)
        }
    }

    @objc private func keyboardWillHide(_ note: Notification) {
        guard let duration = note.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double
        else { return }
        UIView.animate(withDuration: duration) {
            self.view.transform = .identity
        }
    }

    func textViewDidChange(_ textView: UITextView) {
        placeholderLabel.isHidden = !textView.text.isEmpty
        let valid = textView.text.count >= config.minDescriptionLength
        submitButton.isEnabled = valid
        submitButton.alpha = valid ? 1.0 : 0.4
    }

    @objc private func submit() {
        let categories = ["bug", "slow", "visual", "confusing"]
        let idx = min(max(segmented.selectedSegmentIndex, 0), categories.count - 1)
        var report: [String: Any] = [
            "description": textView.text ?? "",
            "category": categories[idx],
            "context": DeviceContext.capture()
        ]
        if let s = attachedScreenshot {
            report["screenshot"] = s
        }
        onSubmit(report)
        dismiss(animated: true)
    }

    @objc private func cancel() { dismiss(animated: true) }

    private static func categoryIndex(for category: String?) -> Int {
        guard let category else { return 0 }
        return ["bug", "slow", "visual", "confusing"].firstIndex(of: category) ?? 0
    }
}
#endif

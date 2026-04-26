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
        view.backgroundColor = config.theme.dark ? .black : .systemBackground
        title = "Report a bug"

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

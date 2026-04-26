#if os(iOS)
import UIKit

public enum ScreenshotCapture {
    /// Takes a screenshot of the foreground key window. Returns a JPEG-encoded
    /// base64 data URL (no `data:` prefix — server expects raw base64).
    /// Returns nil if no window is visible.
    @MainActor
    public static func captureBase64(quality: CGFloat = 0.7) -> String? {
        guard let window = activeWindow() else { return nil }
        let renderer = UIGraphicsImageRenderer(bounds: window.bounds)
        let image = renderer.image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: false)
        }
        guard let jpeg = image.jpegData(compressionQuality: quality) else { return nil }
        return jpeg.base64EncodedString()
    }

    private static func activeWindow() -> UIWindow? {
        let scenes = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }
        return scenes.flatMap(\.windows).first(where: \.isKeyWindow)
            ?? scenes.flatMap(\.windows).first
    }
}
#endif

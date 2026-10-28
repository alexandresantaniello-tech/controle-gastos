import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let appGroup = "group.com.sifia.app"
    override func viewDidAppear(_ animated: Bool) { super.viewDidAppear(animated); receiveImage() }
    private func receiveImage() {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
              let provider = item.attachments?.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }) else { finish(); return }
        provider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { [weak self] url, error in
            guard let self, error == nil, let url,
                  let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: self.appGroup) else { self?.finish(); return }
            let ext = url.pathExtension.isEmpty ? "png" : url.pathExtension
            let destination = container.appendingPathComponent("sifia-shared-image." + ext)
            try? FileManager.default.removeItem(at: destination)
            do {
                try FileManager.default.copyItem(at: url, to: destination)
                UserDefaults(suiteName: self.appGroup)?.set(destination.lastPathComponent, forKey: "pendingShareFile")
            } catch {}
            self.finish()
        }
    }
    private func finish() { DispatchQueue.main.async { self.extensionContext?.completeRequest(returningItems: nil) } }
}

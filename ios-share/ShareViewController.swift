import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let uploadURL = URL(string: "https://app.sifiaapp.com/share-target")!

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        receberImagem()
    }

    private func receberImagem() {
        guard
            let item = extensionContext?.inputItems.first as? NSExtensionItem,
            let provider = item.attachments?.first(where: {
                $0.hasItemConformingToTypeIdentifier(UTType.image.identifier)
            })
        else {
            concluir()
            return
        }

        provider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { [weak self] data, error in
            guard let self, error == nil, let data else {
                self?.concluir()
                return
            }
            self.enviarParaSifia(data: data)
        }
    }

    private func enviarParaSifia(data: Data) {
        let boundary = "SifiaBoundary-" + UUID().uuidString
        var request = URLRequest(url: uploadURL)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"receipt\"; filename=\"screenshot.png\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: image/png\r\n\r\n".data(using: .utf8)!)
        body.append(data)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body

        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            guard
                let self,
                let http = response as? HTTPURLResponse,
                (200...399).contains(http.statusCode)
            else {
                self?.concluir()
                return
            }
            self.concluir()
        }.resume()
    }

    private func concluir() {
        DispatchQueue.main.async {
            self.extensionContext?.completeRequest(returningItems: nil)
        }
    }
}

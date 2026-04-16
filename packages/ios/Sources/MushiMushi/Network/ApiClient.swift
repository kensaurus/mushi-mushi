import Foundation

final class ApiClient {
    private let config: MushiConfig
    private let session: URLSession

    init(config: MushiConfig) {
        self.config = config
        self.session = URLSession(configuration: .default)
    }

    func submitReport(_ report: [String: Any], completion: @escaping (Result<Void, Error>) -> Void) {
        guard let url = URL(string: "\(config.endpoint)/v1/reports") else {
            completion(.failure(NSError(domain: "MushiMushi", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid URL"])))
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(config.apiKey, forHTTPHeaderField: "X-Mushi-Api-Key")

        var body = report
        body["projectId"] = config.projectId

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch {
            completion(.failure(error))
            return
        }

        session.dataTask(with: request) { _, response, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                completion(.failure(NSError(domain: "MushiMushi", code: -2, userInfo: [NSLocalizedDescriptionKey: "Server error"])))
                return
            }
            completion(.success(()))
        }.resume()
    }
}

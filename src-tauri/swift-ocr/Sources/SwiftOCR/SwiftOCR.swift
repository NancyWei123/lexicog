import Foundation
import Vision

@_cdecl("swift_ocr_recognize")
public func swift_ocr_recognize(
    png_data: UnsafePointer<UInt8>,
    png_len: UInt,
    languages: UnsafePointer<CChar>?,
    out_text: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>,
    out_error: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) -> Bool {
    out_text.pointee = nil
    out_error.pointee = nil
    
    let data = Data(bytes: png_data, count: Int(png_len))
    
    guard let imageSource = CGImageSourceCreateWithData(data as CFData, nil),
          let cgImage = CGImageSourceCreateImageAtIndex(imageSource, 0, nil) else {
        out_error.pointee = strdup("Failed to create image from PNG data")
        return false
    }
    
    let semaphore = DispatchSemaphore(value: 0)
    var resultText: String?
    var resultError: String?
    
    let request = VNRecognizeTextRequest { request, error in
        if let error = error {
            resultError = error.localizedDescription
        } else if let observations = request.results as? [VNRecognizedTextObservation] {
            let text = observations
                .compactMap { $0.topCandidates(1).first?.string }
                .joined(separator: "\n")
                .trimmingCharacters(in: .whitespacesAndNewlines)

            if text.isEmpty {
                resultError = "No text recognized in selected region"
            } else {
                resultText = text
            }
        }
        semaphore.signal()
    }
    
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    
    if let langArray = parseRecognitionLanguages(from: languages), !langArray.isEmpty {
        request.recognitionLanguages = langArray
    } else {
        setAutoLanguages(request: request)
    }
    
    DispatchQueue.global(qos: .userInitiated).async {
        do {
            try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
        } catch {
            resultError = error.localizedDescription
            semaphore.signal()
        }
    }
    
    semaphore.wait()
    
    if let text = resultText {
        out_text.pointee = strdup(text)
        return true
    } else {
        out_error.pointee = strdup(resultError ?? "Unknown OCR error")
        return false
    }
}

private func setAutoLanguages(request: VNRecognizeTextRequest) {
    // automaticallyDetectsLanguage  macOS 13+ 
    if #available(macOS 13.0, *) {
        request.automaticallyDetectsLanguage = true
    } else if #available(macOS 12.0, *) {
        // macOS 12 fallback
        request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US", "ja", "ko"]
    } else {
        request.recognitionLanguages = ["en-US"]
    }
}

private func parseRecognitionLanguages(from languages: UnsafePointer<CChar>?) -> [String]? {
    guard let languages else { return nil }
    let raw = String(cString: languages).trimmingCharacters(in: .whitespacesAndNewlines)
    if raw.isEmpty { return nil }

    var seen = Set<String>()
    var normalized: [String] = []

    for item in raw.split(separator: ",") {
        let lang = normalizeLanguageCode(String(item).trimmingCharacters(in: .whitespaces))
        if !lang.isEmpty && !seen.contains(lang) {
            seen.insert(lang)
            normalized.append(lang)
        }
    }

    return normalized.isEmpty ? nil : normalized
}

private func normalizeLanguageCode(_ language: String) -> String {
    let code = language.lowercased()
    switch code {
    case "zh", "zh-cn", "zh-hans", "zh-sg":
        return "zh-Hans"
    case "zh-tw", "zh-hk", "zh-mo", "zh-hant":
        return "zh-Hant"
    case "en":
        return "en-US"
    case "ja":
        return "ja-JP"
    case "ko":
        return "ko-KR"
    default:
        return language
    }
}

@_cdecl("swift_ocr_free")
public func swift_ocr_free(_ ptr: UnsafeMutablePointer<CChar>?) {
    free(ptr)
}

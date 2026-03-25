// src/types/events.ts

// -wake event is emitted when the corresponding popup window is focused or opened, ocr-wake is with a screenshot image payload 
// request-target-language-of-translation event is emitted when the backend requests the target language for translation, the frontend should respond a language code via deliverSingleMessageFromWindowToBackend
// -task-started events are emitted along with taskId payload when the corresponding streaming tasks are started in the backend, the frontend can end the stream task by sending a cancel signal via deliverCancelSignalFromWindowToBackend
export type Event = "ocr-wake" | "translation-wake" | "lookup-wake" | "request-target-language-of-translation" | "translation-task-started" | "ocr-task-started" | "review-task-started";


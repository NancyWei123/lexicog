#ifndef SWIFT_OCR_H
#define SWIFT_OCR_H

#include <stdint.h>
#include <stdbool.h>

/// @param png_data PNG 图像数据
/// @param png_len 数据长度
/// @param languages 语言代码，逗号分隔如 "zh-Hans,en-US"，NULL 为自动检测
/// @param out_text 输出：识别的文本
/// @param out_error 输出：错误信息
/// @return 是否成功
bool swift_ocr_recognize(
    const uint8_t* png_data,
    uintptr_t png_len,
    const char* languages,
    char** out_text,
    char** out_error
);

void swift_ocr_free(char* ptr);

#endif

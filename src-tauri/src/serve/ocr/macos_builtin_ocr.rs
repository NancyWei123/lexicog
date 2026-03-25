use anyhow::{anyhow, Result};
use std::ffi::{CStr, CString};
use std::os::raw::c_char;

#[link(name = "SwiftOCR", kind = "static")]
extern "C" {
    fn swift_ocr_recognize(
        png_data: *const u8,
        png_len: usize,
        languages: *const c_char,
        out_text: *mut *mut c_char,
        out_error: *mut *mut c_char,
    ) -> bool;

    fn swift_ocr_free(ptr: *mut c_char);
}

pub fn recognize(png_data: &[u8], languages: Option<&[&str]>) -> Result<String> {
    let lang_cstring =
        languages.map(|langs| CString::new(langs.join(",")).expect("Invalid language string"));

    let lang_ptr = lang_cstring
        .as_ref()
        .map(|s| s.as_ptr())
        .unwrap_or(std::ptr::null());

    unsafe {
        let mut text_ptr: *mut c_char = std::ptr::null_mut();
        let mut error_ptr: *mut c_char = std::ptr::null_mut();

        let success = swift_ocr_recognize(
            png_data.as_ptr(),
            png_data.len(),
            lang_ptr,
            &mut text_ptr,
            &mut error_ptr,
        );

        let result = if success {
            let text = ptr_to_string(text_ptr);
            if text.trim().is_empty() {
                Err(anyhow!("no text recognized in selected region")
                    .context("recognize text with macOS built-in OCR"))
            } else {
                Ok(text)
            }
        } else {
            Err(anyhow!(ptr_to_string_or(error_ptr, "Unknown OCR error"))
                .context("recognize text with macOS built-in OCR"))
        };

        swift_ocr_free(text_ptr);
        swift_ocr_free(error_ptr);

        result
    }
}

unsafe fn ptr_to_string(ptr: *mut c_char) -> String {
    if ptr.is_null() {
        String::new()
    } else {
        CStr::from_ptr(ptr).to_string_lossy().into_owned()
    }
}

unsafe fn ptr_to_string_or(ptr: *mut c_char, default: &str) -> String {
    if ptr.is_null() {
        default.to_string()
    } else {
        CStr::from_ptr(ptr).to_string_lossy().into_owned()
    }
}

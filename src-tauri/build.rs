fn main() {
    tauri_build::build();

    #[cfg(target_os = "macos")]
    build_swift();
}

#[cfg(target_os = "macos")]
fn build_swift() {
    use std::{env, path::PathBuf, process::Command};

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let arch = if env::var("TARGET").unwrap().contains("aarch64") {
        "arm64"
    } else {
        "x86_64"
    };

    println!("cargo:rerun-if-changed=swift-ocr/");

    let build_dir = out_dir.join("swift-build");

    let status = Command::new("swift")
        .args([
            "build",
            "-c",
            "release",
            "--arch",
            arch,
            "--build-path",
            build_dir.to_str().unwrap(),
        ])
        .current_dir(manifest_dir.join("swift-ocr"))
        .status()
        .expect("Failed to run swift build");

    assert!(status.success(), "Swift build failed");

    // Link the Swift OCR static library.
    println!(
        "cargo:rustc-link-search=native={}",
        build_dir.join("release").display()
    );
    println!("cargo:rustc-link-lib=static=SwiftOCR");

    // Link required Apple frameworks.
    println!("cargo:rustc-link-lib=framework=Vision");
    println!("cargo:rustc-link-lib=framework=CoreGraphics");
    println!("cargo:rustc-link-lib=framework=Foundation");
    println!("cargo:rustc-link-lib=framework=CoreImage");

    // Add Swift runtime search paths.
    let swift_libs = get_swift_library_paths();
    for path in &swift_libs {
        println!("cargo:rustc-link-search=native={}", path);
    }

    // Link the Swift runtime dynamically.
    println!("cargo:rustc-link-lib=dylib=swiftCore");
}

#[cfg(target_os = "macos")]
fn get_swift_library_paths() -> Vec<String> {
    use std::process::Command;

    let mut paths = Vec::new();

    // Xcode toolchain
    if let Ok(output) = Command::new("xcode-select").arg("-p").output() {
        let xcode_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        paths.push(format!(
            "{}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx",
            xcode_path
        ));
        paths.push(format!(
            "{}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift-5.5/macosx",
            xcode_path
        ));
    }

    // System Swift
    paths.push("/usr/lib/swift".to_string());

    // macOS SDK
    if let Ok(output) = Command::new("xcrun").args(["--show-sdk-path"]).output() {
        let sdk_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        paths.push(format!("{}/usr/lib/swift", sdk_path));
    }

    paths
}

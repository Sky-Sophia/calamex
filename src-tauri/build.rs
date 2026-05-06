fn main() {
    let protoc = protoc_bin_vendored::protoc_bin_path()
        .expect("无法解析 vendored protoc，用于生成 WSL Link gRPC 代码");
    let manifest_dir = std::path::PathBuf::from(
        std::env::var_os("CARGO_MANIFEST_DIR").expect("缺少 CARGO_MANIFEST_DIR"),
    );
    let proto_tmp_dir = manifest_dir
        .join("..")
        .join("target")
        .join("wsl-link-prost-build");
    std::fs::create_dir_all(&proto_tmp_dir).expect("创建 WSL Link proto 临时目录失败");
    std::env::set_var("PROTOC", protoc);
    std::env::set_var("TMPDIR", &proto_tmp_dir);
    std::env::set_var("TEMP", &proto_tmp_dir);
    std::env::set_var("TMP", &proto_tmp_dir);

    println!("cargo:rerun-if-changed=../proto/wsl-link/v1/wsl_link.proto");
    println!("cargo:rerun-if-changed=../proto");

    tonic_prost_build::configure()
        .build_client(true)
        .build_server(true)
        .compile_protos(&["../proto/wsl-link/v1/wsl_link.proto"], &["../proto"])
        .expect("生成 WSL Link gRPC 代码失败");

    #[cfg(feature = "desktop")]
    {
        tauri_build::build();
    }
}

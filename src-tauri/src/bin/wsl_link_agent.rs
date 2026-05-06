#[cfg(target_os = "linux")]
#[path = "../wsl_link/mod.rs"]
mod wsl_link;

#[cfg(target_os = "linux")]
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use std::env;

    use tokio_vsock::{VsockAddr, VsockListener, VMADDR_CID_ANY};
    use wsl_link::{
        agent::WslLinkAgentService,
        agent_runtime::{
            agent_help_text, resolve_agent_startup_action, WslLinkAgentStartupAction,
            AGENT_NOISE_CONFIG_ENV,
        },
        config::WslLinkTransportConfig,
        noise_material::load_agent_material_from_file,
        protocol::v1::wsl_link_server::WslLinkServer,
    };

    let startup = resolve_agent_startup_action(env::args(), env::var(AGENT_NOISE_CONFIG_ENV).ok())?;
    let startup_config = match startup {
        WslLinkAgentStartupAction::Run(config) => config,
        WslLinkAgentStartupAction::PrintHelp => {
            println!("{}", agent_help_text());
            return Ok(());
        }
    };
    let noise_material = load_agent_material_from_file(&startup_config.noise_config_path)?;
    let config = WslLinkTransportConfig::default();
    let listener = VsockListener::bind(VsockAddr::new(VMADDR_CID_ANY, config.vsock_grpc_port))?;
    let incoming = listener.incoming();

    config
        .grpc_server_builder()
        .add_service(WslLinkServer::new(
            WslLinkAgentService::with_noise_material(noise_material),
        ))
        .serve_with_incoming(incoming)
        .await?;

    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn main() {
    eprintln!("wsl-link-agent 仅面向 Linux/WSL2 构建。");
    std::process::exit(2);
}

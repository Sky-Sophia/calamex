use std::time::Duration;

use tonic::transport::{Endpoint, Server};

use super::types::{WslLinkTransportKind, DEFAULT_VSOCK_GRPC_PORT};

pub const DEFAULT_GRPC_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(10);
pub const DEFAULT_GRPC_KEEPALIVE_TIMEOUT: Duration = Duration::from_secs(20);
pub const DEFAULT_CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
pub const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WslLinkTransportConfig {
    pub vsock_grpc_port: u32,
    pub grpc_keepalive_interval: Duration,
    pub grpc_keepalive_timeout: Duration,
    pub connect_timeout: Duration,
    pub request_timeout: Duration,
}

impl Default for WslLinkTransportConfig {
    fn default() -> Self {
        Self {
            vsock_grpc_port: DEFAULT_VSOCK_GRPC_PORT,
            grpc_keepalive_interval: DEFAULT_GRPC_KEEPALIVE_INTERVAL,
            grpc_keepalive_timeout: DEFAULT_GRPC_KEEPALIVE_TIMEOUT,
            connect_timeout: DEFAULT_CONNECT_TIMEOUT,
            request_timeout: DEFAULT_REQUEST_TIMEOUT,
        }
    }
}

impl WslLinkTransportConfig {
    pub fn primary_transport(&self) -> WslLinkTransportKind {
        WslLinkTransportKind::VsockGrpc
    }

    pub fn grpc_client_endpoint(&self) -> Result<Endpoint, tonic::transport::Error> {
        Ok(Endpoint::try_from("http://[::]:0")?
            .connect_timeout(self.connect_timeout)
            .timeout(self.request_timeout)
            .http2_keep_alive_interval(self.grpc_keepalive_interval)
            .keep_alive_timeout(self.grpc_keepalive_timeout)
            .keep_alive_while_idle(true)
            .tcp_nodelay(true))
    }

    pub fn grpc_server_builder(&self) -> Server {
        Server::builder()
            .http2_keepalive_interval(Some(self.grpc_keepalive_interval))
            .http2_keepalive_timeout(Some(self.grpc_keepalive_timeout))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_matches_requested_topology() {
        let config = WslLinkTransportConfig::default();

        assert_eq!(config.primary_transport(), WslLinkTransportKind::VsockGrpc);
        assert_eq!(config.grpc_keepalive_interval, Duration::from_secs(10));
        assert_eq!(config.grpc_keepalive_timeout, Duration::from_secs(20));
        assert_eq!(config.connect_timeout, Duration::from_secs(3));
    }
}

use std::fmt;

use snow::{Builder, HandshakeState, TransportState};
use thiserror::Error;

pub const WSL_LINK_NOISE_PATTERN: &str = "Noise_KKpsk2_25519_ChaChaPoly_BLAKE2s";
pub const WSL_LINK_NOISE_PSK_POSITION: u8 = 2;
pub const WSL_LINK_NOISE_KEY_BYTES: usize = 32;
pub const WSL_LINK_NOISE_MAX_MESSAGE_BYTES: usize = 65_535;
pub const WSL_LINK_NOISE_TAG_BYTES: usize = 16;
pub const WSL_LINK_NOISE_MAX_PLAINTEXT_BYTES: usize =
    WSL_LINK_NOISE_MAX_MESSAGE_BYTES - WSL_LINK_NOISE_TAG_BYTES;

#[derive(Debug, Error)]
pub enum WslLinkNoiseError {
    #[error("WSL Link Noise key 长度不正确：{field} 需要 {expected} 字节，实际 {actual} 字节。")]
    InvalidKeyLength {
        field: &'static str,
        expected: usize,
        actual: usize,
    },
    #[error("WSL Link Noise 消息超过上限：{len} > {max}。")]
    MessageTooLarge { len: usize, max: usize },
    #[error("WSL Link Noise 握手不允许携带明文 payload，实际收到 {len} 字节。")]
    UnexpectedHandshakePayload { len: usize },
    #[error("WSL Link Noise 协议失败：{0}")]
    Snow(#[from] snow::Error),
}

#[derive(Clone, PartialEq, Eq)]
pub struct WslLinkNoiseKeypair {
    public: [u8; WSL_LINK_NOISE_KEY_BYTES],
    private: [u8; WSL_LINK_NOISE_KEY_BYTES],
}

impl WslLinkNoiseKeypair {
    pub fn from_parts(
        public: [u8; WSL_LINK_NOISE_KEY_BYTES],
        private: [u8; WSL_LINK_NOISE_KEY_BYTES],
    ) -> Self {
        Self { public, private }
    }

    pub fn public(&self) -> &[u8; WSL_LINK_NOISE_KEY_BYTES] {
        &self.public
    }

    pub fn private(&self) -> &[u8; WSL_LINK_NOISE_KEY_BYTES] {
        &self.private
    }
}

impl fmt::Debug for WslLinkNoiseKeypair {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("WslLinkNoiseKeypair")
            .field("public_len", &self.public.len())
            .field("private", &"<redacted>")
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct WslLinkNoisePsk([u8; WSL_LINK_NOISE_KEY_BYTES]);

impl WslLinkNoisePsk {
    pub fn from_bytes(bytes: [u8; WSL_LINK_NOISE_KEY_BYTES]) -> Self {
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; WSL_LINK_NOISE_KEY_BYTES] {
        &self.0
    }
}

impl fmt::Debug for WslLinkNoisePsk {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("WslLinkNoisePsk")
            .field("len", &self.0.len())
            .field("value", &"<redacted>")
            .finish()
    }
}

#[derive(Clone)]
pub struct WslLinkNoiseHandshakeConfig {
    local_static_private: [u8; WSL_LINK_NOISE_KEY_BYTES],
    remote_static_public: [u8; WSL_LINK_NOISE_KEY_BYTES],
    psk: WslLinkNoisePsk,
}

impl WslLinkNoiseHandshakeConfig {
    pub fn new(
        local_static_private: [u8; WSL_LINK_NOISE_KEY_BYTES],
        remote_static_public: [u8; WSL_LINK_NOISE_KEY_BYTES],
        psk: WslLinkNoisePsk,
    ) -> Self {
        Self {
            local_static_private,
            remote_static_public,
            psk,
        }
    }

    pub fn local_static_private(&self) -> &[u8; WSL_LINK_NOISE_KEY_BYTES] {
        &self.local_static_private
    }

    pub fn remote_static_public(&self) -> &[u8; WSL_LINK_NOISE_KEY_BYTES] {
        &self.remote_static_public
    }

    pub fn psk(&self) -> &WslLinkNoisePsk {
        &self.psk
    }
}

impl fmt::Debug for WslLinkNoiseHandshakeConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("WslLinkNoiseHandshakeConfig")
            .field("local_static_private", &"<redacted>")
            .field("remote_static_public_len", &self.remote_static_public.len())
            .field("psk", &self.psk)
            .finish()
    }
}

pub struct WslLinkNoiseTransport {
    inner: TransportState,
}

impl WslLinkNoiseTransport {
    pub fn encrypt_frame(&mut self, plaintext: &[u8]) -> Result<Vec<u8>, WslLinkNoiseError> {
        ensure_noise_message_len(
            plaintext.len().saturating_add(WSL_LINK_NOISE_TAG_BYTES),
            WSL_LINK_NOISE_MAX_MESSAGE_BYTES,
        )?;

        let mut ciphertext = vec![0_u8; plaintext.len() + WSL_LINK_NOISE_TAG_BYTES];
        let len = self.inner.write_message(plaintext, &mut ciphertext)?;
        ciphertext.truncate(len);
        Ok(ciphertext)
    }

    pub fn decrypt_frame(&mut self, ciphertext: &[u8]) -> Result<Vec<u8>, WslLinkNoiseError> {
        ensure_noise_message_len(ciphertext.len(), WSL_LINK_NOISE_MAX_MESSAGE_BYTES)?;

        let mut plaintext = vec![0_u8; ciphertext.len()];
        let len = self.inner.read_message(ciphertext, &mut plaintext)?;
        plaintext.truncate(len);
        Ok(plaintext)
    }
}

pub fn generate_static_keypair() -> Result<WslLinkNoiseKeypair, WslLinkNoiseError> {
    let keypair = noise_builder()?.generate_keypair()?;
    Ok(WslLinkNoiseKeypair {
        public: vec_to_key_bytes("public", keypair.public)?,
        private: vec_to_key_bytes("private", keypair.private)?,
    })
}

pub fn build_initiator(
    config: &WslLinkNoiseHandshakeConfig,
) -> Result<HandshakeState, WslLinkNoiseError> {
    noise_builder_with_config(config)?
        .build_initiator()
        .map_err(Into::into)
}

pub fn build_responder(
    config: &WslLinkNoiseHandshakeConfig,
) -> Result<HandshakeState, WslLinkNoiseError> {
    noise_builder_with_config(config)?
        .build_responder()
        .map_err(Into::into)
}

pub fn complete_handshake(
    initiator_config: &WslLinkNoiseHandshakeConfig,
    responder_config: &WslLinkNoiseHandshakeConfig,
) -> Result<(WslLinkNoiseTransport, WslLinkNoiseTransport), WslLinkNoiseError> {
    let mut initiator = build_initiator(initiator_config)?;
    let mut responder = build_responder(responder_config)?;

    let message = write_empty_handshake_message(&mut initiator)?;
    read_empty_handshake_message(&mut responder, &message)?;

    let message = write_empty_handshake_message(&mut responder)?;
    read_empty_handshake_message(&mut initiator, &message)?;

    Ok((
        into_transport_mode(initiator)?,
        into_transport_mode(responder)?,
    ))
}

pub fn write_empty_handshake_message(
    state: &mut HandshakeState,
) -> Result<Vec<u8>, WslLinkNoiseError> {
    let mut message = vec![0_u8; WSL_LINK_NOISE_MAX_MESSAGE_BYTES];
    let message_len = state.write_message(&[], &mut message)?;
    message.truncate(message_len);
    Ok(message)
}

pub fn read_empty_handshake_message(
    state: &mut HandshakeState,
    message: &[u8],
) -> Result<(), WslLinkNoiseError> {
    ensure_noise_message_len(message.len(), WSL_LINK_NOISE_MAX_MESSAGE_BYTES)?;

    let mut payload = vec![0_u8; WSL_LINK_NOISE_MAX_MESSAGE_BYTES];
    let payload_len = state.read_message(message, &mut payload)?;
    if payload_len != 0 {
        return Err(WslLinkNoiseError::UnexpectedHandshakePayload { len: payload_len });
    }
    Ok(())
}

pub fn into_transport_mode(
    state: HandshakeState,
) -> Result<WslLinkNoiseTransport, WslLinkNoiseError> {
    Ok(WslLinkNoiseTransport {
        inner: state.into_transport_mode()?,
    })
}

fn noise_builder() -> Result<Builder<'static>, WslLinkNoiseError> {
    let params = WSL_LINK_NOISE_PATTERN.parse()?;
    Ok(Builder::new(params))
}

fn noise_builder_with_config<'a>(
    config: &'a WslLinkNoiseHandshakeConfig,
) -> Result<Builder<'a>, WslLinkNoiseError> {
    Ok(noise_builder()?
        .local_private_key(config.local_static_private())?
        .remote_public_key(config.remote_static_public())?
        .psk(WSL_LINK_NOISE_PSK_POSITION, config.psk().as_bytes())?)
}

fn ensure_noise_message_len(len: usize, max: usize) -> Result<(), WslLinkNoiseError> {
    if len > max {
        return Err(WslLinkNoiseError::MessageTooLarge { len, max });
    }
    Ok(())
}

fn vec_to_key_bytes(
    field: &'static str,
    bytes: Vec<u8>,
) -> Result<[u8; WSL_LINK_NOISE_KEY_BYTES], WslLinkNoiseError> {
    bytes
        .try_into()
        .map_err(|bytes: Vec<u8>| WslLinkNoiseError::InvalidKeyLength {
            field,
            expected: WSL_LINK_NOISE_KEY_BYTES,
            actual: bytes.len(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn psk(seed: u8) -> WslLinkNoisePsk {
        WslLinkNoisePsk::from_bytes([seed; WSL_LINK_NOISE_KEY_BYTES])
    }

    fn configs(psk: WslLinkNoisePsk) -> (WslLinkNoiseHandshakeConfig, WslLinkNoiseHandshakeConfig) {
        let desktop = generate_static_keypair().expect("desktop keypair should generate");
        let agent = generate_static_keypair().expect("agent keypair should generate");

        (
            WslLinkNoiseHandshakeConfig::new(*desktop.private(), *agent.public(), psk.clone()),
            WslLinkNoiseHandshakeConfig::new(*agent.private(), *desktop.public(), psk),
        )
    }

    fn configs_with_different_psks() -> (WslLinkNoiseHandshakeConfig, WslLinkNoiseHandshakeConfig) {
        let desktop = generate_static_keypair().expect("desktop keypair should generate");
        let agent = generate_static_keypair().expect("agent keypair should generate");

        (
            WslLinkNoiseHandshakeConfig::new(*desktop.private(), *agent.public(), psk(1)),
            WslLinkNoiseHandshakeConfig::new(*agent.private(), *desktop.public(), psk(2)),
        )
    }

    #[test]
    fn requested_noise_pattern_is_supported() {
        let params = WSL_LINK_NOISE_PATTERN
            .parse::<snow::params::NoiseParams>()
            .expect("requested Noise pattern should parse");

        assert_eq!(params.name, WSL_LINK_NOISE_PATTERN);
    }

    #[test]
    fn generated_static_keypair_has_expected_key_lengths() {
        let keypair = generate_static_keypair().expect("keypair should generate");

        assert_eq!(keypair.public().len(), WSL_LINK_NOISE_KEY_BYTES);
        assert_eq!(keypair.private().len(), WSL_LINK_NOISE_KEY_BYTES);
    }

    #[test]
    fn kk_psk2_handshake_encrypts_bidirectional_frames() {
        let (initiator_config, responder_config) = configs(psk(7));
        let (mut initiator, mut responder) =
            complete_handshake(&initiator_config, &responder_config)
                .expect("handshake should complete");

        let client_ciphertext = initiator
            .encrypt_frame(b"client-frame")
            .expect("client frame should encrypt");
        let client_plaintext = responder
            .decrypt_frame(&client_ciphertext)
            .expect("agent should decrypt client frame");
        let server_ciphertext = responder
            .encrypt_frame(b"server-frame")
            .expect("server frame should encrypt");
        let server_plaintext = initiator
            .decrypt_frame(&server_ciphertext)
            .expect("desktop should decrypt server frame");

        assert_ne!(client_ciphertext, b"client-frame");
        assert_eq!(client_plaintext, b"client-frame");
        assert_eq!(server_plaintext, b"server-frame");
    }

    #[test]
    fn wrong_psk_rejects_handshake() {
        let (initiator_config, responder_config) = configs_with_different_psks();

        let result = complete_handshake(&initiator_config, &responder_config);

        assert!(matches!(result, Err(WslLinkNoiseError::Snow(_))));
    }

    #[test]
    fn wrong_remote_static_rejects_handshake() {
        let (initiator_config, responder_config) = configs(psk(3));
        let wrong_remote = generate_static_keypair().expect("wrong keypair should generate");
        let bad_initiator_config = WslLinkNoiseHandshakeConfig::new(
            *initiator_config.local_static_private(),
            *wrong_remote.public(),
            psk(3),
        );

        let result = complete_handshake(&bad_initiator_config, &responder_config);

        assert!(matches!(result, Err(WslLinkNoiseError::Snow(_))));
    }

    #[test]
    fn oversized_plaintext_is_rejected_before_encryption() {
        let (initiator_config, responder_config) = configs(psk(4));
        let (mut initiator, _) = complete_handshake(&initiator_config, &responder_config)
            .expect("handshake should complete");
        let payload = vec![0_u8; WSL_LINK_NOISE_MAX_PLAINTEXT_BYTES + 1];

        let result = initiator.encrypt_frame(&payload);

        assert!(matches!(
            result,
            Err(WslLinkNoiseError::MessageTooLarge { .. })
        ));
    }
}

use super::types::{DataSource, RunChunkPayload, TerminalDataPayload};

#[derive(Debug, Default)]
pub struct Multiplexer;

impl Multiplexer {
    pub fn route_byte_stream(
        source: DataSource,
        data: Vec<u8>,
        run_chunk: Option<RunChunkPayload>,
    ) -> (TerminalDataPayload, Option<RunChunkPayload>) {
        (TerminalDataPayload { source, data }, run_chunk)
    }
}

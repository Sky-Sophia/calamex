use atomic_write_file::AtomicWriteFile;
use std::io::Write;
use std::path::Path;

pub fn write_bytes(path: &Path, content: &[u8]) -> std::io::Result<()> {
    let mut file = AtomicWriteFile::open(path)?;
    file.write_all(content)?;
    file.commit()
}

pub fn write_text(path: &Path, content: &str) -> std::io::Result<()> {
    write_bytes(path, content.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::write_text;
    use std::fs;

    #[test]
    fn write_text_creates_file_atomically() {
        let temp_dir = temp_dir("aed-atomic-write-create");
        fs::create_dir_all(&temp_dir).expect("temp directory should be created");
        let path = temp_dir.join("nested.txt");

        write_text(&path, "你好, atomic").expect("file should be written");

        let content = fs::read_to_string(&path).expect("file should be readable");
        assert_eq!(content, "你好, atomic");
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn write_text_replaces_existing_file() {
        let temp_dir = temp_dir("aed-atomic-write-replace");
        fs::create_dir_all(&temp_dir).expect("temp directory should be created");
        let path = temp_dir.join("target.txt");
        fs::write(&path, "old").expect("old file should be written");

        write_text(&path, "new").expect("file should be replaced");

        let content = fs::read_to_string(&path).expect("file should be readable");
        assert_eq!(content, "new");
        let _ = fs::remove_dir_all(&temp_dir);
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time should move forward")
                .as_nanos()
        ))
    }
}
